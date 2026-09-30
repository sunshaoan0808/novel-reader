/* Persona: 全局用户人设 + 按聊天覆盖 (对标 C.AI / Janitor Persona)。
 * 存储: nd_persona_global 全局; nd_persona_<runId> 单聊覆盖 (群聊只用全局)。
 * 解析优先级: 本次覆盖 > 全局 > 无。prompt 注入见 rp/prompt.js 的 persona 段。 */
var RP_PERSONA = (function(){
var GKEY = "nd_persona_global";
function okey(runId){ return "nd_persona_" + runId; }
function read(k){
  try{ var v = JSON.parse(localStorage.getItem(k) || "null"); return (v && typeof v === "object") ? v : null; }
  catch(e){ return null; }
}
function getGlobal(){ return read(GKEY); }
function saveGlobal(p){
  if(p && (p.name || p.desc || p.extra || p.called)) localStorage.setItem(GKEY, JSON.stringify({name: p.name||"", desc: p.desc||"", extra: p.extra||"", called: p.called||""}));
  else localStorage.removeItem(GKEY);
}
function getOverride(runId){ return read(okey(runId)); }
function saveOverride(runId, p){
  if(p && (p.name || p.desc || p.extra || p.called)) localStorage.setItem(okey(runId), JSON.stringify({name: p.name||"", desc: p.desc||"", extra: p.extra||"", called: p.called||""}));
  else localStorage.removeItem(okey(runId));
}
function resolve(runId){ return getOverride(runId) || getGlobal(); }
/* 渲染成 prompt 文本; 空返回 ""。#20: "TA怎么称呼我" 注入成"你称呼用户为XX" */
function renderText(p){
  if(!p) return "";
  var parts = [];
  if(p.name) parts.push("你的聊天对象自称「" + p.name + "」。");
  if(p.called) parts.push("你称呼用户为「" + p.called + "」。");
  if(p.desc) parts.push(p.desc);
  if(p.extra) parts.push(p.extra);
  return parts.join("\n");
}
return {getGlobal: getGlobal, saveGlobal: saveGlobal,
        getOverride: getOverride, saveOverride: saveOverride,
        resolve: resolve, renderText: renderText};
})();
