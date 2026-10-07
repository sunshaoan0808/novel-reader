/* 宏助手 (2026-10-07): 借鉴 Tavo 输入时调起宏。
* 聊天/试玩时快速插入世界书条目、角色信息。
*/
var DISTILL_MACRO = (function(){
"use strict";

// 获取可用的宏
function getMacros(pkgId){
var macros = [];
// 世界书条目
try{
var wb = DISTILL_PACKAGE.getData(pkgId, "worldbook");
if(wb){
(wb.rules || []).forEach(function(r){
macros.push({label: "📖 " + (r.name || "规则"), text: "" + (r.name || "") + "：" + (r.rule || "")});
});
(wb.locations || []).forEach(function(l){
macros.push({label: "📍 " + (l.name || "场景"), text: "" + (l.name || "") + "：" + (l.desc || "")});
});
}
}catch(e){}
// 角色
try{
var cards = DISTILL_PACKAGE.listCharacterCards(pkgId);
cards.forEach(function(c){
macros.push({label: "👤 " + c.name, text: "" + c.name});
});
}catch(e){}
return macros;
}

// 显示宏选择器 (inputId: 要插入的 input 元素 id)
function show(pkgId, inputId){
var macros = getMacros(pkgId);
if(!macros.length){ alert("没有可用宏"); return;}

// 简单用 prompt 选 (移动端可用)
var list = macros.map(function(m, i){ return (i + 1) + ". " + m.label;}).join("\n");
var sel = prompt("选择宏插入：\n" + list + "\n\n输入编号：", "1");
if(!sel) return;
var idx = parseInt(sel) - 1;
if(idx < 0 || idx >= macros.length) return;

var input = document.getElementById(inputId);
if(input){
input.value = (input.value || "") + macros[idx].text;
input.focus();
}
}

return {
show: show,
getMacros: getMacros
};
})();
