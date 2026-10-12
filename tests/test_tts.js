const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1-1: TTS 语音气泡
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false, tagName: "",
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
}
const els = {};
const created = [];
const idReg = {};
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
key: i => Object.keys(store)[i] || null,
get length(){ return Object.keys(store).length; },
};
const document = {
body: mkEl(),
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => {
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: () => [],
createElement: tag => {
const e = mkEl(); e.tagName = tag; created.push(e);
let _id = "";
Object.defineProperty(e, "id", {get: ()=>_id, set: v=>{ _id = v; idReg[v] = e; }});
return e;
},
};
const DATA = {
index: [{run_id: "r1", novel: "红楼梦", characters: ["林黛玉"], n_chunks: 1}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "林黛玉", fields: {}}]},
};
const alerts = [];
const ctx = {localStorage, document, console,
alert(m){ alerts.push(String(m)); }, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/traverse.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- 时长估算 ----
t("estDur空文本保底2s", vm.runInContext("ttsEstDur('')", ctx) === 2);
t("estDur短文本保底2s", vm.runInContext("ttsEstDur('你好')", ctx) === 2);
t("estDur 10字=3s", vm.runInContext("ttsEstDur('一二三四五六七八九十')", ctx) === 3);
t("estDur 40字=10s", vm.runInContext("ttsEstDur('一'.repeat(40))", ctx) === 10);
// ---- 时长格式化 ----
t("fmtDur 0", vm.runInContext("fmtDur(0)", ctx) === "0:00");
t("fmtDur 9", vm.runInContext("fmtDur(9)", ctx) === "0:09");
t("fmtDur 65", vm.runInContext("fmtDur(65)", ctx) === "1:05");
t("fmtDur 600", vm.runInContext("fmtDur(600)", ctx) === "10:00");
// ---- 图标存在 ----
t("play图标", vm.runInContext("icon('play',13)", ctx).indexOf("<svg") === 0);
t("pause图标", vm.runInContext("icon('pause',13)", ctx).indexOf("<svg") === 0);
// ---- ttsAuto 默认关, 可保存 ----
t("ttsAuto默认false", vm.runInContext("getRpCfg().ttsAuto", ctx) === false);
vm.runInContext("saveRpCfg(Object.assign(getRpCfg(),{ttsAuto:true}))", ctx);
t("ttsAuto保存后true", vm.runInContext("getRpCfg().ttsAuto", ctx) === true);
vm.runInContext("saveRpCfg(Object.assign(getRpCfg(),{ttsAuto:false}))", ctx);
// ---- ttsKey ----
vm.runInContext(`CHAT = {mode:"single", runId:"r1", name:"林黛玉", members:[]}`, ctx);
t("ttsKey格式", vm.runInContext("ttsKey(3)", ctx) === "nd_chat_r1_林黛玉#3");
// ---- 语音气泡 HTML ----
const bub = vm.runInContext(`voiceBubbleHTML(1, {role:"assistant", content:"你好世界"})`, ctx);
t("气泡有voicebub类", bub.indexOf("voicebub") >= 0);
t("气泡有进度条id", bub.indexOf('id="vbfg-1"') >= 0);
t("气泡有图标id", bub.indexOf('id="vbico-1"') >= 0);
t("气泡有时长", bub.indexOf("0:02") >= 0);
t("气泡调ttsMsg", bub.indexOf("ttsMsg(1)") >= 0);
// ---- 无 TTS 配置、无本地语音: 提示去设置 ----
const HKEY = "nd_chat_r1_林黛玉";
store[HKEY] = JSON.stringify([{role:"user", content:"hi", ts:1},{role:"assistant", content:"姑娘好", ts:2}]);
(async ()=>{
await vm.runInContext("ttsMsg(1)", ctx);
t("无配置时alert提示", alerts.some(a=>a.indexOf("设置")>=0));
t("无配置时不进入播放态", vm.runInContext("TTS_PLAY===null", ctx) === true);
console.log(`tts: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})();
