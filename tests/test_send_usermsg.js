const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 集成: RP.send 用户消息立即入 history 并触发 onUserMsg (在 LLM 流式完成之前)
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

const order = [];
const ctx = {console, order,
  window: {__DATA__: {runs: {r1: {novel: "测试", worldbook: [], relations: []}}}},
  localStorage: {getItem:()=>null, setItem:()=>{}, removeItem:()=>{}},
  RP_NET: {
    complete: async ()=> "ok",
    stream: async (cfg, msgs, opt, onToken)=>{ order.push("stream-start"); onToken("你"); onToken("好"); order.push("stream-end"); return "你好"; },
  },
  RP_MEM: {maybeAnalyze: async ()=>{}, renderPrompt:()=>"", get:()=>({})},
  RP_TASKS: {maybeRun: async ()=>{}, renderPrompt:()=>""},
  RP_PERSONA: {renderText:()=>"", resolve:()=>""},
  RP_GROUP: {groupPostInstructions:()=>"g", memberBrief:()=>""},
  RP_OOC: {check:()=>null},
  applyRegex: (s)=>s, getRegex: ()=>null, userLore: ()=>[],
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/prompt.js", "utf8"), ctx);
// chat.js 自带 RP_NET 真实网络层: 替换为可控 stub, 验证时序逻辑
let chatSrc = fs.readFileSync(WWW+"/rp/chat.js", "utf8");
{
const start = chatSrc.indexOf("const RP_NET = (function(){");
if(start === -1) throw new Error("RP_NET block not found");
let j = chatSrc.indexOf("{", start), depth = 0, k = j;
for(; k < chatSrc.length; k++){
if(chatSrc[k] === "{") depth++;
else if(chatSrc[k] === "}"){ depth--; if(!depth) break; }
}
// k 停在 IIFE 的 } 处, 后面是 ")();"
const end = chatSrc.indexOf(")();", k) + ")();".length;
chatSrc = chatSrc.slice(0, start) + "const RP_NET = __STUB_NET__;" + chatSrc.slice(end);
}
ctx.__STUB_NET__ = ctx.RP_NET;
vm.runInContext(chatSrc, ctx);
const E = (code)=>vm.runInContext(code, ctx);

(async ()=>{
let userMsgSeenAtCallback = null;
const r = await E(`(async()=>{
const h = [];
let snap = null;
const r = await RP.send("r1", "阿绫", "玩家消息", {
  cfg:{}, history: h,
  onPush: ()=>{},
  onUserMsg: ()=>{ order.push("userMsg"); snap = JSON.stringify(h); },
  onToken: (tok)=>{},
});
return {history: r.history, snap};
})()`);

t("send resolves", r && Array.isArray(r.history));
t("onUserMsg fired", !!r.snap);
t("onUserMsg before stream", order.indexOf("userMsg") !== -1 && order.indexOf("userMsg") < order.indexOf("stream-start"));
t("user msg in history at callback",
  r.snap && JSON.parse(r.snap).some(m=>m.role==="user" && m.content==="玩家消息"));
t("final history has user+assistant",
  r.history.some(m=>m.role==="user" && m.content==="玩家消息") &&
  r.history.some(m=>m.role==="assistant" && m.content==="你好"));
t("history order user-first", r.history[0].role === "user");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("ERROR", e); process.exit(1); });
