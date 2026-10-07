/* Pin + Story Memory (2026-10-07): 借鉴 Character.AI。
* Pin: 长按消息置顶进长期记忆
* Story Memory: 用户手填背景，随角色跨聊天
*/
var CHAT_PIN = (function(){
"use strict";

function key(runId, name){ return "chat_pin_" + runId + "_" + name;}

function getPins(runId, name){
try{ return JSON.parse(localStorage.getItem(key(runId, name)) || "[]");}
catch(e){ return [];}
}

function pin(runId, name, text){
var pins = getPins(runId, name);
if(pins.length >= 30){ alert("Pin 已满 (30个上限)"); return false;}
pins.push({text: text.slice(0, 500), at: Date.now()});
localStorage.setItem(key(runId, name), JSON.stringify(pins));
return true;
}

function unpin(runId, name, idx){
var pins = getPins(runId, name);
pins.splice(idx, 1);
localStorage.setItem(key(runId, name), JSON.stringify(pins));
}

// 渲染为 prompt
function renderPrompt(runId, name){
var pins = getPins(runId, name);
if(!pins.length) return "";
return "\n" + pins.map(function(p){ return "- " + p.text;}).join("\n");
}

return {
getPins: getPins,
pin: pin,
unpin: unpin,
renderPrompt: renderPrompt
};
})();

var CHAT_STORY = (function(){
"use strict";

function key(runId, name){ return "chat_story_" + runId + "_" + name;}

function get(runId, name){
return localStorage.getItem(key(runId, name)) || "";
}

function set(runId, name, text){
localStorage.setItem(key(runId, name), text);
}

function renderPrompt(runId, name){
var s = get(runId, name);
if(!s.trim()) return "";
return "\n" + s.slice(0, 2000);
}

return {
get: get,
set: set,
renderPrompt: renderPrompt
};
})();
