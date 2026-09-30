const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P2: IndexedDB 存储适配层
function makeLS(){
  const store = {};
  const ls = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] != null ? Object.keys(store)[i] : null,
    _store: store,
  };
  Object.defineProperty(ls, "length", {get: () => Object.keys(store).length});
  return ls;
}
/* 最小 fake indexedDB：同步触发 handler，内存 Map 做后端 */
function makeFakeIDB(){
  const map = new Map();
  const db = {
    objectStoreNames: {contains: () => true},
    createObjectStore(){},
    transaction(){
      return { objectStore(){
        return {
          get(k){ return mkReq(map.has(k) ? {k, v: map.get(k)} : undefined); },
          put(rec){ map.set(rec.k, rec.v); return mkReq(undefined); },
          delete(k){ map.delete(k); return mkReq(undefined); },
        };
      }};
    }
  };
  function mkReq(result){
    const r = {result, error: null};
    let okH = null, errH = null;
    Object.defineProperty(r, "onsuccess", {
      get: () => okH,
      set(fn){ okH = fn; if(typeof fn === "function") fn({target: r}); }
    });
    Object.defineProperty(r, "onerror", {
      get: () => errH, set(fn){ errH = fn; }
    });
    return r;
  }
  return {
    _map: map,
    open(){
      const r = {result: db, error: null};
      Object.defineProperty(r, "onupgradeneeded", {
        get: () => null,
        set(fn){ if(typeof fn === "function") fn({target: r}); }
      });
      Object.defineProperty(r, "onsuccess", {
        get: () => null,
        set(fn){ if(typeof fn === "function") fn({target: r}); }
      });
      Object.defineProperty(r, "onerror", {get: () => null, set(){}});
      Object.defineProperty(r, "onblocked", {get: () => null, set(){}});
      return r;
    }
  };
}
function loadModule(extra){
  const ls = makeLS();
  const ctx = Object.assign({localStorage: ls, console}, extra || {});
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WWW + "/rp/store.js", "utf8"), ctx, {filename: "store.js"});
  return {ctx, ls, E: c => vm.runInContext(c, ctx)};
}
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

async function main(){
// ---- 无 IDB 环境：全部走 localStorage 回退 ----
{
  const {ls, E} = loadModule();
  t("无IDB时SUPPORTED为false", E("RP_STORE.SUPPORTED()") === false);
  t("isBigKey单聊", E('RP_STORE.isBigKey("nd_chat_x")') === true);
  t("isBigKey群聊", E('RP_STORE.isBigKey("nd_group_abc")') === true);
  t("isBigKey穿越", E('RP_STORE.isBigKey("nd_travchat_x")') === true);
  t("isBigKey导入卡", E('RP_STORE.isBigKey("nd_imported_cards")') === true);
  t("isBigKey自定义角色", E('RP_STORE.isBigKey("nd_custom_chars")') === true);
  t("isBigKey写卡草稿", E('RP_STORE.isBigKey("nd_cw_d1")') === true);
  t("isBigKey普通键false", E('RP_STORE.isBigKey("nd_rp_cfg_v1")') === false);
  t("isBigKey空串false", E('RP_STORE.isBigKey("")') === false);
  await E('RP_STORE.setItemAsync("k1","v1")');
  t("回退set写localStorage", ls._store["k1"] === "v1");
  t("回退get读localStorage", await E('RP_STORE.getItemAsync("k1")') === "v1");
  t("回退get缺失返回null", await E('RP_STORE.getItemAsync("nope")') === null);
  await E('RP_STORE.removeItemAsync("k1")');
  t("回退remove删localStorage", !("k1" in ls._store)
    && await E('RP_STORE.getItemAsync("k1")') === null);
  ls.setItem("nd_chat_big", "x".repeat(70000));
  const m = await E("RP_STORE.migrate()");
  t("无IDB时migrate返回no-idb", m.moved === 0 && m.skipped === true && m.reason === "no-idb");
  t("无IDB时migrate不删数据", ls._store["nd_chat_big"].length === 70000
    && !("nd_store_v" in ls._store));
  t("无navigator时idbBytes为null", E("RP_STORE.idbBytes()") === null);
}
// ---- fake IDB：读写走 IDB ----
{
  const fake = makeFakeIDB();
  const {ls, E} = loadModule({indexedDB: fake});
  t("有IDB时SUPPORTED为true", E("RP_STORE.SUPPORTED()") === true);
  await E('RP_STORE.setItemAsync("nd_chat_a","hello")');
  t("set写入IDB", fake._map.get("nd_chat_a") === "hello");
  t("set留索引标记", ls._store["nd_idbidx_nd_chat_a"] === "1");
  t("get从IDB读", await E('RP_STORE.getItemAsync("nd_chat_a")') === "hello");
  ls.setItem("plain_small", "pv");
  t("IDB未命中回退读LS", await E('RP_STORE.getItemAsync("plain_small")') === "pv");
  await E('RP_STORE.removeItemAsync("nd_chat_a")');
  t("remove删IDB数据", !fake._map.has("nd_chat_a"));
  t("remove清索引标记", !("nd_idbidx_nd_chat_a" in ls._store));
  t("remove后get为null", await E('RP_STORE.getItemAsync("nd_chat_a")') === null);
}
// ---- fake IDB：migrate 迁移 ----
{
  const fake = makeFakeIDB();
  const big1 = "x".repeat(70000), big2 = "w".repeat(66000);
  async function runMig(){
    const m2 = loadModule({indexedDB: fake});
    const ls2 = m2.ls;
    ls2.setItem("nd_chat_big", big1);
    ls2.setItem("nd_cw_d1", big2);
    ls2.setItem("nd_group_small", "y".repeat(100));
    ls2.setItem("nd_other_big", "z".repeat(70000));
    const calls = [];
    m2.ctx.__prog = calls;
    const res = await m2.E("RP_STORE.migrate(function(p){ __prog.push({done:p.done,total:p.total,moved:p.moved}); })");
    return {m2, ls2, calls, res};
  }
  const {m2, ls2, calls, res} = await runMig();
  t("migrate复制2个大键", res.moved === 2 && res.skipped === false);
  t("migrate复制模式保留原键", ("nd_chat_big" in ls2._store) && ("nd_cw_d1" in ls2._store));
  t("migrate写复制标记", ls2._store["nd_idbcopied_nd_chat_big"] === "1"
    && ls2._store["nd_idbcopied_nd_cw_d1"] === "1");
  t("migrate留索引标记", ls2._store["nd_idbidx_nd_chat_big"] === "1"
    && ls2._store["nd_idbidx_nd_cw_d1"] === "1");
  t("migrate数据进IDB", fake._map.get("nd_chat_big") === big1 && fake._map.get("nd_cw_d1") === big2);
  t("migrate后getItemAsync可读", await m2.E('RP_STORE.getItemAsync("nd_chat_big")') === big1);
  t("小键不动", ls2._store["nd_group_small"] === "y".repeat(100));
  t("非大键大体积不动", ls2._store["nd_other_big"] === "z".repeat(70000)
    && !fake._map.has("nd_other_big"));
  t("migrate写版本标记", ls2._store["nd_store_v"] === "1");
  t("onProgress被调用", calls.length > 0 && calls[calls.length-1].moved === 2);
  const r3 = await m2.E("RP_STORE.migrate()");
  t("migrate幂等第二次moved=0", r3.moved === 0 && r3.skipped === true);
}
// ---- fake IDB：cleanupCopied 只删已落盘的 ----
{
  const fake = makeFakeIDB();
  const {ls, E} = loadModule({indexedDB: fake});
  const big = "q".repeat(70000);
  ls.setItem("nd_chat_c1", big);
  await E('RP_STORE.migrate()'); /* 复制模式：LS 保留 + 标记 */
  t("cleanup前LS保留", ls._store["nd_chat_c1"] === big);
  const r = await E('RP_STORE.cleanupCopied()');
  t("cleanup删LS副本", !("nd_chat_c1" in ls._store));
  t("cleanup返回释放字节", r.count === 1 && r.freed === big.length);
  t("cleanup后内存镜像可读", await E('RP_STORE.cacheGet("nd_chat_c1")') === big);
  /* 有复制标记但 IDB 无数据：不删 */
  ls.setItem("nd_idbcopied_nd_chat_c2", "1");
  ls.setItem("nd_chat_c2", "v2");
  const r2 = await E('RP_STORE.cleanupCopied()');
  t("cleanup不删未落盘的", ls._store["nd_chat_c2"] === "v2" && r2.count === 0);
}
// ---- IDB 抛错：回退 localStorage ----
{
  const {ls, E} = loadModule({indexedDB: {open(){ throw new Error("boom"); }}});
  t("抛错IDB仍算SUPPORTED", E("RP_STORE.SUPPORTED()") === true);
  await E('RP_STORE.setItemAsync("ek","ev")');
  t("抛错时set回退LS", ls._store["ek"] === "ev");
  t("抛错时get回退LS", await E('RP_STORE.getItemAsync("ek")') === "ev");
}
}
main().then(() => {
  console.log(`${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
}).catch(e => {
  console.log("FATAL:", e && e.message);
  console.log(`${pass} pass, ${fail + 1} fail`);
  process.exitCode = 1;
});
