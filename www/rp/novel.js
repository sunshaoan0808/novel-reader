/* RP 引擎: 记忆转小说 (对标猫箱 /api/tyler/novel/*)
* 抄猫箱链路 (本地 LLM 复刻, 无服务端):
* 生成 -> 分章节(先概要后正文两段式, 章节状态 Generating/SummaryGenerated/Finished 的本地版)
* -> 单章改写(章节名+概要+用户一句话指令重生成, 对标 chapter_rewrite)
* 不抄: 内容审核管线 / 冲突检测 / 付费解锁 / EPUB 导出 (产物为站内可读 + TXT)
* 三步: 1 生成章节列表 -> 2 逐章改写正文 -> 3 阅读 / 导出 TXT
* 存储: localStorage nd_novel_<chatId>, 纯本地。
* 纯逻辑, 无 DOM, 可被 node vm 测试。UI 在 app.js。
*/
var RP_NOVEL = (function(){
"use strict";

var KEY_PRE = "nd_novel_";
/* 章节状态 (对标猫箱 NovelChapterStatus) */
var ST_PLANNED = "planned"; /* 概要已出, 正文未生成 */
var ST_WRITING = "writing"; /* 生成中 */
var ST_DONE = "done"; /* 正文完成 */

function novelKey(chatId){ return KEY_PRE + chatId;}

function getNovel(chatId){
try{
var s = localStorage.getItem(novelKey(chatId));
var o = s? JSON.parse(s): null;
return (o && Array.isArray(o.chapters))? o: null;
}catch(e){ return null;}
}
function saveNovel(chatId, novel){
novel.updatedAt = Date.now();
try{ localStorage.setItem(novelKey(chatId), JSON.stringify(novel));}
catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("小说章节保存失败", e); }
try{ if(typeof RP_STORE!== "undefined") RP_STORE.cacheSet(novelKey(chatId), JSON.stringify(novel));}catch(e){}
}
function delNovel(chatId){
try{ localStorage.removeItem(novelKey(chatId));}catch(e){}
}

/* ---- 第一步: 生成章节规划 ----
* material: 聊天记录 + 记忆事件文本 (调用方组装, 见 buildMaterial)
* 输出: [{title, overview}] */
function planPrompt(material, charName){
return "你是小说策划。根据下面这段聊天记录与记忆事件, 为主角「" + charName +
"」规划一部短篇小说的章节结构。\n要求:\n" +
"1) 3-8 章, 每章 = 一个事件或一个时间段, 按时间顺序排列;\n" +
"2) 只输出一个 JSON 对象, 不要输出任何解释或 markdown 标记, 格式如下:\n" +
"{\"chapters\": [{\"title\": \"章节标题(10 字内)\", \"overview\": \"本章梗概(50-100 字, 交代起承转合)\"}]}\n" +
"3) 标题要有小说感, 不要出现\"第一章\"这类编号, 编号由程序自动加。\n\n" +
"聊天记录与记忆事件:\n" + material;
}
function parsePlan(raw){
var t = String(raw == null? "": raw).replace(/```json|```/g, "");
var a = t.indexOf("{"), b = t.lastIndexOf("}");
if(a < 0 || b <= a) throw new Error("novel-plan-failed");
var o;
try{ o = JSON.parse(t.slice(a, b + 1));}catch(e){ throw new Error("novel-plan-failed");}
var list = o.chapters;
if(!Array.isArray(list) ||!list.length) throw new Error("novel-plan-failed");
var chapters = [];
list.slice(0, 12).forEach(function(c, i){
var title = String((c && c.title) || "").trim();
var overview = String((c && c.overview) || "").trim();
if(!title) return;
chapters.push({id: "ch" + (i + 1), index: i,
title: title, overview: overview, content: "", status: ST_PLANNED});
});
if(!chapters.length) throw new Error("novel-plan-failed");
return chapters;
}
async function planChapters(material, charName, cfg, callChat){
var scfg = {base: cfg.base, key: cfg.key, model: cfg.model};
var raw = await callChat(scfg, [{role: "user", content: planPrompt(material, charName)}], 0.7);
return parsePlan(raw);
}

/* ---- 第二步: 单章正文生成/改写 (对标猫箱 chapter_rewrite)
* 输入 = 章节名 + 章节概要 + 用户一句话改写指令(extra), 服务端重生成该章的本地版 */
function chapterPrompt(ch, instruction){
var extra = (instruction && String(instruction).trim())
? "\n用户改写要求: " + String(instruction).trim() + "\n": "";
return "你是小说家。把下面这一章的概要扩写成小说正文。\n要求:\n" +
"1) 只输出正文, 不要输出章节标题和任何解释;\n" +
"2) 800-1500 字, 有场景、有对话、有心理, 第三人称;\n" +
"3) 严格围绕本章概要写, 不要跳到其他章节的剧情。" + extra +
"\n章节名: " + ch.title + "\n章节概要: " + ch.overview;
}
/* 改写某章: 先标 writing, 成功后写入 content 并标 done; 失败抛错由 UI toast */
async function rewriteChapter(novel, chIdx, instruction, cfg, callChat){
var ch = novel.chapters[chIdx];
if(!ch) throw new Error("novel-chapter-missing");
var scfg = {base: cfg.base, key: cfg.key, model: cfg.model};
ch.status = ST_WRITING;
var raw = await callChat(scfg, [{role: "user", content: chapterPrompt(ch, instruction)}], 0.8);
var text = String(raw == null? "": raw).trim();
if(!text) throw new Error("novel-rewrite-empty");
ch.content = text;
ch.status = ST_DONE;
return ch;
}

/* ---- 第三步: 阅读 / 导出 TXT ---- */
function exportTxt(novel){
var lines = [];
lines.push(novel.title || "未命名小说");
lines.push("");
(novel.chapters || []).forEach(function(ch, i){
lines.push("第" + (i + 1) + "章 " + ch.title);
if(ch.overview) lines.push("「梗概」" + ch.overview);
lines.push("");
lines.push(ch.content || "(本章正文尚未生成)");
lines.push("");
});
return lines.join("\n");
}

/* 组装转小说输入材料: 记忆事件 + 聊天记录 + 事件日历相关条目 (调用方传入原文) */
function buildMaterial(memFacts, histText, calText){
var parts = [];
if(memFacts) parts.push("「记忆事件」\n" + memFacts);
if(histText) parts.push("「聊天记录」\n" + histText);
if(calText) parts.push("「故事大事记」\n" + calText);
return parts.join("\n\n").slice(0, 9000);
}

function newNovelDoc(charName, chapters){
return {title: charName + "的小说", charName: charName,
chapters: chapters, createdAt: Date.now(), updatedAt: Date.now()};
}

return {ST_PLANNED: ST_PLANNED, ST_WRITING: ST_WRITING, ST_DONE: ST_DONE,
novelKey: novelKey, getNovel: getNovel, saveNovel: saveNovel, delNovel: delNovel,
planPrompt: planPrompt, parsePlan: parsePlan, planChapters: planChapters,
chapterPrompt: chapterPrompt, rewriteChapter: rewriteChapter,
exportTxt: exportTxt, buildMaterial: buildMaterial, newNovelDoc: newNovelDoc};
})();
if(typeof module!== "undefined" && module.exports) module.exports = RP_NOVEL;
