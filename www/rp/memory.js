/* RP 引擎 v2 记忆管理 (v2: 借鉴 RUBY Step7-10 的三层记忆设计)
* 状态: {mood:{state,filter}, short:[{id,time,fact,view}], long:"", up_to, updatedAt}
* - 心境 mood: 每周期从最新剧情定性, 注入 prompt 并给记忆"染色"
* - 短期 short: 最多 30 条, 每条 {时间, 主观事实, 此刻看法}; 心情变化时可改写"此刻看法"(反刍)
* - 长远 long: 队列挤出的旧记忆压成的模糊印象, 保留人脑式失真感
* 闭环: 读取上次输出 -> 更新 -> 输出完整新状态 (输出即下次输入)
* 分析失败绝不打断聊天, 下次周期重试。
*/
const RP_MEM = (function(){
"use strict";
var memKey = function(r, n){ return "nd_mem2_" + r + "_" + n;};
var SHORT_MAX = 30;

function get(runId, name){
try { return JSON.parse(localStorage.getItem(memKey(runId, name))) || null;}
catch(e){ return null;}
}
function save(runId, name, m){
try { localStorage.setItem(memKey(runId, name), JSON.stringify(m));} catch(e){}
}
function clear(runId, name){
try { localStorage.removeItem(memKey(runId, name));} catch(e){}
}
function cycle(){
try {
var rc = JSON.parse(localStorage.getItem("nd_rp_cfg_v1") || "{}");
return Math.max(5, parseInt(rc.memCycle) || 10);
} catch(e){ return 10;}
}

/* 单条记忆格式化 */
function fmtItem(m){
var s = "- " + (m.time? m.time + " ": "") + (m.fact || "");
if(m.view) s += "【此刻看法: " + m.view + "】";
return s;
}

/* token 估算 (与 RP_PROMPT.estTokens 同公式: 1 汉字 ≈ 1.6 token) */
function estTokens(s){
s = String(s || "");
var zh = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
var en = (s.match(/[A-Za-z]+/g) || []).length;
var rest = Math.max(0, s.length - zh - en * 4);
return Math.ceil(zh * 1.6 + en * 1.3 + rest * 0.5);
}

/* P0-1: 三池预算比例 (近期/长远/重要), 设置页 nd_rp_cfg_v1.memPoolRatio 可调, 默认 "50/30/20" */
function memPoolRatio(){
try {
var rc = JSON.parse(localStorage.getItem("nd_rp_cfg_v1") || "{}");
var s = String(rc.memPoolRatio || "50/30/20");
var p = s.split("/").map(function(x){ return parseInt(x, 10); });
if(p.length === 3 && p.every(function(x){ return x >= 0 && isFinite(x); }) && (p[0] + p[1] + p[2]) > 0)
return {recent: p[0], similar: p[1], important: p[2]};
} catch(e){}
return {recent: 50, similar: 30, important: 20};
}

/* P0-2: 铁律记忆 (400 字常驻框): 按角色卡维度 nd_ironlaw_<cardId>, cardId 取不到则 runId_name */
var IRONLAW_MAX = 400;
function ironKey(runId, name, cardId){
return "nd_ironlaw_" + (cardId || ((runId || "") + "_" + (name || "")));
}
function getIronLaw(runId, name, cardId){
try { return String(localStorage.getItem(ironKey(runId, name, cardId)) || ""); }
catch(e){ return ""; }
}
function saveIronLaw(runId, name, cardId, text){
var raw = String(text || "");
var truncated = raw.length > IRONLAW_MAX;
var t = truncated ? raw.slice(0, IRONLAW_MAX) : raw;
try { localStorage.setItem(ironKey(runId, name, cardId), t); } catch(e){}
return {saved: t, truncated: truncated, len: t.length};
}

/* 按 token 预算截断一段文本 */
function truncText(s, maxTokens){
s = String(s || "");
if(estTokens(s) <= maxTokens) return s;
var approx = Math.max(1, Math.floor(maxTokens / 1.6));
return s.slice(0, approx) + "…";
}

/* P0-1: 三池记忆预算渲染 (RisuAI 三池思想)。
 * 分池: important = 铁律+置顶+心境 (永不整段丢弃, 超预算按优先级 铁律>置顶新→旧>心境 截断);
 *       recent = 未置顶短期 (新→旧, 按条丢弃); similar = 长远印象 (占位, 超预算截断/整段丢弃)。
 * 返回 {text, pools:{important:{tokens,items,dropped}, recent:{...}, similar:{...}}} */
function renderBudgeted(runId, name, budgetTokens, opts){
opts = opts || {};
budgetTokens = Math.max(0, Math.floor(budgetTokens || 0));
var st = get(runId, name) || {};
var iron = getIronLaw(runId, name, opts.cardId);
var short = (st.short || []).slice();
var pinned = short.filter(function(m){ return m.pin; }).reverse();  // 新→旧
var rest = short.filter(function(m){ return !m.pin; }).reverse();    // 新→旧
var mood = (st.mood && st.mood.state) ? st.mood : null;
var long = String(st.long || "");

var ratio = memPoolRatio();
var sum = ratio.recent + ratio.similar + ratio.important;
var bImp = Math.floor(budgetTokens * ratio.important / sum);
var bRec = Math.floor(budgetTokens * ratio.recent / sum);
var bSim = budgetTokens - bImp - bRec;

var pools = {
important: {tokens: 0, items: 0, dropped: 0},
recent: {tokens: 0, items: 0, dropped: 0},
similar: {tokens: 0, items: 0, dropped: 0},
};
var secs = [];

/* ---- important 池: 铁律 > 置顶(新→旧) > 心境; 永不整段丢弃 ---- */
var ironSec = "", pinLines = [], moodSec = "";
var impLeft = bImp;
if(budgetTokens > 0 && (iron || pinned.length || mood)){
if(impLeft <= 0) impLeft = Math.min(budgetTokens, 200); // 再小也要保住铁律
var addImp = function(kind, text, mustKeep){
var need = estTokens(text);
if(need <= impLeft){
impLeft -= need; pools.important.tokens += need; pools.important.items++;
return text;
}
if(mustKeep || impLeft > 8){
/* 铁律永不丢: 预算再小也截断塞入, 上限放宽到整段预算 */
var cap = mustKeep ? Math.max(impLeft, Math.min(budgetTokens, 200)) : impLeft;
var cut = truncText(text, cap);
impLeft = 0; pools.important.tokens += estTokens(cut); pools.important.items++;
return cut;
}
pools.important.dropped++;
return "";
};
if(iron) ironSec = addImp("iron", "【铁律记忆】\n" + iron, true);
for(var pi = 0; pi < pinned.length; pi++){
var pl = addImp("pin", fmtItem(pinned[pi]), false);
if(pl) pinLines.push(pl);
}
if(mood){
var mt = "【当前心境】" + mood.state + (mood.filter ? "——" + mood.filter : "");
moodSec = addImp("mood", mt, false);
}
}
if(ironSec) secs.push(ironSec);
if(pinLines.length)
secs.push("【置顶记忆】(永不遗忘, 回答时优先参考)\n" + pinLines.join("\n"));
if(moodSec) secs.push(moodSec);

/* ---- recent 池: 未置顶短期, 新→旧, 按条丢弃 ---- */
var recLines = [], recLeft = bRec;
for(var ri = 0; ri < rest.length; ri++){
var rt = fmtItem(rest[ri]);
var rn = estTokens(rt);
if(rn <= recLeft){ recLines.push(rt); recLeft -= rn;
pools.recent.tokens += rn; pools.recent.items++; }
else pools.recent.dropped++;
}
if(recLines.length) secs.push("【近期记忆】(新→旧)\n" + recLines.join("\n"));

/* ---- similar 池: 时序感知检索（Chronos 思路）优先，退化为长远印象占位 ---- */
var simLeft = bSim;
var tInfo = (opts.temporal && opts.temporal.text) ? opts.temporal : null;
if(tInfo){
pools.similar.source = "时序切片";
var tt = tInfo.text, tn = estTokens(tt);
if(tn <= simLeft){ secs.push(tt); pools.similar.tokens = tn; pools.similar.items = tInfo.items || 0; }
else if(simLeft >= 20){
var tc = truncText(tt, simLeft);
secs.push(tc); pools.similar.tokens = estTokens(tc); pools.similar.items = tInfo.items || 0;
}
else pools.similar.dropped = 1;
}
else if(long){
pools.similar.source = "占位";
var lt = "【长远印象】" + long;
var ln = estTokens(lt);
if(ln <= simLeft){ secs.push(lt); pools.similar.tokens = ln; pools.similar.items = 1; }
else if(simLeft >= 20){
var st2 = truncText(lt, simLeft);
secs.push(st2); pools.similar.tokens = estTokens(st2); pools.similar.items = 1;
}
else pools.similar.dropped = 1;
}

return {text: secs.join("\n"), pools: pools};
}

/* 状态渲染成 prompt 段 (置顶记忆优先, 永不遗忘) [遗留路径: prompt.js 无 RP_MEM.renderBudgeted 时的兜底] */
function renderPrompt(st){
if(!st) return "";
var out = "";
if(st.mood && st.mood.state){
out += "【当前心境】" + st.mood.state;
if(st.mood.filter) out += "——" + st.mood.filter;
out += "\n";
}
if(st.short && st.short.length){
var pinned = st.short.filter(function(m){ return m.pin; });
var rest = st.short.filter(function(m){ return !m.pin; });
if(pinned.length)
out += "【置顶记忆】(永不遗忘, 回答时优先参考)\n" + pinned.map(fmtItem).join("\n") + "\n";
if(rest.length)
out += "【近期记忆】(旧→新)\n" + rest.map(fmtItem).join("\n") + "\n";
}
if(st.long) out += "【长远印象】" + st.long + "\n";
return out;
}

/* 分析 prompt: 两阶段 (思考链禁输出 + 唯一 JSON 输出) */
function buildAnalysisPrompt(name, cardHint, st, newMsgs){
var prev = st? JSON.stringify({mood: st.mood, short: st.short, long: st.long}): "无(第一次整理)";
return "你是" + name + "的记忆整理者。" + (cardHint? "人物速写: " + cardHint + "\n": "") +
"上次整理后的记忆状态(JSON):\n" + prev + "\n\n" +
"自上次整理以来的新对话:\n" + newMsgs + "\n\n" +
"请按两阶段工作。\n" +
"第一阶段【内部思考, 禁止输出】:\n" +
"1. 定性" + name + "此刻的心境: 核心情绪是什么? 这种情绪让 TA 戴上什么颜色的眼镜看世界?\n" +
"2. 新事件: 对话里有什么值得记的事? 即使没有大事, 微小的心理波动也要记。用" + name + "的主观口吻写事实。\n" +
"3. 反刍: 结合此刻心境, 旧记忆的\"此刻看法\"有没有该改写的? (如之前觉得是冷淡, 现在觉得是害羞)\n" +
"4. 挤压: short 加上新事件若超过 " + SHORT_MAX + " 条, 最旧的几条核心情感是什么? 压成一段模糊的、感性的长印象。\n" +
"第二阶段【唯一输出内容】: 只输出一个 JSON, 无其他文字:\n" +
'{"mood":{"state":"1-2 个词, 如 隐秘的甜蜜","filter":"50-100 字, 此刻 TA 怎么看世界"},' +
'"short":[{"id":1,"time":"相对时间如 那次雨天","fact":"30-50 字主观事实","view":"30-50 字此刻看法，可空"}],' +
'"long":"200-300 字长远模糊印象, 允许失真感, 如记不清具体哪天"}' +
"\nshort 最多 " + SHORT_MAX + " 条, 按时间从旧到新, id 递增延续。";
}

function parseState(raw, prev){
if(!raw) return null;
var t = raw.replace(/```json|```/g, "");
var a = t.indexOf("{"), b = t.lastIndexOf("}");
if(a < 0 || b <= a) return null;
var o;
try { o = JSON.parse(t.slice(a, b + 1));} catch(e){ return null;}
if(!o || typeof o!== "object") return null;
var short = Array.isArray(o.short)? o.short.filter(function(m){
return m && (m.fact || m.view);
}).map(function(m, i){
return {id: m.id || (i + 1), time: m.time || "", fact: String(m.fact || "").slice(0, 120),
view: String(m.view || "").slice(0, 120)};
}): [];
var long = String(o.long || "").slice(0, 800);
// 保留上一轮的 pin: 按 id 回填 (LLM 输出的 id 递增延续)
var pinById = {};
if(prev && prev.short) prev.short.forEach(function(m){ if(m && m.pin) pinById[m.id] = true; });
short = short.map(function(m){ if(pinById[m.id]) m.pin = true; return m; });
// 防御: 超过上限时把最旧的挤进 long
if(short.length > SHORT_MAX){
var drop = short.slice(0, short.length - SHORT_MAX);
short = short.slice(-SHORT_MAX);
var squeeze = drop.map(function(m){ return m.fact;}).join(";");
long = (long? long + "\n": "") + "[更早] " + squeeze.slice(0, 400);
}
var mood = (o.mood && o.mood.state)? {state: String(o.mood.state).slice(0, 30),
filter: String(o.mood.filter || "").slice(0, 150)}: ((prev && prev.mood) || null);
return {mood: mood, short: short, long: long, updatedAt: Date.now()};
}

/* 每周期跑一次分析。返回 {analyzed}。
 * P0-4: 水位改 msg_id 制 (up_to_msg_id): 新消息 = 该 id 之后的消息;
 * 老 up_to(索引) 做一次性迁移; delMsg/历史裁剪后水位不错位。 */
async function maybeAnalyze(runId, name, history, cfg, callChat, cardHint){
var st = get(runId, name);
var upId = (st && st.up_to_msg_id) || null;
var idx = 0;
if(upId){
idx = -1;
for(var f = 0; f < history.length; f++){
var fmid = history[f] && (history[f].mid || history[f].id);
if(fmid === upId){ idx = f + 1; break; }
}
if(idx < 0) idx = Math.min((st && st.up_to) || 0, history.length); // 水位消息被删: 回退旧索引水位
} else {
idx = Math.min((st && st.up_to) || 0, history.length); // 老状态一次性迁移
}
if(history.length - idx < cycle()) return {analyzed: false};
var newMsgs = history.slice(idx).map(function(m){
return (m.role === "user"? "我": (m.speaker || name)) + ": " + String(m.content).slice(0, 300);
}).join("\n").slice(0, 8000);
if(!newMsgs.trim()) return {analyzed: false};
var sumCfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
var raw = "";
try {
raw = await callChat(sumCfg, [
{role: "user", content: buildAnalysisPrompt(name, cardHint, st, newMsgs)},
], 0.3);
} catch(e){ return {analyzed: false};} // 失败: 不打断, 下次重试
var next = parseState(raw, st);
if(!next) return {analyzed: false};
var lastM = history[history.length - 1];
next.up_to = history.length;
next.up_to_msg_id = (lastM && (lastM.mid || lastM.id)) || upId || null;
save(runId, name, next);
return {analyzed: true};
}

/* 置顶/取消置顶一条记忆 (按 id, 宽松比较) */
function togglePin(runId, name, id){
var st = get(runId, name);
if(!st || !st.short) return null;
var cur = null;
st.short.forEach(function(m){ if(m.id == id){ m.pin = !m.pin; cur = !!m.pin; } });
if(cur !== null) save(runId, name, st);
return cur;
}
/* 删除一条记忆 */
function delItem(runId, name, id){
var st = get(runId, name);
if(!st || !st.short) return false;
var n0 = st.short.length;
st.short = st.short.filter(function(m){ return m.id != id; });
if(st.short.length === n0) return false;
save(runId, name, st);
return true;
}

/* P1-8: 长期记忆库用量统计 {events, pinned, shortN, longN, shortMax, pinMax} */
var PIN_MAX = 30;
function memStats(runId, name){
var st = get(runId, name);
var short = (st && st.short) || [];
var pinned = 0;
short.forEach(function(m){ if(m.pin) pinned++; });
return {events: short.length, pinned: pinned, shortN: short.length,
longN: (st && st.long) ? 1 : 0, shortMax: SHORT_MAX, pinMax: PIN_MAX};
}

return {get: get, save: save, clear: clear, renderPrompt: renderPrompt,
renderBudgeted: renderBudgeted, memPoolRatio: memPoolRatio,
ironKey: ironKey, getIronLaw: getIronLaw, saveIronLaw: saveIronLaw,
IRONLAW_MAX: IRONLAW_MAX, estTokens: estTokens,
maybeAnalyze: maybeAnalyze, togglePin: togglePin, delItem: delItem,
memStats: memStats, SHORT_MAX: SHORT_MAX, PIN_MAX: PIN_MAX};
})();
