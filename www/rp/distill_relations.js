/* App 端关系抽取 (2026-10-07): 移植自 novel-distill/novel_distill/relations.py。
 * 规则层: 同句共现 + 前向3句内明确交互。LLM 丰富化: 核心角色对提炼关系。
 */
var DISTILL_RELATIONS = (function(){
"use strict";

var DIALOG_MARK = /[“”\"]|说|道|问|答|笑|喊|骂|应|叹|低声|大声/;
var ACTION_MARK = /看|望|盯|拉|抱|打|推|递|给|搀|扶|吻|拥|指|拍/;

function sentencesOf(text){
  return text.split(/(?<=[。！？…])|(?<=\n)/).map(function(s){ return s.trim(); }).filter(Boolean);
}

function findMentions(sent, nameToCanon){
  var found = {};
  Object.keys(nameToCanon).forEach(function(surface){
    if(surface && sent.indexOf(surface) >= 0) found[nameToCanon[surface]] = true;
  });
  return Object.keys(found);
}

function extractPairs(chunks, characters, aliasMap, opts){
  opts = opts || {};
  var window = opts.forwardWindow || 3;
  var minCo = opts.minCooccur || 2;
  var minCh = opts.minChapters || 3;  // C2: ≥3 chunk 才算 strong

  var nameToCanon = {};
  Object.keys(aliasMap || {}).forEach(function(a){ nameToCanon[a] = aliasMap[a]; });
  characters.forEach(function(c){ if(!nameToCanon[c]) nameToCanon[c] = c; });
  var core = {};
  characters.forEach(function(c){ core[c] = true; });

  var pairHits = {};
  chunks.forEach(function(ch){
    var sents = sentencesOf(ch.text);
    var mentions = sents.map(function(s){ return findMentions(s, nameToCanon); });
    for(var i = 0; i < mentions.length; i++){
      var mi = mentions[i];
      // 同句共现
      var ms = mi.slice().sort();
      for(var x = 0; x < ms.length; x++){
        for(var y = x + 1; y < ms.length; y++){
          var key = ms[x] + "|" + ms[y];
          var e = pairHits[key] || (pairHits[key] = {count: 0, chapters: {}, evidence: []});
          e.count++;
          e.chapters[ch.id] = true;
          if(e.evidence.length < 6) e.evidence.push(sents[i].slice(0, 200));
        }
      }
      // 前向窗口: 明确交互才算
      for(var j = 1; j <= window; j++){
        if(i + j >= sents.length) break;
        var mj = mentions[i + j];
        if(!mi.length || !mj.length) continue;
        var winText = sents.slice(i, i + j + 1).join("");
        if(!DIALOG_MARK.test(winText) && !ACTION_MARK.test(winText)) continue;
        mi.forEach(function(a){
          mj.forEach(function(b){
            if(a === b) return;
            var k = [a, b].sort().join("|");
            var e2 = pairHits[k] || (pairHits[k] = {count: 0, chapters: {}, evidence: []});
            e2.count++;
            e2.chapters[ch.id] = true;
            if(e2.evidence.length < 6) e2.evidence.push(winText.slice(0, 300));
          });
        });
      }
    }
  });

  // D2: 计算阶段边界 (按chunk位置三等分)
  var chunkIds = chunks.map(function(c){ return c.id; });
  var n = chunkIds.length;
  function stageOf(chunkId){
    var i = chunkIds.indexOf(chunkId);
    if(i < 0) return "unknown";
    if(i < n / 3) return "early";
    if(i < n * 2 / 3) return "mid";
    return "late";
  }

  var edges = [];
  Object.keys(pairHits).sort(function(a, b){ return pairHits[b].count - pairHits[a].count; }).forEach(function(key){
    var parts = key.split("|");
    var a = parts[0], b = parts[1];
    var e = pairHits[key];
    var bothCore = core[a] && core[b];
    if(!bothCore && e.count < minCo) return;
    var chaps = Object.keys(e.chapters).sort();
    // C2: 三档佐证 (dama-cyber: 单chunk孤证降级)
    var level = "isolated";
    if(chaps.length >= minCh) level = "strong";
    else if(chaps.length >= 2) level = "weak";
    edges.push({
      source_character: a,
      target_character: b,
      co_occurrence_count: e.count,
      valid_chapters: chaps.length ? [chaps[0], chaps[chaps.length - 1]] : [],
      corroboration: {chapters: chaps.length, level: level},
      _evidence: e.evidence,
      _both_core: bothCore,
      _isolated: level === "isolated",  // C2: 孤证标记
      // D2: 有效阶段
      valid_stages: (function(){
        var s = {};
        chaps.forEach(function(c){ s[stageOf(c)] = 1; });
        delete s.unknown;
        return Object.keys(s).sort();
      })()
    });
  });
  return edges;
}

async function enrichEdges(edges, onProgress, opts){
  // LLM 丰富化核心角色对
  opts = opts || {};
  var shouldPause = opts.shouldPause || function(){ return false; };
  var coreEdges = edges.filter(function(e){ return e._both_core; });
  for(var i = 0; i < coreEdges.length; i++){
    while(shouldPause()){
      if(onProgress) onProgress(i, coreEdges.length, "已暂停…");
      await new Promise(function(r){ setTimeout(r, 500); });
    }
    var e = coreEdges[i];
    if(onProgress) onProgress(i + 1, coreEdges.length, "丰富关系 " + e.source_character + "-" + e.target_character);
    try{
      var r = await DISTILL_LLM.chat([
        {role: "system", content: "你是关系分析器。根据共现证据提炼人物关系。返回 JSON: {\"relation\": \"关系类型\", \"summary\": \"一句话总结\", \"affinity\": -10到10}"},
        {role: "user", content: JSON.stringify({a: e.source_character, b: e.target_character, evidence: e._evidence.slice(0, 3)})}
      ]);
      var m = r.content.match(/\{[^}]+\}/);
      if(m){
        var d = JSON.parse(m[0]);
        e.relation = d.relation || "";
        e.summary = d.summary || "";
        e.affinity = d.affinity || 0;
      }
    }catch(err){}
  }
  return edges;
}

return {
  extractPairs: extractPairs,
  enrichEdges: enrichEdges,
  sentencesOf: sentencesOf
};
})();
