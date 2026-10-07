/* Push Story (2026-10-07): 借鉴 Marinara-Engine Narrative Director。
* 一次性按钮：卡文时点一下，下一条回复 AI 自动推进剧情，用完自动关闭。
* 两种模式：
* - natural: 顺着现有剧情往前推
* - event: 加一个合理的意外转折
*/
var AGENT_PUSHSTORY = (function(){
"use strict";

function keyOf(chatId){ return "nd_pushstory_" + chatId;}

/* 武装/解除 */
function arm(chatId, mode){
try{
localStorage.setItem(keyOf(chatId), JSON.stringify({mode: mode || "natural", armed: true}));
}catch(e){}
}
function disarm(chatId){
try{ localStorage.removeItem(keyOf(chatId));}catch(e){}
}
function isArmed(chatId){
try{
var v = JSON.parse(localStorage.getItem(keyOf(chatId)));
return v && v.armed? v.mode: null;
}catch(e){ return null;}
}

/* Pre-Generation: 注入推进指令，返回后自动解除 */
function injectPrompt(chatId){
var mode = isArmed(chatId);
if(!mode) return "";
disarm(chatId); // 一次性，用完即关
if(mode === "event"){
return "下一条回复中加入一个合理的意外转折，" +
"必须符合当前场景和人物性格，不得凭空引入与前文矛盾的设定。";
}
return "下一条回复主动推进剧情：让已有线索往前走一步，" +
"可以是人物做决定、冲突升级、新信息揭露。不要原地打转、不要只寒暄。";
}

function getMode(chatId){
return isArmed(chatId);
}

return {
arm: arm,
disarm: disarm,
isArmed: isArmed,
getMode: getMode,
injectPrompt: injectPrompt
};
})();
