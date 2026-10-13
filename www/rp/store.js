/* RP 存储适配层：大体积数据（角色卡、大聊天历史）走 IndexedDB，
 * 超大体积（>256KB 且有原生桥接）走 App 私有文件（2GB 配额，不受 WebView 限制），
 * localStorage 只留索引；迁移幂等（版本标记）、失败回退 localStorage；
 * 无 IndexedDB 环境（Node 测试）时全部走 localStorage 回退。
 * 浏览器 / Node 双环境兼容：indexedDB / navigator / NDFILE 引用前均有 typeof 守卫。
 */
var RP_STORE = (function(){
"use strict";

var DB_NAME = "nd_store";
var DB_VER = 1;
var OS_NAME = "kv";
var MIGRATE_VERSION = 1;
var MARK_KEY = "nd_store_v";
var IDX_PREFIX = "nd_idbidx_";
var COPY_PREFIX = "nd_idbcopied_"; /* 已复制到 IDB 的键标记（localStorage 副本仍保留，保证同步读取不丢数据） */
var FILE_PREFIX = "nd_fileidx_"; /* 已搬进文件层的键标记（localStorage 副本已删，同步读走 MEM 内存镜像） */
/* 同步读取缓存：IDB/文件内容的内存镜像，保证 localStorage 副本被手动清理后同步读取仍能命中 */
var MEM = {};
var BIG_MIN_BYTES = 64 * 1024;
var FILE_MIN_BYTES = 256 * 1024; /* 超过此体积且有原生桥接时走文件层（2GB），否则走 IDB */

/* 大键前缀表：命中即视为候选大体积数据 */
/* P1-7: 补齐全部单调增长的大键前缀，否则它们永不迁移、只挤 5MB localStorage */
var BIG_PREFIXES = [
  "nd_chat_",          /* 单聊历史 */
  "nd_group_",         /* 群聊历史 */
  "nd_travchat_",      /* 穿越聊天 */
  "nd_trav_",          /* 穿越会话/世界状态 (traverse.js) */
  "nd_travws_",        /* 穿越世界状态 (traverse.js) */
  "nd_identity_",      /* 穿越身份 (traverse.js) */
  "nd_imported_cards", /* 导入的角色卡 */
  "nd_custom_chars",   /* 自定义角色 */
  "nd_cw_",            /* 写卡草稿 */
  "nd_saves_",         /* 平行存档（内嵌整段 history） */
  "nd_mem2_",          /* 长期记忆 (memory.js) */
  "nd_lore_",          /* 世界书 (app.js) */
  "nd_albums_v1"       /* 记忆事件簿 (album.js) */
];

function SUPPORTED(){
  try{
    return typeof indexedDB !== "undefined" && !!indexedDB;
  }catch(e){ return false; }
}

function isBigKey(key){
  var k = String(key == null ? "" : key);
  for(var i = 0; i < BIG_PREFIXES.length; i++){
    if(k.indexOf(BIG_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/* ---- localStorage 小工具（全部 try/catch） ---- */
function _lsGet(k){
  try{
    var v = localStorage.getItem(k);
    return v == null ? null : v;
  }catch(e){ return null; }
}
function _lsSet(k, v){
  try{ localStorage.setItem(k, String(v)); return true; }catch(e){ return false; }
}
function _lsDel(k){
  try{ localStorage.removeItem(k); }catch(e){}
}
function _lsKeys(){
  try{
    if(typeof localStorage === "undefined" || !localStorage) return [];
    if(typeof localStorage.length === "number" && typeof localStorage.key === "function"){
      var out = [];
      for(var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if(k != null) out.push(String(k));
      }
      return out;
    }
    /* 纯对象 fake（如测试桩）：只收非函数值键 */
    var ks = Object.keys(localStorage), ret = [];
    for(var j = 0; j < ks.length; j++){
      if(typeof localStorage[ks[j]] !== "function") ret.push(ks[j]);
    }
    return ret;
  }catch(e){ return []; }
}

/* ---- IndexedDB 底层（Promise 封装） ---- */
function _openDb(){
  return new Promise(function(resolve, reject){
    var idb = null;
    try{
      if(typeof indexedDB === "undefined" || !indexedDB) throw new Error("no indexedDB");
      idb = indexedDB;
    }catch(err){ reject(err); return; }
    var req;
    try{ req = idb.open(DB_NAME, DB_VER); }catch(err){ reject(err); return; }
    var done = false;
    function ok(db){ if(!done){ done = true; resolve(db); } }
    req.onupgradeneeded = function(e){
      try{
        var db = e.target.result;
        var names = db.objectStoreNames;
        var has = names && typeof names.contains === "function" && names.contains(OS_NAME);
        if(!has && typeof db.createObjectStore === "function"){
          db.createObjectStore(OS_NAME, {keyPath: "k"});
        }
      }catch(err){}
      ok(e.target.result);
    };
    req.onsuccess = function(e){ ok(e.target.result); };
    req.onerror = function(e){
      reject((e && e.target && e.target.error) || new Error("idb open failed"));
    };
    req.onblocked = function(){ reject(new Error("idb blocked")); };
  });
}

function _tx(mode, fn){
  return _openDb().then(function(db){
    return new Promise(function(resolve, reject){
      var tx, store, req;
      try{ tx = db.transaction(OS_NAME, mode); }catch(err){ reject(err); return; }
      try{ store = tx.objectStore(OS_NAME); }catch(err){ reject(err); return; }
      try{ req = fn(store); }catch(err){ reject(err); return; }
      req.onsuccess = function(e){ resolve(e && e.target ? e.target.result : undefined); };
      req.onerror = function(e){
        reject((e && e.target && e.target.error) || new Error("idb op failed"));
      };
    });
  });
}

/* ---- 文件层（NDFILE，原生桥接，2GB 配额） ---- */
function fileOK(){
  try{
    return typeof NDFILE !== "undefined" && NDFILE &&
      typeof NDFILE.SUPPORTED === "function" && NDFILE.SUPPORTED();
  }catch(e){ return false; }
}
function hasFileMark(k){ return _lsGet(FILE_PREFIX + k) === "1"; }
/* 文件层写入：成功记标记 + 删 localStorage/IDB 副本（只留一份）；失败抛错由调用方回退 */
function fileSetItem(k, v){
  MEM[k] = v;
  return NDFILE.setItem(k, v).then(function(){
    _lsSet(FILE_PREFIX + k, "1");
    _lsDel(k); _lsDel(IDX_PREFIX + k); _lsDel(COPY_PREFIX + k);
    if(SUPPORTED()){
      _tx("readwrite", function(s){ return s.delete(k); }).then(function(){}, function(){});
    }
  }, function(err){
    delete MEM[k];
    throw err;
  });
}

/* ---- 对外异步读写：优先文件层，其次 IDB，失败同步回退 localStorage ---- */
function idbGet(k){
  if(SUPPORTED()){
    return _tx("readonly", function(s){ return s.get(k); }).then(function(rec){
      if(rec && rec.v !== undefined && rec.v !== null) return rec.v;
      return _lsGet(k); /* IDB 未命中：回退读 localStorage（未迁移的小键） */
    }, function(){
      return _lsGet(k);
    });
  }
  return Promise.resolve(_lsGet(k));
}
function getItemAsync(key){
  var k = String(key);
  if(fileOK() && hasFileMark(k)){
    return NDFILE.getItem(k).then(function(v){
      if(v != null) return v;
      return idbGet(k); /* 文件丢失：回退 IDB/localStorage */
    }, function(){ return idbGet(k); });
  }
  return idbGet(k);
}

function idbSetItem(k, v){
  if(SUPPORTED()){
    return _tx("readwrite", function(s){ return s.put({k: k, v: v}); }).then(function(){
      _lsSet(IDX_PREFIX + k, "1"); /* localStorage 只留索引标记 */
    }, function(){
      /* IDB 抛错：同步回退 localStorage。
       * P1-9(a): 必须清掉 COPY 标记，否则 warmCache 会用 IDB 里的旧值盖掉本次回退的新值。
       * P1-9(b): LS 回退也失败（配额）则 reject，不能 resolve 假装成功。 */
      if(!_lsSet(k, v)) throw new Error("store: persist failed (idb+ls): " + k);
      _lsDel(COPY_PREFIX + k);
    });
  }
  if(!_lsSet(k, v)) throw new Error("store: persist failed (ls): " + k);
  return Promise.resolve();
}
function setItemAsync(key, value){
  var k = String(key), v = String(value);
  if(fileOK() && v.length > FILE_MIN_BYTES){
    /* P1-9(b): 文件层失败再走 IDB；IDB（含 LS 回退）也失败则整体 reject
     *（此前最终都 resolve，成功提示是假的）。idbSetItem 只在全部落盘失败时 reject，
     * 成功时 resolve，故此处无需二次校验（直接查 LS/MEM 会误判 IDB 成功为失败）。 */
    return fileSetItem(k, v).then(function(){}, function(){
      return idbSetItem(k, v).then(function(){ MEM[k] = v; });
    });
  }
  if(fileOK() && hasFileMark(k)){
    /* 值缩小到阈值下：撤下文件层，回 IDB/localStorage。
     * P2-7: 不再 delete MEM[k]（降级不得比失败前更差，保留同步读命中）。 */
    _lsDel(FILE_PREFIX + k);
    NDFILE.removeItem(k).then(function(){}, function(){});
  }
  return idbSetItem(k, v);
}

function removeItemAsync(key){
  var k = String(key);
  _lsDel(IDX_PREFIX + k); /* 索引标记一并清除 */
  _lsDel(FILE_PREFIX + k);
  delete MEM[k];
  if(fileOK()) NDFILE.removeItem(k).then(function(){}, function(){});
  if(SUPPORTED()){
    return _tx("readwrite", function(s){ return s.delete(k); }).then(function(){
      _lsDel(k);
    }, function(){
      _lsDel(k);
    });
  }
  _lsDel(k);
  return Promise.resolve();
}

/* 幂等迁移：把命中 BIG_PREFIXES 且体积 > 64KB 的 localStorage 键搬进 IDB。
 * IDB 不可用 -> {moved:0, skipped:true, reason:"no-idb"}；
 * 已是当前版本 -> {moved:0, skipped:true}；单键失败不中断整体。 */
function migrate(onProgress){
  if(!SUPPORTED()){
    return Promise.resolve({moved: 0, skipped: true, reason: "no-idb"});
  }
  if(_lsGet(MARK_KEY) === String(MIGRATE_VERSION)){
    return Promise.resolve({moved: 0, skipped: true});
  }
  var keys = _lsKeys().filter(function(k){
    return k !== MARK_KEY && isBigKey(k);
  });
  var total = keys.length, moved = 0, failed = 0, i = 0;
  function prog(){
    if(typeof onProgress === "function"){
      try{ onProgress({done: i, total: total, moved: moved}); }catch(e){}
    }
  }
  function step(){
    if(i >= keys.length){
      if(failed === 0) _lsSet(MARK_KEY, String(MIGRATE_VERSION));
      return Promise.resolve({moved: moved, failed: failed, skipped: false});
    }
    var k = keys[i++];
    var v = _lsGet(k);
    if(v == null || v.length <= BIG_MIN_BYTES){ prog(); return step(); }
    return setItemAsync(k, v).then(function(){
      /* 复制模式：IDB 落盘后 localStorage 副本保留（同步读取不受影响），只记标记 + 内存镜像 */
      MEM[k] = v;
      _lsSet(COPY_PREFIX + k, "1");
      moved++;
      prog();
      return step();
    }, function(){
      failed++;
      prog();
      return step();
    });
  }
  return step();
}

/* 同步读取缓存：IDB 内容的内存镜像，保证 localStorage 副本被手动清理后同步读取仍能命中 */
function cacheGet(key){ var k = String(key); return (k in MEM)? MEM[k]: null; }
function cacheSet(key, value){ MEM[String(key)] = String(value); }
/* 同步读（v36）：MEM -> 文件层同步补读（冷启动预热未完成时） -> localStorage。
 * 解决冷启动快速点开聊天时 getHist 读空、进而 showChat 用空历史覆盖真实记录的问题。
 * P0-2 修复：文件层瞬时读失败（抛错/哨兵）时重试一次；仍失败则**保留文件标记**、
 * 返回 null，绝不删标记。标记只在"文件确实不存在"时才清除。 */
function getSync(key){
  var k = String(key);
  if(k in MEM) return MEM[k];
  if(fileOK() && hasFileMark(k)){
    var v = null, failed = false;
    try{ v = NDFILE.getItemSync(k); }
    catch(e){
      /* 瞬时抖动重试一次 */
      try{ v = NDFILE.getItemSync(k); }
      catch(e2){ failed = true; }
    }
    if(failed) return null; /* 标记保留：下次还能读到，不可当作"无数据" */
    if(v != null){ MEM[k] = v; return v; }
    /* 桥明确返回 null = 文件确实不存在：清掉过期标记，回退下层 */
    _lsDel(FILE_PREFIX + k);
  }
  return _lsGet(k);
}
/* 严格同步读：与 getSync 相同，但文件层持续读失败时抛错而不是返回 null，
 * 供 getHist 等关键路径区分"读失败"与"确实无数据"。 */
function getSyncStrict(key){
  var k = String(key);
  if(k in MEM) return MEM[k];
  if(fileOK() && hasFileMark(k)){
    var v = null, err = null;
    try{ v = NDFILE.getItemSync(k); }
    catch(e){
      try{ v = NDFILE.getItemSync(k); }
      catch(e2){ err = e2; }
    }
    if(err) throw err; /* 标记保留，调用方按失败处理 */
    if(v != null){ MEM[k] = v; return v; }
    _lsDel(FILE_PREFIX + k);
  }
  var lv = _lsGet(k);
  if(lv == null && hasFileMark(k)){
    /* 标记还在但两处都读不到：视为读失败而非空数据 */
    throw new Error("store: file marked but unreadable: " + k);
  }
  return lv;
}
/* 该键是否在文件层（有标记） */
function hasFileKey(key){ return hasFileMark(String(key)); }
/* 把键撤下文件层：删原生文件 + 标记（值已变小或调用方另有存储时用）。
 * 防止旧大文件在下次冷启动 warmCache 时"复活"，盖掉 localStorage 里的新值。 */
function evictFile(key){
  var k = String(key);
  _lsDel(FILE_PREFIX + k);
  if(fileOK()){
    try{ NDFILE.removeItem(k); }catch(e){}
  }
}
/* 大键双写：localStorage 写入后，若值超过阈值则异步搬到 IDB/文件层（失败静默，读走 localStorage）。
 * 有原生桥接且值 >256KB 时走文件层并删除 localStorage 副本（这就是 5MB 上限的来源），
 * 同步读取走 MEM 内存镜像不受影响。 */
function syncBig(key, value){
  var k = String(key), v = (value == null)? "": String(value);
  if(!isBigKey(k) || v.length <= BIG_MIN_BYTES) return;
  MEM[k] = v;
  if(fileOK() && v.length > FILE_MIN_BYTES){
    NDFILE.setItem(k, v).then(function(){
      _lsSet(FILE_PREFIX + k, "1");
      _lsDel(k); _lsDel(IDX_PREFIX + k); _lsDel(COPY_PREFIX + k);
      if(SUPPORTED()){
        _tx("readwrite", function(s){ return s.delete(k); }).then(function(){}, function(){});
      }
    }, function(){
      /* 文件层失败（配额/IO）：回退原 IDB 路径 */
      if(SUPPORTED()){
        idbSetItem(k, v).then(function(){ _lsSet(COPY_PREFIX + k, "1"); }, function(){});
      }
    });
    return;
  }
  if(SUPPORTED()){
    idbSetItem(k, v).then(function(){ _lsSet(COPY_PREFIX + k, "1"); }, function(){});
  }
}
/* 纯 IDB 读取（不回退 localStorage），供 cleanup 验证落盘用 */
function getIdbOnly(key){
  var k = String(key);
  if(!SUPPORTED()) return Promise.resolve(null);
  return _tx("readonly", function(s){ return s.get(k); }).then(function(rec){
    return (rec && rec.v !== undefined && rec.v !== null)? rec.v: null;
  }, function(){ return null; });
}
/* 启动时预热：把已复制到 IDB/文件层的大键读回内存镜像（异步，不阻塞 UI）。 */
function warmCache(){
  if(!SUPPORTED() && !fileOK()) return Promise.resolve(0);
  var chain = Promise.resolve(), n = 0;
  if(SUPPORTED()){
    var keys = _lsKeys().filter(function(k){ return k.indexOf(COPY_PREFIX) === 0; })
      .map(function(k){ return k.slice(COPY_PREFIX.length); });
    keys.forEach(function(k){
      chain = chain.then(function(){
        return getIdbOnly(k).then(function(v){ if(v != null){ MEM[k] = v; n++; } }, function(){});
      });
    });
  }
  if(fileOK()){
    var fkeys = _lsKeys().filter(function(k){ return k.indexOf(FILE_PREFIX) === 0; })
      .map(function(k){ return k.slice(FILE_PREFIX.length); });
    fkeys.forEach(function(k){
      chain = chain.then(function(){
        return NDFILE.getItem(k).then(function(v){ if(v != null){ MEM[k] = v; n++; } }, function(){});
      });
    });
  }
  return chain.then(function(){ return n; });
}
/* 手动释放：删除 localStorage 里已确认落盘 IDB 的大键副本（返回释放字节数）。内存镜像保留，同步读取不受影响。 */
function cleanupCopied(){
  if(!SUPPORTED()) return Promise.resolve({freed: 0, count: 0, reason: "no-idb"});
  var keys = _lsKeys().filter(function(k){ return k.indexOf(COPY_PREFIX) === 0; })
    .map(function(k){ return k.slice(COPY_PREFIX.length); });
  var freed = 0, count = 0, chain = Promise.resolve();
  keys.forEach(function(k){
    chain = chain.then(function(){
      return getIdbOnly(k).then(function(v){
        if(v == null) return; /* IDB 没这份，不删 */
        var cur = _lsGet(k);
        if(cur != null){ freed += cur.length; _lsDel(k); count++; }
        MEM[k] = v;
      }, function(){});
    });
  });
  return chain.then(function(){ return {freed: freed, count: count}; });
}
/* 已复制到 IDB 的大键数量（供存储页展示） */
function copiedCount(){
  return _lsKeys().filter(function(k){ return k.indexOf(COPY_PREFIX) === 0; }).length;
}
/* 清空全部：删 IDB 整库 + 文件层全部文件 + MEM + 各类标记。
 * localStorage 的 nd_ 业务键由调用方（wipeAll）清理。
 * v36: 文件层改用 NDFILE.clearAll() 直接清空目录，不再依赖 nd_fileidx_ 标记反推
 * （调用方可能先删了 localStorage 导致标记丢失，旧逻辑会留下孤儿文件）。 */
function wipeAll(){
  try{ for(var k in MEM){ delete MEM[k]; } }catch(e){}
  var pending = [];
  /* 文件层：直接清空整个 ndblob 目录，不依赖标记 */
  if(fileOK()){
    pending.push(NDFILE.clearAll().then(function(){}, function(){}));
  }
  try{
    _lsKeys().forEach(function(k){
      if(k.indexOf(FILE_PREFIX) === 0 || k.indexOf(IDX_PREFIX) === 0 ||
         k.indexOf(COPY_PREFIX) === 0 || k === MARK_KEY) _lsDel(k);
    });
  }catch(e){}
  var idbDone = Promise.resolve();
  if(SUPPORTED()){
    try{
      idbDone = new Promise(function(resolve){
        var req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = function(){ resolve(); };
        req.onerror = function(){ resolve(); };
        req.onblocked = function(){ resolve(); };
      });
    }catch(e){}
  }
  return Promise.all(pending.concat([idbDone])).then(function(){ return true; });
}

/* 估算 IDB 用量（字节）。无 navigator.storage.estimate 时返回 null，Node 下不报错。 */
function idbBytes(){
  try{
    var nav = (typeof navigator !== "undefined") ? navigator : null;
    if(nav && nav.storage && typeof nav.storage.estimate === "function"){
      return Promise.resolve(nav.storage.estimate()).then(function(r){
        return (r && typeof r.usage === "number") ? r.usage : null;
      }, function(){ return null; });
    }
  }catch(e){}
  return null;
}

/* 文件层总字节数（同步；无桥接返回 -1）。供存储页展示。 */
function fileBytes(){
  try{
    if(typeof NDFILE !== "undefined" && NDFILE &&
       typeof NDFILE.totalBytes === "function") return NDFILE.totalBytes();
  }catch(e){}
  return -1;
}
/* 文件层键数量（供存储页展示） */
function fileCount(){
  try{
    if(typeof NDFILE !== "undefined" && NDFILE &&
       typeof NDFILE.listKeys === "function") return NDFILE.listKeys().length;
  }catch(e){}
  return 0;
}

return {
  SUPPORTED: SUPPORTED,
  BIG_PREFIXES: BIG_PREFIXES,
  MIGRATE_VERSION: MIGRATE_VERSION,
  MARK_KEY: MARK_KEY,
  IDX_PREFIX: IDX_PREFIX,
  FILE_PREFIX: FILE_PREFIX,
  BIG_MIN_BYTES: BIG_MIN_BYTES,
  FILE_MIN_BYTES: FILE_MIN_BYTES,
  isBigKey: isBigKey,
  getItemAsync: getItemAsync,
  setItemAsync: setItemAsync,
  removeItemAsync: removeItemAsync,
  migrate: migrate,
  idbBytes: idbBytes,
  fileBytes: fileBytes,
  fileCount: fileCount,
  cacheGet: cacheGet,
  cacheSet: cacheSet,
  getSync: getSync,
  getSyncStrict: getSyncStrict,
  hasFileKey: hasFileKey,
  evictFile: evictFile,
  syncBig: syncBig,
  warmCache: warmCache,
  cleanupCopied: cleanupCopied,
  copiedCount: copiedCount,
  wipeAll: wipeAll
};
})();
