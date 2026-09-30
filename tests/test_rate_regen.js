const fs = require("fs");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 点踩自动重生回归: rateMsg(idx,-1) 在最新一条 AI 回复上 -> 触发 regenMsg();
// 其他情况只记录评分, 不触发。
const src = fs.readFileSync(WWW + "/app.js", "utf8");

let pass = 0, fail = 0;
function ok(name, cond){
if(cond){ pass++;}
else { fail++; console.log("FAIL:", name);}
}

// 从 app.js 抽取 window.rateMsg 真实函数体(括号配平), 注入 mock 后运行
function extractRateMsg(){
const startMark = "window.rateMsg = (idx, v)=>{";
const s = src.indexOf(startMark);
if(s < 0) throw new Error("rateMsg not found");
let d = 0, i = s + startMark.length - 1; // 指向开括号 {
for(; i < src.length; i++){
if(src[i] === "{") d++;
else if(src[i] === "}"){
d--;
if(d === 0) break;
}
}
return src.slice(s, i + 1) + ";";
}
const fnSrc = extractRateMsg();
ok("rateMsg extracted", fnSrc.indexOf("regenMsg()") >= 0);

function makeHarness(messages, mode, streaming){
const store = { k: messages.map(m => Object.assign({}, m))};
let regenCalls = 0, renders = 0;
const harness = {
store, mode,
chatHistKey: () => "k",
getHist: k => store[k],
saveHist: (k, h) => { store[k] = h;},
renderChat: () => { renders++;},
CHAT: { mode: mode || "single"},
document: { querySelector: sel => streaming? {}: null},
regenMsg: () => { regenCalls++;},
window: {},
};
const fn = new Function(
"chatHistKey", "getHist", "saveHist", "renderChat",
"CHAT", "document", "regenMsg", "window",
fnSrc + "\nreturn window.rateMsg;");
harness.rateMsg = fn(
harness.chatHistKey, harness.getHist, harness.saveHist,
harness.renderChat, harness.CHAT, harness.document,
harness.regenMsg, harness.window);
harness.regenCalls = () => regenCalls;
harness.renders = () => renders;
return harness;
}
const AI = c => ({ role: "assistant", content: c});
const USER = c => ({ role: "user", content: c});

// 1) 点踩最新 AI 回复 -> 评分 -1 且触发重生
{
const t = makeHarness([USER("你好"), AI("旧回复")]);
t.rateMsg(1, -1);
ok("dislike latest AI sets rating -1", t.store.k[1].rating === -1);
ok("dislike latest AI triggers regen", t.regenCalls() === 1);
ok("renderChat called", t.renders() >= 1);
}
// 2) 点赞不触发重生
{
const t = makeHarness([USER("你好"), AI("回复")]);
t.rateMsg(1, 1);
ok("like sets rating 1", t.store.k[1].rating === 1);
ok("like does not trigger regen", t.regenCalls() === 0);
}
// 3) 再点一次踩取消(0), 不触发重生
{
const t = makeHarness([USER("你好"), AI("回复")]);
t.rateMsg(1, -1);
t.rateMsg(1, -1);
ok("second dislike toggles rating to 0", t.store.k[1].rating === 0);
ok("toggle-off does not trigger regen", t.regenCalls() === 1); // 只有第一次触发
}
// 4) 点踩非最新的 AI 消息 -> 只记录, 不重生
{
const t = makeHarness([USER("a"), AI("旧的"), USER("b"), AI("最新的")]);
t.rateMsg(1, -1);
ok("dislike older AI sets rating -1", t.store.k[1].rating === -1);
ok("dislike older AI does not trigger regen", t.regenCalls() === 0);
}
// 5) 用户消息不触发(防御)
{
const t = makeHarness([USER("你好"), AI("回复")]);
t.rateMsg(0, -1);
ok("dislike on user msg does not trigger regen", t.regenCalls() === 0);
}
// 6) 穿越模式不触发(无重生管线)
{
const t = makeHarness([USER("行动"), AI("世界回应")], "traverse");
t.rateMsg(1, -1);
ok("traverse dislike sets rating", t.store.k[1].rating === -1);
ok("traverse dislike does not trigger regen", t.regenCalls() === 0);
}
// 7) 生成中不重复触发
{
const t = makeHarness([USER("你好"), AI("回复")], "single", true);
t.rateMsg(1, -1);
ok("streaming dislike sets rating", t.store.k[1].rating === -1);
ok("streaming dislike does not trigger regen", t.regenCalls() === 0);
}
// 8) ⚠️/【OOC/（已停止 消息不计入"最新", 点踩其前一条正常触发
{
const OOC = "\u3010OOC\u3011警告"; // U+3010/3011 转义, 字面量会被写管线掏空
const t = makeHarness([USER("a"), AI("正常回复"), AI("⚠️ 出错了"), AI(OOC), AI("（已停止")]);
t.rateMsg(1, -1);
ok("warning-like msgs excluded from lastAI", t.regenCalls() === 1);
}
// 9) 群聊模式触发
{
const t = makeHarness([USER("大家好"), AI("群回复")], "group");
t.rateMsg(1, -1);
ok("group dislike triggers regen", t.regenCalls() === 1);
}

console.log(`\nrate_regen: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
