const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1-4: 聊天记录搜索
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
createElement: tag => { const e = mkEl(); e.tagName = tag; return e; },
};
const DATA = {
index: [{run_id: "r1", novel: "红楼梦", characters: ["林黛玉"], n_chunks: 1}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "林黛玉", fields: {}}]},
};
const ctx = {localStorage, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
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
const chatlog = () => els["chatlog"].innerHTML;
const searchbar = () => els["chatsearch"].innerHTML;

vm.runInContext(`CHAT = {mode:"single", runId:"r1", name:"林黛玉", members:[], narrMode:false, asSpeaker:null}`, ctx);
const HKEY = "nd_chat_r1_林黛玉";
const mk = (role, content, extra) => Object.assign({role, content, ts: Date.now()}, extra||{});
store[HKEY] = JSON.stringify([
mk("user", "Hello World"),
mk("assistant", "你好呀姑娘"),
mk("assistant", "姑娘今天气色不错"),
]);

// ---- 开关 ----
vm.runInContext("toggleChatSearch()", ctx);
t("打开搜索", vm.runInContext("SEARCH.active", ctx) === true);
t("搜索条有输入框", searchbar().indexOf('id="cs_input"') >= 0);
// ---- 搜索命中 + 高亮 ----
vm.runInContext("chatSearchInput('姑娘')", ctx);
t("命中2条", vm.runInContext("SEARCH.hits.join(',')", ctx) === "1,2");
t("当前第1条", vm.runInContext("SEARCH.cur", ctx) === 0);
t("高亮mark", chatlog().indexOf("<mark>姑娘</mark>") >= 0);
t("当前命中行标curhit", chatlog().indexOf('id="smsg-1"') >= 0 && chatlog().indexOf("curhit") >= 0);
t("n/总数", els["cs_num"].textContent === "1/2");
// ---- 大小写不敏感 ----
vm.runInContext("chatSearchInput('hello')", ctx);
t("大小写不敏感命中", vm.runInContext("SEARCH.hits.join(',')", ctx) === "0");
t("高亮保留原文大小写", chatlog().indexOf("<mark>Hello</mark>") >= 0);
// ---- 上下跳转 + 环绕 ----
vm.runInContext("chatSearchInput('姑娘')", ctx);
vm.runInContext("chatSearchGo(1)", ctx);
t("下翻到第2条", vm.runInContext("SEARCH.cur", ctx) === 1);
t("计数更新", els["cs_num"].textContent === "2/2");
vm.runInContext("chatSearchGo(1)", ctx);
t("末尾环绕到开头", vm.runInContext("SEARCH.cur", ctx) === 0);
vm.runInContext("chatSearchGo(-1)", ctx);
t("开头上翻环绕到末尾", vm.runInContext("SEARCH.cur", ctx) === 1);
// ---- 无命中 ----
vm.runInContext("chatSearchInput('不存在的词xyz')", ctx);
t("无命中hits空", vm.runInContext("SEARCH.hits.length", ctx) === 0);
t("无命中计数0/0", els["cs_num"].textContent === "0/0");
t("无命中无mark", chatlog().indexOf("<mark>") < 0);
// ---- 空查询 ----
vm.runInContext("chatSearchInput('')", ctx);
t("空查询无mark", chatlog().indexOf("<mark>") < 0);
// ---- 正则特殊字符不炸 ----
let threw = false;
try{ vm.runInContext("chatSearchInput('(test[')", ctx); }catch(e){ threw = true; }
t("特殊字符不抛错", !threw);
// ---- 关闭 ----
vm.runInContext("toggleChatSearch(false)", ctx);
t("关闭搜索", vm.runInContext("SEARCH.active", ctx) === false);
t("关闭后搜索条清空", searchbar() === "");
t("关闭后无高亮", chatlog().indexOf("<mark>") < 0);
// ---- 群聊历史键也支持 ----
vm.runInContext(`CHAT = {mode:"group", runId:"r1", name:null, members:["林黛玉","贾宝玉"], narrMode:false, asSpeaker:null}`, ctx);
const GKEY = "nd_group_r1_林黛玉_贾宝玉";
store[GKEY] = JSON.stringify([mk("assistant", "宝玉笑道: 姑娘好", {speaker: "贾宝玉"})]);
vm.runInContext("toggleChatSearch()", ctx);
vm.runInContext("chatSearchInput('姑娘')", ctx);
t("群聊可搜索", vm.runInContext("SEARCH.hits.join(',')", ctx) === "0");
t("群聊高亮", chatlog().indexOf("<mark>姑娘</mark>") >= 0);

console.log(`chatsearch: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
