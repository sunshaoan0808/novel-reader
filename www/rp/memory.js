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

/* ============ LeanMem 三库记忆 (arXiv:2608.03463): 按可压缩性/时间动态/保真要求分流 ============
 * profile3: 稳定事实 [{id, text, updatedAt, fromPin}] 上限 20, 只追加/覆盖, 极少变更
 * event3: 带时间锚事件 [{id, topic, t_anchor, state, merged, updatedAt}] 上限 40,
 *         唯一允许跨周期"演化合并"的库 (同类 topic 合并成 temporal state)
 * record3: 轻量 gist + 原文指针 [{id, gist, msg_from, msg_to, legacy}] 上限 60, 只追加不改写
 * 开关: 设置页 leanmem (默认开); getRpCfg 不存在时(老测试上下文)走旧三池路径。 */
var PROFILE3_MAX = 20, EVENT3_MAX = 40, RECORD3_MAX = 60;
function leanmemOn(){
try{
if(typeof getRpCfg !== "function") return false; // 老测试上下文: 保持旧行为
var c = getRpCfg();
return !c || c.leanmem !== false;
}catch(e){ return false; }
}
/* LeanMem Adaptive Evidence Composition: 按用户问题类型自适应调三池权重 (纯关键词启发式)。
 * 问人设/偏好 -> important 加权; 问过去/时间线 -> recent 加权; 问细节/原话 -> similar 加权。 */
function leanRatio(query, base){
var wI = 1, wR = 1, wS = 1;
var q = String(query || "");
if(q){
if(/你是谁|你的名字|你叫什么|你的性格|性格|你喜欢|喜欢|讨厌|喜好|偏好|人设|我是谁|我的名字|记住我|了解你/.test(q)) wI = 2.2;
else if(/之前|以前|那次|那天|当时|后来|然后|发生|记得|什么时候|时间线|经过|昨天|前天|上次/.test(q)) wR = 2.2;
else if(/原话|怎么说|具体|详细|复述|哪一句|原文|一字|细节|说过什么/.test(q)) wS = 2.2;
}
return {important: base.important * wI, recent: base.recent * wR, similar: base.similar * wS};
}
function nextStoreId(arr){
var m = 0;
(arr || []).forEach(function(x){ if(x && x.id > m) m = x.id; });
return m + 1;
}
/* 纯函数: 从旧 short/long 种子化三库 (不写盘)。pinned -> profile3(fromPin 标记, 展示仍在置顶区);
 * 未置顶 short -> event3; long -> record3 (legacy 标记, similar 池仍走旧"占位"渲染)。 */
function seedStores(st){
st = st || {};
var profile3 = [], event3 = [], record3 = [];
var shorts = Array.isArray(st.short) ? st.short : [];
shorts.forEach(function(m){
if(!m) return;
if(m.pin){
profile3.push({id: nextStoreId(profile3), fromPin: true,
text: String(m.fact || m.view || "").slice(0, 120), updatedAt: Date.now()});
}else{
event3.push({id: nextStoreId(event3), topic: String(m.fact || "").slice(0, 40),
t_anchor: String(m.time || ""), state: String(m.view || m.fact || "").slice(0, 120),
updatedAt: Date.now()});
}
});
var lg = String(st.long || "");
if(lg) record3.push({id: 1, gist: lg.slice(0, 120), msg_from: null, msg_to: null, legacy: true});
st.profile3 = profile3; st.event3 = event3; st.record3 = record3;
st.migrated3 = true;
return st;
}
/* 一次性迁移 (幂等): seedStores + 落盘。不碰 up_to / up_to_msg_id 水位。 */
function migrate3(runId, name, st){
st = st || {};
if(st.migrated3) return st;
seedStores(st);
save(runId, name, st);
return st;
}
/* 事件同类判定: topic 共有 bigram >= 2 则视为同类 (启发式, 演化合并用) */
function eventSimilar(a, topicB){
var ba = {}, i, ta = String((a && a.topic) || "");
for(i = 0; i < ta.length - 1; i++) ba[ta.substr(i, 2)] = 1;
var tb = String(topicB || ""), hit = 0;
for(i = 0; i < tb.length - 1; i++) if(ba[tb.substr(i, 2)]) hit++;
return hit >= 2;
}
/* LeanMem Controlled Writing: 分流输出 profile/event/record; 低信息量周期直接 drop。 */
function buildAnalysisPrompt3(name, cardHint, st, newMsgs){
st = st || {};
var prev = {profile: st.profile3 || [], event: st.event3 || [], record: st.record3 || []};
return "你是" + name + "的记忆整理者(LeanMem 分流整理)。" + (cardHint ? "人物速写: " + cardHint + "\n" : "") +
"上次整理后的三库状态(JSON, 已截断):\n" + JSON.stringify(prev).slice(0, 4000) + "\n\n" +
"自上次整理以来的新对话:\n" + newMsgs + "\n\n" +
"【第一阶段·内部思考, 禁止输出】\n" +
"1. 过滤: 寒暄(你好/在吗/嗯嗯)、重复、纯表情、无实质信息的轮次直接丢弃, 不记。\n" +
"2. 分流: 剩下的内容按三库归类——\n" +
"   profile 库: 稳定事实(喜好/习惯/身份/与\"我\"的关系进展等), 极少变化, 只写新增或变化的;\n" +
"   event 库: 发生的事, 写成 topic(10-20字)+t_anchor(相对时间如\"今晚\")+state(30-60字当时状态/结果);\n" +
"   record 库: 值得回溯原文的细节, 一句话 gist(如关键原话、数字、承诺)。\n" +
"3. 心境: 定性" + name + "此刻的心境(1-2个词)+50-100字此刻看世界的滤镜。\n" +
"【第二阶段·唯一输出】: 只输出一个 JSON, 无其他文字:\n" +
'{"drop":false,"mood":{"state":"1-2个词","filter":"50-100字"},' +
'"profile":["新增稳定事实, 无则[]"],' +
'"event":[{"topic":"…","t_anchor":"…","state":"…"}],' +
'"record":["…gist…"]}。' +
"\n若本周期全是低信息量内容(寒暄/重复/无实质), 只输出 {\"drop\":true}。";
}
/* LeanMem 解析: drop -> 三库不动(水位照常推进); 新格式 -> 分流写入;
 * 旧格式(short/long) -> 走旧 parseState 再种子化 (兼容)。msgRange={from,to} 回填 record 指针。 */
function parseState3(raw, prev, msgRange){
prev = prev || {};
if(!prev.migrated3) prev = seedStores(prev);
var t = String(raw || "").replace(/```json|```/g, "");
var a = t.indexOf("{"), b = t.lastIndexOf("}");
if(a < 0 || b <= a) return null;
var o;
try { o = JSON.parse(t.slice(a, b + 1)); } catch(e){ return null; }
if(!o || typeof o !== "object") return null;
var isOld = Array.isArray(o.short) && !o.profile && !o.event && !o.record && !("drop" in o);
if(isOld){
var base = parseState(raw, prev); // 旧格式兼容 (short/long/mood)
if(base) return seedStores(base);
return null;
}
var p3 = (prev.profile3 || []).slice(), e3 = (prev.event3 || []).slice(), r3 = (prev.record3 || []).slice();
if(!o.drop){
/* profile: 只追加/覆盖 (新条目包含旧条目或反之 -> 替换, 否则追加) */
(o.profile || []).forEach(function(tx){
tx = String(tx || "").slice(0, 120);
if(!tx) return;
var found = -1;
for(var i = 0; i < p3.length; i++){
var e = String(p3[i].text || "");
if(e && (e.indexOf(tx) >= 0 || tx.indexOf(e) >= 0)){ found = i; break; }
}
if(found >= 0) p3[found] = {id: p3[found].id, fromPin: !!p3[found].fromPin, text: tx, updatedAt: Date.now()};
else p3.push({id: nextStoreId(p3), text: tx, updatedAt: Date.now()});
});
p3 = p3.slice(-PROFILE3_MAX);
/* event: 演化合并 —— 只有 event 库允许跨周期合并, profile/record 不动 */
(o.event || []).forEach(function(ev){
if(!ev) return;
var topic = String(ev.topic || "").slice(0, 40), ta = String(ev.t_anchor || "").slice(0, 20);
var state = String(ev.state || "").slice(0, 120);
if(!topic && !state) return;
var m = null;
for(var i = 0; i < e3.length; i++) if(eventSimilar(e3[i], topic)){ m = e3[i]; break; }
if(m){
m.state = ((m.state ? m.state + "；" : "") + state).slice(0, 200);
if(!m.t_anchor) m.t_anchor = ta;
m.merged = (m.merged || 1) + 1; m.updatedAt = Date.now();
}else{
e3.push({id: nextStoreId(e3), topic: topic, t_anchor: ta, state: state, updatedAt: Date.now()});
}
});
e3 = e3.slice(-EVENT3_MAX);
/* record: 只追加不改写 */
(o.record || []).forEach(function(g){
g = String(g || "").slice(0, 120);
if(!g) return;
r3.push({id: nextStoreId(r3), gist: g,
msg_from: (msgRange && msgRange.from) || null, msg_to: (msgRange && msgRange.to) || null});
});
r3 = r3.slice(-RECORD3_MAX);
}
var mood = (o.mood && o.mood.state) ? {state: String(o.mood.state).slice(0, 30),
filter: String(o.mood.filter || "").slice(0, 150)} : (prev.mood || null);
return {mood: mood, short: prev.short || [], long: prev.long || "",
profile3: p3, event3: e3, record3: r3, migrated3: true, updatedAt: Date.now()};
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
var lean = leanmemOn();
if(lean) st = migrate3(runId, name, st); // 幂等迁移: 老 short/long 进三库, 不丢水位
var iron = getIronLaw(runId, name, opts.cardId);
var short = (st.short || []).slice();
var pinned = short.filter(function(m){ return m.pin; }).reverse();  // 新→旧
var rest = short.filter(function(m){ return !m.pin; }).reverse();    // 新→旧
var mood = (st.mood && st.mood.state) ? st.mood : null;
var long = String(st.long || "");

var ratio = lean ? leanRatio(opts.query, memPoolRatio()) : memPoolRatio(); // LeanMem 自适应组装
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
var ironSec = "", pinLines = [], moodSec = "", profLines = [];
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
/* LeanMem: profile 库 (稳定事实) 进 important 池; fromPin 的已在置顶区展示, 跳过 */
if(lean){
var p3arr = (st.profile3 || []);
for(var qi = 0; qi < p3arr.length; qi++){
if(p3arr[qi].fromPin) continue;
var ql = addImp("profile", "- " + String(p3arr[qi].text || ""), false);
if(ql) profLines.push(ql);
}
}
if(mood){
var mt = "【当前心境】" + mood.state + (mood.filter ? "——" + mood.filter : "");
moodSec = addImp("mood", mt, false);
}
}
if(ironSec) secs.push(ironSec);
if(pinLines.length)
secs.push("【置顶记忆】(永不遗忘, 回答时优先参考)\n" + pinLines.join("\n"));
if(profLines.length){
secs.push("【画像记忆】(稳定事实)\n" + profLines.join("\n"));
pools.important.store = "profile库";
}
if(moodSec) secs.push(moodSec);

/* ---- recent 池: LeanMem 开 -> event 库 (新→旧, 按条丢弃); 关 -> 未置顶短期 ---- */
var recLines = [], recLeft = bRec;
if(lean && st.event3 && st.event3.length){
pools.recent.store = "event库";
var evSrc = st.event3.slice().reverse(); // 新→旧
for(var rei = 0; rei < evSrc.length; rei++){
var evx = evSrc[rei];
var et = "- " + (evx.t_anchor ? evx.t_anchor + " " : "") + String(evx.topic || "") +
(evx.state ? "——" + evx.state : "");
var en = estTokens(et);
if(en <= recLeft){ recLines.push(et); recLeft -= en;
pools.recent.tokens += en; pools.recent.items++; }
else pools.recent.dropped++;
}
if(recLines.length) secs.push("【事件】(新→旧)\n" + recLines.join("\n"));
}else{
for(var ri = 0; ri < rest.length; ri++){
var rt = fmtItem(rest[ri]);
var rn = estTokens(rt);
if(rn <= recLeft){ recLines.push(rt); recLeft -= rn;
pools.recent.tokens += rn; pools.recent.items++; }
else pools.recent.dropped++;
}
if(recLines.length) secs.push("【近期记忆】(新→旧)\n" + recLines.join("\n"));
}

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

/* LeanMem: record 库 (gist + 原文指针) 补进 similar 池剩余预算, 只追加不改写;
 * legacy 种子(由旧 long 迁移)不单独渲染, 仍走上面的"占位"路径。 */
if(lean){
var rec3src = (st.record3 || []).filter(function(r){ return r && !r.legacy; }).reverse(); // 新→旧
if(rec3src.length){
var gLeft = bSim - pools.similar.tokens;
var gLines = [];
for(var gi = 0; gi < rec3src.length; gi++){
var gr = rec3src[gi];
var gt = "- " + String(gr.gist || "") +
((gr.msg_from || gr.msg_to) ? "（原文 " + (gr.msg_from || "?") + "→" + (gr.msg_to || "?") + ")" : "");
var gn = estTokens(gt);
if(gn <= gLeft){ gLines.push(gt); gLeft -= gn;
pools.similar.tokens += gn; pools.similar.items++; }
else pools.similar.dropped++;
}
if(gLines.length){
secs.push((tInfo ? "" : "【记录】(细节可回溯原文)\n") + gLines.join("\n"));
pools.similar.source = tInfo ? "时序切片+record库" : "record库";
}
}
}

pools.ratio = {important: bImp, recent: bRec, similar: bSim}; // 自适应后的实际预算, 供 Inspector/测试
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
var lean = leanmemOn();
if(lean) st = migrate3(runId, name, st); // 幂等迁移, 先保证三库存在; 不丢水位
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
/* LeanMem: record 指针 = 本周期新消息的 msg_id 区间 */
var msgRange = null;
if(lean && history.length){
var _f = history[idx], _l = history[history.length - 1];
msgRange = {from: (_f && (_f.mid || _f.id)) || null, to: (_l && (_l.mid || _l.id)) || null};
}
var raw = "";
try {
raw = await callChat(sumCfg, [
{role: "user", content: lean ? buildAnalysisPrompt3(name, cardHint, st, newMsgs)
: buildAnalysisPrompt(name, cardHint, st, newMsgs)},
], 0.3);
} catch(e){ return {analyzed: false};} // 失败: 不打断, 下次重试
var next = lean ? parseState3(raw, st, msgRange) : parseState(raw, st);
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
longN: (st && st.long) ? 1 : 0, shortMax: SHORT_MAX, pinMax: PIN_MAX,
profileN: (st && st.profile3) ? st.profile3.length : 0,
event3N: (st && st.event3) ? st.event3.length : 0,
recordN: (st && st.record3) ? st.record3.length : 0,
lean: leanmemOn() && !!(st && st.migrated3)};
}

return {get: get, save: save, clear: clear, renderPrompt: renderPrompt,
renderBudgeted: renderBudgeted, memPoolRatio: memPoolRatio,
ironKey: ironKey, getIronLaw: getIronLaw, saveIronLaw: saveIronLaw,
IRONLAW_MAX: IRONLAW_MAX, estTokens: estTokens,
maybeAnalyze: maybeAnalyze, togglePin: togglePin, delItem: delItem,
memStats: memStats, SHORT_MAX: SHORT_MAX, PIN_MAX: PIN_MAX,
leanmemOn: leanmemOn, leanRatio: leanRatio, migrate3: migrate3, seedStores: seedStores,
buildAnalysisPrompt3: buildAnalysisPrompt3, parseState3: parseState3, eventSimilar: eventSimilar,
PROFILE3_MAX: PROFILE3_MAX, EVENT3_MAX: EVENT3_MAX, RECORD3_MAX: RECORD3_MAX};
})();
