/* PPA 二遍对齐 (Post Persona Alignment, arXiv:2506.11857):
* 第一遍自由生成 (流式输出, 保持现状); 第二遍用初稿对照人设依据做改写,
* 只修人设/知识边界违反 (OOC、提前知道剧本、口吻走样), 不改剧情走向、
* 不扩写不缩水; 无违反则原样返回。第二遍失败/超时则保留第一遍, 绝不打断主流程。
* 纯 JS 零依赖; callChat 可注入, 方便回归测试。
* 注: 本文件内 标记用 unicode 转义书写, 避免写入管线剥离导致标记丢失。 */
(function(){
"use strict";

/* key 模式触发关键词: 重要决定 / 表白 / 告别 / 生死去留类。
* 纯启发式 (非语义理解), 已在注释如实说明。宁可漏触发也不误触发 ——
* 误触发的代价只是一次便宜小模型的调用。 */
var KEYWORDS = ["决定","告别","表白","求婚","分手","诀别","遗言","宣战",
"复仇","报仇","成亲","拜堂","永别","最后一次","生死","殉情","刺杀",
"离开这里","跟我走","留下来","选择","命运","投胎"];

var ALIGN_TIMEOUT_MS = 60000;

function modeOf(ppaCfg){
var m = (ppaCfg && ppaCfg.mode) || "key";
return (m === "off" || m === "always")? m: "key";
}
function hitKeyword(text){
var t = String(text || "");
for(var i = 0; i < KEYWORDS.length; i++){
if(t.indexOf(KEYWORDS[i]) >= 0) return KEYWORDS[i];
}
return null;
}
/* 是否触发第二遍。
* keyRound: 导演标记的关键情节点轮 (调用方按 /情节点 启发式判定);
* hasBasis: 是否有对齐依据 (铁律/弧光/画像/故事进度任一非空)。无依据时不浪费调用。 */
function shouldTrigger(ppaCfg, userText, keyRound, hasBasis){
if(!hasBasis) return false;
var mode = modeOf(ppaCfg);
if(mode === "off") return false;
if(mode === "always") return true;
return!!keyRound ||!!hitKeyword(userText);
}
/* \u5bfc\u6f14\u6587\u672c\u662f\u5426\u542b\u5173\u952e\u60c5\u8282\u70b9(\u542f\u53d1\u5f0f): \u5ef6\u8fdf\u4e8b\u4ef6\u5f15\u7206 <\u3010\u5bfc\u6f14\u00b7\u4e8b\u4ef6\u3011> \u6216\u60c5\u8282\u70b9\u4e0b\u53d1\u90fd\u7b97\u5173\u952e\u8f6e */
function isKeyRound(dirText){
return /\u3010\u5bfc\u6f14\u00b7\u4e8b\u4ef6\u3011|\u60c5\u8282\u70b9/.test(String(dirText || ""));
}
function withTimeout(p, ms){
return Promise.race([p, new Promise(function(_, rej){
setTimeout(function(){ rej(new Error("PPA align timeout"));}, ms);
})]);
}
/* bracket markers are written as unicode escapes (u3010/u3011), never literal, to survive the write pipeline */
function br(s){ return "\u3010" + s + "\u3011"; }
function buildAlignPrompt(name, draft, basis){
var b = basis || {};
var lines = ["你是「" + name + "」的扮演校对, 只做一件事: 检查下面这段初稿是否违反人设/知识边界。"];
lines.push("只允许修改以下三类问题, 其他一字不改 (不改剧情走向, 不扩写, 不缩水, 不润色文笔):");
lines.push("1) OOC: 说话口吻 / 行事逻辑不符合人物 (对照铁律与画像);");
lines.push("2) 穿帮: 提到了角色在当前故事时间点不可能知道的事 (对照故事进度与往事);");
lines.push("3) 阶段错位: 行为与当前人物弧光阶段矛盾。");
lines.push("如果没有违反, 请原样返回初稿, 不要加任何解释、前后缀。");
if(b.iron) lines.push("\n" + br("铁律") + "\n" + b.iron);
if(b.arc) lines.push("\n" + br("人物弧光") + "\n" + b.arc);
if(b.profile && b.profile.length) lines.push("\n" + br("画像库") + "\n" + b.profile.slice(0, 12).join("\n"));
if(b.storyLine) lines.push("\n" + br("故事进度") + b.storyLine);
lines.push("\n" + br("初稿") + "\n" + draft);
return lines.join("\n");
}
/* 第二遍对齐。callChat(cfg, messages, temperature, modelOverride) 由调用方注入。
* 模型选择: ppaModel > summaryModel > 主模型 (便宜小模型优先)。
* timeoutMs 仅测试用, 生产走默认 60s。
* 返回 {text, changed}; 任何异常/超时/空返回 -> {text: draft, changed: false}。 */
async function alignText(callChat, ppaCfg, cfg, name, draft, basis, timeoutMs){
var d = String(draft || "");
if(!d.trim()) return {text: d, changed: false};
var model = (ppaCfg && ppaCfg.model) || (ppaCfg && ppaCfg.summaryModel) || null;
var c = {base: cfg.base, key: cfg.key, model: cfg.model};
var raw = "";
try{
raw = await withTimeout(
callChat(c, [{role: "user", content: buildAlignPrompt(name, d, basis)}], 0.3, model),
(timeoutMs > 0 ? timeoutMs : ALIGN_TIMEOUT_MS));
}catch(e){ return {text: d, changed: false};} // 失败/超时: 保留第一遍
var out = String(raw || "").trim();
if(!out) return {text: d, changed: false}; // 空返回: 保留第一遍
var norm = function(s){ return String(s).replace(/\s+/g, " ").trim();};
return {text: out, changed: norm(out)!== norm(d)};
}
/* 编排: 判定触发 -> 跑第二遍 -> 返回 null(未触发/跳过) 或 {text, changed, mode}。
* ctx: {ppa, userText, keyRound, callChat, cfg, name, draft, basis, onAligning} */
async function maybeAlign(ctx){
ctx = ctx || {};
var ppa = ctx.ppa || {};
var b = ctx.basis || {};
var hasBasis =!!(b.iron || b.arc || (b.profile && b.profile.length) || b.storyLine);
if(!shouldTrigger(ppa, ctx.userText, ctx.keyRound, hasBasis)) return null;
if(ctx.onAligning){ try{ ctx.onAligning(true);}catch(e){}}
var r = null;
try{
r = await alignText(ctx.callChat, ppa, ctx.cfg, ctx.name, ctx.draft, b);
}catch(e){ r = {text: String(ctx.draft || ""), changed: false};}
if(ctx.onAligning){ try{ ctx.onAligning(false, r? r.text: String(ctx.draft || ""));}catch(e){}}
return {text: r.text, changed: r.changed, mode: modeOf(ppa)};
}
/* 上次对齐记录 (Inspector "人设保真" 行用): nd_ppa_last_<chatKey> = {len, changed, ts} */
function lastKey(chatKey){ return "nd_ppa_last_" + chatKey;}
function recordAlign(chatKey, histLen, changed){
try{ localStorage.setItem(lastKey(chatKey),
JSON.stringify({len: histLen, changed:!!changed, ts: Date.now()}));}catch(e){}
}
function lastAlign(chatKey){
try{ var v = localStorage.getItem(lastKey(chatKey)); return v? JSON.parse(v): null;}
catch(e){ return null;}
}

var RP_PPA = {
KEYWORDS: KEYWORDS, modeOf: modeOf, hitKeyword: hitKeyword,
shouldTrigger: shouldTrigger, isKeyRound: isKeyRound, buildAlignPrompt: buildAlignPrompt,
alignText: alignText, maybeAlign: maybeAlign,
recordAlign: recordAlign, lastAlign: lastAlign, lastKey: lastKey,
_ALIGN_TIMEOUT_MS: ALIGN_TIMEOUT_MS
};
if(typeof module!== "undefined" && module.exports) module.exports = RP_PPA;
else if(typeof window!== "undefined") window.RP_PPA = RP_PPA;
else this.RP_PPA = RP_PPA;
})();
