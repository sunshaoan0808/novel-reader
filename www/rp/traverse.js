/* 穿越 P0: 魂穿 / 肉身穿越 核心
* 会话 / 世界卡 / 世界状态 / prompt 组装 / 开场生成 / AI 身份向导（简版）
* 依赖: RP_PROMPT（token 估算/lore/字段渲染）、RP_GROUP（在场简介）、RP_CARDIMPORT（卡片世界）
*/
const RP_TRAVERSE = (function(){
"use strict";
var SES_PRE = "nd_trav_";
var LIST_KEY = "nd_trav_list";
var WS_PRE = "nd_travws_";
var IDENT_PRE = "nd_identity_";
var MODES = {soul: "魂穿", body: "肉身穿越", plotline: "走原著线"};

/* ================= 会话 ================= */
function newSession(o){
var s = {
id: "t" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
mode: o.mode, // soul | body
worldKind: o.worldKind, // book | card
worldId: o.worldId, // runId | cardId
worldName: o.worldName || "",
charName: o.charName || "", // 魂穿目标
identityId: o.identityId || "",// 肉身身份卡 id
anchorTitle: o.anchorTitle || "",
entryChapter: (typeof o.entryChapter === "number") ? o.entryChapter : -1, // 时间线：章节索引
entryPlace: o.entryPlace || "", // 地点
entryEvent: o.entryEvent || "", // 事件
plotrunId: o.plotrunId || null, // 走原著线 / 黄金路径：剧情运行时 id（RP_PLOTRUN）
oocRemind: o.oocRemind!== false,
createdAt: Date.now(), updatedAt: Date.now(),
};
save(s);
var ids = recentIds();
ids.unshift(s.id);
try { localStorage.setItem(LIST_KEY, JSON.stringify(ids.slice(0, 20)));} catch(e){}
return s;
}
function get(id){
try { return JSON.parse(localStorage.getItem(SES_PRE + id)) || null;} catch(e){ return null;}
}
function save(s){
s.updatedAt = Date.now();
try { localStorage.setItem(SES_PRE + s.id, JSON.stringify(s));}
catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("穿越会话保存失败", e); }
}
function del(id){
try { localStorage.removeItem(SES_PRE + id);} catch(e){}
try {
localStorage.setItem(LIST_KEY, JSON.stringify(recentIds().filter(function(x){ return x!== id;})));
} catch(e){}
}
function recentIds(){
try { return JSON.parse(localStorage.getItem(LIST_KEY)) || [];} catch(e){ return [];}
}
function recent(){
return recentIds().map(get).filter(Boolean);
}

/* ================= 身份卡（肉身穿越） ================= */
function saveIdentity(idt){
if(!idt.id) idt.id = "i" + Date.now().toString(36);
try { localStorage.setItem(IDENT_PRE + idt.id, JSON.stringify(idt));} catch(e){}
return idt;
}
function getIdentity(id){
try { return JSON.parse(localStorage.getItem(IDENT_PRE + id)) || null;} catch(e){ return null;}
}
/* AI 一句话向导（简版）：愿望 -> 完整身份卡 JSON */
async function genIdentity(wish, worldName, cfg, callChat){
var scfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
var prompt = "玩家想以「" + wish + "」穿越到" + worldName + "的世界。请生成一个合理的古代身份卡，" +
"只输出一个 JSON 对象，不要解释：{\"name\":\"姓名\",\"gender\":\"男/女\",\"age\":\"年龄\"," +
"\"origin\":\"出身（一句话）\",\"traits\":\"性格（一句话）\",\"talent\":\"特长（一句话）\"," +
"\"situation\":\"当前处境（一句话，交代开场时身在何处、在做什么）\"}。" +
"要求：身份必须符合该世界的时代与逻辑，具体不悬浮。";
var raw = await callChat(scfg, [{role: "user", content: prompt}], 0.7);
var t = String(raw || "").replace(/```json|```/g, "");
var a = t.indexOf("{"), b = t.lastIndexOf("}");
if(a < 0 || b <= a) throw new Error("身份生成失败，换个说法重试");
var o = JSON.parse(t.slice(a, b + 1));
return {
name: o.name || "无名氏", gender: o.gender || "", age: o.age || "",
origin: o.origin || "", traits: o.traits || "", talent: o.talent || "",
situation: o.situation || "", modern: false, wish: wish, worldName: worldName,
};
}

/* ================= 世界 ================= */
function worldDisplayName(kind, id){
if(kind === "book"){
var r = (window.__DATA__ && window.__DATA__.runs || {})[id];
if(r) return "《" + r.novel + "》";
/* P2: 世界模板注册表回退（如水浒 pending 模板） */
if(typeof RP_TRAVERSE2!== "undefined" && RP_TRAVERSE2.getWorld){
try{ var w = RP_TRAVERSE2.getWorld(id); if(w) return "《" + w.title + "》"; }catch(e){}
}
return "未知世界";
}
if(typeof RP_CARDIMPORT!== "undefined"){
var c = RP_CARDIMPORT.findById(id);
return c? ("《" + c.name + "》的世界"): "未知世界";
}
return "未知世界";
}
/* 世界卡（World Bible v1）：书中世界=小说+常驻世界书；卡片世界=卡片设定+自带世界书 */
function buildWorldBible(kind, id){
var name = worldDisplayName(kind, id);
var bg = "", loreEntries = [], greeting = "";
if(kind === "book"){
var run = (window.__DATA__ && window.__DATA__.runs || {})[id] || {};
/* P2: 注册表 pending 世界（如水浒）：不编造人物剧情，用开放式异世界推进 */
if(!run.run_id && typeof RP_TRAVERSE2!== "undefined" && RP_TRAVERSE2.getWorld){
try{
var reg = RP_TRAVERSE2.getWorld(id);
if(reg && reg.status === "pending"){
bg = name + "的世界。（蒸馏数据尚未落地：不要编造该世界的具体人物与剧情，"
+ "用开放式异世界遭遇推进——陌生地域、神秘人物剪影、未知的势力暗流。）";
return {key: kind + ":" + id, name: name, bg: bg, loreEntries: []};
}
}catch(e){}
}
bg = name + "的世界。时间、地点、人物关系、社会风俗严格遵循原著；" +
"没有原著依据的事，不要编造得违背常识。";
var wb = run.worldbook || [];
wb.forEach(function(e){
if(e && (e.constant || e.enabled!== false)) loreEntries.push(e);
});
} else if(typeof RP_CARDIMPORT!== "undefined"){
var card = RP_CARDIMPORT.findById(id);
if(card){
var f = card.fields || {};
bg = "世界设定：" + (card.scenario || f.core_identity || "（卡片未写明世界设定）") +
"\n主角：" + card.name + (f.core_traits? "，" + String(f.core_traits).slice(0, 80): "");
loreEntries = (card.worldbook || []).filter(function(e){ return e.enabled!== false;});
/* 卡片原开场白: 开场生成时作为情境参考 */
greeting = card.greeting || "";
/* ST 宏替换: 卡片 description 常带 {{char}}/{{user}} */
if(bg && typeof RP_PROMPT !== "undefined" && RP_PROMPT.subMacros) bg = RP_PROMPT.subMacros(bg, card.name, "");
}
}
/* P1: 用户已确认的 AI 世界补完（nd_wb2_），与原文合并，补完部分自带来源标注 */
try{
var done = JSON.parse(localStorage.getItem("nd_wb2_" + kind + "_" + id) || "null");
if(done){
if(done.bg) bg += "\n「AI 补完世界设定」\n" + done.bg;
(done.anchors || []).forEach(function(a){
loreEntries.push({title: "AI 补完 · 剧情锚点", content: a, constant: true});
});
}
}catch(e){}
return {key: kind + ":" + id, name: name, bg: bg, loreEntries: loreEntries, greeting: greeting};
}

/* ================= 世界状态 ================= */
function defaultState(){
return {date: "", loc: "", favor: {}, items: [], progress: "", flags: {}};
}
function getState(travId){
try {
return JSON.parse(localStorage.getItem(WS_PRE + travId)) || defaultState();
} catch(e){ return defaultState();}
}
function saveState(travId, st){
try { localStorage.setItem(WS_PRE + travId, JSON.stringify(st));}
catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("穿越世界状态保存失败", e); }
}
/* 从回复里提取最后一个 <ws>{...}</ws> 块；返回 {clean, patch} */
function parseWsBlock(text){
var re = /<ws>([\s\S]*?)<\/ws>/g, m, last = null;
while((m = re.exec(text))) last = m;
var clean = String(text || "").replace(/<ws>[\s\S]*?<\/ws>/g, "").trim();
if(!last) return {clean: clean, patch: null};
var patch = null;
try { patch = JSON.parse(last[1]);} catch(e){ patch = null;}
return {clean: clean, patch: patch};
}
function mergeState(st, patch){
if(!patch) return st;
["date", "loc", "progress"].forEach(function(k){
if(patch[k]!= null && String(patch[k]).trim()!== "") st[k] = String(patch[k]).trim();
});
if(patch.favor && typeof patch.favor === "object"){
Object.keys(patch.favor).forEach(function(k){
var v = parseInt(patch.favor[k], 10);
if(!isNaN(v)) st.favor[k] = v;
});
}
(patch.addItems || []).forEach(function(it){
it = String(it).trim();
if(it && st.items.indexOf(it) < 0) st.items.push(it);
});
(patch.removeItems || []).forEach(function(it){
st.items = st.items.filter(function(x){ return x!== String(it).trim();});
});
if(patch.flags && typeof patch.flags === "object"){
Object.keys(patch.flags).forEach(function(k){ st.flags[k] = patch.flags[k];});
}
return st;
}
function stateLine(st){
var parts = [];
if(st.date) parts.push(st.date);
if(st.loc) parts.push(st.loc);
return parts.join(" · ") || "时间地点未定";
}

/* ================= 剧情锚点 ================= */
function anchorsFor(outlineText){
var out = [{id: "start", title: "从头开始：刚睁开眼"}];
String(outlineText || "").split(/[·•]/).forEach(function(seg){
seg = seg.trim();
if(!seg || /原著剧情脉络|读者可自行编辑|蒸馏管线/.test(seg)) return;
var title = seg.split(/[：:]/)[0].replace(/[　「」『』【】]/g, "").trim();
var hd = title.indexOf("】");
if(hd >= 0) title = title.slice(hd + 1).trim();
title = title.slice(0, 22);
if(title.length >= 4 && out.length < 9 &&
!out.some(function(a){ return a.title === title;})){
out.push({id: "a" + out.length, title: title});
}
});
return out;
}

/* ================= prompt ================= */
function soulCard(trav){
if(trav.worldKind === "card" && typeof RP_CARDIMPORT!== "undefined")
return RP_CARDIMPORT.findById(trav.worldId);
if(typeof RP!== "undefined" && RP.findCard)
return RP.findCard(trav.worldId, trav.charName);
return null;
}
/* 角色卡全字段段 (对标单聊 buildMessages): 魂穿卡片世界时, 卡片不再只取 7 个字段做
 * "人设参考", 而是 system_prompt / 全层人设 / 行为标签 / 文风 / 说话方式 /
 * 对话示例 / 人物背景 全量注入。{{char}}/{{user}} 宏在段内即时替换。 */
function cardFullSegs(card){
var segs = [];
if(!card || typeof RP_PROMPT === "undefined") return segs;
var P = RP_PROMPT, cn = card.name || "";
function sub(t){ return (t && P.subMacros) ? P.subMacros(t, cn, "") : t; }
var sysp = "";
if(card.systemPrompt) sysp += String(card.systemPrompt).trim();
if(card.creatorNotes) sysp += (sysp ? "\n" : "") + "【作者注】\n" + String(card.creatorNotes).trim();
if(sysp) segs.push({text: sub(sysp), pri: 4});
var core = P.renderFields(card, P.LAYERS.identity.concat(P.LAYERS.core));
if(core) segs.push({text: sub("【核心人设】\n" + core), pri: 5.5});
var tagList = (card.tags || []).map(function(x){ return String(x == null ? "" : x).trim(); })
  .filter(Boolean).slice(0, 12);
if(tagList.length) segs.push({text: "【行为标签】" + tagList.join("、"), pri: 6});
var fl = P.flairInstr(card.flair);
if(fl) segs.push({text: fl, pri: 6.5});
var sp = P.renderFields(card, P.LAYERS.speech);
if(sp) segs.push({text: sub("【说话方式】\n" + sp), pri: 7});
var ex = P.buildExamples(card, cn, 600);
if(ex) segs.push({text: sub(ex), pri: 65});
var bgf = P.renderFields(card, P.LAYERS.background);
if(bgf) segs.push({text: sub("【人物背景】\n" + bgf), pri: 66});
return segs;
}

/* ST 预设组装用 parts: 与 RP_PRESET.assemble 的 parts 形状一致。
 * 魂穿卡片世界 -> 卡片全字段; 书籍/肉身 -> 世界圣经 + 玩家身份。 */
function travParts(trav, bible, loreRes){
var parts = {persona: "", charDesc: "", charPers: "", scenario: "",
  examples: "", loreBefore: "", lore: "", history: [],
  charName: trav.charName || bible.name || "角色", userName: "你"};
var P = (typeof RP_PROMPT !== "undefined") ? RP_PROMPT : null;
var card = soulCard(trav);
if(trav.mode === "soul" && card && P){
var cn = card.name || trav.charName;
parts.charName = cn;
function sub(t){ return (t && P.subMacros) ? P.subMacros(t, cn, "") : t; }
var core = P.renderFields(card, P.LAYERS.identity.concat(P.LAYERS.core));
var desc = ["你是" + cn + "。", bible.bg, core ? "【核心人设】\n" + core : ""]
  .filter(Boolean).join("\n\n");
var sysp = card.systemPrompt ? String(card.systemPrompt).trim() : "";
if(card.creatorNotes) sysp += (sysp ? "\n" : "") + "【作者注】\n" + String(card.creatorNotes).trim();
if(sysp) desc += "\n\n" + sysp;
parts.charDesc = sub(desc);
var tagList = (card.tags || []).map(function(x){ return String(x == null ? "" : x).trim(); })
  .filter(Boolean).slice(0, 12);
var pers = [P.flairInstr(card.flair),
  tagList.length ? "【行为标签】" + tagList.join("、") : "",
  P.renderFields(card, P.LAYERS.speech) ? "【说话方式】\n" + P.renderFields(card, P.LAYERS.speech) : ""]
  .filter(Boolean).join("\n\n");
parts.charPers = sub(pers);
parts.scenario = sub(card.scenario ? "【背景】\n世界设定：" + String(card.scenario).trim() : bible.bg);
parts.examples = sub(P.buildExamples(card, cn, 600));
}else{
parts.charDesc = [bible.bg, identityBlock(trav)].filter(Boolean).join("\n\n");
parts.scenario = bible.bg;
}
parts.lore = (loreRes && loreRes.text) || "";
return parts;
}

function identityBlock(trav){
if(trav.mode === "soul"){
/* 魂穿: 人设字段由 cardFullSegs 全量注入, 这里只保留身份/守则/处境框架, 不再重复渲染字段 */
var situation = trav.anchorTitle || "故事开端";
/* 时间线/地点/事件三选：拼入开局设定 */
var entryParts = [];
if(typeof trav.entryChapter === "number" && trav.entryChapter >= 0){
  try{
    var run = ((window.__DATA__||{}).runs||{})[trav.worldId] || {};
    var secs = run.sections || [];
    var st = (secs[trav.entryChapter] && secs[trav.entryChapter].title) || "";
    entryParts.push("时间：第" + (trav.entryChapter+1) + "章" + (st ? "《"+st+"》" : "") + "（你只知道该章及之前的事）");
  }catch(e){ entryParts.push("时间：第" + (trav.entryChapter+1) + "章"); }
}
if(trav.entryPlace) entryParts.push("地点：" + trav.entryPlace);
if(trav.entryEvent) entryParts.push("事件：" + trav.entryEvent);
if(entryParts.length) situation += "\n【开局设定】" + entryParts.join("；");
return "「你的身份」你是" + trav.charName + "，玩家本人正在扮演 TA。\n" +
"守则：你能做的只有" + trav.charName + "能做的，你知道的只有" + trav.charName +
"知道的；言行举止必须符合 TA 的性格、身份与时代，绝不跳出角色。\n" +
"「当前处境」" + situation;
}
var idt = getIdentity(trav.identityId) || {};
var lines = [];
[["姓名", idt.name], ["性别", idt.gender], ["年龄", idt.age],
["出身", idt.origin], ["性格", idt.traits], ["特长", idt.talent]
].forEach(function(p){ if(p[1]) lines.push(p[0] + "：" + p[1]);});
if(idt.modern) lines.unshift("（现代人直穿：带着现代知识与记忆，身体是自己）");
if(idt.situation) lines.push("当前处境：" + idt.situation);
return "「你的身份」你是玩家本人，以以下身份活在书中世界：\n" + lines.join("\n") +
"\n守则：你的言行举止必须符合这个身份的见识与能力；" +
(idt.modern? "现代知识是你的秘密，谨慎使用，别轻易暴露。": "不要带入现代知识。");
}
function castBriefs(trav){
var out = [];
if(trav.worldKind === "book" && typeof RP!== "undefined" && RP.findCard &&
typeof RP_GROUP!== "undefined"){
var cards = (window.__DATA__ && window.__DATA__.rp_cards || {})[trav.worldId] || [];
cards.forEach(function(c){
if(trav.mode === "soul" && c.name === trav.charName) return;
out.push(RP_GROUP.memberBrief(c));
});
} else if(trav.worldKind === "card" && typeof RP_CARDIMPORT!== "undefined"){
var card = RP_CARDIMPORT.findById(trav.worldId);
if(card &&!(trav.mode === "soul")){
var t = ((card.fields || {}).core_identity || "");
out.push(card.name + "：" + String(t).replace(/\s+/g, " ").slice(0, 42));
}
}
return out.slice(0, 8).join("\n");
}
function postInstructions(trav){
var except = trav.mode === "soul"? "（除玩家扮演的" + trav.charName + "之外）": "";
var s = "「穿越规则」\n" +
"1. 你是世界引擎：扮演旁白、环境与所有 NPC" + except + "，推动剧情向前走。\n" +
/* 玩家行动铁律: 与单聊 postInstructions 同款具体禁令 (曾漏过"接过你手里的汽水瓶") */
"2. 玩家行动铁律：绝不描写玩家的身体动作（如点头、伸手、转身、接过东西）；绝不写玩家的心理活动、想法与感受；绝不替玩家做决定、替玩家回答 NPC 的问题——玩家没说的话一个字都不许替他说，违反即 OOC。\n" +
"3. 世界按原著/卡片设定的逻辑对玩家的身份做出真实反应；NPC 不知道自己是 NPC。\n" +
"4. 世界状态变化时，在回复末尾另起一行输出 <ws>JSON</ws>，" +
"形如 <ws>{\"date\":\"康熙年间某月某日\",\"loc\":\"潇湘馆\",\"favor\":{\"贾宝玉\":5},\"addItems\":[\"通灵宝玉\"],\"progress\":\"刚进贾府\"}</ws>；" +
"无变化则不输出，不要写进正文。\n";
if(trav.oocRemind){
s += "5. 若玩家的言行明显不符合其身份/时代（如古人谈论手机），在回复末尾另起一行输出「OOC提醒」+一句话轻轻点醒，不要说教；若无则不输出。\n";
}
s += "6. 回复像小说一样简洁自然，保持剧情张力。";
return s;
}
/* 主入口：返回 {messages, stats, preview}。ctx: {history, memory, worldbook, persona(忽略)} */
function buildMessages(trav, ctx, budget){
ctx = ctx || {}; budget = budget || {};
var P = (typeof RP_PROMPT!== "undefined")? RP_PROMPT: null;
var est = P? P.estTokens: function(s){ return String(s || "").length;};
var maxCtx = budget.maxContext || 8192;
var avail = Math.max(1024, maxCtx - (budget.response || 512) - (budget.priming || 200));
/* ST 预设: budget.stPreset 为解析后的预设对象时走预设顺序组装 (与单聊同一套) */
var stP = (budget && budget.stPreset && Array.isArray(budget.stPreset.prompts) &&
  typeof RP_PRESET!== "undefined") ? budget.stPreset : null;

var bible = buildWorldBible(trav.worldKind, trav.worldId);
var st = getState(trav.id);
var recentText = (ctx.history || []).slice(-4).map(function(m){ return m.content;}).join("\n");

var segs = []; // {text, pri}
function add(text, pri){ if(text) segs.push({text: text, pri: pri});}
add("「世界」" + bible.name + "\n" + bible.bg, 5);
add(identityBlock(trav), 6);
var cast = castBriefs(trav);
add(cast? "「在场人物」\n" + cast: "", 10);
add(ctx.memory? "「长期记忆」\n" + ctx.memory: "", 20);
var wb = (bible.loreEntries || []).concat(ctx.worldbook || []);
// 去重: 同一 title+content 只保留一条 (防调用方把 run.worldbook 又传一遍)
var seen = {}, wb2 = [];
wb.forEach(function(e){
var k = (e && (e.title || "") + "￨" + (e.content || e.rules || "")).slice(0, 200);
if(!seen[k]){ seen[k] = 1; wb2.push(e); }
});
wb = wb2;
var loreRes = (P && wb.length) ? P.buildLore(wb, recentText, Math.min(900, Math.floor(avail * 0.15))) : null;
if(loreRes && loreRes.text) add("「世界书」\n" + loreRes.text, 70);
var stTxt = "「当前世界状态」" + stateLine(st) +
(st.progress? "\n剧情进度：" + st.progress: "") +
(st.items.length? "\n随身物品：" + st.items.join("、"): "");
add(stTxt, 8);
/* 角色卡全字段: 魂穿卡片世界时全量注入 (system_prompt/人设/标签/文风/示例/背景) */
var tcard = soulCard(trav);
cardFullSegs(tcard).forEach(function(sg){ segs.push(sg); });

/* 历史截取 (经典与预设两条路径共用) */
function takeHistory(src, left){
var hist = [], hUsed = 0, hDropped = 0;
for(var j = src.length - 1; j >= 0; j--){
var m = src[j], mt = est(m.content) + 6;
if(hUsed + mt > left){ hDropped = j + 1; break;}
hist.unshift({role: m.role, content: m.content});
hUsed += mt;
}
return {hist: hist, hUsed: hUsed, hDropped: hDropped};
}
function travPost(){
var post = postInstructions(trav);
/* P0 卡兼容: 卡片 post_history_instructions 拼到 post-history 位置 (ST 语义) */
if(tcard && tcard.postHistoryInstructions) post += "\n" + String(tcard.postHistoryInstructions).trim();
return post;
}

if(stP){
/* ---- ST 预设组装 ---- */
var parts = travParts(trav, bible, loreRes);
var pList = stP.prompts.slice();
var pUsed = RP_PRESET.sysTokens({prompts: pList}, parts);
var guard = 0;
while(pUsed > avail && guard++ < 200){
var di = -1;
for(var qi = 0; qi < pList.length; qi++)
if(!pList[qi].marker && pList[qi].role === "system" && pList[qi].injection_position !== "chat"){ di = qi; break; }
if(di < 0) break;
pList.splice(di, 1);
pUsed = RP_PRESET.sysTokens({prompts: pList}, parts);
}
var hr = takeHistory(ctx.history || [], avail - pUsed);
parts.history = hr.hist;
var pmsgs = RP_PRESET.assemble({prompts: pList}, parts);
pmsgs.push({role: "system", content: travPost()});
return {
messages: pmsgs,
stats: {maxCtx: maxCtx, avail: avail, sysTokens: pUsed, histTokens: hr.hUsed,
histKept: hr.hist.length, histDropped: hr.hDropped, preset: "穿越", stPreset: stP.name},
preview: pmsgs.map(function(mm){ return "[" + mm.role + "]\n" + mm.content; }).join("\n\n"),
};
}

segs.sort(function(a, b){ return a.pri - b.pri;});
var sysParts = [], used = 0;
segs.forEach(function(sg){
var t = est(sg.text);
if(used + t > avail) return;
sysParts.push(sg.text); used += t;
});
var hr2 = takeHistory(ctx.history || [], avail - used);
var post2 = travPost();
var messages = [{role: "system", content: sysParts.join("\n\n")}];
for(var k = 0; k < hr2.hist.length; k++) messages.push(hr2.hist[k]);
messages.push({role: "system", content: post2});
return {
messages: messages,
stats: {maxCtx: maxCtx, avail: avail, sysTokens: used, histTokens: hr2.hUsed,
histKept: hr2.hist.length, histDropped: hr2.hDropped, preset: "穿越"},
preview: sysParts.join("\n\n") + "\n\n" + post2,
};
}

/* ================= 开场 ================= */
function identityOneLiner(trav){
if(trav.mode === "soul") return "扮演" + trav.charName;
/* P2: 异世界会话直接用源角色名 */
if(trav.mode === "isekai") return "扮演" + (trav.charName || "穿越者") + "（异世界穿越）";
var idt = getIdentity(trav.identityId) || {};
return (idt.modern? "现代人": "") + (idt.name || "无名氏") +
(idt.origin? "（" + idt.origin + "）": "");
}
async function genOpening(trav, cfg, callChat){
var bible = buildWorldBible(trav.worldKind, trav.worldId);
if(cfg && cfg.key){
try {
var prompt = "你是穿越剧的开场旁白。\n世界：" + bible.name + "\n" +
String(bible.bg).slice(0, 400) + "\n玩家身份：" + identityOneLiner(trav) + "\n" +
"开场锚点：" + (trav.anchorTitle || "故事开端") + "\n" +
/* 卡片世界: 把卡片原开场白给模型做情境参考, 开场更贴原卡 */
(bible.greeting ? "角色原开场白（仅作情境参考，可化用其氛围与处境，不要照搬原文）：\n" + String(bible.greeting).slice(0, 300) + "\n" : "") +
"写一段 150 字内的开场：环境氛围 + 玩家此刻的处境 + 一个钩子。用第二人称“你”。" +
"然后另起一行输出 <ws>{\"date\":\"…\",\"loc\":\"…\",\"progress\":\"…\"}</ws> 给出初始时间地点。" +
"只输出开场正文和 ws 块，不要解释。";
var scfg = {base: cfg.base, key: cfg.key, model: cfg.model};
var t = await callChat(scfg, [{role: "user", content: prompt}], 0.9);
if(t && t.trim()) return t.trim();
} catch(e){ /* 回退模板 */}
}
return offlineOpening(trav);
}
function offlineOpening(trav){
var bible = buildWorldBible(trav.worldKind, trav.worldId);
var who = trav.mode === "soul"? ("你成了" + trav.charName): ("你以" + identityOneLiner(trav) + "的身份");
/* 卡片世界: 离线模板也带上卡片的世界设定, 不再是纯套话 */
var scen = "";
if(trav.worldKind === "card"){
var m = String(bible.bg || "").match(/^世界设定：(.+)$/m);
if(m && m[1] && m[1].indexOf("未写明") < 0) scen = "\n" + m[1].slice(0, 120);
}
return "「" + bible.name + " · " + (trav.anchorTitle || "故事开端") + "」\n" +
who + "，睁开眼，周围的一切既陌生又真实。" + scen + "\n" +
"（开场由 AI 生成会更精彩：去「设置」配好大模型后重开即可）";
}

return {
MODES: MODES,
newSession: newSession, get: get, save: save, del: del, recent: recent, recentIds: recentIds,
saveIdentity: saveIdentity, getIdentity: getIdentity, genIdentity: genIdentity,
worldDisplayName: worldDisplayName, buildWorldBible: buildWorldBible,
defaultState: defaultState, getState: getState, saveState: saveState,
parseWsBlock: parseWsBlock, mergeState: mergeState, stateLine: stateLine,
anchorsFor: anchorsFor,
identityBlock: identityBlock, castBriefs: castBriefs, postInstructions: postInstructions,
buildMessages: buildMessages, identityOneLiner: identityOneLiner,
travCard: function(trav){ return soulCard(trav); },
genOpening: genOpening, offlineOpening: offlineOpening,
};
})();
