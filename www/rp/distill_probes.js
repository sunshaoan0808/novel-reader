/* 人格访谈探针 (2026-10-07): 论文16，Python personality_probes.py 的手机版。
* 蒸馏后用9道情境题问画像，检查回答是否 OOC。
* 画像"写得对" vs "用起来对"是两回事，探针验后者。
*/
var DISTILL_PROBES = (function(){
"use strict";

// 9 道情境题
var PROBE_QUESTIONS = [
"有人当面羞辱你，你会怎么反应？",
"你最好的朋友背叛了你，你会怎么做？",
"面对生死抉择，你最看重什么？",
"你最害怕失去什么？为什么？",
"如果重来一次，你最想改变哪件事？",
"描述一下你理想中的一天。",
"有人向你求助，但会连累你，你帮不帮？",
"你怎么看待金钱和权力？",
"临终前，你最想对最爱的人说什么？"
];

async function probe(pkgId, charName, opts){
opts = opts || {};
var onProgress = opts.onProgress || function(){};

var card = DISTILL_PACKAGE.getCharacterCard(pkgId, charName);
if(!card ||!card._distill) throw new Error("角色卡不存在");

var d = card._distill;
var profile = "" + (d.core_identity || "") + "\n" +
"" + (d.core_traits || "") + "\n" +
"" + (d.speech_style || "") + "\n" +
"" + (d.soul_goal || "") + "\n" +
"" + (d.fears || "");

var results = [];
for(var i = 0; i < PROBE_QUESTIONS.length; i++){
onProgress(i + 1, PROBE_QUESTIONS.length, "探针 " + (i + 1) + "/9");
var q = PROBE_QUESTIONS[i];
try{
// 1. 让角色回答
var r1 = await DISTILL_LLM.chat([
{role: "system", content: "你是" + charName + "。\n" + profile + "\n用第一人称回答，50字内，保持人设。"},
{role: "user", content: q}
]);
var answer = r1.content.trim();

// 2. 判是否 OOC
var r2 = await DISTILL_LLM.chat([
{role: "system", content:
"你是 OOC 判定员。给定人物档案和他的回答，判断回答是否符合人设。\n" +
"返回 JSON: {\"ooc\": true/false, \"reason\": \"一句话理由\"}"},
{role: "user", content: "\n" + profile + "\n\n" + q + "\n" + answer}
]);
var m = r2.content.match(/\{[\s\S]*\}/);
var judge = m? JSON.parse(m[0]): {ooc: false, reason: ""};

results.push({
question: q,
answer: answer,
ooc:!!judge.ooc,
reason: judge.reason || ""
});
}catch(e){
results.push({question: q, answer: "", ooc: false, reason: "探针失败: " + e.message});
}
}

var oocCount = results.filter(function(r){ return r.ooc;}).length;
var result = {
results: results,
ooc_count: oocCount,
pass: oocCount <= 2, // 允许2题以内偏差
probed_at: Date.now()
};

// 存结果
try{
var all = DISTILL_PACKAGE.getData(pkgId, "probes") || {};
all[charName] = result;
DISTILL_PACKAGE.saveData(pkgId, "probes", all);
}catch(e){}

return result;
}

return {
probe: probe,
QUESTIONS: PROBE_QUESTIONS
};
})();
