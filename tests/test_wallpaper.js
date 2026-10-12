const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 回归: 聊天壁纸上传/优先级/按聊天隔离
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false,
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
insertAdjacentHTML(){}, setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
}
const els = {};
const ls = (function(){ const m = {}; return {
getItem: k => (k in m? m[k]: null),
setItem: (k, v) => { m[k] = String(v);},
removeItem: k => { delete m[k];},
key: i => Object.keys(m)[i] || null,
get length(){ return Object.keys(m).length;}};})();
const idbData = {};
const RP_STORE = {
  getItemAsync: (k)=>Promise.resolve(k in idbData ? idbData[k] : null),
  setItemAsync: (k,v)=>{ idbData[k]=String(v); return Promise.resolve(); },
  removeItemAsync: (k)=>{ delete idbData[k]; return Promise.resolve(); },
};
const document = {
body: mkEl(),
activeElement: null,
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => {
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: () => [],
createElement: () => mkEl(),
};
const ctx = {localStorage: ls, document, console, RP_STORE,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){},
setInterval: ()=>0, clearInterval(){},
fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "rp/traverse2.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW+"/" + f, "utf8"), ctx, {filename: f});
}
let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n)); };
const run = (code)=> vm.runInContext(code, ctx);
const runA = (code)=> vm.runInContext(`(async()=>{${code}})()`, ctx);

(async ()=>{
// ---------- wallStoreKey 按聊天隔离 ----------
run('CHAT={mode:"single",runId:"r1",name:"林黛玉"}');
const k1 = run("wallStoreKey()");
run('CHAT={mode:"single",runId:"r1",name:"贾宝玉"}');
const k2 = run("wallStoreKey()");
run('CHAT={mode:"group",runId:"r1",members:["林黛玉","贾宝玉"]}');
const k3 = run("wallStoreKey()");
t("wallpaper: 单聊各人 key 不同", k1 !== k2 && k1.indexOf("nd_wallpaper_") === 0);
t("wallpaper: 单聊/群聊 key 不同", k1 !== k3);

// ---------- pickChatBgURL 优先级 ----------
run('CHAT={mode:"single",runId:"r1",name:"林黛玉"}');
run("WALL_MEM={}");
const dflt = run("pickChatBgURL()");
t("wallpaper: 无壁纸无卡 bg 回退默认图", dflt === "bg/chat_night.jpg");
run('WALL_MEM[chatHistKey()]="data:image/jpeg;base64,AAA"');
t("wallpaper: 上传壁纸优先级最高", run("pickChatBgURL()") === "data:image/jpeg;base64,AAA");
run("WALL_MEM={}");

// ---------- warmWallpaper: IDB 回填内存（老版本纯字符串兼容） ----------
const wk = run("wallStoreKey()");
idbData[wk] = "data:image/jpeg;base64,BBB";
run("WALL_MEM={}");
await runA("await warmWallpaper()");
t("warmWallpaper: 老字符串兼容为对象", run("getWallOpts().url") === "data:image/jpeg;base64,BBB");
t("warmWallpaper: 回填后选中壁纸", run("pickChatBgURL()") === "data:image/jpeg;base64,BBB");

// ---------- saveWallpaper 双写（JSON 存 url+dim+blur） ----------
await runA('await saveWallpaper("data:image/jpeg;base64,CCC", {dim:30, blur:6})');
t("saveWallpaper: 内存即时生效", run("pickChatBgURL()") === "data:image/jpeg;base64,CCC");
const saved = JSON.parse(idbData[run("wallStoreKey()")]);
t("saveWallpaper: IDB 落盘带参数", saved.url === "data:image/jpeg;base64,CCC" && saved.dim === 30 && saved.blur === 6);

// ---------- wallFilterCSS ----------
t("filter: 暗度30+模糊6", run('wallFilterCSS({dim:30,blur:6})') === "brightness(0.70) blur(6px)");
t("filter: 全0返回空", run('wallFilterCSS({dim:0,blur:0})') === "");
t("filter: null 返回空", run('wallFilterCSS(null)') === "");
t("filter: 上限钳制", run('wallFilterCSS({dim:99,blur:99})') === "brightness(0.30) blur(12px)");

// ---------- clearWallpaperUI 清除 ----------
ctx.alert = ()=>{};
await runA("await clearWallpaperUI()");
t("clearWallpaper: 内存清除", run("getWallOpts()") === null);
t("clearWallpaper: IDB 清除", !(run("wallStoreKey()") in idbData));
t("clearWallpaper: 清除后回退默认", run("pickChatBgURL()") === "bg/chat_night.jpg");

// ---------- 全局壁纸 ----------
await runA("await saveGlobalWallpaper('data:image/jpeg;base64,GGG', {dim:20, blur:4})");
t("全局壁纸: 内存即时生效", run("pickChatBgURL()") === "data:image/jpeg;base64,GGG");
t("全局壁纸: IDB 落盘", (()=>{ const v = JSON.parse(idbData["nd_wallpaper_global"]||"null");
  return v && v.url === "data:image/jpeg;base64,GGG" && v.dim === 20 && v.blur === 4; })());
await runA("await saveWallpaper('data:image/jpeg;base64,CCC', {dim:0, blur:0})");
t("单聊优先于全局", run("pickChatBgURL()") === "data:image/jpeg;base64,CCC");
t("全局滤镜生效", run("wallFilterCSS(getGlobalWallOpts())") === "brightness(0.80) blur(4px)");
await runA("await clearWallpaperUI()");
t("清除单聊后回退全局", run("pickChatBgURL()") === "data:image/jpeg;base64,GGG");
await runA("await clearGlobalWallpaper()");
t("清除全局后回退默认", run("pickChatBgURL()") === "bg/chat_night.jpg");
await runA("await warmGlobalWall(); await warmGlobalWall();");
t("warmGlobalWall 幂等", run("getGlobalWallOpts()") === null);
run("globalWallpaperEditor()");
t("全局编辑器标题", /全局壁纸/.test(run("titleEl.innerHTML")));
run("wallpaperEditor()");
t("单聊编辑器标题不变", /聊天壁纸/.test(run("titleEl.innerHTML")) && !/全局/.test(run("titleEl.innerHTML")));

console.log(`wallpaper: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("ERROR:", e.message); process.exit(1); });
