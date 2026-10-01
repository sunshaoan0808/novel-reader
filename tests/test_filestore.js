const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 回归: 本地存储 2GB —— 原生文件层(NDFILE) + store.js 文件层路由
// 1) 无桥接时 NDFILE 全部降级(不支持/空)，store.js 走老路径(IDB/localStorage)
// 2) 有桥接时 >256KB 大值走文件：写读删、FILE 标记、localStorage 副本释放、MEM 镜像
// 3) 值缩小到阈值下 / 删除时，文件层正确清理
// 4) 文件层配额满/IO 失败时回退 IDB 路径，不丢数据
// 5) warmCache 能从文件层预热 MEM
function mkLS(){
const m = {};
return {m,
getItem: k => (k in m ? m[k] : null),
setItem: (k, v) => { m[k] = String(v); },
removeItem: k => { delete m[k]; },
key: i => Object.keys(m)[i] || null,
get length(){ return Object.keys(m).length; }};
}
/* 假原生桥接：语义与 MainActivity.ndFile* 一致（写返回 ok/err:quota，读不到返回 null） */
function makeBridge(quota){
const files = {};
let total = 0;
const bytes = s => Buffer.byteLength(s || "", "utf8");
return {
ndFileWrite(name, text){
const b = bytes(text), old = (name in files) ? bytes(files[name]) : 0;
if(total - old + b > quota) return "err:quota";
total = total - old + b;
files[name] = String(text == null ? "" : text);
return "ok";
},
ndFileRead(name){ return (name in files) ? files[name] : null; },
ndFileDelete(name){ if(name in files){ total -= bytes(files[name]); delete files[name]; } return true; },
ndFileSize(name){ return (name in files) ? bytes(files[name]) : -1; },
ndFileTotal(){ return total; },
ndFileList(){ return JSON.stringify(Object.keys(files)); },
ndFileClear(){ for(const k in files){ total -= bytes(files[k]); delete files[k]; } return true; },
_files: files
};
}
function mkCtx(extra){
const ls = mkLS();
const ctx = Object.assign({localStorage: ls, console,
setTimeout: (fn)=>{ try{ fn(); }catch(e){} return 0; }, clearTimeout(){},
navigator: {}}, extra || {});
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["rp/filestore.js", "rp/store.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
return {ctx, ls, run: (code)=> vm.runInContext(code, ctx)};
}
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

(async ()=>{
// ---------- 1) 无桥接降级 ----------
{
const {run} = mkCtx();
t("无桥接 SUPPORTED false", run("NDFILE.SUPPORTED()") === false);
t("无桥接 QUOTA 仍为 2GB", run("NDFILE.QUOTA") === 2*1024*1024*1024);
let err = null;
try{ await run("NDFILE.setItem('a','b')"); }catch(e){ err = e; }
t("无桥接 setItem 拒绝 no-bridge", err && err.message === "no-bridge");
t("无桥接 getItem 得 null", await run("NDFILE.getItem('a')") === null);
t("无桥接 totalBytes -1", run("NDFILE.totalBytes()") === -1);
t("无桥接 listKeys 空", JSON.stringify(run("NDFILE.listKeys()")) === "[]");
t("无桥接 store.fileBytes -1", run("RP_STORE.fileBytes()") === -1);
t("无桥接 store.fileCount 0", run("RP_STORE.fileCount()") === 0);
// store 老路径：Node 无 IDB → localStorage 回退
await run("RP_STORE.setItemAsync('nd_chat_r1_x','hello')");
t("无桥接 setItemAsync 回退 localStorage", run("localStorage.getItem('nd_chat_r1_x')") === "hello");
t("无桥接 getItemAsync 读回", await run("RP_STORE.getItemAsync('nd_chat_r1_x')") === "hello");
}

// ---------- 2) 有桥接：NDFILE 基本读写 ----------
const bridge = makeBridge(2*1024*1024*1024);
const s2 = mkCtx({Android: bridge});
{
const {run} = s2;
t("有桥接 SUPPORTED true", run("NDFILE.SUPPORTED()") === true);
const big = "x".repeat(300*1024);
t("setItem ok", await run(`NDFILE.setItem('k1','${"x".repeat(100)}')`) === "ok");
t("getItem 读回", await run("NDFILE.getItem('k1')") === "x".repeat(100));
t("getItem  miss 得 null", await run("NDFILE.getItem('nope')") === null);
t("totalBytes>0", run("NDFILE.totalBytes()") > 0);
t("listKeys 含 k1", run("NDFILE.listKeys()").indexOf("k1") >= 0);
t("removeItem", await run("NDFILE.removeItem('k1')") === true);
t("删后读不到", await run("NDFILE.getItem('k1')") === null);
t("删后 totalBytes 回 0", run("NDFILE.totalBytes()") === 0);
}

// ---------- 3) 配额满拒绝 ----------
{
const tiny = makeBridge(50);
const {run} = mkCtx({Android: tiny});
let err = null;
try{ await run("NDFILE.setItem('q','" + "y".repeat(100) + "')"); }catch(e){ err = e; }
t("超配额拒绝 quota", err && err.message === "quota");
}

// ---------- 4) store.js 文件层路由 ----------
{
const {run, ls} = s2;
const K = "nd_chat_r1_big";
const big = "z".repeat(300*1024); // >256KB，走文件层
ls.setItem(K, big); // 模拟调用方先写 localStorage（saveHist 行为）
run(`RP_STORE.syncBig('${K}', '${"z".repeat(300*1024).slice(0,10)}'.padEnd(307200,'z'))`);
await new Promise(r=>setTimeout(r, 20));
t("syncBig 大值 MEM 镜像", run(`RP_STORE.cacheGet('${K}')`).length === 300*1024);
t("syncBig 大值记 FILE 标记", ls.getItem("nd_fileidx_"+K) === "1");
t("syncBig 大值释放 localStorage 副本", ls.getItem(K) === null);
t("syncBig 大值文件层有数据", bridge._files[K] && bridge._files[K].length === 300*1024);
t("getItemAsync 从文件读回", (await run(`RP_STORE.getItemAsync('${K}')`)).length === 300*1024);

// 直接 setItemAsync 大值（壁纸路径）
const W = "nd_wallpaper_test";
await run(`RP_STORE.setItemAsync('${W}', '${"w".repeat(300*1024).slice(0,10)}'.padEnd(307200,'w'))`);
t("setItemAsync 大值走文件", bridge._files[W] && bridge._files[W].length === 300*1024);
t("setItemAsync 大值记 FILE 标记", ls.getItem("nd_fileidx_"+W) === "1");
t("setItemAsync 大值无 localStorage 副本", ls.getItem(W) === null);
t("store.fileBytes>0", run("RP_STORE.fileBytes()") > 0);
t("store.fileCount 计数", run("RP_STORE.fileCount()") >= 2); // K 与 W 两个文件

// 小值不走文件（Node 无 IDB → localStorage）
await run("RP_STORE.setItemAsync('nd_chat_r1_small','hi')");
t("小值不走文件", !("nd_chat_r1_small" in bridge._files));
t("小值落 localStorage", ls.getItem("nd_chat_r1_small") === "hi");

// 值缩小：撤下文件层
await run(`RP_STORE.setItemAsync('${K}','small')`);
t("缩小后文件删除", !(K in bridge._files));
t("缩小后标记清除", ls.getItem("nd_fileidx_"+K) === null);
t("缩小后小值落 localStorage", ls.getItem(K) === "small");

// 删除清文件层
await run(`RP_STORE.setItemAsync('${W}', '${"w".repeat(300*1024).slice(0,10)}'.padEnd(307200,'w'))`);
await run(`RP_STORE.removeItemAsync('${W}')`);
t("删除后文件清除", !(W in bridge._files));
t("删除后标记清除", ls.getItem("nd_fileidx_"+W) === null);

// warmCache 从文件预热
const WC = "nd_chat_r1_warm";
const wv = "v".repeat(300*1024);
bridge.ndFileWrite(WC, wv);
ls.setItem("nd_fileidx_"+WC, "1");
t("预热前 MEM 为空", run(`RP_STORE.cacheGet('${WC}')`) === null);
await run("RP_STORE.warmCache()");
t("warmCache 从文件预热 MEM", run(`RP_STORE.cacheGet('${WC}')`).length === 300*1024);
await run(`RP_STORE.removeItemAsync('${WC}')`);
}

// ---------- 5) 文件层失败回退 IDB（Node→localStorage），不丢数据 ----------
{
const tiny = makeBridge(10); // 写啥都超配额
const {run, ls} = mkCtx({Android: tiny});
const K = "nd_chat_r1_fb";
const big = "f".repeat(300*1024);
await run(`RP_STORE.setItemAsync('${K}', '${"f".repeat(10)}'.padEnd(307200,'f'))`);
t("配额满回退：localStorage 有值", ls.getItem(K) && ls.getItem(K).length === 300*1024);
t("配额满回退：无 FILE 标记", ls.getItem("nd_fileidx_"+K) === null);
t("配额满回退：读回一致", (await run(`RP_STORE.getItemAsync('${K}')`)).length === 300*1024);
}

// ---------- 6) 中等大值（64KB~256KB）仍走 IDB 路径，不碰文件 ----------
{
const {run, ls} = s2;
const K = "nd_chat_r1_mid";
const mid = "m".repeat(100*1024);
ls.setItem(K, mid);
run(`RP_STORE.syncBig('${K}', '${"m".repeat(10)}'.padEnd(102400,'m'))`);
await new Promise(r=>setTimeout(r, 20));
t("中等值不进文件层", !(K in bridge._files));
t("中等值无 FILE 标记", ls.getItem("nd_fileidx_"+K) === null);
t("中等值 MEM 镜像", run(`RP_STORE.cacheGet('${K}')`).length === 100*1024);
}

// ---------- 7) wipeAll 清干净文件层 ----------
{
const {run, ls} = s2;
const K = "nd_chat_r1_wipe";
await run(`RP_STORE.setItemAsync('${K}', '${"w".repeat(10)}'.padEnd(307200,'w'))`);
t("wipe 前文件存在", (K in bridge._files));
t("wipe 前标记存在", ls.getItem("nd_fileidx_"+K) === "1");
t("wipe 前 MEM 存在", run(`RP_STORE.cacheGet('${K}')`) !== null);
const ok = await run("RP_STORE.wipeAll()");
t("wipeAll 返回 true", ok === true);
t("wipe 后文件清除", !(K in bridge._files));
t("wipe 后标记清除", ls.getItem("nd_fileidx_"+K) === null);
t("wipe 后 MEM 清除", run(`RP_STORE.cacheGet('${K}')`) === null);
t("wipe 后读不到", await run(`RP_STORE.getItemAsync('${K}')`) === null);
}
{
const {run} = mkCtx(); // 无桥接
t("无桥接 wipeAll 不抛错", await run("RP_STORE.wipeAll()") === true);
}

// ---------- 8) v36: 冷启动同步补读 / evictFile / wipeAll 不依赖标记 ----------
{
// 8a) getItemSync：桥接同步读
const {run} = s2;
await run(`NDFILE.setItem('synck','hello-sync')`);
t("getItemSync 同步读到", run(`NDFILE.getItemSync('synck')`) === "hello-sync");
t("getItemSync 读不到返回 null", run(`NDFILE.getItemSync('no-such-key')`) === null);
await run(`NDFILE.removeItem('synck')`);
}
{
// 8b) 冷启动：MEM 为空、未跑 warmCache，getSync 仍能读到文件层大值
const bridgeB = makeBridge(2*1024*1024*1024);
const c1 = mkCtx({Android: bridgeB});
const K = "nd_chat_r1_coldstart";
const big = "v".repeat(300*1024);
await c1.run(`RP_STORE.setItemAsync('${K}', '${"v".repeat(100)}'.padEnd(307200,'v'))`);
t("8b 写入走文件层", bridgeB._files[K] !== undefined && c1.ls.getItem("nd_fileidx_"+K) === "1");
// 模拟重启：全新 JS 上下文（MEM 空），localStorage 共享，桥接文件共享
const c2 = mkCtx({Android: bridgeB});
Object.assign(c2.ls.m, c1.ls.m);
t("8b 冷启动 MEM 为空", c2.run(`RP_STORE.cacheGet('${K}')`) === null);
t("8b getSync 同步补读文件层", c2.run(`RP_STORE.getSync('${K}')`) === big);
t("8b 补读后 MEM 有值", c2.run(`RP_STORE.cacheGet('${K}')`) === big);
}
{
// 8c) evictFile：值缩小后旧文件不再"复活"
const bridgeC = makeBridge(2*1024*1024*1024);
const c3 = mkCtx({Android: bridgeC});
const K = "nd_chat_r1_shrink";
await c3.run(`RP_STORE.setItemAsync('${K}', '${"w".repeat(100)}'.padEnd(307200,'w'))`);
c3.run(`localStorage.setItem('${K}','"small-new"')`); // saveHist 先写 localStorage 新小值
c3.run(`RP_STORE.cacheSet('${K}','"small-new"')`); // saveHist 同步更新 MEM
c3.run(`RP_STORE.evictFile('${K}')`);
t("8c 旧文件已删", bridgeC._files[K] === undefined);
t("8c 标记已删", c3.ls.getItem("nd_fileidx_"+K) === null);
t("8c getSync 读到新小值而非旧文件", c3.run(`RP_STORE.getSync('${K}')`) === "\"small-new\"");
}
{
// 8d) wipeAll：标记先被删光也能清掉原生文件（孤儿文件回归）
const bridgeD = makeBridge(2*1024*1024*1024);
const c4 = mkCtx({Android: bridgeD});
const K = "nd_chat_r1_orphan";
await c4.run(`RP_STORE.setItemAsync('${K}', '${"o".repeat(100)}'.padEnd(307200,'o'))`);
t("8d 写入走文件层", bridgeD._files[K] !== undefined);
// 模拟旧版调用方先删光 localStorage（含标记）
for(const k of Object.keys(c4.ls.m)) c4.ls.removeItem(k);
t("8d 标记已被删光", c4.ls.getItem("nd_fileidx_"+K) === null);
await c4.run(`RP_STORE.wipeAll()`);
t("8d 无标记 wipeAll 仍清掉文件", Object.keys(bridgeD._files).length === 0);
}
{
// 8e) NDFILE.clearAll 直接清空
const bridgeE = makeBridge(2*1024*1024*1024);
const c5 = mkCtx({Android: bridgeE});
await c5.run(`NDFILE.setItem('a','1')`);
await c5.run(`NDFILE.setItem('b','2')`);
t("8e clearAll 返回 true", await c5.run(`NDFILE.clearAll()`) === true);
t("8e 文件全清", Object.keys(bridgeE._files).length === 0);
}

console.log(`test_filestore: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("ERROR:", e && e.message); process.exit(1); });
