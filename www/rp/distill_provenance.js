/* 出处索引 (2026-10-07): 借鉴 TavernWeave 来源链。
 * 四态: canon / ref / inference / unknown
 * 每条事实: {field, value, source, chunk_id, certainty}
 */
var DISTILL_PROVENANCE = (function(){
"use strict";

// 从标注文本提取来源: [canon:ch001] [ref:ch002] [inference:ch003] [unknown]
var SOURCE_RE = /\[(canon|ref|inference|unknown)(?::([a-z0-9_\-]+))?\]/gi;

function parseAnnotated(text){
  // 返回 [{text, source, chunk_id}]
  var out = [], last = 0, m;
  SOURCE_RE.lastIndex = 0;
  while((m = SOURCE_RE.exec(text))){
    var before = text.slice(last, m.index).trim();
    if(before) out.push({text: before, source: m[1].toLowerCase(), chunk_id: m[2] || null});
    last = m.index + m[0].length;
  }
  var tail = text.slice(last).trim();
  if(tail) out.push({text: tail, source: "unknown", chunk_id: null});
  return out;
}

function buildIndex(pkgId, characters){
  // 为剧本包构建 provenance.json
  var index = {
    package: pkgId,
    built: Date.now(),
    facts: []  // {character, field, value, source, chunk_id}
  };
  characters.forEach(function(name){
    var card = DISTILL_PACKAGE.getCharacterCard(pkgId, name);
    if(!card || !card._distill) return;
    Object.keys(card._distill).forEach(function(field){
      var val = card._distill[field];
      if(!val || typeof val !== "string") return;
      parseAnnotated(val).forEach(function(f){
        index.facts.push({
          character: name,
          field: field,
          value: f.text.slice(0, 200),
          source: f.source,
          chunk_id: f.chunk_id
        });
      });
    });
  });
  DISTILL_PACKAGE.saveData(pkgId, "provenance", index);
  return index;
}

function stats(index){
  var s = {canon: 0, ref: 0, inference: 0, unknown: 0};
  index.facts.forEach(function(f){ s[f.source] = (s[f.source] || 0) + 1; });
  return s;
}

// 引用存在性校验: 检查事实引用的 chunk_id 是否真实存在
// validChunkIds: string[] (如 ["ch001", "ch002-1", ...])
// 返回: 引用了不存在 chunk 的事实列表
function validateCitations(index, validChunkIds){
  var idSet = {};
  (validChunkIds || []).forEach(function(id){ idSet[id] = true; });
  return index.facts.filter(function(f){
    return f.chunk_id && !idSet[f.chunk_id];
  });
}

var SOURCE_LABEL = {
  canon: "原文实证",
  ref: "间接旁证",
  inference: "合理推断",
  unknown: "无依据"
};

var SOURCE_COLOR = {
  canon: "var(--gold)",
  ref: "#7fb3d5",
  inference: "#f0ad4e",
  unknown: "var(--ink-faint)"
};

return {
  parseAnnotated: parseAnnotated,
  buildIndex: buildIndex,
  stats: stats,
  validateCitations: validateCitations,
  SOURCE_LABEL: SOURCE_LABEL,
  SOURCE_COLOR: SOURCE_COLOR
};
})();
