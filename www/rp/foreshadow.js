/* RP 引擎: 伏笔面板数据层 (对标 Talkie 剧情 SVIP "Foreshadowing Panel")
 * 数据源: www/data/foreshadow_cal.js (蒸馏管线事件日历产物, 2973 条, 其中 k=='foreshadowing' 897 条)
 * 精简 schema 适配: {t: 埋设时间, te: 回收时间, ch: 回目, c: 相关人物[], s: 伏笔文本, k: 类型, sub: 关联人物}
 * 状态推导 (数据无显式 resolved 字段, 故按 te 推导):
 *   te 有值 => 已回收 (在 te 对应时间点兑现); te 为空 => 未回收
 * 纯逻辑, 无 DOM, 可被 node vm 测试。
 */
var RP_FORE = (function(){
"use strict";

function all(){
  try{
    var c = (typeof window !== "undefined" && window.__CAL__) || [];
    return Array.isArray(c) ? c : [];
  }catch(e){ return []; }
}
/* 全部伏笔条目, 附稳定 id (在 __CAL__ 中的下标) */
function items(){
  var out = [];
  var c = all();
  for(var i = 0; i < c.length; i++){
    if(c[i] && c[i].k === "foreshadowing") out.push({id: i, e: c[i]});
  }
  return out;
}
/* 单条是否已回收: te 有值即视为已回收 */
function isResolved(e){ return e != null && e.te != null && e.te !== ""; }
/* 分组: {resolved:[], unresolved:[]} */
function group(){
  var res = [], unres = [];
  var list = items();
  for(var i = 0; i < list.length; i++){
    if(isResolved(list[i].e)) res.push(list[i]); else unres.push(list[i]);
  }
  return {resolved: res, unresolved: unres};
}
/* 某回目的全部事件 (按 k 分组展示用), ch 为数字回目 */
function chapterOf(ch){
  var out = [];
  var c = all();
  for(var i = 0; i < c.length; i++){
    if(c[i] && c[i].ch === ch) out.push({id: i, e: c[i]});
  }
  out.sort(function(a, b){
    var ta = (a.e.t == null ? 1e9 : a.e.t), tb = (b.e.t == null ? 1e9 : b.e.t);
    return ta - tb;
  });
  return out;
}
/* 状态文案: 已回收 -> "已回收 · 第 X 回兑现"; 未回收 -> "未回收" */
function statusText(e){
  if(isResolved(e)) return "已回收" + (e.ch != null ? " · 第 " + e.ch + " 回兑现" : "");
  return "未回收";
}
/* 伏笔涉及人物展示 */
function peopleText(e){
  var c = (e && e.c) || [];
  if(!c.length && e && e.sub) return String(e.sub);
  return c.join("、");
}

return {all: all, items: items, isResolved: isResolved, group: group,
  chapterOf: chapterOf, statusText: statusText, peopleText: peopleText};
})();
if(typeof module !== "undefined" && module.exports) module.exports = RP_FORE;
