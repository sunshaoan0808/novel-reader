const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P0-3: 长按消息统一操作菜单
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
const idReg = {}; // createElement 后设置 id 即注册, 模拟真实 getElementById
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
// msgsheet/msgscrim 走真实语义: 不存在时返回 null
if(id === "msgsheet" || id === "msgscrim") return idReg[id] || null;
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
index: [{run_id: "r1", novel: "红楼梦", characters: ["林黛玉"], n_chunks: 1}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "林黛玉", fields: {}}]},
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

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };
const sheetOf = () => created.find(e => e.className === "msgsheet");

vm.runInContext(`CHAT = {mode:"single", runId:"r1", name:"林黛玉", members:[], narrMode:false, asSpeaker:null}`, ctx);
const HKEY = "nd_chat_r1_林黛玉";
const mk = (role, content, extra) => Object.assign({role, content, ts: Date.now()}, extra||{});
store[HKEY] = JSON.stringify([
mk("user", "你好呀"),
mk("assistant", "姑娘好", {rating: 0}),
]);

// ---- pinChatMsg: 单聊消息 Pin 为长期记忆 ----
vm.runInContext("pinChatMsg(1)", ctx);
const mem = JSON.parse(store["nd_mem2_r1_林黛玉"] || "null");
t("pin写入记忆", !!(mem && mem.short && mem.short.length === 1));
t("pin标记置顶", mem.short[0].pin === true);
t("pin内容带消息", mem.short[0].fact.indexOf("姑娘好") >= 0);
// 再 pin 一条, id 递增
vm.runInContext("pinChatMsg(0)", ctx);
const mem2 = JSON.parse(store["nd_mem2_r1_林黛玉"]);
t("pin id递增", mem2.short[1].id === mem2.short[0].id + 1);

// ---- msgSheet: AI 消息单聊 -> 7 个动作 ----
vm.runInContext("msgSheet(true, 1)", ctx);
const sh = sheetOf();
t("sheet被创建", !!sh);
const html = sh ? sh.innerHTML : "";
t("sheet有Pin", html.indexOf("pinChatMsg(1)") >= 0);
t("sheet有赞同", html.indexOf("rateMsg(1,1)") >= 0);
t("sheet有反对", html.indexOf("rateMsg(1,-1)") >= 0);
t("sheet有编辑", html.indexOf("editMsg(1)") >= 0);
t("sheet有复制", html.indexOf("copyMsg(1)") >= 0);
t("sheet有TTS", html.indexOf("ttsMsg(1)") >= 0);
t("sheet有删除", html.indexOf("delMsgAsk(1)") >= 0); /* #13: 删除走 delMsgAsk(记忆二选一) */
t("sheet有预览", html.indexOf("msprev") >= 0);

// ---- 用户消息: 无评分/TTS ----
vm.runInContext("msgSheet(true, 0)", ctx);
const html0 = sheetOf().innerHTML;
t("用户消息无评分", html0.indexOf("rateMsg(0,1)") < 0);
t("用户消息无TTS", html0.indexOf("ttsMsg(0)") < 0);
t("用户消息有Pin/编辑/删除", html0.indexOf("pinChatMsg(0)") >= 0 && html0.indexOf("editMsg(0)") >= 0);

// ---- 群聊: 无Pin ----
vm.runInContext(`CHAT = {mode:"group", runId:"r1", name:null, members:["林黛玉","贾宝玉"], narrMode:false, asSpeaker:null}`, ctx);
const GKEY = "nd_group_r1_林黛玉_贾宝玉"; // sort 后林在前
store[GKEY] = JSON.stringify([mk("assistant", "群消息", {speaker: "林黛玉"})]);
vm.runInContext("msgSheet(true, 0)", ctx);
t("群聊无Pin", sheetOf().innerHTML.indexOf("pinChatMsg") < 0);
t("群聊有删除", sheetOf().innerHTML.indexOf("delMsgAsk(0)") >= 0); /* #13 */
// 群聊下 pinChatMsg 直接返回, 不写记忆
const before = store["nd_mem2_r1_null"];
vm.runInContext("pinChatMsg(0)", ctx);
t("群聊pin不写记忆", store["nd_mem2_r1_null"] === before);

// ---- 关闭不抛错 ----
vm.runInContext("msgSheet(false)", ctx);
t("关闭sheet不崩", true);

// ---- renderChat 模板带长按绑定 ----
const src = fs.readFileSync(WWW + "/app.js", "utf8");
t("模板有oncontextmenu", src.indexOf("oncontextmenu=\"event.preventDefault();msgMenu(${jq(idx)})") >= 0); /* P0-1: 已改 jq() 转义 */
t("模板有ontouchstart", src.indexOf("ontouchstart=\"msgPressStart(event,${jq(idx)})\"") >= 0); /* P0-1: 已改 jq() 转义 */

// ---- 图标补齐 ----
const isrc = fs.readFileSync(WWW + "/icons.js", "utf8");
t("copy图标", isrc.indexOf('"copy"') >= 0);
t("trash图标", isrc.indexOf('"trash"') >= 0);

console.log(`msgmenu: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
