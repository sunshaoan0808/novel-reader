/* 开场白生成 (2026-10-07): 对标 Python openings.py。
* 按人物档案 LLM 生成真开场白 (first_mes + alternate_greetings)。
* 每条 2-4 句，情境各异，不替玩家行动。
* 失败时返回空，不阻断。
*/
var DISTILL_OPENINGS = (function(){
"use strict";

async function generateOpenings(charName, profileFields, opts){
opts = opts || {};
var n = opts.n || 3;
var onProgress = opts.onProgress || function(){};
var shouldPause = opts.shouldPause || function(){ return false;};

// 档案文本
var md = Object.keys(profileFields || {}).map(function(k){
var v = profileFields[k];
// 去掉引用标注，LLM 不需要
if(typeof v === "string") v = v.replace(/\[(canon|ref|inference|unknown)(:[a-z0-9_\-]+)?\]/gi, "");
return "" + (v || "");
}).join("\n").slice(0, 6000);

if(!md.trim()) return [];

onProgress("生成开场白 " + charName + "...");
while(shouldPause()){
onProgress("已暂停…");
await new Promise(function(r){ setTimeout(r, 500);});
}

try{
var r = await DISTILL_LLM.chat([
{role: "system", content:
"你是角色扮演开场白写手。根据人物档案，为角色写 " + n + " 条开场白。\n" +
"要求：\n" +
"1. 每条 2-4 句，第一人称或第三人称叙述+对话\n" +
"2. 每条情境不同（初见/日常/冲突/独处等）\n" +
"3. 绝对不要替玩家行动，不要写玩家说什么做什么\n" +
"4. 符合人物性格和说话风格\n" +
"返回 JSON: {\"openings\": [{\"situation\": \"情境标签\", \"text\": \"开场白正文\"}]}"},
{role: "user", content: "" + charName + "\n\n\n" + md}
]);
var m = r.content.match(/\{[\s\S]*\}/);
if(!m) return [];
var obj = JSON.parse(m[0]);
return (obj.openings || []).slice(0, n).map(function(o){
return {situation: o.situation || "", text: o.text || ""};
}).filter(function(o){ return o.text;});
}catch(e){
onProgress("开场白生成失败: " + e.message);
return [];
}
}

// 为多个角色批量生成
async function generateAll(pkgId, charNames, opts){
opts = opts || {};
var onProgress = opts.onProgress || function(){};
var result = {};
for(var i = 0; i < charNames.length; i++){
var name = charNames[i];
var card = DISTILL_PACKAGE.getCharacterCard(pkgId, name);
if(!card) continue;
onProgress(i + 1, charNames.length, "开场白 " + name);
var openings = await generateOpenings(name, card._distill, opts);
if(openings.length){
result[name] = openings;
// 存到包
try{
var all = DISTILL_PACKAGE.getData(pkgId, "openings") || {};
all[name] = openings;
DISTILL_PACKAGE.saveData(pkgId, "openings", all);
// 更新卡的 first_mes
card.first_mes = openings[0].text;
card.alternate_greetings = openings.slice(1).map(function(o){ return o.text;});
DISTILL_PACKAGE.saveCharacterCard(pkgId, name, card);
}catch(e){}
}
}
return result;
}

// M3: 动态开场白
async function generateDynamic(pkgId, name, context){
  context = context || {};
  var card = DISTILL_PACKAGE.getCharacterCard(pkgId, name);
  if(!card || !card._distill) throw new Error("角色卡不存在");
  var d = card._distill;
  var ctxDesc = [];
  if(context.stage) ctxDesc.push("阶段:" + context.stage);
  if(context.persona) ctxDesc.push("用户身份:" + context.persona);
  try{
    var r = await DISTILL_LLM.chat([
      {role: "system", content: "你是" + name + "。\n身份:" + (d.core_identity||"") + "\n性格:" + (d.core_traits||"") + "\n" + (ctxDesc.length ? ctxDesc.join(";") + "\n" : "") + "生成一句开场白，第一人称50字内，只输出本身。"},
      {role: "user", content: "开场白"}
    ]);
    return r.content.trim();
  }catch(e){
    var all = {};
    try{ all = DISTILL_PACKAGE.getData(pkgId, "openings") || {}; }catch(e2){}
    var ops = all[name] || [];
    return ops.length ? ops[0].text : "";
  }
}

return {
generateOpenings: generateOpenings,
generateAll: generateAll,
generateDynamic: generateDynamic
};
})();
