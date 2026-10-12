const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P0-4: 新手引导 + 空状态 CTA
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
getElementById: id => {
// onboard 走真实语义: 不存在返回 null
if(id === "onboard") return idReg[id] || null;
return els[id] || (els[id] = mkEl());
},
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
index: [],
runs: {},
rp_cards: {},
};
const ctx = {localStorage, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){}, fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/traverse.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);
vm.runInContext("INDEX = window.__DATA__.index", ctx); // boot() 已按 data.js 真实数据设置, 重置

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };
const obHTML = () => (idReg["onboard"] ? idReg["onboard"].innerHTML : "");

// ---- 三步引导 ----
vm.runInContext("showOnboard(1)", ctx);
t("引导overlay被创建", !!idReg["onboard"]);
t("第1步讲API Key", obHTML().indexOf("API Key") >= 0);
t("第1步有去设置按钮", obHTML().indexOf("setNav('settings')") >= 0);
t("三步指示点", (obHTML().match(/obdots/g) || []).length >= 1);
vm.runInContext("showOnboard(2)", ctx);
t("第2步讲选角色", obHTML().indexOf("选一个角色") >= 0);
t("第2步有写卡入口", obHTML().indexOf("setNav('writer')") >= 0);
vm.runInContext("showOnboard(3)", ctx);
t("第3步讲开聊", obHTML().indexOf("开始聊天") >= 0);
t("每步可跳过", obHTML().indexOf("跳过引导") >= 0);
t("越界step钳制", (()=>{ vm.runInContext("showOnboard(99)", ctx);
return obHTML().indexOf("开始聊天") >= 0; })());

// ---- 完成/跳过写标记 ----
vm.runInContext("onboardDone()", ctx);
t("完成写nd_onboarded", store["nd_onboarded"] === "1");

// ---- 空状态: 选角色页 ----
vm.runInContext("showChatPicker()", ctx);
t("选角色空状态有去写卡CTA", els["view"].innerHTML.indexOf("setNav('writer')") >= 0);

// ---- 空状态: 记忆相册 ----
vm.runInContext(`ALBUM = {runId:"r1", name:"林黛玉"}`, ctx);
vm.runInContext("renderAlbum()", ctx);
t("相册空状态有CTA", els["view"].innerHTML.indexOf("去聊天产生记忆") >= 0);

// ---- 空状态: 世界书 ----
vm.runInContext("renderLoreList('r1')", ctx);
t("世界书空状态有新增CTA", els["view"].innerHTML.indexOf("新增第一条") >= 0);

// ---- 设置页可重看 ----
vm.runInContext("showSettings()", ctx);
t("设置页有重看引导", els["view"].innerHTML.indexOf("showOnboard(1)") >= 0);

console.log(`onboard: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
