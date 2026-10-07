/* 文风库 (2026-10-07): 基于 Author Writing Sheet (IJCNLP-AACL 2025)。
* 蒸馏作品文风 → 文风卡 → 调用文风 = 对应作家执笔 → 可续烂尾。
*
* 文风卡结构：
* - name: 作家/作品名
* - sheet: 四类风格档案 {plot, creativity, development, language}
* 每类 = [{claim, evidence}] (Claim-Evidence 对)
* - signature_lines: 标志性句式示例 (最多5)
* - taboos: 禁忌 (AI 通病警示)
* - source_novel: 来源小说
*/
var DISTILL_STYLE = (function(){
"use strict";

var CATEGORIES = {
plot: "情节",
creativity: "创意",
development: "发展",
language: "语言"
};

// 从文本样本抽取风格档案 (AWS 两阶段)
async function extract(pkgId, novelName, samples, opts){
opts = opts || {};
var onProgress = opts.onProgress || function(){};

// samples: [text] 文本样本数组
var combined = samples.slice(0, 3).map(function(s){
return s.slice(0, 3000);
}).join("\n\n---\n\n");

onProgress("抽取文风档案...");

try{
var r = await DISTILL_LLM.chat([
{role: "system", content:
"你是文风分析师。从文本中抽取作者的风格档案。\n" +
"四类，每类最多5条 Claim-Evidence 对：\n" +
"1. plot(情节)：情节组织方式（如：多线并进/倒叙/悬念设置）\n" +
"2. creativity(创意)：意象/比喻特点\n" +
"3. development(发展)：人物/主题展开方式\n" +
"4. language(语言)：句式/词汇/节奏特点\n" +
"另抽：signature_lines(标志性句式，最多5条原文引用)，taboos(应避免的AI腔模仿误区，必含一条：不要使用markdown格式)\n" +
"返回 JSON: {\"plot\":[{\"claim\":\"\",\"evidence\":\"\"}],\"creativity\":[...],\"development\":[...],\"language\":[...],\"signature_lines\":[],\"taboos\":[]}"},
{role: "user", content: "\n" + combined}
]);
var m = r.content.match(/\{[\s\S]*\}/);
if(!m) throw new Error("解析失败");
var sheet = JSON.parse(m[0]);

var card = {
id: "style_" + Date.now().toString(36),
name: novelName,
sheet: {
plot: sheet.plot || [],
creativity: sheet.creativity || [],
development: sheet.development || [],
language: sheet.language || []
},
signature_lines: sheet.signature_lines || [],
taboos: sheet.taboos || [],
source_novel: novelName,
created: Date.now()
};

saveCard(card);
return card;
}catch(e){
throw new Error("文风抽取失败: " + e.message);
}
}

function saveCard(card){
var cards = listCards();
var idx = cards.findIndex(function(c){ return c.id === card.id;});
if(idx >= 0) cards[idx] = card;
else cards.push(card);
localStorage.setItem("distill_styles", JSON.stringify(cards));
}

function listCards(){
var cards = [];
try{ cards = JSON.parse(localStorage.getItem("distill_styles") || "[]"); }
catch(e){ cards = []; }
// 合并预置卡 (去重)
try{
  var presets = window.__STYLE_PRESETS__ || [];
  presets.forEach(function(p){
    if(!cards.some(function(c){ return c.id === p.id; })) cards.unshift(p);
  });
}catch(e2){}
return cards;
}

function getCard(id){
return listCards().find(function(c){ return c.id === id;});
}

function deleteCard(id){
var cards = listCards().filter(function(c){ return c.id!== id;});
localStorage.setItem("distill_styles", JSON.stringify(cards));
}

// 生成文风 prompt (注入用)
function toPrompt(card){
if(!card) return "";
var parts = ["文风：" + card.name];
Object.keys(CATEGORIES).forEach(function(cat){
var items = (card.sheet[cat] || []);
if(items.length){
parts.push("《" + CATEGORIES[cat] + "》");
items.forEach(function(it){
parts.push("- " + it.claim + (it.evidence? "（例：" + it.evidence.slice(0, 60) + "）": ""));
});
}
});
if(card.signature_lines.length){
parts.push("《标志性句式》");
card.signature_lines.slice(0, 3).forEach(function(l){
parts.push(" " + l.slice(0, 80));
});
}
if(card.taboos.length){
parts.push("《禁忌》");
card.taboos.forEach(function(t){ parts.push("- 不要" + t);});
}
return parts.join("\n");
}

return {
extract: extract,
saveCard: saveCard,
listCards: listCards,
getCard: getCard,
deleteCard: deleteCard,
toPrompt: toPrompt,
CATEGORIES: CATEGORIES
};
})();
