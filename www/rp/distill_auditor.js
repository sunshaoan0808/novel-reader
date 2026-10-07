/* 审计员 (2026-10-07): 借鉴 Talkie ai_novel_agent_auditor。
* 生成后自动审计：逻辑矛盾、人设冲突、与原文矛盾。
* 纯 LLM，一次调用审一个人。
*/
var DISTILL_AUDITOR = (function(){
"use strict";

async function audit(pkgId, charName, opts){
opts = opts || {};
var onProgress = opts.onProgress || function(){};

var card = DISTILL_PACKAGE.getCharacterCard(pkgId, charName);
if(!card ||!card._distill) throw new Error("角色卡不存在");

onProgress("审计 " + charName + "...");

// 档案文本 (去引用标注)
var md = Object.keys(card._distill).map(function(k){
var v = card._distill[k];
if(typeof v === "string") v = v.replace(/\[(canon|ref|inference|unknown)(:[a-z0-9_\-]+)?\]/gi, "");
// 跳过分阶段子对象
if(typeof v === "object") return "";
return k + ": " + (v || "");
}).filter(Boolean).join("\n").slice(0, 5000);

try{
var r = await DISTILL_LLM.chat([
{role: "system", content:
"你是人物档案审计员。检查档案中的逻辑问题。\n" +
"检查项：\n" +
"1. 内部矛盾：同一档案前后矛盾（如：前面说冷漠，后面说热情）\n" +
"2. 逻辑错误：年龄/身份/时间线不合理\n" +
"3. 过度推断：明显超出原文的臆测\n" +
"返回 JSON: {\"issues\": [{\"type\": \"contradiction|logic|overinfer\", \"field\": \"字段名\", \"desc\": \"问题描述\", \"severity\": \"high|medium|low\"}], \"pass\": true/false}\n" +
"没问题就返回空 issues。"},
{role: "user", content: "" + charName + "\n\n\n" + md}
]);
var m = r.content.match(/\{[\s\S]*\}/);
if(!m) return {issues: [], pass: true};
var obj = JSON.parse(m[0]);
var result = {
issues: obj.issues || [],
pass: obj.pass!== false &&!(obj.issues || []).some(function(i){ return i.severity === "high";}),
audited_at: Date.now()
};
// 存审计结果
try{
var all = DISTILL_PACKAGE.getData(pkgId, "audits") || {};
all[charName] = result;
DISTILL_PACKAGE.saveData(pkgId, "audits", all);
}catch(e){}
return result;
}catch(e){
return {issues: [], pass: true, error: e.message};
}
}

async function auditAll(pkgId, charNames, opts){
opts = opts || {};
var onProgress = opts.onProgress || function(){};
var results = {};
for(var i = 0; i < charNames.length; i++){
onProgress(i + 1, charNames.length, "审计 " + charNames[i]);
results[charNames[i]] = await audit(pkgId, charNames[i], opts);
}
return results;
}

return {
audit: audit,
auditAll: auditAll
};
})();
