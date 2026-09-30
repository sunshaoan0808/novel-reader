// test_store_int.js: 存储 P2 集成点（复制模式迁移 / 缓存 / 双写 / 手动清理）
// Node 下无 indexedDB：覆盖 no-idb 回退路径与内存镜像行为
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const ctx = {console};
const ls = (function(){ const m={}; return {
getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
ctx.localStorage = ls;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/store.js", "utf8"), ctx);
const S = vm.runInContext("RP_STORE", ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c? pass++: (fail++, console.log("FAIL:", n)); };
const tests = [];

(async ()=>{
  t("no-idb被检测", S.SUPPORTED() === false);
  t("isBigKey", S.isBigKey("nd_chat_abc") && !S.isBigKey("nd_cfg"));

  // migrate 无 IDB 时跳过
  const mr = await S.migrate();
  t("migrate无IDB跳过", mr.skipped === true && mr.reason === "no-idb");

  // 缓存读写
  S.cacheSet("nd_chat_x", "[1,2,3]");
  t("cacheSet/cacheGet", S.cacheGet("nd_chat_x") === "[1,2,3]");
  t("cacheGet未命中", S.cacheGet("nd_chat_nope") === null);

  // syncBig 无 IDB 时静默（不抛错），但内存镜像要写
  const big = "x".repeat(S.BIG_MIN_BYTES + 10);
  S.syncBig("nd_chat_y", big);
  t("syncBig内存镜像", S.cacheGet("nd_chat_y") === big);
  S.syncBig("nd_cfg", "small"); // 非大键：不写镜像
  t("syncBig非大键跳过", S.cacheGet("nd_cfg") === null);

  // cleanupCopied 无 IDB
  const cr = await S.cleanupCopied();
  t("cleanup无IDB", cr.reason === "no-idb");

  // copiedCount
  t("copiedCount初始0", S.copiedCount() === 0);

  // warmCache 无 IDB
  const w = await S.warmCache();
  t("warmCache无IDB", w === 0);

  // getItemAsync 回退 localStorage
  ls.setItem("nd_chat_z", "hello");
  const g = await S.getItemAsync("nd_chat_z");
  t("getItemAsync回退LS", g === "hello");

  // 复制模式语义：migrate 成功后（mock 有 IDB 时）不删 LS。这里验证标记常量存在
  t("暴露新API", ["cacheGet","cacheSet","syncBig","warmCache","cleanupCopied","copiedCount"]
    .every(k=>typeof S[k] === "function"));

  console.log(`store_int: ${pass} pass, ${fail} fail`);
  process.exit(fail? 1: 0);
})();
