/* 世界书生成 (2026-10-07): 借鉴 TavernWeave + dama-cyber。
* 从小说正文提取世界观规则、重要场景、势力组织。
* 每条规则 7 字段 (dama-cyber): 规则/代价/限制/例外/剧情用途/升级路径/冲突钩子
* 冲突钩子天然链接到关系边。
*/
var DISTILL_WORLDBOOK = (function(){
"use strict";

// 从 chunk 梗概中提取世界书条目
async function extractWorldbook(summaries, characters, opts){
opts = opts || {};
var onProgress = opts.onProgress || function(){};
var shouldPause = opts.shouldPause || function(){ return false;};

// 合并所有梗概的文本，取关键信息
var allText = summaries.map(function(s){
return "" + (s.events || []).join("；");
}).join("\n").slice(0, 12000);

onProgress(0, 1, "提取世界观...");
while(shouldPause()){
onProgress(0, 1, "已暂停…");
await new Promise(function(r){ setTimeout(r, 500);});
}

try{
var r = await DISTILL_LLM.chat([
{role: "system", content:
"你是小说世界观提取器。从剧情梗概中提取世界书条目。\n" +
"返回 JSON: {\n" +
" \"rules\": [{\"name\": \"规则名\", \"rule\": \"规则内容\", \"cost\": \"代价\", \"limit\": \"限制\", \"exception\": \"例外\", \"plot_use\": \"剧情用途\", \"conflict_hook\": \"哪个角色会因此产生冲突\", \"source\": \"来源chunk\"}],\n" +
" \"locations\": [{\"name\": \"地名\", \"desc\": \"描述\", \"source\": \"来源chunk\"}],\n" +
" \"factions\": [{\"name\": \"势力名\", \"desc\": \"描述\", \"members\": [\"成员\"], \"source\": \"来源chunk\"}]\n" +
"}\n" +
"只提取文本中明确提到或强烈暗示的，不要编造。没有就不返回空数组。"},
{role: "user", content: JSON.stringify({
characters: characters,
summaries: allText
})}
]);
var m = r.content.match(/\{[\s\S]*\}/);
if(!m) throw new Error("格式错误");
var obj = JSON.parse(m[0]);
return {
rules: obj.rules || [],
locations: obj.locations || [],
factions: obj.factions || [],
built: Date.now()
};
}catch(e){
onProgress(0, 1, "世界书提取失败: " + e.message);
return {rules: [], locations: [], factions: [], built: Date.now(), error: e.message};
}
}

// 世界书条目转 SillyTavern lorebook 格式 (复用)
// C6: Lorebook 触发条件 (Character.AI)
// 条目可按事件/地点/配角触发：trigger: {events:[], locations:[], characters:[]}
function matchTrigger(entry, context){
  context = context || {};
  var t = entry.trigger || {};
  // 无触发条件 = 常驻
  if(!t.events && !t.locations && !t.characters) return true;
  if(t.events && t.events.length){
    var hit = (context.events || []).some(function(e){
      return t.events.some(function(te){ return e.indexOf(te) >= 0 || te.indexOf(e) >= 0; });
    });
    if(!hit) return false;
  }
  if(t.locations && t.locations.length){
    var hit2 = (context.locations || []).some(function(l){
      return t.locations.indexOf(l) >= 0;
    });
    if(!hit2) return false;
  }
  if(t.characters && t.characters.length){
    var hit3 = (context.characters || []).some(function(c){
      return t.characters.indexOf(c) >= 0;
    });
    if(!hit3) return false;
  }
  return true;
}

function toLorebook(worldbook){
var entries = [];
(worldbook.rules || []).forEach(function(r, i){
entries.push({
key: [r.name],
content: r.rule +
(r.cost? "\n代价: " + r.cost: "") +
(r.limit? "\n限制: " + r.limit: "") +
(r.exception? "\n例外: " + r.exception: ""),
comment: r.name + (r.source? " [" + r.source + "]": "")
});
});
(worldbook.locations || []).forEach(function(l){
entries.push({
key: [l.name],
content: l.desc,
comment: l.name + (l.source? " [" + l.source + "]": "")
});
});
(worldbook.factions || []).forEach(function(f){
entries.push({
key: [f.name].concat(f.members || []),
content: f.desc,
comment: f.name + (f.source? " [" + f.source + "]": "")
});
});
return entries;
}

return {
extractWorldbook: extractWorldbook,
toLorebook: toLorebook,
matchTrigger: matchTrigger
};
})();
