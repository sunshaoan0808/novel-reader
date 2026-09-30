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
"rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "rp/traverse2.js", "app.js"]){
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

// ---------- warmWallpaper: IDB 回填内存 ----------
const wk = run("wallStoreKey()");
idbData[wk] = "data:image/jpeg;base64,BBB";
run("WALL_MEM={}");
await runA("await warmWallpaper()");
t("warmWallpaper: IDB 落盘回填内存", run("WALL_MEM[chatHistKey()]") === "data:image/jpeg;base64,BBB");
t("warmWallpaper: 回填后选中壁纸", run("pickChatBgURL()") === "data:image/jpeg;base64,BBB");

// ---------- saveWallpaper 双写 ----------
await runA('await saveWallpaper("data:image/jpeg;base64,CCC")');
t("saveWallpaper: 内存即时生效", run("pickChatBgURL()") === "data:image/jpeg;base64,CCC");
t("saveWallpaper: IDB 落盘", idbData[run("wallStoreKey()")] === "data:image/jpeg;base64,CCC");

// ---------- clearWallpaperUI 清除 ----------
ctx.alert = ()=>{};
await runA("await clearWallpaperUI()");
t("clearWallpaper: 内存清除", run("WALL_MEM[chatHistKey()]") === "");
t("clearWallpaper: IDB 清除", !(run("wallStoreKey()") in idbData));
t("clearWallpaper: 清除后回退默认", run("pickChatBgURL()") === "bg/chat_night.jpg");

console.log(`wallpaper: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("ERROR:", e.message); process.exit(1); });
