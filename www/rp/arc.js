/* P0-3 人物弧光: RP_ARC 模块
*
* - arcSummary(card, runId): 返回 {type, typeLabel, stage, defaultStage, start, mids[], end},
*   供角色详情页「人物弧光」展示区使用。
* - renderArcPrompt(card, runId): 返回 300 字内的 compact prompt 文本
*   (弧光类型 / 当前阶段 / 起承转合), 供注入扮演 prompt。
* - 阶段覆盖: localStorage["nd_arcstage_<cardId>"], cardId = card.id || runId_name;
*   renderArcPrompt 与展示都优先用覆盖值。
*
* 注意: 本模块不碰 prompt.js; 注入接入由调用方加一行
*   RP_ARC.renderArcPrompt(card, runId) 即可。
*/
var RP_ARC = (function(){
"use strict";

var TYPE_LABEL = {fall:"陨落", awakening:"觉醒", rise:"上升", flat:"平直"};

/* 红楼常见开聊阶段(阶段选择器候选; 卡片默认值排在第一位) */
var STAGES = [
"大观园时期", "大观园诗社时期", "黛玉入府时期", "怡红院时期",
"协理宁国府时期", "家塾读书时期", "二进荣国府时期",
"宝玉成婚时期", "贾府复兴时期"
];

function cardId(card, runId){
  if(card && card.id) return String(card.id);
  return (runId || "") + "_" + ((card && card.name) || "");
}
function storeKey(card, runId){
  return "nd_arcstage_" + cardId(card, runId);
}
function fieldsOf(card){
  return (card && card.fields) || {};
}
/* 当前阶段: 覆盖值优先, 否则卡片默认值 */
function getStage(card, runId){
  var f = fieldsOf(card);
  try{
    var ov = (typeof localStorage !== "undefined") && localStorage.getItem(storeKey(card, runId));
    if(ov) return ov;
  }catch(e){}
  return f.timeline_stage || "";
}
/* 阶段选择器写入: 选回默认值则清掉覆盖, 保持存储干净 */
function setStage(card, runId, stage){
  var f = fieldsOf(card);
  try{
    if(stage && stage !== f.timeline_stage) localStorage.setItem(storeKey(card, runId), stage);
    else localStorage.removeItem(storeKey(card, runId));
  }catch(e){}
  return getStage(card, runId);
}
function midsOf(card){
  var m = fieldsOf(card).arc_mid;
  if(!m) return [];
  if(Array.isArray(m)) return m.filter(function(x){ return !!x; });
  return String(m).split(/；|\n/).map(function(s){ return s.trim(); })
    .filter(function(s){ return !!s; });
}
function arcSummary(card, runId){
  var f = fieldsOf(card);
  var tp = f.arc_type || "";
  return {
    type: tp,
    typeLabel: TYPE_LABEL[tp] || tp || "",
    stage: getStage(card, runId),
    defaultStage: f.timeline_stage || "",
    start: f.arc_start || "",
    mids: midsOf(card),
    end: f.arc_end || ""
  };
}
function cut(s, n){
  s = String(s || "");
  return s.length > n ? s.slice(0, n) : s;
}
/* compact prompt: 类型 + 当前阶段 + 起(首转→末转)+合, 300 字内 */
function renderArcPrompt(card, runId){
  var s = arcSummary(card, runId);
  if(!s.type && !s.start && !s.mids.length && !s.end) return "";
  var head = "「弧光」" + ((card && card.name) || "") + " · "
    + (s.typeLabel ? s.typeLabel + "弧" : "弧光")
    + (s.stage ? " · 当前阶段：" + s.stage : "");
  var lines = [head];
  if(s.start) lines.push("起：" + cut(s.start, 60));
  if(s.mids.length){
    var zhuan = cut(s.mids[0], 45);
    if(s.mids.length > 1) zhuan += " → " + cut(s.mids[s.mids.length - 1], 45);
    lines.push("转：" + zhuan);
  }
  if(s.end) lines.push("合：" + cut(s.end, 60));
  return lines.join("\n");
}

return {
  TYPE_LABEL: TYPE_LABEL,
  STAGES: STAGES,
  cardId: cardId,
  storeKey: storeKey,
  getStage: getStage,
  setStage: setStage,
  midsOf: midsOf,
  arcSummary: arcSummary,
  renderArcPrompt: renderArcPrompt
};
})();
