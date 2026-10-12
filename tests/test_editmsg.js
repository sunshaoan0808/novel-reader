const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P0-2: 消息编辑 (editMsg/editMsgSave)
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false,
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
let msgMocks = [];
const document = {
body: mkEl(),
getElementById: id => {
if(id === "live") return null; // 未在流式生成
return els[id] || (els[id] = mkEl());
},
querySelector: sel => {
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
if(mm[1] === "live") return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: sel => (sel === "#chatlog .msg" ? msgMocks : []),
createElement: () => mkEl(),
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

(async ()=>{
// 准备: 单聊历史 user,ai,user,ai
vm.runInContext(`CHAT = {mode:"single", runId:"r1", name:"林黛玉", members:[], narrMode:false, asSpeaker:null}`, ctx);
const HKEY = "nd_chat_r1_林黛玉";
const mk = (role, content, extra) => Object.assign({role, content, ts: Date.now()}, extra||{});
store[HKEY] = JSON.stringify([
mk("user", "你好"),
mk("assistant", "你好呀", {candidates: ["你好呀", "您好"], ci: 0, rating: 1}),
mk("user", "今天天气如何"),
mk("assistant", "晴空万里"),
]);
// 配好 key, 桩掉 sendChatText (只记录调用)
store["nd_api_cfg_v1"] = JSON.stringify({key: "k", base: "https://x", model: "m"});
vm.runInContext(`sendChatText = async function(tx){ window.__sent = tx;
const k = chatHistKey(); const h = getHist(k);
h.push({role:"user", content: tx, ts: Date.now()});
h.push({role:"assistant", content: "AI重生成回复", ts: Date.now()});
saveHist(k, h); renderChat(); };`, ctx);

// ---- AI 消息编辑: 只改文本, 不重生成, 保留 swipe 变体 ----
els["editbox"] = mkEl(); els["editbox"].value = "改后的AI回复";
await vm.runInContext("editMsgSave(1)", ctx);
let h = JSON.parse(store[HKEY]);
t("AI编辑改文本", h[1].content === "改后的AI回复");
t("AI编辑保留swipe变体", h[1].candidates.length === 2 && h[1].ci === 0);
t("AI编辑保留评分", h[1].rating === 1);
t("AI编辑不重生成", h.length === 4 && !ctx.__sent);

// ---- 用户消息编辑: 截断其后消息并重生成 ----
delete ctx.__sent;
els["editbox"].value = "改后的用户问";
await vm.runInContext("editMsgSave(2)", ctx);
h = JSON.parse(store[HKEY]);
t("用户编辑截断后续", h.length === 4 && h[0].content === "你好" && h[1].content === "改后的AI回复");
t("用户编辑调重生成", ctx.__sent === "改后的用户问");
t("重生成接在截断后", h[2].content === "改后的用户问" && h[3].content === "AI重生成回复");

// ---- 未配 key: 不截断历史 ----
delete store["nd_api_cfg_v1"];
store[HKEY] = JSON.stringify([mk("user","q1"), mk("assistant","a1")]);
delete ctx.__sent;
els["editbox"].value = "q1改";
await vm.runInContext("editMsgSave(0)", ctx);
h = JSON.parse(store[HKEY]);
t("无key不截断", h.length === 2 && h[0].content === "q1" && !ctx.__sent);
store["nd_api_cfg_v1"] = JSON.stringify({key: "k", base: "https://x", model: "m"});

// ---- editMsg UI: 气泡变 textarea ----
const bub = mkEl(); bub.dataset = {};
bub.querySelector = sel => (sel === ".bubble" ? bub : (sel === "textarea" ? null : null));
const msgEl = mkEl();
msgEl.querySelector = sel => (sel === ".bubble" ? bub : null);
msgMocks = [msgEl];
store[HKEY] = JSON.stringify([mk("assistant","原文内容")]);
vm.runInContext("editMsg(0)", ctx);
t("editMsg注入textarea", bub.innerHTML.indexOf('id="editbox"') >= 0);
t("editMsg带原内容", bub.innerHTML.indexOf("原文内容") >= 0);
t("editMsg有保存取消", bub.innerHTML.indexOf("editMsgSave(0)") >= 0 && bub.innerHTML.indexOf("editMsgCancel(0)") >= 0);
vm.runInContext("editMsgCancel(0)", ctx);
t("editMsgCancel恢复", bub.innerHTML.indexOf('id="editbox"') < 0);

// ---- 模板里有编辑按钮 ----
const src = fs.readFileSync(WWW + "/app.js", "utf8");
t("renderChat有编辑按钮", (src.match(/editMsg\(\$\{jq\(idx\)\}\)">编辑/g) || []).length >= 2); /* P0-1: 已改 jq() 转义 */

console.log(`editmsg: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("ERROR", e); process.exit(1); });
