/* Soul 数据层扩展 (100条挖掘 A组 1-15)
 * 快照/版本/标签/统计/克隆/合并/重置/锁定/审计等 */

var RP_SOUL_DATA = (function(){
"use strict";

function _soul(card){
  try{ return (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(card) : null; }
  catch(e){ return null; }
}
function _now(){ return new Date().toISOString(); }

/* 1. 版本迁移: schema_version 升级时自动补字段 */
var CURRENT_V = 3;
function migrate(card){
  var soul = _soul(card);
  if(!soul) return {ok: false, reason: "no_soul"};
  var v = soul.schema_version || 1;
  var changed = [];
  if(v < 2){
    if(!soul.character_book){ soul.character_book = []; changed.push("character_book"); }
    v = 2;
  }
  if(v < 3){
    if(!soul.snapshots){ soul.snapshots = []; changed.push("snapshots"); }
    if(!soul.tags){ soul.tags = []; changed.push("tags"); }
    if(!soul.audit){ soul.audit = []; changed.push("audit"); }
    if(soul.locked === undefined){ soul.locked = false; changed.push("locked"); }
    v = 3;
  }
  soul.schema_version = CURRENT_V;
  if(changed.length) audit(card, "migrate", "v" + v + ": +" + changed.join(","));
  return {ok: true, from: soul.schema_version, changed: changed};
}

/* 2. 快照: 手动存档点 */
function snapshot(card, label){
  var soul = _soul(card);
  if(!soul) return {ok: false};
  soul.snapshots = soul.snapshots || [];
  /* 深拷贝 (去 snapshots 避免递归) */
  var copy = JSON.parse(JSON.stringify(soul));
  delete copy.snapshots;
  soul.snapshots.push({t: _now(), label: String(label || "").slice(0, 50), data: copy});
  if(soul.snapshots.length > 10) soul.snapshots.shift();
  audit(card, "snapshot", label || "");
  return {ok: true, count: soul.snapshots.length};
}

/* 3. 回滚到快照 */
function rollback(card, idx){
  var soul = _soul(card);
  if(!soul || !soul.snapshots || !soul.snapshots[idx]) return {ok: false};
  var snap = soul.snapshots[idx];
  var keepSnaps = soul.snapshots;
  var restored = JSON.parse(JSON.stringify(snap.data));
  restored.snapshots = keepSnaps;
  /* 写回 card.extensions.soul */
  card.extensions = card.extensions || {};
  card.extensions.soul = restored;
  audit(card, "rollback", snap.label || ("#" + idx));
  return {ok: true};
}

/* 4. 快照 diff: 比较两个快照的关键字段 */
function diffSnapshots(card, i, j){
  var soul = _soul(card);
  if(!soul || !soul.snapshots) return null;
  var a = soul.snapshots[i], b = soul.snapshots[j];
  if(!a || !b) return null;
  var diff = [];
  function cmp(path, va, vb){
    var sa = JSON.stringify(va), sb = JSON.stringify(vb);
    if(sa !== sb) diff.push({field: path, from: sa.slice(0, 100), to: sb.slice(0, 100)});
  }
  cmp("soul_md", a.data.soul_md, b.data.soul_md);
  cmp("traits", (a.data.persona || {}).core_traits, (b.data.persona || {}).core_traits);
  cmp("facts", ((a.data.memory || {}).long_term || {}).facts, ((b.data.memory || {}).long_term || {}).facts);
  cmp("trajectory_len", (a.data.trajectory || []).length, (b.data.trajectory || []).length);
  return diff;
}

/* 5. 批量导出: 所有 soul 打包 */
function exportAll(cards){
  var out = {};
  (cards || []).forEach(function(c){
    var s = _soul(c);
    if(s) out[c.name || "unnamed"] = s;
  });
  return out;
}

/* 6. soul 搜索: 按关键词搜特质/记忆/宪章 */
function search(card, keyword){
  var soul = _soul(card);
  if(!soul || !keyword) return [];
  var kw = String(keyword).toLowerCase();
  var hits = [];
  function hit(loc, text){
    if(String(text || "").toLowerCase().indexOf(kw) >= 0) hits.push({loc: loc, text: String(text).slice(0, 80)});
  }
  hit("宪章", soul.soul_md);
  ((soul.persona || {}).core_traits || []).forEach(function(t){
    hit("特质", typeof t === "string" ? t : t.trait);
  });
  ((((soul.memory || {}).long_term || {}).facts) || []).forEach(function(f){
    hit("记忆", typeof f === "string" ? f : f.text);
  });
  (soul.character_book || []).forEach(function(e){ hit("私有书", e.content); });
  return hits;
}

/* 7. 标签 */
function addTag(card, tag){
  var soul = _soul(card);
  if(!soul || !tag) return false;
  soul.tags = soul.tags || [];
  tag = String(tag).slice(0, 20);
  if(soul.tags.indexOf(tag) < 0) soul.tags.push(tag);
  audit(card, "tag_add", tag);
  return true;
}
function removeTag(card, tag){
  var soul = _soul(card);
  if(!soul) return false;
  soul.tags = (soul.tags || []).filter(function(t){ return t !== tag; });
  audit(card, "tag_del", tag);
  return true;
}

/* 8. 用户评分 */
function rate(card, score){
  var soul = _soul(card);
  if(!soul) return false;
  score = Math.max(1, Math.min(5, parseInt(score) || 3));
  soul.ratings = soul.ratings || [];
  soul.ratings.push({t: _now(), score: score});
  if(soul.ratings.length > 50) soul.ratings.shift();
  return true;
}
function avgRating(card){
  var soul = _soul(card);
  var r = (soul && soul.ratings) || [];
  if(!r.length) return 0;
  var sum = r.reduce(function(a, x){ return a + x.score; }, 0);
  return Math.round(sum / r.length * 10) / 10;
}

/* 9. 使用统计 */
function stat(card){
  var soul = _soul(card);
  if(!soul) return null;
  return {
    calls: (soul.stats || {}).calls || 0,
    tokens: (soul.stats || {}).tokens || 0,
    facts: ((((soul.memory || {}).long_term || {}).facts) || []).length,
    trajectory: (soul.trajectory || []).length,
    snapshots: (soul.snapshots || []).length
  };
}
function bumpStat(card, tokens){
  var soul = _soul(card);
  if(!soul) return;
  soul.stats = soul.stats || {calls: 0, tokens: 0};
  soul.stats.calls++;
  soul.stats.tokens += (tokens || 0);
}

/* 10. 收藏/置顶 (存在 card.extensions 上, 不污染 soul) */
function setPinned(card, on){
  card.extensions = card.extensions || {};
  card.extensions.soul_pinned = !!on;
}
function isPinned(card){
  return !!(card.extensions && card.extensions.soul_pinned);
}

/* 11. 克隆 soul */
function clone(card){
  var soul = _soul(card);
  if(!soul) return null;
  var copy = JSON.parse(JSON.stringify(soul));
  copy.cloned_from = _now();
  copy.snapshots = [];
  return copy;
}

/* 12. 合并: 把 B 的记忆/特质并入 A (去重) */
function merge(cardA, cardB){
  var a = _soul(cardA), b = _soul(cardB);
  if(!a || !b) return {ok: false};
  var added = 0;
  /* 合并 facts */
  var af = ((a.memory.long_term || {}).facts) || [];
  var bf = ((b.memory.long_term || {}).facts) || [];
  var seen = {};
  af.forEach(function(f){ seen[typeof f === "string" ? f : f.text] = 1; });
  bf.forEach(function(f){
    var t = typeof f === "string" ? f : f.text;
    if(!seen[t]){ af.push(f); added++; }
  });
  /* 合并 traits */
  var at = (a.persona.core_traits || []).map(function(t){ return typeof t === "string" ? t : t.trait; });
  (b.persona.core_traits || []).forEach(function(t){
    var tn = typeof t === "string" ? t : t.trait;
    if(at.indexOf(tn) < 0){ a.persona.core_traits.push(t); added++; }
  });
  audit(cardA, "merge", "from " + (cardB.name || "?") + " +" + added);
  return {ok: true, added: added};
}

/* 13. 重置: 清空记忆保留人设 */
function resetMemory(card){
  var soul = _soul(card);
  if(!soul) return false;
  snapshot(card, "重置前自动快照");
  soul.memory = {short_term: {context: {}, recent: []}, long_term: {facts: [], emotional: [], by_perspective: {}}};
  soul.trajectory = [];
  audit(card, "reset_memory", "");
  return true;
}

/* 14. 锁定: 防止 AI 改写不可变区 (双保险) */
function setLocked(card, on){
  var soul = _soul(card);
  if(!soul) return false;
  soul.locked = !!on;
  audit(card, on ? "lock" : "unlock", "");
  return true;
}
function isLocked(card){
  var soul = _soul(card);
  return !!(soul && soul.locked);
}

/* 15. 审计日志 */
function audit(card, action, detail){
  var soul = _soul(card);
  if(!soul) return;
  soul.audit = soul.audit || [];
  soul.audit.push({t: _now(), action: String(action), detail: String(detail || "").slice(0, 200)});
  if(soul.audit.length > 100) soul.audit.shift();
}
function getAudit(card, n){
  var soul = _soul(card);
  var a = (soul && soul.audit) || [];
  return a.slice(-(n || 20)).reverse();
}

return {
  migrate: migrate, CURRENT_V: CURRENT_V,
  snapshot: snapshot, rollback: rollback, diffSnapshots: diffSnapshots,
  exportAll: exportAll, search: search,
  addTag: addTag, removeTag: removeTag,
  rate: rate, avgRating: avgRating,
  stat: stat, bumpStat: bumpStat,
  setPinned: setPinned, isPinned: isPinned,
  clone: clone, merge: merge, resetMemory: resetMemory,
  setLocked: setLocked, isLocked: isLocked,
  audit: audit, getAudit: getAudit
};
})();
if(typeof window !== "undefined") window.RP_SOUL_DATA = RP_SOUL_DATA;
if(typeof module !== "undefined") module.exports = RP_SOUL_DATA;
