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

/* 状态渲染成 prompt 段 (置顶记忆优先, 永不遗忘) */
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

/* 每周期跑一次分析。返回 {analyzed} */
async function maybeAnalyze(runId, name, history, cfg, callChat, cardHint){
var st = get(runId, name);
var up_to = (st && st.up_to) || 0;
if(history.length - up_to < cycle()) return {analyzed: false};
var newMsgs = history.slice(up_to).map(function(m){
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
next.up_to = history.length;
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
maybeAnalyze: maybeAnalyze, togglePin: togglePin, delItem: delItem,
memStats: memStats, SHORT_MAX: SHORT_MAX, PIN_MAX: PIN_MAX};
})();
