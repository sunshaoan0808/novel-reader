/* AI 帮填：所有手动填写的输入框旁加 ✨AI 按钮，点一下调大模型生成内容填入。
* 用法（放在 <label> 标题文字后面）：
* <label>标题${RP_AIFILL.btn("l_title","世界书条目标题","2~8个字，如人物名/地点名","小说《红楼梦》")}</label>
* 聊天输入框用专用 RP_AIFILL.fillChat(this)。
* 依赖: getCfg (app.js 全局), RP_NET.complete (rp/chat.js), rpToast(可选)。
* Node/测试环境兼容：浏览器 API 引用前均有 typeof 守卫。
*/
const RP_AIFILL = (function(){
"use strict";

/* 生成按钮 HTML。onclick 用单引号界定属性 + JSON.stringify(双引号) 传参，
* 避免 JSON 双引号提前终止属性（穿越 onclick 引号陷阱教训）。 */
function btn(targetId, label, hint, ctx){
var js = 'RP_AIFILL.fill(this,'
+ JSON.stringify(String(targetId)) + ','
+ JSON.stringify(String(label || "")) + ','
+ JSON.stringify(String(hint || "")) + ','
+ JSON.stringify(String(ctx || "")) + ')';
/* 属性用单引号界定：JSON.stringify 不转义 '，含 ' 的角色名/提示会提前终止属性，
 * 先转成 &#39;（浏览器解析属性时解码，JS 拿到的仍是 '）。& 先转义。 */
js = js.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
return '<button type="button" class="aifillbtn" title="AI 帮你填" onclick=\'' + js + '\'>✨AI</button>';
}

function getCfgSafe(){
try{ if(typeof getCfg === "function") return getCfg() || {};}catch(e){}
return {};
}

function toast(msg){
try{ if(typeof rpToast === "function"){ rpToast(msg); return;}}catch(e){}
try{ if(typeof alert === "function") alert(msg);}catch(e2){}
}

/* 组装填表 prompt，导出供测试。 */
function buildPrompt(label, hint, ctx, current, placeholder){
var parts = [];
parts.push("你是手机 RP 应用里的「智能填表助手」。用户正在填写表单，请只输出该字段应该填写的内容正文。");
parts.push("严格要求：只输出字段内容本身，不要任何解释、前言、客套话，不要加引号；不要说「好的」「以下是我生成的」这类话。");
if(label) parts.push("[字段]" + label);
if(hint) parts.push("[填写说明]" + hint);
if(ctx) parts.push("[背景]" + ctx);
if(placeholder) parts.push("[输入框里的提示文字]" + placeholder);
if(current) parts.push("[用户已写的内容（在其基础上续写/改写完善，保持原意和语言）]" + current);
else parts.push("[用户还没写，请从空白直接生成]");
return parts.join("\n");
}

/* 取最近 N 条聊天记录拼成上下文（世界状态/事实/代笔用），失败返回空串。
 * keyOverride: 指定历史键（如事件簿页面 CHAT 不在该聊天时）；不传则用当前聊天。 */
function recentChatCtx(n, keyOverride){
try{
if(typeof getHist!== "function") return "";
var key = keyOverride || (typeof chatHistKey=== "function" ? chatHistKey() : "");
if(!key) return "";
var h = getHist(key) || [];
var tail = h.slice(-(n || 6));
return tail.map(function(m){
var who = m.role === "user"? "我": (m.name || "TA");
return who + "：" + String(m.content || "").slice(0, 200);
}).join("\n");
}catch(e){ return "";}
}

/* 取玩家人设（代笔用），失败返回空串。 */
function personaCtx(){
try{
var p = {};
try{ p = JSON.parse(localStorage.getItem("nd_persona") || "{}");}catch(e){}
var bits = [];
if(p.name) bits.push("名字：" + p.name);
if(p.desc) bits.push("自我介绍：" + p.desc);
if(p.extra) bits.push("补充：" + p.extra);
return bits.join("；");
}catch(e){ return "";}
}

async function callModel(cfg, prompt, maxTokens){
return RP_NET.complete(
{base: cfg.base, key: cfg.key, model: cfg.model},
[{role: "user", content: prompt}],
0.8, null, {maxTokens: maxTokens});
}

function setFilled(el, text){
el.value = text;
/* 触发 oninput（如字数统计 tokCount） */
try{ el.dispatchEvent(new Event("input", {bubbles: true}));}catch(e){}
try{ if(el.focus) el.focus();}catch(e2){}
}

/* 通用填表。btnEl: 被点的按钮；其余为 btn() 传入的参数。 */
async function fill(btnEl, targetId, label, hint, ctx){
var doc = (typeof document!== "undefined")? document: null;
if(!doc) return;
var el = doc.getElementById(targetId);
if(!el) return;
var cfg = getCfgSafe();
if(!cfg.key ||!cfg.base){
toast("还没配大模型接口，去「设置」填一下 API 地址和 Key 再用 AI 帮填");
return;
}
var old = btnEl.innerHTML;
btnEl.disabled = true; btnEl.innerHTML = "…";
try{
var current = ((el.value || "").trim()).slice(0, 2000);
var prompt = buildPrompt(label, hint, ctx, current, el.placeholder || "");
var isLong = ((el.tagName || "").toLowerCase() === "textarea");
var out = (await callModel(cfg, prompt, isLong? 800: 200) || "").trim();
if(out){ setFilled(el, out); toast("已填入，可再手动改");}
else toast("AI 返回为空，再点一次试试");
}catch(e){
toast("AI 帮填失败：" + ((e && e.message) || e));
}finally{
btnEl.disabled = false; btnEl.innerHTML = old;
}
}

/* 聊天输入框专用：以玩家口吻代笔一句话（只填入不发送）。 */
async function fillChat(btnEl){
var doc = (typeof document!== "undefined")? document: null;
if(!doc) return;
var el = doc.getElementById("chat_in");
if(!el || el.disabled) return;
var cfg = getCfgSafe();
if(!cfg.key ||!cfg.base){
toast("还没配大模型接口，去「设置」填一下 API 地址和 Key 再用 AI 帮填");
return;
}
var old = btnEl.innerHTML;
btnEl.disabled = true; btnEl.innerHTML = "…";
try{
var who = "玩家";
try{
if(typeof CHAT!== "undefined" && CHAT){
who = CHAT.mode === "traverse" && typeof travPlayerName === "function"
? travPlayerName()
: (CHAT.mode === "group"? "玩家（群聊）": ("玩家（正和 " + (CHAT.name || "TA") + " 聊天）"));
}
}catch(e){}
var prompt = "你是 RP 聊天里玩家的「代笔助手」。根据最近的对话和玩家人设，以玩家的第一人称口吻写一句玩家接下来可能说的话或做的行动（一句话，20~60字，自然口语)。\n"
+ "严格要求：只输出这一句话，不要任何解释、前言、引号。\n"
+ "[玩家身份]" + who + "\n"
+ (personaCtx()? "[玩家人设]" + personaCtx() + "\n": "")
+ (recentChatCtx(6)? "[最近对话]\n" + recentChatCtx(6): "[最近对话]（暂无，直接开场）");
var out = (await callModel(cfg, prompt, 200) || "").trim();
if(out){ setFilled(el, out); toast("已代笔一句，可改完再发");}
else toast("AI 返回为空，再点一次试试");
}catch(e){
toast("AI 帮填失败：" + ((e && e.message) || e));
}finally{
btnEl.disabled = false; btnEl.innerHTML = old;
}
}

return {
btn: btn,
fill: fill,
fillChat: fillChat,
/* 导出供测试 */
_buildPrompt: buildPrompt,
_recentChatCtx: recentChatCtx,
_personaCtx: personaCtx,
_getCfgSafe: getCfgSafe
};
})();
if(typeof module!== "undefined" && module.exports) module.exports = RP_AIFILL;
