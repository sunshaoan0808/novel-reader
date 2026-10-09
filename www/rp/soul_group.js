/* Soul 群聊编排扩展 (100条挖掘 B组 16-35)
 * 发言顺序/退场入场/分支/私聊/投票/辩论/旁白/接龙/禁言/变速/情绪传染/事件注入等 */

var RP_SOUL_GROUP = (function(){
"use strict";

function _store(k, v){
  try{
    if(v === undefined) return localStorage.getItem(k);
    if(v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }catch(e){ return null; }
}
function _gkey(chatId){ return "nd_soulgroup_" + chatId; }
function _get(chatId){
  try{ return JSON.parse(_store(_gkey(chatId)) || "{}"); }
  catch(e){ return {}; }
}
function _set(chatId, o){
  try{ _store(_gkey(chatId), JSON.stringify(o)); }catch(e){}
}

/* 16. 发言顺序: fixed(固定) / random(随机) / free(自由) */
function setOrder(chatId, mode){ var o = _get(chatId); o.order = mode; _set(chatId, o); }
function getOrder(chatId){ return _get(chatId).order || "free"; }

/* 17. 轮次上限 */
function setMaxTurns(chatId, n){ var o = _get(chatId); o.maxTurns = Math.max(0, parseInt(n) || 0); _set(chatId, o); }
function getMaxTurns(chatId){ return _get(chatId).maxTurns || 0; }
function checkTurnLimit(chatId, turn){
  var max = getMaxTurns(chatId);
  return max > 0 && turn >= max;
}

/* 18. 退场/入场 */
function exitSoul(chatId, name){
  var o = _get(chatId); o.exited = o.exited || [];
  if(o.exited.indexOf(name) < 0) o.exited.push(name);
  _set(chatId, o);
}
function enterSoul(chatId, name){
  var o = _get(chatId); o.exited = (o.exited || []).filter(function(n){ return n !== name; });
  _set(chatId, o);
}
function isExited(chatId, name){ return (_get(chatId).exited || []).indexOf(name) >= 0; }
function activeMembers(chatId, members){
  return (members || []).filter(function(m){ return !isExited(chatId, m); });
}

/* 19. 暂停/恢复 */
function setPaused(chatId, on){ var o = _get(chatId); o.paused = !!on; _set(chatId, o); }
function isPaused(chatId){ return !!_get(chatId).paused; }

/* 20. 分支: 存档当前 history 位置 */
function branch(chatId, history, label){
  var o = _get(chatId); o.branches = o.branches || [];
  o.branches.push({t: new Date().toISOString(), label: String(label || "").slice(0, 50),
    len: (history || []).length});
  if(o.branches.length > 10) o.branches.shift();
  _set(chatId, o);
  return o.branches.length - 1;
}
function getBranches(chatId){ return _get(chatId).branches || []; }

/* 21. 私聊: 标记某两条消息为私聊 (不进群聊 prompt) */
function markPrivate(msg){ msg._private = true; msg._privatePair = msg._privatePair || []; return msg; }
function isPrivate(msg){ return !!msg._private; }
function filterPublic(history){ return (history || []).filter(function(m){ return !m._private; }); }

/* 22. 投票: 发起投票, souls 投票 */
function startVote(chatId, topic, options){
  var o = _get(chatId);
  o.vote = {topic: String(topic).slice(0, 200), options: options || ["赞成", "反对"],
    votes: {}, t: new Date().toISOString(), open: true};
  _set(chatId, o);
  return o.vote;
}
function castVote(chatId, soulName, option){
  var o = _get(chatId);
  if(!o.vote || !o.vote.open) return false;
  o.vote.votes[soulName] = option;
  _set(chatId, o);
  return true;
}
function tallyVote(chatId){
  var o = _get(chatId);
  var v = o.vote;
  if(!v) return null;
  var counts = {};
  Object.keys(v.votes).forEach(function(s){ counts[v.votes[s]] = (counts[v.votes[s]] || 0) + 1; });
  var winner = null, max = 0;
  Object.keys(counts).forEach(function(k){ if(counts[k] > max){ max = counts[k]; winner = k; } });
  v.open = false; v.result = winner;
  _set(chatId, o);
  return {winner: winner, counts: counts, total: Object.keys(v.votes).length};
}
function getVote(chatId){ return _get(chatId).vote || null; }

/* 23. 辩论模式: 指定双方轮流 */
function setDebate(chatId, a, b, rounds){
  var o = _get(chatId);
  o.debate = {a: a, b: b, rounds: rounds || 3, cur: 0, open: true};
  _set(chatId, o);
}
function debateNext(chatId){
  var o = _get(chatId), d = o.debate;
  if(!d || !d.open) return null;
  var speaker = (d.cur % 2 === 0) ? d.a : d.b;
  d.cur++;
  if(d.cur >= d.rounds * 2){ d.open = false; }
  _set(chatId, o);
  return speaker;
}
function endDebate(chatId){ var o = _get(chatId); if(o.debate) o.debate.open = false; _set(chatId, o); }

/* 24. 旁白模式开关 */
function setNarrator(chatId, on){ var o = _get(chatId); o.narrator = !!on; _set(chatId, o); }
function isNarrator(chatId){ return !!_get(chatId).narrator; }

/* 25. 接龙: 下一个发言者 */
function chainNext(chatId, members, lastSpeaker){
  var active = activeMembers(chatId, members);
  if(!active.length) return null;
  var idx = active.indexOf(lastSpeaker);
  return active[(idx + 1) % active.length];
}

/* 26. 禁言 */
function mute(chatId, name){ var o = _get(chatId); o.muted = o.muted || [];
  if(o.muted.indexOf(name) < 0) o.muted.push(name); _set(chatId, o); }
function unmute(chatId, name){ var o = _get(chatId);
  o.muted = (o.muted || []).filter(function(n){ return n !== name; }); _set(chatId, o); }
function isMuted(chatId, name){ return (_get(chatId).muted || []).indexOf(name) >= 0; }

/* 27. 变速: fast(短回复) / normal / slow(长回复) */
function setSpeed(chatId, s){ var o = _get(chatId); o.speed = s; _set(chatId, o); }
function getSpeed(chatId){ return _get(chatId).speed || "normal"; }
function speedMaxTokens(chatId){
  var s = getSpeed(chatId);
  return s === "fast" ? 200 : (s === "slow" ? 1500 : 800);
}

/* 28. 情绪传染: 记录群体情绪 */
function setMood(chatId, mood){ var o = _get(chatId); o.mood = {state: mood, t: new Date().toISOString()}; _set(chatId, o); }
function getMood(chatId){ return (_get(chatId).mood || {}).state || ""; }

/* 29. 事件注入队列 */
function injectEvent(chatId, text){
  var o = _get(chatId); o.events = o.events || [];
  o.events.push({t: new Date().toISOString(), text: String(text).slice(0, 500)});
  _set(chatId, o);
}
function popEvent(chatId){
  var o = _get(chatId);
  var e = (o.events || []).shift();
  _set(chatId, o);
  return e || null;
}
function peekEvents(chatId){ return _get(chatId).events || []; }

/* 30. 记忆共享开关 */
function setShareMem(chatId, on){ var o = _get(chatId); o.shareMem = !!on; _set(chatId, o); }
function isShareMem(chatId){ var v = _get(chatId).shareMem; return v === undefined ? true : !!v; }

/* 31. 存档点 */
function checkpoint(chatId, history){
  var o = _get(chatId); o.checkpoints = o.checkpoints || [];
  o.checkpoints.push({t: new Date().toISOString(), len: (history || []).length,
    snapshot: JSON.stringify((history || []).slice(-50))});
  if(o.checkpoints.length > 5) o.checkpoints.shift();
  _set(chatId, o);
  return o.checkpoints.length - 1;
}

/* 32. 回放数据: 取指定范围的 history */
function replayRange(history, from, to){
  return (history || []).slice(from, to);
}

/* 33. 发言字数限制 */
function setWordLimit(chatId, n){ var o = _get(chatId); o.wordLimit = Math.max(0, parseInt(n) || 0); _set(chatId, o); }
function getWordLimit(chatId){ return _get(chatId).wordLimit || 0; }
function trimToLimit(chatId, text){
  var lim = getWordLimit(chatId);
  if(lim > 0 && text.length > lim) return text.slice(0, lim) + "…";
  return text;
}

/* 34. 敏感词过滤 */
var _badDefault = ["傻逼", "去死"];
function setBadWords(chatId, words){ var o = _get(chatId); o.badWords = words; _set(chatId, o); }
function getBadWords(chatId){ var o = _get(chatId); return o.badWords || _badDefault; }
function filterBad(chatId, text){
  var words = getBadWords(chatId);
  var out = String(text || "");
  words.forEach(function(w){ out = out.split(w).join("**"); });
  return out;
}

/* 35. 自动退场: N 轮没说话自动退场 */
function setAutoExit(chatId, n){ var o = _get(chatId); o.autoExit = Math.max(0, parseInt(n) || 0); _set(chatId, o); }
function checkAutoExit(chatId, members, history, n){
  n = n || 10;
  var limit = _get(chatId).autoExit || 0;
  if(!limit) return [];
  var recent = (history || []).slice(-n);
  var spoken = {};
  recent.forEach(function(m){ if(m.speaker) spoken[m.speaker] = 1; });
  return (members || []).filter(function(m){ return !spoken[m]; });
}

return {
  setOrder: setOrder, getOrder: getOrder,
  setMaxTurns: setMaxTurns, getMaxTurns: getMaxTurns, checkTurnLimit: checkTurnLimit,
  exitSoul: exitSoul, enterSoul: enterSoul, isExited: isExited, activeMembers: activeMembers,
  setPaused: setPaused, isPaused: isPaused,
  branch: branch, getBranches: getBranches,
  markPrivate: markPrivate, isPrivate: isPrivate, filterPublic: filterPublic,
  startVote: startVote, castVote: castVote, tallyVote: tallyVote, getVote: getVote,
  setDebate: setDebate, debateNext: debateNext, endDebate: endDebate,
  setNarrator: setNarrator, isNarrator: isNarrator,
  chainNext: chainNext,
  mute: mute, unmute: unmute, isMuted: isMuted,
  setSpeed: setSpeed, getSpeed: getSpeed, speedMaxTokens: speedMaxTokens,
  setMood: setMood, getMood: getMood,
  injectEvent: injectEvent, popEvent: popEvent, peekEvents: peekEvents,
  setShareMem: setShareMem, isShareMem: isShareMem,
  checkpoint: checkpoint,
  replayRange: replayRange,
  setWordLimit: setWordLimit, getWordLimit: getWordLimit, trimToLimit: trimToLimit,
  setBadWords: setBadWords, getBadWords: getBadWords, filterBad: filterBad,
  setAutoExit: setAutoExit, checkAutoExit: checkAutoExit
};
})();
if(typeof window !== "undefined") window.RP_SOUL_GROUP = RP_SOUL_GROUP;
if(typeof module !== "undefined") module.exports = RP_SOUL_GROUP;
