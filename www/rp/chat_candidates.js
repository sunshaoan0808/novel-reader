/* 多候选 (2026-10-07): 借鉴 Character.AI ChatMessageCandidates。
 * AI 回复存多个候选，左右切换。
 */
var CHAT_CANDIDATES = (function(){
"use strict";

// msgId -> {candidates: [text], idx: 0}
var store = {};

function key(runId, name, msgIdx){
  return runId + "|" + name + "|" + msgIdx;
}

// 添加候选
function add(runId, name, msgIdx, text){
  var k = key(runId, name, msgIdx);
  if(!store[k]) store[k] = {candidates: [], idx: 0};
  // 去重
  if(store[k].candidates.indexOf(text) < 0){
    store[k].candidates.push(text);
  }
  return store[k].candidates.length;
}

// 切换候选 (dir: 1 下一个, -1 上一个)
function switchTo(runId, name, msgIdx, dir){
  var k = key(runId, name, msgIdx);
  var s = store[k];
  if(!s || s.candidates.length < 2) return null;
  s.idx = (s.idx + dir + s.candidates.length) % s.candidates.length;
  return {text: s.candidates[s.idx], idx: s.idx, total: s.candidates.length};
}

// 获取当前
function current(runId, name, msgIdx){
  var k = key(runId, name, msgIdx);
  var s = store[k];
  if(!s) return null;
  return {text: s.candidates[s.idx], idx: s.idx, total: s.candidates.length};
}

// 渲染切换器 UI
function renderSwitcher(runId, name, msgIdx){
  var c = current(runId, name, msgIdx);
  if(!c || c.total < 2) return "";
  return `<div style="font-size:calc(11px * var(--fs));color:var(--ink-faint);margin-top:4px;display:flex;gap:8px;align-items:center" data-ccrun="${ccEsc(runId)}" data-ccname="${ccEsc(name)}" data-ccidx="${msgIdx}">
    <a href="javascript:void(0)" data-ccact="switch" data-ccdir="-1">◀</a>
    <span>${c.idx + 1}/${c.total}</span>
    <a href="javascript:void(0)" data-ccact="switch" data-ccdir="1">▶</a>
    <a href="javascript:void(0)" data-ccact="regen" style="margin-left:8px">↻ 再生成</a>
  </div>`;
}

function uiSwitch(runId, name, msgIdx, dir){
  var r = switchTo(runId, name, msgIdx, dir);
  if(r && typeof refreshMessage === "function"){
    refreshMessage(runId, name, msgIdx, r.text);
  }
  // 刷新切换器
  if(typeof refreshSwitcher === "function"){
    refreshSwitcher(runId, name, msgIdx);
  }
}

async function uiRegen(runId, name, msgIdx){
  // 触发重新生成，由聊天模块实现
  if(typeof requestRegen === "function"){
    var text = await requestRegen(runId, name, msgIdx);
    if(text) add(runId, name, msgIdx, text);
  }
}

/* HTML 属性转义（XSS 修复 2026-10-13）：data-* 属性值用，含双引号转义 */
function ccEsc(s){
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* 点击事件委托：替代内联 onclick 字符串模板，runId/name 走 data-* 属性 */
function onCcClick(e){
  var el = null;
  try{ el = (e.target && e.target.closest) ? e.target.closest("[data-ccact]") : null; }
  catch(err){ el = null; }
  if(!el) return;
  var wrap = null;
  try{ wrap = el.closest("[data-ccrun]"); }catch(err){ wrap = null; }
  var d = (wrap && wrap.dataset) || {};
  var runId = d.ccrun, name = d.ccname, msgIdx = parseInt(d.ccidx, 10);
  var act = el.getAttribute("data-ccact");
  try{
    if(act === "switch") uiSwitch(runId, name, msgIdx, parseInt(el.getAttribute("data-ccdir"), 10));
    else if(act === "regen") uiRegen(runId, name, msgIdx);
  }catch(err){ try{ console.warn("[chat_candidates] ccact failed:", act, err); }catch(e2){} }
}
if(typeof document !== "undefined" && document && typeof document.addEventListener === "function"){
  document.addEventListener("click", onCcClick);
}

return {
  add: add,
  switchTo: switchTo,
  current: current,
  renderSwitcher: renderSwitcher,
  uiSwitch: uiSwitch,
  uiRegen: uiRegen
};
})();
