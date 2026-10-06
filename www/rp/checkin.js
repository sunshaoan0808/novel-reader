/* 每日签到（P2）：纯本地、无货币、无奖励兑换，纪念性质（对标成就"纯粹纪念"）。
 * 数据只存本机 localStorage["nd_checkin_v1"] = {"YYYY-MM-DD": 1}。
 */
var RP_CHECKIN = (function(){
"use strict";
var KEY = "nd_checkin_v1";
function load(){
  try{ var d = JSON.parse(localStorage.getItem(KEY)); return (d && typeof d === "object") ? d : {}; }
  catch(e){ return {}; }
}
function save(d){ try{ localStorage.setItem(KEY, JSON.stringify(d)); }catch(e){} }
function fmt(d){
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}
function todayStr(){ return fmt(new Date()); }
function hasToday(){ return !!load()[todayStr()]; }
/* 连击：以今天（未签到则以昨天为锚点）往前数连续天数 */
function streak(){
  var d = load(), s = 0, cur = new Date();
  if(!d[fmt(cur)]) cur.setDate(cur.getDate() - 1);
  while(d[fmt(cur)]){ s++; cur.setDate(cur.getDate() - 1); }
  return s;
}
function total(){ return Object.keys(load()).length; }
function checkin(){
  var d = load(), t = todayStr();
  if(d[t]) return {isNew: false, streak: streak(), total: total()};
  d[t] = 1; save(d);
  return {isNew: true, streak: streak(), total: total()};
}
/* 月历矩阵：返回 {weeks:[[day|null...]]}，周一起 */
function monthCells(y, m){
  var first = new Date(y, m, 1);
  var start = (first.getDay() + 6) % 7; /* 周一=0 */
  var days = new Date(y, m + 1, 0).getDate();
  var cells = [], i;
  for(i = 0; i < start; i++) cells.push(null);
  for(i = 1; i <= days; i++) cells.push(i);
  while(cells.length % 7) cells.push(null);
  return cells;
}
function signedSet(y, m){
  var d = load(), out = {}, p = y + "-" + (m + 1 < 10 ? "0" + (m + 1) : (m + 1)) + "-";
  Object.keys(d).forEach(function(k){ if(k.indexOf(p) === 0) out[+k.slice(8)] = 1; });
  return out;
}
return {
  todayStr: todayStr, hasToday: hasToday, checkin: checkin,
  streak: streak, total: total, monthCells: monthCells, signedSet: signedSet
};
})();
