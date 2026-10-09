/* Soul 记忆系统扩展 (100条挖掘 C组 36-50)
 * 重要性/归档/搜索/时间线/冲突/可信度/共享池/遗忘/标签/导出/幻觉检测/引用/集体/优先级/容量 */

var RP_SOUL_MEM = (function(){
"use strict";

function _lt(card){
  try{
    var soul = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(card) : null;
    if(!soul) return null;
    soul.memory = soul.memory || {};
    soul.memory.long_term = soul.memory.long_term || {facts: [], emotional: [], by_perspective: {}};
    return soul.memory.long_term;
  }catch(e){ return null; }
}
function _text(f){ return typeof f === "string" ? f : (f.text || ""); }

/* 36. 重要性评分 (0-100, 按长度/关键词/感叹) */
function importance(text){
  var t = String(text || "");
  var s = 50;
  if(t.length > 100) s += 10;
  if(/[！!？?]/.test(t)) s += 10;
  ["第一次", "永远", "决定", "秘密", "死亡", "爱"].forEach(function(w){
    if(t.indexOf(w) >= 0) s += 5;
  });
  return Math.min(100, s);
}
function addFactScored(card, soulName, text){
  var lt = _lt(card);
  if(!lt) return false;
  lt.facts = lt.facts || [];
  lt.facts.push({t: new Date().toISOString(), text: String(text).slice(0, 500),
    importance: importance(text), by: soulName || "shared"});
  return true;
}

/* 37. 自动归档: 重要性<30 且 30 天前的记忆压缩 */
function archiveOld(card, days){
  var lt = _lt(card);
  if(!lt) return 0;
  days = days || 30;
  var cutoff = Date.now() - days * 864e5;
  var kept = [], archived = 0;
  (lt.facts || []).forEach(function(f){
    var ft = new Date(f.t || 0).getTime();
    if(ft < cutoff && (f.importance || 50) < 30){ archived++; }
    else kept.push(f);
  });
  lt.facts = kept;
  lt.archived_count = (lt.archived_count || 0) + archived;
  return archived;
}

/* 38. 记忆搜索 */
function searchMem(card, keyword){
  var lt = _lt(card);
  if(!lt || !keyword) return [];
  var kw = String(keyword).toLowerCase();
  return (lt.facts || []).filter(function(f){
    return _text(f).toLowerCase().indexOf(kw) >= 0;
  });
}

/* 39. 时间线: 按时间排序的记忆 */
function timeline(card, n){
  var lt = _lt(card);
  if(!lt) return [];
  var all = (lt.facts || []).slice().sort(function(a, b){
    return new Date(a.t || 0) - new Date(b.t || 0);
  });
  return n ? all.slice(-n) : all;
}

/* 40. 冲突检测: 两条记忆语义矛盾 (关键词反义) */
var ANTONYMS = [["喜欢", "讨厌"], ["爱", "恨"], ["活着", "死了"], ["记得", "忘了"], ["是", "不是"]];
function detectConflicts(card){
  var lt = _lt(card);
  if(!lt) return [];
  var facts = lt.facts || [];
  var conflicts = [];
  for(var i = 0; i < facts.length; i++){
    for(var j = i + 1; j < facts.length; j++){
      var a = _text(facts[i]), b = _text(facts[j]);
      for(var k = 0; k < ANTONYMS.length; k++){
        var w1 = ANTONYMS[k][0], w2 = ANTONYMS[k][1];
        if((a.indexOf(w1) >= 0 && b.indexOf(w2) >= 0) || (a.indexOf(w2) >= 0 && b.indexOf(w1) >= 0)){
          /* 主语相同才算冲突 (简化: 都含同一人名) */
          conflicts.push({a: a.slice(0, 60), b: b.slice(0, 60), words: ANTONYMS[k]});
          break;
        }
      }
    }
  }
  return conflicts;
}

/* 41. 可信度: fact 可信度标记 */
function setCredibility(card, idx, level){
  var lt = _lt(card);
  if(!lt || !lt.facts[idx]) return false;
  /* level: certain(确定) / inferred(推测) / hearsay(听说) */
  if(typeof lt.facts[idx] === "string") lt.facts[idx] = {t: new Date().toISOString(), text: lt.facts[idx]};
  lt.facts[idx].cred = level;
  return true;
}

/* 42. 共享池: 跨 soul 的共享记忆 */
function sharedPoolKey(chatId){ return "nd_soul_sharedpool_" + chatId; }
function poolAdd(chatId, text){
  try{
    var k = sharedPoolKey(chatId);
    var arr = JSON.parse(localStorage.getItem(k) || "[]");
    arr.push({t: new Date().toISOString(), text: String(text).slice(0, 500)});
    if(arr.length > 100) arr.shift();
    localStorage.setItem(k, JSON.stringify(arr));
    return true;
  }catch(e){ return false; }
}
function poolGet(chatId){
  try{ return JSON.parse(localStorage.getItem(sharedPoolKey(chatId)) || "[]"); }
  catch(e){ return []; }
}

/* 43. 遗忘曲线: 按时间衰减重要性 */
function decay(card){
  var lt = _lt(card);
  if(!lt) return 0;
  var now = Date.now(), decayed = 0;
  (lt.facts || []).forEach(function(f){
    if(typeof f === "string") return;
    var age = (now - new Date(f.t || 0).getTime()) / 864e5; /* 天 */
    var imp = f.importance || 50;
    /* 每天衰减 1, 最低 10 */
    var ni = Math.max(10, imp - Math.floor(age));
    if(ni !== imp){ f.importance = ni; decayed++; }
  });
  return decayed;
}

/* 44. 记忆标签 */
function tagFact(card, idx, tag){
  var lt = _lt(card);
  if(!lt || !lt.facts[idx]) return false;
  if(typeof lt.facts[idx] === "string") lt.facts[idx] = {t: new Date().toISOString(), text: lt.facts[idx]};
  lt.facts[idx].tags = lt.facts[idx].tags || [];
  if(lt.facts[idx].tags.indexOf(tag) < 0) lt.facts[idx].tags.push(tag);
  return true;
}

/* 45. 记忆导出 */
function exportMem(card){
  var lt = _lt(card);
  if(!lt) return [];
  return (lt.facts || []).map(function(f){
    return {t: f.t || "", text: _text(f), importance: f.importance || 50,
      cred: f.cred || "certain", tags: f.tags || []};
  });
}

/* 46. 幻觉检测: 记忆与 persona 矛盾 */
function detectHallucination(card){
  var lt = _lt(card);
  if(!lt) return [];
  var soul = null;
  try{ soul = RP_SOUL.getSoul(card); }catch(e){}
  if(!soul) return [];
  var traits = ((soul.persona || {}).core_traits || []).map(function(t){
    return (typeof t === "string" ? t : t.trait || "").toLowerCase();
  });
  return (lt.facts || []).filter(function(f){
    var t = _text(f).toLowerCase();
    /* 如 persona 说"内向"但记忆说"在众人面前演讲" -> 可疑 */
    if(traits.indexOf("内向") >= 0 && t.indexOf("演讲") >= 0) return true;
    if(traits.indexOf("诚实") >= 0 && t.indexOf("撒谎") >= 0) return true;
    return false;
  }).map(function(f){ return _text(f).slice(0, 80); });
}

/* 47. 记忆引用: 回复时标注来源记忆 */
function citeSource(card, replyText){
  var lt = _lt(card);
  if(!lt) return [];
  var t = String(replyText || "").toLowerCase();
  return (lt.facts || []).filter(function(f){
    var ft = _text(f).toLowerCase();
    /* 回复中出现了记忆里的关键词 */
    var words = ft.split(/[,，。！？\s]+/).filter(function(w){ return w.length > 3; });
    return words.some(function(w){ return t.indexOf(w) >= 0; });
  }).slice(0, 3).map(function(f){ return _text(f).slice(0, 60); });
}

/* 48. 集体记忆: 多个 soul 都记得的事实 */
function collective(cards){
  var counts = {};
  (cards || []).forEach(function(c){
    var lt = _lt(c);
    (lt.facts || []).forEach(function(f){
      var t = _text(f);
      counts[t] = (counts[t] || 0) + 1;
    });
  });
  return Object.keys(counts).filter(function(k){ return counts[k] > 1; })
    .map(function(k){ return {text: k.slice(0, 80), count: counts[k]}; });
}

/* 49. 优先级排序: 重要性高的先注入 */
function prioritized(card, n){
  var lt = _lt(card);
  if(!lt) return [];
  return (lt.facts || []).slice()
    .sort(function(a, b){ return (b.importance || 50) - (a.importance || 50); })
    .slice(0, n || 10);
}

/* 50. 容量警告 */
var MEM_LIMIT = 200;
function capacity(card){
  var lt = _lt(card);
  var n = ((lt && lt.facts) || []).length;
  return {used: n, limit: MEM_LIMIT, pct: Math.round(n / MEM_LIMIT * 100),
    warn: n >= MEM_LIMIT * 0.9};
}

return {
  importance: importance, addFactScored: addFactScored,
  archiveOld: archiveOld, searchMem: searchMem, timeline: timeline,
  detectConflicts: detectConflicts, setCredibility: setCredibility,
  poolAdd: poolAdd, poolGet: poolGet,
  decay: decay, tagFact: tagFact, exportMem: exportMem,
  detectHallucination: detectHallucination, citeSource: citeSource,
  collective: collective, prioritized: prioritized,
  capacity: capacity, MEM_LIMIT: MEM_LIMIT
};
})();
if(typeof window !== "undefined") window.RP_SOUL_MEM = RP_SOUL_MEM;
if(typeof module !== "undefined") module.exports = RP_SOUL_MEM;
