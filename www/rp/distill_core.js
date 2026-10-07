/* App 端蒸馏核心 (2026-10-07): 移植自 novel-distill。
 * 流程: chunks -> 每人物每块蒸馏 -> 合并档案。
 * 为手机优化: 简化字段, 流式进度, localStorage 断点续跑。
 */
var DISTILL_CORE = (function(){
"use strict";

var SYSTEM_PROMPT = `你是小说人物档案蒸馏器。从小说正文片段中提取指定人物的结构化档案。

## 输出格式 (Markdown)
- core_identity: 一句话身份定位
- core_traits: 核心性格特征 (逗号分隔, 最多5个)
- speech_style: 说话方式描述
- typical_lines: 典型台词 (最多3句, 每句40字内)
- background: 背景经历摘要
- soul_goal: 核心追求
- key_bonds: 关键人物关系 (逗号分隔)
- evidence: 关键证据原文引用 (最多3条)

## 规则
1. 只写正文中有直接依据的内容, 禁止编造、脑补
2. 证据不足的字段留空, 不写"未知"等占位词
3. 每个事实后标注来源 [chunk_id]
4. 无原文依据的内容标注 [推测]
`;

async function distillOne(chunk, character, onProgress){
  var user = JSON.stringify({
    excerpt: chunk.text.slice(0, 6000),
    chunk_id: chunk.id,
    character: character
  }, null, 1);
  var r = await DISTILL_LLM.chat([
    {role: "system", content: SYSTEM_PROMPT},
    {role: "user", content: user}
  ]);
  return {md: r.content, chunkId: chunk.id, character: character};
}

function parseProfile(md){
  // 简单解析 md 为字段对象
  var fields = {};
  var lines = md.split("\n");
  var curKey = null, curVal = [];
  for(var i = 0; i < lines.length; i++){
    var m = lines[i].match(/^-\s*([a-z_]+):\s*(.*)$/);
    if(m){
      if(curKey) fields[curKey] = curVal.join("\n").trim();
      curKey = m[1]; curVal = [m[2]];
    }else if(curKey){
      curVal.push(lines[i]);
    }
  }
  if(curKey) fields[curKey] = curVal.join("\n").trim();
  return fields;
}

function mergeProfiles(profileList){
  // 合并多块的档案: 简单策略, 取最长的非空值
  var merged = {};
  var keys = ["core_identity", "core_traits", "speech_style", "typical_lines",
              "background", "soul_goal", "key_bonds", "evidence"];
  keys.forEach(function(k){
    var best = "";
    profileList.forEach(function(p){
      var v = (p.fields[k] || "").trim();
      if(v.length > best.length) best = v;
    });
    merged[k] = best;
  });
  return merged;
}

async function distillNovel(chunks, characters, opts){
  opts = opts || {};
  var onProgress = opts.onProgress || function(){};
  var checkpoint = opts.checkpoint || {};
  var results = {};
  var total = chunks.length * characters.length;
  var done = 0;

  for(var ci = 0; ci < chunks.length; ci++){
    var chunk = chunks[ci];
    for(var hi = 0; hi < characters.length; hi++){
      var ch = characters[hi];
      var key = chunk.id + "|" + ch;
      if(checkpoint[key]){
        done++;
        continue;
      }
      // 只蒸馏本块出现的人物 (简单: 名字在文本中)
      if(chunk.text.indexOf(ch) < 0){
        done++;
        onProgress(done, total, "跳过 " + ch + " @ " + chunk.id + " (未出现)");
        continue;
      }
      onProgress(done, total, "蒸馏 " + ch + " @ " + chunk.id);
      try{
        var r = await distillOne(chunk, ch);
        var fields = parseProfile(r.md);
        if(!results[ch]) results[ch] = [];
        results[ch].push({fields: fields, chunkId: chunk.id, md: r.md});
        checkpoint[key] = true;
        if(opts.onCheckpoint) opts.onCheckpoint(checkpoint);
      }catch(e){
        onProgress(done, total, "失败 " + ch + " @ " + chunk.id + ": " + e.message);
      }
      done++;
    }
  }

  // 合并
  var final = {};
  characters.forEach(function(ch){
    if(results[ch] && results[ch].length){
      final[ch] = {
        fields: mergeProfiles(results[ch]),
        chunks: results[ch].length,
        details: results[ch]
      };
    }
  });
  return final;
}

return {
  distillOne: distillOne,
  distillNovel: distillNovel,
  parseProfile: parseProfile,
  SYSTEM_PROMPT: SYSTEM_PROMPT
};
})();
