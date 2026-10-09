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

/* 私有世界书: 按当前场景/用户输入匹配, 只有该 soul 可见 */
try{
  if(typeof RP_SOUL !== "undefined" && RP_SOUL.matchLore){
    var _loreHits = RP_SOUL.matchLore(soulCard, (scene || "") + " " + (userText || ""));
    if(_loreHits.length){
      parts.push("你私下知道 (别人不知道): " + _loreHits.map(function(e){
        return e.content;
      }).join(" | ").slice(0, 800));
    }
  }
}catch(e){}

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
/* 两阶段: 检查该 soul 是否配了 think/speak 双 profile */
var twoCfg = null;
try{
  var _ts = localStorage.getItem("nd_soul_twostage_" + s.name);
  if(_ts) twoCfg = JSON.parse(_ts);
}catch(e){}
if(twoCfg && twoCfg.think && twoCfg.speak && typeof RP_SOUL_CFG !== "undefined"){
  var _plist = RP_SOUL_CFG.list();
  var _think = null, _speak = null;
  _plist.forEach(function(pp){ if(pp.name === twoCfg.think) _think = pp; if(pp.name === twoCfg.speak) _speak = pp; });
  if(_think && _speak){
    var _soul = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(s.card) : null;
    return twoStageCall(s.name, s.card, _soul, scene, userText, history,
      {think: _think, speak: _speak}, opts).then(function(r){
      if(!r.ok) return {name: s.name, ok: false, error: r.error};
      return {name: s.name, ok: true, reply: parseSoulReply(r.text),
        model: r.model, fallback: "twostage"};
    });
  }
}
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
var reactions = opts.reactions || []; /* [{name, type}] */
var parts = [];
var actions = []; /* 写冲突检测用 */

results.forEach(function(r){
if(!r.ok ||!r.reply || r.reply.silence) return;
var rp = r.reply;
var isReaction = reactions.some(function(x){ return x.name === r.name; });
var segs = [];
if(rp.action) segs.push(isReaction ? "_[" + r.name + " " + rp.action + "]_" : "【" + r.name + " " + rp.action + "】");
if(rp.dialogue) segs.push(isReaction ? "_" + r.name + "（旁观）: " + rp.dialogue + "_" : r.name + ": " + rp.dialogue);
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

/* ============ 群聊集成 ============ */

/* 是否启用 soul 并行模式
 * 条件: per-chat 开关开 + 成员 >=2 + 至少 2 人有 soul 包 */
function shouldUseSoulMode(runId, members, chatId){
  try{
    if(chatId){
      var off = null;
      try{ off = localStorage.getItem("nd_soulmode_off_" + chatId); }catch(e){}
      if(off === "1") return false;
    }
    if(!members || members.length < 2) return false;
    if(members.length > 6) return false; /* 超 6 人降级为传统串行 (成本/延迟) */
    var withSoul = 0;
    members.forEach(function(m){
      try{
        var card = (typeof findCard !== "undefined") ? findCard(runId, m) : null;
        if(card && typeof RP_SOUL !== "undefined" && RP_SOUL.getSoul(card)) withSoul++;
      }catch(e){}
    });
    return withSoul >= 2;
  }catch(e){ return false; }
}

function setSoulMode(chatId, on){
  try{
    if(on) localStorage.removeItem("nd_soulmode_off_" + chatId);
    else localStorage.setItem("nd_soulmode_off_" + chatId, "1");
  }catch(e){}
}

/* Soul 并行群聊主入口 */
async function sendGroupSoul(runId, members, text, opts){
  opts = opts || {};
  var cfg = opts.cfg || {};
  var h = opts.history || [];
  var chatId = opts.chatId || "";
  var soulMembers = [];
  members.forEach(function(m){
    try{
      var card = (typeof findCard !== "undefined") ? findCard(runId, m) : null;
      if(card && typeof RP_SOUL !== "undefined" && RP_SOUL.getSoul(card)){
        soulMembers.push({card: card, name: m});
      }else{
        var bc = card || {name: m, fields: {}, extensions: {}};
        if(typeof RP_SOUL !== "undefined"){
          bc.extensions = bc.extensions || {};
          if(!bc.extensions.soul) bc.extensions.soul = RP_SOUL.fromCard(bc);
        }
        soulMembers.push({card: bc, name: m});
      }
    }catch(e){}
  });
  var sel = await select(text, soulMembers.map(function(s){ return {name: s.name}; }),
    h, cfg,
    function(c, ms, tt){ return (typeof RP_NET !== "undefined") ? RP_NET.complete(c, ms, tt) : Promise.reject(new Error("no net")); },
    {mode: opts.selectMode || "auto"});
  var activeNames = sel.speakers.concat((sel.reactions || []).map(function(r){ return r.name; }));
  activeNames = activeNames.filter(function(n, i){ return activeNames.indexOf(n) === i; });
  var active = soulMembers.filter(function(s){ return activeNames.indexOf(s.name) >= 0; });
  if(!active.length) active = soulMembers.slice(0, 2);
  if(opts.onSpeaker) active.forEach(function(s){ opts.onSpeaker(s.name); });
  var turnId = "sg" + Date.now().toString(36);
  var runR = await run(active, opts.scene || "", text, h.slice(-10), {
    cfg: cfg, turnId: turnId,
    temperature: opts.temperature, maxTokens: opts.maxTokens,
    contextToken: opts.contextToken
  });
  var woven = weave(runR.results, {reactions: sel.reactions});
  var outText = woven.text || "(无回应)";
  runR.results.forEach(function(r){
    if(!r.ok || !r.reply || r.reply.silence) return;
    try{
      var sm = soulMembers.filter(function(s){ return s.name === r.name; })[0];
      if(sm && typeof RP_SOUL !== "undefined"){
        RP_SOUL.log(sm.card, r.name,
          (r.reply.action || "") + (r.reply.dialogue ? (" 说:" + r.reply.dialogue.slice(0, 100)) : ""),
          "ok");
      }
    }catch(e){}
  });
  if(woven.conflicts && woven.conflicts.length){
    outText += "\n\n[系统: 动作冲突 " +
      woven.conflicts.map(function(c){ return c.a + " vs " + c.b; }).join("; ") + "]";
  }
  h.push({role: "assistant", content: outText,
    _soul: true, _speakers: woven.speakers, _turnId: turnId,
    _conflicts: woven.conflicts, _conflictResolved: false});
  /* per-soul 记忆更新: 每 4 轮一次 (成本控制) */
  try{
    var _mk = "nd_soulmem_count_" + (chatId || runId);
    var _mc = 0;
    try{ _mc = parseInt(localStorage.getItem(_mk) || "0"); }catch(e){}
    _mc++;
    try{ localStorage.setItem(_mk, String(_mc)); }catch(e){}
    if(_mc % 4 === 0 && typeof RP_NET !== "undefined"){
      var _callFn = function(c, ms, tt){ return RP_NET.complete(c, ms, tt); };
      /* 后台跑, 不阻塞返回 */
      (function(){
        var jobs = [];
        runR.results.forEach(function(r){
          if(!r.ok || !r.reply || r.reply.silence) return;
          var sm = soulMembers.filter(function(s){ return s.name === r.name; })[0];
          if(sm) jobs.push(extractSoulMemory(sm.card, r.name, r.reply, h, cfg, _callFn));
        });
        Promise.all(jobs).catch(function(){});
      })();
    }
  }catch(e){}
  return {history: h, speakers: woven.speakers, text: outText,
          stats: runR.stats, mode: "soul", turnId: turnId,
          conflicts: woven.conflicts};
}

/* 两阶段调用: 便宜模型"想" (inner+action), 好模型"说" (dialogue)
 * soul 绑定两个 profile: {think: "便宜", speak: "好"} 时启用 */
async function twoStageCall(soulName, card, soul, scene, userText, history, cfg, opts){
  opts = opts || {};
  var thinkCfg = cfg.think, speakCfg = cfg.speak;
  if(!thinkCfg || !speakCfg) return null;

  /* 阶段1: 想 */
  var thinkPrompt = buildSoulPrompt(soulName, soul, scene, userText, history) +
    "\n\n只输出内心独白和动作意向, JSON: {\"inner\": \"...\", \"action\": \"...\"}";
  var thinkRaw = await RP_NET.complete(thinkCfg,
    [{role: "user", content: thinkPrompt}], 0.7);
  var thinkText = (typeof thinkRaw === "string") ? thinkRaw : (thinkRaw.text || "");
  var m = thinkText.match(/\{[\s\S]*\}/);
  var think = {inner: "", action: ""};
  try{ if(m) think = JSON.parse(m[0]); }catch(e){}

  /* 阶段2: 说 */
  var speakPrompt = buildSoulPrompt(soulName, soul, scene, userText, history) +
    "\n\n内心: " + (think.inner || "") + "\n动作意向: " + (think.action || "") +
    "\n\n基于以上内心和动作, 只输出台词和最终动作, JSON: {\"dialogue\": \"...\", \"action\": \"...\"}";
  var speakRaw = await RP_NET.complete(speakCfg,
    [{role: "user", content: speakPrompt}], 0.8);
  var speakText = (typeof speakRaw === "string") ? speakRaw : (speakRaw.text || "");
  var m2 = speakText.match(/\{[\s\S]*\}/);
  var speak = {dialogue: speakText, action: think.action};
  try{ if(m2) speak = JSON.parse(m2[0]); }catch(e){}

  return {ok: true, text: JSON.stringify({
    dialogue: speak.dialogue || "",
    action: speak.action || think.action || "",
    inner: think.inner || "",
    silence: false
  }), model: speakCfg.model + "+" + thinkCfg.model, twoStage: true, soulName: soulName};
}

/* ============ per-soul 记忆更新 ============ */

/* 从 soul 回复提取视角记忆 (LLM, cheap)
 * 只提取该 soul 视角的新事实, 写入 by_perspective[soulName] */
async function extractSoulMemory(card, soulName, reply, history, cfg, callFn){
  if(typeof RP_SOUL === "undefined") return {added: 0};
  var rp = reply || {};
  var text = [(rp.dialogue || ""), (rp.action || ""), (rp.inner || "")].join(" ").trim();
  if(!text) return {added: 0};

  var prompt =
    "你是记忆记录员。从「" + soulName + "」的视角, 提取这轮值得记住的事实。\n" +
    "「" + soulName + "」说/做: " + text.slice(0, 500) + "\n" +
    "只提取: 该角色新知道的事、新决定、关系变化、承诺。\n" +
    "不提取: 闲聊、重复已知。\n" +
    "返回 JSON 数组, 最多2条: [\"事实1\", \"事实2\"]。无则返回 []。只返回 JSON。";
  try{
    var raw = await callFn(cfg, [{role: "user", content: prompt}], 0.3);
    var m = String(raw).match(/\[[\s\S]*\]/);
    if(!m) return {added: 0};
    var facts = JSON.parse(m[0]);
    if(!Array.isArray(facts)) return {added: 0};
    var added = 0;
    facts.slice(0, 2).forEach(function(f){
      var t = String(f || "").trim();
      if(t){ RP_SOUL.addFact(card, soulName, t); added++; }
    });
    /* 情感记忆: 从 inner 提取 */
    if(rp.inner && rp.inner.trim()){
      var emo = detectEmotion(rp.inner);
      if(emo) RP_SOUL.addEmotional(card, emo, rp.inner.slice(0, 200));
    }
    return {added: added};
  }catch(e){ return {added: 0}; }
}

/* 简单情感检测 (关键词) */
function detectEmotion(text){
  var t = String(text || "");
  var map = [
    ["悲伤", ["难过", "哭泣", "流泪", "伤心", "悲伤", "心碎"]],
    ["喜悦", ["开心", "大笑", "高兴", "喜悦", "欢喜"]],
    ["愤怒", ["愤怒", "生气", "恼火", "恨意", "暴怒"]],
    ["恐惧", ["害怕", "恐惧", "惊慌", "瑟瑟发抖"]],
    ["思念", ["怀念", "思念", "想念"]]
  ];
  for(var i = 0; i < map.length; i++){
    for(var j = 0; j < map[i][1].length; j++){
      if(t.indexOf(map[i][1][j]) >= 0) return map[i][0];
    }
  }
  return "";
}

return {
select: select,
deterministicSelect: deterministicSelect,
llmSelect: llmSelect,
buildSoulPrompt: buildSoulPrompt,
parseSoulReply: parseSoulReply,
run: run,
weave: weave,
detectConflicts: detectConflicts,
sendGroupSoul: sendGroupSoul,
shouldUseSoulMode: shouldUseSoulMode,
setSoulMode: setSoulMode,
extractSoulMemory: extractSoulMemory,
detectEmotion: detectEmotion,
twoStageCall: twoStageCall
};

})();
if(typeof window!== "undefined") window.RP_SOUL_ORCH = RP_SOUL_ORCH;
if(typeof module!== "undefined") module.exports = RP_SOUL_ORCH;
