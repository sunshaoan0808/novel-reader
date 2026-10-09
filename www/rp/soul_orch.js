/* Soul 编排层 - Selector + Orchestrator-Workers + 整合者
*
* 流程:
* 用户输入
* -> Selector.select(): 确定性规则 (@提及/轮询) 优先, 语义判断走 cheap LLM
* -> Orchestrator.run(): 选中 soul 并行调用 (各自独立上下文)
* -> Integrator.weave(): 织成叙事 + 仲裁写冲突
*
* 纯被动回合制: soul 只响应, 不自主行动。
*/

var RP_SOUL_ORCH = (function(){
"use strict";

/* ============ Selector ============ */

/* 确定性规则选人 (不调 LLM)
* 返回 {speakers: [name], via: "mention"|"roundrobin"|"all"|null} */
function deterministicSelect(text, souls, state){
/* @提及优先 */
var mentioned = [];
souls.forEach(function(s){
var nm = s.name || s;
if(text.indexOf("@" + nm) >= 0) mentioned.push(nm);
});
if(mentioned.length) return {speakers: mentioned, via: "mention"};

/* state.roundRobin: 上次说话的 index, 轮询 */
if(state && state.mode === "roundrobin" && souls.length){
var _li = (state.lastIdx == null) ? -1 : state.lastIdx;
var idx = (_li + 1) % souls.length;
var nm2 = souls[idx].name || souls[idx];
return {speakers: [nm2], via: "roundrobin", lastIdx: idx};
}
return {speakers: [], via: null};
}

/* LLM 语义选人 (cheap 调用)
* prompt 输出 JSON: {"speakers":["黛玉"],"reactions":[{"name":"宝玉","type":"旁观"}]}
* 失败返回 {speakers: [第一个 soul], via: "fallback"} */
async function llmSelect(text, souls, history, cfg, callFn){
var names = souls.map(function(s){ return s.name || s;});
if(names.length === 0) return {speakers: [], reactions: [], via: "none"};
if(names.length === 1){
return {speakers: names, reactions: [], via: "single"};
}

var prompt =
"你是群聊导演。根据用户最新消息, 判断接下来该由哪位角色回应。\n" +
"在场角色: " + names.join("、") + "\n" +
"用户消息: " + String(text).slice(0, 500) + "\n" +
"只输出 JSON, 格式: {\"speakers\":[\"角色名\"],\"reactions\":[{\"name\":\"角色名\",\"type\":\"旁观\"}]}\n" +
"speakers 是直接回应的人 (1-2个), reactions 是有旁观反应的人 (可空)。不要解释。";

try{
var raw = await callFn(cfg, [{role: "user", content: prompt}], 0.3);
var m = String(raw).match(/\{[\s\S]*\}/);
if(!m) throw new Error("no json");
var d = JSON.parse(m[0]);
var sp = (d.speakers || []).filter(function(n){ return names.indexOf(n) >= 0;});
var re = (d.reactions || []).filter(function(r){ return names.indexOf(r.name) >= 0;});
if(!sp.length) sp = [names[0]];
return {speakers: sp, reactions: re, via: "llm"};
}catch(e){
return {speakers: [names[0]], reactions: [], via: "fallback"};
}
}

/* 统一选人入口 */
async function select(text, souls, history, cfg, callFn, state){
var det = deterministicSelect(text, souls, state || {});
if(det.speakers.length) return det;
return llmSelect(text, souls, history, cfg, callFn);
}

/* ============ per-soul prompt 构建 ============ */

/* 为单个 soul 构建隔离上下文 prompt
* 只带: 自己的人设 + 自己的记忆视角 + 共享场景, 不带其他 soul 的秘密 */
function buildSoulPrompt(soulCard, soulName, scene, userText, history){
var soul = (typeof RP_SOUL!== "undefined")
? (RP_SOUL.getSoul(soulCard) || {}): {};
var persona = soul.persona || {};
var bg = soul.background || {};
var mem = (typeof RP_SOUL!== "undefined")
? RP_SOUL.getMemory(soulCard, soulName): {facts: [], emotional: [], perspective: []};

var parts = [];

/* 身份 (persona 核心) */
var traits = (persona.core_traits || []).map(function(t){
return typeof t === "string"? t: (t.trait || "");
}).filter(Boolean).join("、");
if(traits) parts.push("你是" + soulName + "。" + traits + "。");

/* 宪章 */
if(soul.soul_md) parts.push(soul.soul_md.slice(0, 800));

/* 秘密 (只给自己!) */
if(bg.secrets) parts.push("你的秘密(绝不主动透露): " + bg.secrets.slice(0, 500));

/* 自己的记忆视角 */
var myFacts = (mem.perspective || []).concat(mem.facts || []).slice(-10);
if(myFacts.length){
parts.push("你记得: " + myFacts.map(function(f){
return typeof f === "string"? f: (f.text || "");
}).join("; ").slice(0, 800));
}
if((mem.emotional || []).length){
parts.push("你的情感: " + mem.emotional.slice(-5).map(function(e){
return (e.emotion || "") + ":" + (e.text || "");
}).join("; ").slice(0, 400));
}

/* 共享场景 (不含其他 soul 秘密) */
if(scene) parts.push("场景: " + String(scene).slice(0, 500));

/* 约束 */
parts.push(
"只以" + soulName + "的身份回应。用第一人称。\n" +
"输出 JSON: {\"dialogue\":\"台词\",\"action\":\"动作\",\"inner\":\"内心\",\"silence\":false}\n" +
"无话可说时 silence 设 true, 其他留空。只输出 JSON。"
);

return parts.join("\n\n");
}

/* 解析 soul 回包 (结构化, 失败降级纯文本) */
function parseSoulReply(raw){
var text = String(raw || "");
try{
var m = text.match(/\{[\s\S]*\}/);
if(m){
var d = JSON.parse(m[0]);
return {
ok: true, structured: true,
dialogue: String(d.dialogue || ""),
action: String(d.action || ""),
inner: String(d.inner || ""),
silence:!!d.silence
};
}
}catch(e){}
/* 降级: 纯文本当台词 */
return {ok: true, structured: false, dialogue: text.trim(),
action: "", inner: "", silence:!text.trim()};
}

/* ============ Orchestrator ============ */

/* 并行跑选中的 souls
* souls: [{card, name}]
* 返回 [{name, reply(解析后), raw}] */
async function run(souls, scene, userText, history, opts){
opts = opts || {};
var cfg = opts.cfg || {};
var turnId = opts.turnId || ("t" + Date.now());
if(typeof RP_SOUL_RT!== "undefined") RP_SOUL_RT.startTurn(turnId);

var jobs = souls.map(function(s){
var prompt = buildSoulPrompt(s.card, s.name, scene, userText, history);
var profile = (typeof RP_SOUL!== "undefined")
? RP_SOUL.getProfile(s.card): "";
var messages = (history || []).concat([{role: "user", content: prompt}]);
/* soul 的"想"用短 prompt, 温度取卡片温度 */
return RP_SOUL_RT.callSoul({
soulName: s.name,
profile: profile,
cfg: cfg,
messages: messages,
temperature: opts.temperature!= null? opts.temperature: 0.8,
maxTokens: opts.maxTokens || 800,
contextToken: opts.contextToken
}).then(function(r){
if(!r.ok) return {name: s.name, ok: false, error: r.error};
return {name: s.name, ok: true, reply: parseSoulReply(r.text),
model: r.model, fallback: r.fallback};
});
});

var results = await Promise.all(jobs);
return {results: results, turnId: turnId,
stats: (typeof RP_SOUL_RT!== "undefined")? RP_SOUL_RT.getStats(turnId): {}};
}

/* ============ 整合者 ============ */

/* 把 soul 回包织成最终叙事
* 纯文本拼接 (便宜, 确定性); 需要仲裁时才调 LLM */
function weave(results, opts){
opts = opts || {};
var parts = [];
var actions = []; /* 写冲突检测用 */

results.forEach(function(r){
if(!r.ok ||!r.reply || r.reply.silence) return;
var rp = r.reply;
var segs = [];
if(rp.action) segs.push("【" + r.name + " " + rp.action + "】");
if(rp.dialogue) segs.push(r.name + ": " + rp.dialogue);
/* inner 不直接输出, 只用于仲裁参考 */
if(segs.length) parts.push(segs.join("\n"));
if(rp.action) actions.push({name: r.name, action: rp.action});
});

/* 写冲突检测: 简单规则 - 同一动词+同一宾语算冲突 */
var conflicts = detectConflicts(actions);

return {text: parts.join("\n\n"), conflicts: conflicts,
speakers: results.filter(function(r){ return r.ok;}).map(function(r){ return r.name;})};
}

/* 简单冲突检测: 提取"拿/抢/开/关"等互斥动词 */
function detectConflicts(actions){
var exclusive = ["拿", "抢", "夺", "开", "关", "吃", "喝", "坐"];
var seen = {};
var conflicts = [];
actions.forEach(function(a){
exclusive.forEach(function(v){
if(a.action.indexOf(v) >= 0){
/* 取动词后 6 字作宾语近似 */
var idx = a.action.indexOf(v);
var obj = a.action.slice(idx, idx + 7);
var key = v + ":" + obj;
if(seen[key] && seen[key]!== a.name){
conflicts.push({type: "exclusive_action", a: seen[key], b: a.name, action: obj});
}else{
seen[key] = a.name;
}
}
});
});
return conflicts;
}

return {
select: select,
deterministicSelect: deterministicSelect,
llmSelect: llmSelect,
buildSoulPrompt: buildSoulPrompt,
parseSoulReply: parseSoulReply,
run: run,
weave: weave,
detectConflicts: detectConflicts
};

})();
if(typeof window!== "undefined") window.RP_SOUL_ORCH = RP_SOUL_ORCH;
if(typeof module!== "undefined") module.exports = RP_SOUL_ORCH;
