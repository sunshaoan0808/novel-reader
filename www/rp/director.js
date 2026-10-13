/* 导演系统：幕后剧情规划（沉浸式 RP）
* 设计借鉴（只抄思路，不抄代码）：
* - luisbrandao/SillyTavern-Director: two-model pass——扮演回复前另一次 LLM 调用出剧情大纲，
* 注入扮演 prompt；多套导演风格 prompt；previous outlines 保持决策连贯
* - brucestarkallen/sillytavern-chat-assistant: 主权铁律——导演只编排世界/NPC 那一半，
* 永远不替玩家做决定，剧情规划停在玩家决策点之前
* - charlesnty612/NovelOS director-v1: 导演 prompt 契约 + 停滞强制升级规则
* （连续日常循环必须引入外部变量打破）
* - mattjaybe/SillyTavern-Pathweaver: Surprise Me——延迟事件卡，秘密登记 N 轮后引爆
* - Valve L4D AI Director（GDC 2009）: 峰谷节奏——持续高强度=疲劳，长期平淡=无聊
*
* 核心铁律：导演只规划剧情（回答"接下来发生什么、为什么"），永远不写正文；
* 正文仍由扮演 AI 写。导演也永远不替玩家做决定，只编排世界那一半。
*
* 状态键：nd_director_<chatId>（localStorage，小 JSON，不走 IDB）
* 注入约定：输出小 JSON，解析后只把 compact briefing 以块注入扮演 prompt，
* 从不进入用户可见正文。
*/
var RP_DIRECTOR = (function(){
"use strict";

/* ---------- 5 套导演风格（多风格 prompt 思想） ---------- */
var STYLES = {
slowburn: {name: "慢热",
desc: "让每个时刻充分呼吸；节奏变化要挣来（earned），少用升温，多用日常细节埋小钩子"},
plotdriver: {name: "推剧情",
desc: "每拍必须改变点什么：揭露信息、加码冲突、逼出选择、回收伏笔；多用升温与转场"},
wildcard: {name: "整活",
desc: "每轮埋一个合理但意外的 complication；意外必须合乎世界观逻辑，不能为反而反"},
mystery: {name: "悬疑",
desc: "经营信息差与未解之谜；真相一点点漏，不一次倒完；多用伏笔推进"},
warm: {name: "温馨日常",
desc: "治愈优先；节奏以喘息为主，升温只留给温情的高潮时刻"},
};

var PACING_CN = {continue: "保持", escalate: "升温", breathe: "喘息", transition: "转场"};
function pacingOk(p){ return p === "continue" || p === "escalate" || p === "breathe" || p === "transition";}

/* ---------- 存储 ---------- */
function keyOf(chatId){ return "nd_director_" + chatId;}
function lsGet(k){ try{ var v = localStorage.getItem(k); return v? JSON.parse(v): null;}catch(e){ return null;}}
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v));}catch(e){}}

/* 全局配置（读 app.js 的 getRpCfg，测试环境无则用默认） */
function gcfg(){
var d = {director: true, directorTier: "sentinel", directorStyle: "slowburn",
directorEvery: 5, directorStale: 8, directorModel: ""};
try{ if(typeof getRpCfg!== "undefined"){ var c = getRpCfg() || {}; for(var k in d){ if(c[k]!== undefined) d[k] = c[k];}}}catch(e){}
return d;
}
function enabled(){ return!!gcfg().director;}
function directorModel(cfg){
var m = String(gcfg().directorModel || "").trim();
return m || (cfg && cfg.model) || "";
}

function ensure(chatId){
var st = lsGet(keyOf(chatId));
if(st && st.v === 1){
if(!Array.isArray(st.delayed)) st.delayed = [];
return st;
}
st = {v: 1, msgCount: 0, roundsSinceEvent: 0, lastBeat: "", lastPacing: "", delayed: []};
lsSet(keyOf(chatId), st);
return st;
}
function save(chatId, st){ lsSet(keyOf(chatId), st);}
function get(chatId){ return lsGet(keyOf(chatId));}
function reset(chatId){ try{ localStorage.removeItem(keyOf(chatId));}catch(e){}}

/* ---------- 主权检查：导演永远不替玩家做决定 ----------
* beat 里不许让"你/玩家"当行动句的主语（决定/选择/说/做/走/去/想…），
* 只许编排世界与 NPC 那一半。命中则丢弃该 beat。 */
var SOV_RE = /让玩家|(你|玩家)(决定|选择|说|做|回答|走|去|拿|想|觉得|必须|应该|将会|要|打算)/;
function sovereignOk(beat){ return!SOV_RE.test(String(beat || ""));}

/* ---------- 导演输出解析 ---------- */
function parseOutput(text){
if(!text) return null;
var m = String(text).match(/\{[\s\S]*\}/);
if(!m) return null;
var o;
try{ o = JSON.parse(m[0]);}catch(e){ return null;}
var pacing = pacingOk(o.pacing)? o.pacing: "continue";
var beat = String(o.beat || "").trim();
var delayed = null;
if(o.delayed && o.delayed.beat){
var after = Math.max(1, Math.min(20, parseInt(o.delayed.after, 10) || 3));
delayed = {after: after, beat: String(o.delayed.beat).trim().slice(0, 160)};
}
var ban = Array.isArray(o.ban)? o.ban.map(String).filter(Boolean).slice(0, 3): [];
if(!beat &&!delayed &&!ban.length) return null;
return {pacing: pacing, beat: beat, delayed: delayed, ban: ban};
}

/* ---------- 延迟事件卡（Pathweaver Surprise Me 思路） ---------- */
function scheduleDelayed(st, dl){
if(!dl ||!dl.beat) return;
st.delayed.push({id: "e" + Date.now().toString(36) + Math.floor(Math.random()*999),
beat: dl.beat, fireAt: st.msgCount + dl.after});
}
function fireDue(st){
var fired = [];
st.delayed = (st.delayed || []).filter(function(e){
if(st.msgCount >= e.fireAt){ fired.push(e.beat); return false;}
return true;
});
return fired;
}

/* ---------- prompt 组装 ---------- */
/* P2-11: 收敛到 escutil.js 的 escH()；独立加载（测试 vm）无 escH 时回退同款实现 */
var esc = (typeof escH === "function") ? escH : function(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function recentText(h, k){
var src = (h || []).slice(-(k || 8));
return src.map(function(m){
var who = m.role === "user"? "玩家": (m.speaker || "角色");
var c = String(m.content || "").replace(/\s+/g, " ").slice(0, 200);
return who + "：" + c;
}).join("\n");
}
function simLine(chatId, hint){
try{
if(typeof RP_WORLDSIM!== "undefined"){
var ws = RP_WORLDSIM.get(chatId) || RP_WORLDSIM.ensure(chatId, hint);
return RP_WORLDSIM.fmtTime(ws) + " / " + RP_WORLDSIM.weatherName(ws.wx) +
" / " + RP_WORLDSIM.curPlace(ws).name;
}
}catch(e){}
return "未知";
}
/* ---------- 原著因果蓝图（蒸馏管线 worldcard.json，供导演作编排灵感） ----------
 * 世界卡由 App 在聊天开始时预加载；buildPrompt 是同步的，只读缓存，
 * 未加载完成时静默跳过（不阻塞导演）。铁律：只可改编化用，绝不剧透原文。 */
function worldcardBrief(runId){
try{
if(!runId || typeof getWorldcard !== "function") return "";
var wc = getWorldcard(runId);
if(!wc || !wc.directorDefinitions || !wc.directorDefinitions.length) return "";
var dd = wc.directorDefinitions[0];
var lines = [];
if(dd.coreConflict) lines.push("核心冲突：" + String(dd.coreConflict).slice(0, 120));
if(dd.anchors && dd.anchors.length) lines.push("世界锚点：" + dd.anchors.slice(0, 4).join("、"));
var tps = (dd.nodes || []).filter(function(n){ return n && n.execution === "foreground"; }).slice(0, 6);
if(tps.length) lines.push("原著转折事件池（只可改编化用，绝不直接复述、绝不剧透）：" +
tps.map(function(n){ return n.title; }).join("；"));
if(!lines.length) return "";
return "【原著因果蓝图】以下来自原著蒸馏，可作编排灵感：\n" + lines.join("\n") + "\n";
}catch(e){ return ""; }
}

function buildPrompt(chatId, st, o, forceStale){
var c = gcfg();
var style = STYLES[c.directorStyle] || STYLES.slowburn;
var staleWarn = forceStale?
"【停滞警告】剧情已连续多轮没有波澜（日常闲聊循环），本轮必须引入一个外部变量 / 意外事件 / 时间跳跃来打破循环，但仍不许替玩家做决定、不许写正文。\n": "";
return "你是这场角色扮演聊天的幕后导演（Director），不是演员，不写正文。\n" +
"你的任务：判断剧情节奏，规划下一步世界 / NPC 发生什么，防止剧情拖沓或跑偏。\n" +
"铁律（违反则输出被直接丢弃）：\n" +
"1. 只输出下方 JSON，绝不写正文、对话、旁白、心理描写；\n" +
"2. 永远不替玩家做决定：beat 里不许出现「你/玩家 + 决定/选择/说/做/走/去/想」这类替玩家行动的表述，只编排世界与 NPC 那一半；\n" +
"3. 剧情规划停在玩家决策点之前，把选择权留给玩家；\n" +
"4. 不许剧透玩家不应知道的隐藏信息。\n" +
"导演风格：" + style.name + "——" + style.desc + "\n" +
"当前世界状态（时间 / 天气 / 地点）：" + simLine(chatId, o.hint) + "\n" +
worldcardBrief(o.runId) +
"角色：" + (o.cardBrief || "未知") + "\n" +
(st.lastBeat? "上次导演指令：" + st.lastBeat + "（" + (PACING_CN[st.lastPacing] || "保持") + "）\n": "") +
"最近对话：\n" + (recentText(o.history, 8) || "（开场）") + "\n" +
staleWarn +
"只输出 JSON（无其他文字），字段说明：\n" +
"pacing=continue(保持)|escalate(升温)|breathe(喘息)|transition(转场)；\n" +
"beat=一句话剧情走向，只写世界/NPC 发生什么；\n" +
"delayed=延迟事件卡 {after:N轮后, beat:事件}，想埋雷几轮后引爆时用，否则 null；\n" +
"ban=本轮禁令数组，如「不许让新人物突然登场」。\n" +
'{"pacing":"continue","beat":"…","delayed":null,"ban":[]}';
}

/* ---------- LLM 调用（可被测试 stub：RP_DIRECTOR._complete） ---------- */
function defaultComplete(cfg, messages){
if(typeof RP_NET=== "undefined" ||!RP_NET.complete) return Promise.reject(new Error("RP_NET missing"));
var model = directorModel(cfg);
return RP_NET.complete({base: cfg.base, key: cfg.key}, messages, 0.7, model, {maxTokens: 400});
}
var api = null; /* 后面赋值，供内部调用可 stub 的 _complete */
function callLLM(cfg, messages){
var f = (api && api._complete) || defaultComplete;
return f(cfg, messages);
}

async function runDirector(chatId, st, o, forceStale){
var prompt = buildPrompt(chatId, st, o, forceStale);
var raw = await callLLM(o.cfg, [{role: "system", content: prompt}]);
var d = parseOutput(raw);
if(!d) return null;
if(d.beat &&!sovereignOk(d.beat)) d.beat = ""; /* 主权过滤：越界 beat 直接丢弃 */
if(d.beat && d.beat.length > 160) d.beat = d.beat.slice(0, 160) + "…";
return d;
}

/* ---------- 注入文本渲染（compact briefing，几十 token） ---------- */
function renderBrief(d){
var lines = ["【导演】", "节奏：" + (PACING_CN[d.pacing] || "保持")];
if(d.beat) lines.push("剧情走向：" + d.beat);
if(d.ban && d.ban.length) lines.push("禁令：" + d.ban.join("；"));
lines.push("（以上为幕后剧情规划，只调度世界与 NPC，绝不替玩家做决定；本块不对用户可见）");
return lines.join("\n");
}
function renderEventBlock(beats){
return "【导演·事件】此前埋下的事件现在发生了，请自然地写入叙事（不要生硬转折）：\n" +
beats.map(function(b, i){ return (i+1) + ". " + b;}).join("\n");
}

/* ---------- 主入口：每轮用户消息后调用，返回本轮要注入扮演 prompt 的文本 ---------- */
async function onUserMessage(chatId, o){
o = o || {};
if(!enabled()) return "";
var cfg = o.cfg || {};
if(!cfg.base ||!cfg.key) return ""; /* 未配 API：静默跳过 */
var st = ensure(chatId);
st.msgCount++;
var out = [];
/* 1. 延迟事件卡引爆 */
var fired = fireDue(st);
if(fired.length){
out.push(renderEventBlock(fired));
st.roundsSinceEvent = 0;
}
/* 2. 是否触发导演调用 */
var c = gcfg();
var tier = c.directorTier || "sentinel";
var every = Math.max(1, c.directorEvery|0 || 5);
var staleN = Math.max(3, c.directorStale|0 || 8);
var forceStale = st.roundsSinceEvent >= staleN; /* 停滞强制升级（NovelOS Rule 13 思路） */
var due = (tier === "full") || (st.msgCount % every === 0);
if(due || forceStale){
try{
var d = await runDirector(chatId, st, o, forceStale);
if(d){
if(d.delayed) scheduleDelayed(st, d.delayed);
if(d.beat || (d.ban && d.ban.length)) out.push(renderBrief(d));
st.lastBeat = d.beat || st.lastBeat;
st.lastPacing = d.pacing;
if(d.pacing === "escalate" || d.pacing === "transition" || fired.length) st.roundsSinceEvent = 0;
else st.roundsSinceEvent++;
}else{
if(!fired.length) st.roundsSinceEvent++;
}
}catch(e){
if(!fired.length) st.roundsSinceEvent++;
}
}else if(!fired.length){
st.roundsSinceEvent++;
}
save(chatId, st);
return out.join("\n\n");
}

/* ---------- HUD：只显示风格，不剧透具体指令 ---------- */
function briefHTML(chatId){
if(!enabled()) return "";
var c = gcfg();
var st = STYLES[c.directorStyle] || STYLES.slowburn;
var ic = (typeof icon!== "undefined")? icon: function(){ return "";};
return '<span class="simchip dirchip" title="导演系统运行中（' + esc(st.name) +
'风格）：只规划剧情节奏，不写正文、不替你做决定">' +
ic("clapperboard", 12) + " 导演·" + esc(st.name) + "</span>";
}

api = {
STYLES: STYLES, PACING_CN: PACING_CN,
keyOf: keyOf, get: get, save: save, ensure: ensure, reset: reset,
enabled: enabled, gcfg: gcfg, directorModel: directorModel,
sovereignOk: sovereignOk, parseOutput: parseOutput,
scheduleDelayed: scheduleDelayed, fireDue: fireDue,
buildPrompt: buildPrompt, recentText: recentText, simLine: simLine,
renderBrief: renderBrief, renderEventBlock: renderEventBlock,
onUserMessage: onUserMessage, briefHTML: briefHTML,
_complete: null /* 测试可 stub：D._complete = async (cfg, msgs)=> "..." */,
};
return api;
})();
