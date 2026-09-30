/* RP 存储适配层：大体积数据（角色卡、大聊天历史）走 IndexedDB，
 * localStorage 只留索引；迁移幂等（版本标记）、失败回退 localStorage；
 * 无 IndexedDB 环境（Node 测试）时全部走 localStorage 回退。
 * 浏览器 / Node 双环境兼容：indexedDB / navigator 引用前均有 typeof 守卫。
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
/* 同步读取缓存：IDB 内容的内存镜像，保证 localStorage 副本被手动清理后同步读取仍能命中 */
var MEM = {};
var BIG_MIN_BYTES = 64 * 1024;

/* 大键前缀表：命中即视为候选大体积数据 */
var BIG_PREFIXES = [
  "nd_chat_",          /* 单聊历史 */
  "nd_group_",         /* 群聊历史 */
  "nd_travchat_",      /* 穿越聊天 */
  "nd_imported_cards", /* 导入的角色卡 */
  "nd_custom_chars",   /* 自定义角色 */
  "nd_cw_"             /* 写卡草稿 */
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

/* ---- 对外异步读写：优先 IDB，失败同步回退 localStorage ---- */
function getItemAsync(key){
  var k = String(key);
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

function setItemAsync(key, value){
  var k = String(key), v = String(value);
  if(SUPPORTED()){
    return _tx("readwrite", function(s){ return s.put({k: k, v: v}); }).then(function(){
      _lsSet(IDX_PREFIX + k, "1"); /* localStorage 只留索引标记 */
    }, function(){
      _lsSet(k, v); /* IDB 抛错：同步回退 localStorage */
    });
  }
  _lsSet(k, v);
  return Promise.resolve();
}

function removeItemAsync(key){
  var k = String(key);
  _lsDel(IDX_PREFIX + k); /* 索引标记一并清除 */
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
/* 大键双写：localStorage 写入后，若值超过阈值则异步同步一份到 IDB（失败静默，读走 localStorage）。 */
function syncBig(key, value){
  var k = String(key), v = (value == null)? "": String(value);
  if(!isBigKey(k) || v.length <= BIG_MIN_BYTES) return;
  MEM[k] = v;
  if(SUPPORTED()){
    setItemAsync(k, v).then(function(){ _lsSet(COPY_PREFIX + k, "1"); }, function(){});
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
/* 启动时预热：把已复制到 IDB 的大键读回内存镜像（异步，不阻塞 UI）。 */
function warmCache(){
  if(!SUPPORTED()) return Promise.resolve(0);
  var keys = _lsKeys().filter(function(k){ return k.indexOf(COPY_PREFIX) === 0; })
    .map(function(k){ return k.slice(COPY_PREFIX.length); });
  var chain = Promise.resolve(), n = 0;
  keys.forEach(function(k){
    chain = chain.then(function(){
      return getIdbOnly(k).then(function(v){ if(v != null){ MEM[k] = v; n++; } }, function(){});
    });
  });
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

return {
  SUPPORTED: SUPPORTED,
  BIG_PREFIXES: BIG_PREFIXES,
  MIGRATE_VERSION: MIGRATE_VERSION,
  MARK_KEY: MARK_KEY,
  IDX_PREFIX: IDX_PREFIX,
  BIG_MIN_BYTES: BIG_MIN_BYTES,
  isBigKey: isBigKey,
  getItemAsync: getItemAsync,
  setItemAsync: setItemAsync,
  removeItemAsync: removeItemAsync,
  migrate: migrate,
  idbBytes: idbBytes,
  cacheGet: cacheGet,
  cacheSet: cacheSet,
  syncBig: syncBig,
  warmCache: warmCache,
  cleanupCopied: cleanupCopied,
  copiedCount: copiedCount
};
})();
