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

## 来源标注 (四态, 借鉴 TavernWeave)
每个事实后必须标注来源状态:
- [canon:chunk_id] 原文有直接证据 (如: "黛玉葬花" [canon:ch003])
- [ref:chunk_id] 间接/旁证 (他人转述、侧面描写)
- [inference:chunk_id] 基于原文的合理推断 (需有依据, 不能凭空编)
- [unknown] 原文无依据, 不写内容, 字段留空

## 规则
1. 优先写 [canon], 其次 [ref], 谨慎用 [inference]
2. 证据不足的字段留空, 不写"未知"等占位词
3. 禁止编造原文没有的情节、人名、对话
4. 引用核验只能证明原句存在, 不能自动证明结论正确 —— 推断要保守
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
  return {md: r.content, chunkId: chunk.id, character: character, stage: chunk.stage || "mid"};
}

function parseProfile(md){
  // 简单解析 md 为字段对象
  var fields = {};
  var lines = md.split("\n");
  var curKey = null, curVal = [];
  for(var i = 0; i < lines.length; i++){
    var m = lines[i].match(/^-\s*\*\*([a-z_]+)\*\*:\s*(.*)$/) ||
            lines[i].match(/^-\s*([a-z_]+):\s*(.*)$/);
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
  // 合并多块的档案: 按阶段分组, 每阶段取最长非空值 (防剧透)
  var merged = {};
  var byStage = {early: [], mid: [], late: []};
  profileList.forEach(function(p){
    var st = p.stage || "mid";
    if(byStage[st]) byStage[st].push(p);
  });
  var keys = ["core_identity", "brief_intro", "core_traits", "speech_style", "typical_lines",
              "background", "soul_goal", "key_bonds", "evidence",
              "age", "gender", "height", "ethnicity",
              "likes", "dislikes", "interests", "fears"];
  ["early", "mid", "late"].forEach(function(st){
    merged[st] = {};
    keys.forEach(function(k){
      var best = "";
      byStage[st].forEach(function(p){
        var v = (p.fields[k] || "").trim();
        if(v.length > best.length) best = v;
      });
      merged[st][k] = best;
    });
  });
  // 兼容: 顶层为全量合并 (取 late)
  keys.forEach(function(k){ merged[k] = merged.late[k] || merged.mid[k] || merged.early[k] || ""; });
  return merged;
}

async function distillNovel(chunks, characters, opts){
  opts = opts || {};
  var onProgress = opts.onProgress || function(){};
  var checkpoint = opts.checkpoint || {};
  var shouldPause = opts.shouldPause || function(){ return false; };
  async function waitPause(){
    while(shouldPause()){
      onProgress(done, total, "已暂停…");
      await new Promise(function(r){ setTimeout(r, 500); });
    }
  }
  var results = {};
  var total = chunks.length * characters.length;
  var done = 0;

  for(var ci = 0; ci < chunks.length; ci++){
    var chunk = chunks[ci];
    for(var hi = 0; hi < characters.length; hi++){
      await waitPause();
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
        results[ch].push({fields: fields, chunkId: chunk.id, md: r.md, stage: r.stage});
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
