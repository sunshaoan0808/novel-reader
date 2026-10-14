/* 试玩场 (2026-10-07): 借鉴猫箱 AutoCreator→Playground。
* 卡生成后先试聊3轮，满意再确认，不满意可重新生成。
*/
var DISTILL_PLAYGROUND = (function(){
"use strict";

var S = {pkgId: null, name: null, turns: [], maxTurns: 3};

function buildPrompt(card){
var d = card._distill || {};
var axis = "";
try{
  if(typeof DISTILL_UI !== "undefined" && DISTILL_UI.getAxisPrompt){
    axis = DISTILL_UI.getAxisPrompt(S.pkgId, S.name);
  }
}catch(e){}
var stylePrompt = "";
try{
  var activeStyle = JSON.parse(localStorage.getItem("distill_active_style") || "null");
  if(activeStyle && activeStyle.prompt) stylePrompt = activeStyle.prompt;
}catch(e2){}
return "你是" + card.name + "，小说人物。现在与用户试聊，检验人设是否自然。\n" +
"" + (d.core_identity || "") + "\n" +
"" + (d.core_traits || "") + "\n" +
"" + (d.speech_style || "") + "\n" +
"" + (d.background || "") + "\n" +
(axis ? "风格偏好：" + axis + "\n" : "") +
(stylePrompt ? stylePrompt + "\n" : "") +
"要求：用第一人称，按人设说话，不出戏，不透露你是AI。";
}

async function open(pkgId, name){
S.pkgId = pkgId; S.name = name; S.turns = [];
var card = DISTILL_PACKAGE.getCharacterCard(pkgId, name);
if(!card) return;

var v = document.getElementById("view");
v.innerHTML = `
<h2 class="sec">🎮 试玩 · ${esc(name)}</h2>
<div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:12px">试聊 ${S.maxTurns} 轮，检验人设。满意后确认，不满意可重新生成。</div>
<div id="pgLog" style="min-height:200px;max-height:400px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px"></div>
<div style="display:flex;gap:8px">
<input id="pgInput" placeholder="说点什么..." style="flex:1;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">
<button class="btn" onclick="DISTILL_MACRO.show(S.pkgId,'pgInput')">宏</button>
      <button class="btn primary" onclick="DISTILL_PLAYGROUND.send()">发送</button>
</div>
<div class="btnrow" style="margin-top:12px">
<button class="btn" id="pgBack">← 返回</button>
<button class="btn primary" id="pgConfirm" style="display:none" onclick="DISTILL_PLAYGROUND.confirm()">✅ 满意，确认</button>
</div>`;
// 返回按钮改直接绑定（XSS 修复 2026-10-13）：pkgId/name 取模块内 S，不再拼进 onclick 字符串
document.getElementById("pgBack").onclick = function(){ DISTILL_UI.openCharacter(S.pkgId, S.name); };

// AI 先打招呼
var greeting = card.first_mes || (card._distill && card._distill.typical_lines) || "你好。";
if(typeof greeting === "string" && greeting.indexOf("\n") > 0) greeting = greeting.split("\n")[0];
addMsg("ai", greeting);
}

function addMsg(role, text){
var log = document.getElementById("pgLog");
if(!log) return;
var cls = role === "ai"? "color:var(--ink)": "color:var(--gold)";
log.innerHTML += `<div style="margin-bottom:8px"><b style="${cls}">${role === "ai"? esc(S.name): "你"}</b>：${esc(text)}</div>`;
log.scrollTop = log.scrollHeight;
}

async function send(){
var input = document.getElementById("pgInput");
var text = (input.value || "").trim();
if(!text) return;
input.value = "";
addMsg("user", text);
S.turns.push({role: "user", text: text});

var card = DISTILL_PACKAGE.getCharacterCard(S.pkgId, S.name);
addMsg("ai", "（思考中...）");

try{
var msgs = [{role: "system", content: buildPrompt(card)}];
S.turns.forEach(function(t){
msgs.push({role: t.role === "user"? "user": "assistant", content: t.text});
});
var r = await DISTILL_LLM.chat(msgs);
// 替换"思考中"
var log = document.getElementById("pgLog");
log.innerHTML = log.innerHTML.replace(/（思考中...）<\/div>$/, esc(r.content) + "</div>");
S.turns.push({role: "ai", text: r.content});

// 3轮后显示确认
var userTurns = S.turns.filter(function(t){ return t.role === "user";}).length;
if(userTurns >= S.maxTurns){
document.getElementById("pgConfirm").style.display = "";
addMsg("ai", "（试玩结束，你觉得我演得像吗？）");
}
}catch(e){
addMsg("ai", "（出错了：" + e.message + "）");
}
}

function confirm(){
alert("已确认！" + S.name + " 的人设通过试玩。");
DISTILL_UI.openCharacter(S.pkgId, S.name);
}

/* P2-11: 收敛到 escutil.js 的 escH()（此前只转 & < >，现统一为全实体转义，保留换行）；
   独立加载（测试 vm）无 escH 时回退同款实现 */
var esc = (typeof escH === "function") ? escH : function(s){ return String(s == null? "": s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

return {
open: open,
send: send,
confirm: confirm
};
})();
