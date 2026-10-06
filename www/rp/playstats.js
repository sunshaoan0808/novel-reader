/* 游玩统计（纯本地）: 开局次数 / 对话轮数 / token 估算 / 收藏 / 点赞
 *
 * - 纯自用，无服务器、无账号、无付费。数据只存本机 localStorage["nd_playstats_v1"]。
 * - token 均为估算值（CJK 约 1.5 字/token，ASCII 约 4 字/token），展示时一律带"约"。
 * - 一轮 = 一次用户发送 + 一次 AI 回复；regenerate 重抽只记 token，不记轮数。
 * - 埋点：单聊 RP.send()/regenerate()（chat.js）、空历史进聊天=开局（app.js showChat）。
 * - TODO: 穿越聊天（sendTraverse）与群聊暂未接入。
 */
var RP_STATS = (function(){
"use strict";
var KEY = "nd_playstats_v1";
function load(){
  try{ var d = JSON.parse(localStorage.getItem(KEY)); return (d && typeof d === "object") ? d : {}; }
  catch(e){ return {}; }
}
function save(d){ try{ localStorage.setItem(KEY, JSON.stringify(d)); }catch(e){} }
function kk(runId, name){ return String(runId) + "|" + String(name); }
function blank(){ return {s:0, t:0, pi:0, po:0, fav:0, like:0, first:0, last:0}; }
function get(runId, name){ var d = load(); return d[kk(runId, name)] || blank(); }
/* token 估算：CJK/全角标点按 1.5 字/token，ASCII 按 4 字/token */
function estTokens(text){
  if(text == null) return 0;
  var s = String(text); if(!s) return 0;
  var cjk = 0, asc = 0, i, c;
  for(i = 0; i < s.length; i++){
    c = s.charCodeAt(i);
    if(c > 0x2E7F || (c >= 0x3000 && c <= 0x303F)) cjk++; else asc++;
  }
  return Math.max(1, Math.round(cjk / 1.5 + asc / 4));
}
function touch(st){ var n = Date.now(); st.last = n; if(!st.first) st.first = n; return st; }
/* 开局：空历史进入聊天记一次 */
function recordSession(runId, name){
  var d = load(), k = kk(runId, name), st = d[k] || blank();
  st.s++; touch(st); d[k] = st; save(d); return st;
}
/* 一轮：swipe=true（重抽）只记 token，不记轮数 */
function recordTurn(runId, name, promptText, replyText, swipe){
  var d = load(), k = kk(runId, name), st = d[k] || blank();
  if(!swipe) st.t++;
  st.pi += estTokens(promptText);
  st.po += estTokens(replyText);
  touch(st); d[k] = st; save(d); return st;
}
function toggleFav(runId, name){
  var d = load(), k = kk(runId, name), st = d[k] || blank();
  st.fav = st.fav ? 0 : 1; touch(st); d[k] = st; save(d); return st.fav;
}
function toggleLike(runId, name){
  var d = load(), k = kk(runId, name), st = d[k] || blank();
  st.like = st.like ? 0 : 1; touch(st); d[k] = st; save(d); return st.like;
}
function avgTurns(st){ st = st || blank(); return st.s > 0 ? st.t / st.s : 0; }
/* 数字缩写：34189000 -> "3418.9万"，20000 -> "2万" */
function fmt(n){
  n = Math.round(n || 0);
  if(n >= 10000){ var v = (n / 10000).toFixed(1).replace(/\.0$/, ""); return v + "万"; }
  return String(n);
}
return {
  get: get, recordSession: recordSession, recordTurn: recordTurn,
  toggleFav: toggleFav, toggleLike: toggleLike,
  estTokens: estTokens, avgTurns: avgTurns, fmt: fmt,
  _key: kk, _blank: blank
};
})();
