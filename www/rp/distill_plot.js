/* App 端剧情层 (2026-10-07): 移植自 novel-distill/novel_distill/plot.py。
 * 流程: 逐块梗概 -> 大纲合并 -> 冲突提取 -> 人物弧光 -> 伏笔配对(关键词版)。
 * 伏笔配对用关键词相似度代替 embedding (手机端无本地模型, embedding API 可选)。
 */
var DISTILL_PLOT = (function(){
"use strict";

async function summarizeChunks(chunks, characters, aliasMap, opts){
  opts = opts || {};
  var onProgress = opts.onProgress || function(){};
  var checkpoint = opts.checkpoint || {};
  var shouldPause = opts.shouldPause || function(){ return false; };
  var summaries = [];
  for(var i = 0; i < chunks.length; i++){
    while(shouldPause()){
      onProgress(i, chunks.length, "已暂停…");
      await new Promise(function(r){ setTimeout(r, 500); });
    }
    var ch = chunks[i];
    if(checkpoint["sum_" + ch.id]){
      if(checkpoint["sum_" + ch.id].summary) summaries.push(checkpoint["sum_" + ch.id].summary);
      onProgress(i + 1, chunks.length, "梗概 " + ch.id + " (已缓存)");
      continue;
    }
    onProgress(i + 1, chunks.length, "梗概 " + ch.id);
    try{
      var r = await DISTILL_LLM.chat([
        {role: "system", content: "你是剧情梗概器。从小说片段提取结构化梗概。返回 JSON: {\"events\": [\"事件1\", ...], \"turning_points\": [\"转折点\", ...], \"hooks\": [{\"hook\": \"悬念描述\"}]}"},
        {role: "user", content: JSON.stringify({chunk_id: ch.id, title: ch.title, characters: characters, excerpt: ch.text.slice(0, 6000)})}
      ]);
      var m = r.content.match(/\{[\s\S]*\}/);
      var obj = m ? JSON.parse(m[0]) : {events: [], turning_points: [], hooks: []};
      var summary = {chunk_id: ch.id, title: ch.title, events: obj.events || [],
                     turning_points: obj.turning_points || [], hooks: obj.hooks || []};
      // 兼容 LLM 返回字符串数组的情况
      summary.hooks = summary.hooks.map(function(h){
        if(typeof h === "string") return {hook: h, setup_chunk: ch.id};
        h.setup_chunk = ch.id;
        return h;
      });
      summaries.push(summary);
      checkpoint["sum_" + ch.id] = {summary: summary};
      if(opts.onCheckpoint) opts.onCheckpoint(checkpoint);
    }catch(e){
      onProgress(i + 1, chunks.length, "梗概 " + ch.id + " 失败: " + e.message);
    }
  }
  return summaries;
}

async function buildOutline(summaries, opts){
  opts = opts || {};
  // 分批合并
  var batchSize = 10;
  var sections = [];
  for(var i = 0; i < summaries.length; i += batchSize){
    var batch = summaries.slice(i, i + batchSize);
    if(opts.onProgress) opts.onProgress(i / batchSize + 1, Math.ceil(summaries.length / batchSize), "大纲合并 batch " + (i / batchSize + 1));
    try{
      var r = await DISTILL_LLM.chat([
        {role: "system", content: "你是大纲合并器。把多个章节梗概合并为连贯大纲。返回 JSON: {\"sections\": [{\"title\": \"标题\", \"summary\": \"摘要\"}]}"},
        {role: "user", content: JSON.stringify(batch.map(function(s){ return {chunk_id: s.chunk_id, title: s.title, events: s.events}; }))}
      ]);
      var m = r.content.match(/\{[\s\S]*\}/);
      var obj = m ? JSON.parse(m[0]) : {sections: []};
      sections = sections.concat(obj.sections || []);
    }catch(e){}
  }
  return sections;
}

async function extractConflicts(sections, opts){
  opts = opts || {};
  if(opts.onProgress) opts.onProgress(0, 1, "提取冲突");
  try{
    var r = await DISTILL_LLM.chat([
      {role: "system", content: "你是冲突分析器。从大纲提取核心冲突。返回 JSON: {\"conflicts\": [{\"type\": \"类型\", \"desc\": \"描述\"}]}"},
      {role: "user", content: JSON.stringify(sections.slice(0, 20))}
    ]);
    var m = r.content.match(/\{[\s\S]*\}/);
    var obj = m ? JSON.parse(m[0]) : {conflicts: []};
    return obj.conflicts || [];
  }catch(e){ return []; }
}

async function extractArcs(characters, summaries, opts){
  opts = opts || {};
  var onProgress = opts.onProgress || function(){};
  var arcs = {};
  for(var i = 0; i < characters.length; i++){
    var ch = characters[i];
    onProgress(i + 1, characters.length, "弧光 " + ch);
    // 收集该人物相关事件
    var relevant = [];
    summaries.forEach(function(s){
      (s.events || []).forEach(function(ev){
        if(ev.indexOf(ch) >= 0 && relevant.length < 20) relevant.push(ev);
      });
    });
    if(!relevant.length) continue;
    try{
      var r = await DISTILL_LLM.chat([
        {role: "system", content: "你是人物弧光分析器。根据事件提炼人物成长弧线。返回 JSON: {\"arc_type\": \"类型\", \"arc_start\": \"起点\", \"arc_mid\": \"中点\", \"arc_end\": \"终点\"}"},
        {role: "user", content: JSON.stringify({character: ch, events: relevant})}
      ]);
      var m = r.content.match(/\{[\s\S]*\}/);
      arcs[ch] = m ? JSON.parse(m[0]) : {};
    }catch(e){}
  }
  return arcs;
}

function keywords(text){
  // 简单关键词提取: 2字以上中文词
  var words = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  var freq = {};
  words.forEach(function(w){ freq[w] = (freq[w] || 0) + 1; });
  return Object.keys(freq).filter(function(w){ return freq[w] >= 2; });
}

function pairForeshadowing(summaries, opts){
  // 伏笔配对: 关键词相似度版 (无 embedding 时的降级)
  opts = opts || {};
  var pairs = [];
  var allHooks = [];
  summaries.forEach(function(s){
    (s.hooks || []).forEach(function(h){
      allHooks.push({hook: h.hook || h, setup_chunk: s.chunk_id, setup_idx: summaries.indexOf(s)});
    });
  });
  allHooks.forEach(function(h){
    var hKeys = keywords(h.hook);
    if(!hKeys.length) return;
    var best = null, bestScore = 0;
    summaries.forEach(function(s, si){
      if(si <= h.setup_idx) return; // 只在之后找 payoff
      var sText = (s.events || []).join(" ");
      var score = hKeys.filter(function(k){ return sText.indexOf(k) >= 0; }).length;
      if(score > bestScore){
        bestScore = score;
        best = {payoff_chunk: s.chunk_id, payoff_event: (s.events || [])[0] || ""};
      }
    });
    if(best && bestScore >= 2){
      pairs.push({hook: h.hook, setup_chunk: h.setup_chunk, payoff_chunk: best.payoff_chunk, payoff: best.payoff_event, score: bestScore});
    }
  });
  return pairs;
}

return {
  summarizeChunks: summarizeChunks,
  buildOutline: buildOutline,
  extractConflicts: extractConflicts,
  extractArcs: extractArcs,
  pairForeshadowing: pairForeshadowing
};
})();
