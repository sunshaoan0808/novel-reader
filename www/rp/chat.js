/* RP 引擎 v2: provider adapter + streaming + swipe/regenerate
 *
 * adapter 接口: listModels(cfg) / buildRequest(cfg, messages, opts)
 *               / parseDone(data) / defaultContext
 * OpenAI 兼容 = 默认 passthrough；以后加 Claude/Gemini 再写转换器。
 */
const RP_NET = (function(){
"use strict";

var adapters = {
  openai: {
    defaultContext: 8192,
    listModels: async function(cfg){
      var base = cfg.base.replace(/\/+$/, "");
      var r = await fetch(base + "/models", {
        headers: cfg.key ? {"Authorization": "Bearer " + cfg.key} : {},
      });
      if(!r.ok) throw new Error("HTTP " + r.status);
      var d = await r.json();
      return (d.data || []).map(function(x){ return x.id; }).filter(Boolean).sort();
    },
    buildRequest: function(cfg, messages, opts){
      var base = cfg.base.replace(/\/+$/, "");
      return {
        url: base + "/chat/completions",
        headers: {"Content-Type": "application/json",
                  "Authorization": "Bearer " + cfg.key},
        body: {
          model: cfg.model, messages: messages,
          temperature: opts.temperature != null ? opts.temperature : 0.9,
          top_p: opts.topP != null ? opts.topP : undefined,
          max_tokens: opts.maxTokens || undefined,
          stream: !!opts.stream,
        },
      };
    },
  },
};

function adapterFor(){ return adapters.openai; }

async function listModels(cfg){
  return adapterFor().listModels(cfg);
}

/* 非流式（摘要/问候/测试用） */
async function complete(cfg, messages, temperature, modelOverride, extra){
  var c = {base: cfg.base, key: cfg.key, model: modelOverride || cfg.model};
  var ex = extra || {};
  var q = adapterFor().buildRequest(c, messages, {temperature: temperature, stream: false,
    topP: ex.topP, maxTokens: ex.maxTokens});
  var r = await fetch(q.url, {method: "POST", headers: q.headers,
                              body: JSON.stringify(q.body)});
  if(!r.ok) throw new Error("接口返回 " + r.status);
  var d = await r.json();
  var m = d.choices && d.choices[0] && d.choices[0].message;
  return ((m && m.content) || "(空回复)").trim();
}

/* 流式：onToken(tok)，支持 AbortSignal；返回全文 */
function apiBase(cfg){ return (cfg.base || "").replace(/\/$/, ""); }
async function generateImage(cfg, prompt, model){
  var r = await fetch(apiBase(cfg) + "/images/generations", {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + cfg.key},
    body: JSON.stringify({model: model, prompt: prompt, n: 1,
      size: "1024x1024", response_format: "b64_json"}),
  });
  if(!r.ok) throw new Error("生图接口 " + r.status);
  var j = await r.json();
  var d = (j.data && j.data[0]) || {};
  if(d.b64_json) return "data:image/png;base64," + d.b64_json;
  if(d.url) return d.url;   // 有些渠道只返回 url
  throw new Error("生图返回为空");
}
async function tts(cfg, text, model, voice){
  var r = await fetch(apiBase(cfg) + "/audio/speech", {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + cfg.key},
    body: JSON.stringify({model: model, input: text.slice(0, 800), voice: voice || "alloy"}),
  });
  if(!r.ok) throw new Error("TTS 接口 " + r.status);
  var blob = await r.blob();
  return URL.createObjectURL(blob);
}
async function stream(cfg, messages, opts, onToken){
  opts = opts || {};
  var q = adapterFor().buildRequest(cfg, messages,
    {temperature: opts.temperature, stream: true});
  var r = await fetch(q.url, {method: "POST", headers: q.headers,
    body: JSON.stringify(q.body), signal: opts.signal});
  if(!r.ok) throw new Error("接口返回 " + r.status);
  var reader = r.body.getReader();
  var dec = new TextDecoder();
  var buf = "", full = "";
  for(;;){
    var rd = await reader.read();
    if(rd.done) break;
    buf += dec.decode(rd.value, {stream: true});
    var parts = buf.split("\n\n");
    buf = parts.pop();
    for(var i = 0; i < parts.length; i++){
      var line = parts[i].trim();
      if(line.indexOf("data:") !== 0) continue;
      var payload = line.slice(5).trim();
      if(payload === "[DONE]") continue;
      try {
        var j = JSON.parse(payload);
        var tok = j.choices && j.choices[0] && j.choices[0].delta
                  && j.choices[0].delta.content || "";
        if(tok){ full += tok; if(onToken) onToken(tok); }
      } catch(e){}
    }
  }
  return full.trim() || "(空回复)";
}

return {listModels: listModels, generateImage: generateImage, tts: tts, complete: complete, stream: stream,
        adapterFor: adapterFor};
})();

/* 对话运行时 */

/* 用户自建世界书条目 (App 内编辑, localStorage) */
function userLore(runId){
  try{
    var arr = JSON.parse(localStorage.getItem("nd_lore_" + runId)) || [];
    return arr.filter(function(e){ return e.enabled !== false; }).map(function(e){
      return {title: e.title, trigger_keywords: e.keys || [], rules: e.content,
              priority: e.priority != null ? e.priority : 60, budget: 300,
              constant: !!e.constant};
    });
  }catch(e){ return []; }
}
/* 声明式正则替换 (ST Regex 简化版: 只做 find/replace, 不执行代码) */
function getRegex(runId, name){
  try{ return JSON.parse(localStorage.getItem("nd_regex_" + runId + "_" + name)) || []; }
  catch(e){ return []; }
}
function applyRegex(text, rules){
  if(!text || !rules || !rules.length) return text;
  var out = text;
  rules.forEach(function(r){
    if(r.enabled === false || !r.find) return;
    try{ out = out.replace(new RegExp(r.find, r.flags || "g"), r.replace == null ? "" : r.replace); }
    catch(e){ /* 非法正则跳过 */ }
  });
  return out;
}

/* P0-4: 消息唯一 id (摘要水位 msg_id 制)。只新增字段, 不改现有结构。 */
var __msgSeq = 0;
function nextMsgId(){
__msgSeq = (__msgSeq + 1) % 1296;
return "m" + Date.now().toString(36) + __msgSeq.toString(36) + Math.random().toString(36).slice(2, 6);
}

/* 剧情选项卡指令: 让 AI 在回复末尾输出 Ny 式 <small> N 选项块, 由 App 原生渲染成可点击卡片
 * v21: 数量 2-6 可配 + 氛围可配 (对标猫箱剧情选项分段) */
var OPT_NUM_EMOJI = ["1\uFE0F\u20E3","2\uFE0F\u20E3","3\uFE0F\u20E3","4\uFE0F\u20E3","5\uFE0F\u20E3","6\uFE0F\u20E3"];
var OPT_NUM_CN = ["一","二","三","四","五","六"];
var OPT_MOODS = {
  none: "",
  tense: "氛围要求: 选项要有紧张感和强冲突, 至少给一个高风险选项。",
  warm: "氛围要求: 选项要温情治愈, 多给温暖、体贴的走向。",
  mystery: "氛围要求: 选项要有悬疑感, 多利用信息差和反转。",
  casual: "氛围要求: 选项要轻松日常, 可以搞笑、摸鱼。",
  flirty: "氛围要求: 选项要暧昧拉扯, 多给心动和试探的走向。",
};
function optCardsInstr(count, mood){
  count = Math.min(6, Math.max(2, parseInt(count) || 4));
  var lines = OPT_NUM_EMOJI.slice(0, count).map(function(e, i){
    return e + " {选项" + OPT_NUM_CN[i] + "}";
  });
  var moodLine = OPT_MOODS[mood] ? OPT_MOODS[mood] + " " : "";
  return "【剧情选项】每次回复剧情结束后, 在末尾用 small 标签输出 " + count + " 个行动选项, 格式如下:\n" +
  "<small>\n{一句引导语, 如: 请选择你的下一步行动}\n" +
  lines.join("\n") + "\n" +
  "tips: \"{一句俏皮话}\"\n</small>\n" +
  "要求: 选项简短精炼、各有区别、能推动不同剧情走向, 包括积极和消极方向; " + moodLine +
  "除 small 标签块外不要输出多余包裹。";
}
var OPTCARDS_INSTR = optCardsInstr(4, "none");

/* 剧情线 → 模型可见的参考: 原著剧情大纲(读者可编辑), 只作背景参考, 不再是指令 */
function plotRef(outline){
  return "【角色原著剧情】以下为该角色在原著中的剧情脉络(读者已审阅,可自行编辑), 扮演时作为背景参考:\n" + outline;
}

/* 消息分型 → 模型可见的历史映射:
 * - 旁白(user/mtype narr): 标【旁白】, 让模型知道这是场景调度而非玩家发言
 * - NPC(user/mtype npc + speaker): 标【名字】, 群聊里用户代 NPC 发言
 * - 群聊 assistant: 保持 "名字：" 前缀 */
function mapHistory(h){
  return (h || []).map(function(m){
    var c = m.content;
    if(m.role === "assistant" && m.speaker) c = m.speaker + "：" + c;
    else if(m.role === "user" && m.mtype === "narr") c = "【旁白】" + c;
    else if(m.role === "user" && m.mtype === "npc" && m.speaker) c = "【" + m.speaker + "】" + c;
    return {role: m.role, content: c};
  });
}

/* 导演系统用：角色一句话简介（给导演做输入，不占多少 token） */
function cardBriefOf(card){
  var f = (card && card.fields) || {};
  var parts = [card && card.name ? card.name : ""];
  ["core_identity", "core_traits"].forEach(function(k){
    var v = f[k];
    if(typeof v === "string" && v.trim()) parts.push(v.trim().slice(0, 60));
    else if(v && v.v) parts.push(String(v.v).trim().slice(0, 60));
  });
  return parts.filter(Boolean).join("，");
}

/* 用户消息打分型标记 (mtype: player/narr/npc, npc 时带 speaker) */
function tagUserMsg(um, opts){
  um.mtype = (opts && opts.userMtype) || "player";
  if(opts && opts.userSpeaker) um.speaker = opts.userSpeaker;
  return um;
}

const RP = (function(){
"use strict";

function findCard(runId, name){
  if(runId === "custom" && typeof RP_WRITER !== "undefined"){
    var cc = RP_WRITER.findCustom(name);
    if(cc) return {name: cc.name, fields: cc.fields || {},
      altGreetings: cc.altGreetings || [], exampleDialogue: cc.exampleDialogue || ""};
  }
  if(runId === "imported" && typeof RP_CARDIMPORT !== "undefined"){
    var ic = RP_CARDIMPORT.find(name);
    if(ic) return {name: ic.name, fields: ic.fields || {},
      altGreetings: ic.altGreetings || [], exampleDialogue: ic.exampleDialogue || ""};
  }
  var cards = (window.__DATA__ && window.__DATA__.rp_cards || {})[runId] || [];
  for(var i = 0; i < cards.length; i++) if(cards[i].name === name) return cards[i];
  return null;
}

function newMsg(role, content){
  return {mid: nextMsgId(), role: role, content: content, ts: Date.now(),
          candidates: role === "assistant" ? [content] : undefined, ci: 0};
}

/* P0-1: prompt.js 三池预算用的记忆上下文 (cardId 取不到则 renderBudgeted 内回退 runId_name) */
function memCtxFor(runId, name, card){
  return {runId: runId, name: name, cardId: (card && (card.id || card.cardId)) || null};
}
/* P0-3: 人物弧光 prompt 段 (无弧光卡返回空字符串, 注入层自行跳过) */
function arcTextFor(card, runId){
  try{
    if(typeof RP_ARC !== "undefined" && RP_ARC.renderArcPrompt)
      return RP_ARC.renderArcPrompt(card, runId) || "";
  }catch(e){}
  return "";
}

async function greeting(runId, name, cfg, novel){
  var card = findCard(runId, name);
  /* P1-2: 卡片自带多开场白 -> 随机挑一条, 省一次模型调用 */
  if(card && card.altGreetings && card.altGreetings.length){
    return card.altGreetings[Math.floor(Math.random() * card.altGreetings.length)];
  }
  if(!cfg || !cfg.key){
    var lines = card ? RP_PROMPT.renderFields(card, ["typical_lines"]) : "";
    var first = (lines.split("\n")[0] || "").replace(/^- [^：]+：/, "").slice(0, 60);
    return first || ("（" + name + "打量着你，没有说话）");
  }
  try {
    var b = RP_PROMPT.buildMessages(card || {name: name, fields: {}},
      {novel: novel, history: [], persona: RP_PERSONA.renderText(RP_PERSONA.resolve(runId))}, {maxContext: 4096});
    var t = await RP_NET.complete(cfg, b.messages.concat([
      {role: "user", content: "（开场）和我打个招呼，一句话，符合你的人设和说话方式。"},
    ]), 0.9);
    return t;
  } catch(e){ return "（" + name + "打量着你，没有说话）"; }
}

/* 发送一轮。opts: {cfg, history, onPush, onToken, onSystem, budget, signal,
 *                 temperature, oocOn, cardName} */
async function send(runId, name, text, opts){
  opts = opts || {};
  var cfg = opts.cfg || {};
  var h = opts.history || [];
  var run = (window.__DATA__.runs || {})[runId] || {};
  if(runId === "custom" && typeof RP_WRITER !== "undefined"){
    var _cc = RP_WRITER.findCustom(name) || {};
    var _wr = _cc.worldRunId ? ((window.__DATA__.runs || {})[_cc.worldRunId] || {}) : {};
    run = {novel: _cc.novel || "自定义", worldbook: _wr.worldbook || [], relations: []};
  }
  var card = findCard(runId, name) || {name: name, fields: {}};

  h.push(tagUserMsg(newMsg("user", text), opts));
  if(opts.onPush) opts.onPush();
  if(opts.onUserMsg) opts.onUserMsg();

  // 三层记忆（心境/短期30条/长远印象），周期分析，失败不打断
  var cardHint = (((card.fields || {}).core_traits || "") + " " +
                  ((card.fields || {}).speech_style || "")).trim();
  await RP_MEM.maybeAnalyze(runId, name, h, cfg,
    function(c, ms, t){ return RP_NET.complete(c, ms, t); }, cardHint);
  /* P0-1: 三池预算渲染由 prompt.js 完成; 这里只准备退化路径文本 */
  var memPrompt = RP_MEM.renderBudgeted ? ""
    : RP_MEM.renderPrompt(RP_MEM.get(runId, name));
  // 自定义分析任务（周期/关键词触发，失败不打断）
  await RP_TASKS.maybeRun(runId, name, h, cfg,
    function(c, ms, t){ return RP_NET.complete(c, ms, t); }, cardHint);
  var memTasks = RP_TASKS.renderPrompt(runId, name, text);

  var budget = opts.budget || {};
  if(!budget.maxContext && cfg.maxContext) budget.maxContext = cfg.maxContext;
  /* 世界模拟：用户消息推进时间/天气（Living world 思路），prompt 注入三要素 */
  var wsId = (typeof chatKey !== "undefined") ? chatKey(runId, name) : (runId + "|" + name);
  var wsHint = {novel: run.novel};
  try{ if(typeof RP_WORLDSIM !== "undefined") RP_WORLDSIM.onUserMessage(wsId, wsHint); }catch(e){}
  /* 导演系统：two-model pass——按档位决定是否先跑一次导演调用，指令注入扮演 prompt */
  var dirText = "";
  try{
    if(typeof RP_DIRECTOR !== "undefined")
      dirText = await RP_DIRECTOR.onUserMessage(wsId, {cfg: cfg, history: h,
        hint: wsHint, cardBrief: cardBriefOf(card)});
  }catch(e){}
  var b = RP_PROMPT.buildMessages(card, {
    novel: run.novel, worldbook: (run.worldbook || []).concat(userLore(runId)), relations: run.relations,
    memory: memPrompt, memTasks: memTasks,
    memBudgeted: memCtxFor(runId, name, card),
    arc: arcTextFor(runId, name, card),
    history: mapHistory(h),
    persona: RP_PERSONA.renderText(RP_PERSONA.resolve(runId)),
    pov: opts.pov, person: opts.person,
  }, budget);
  var wsText = "";
  try{
    if(typeof RP_WORLDSIM !== "undefined"){
      wsText = RP_WORLDSIM.renderPrompt(wsId, wsHint);
      if(wsText && b.messages.length && b.messages[0].role === "system")
        b.messages[0].content += "\n\n" + wsText;
    }
  }catch(e){}
  /* 导演指令注入（compact briefing；关闭/未触发时为空字符串，不注入） */
  try{
    if(dirText && b.messages.length && b.messages[0].role === "system")
      b.messages[0].content += "\n\n" + dirText;
  }catch(e){}
  b.stats.hasWorldsim = !!wsText;   // P0-5: Prompt 诊断用
  b.stats.hasDirector = !!dirText;
  if(opts.optCards && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + optCardsInstr(opts.optCount, opts.optMood);
  if(opts.plotOutline && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + plotRef(opts.plotOutline);
  if(opts.scenario && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + opts.scenario;
  if(opts.onSystem) opts.onSystem(b.preview, b.stats);

  var reply = "";
  var ctrl = {aborted: false};
  try {
    if(opts.stream === false){
      reply = await RP_NET.complete(cfg, b.messages, opts.temperature, null,
        {topP: opts.topP, maxTokens: opts.maxTokens});
    } else {
      reply = await RP_NET.stream(cfg, b.messages,
        {temperature: opts.temperature, signal: opts.signal}, opts.onToken);
    }
  } catch(e){
    if(e && e.name === "AbortError"){ ctrl.aborted = true; }
    else {
      h.push(newMsg("assistant", "⚠️ 出错了：" + e.message +
        "\n请检查设置里的 API 地址/Key/模型，以及手机网络。"));
      return {history: h, aborted: false, stats: b.stats};
    }
  }
  if(ctrl.aborted) return {history: h, aborted: true, stats: b.stats};

  // OOC 检测：命中则把规则名告诉模型，重试一次；失败原文标 OOC 存档
  if(opts.oocOn !== false){
    var hit = RP_OOC.check(reply, name);
    if(hit){
      try {
        var retry = await RP_NET.complete(cfg, b.messages.concat([
          {role: "assistant", content: reply},
          {role: "user", content: "（刚才那句" + hit.reason +
            "，出戏了。请以" + name + "的身份重说一遍，不要跳出角色。）"},
        ]), opts.temperature);
        if(!RP_OOC.check(retry, name)){ reply = retry; }
        else {
          h.push(newMsg("assistant", "【OOC 存档·" + hit.reason + "】" + reply));
          reply = "（" + name + "沉默了一下，没有接话）";
        }
      } catch(e){ /* 保留原回复 */ }
    }
  }

  reply = applyRegex(reply, getRegex(runId, name));
  /* 世界模拟：解析 AI 的 ⟦时间/天气/地点⟧ 标记并从正文剥离 */
  try{
    if(typeof RP_WORLDSIM !== "undefined"){
      var wres = RP_WORLDSIM.applyReply(wsId, reply, wsHint);
      if(wres.changed) reply = wres.clean;
    }
  }catch(e){}
  h.push(newMsg("assistant", reply));
  return {history: h, aborted: false, stats: b.stats};
}

/* regenerate：对最后一条 assistant 消息再生成一个候选（swipe） */
async function regenerate(runId, name, opts){
  opts = opts || {};
  var cfg = opts.cfg || {};
  var h = opts.history || [];
  var last = null;
  for(var i = h.length - 1; i >= 0; i--){
    if(h[i].role === "assistant" && h[i].content.indexOf("⚠️") !== 0){ last = h[i]; break; }
  }
  if(!last) return {history: h};
  var run = (window.__DATA__.runs || {})[runId] || {};
  var card = findCard(runId, name) || {name: name, fields: {}};
  var mem = RP_MEM.get(runId, name);
  var upto = h.indexOf(last);
  var lastUserText = "";
  for(var u = upto - 1; u >= 0; u--){
    if(h[u].role === "user"){ lastUserText = h[u].content || ""; break; }
  }
  var b = RP_PROMPT.buildMessages(card, {
    novel: run.novel, worldbook: (run.worldbook || []).concat(userLore(runId)), relations: run.relations,
    memory: RP_MEM.renderBudgeted ? "" : RP_MEM.renderPrompt(mem),
    memTasks: RP_TASKS.renderPrompt(runId, name, lastUserText),
    memBudgeted: memCtxFor(runId, name, card),
    arc: arcTextFor(runId, name, card),
    history: mapHistory(h.slice(0, upto)),
    persona: RP_PERSONA.renderText(RP_PERSONA.resolve(runId)),
    pov: opts.pov, person: opts.person,
  }, opts.budget || {});
  if(opts.optCards && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + optCardsInstr(opts.optCount, opts.optMood);
  if(opts.plotOutline && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + plotRef(opts.plotOutline);
  if(opts.scenario && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + opts.scenario;
  b.stats.hasWorldsim = false;  // P0-5: regenerate 不跑世界模拟/导演
  b.stats.hasDirector = false;
  if(opts.onSystem) opts.onSystem(b.preview, b.stats);
  var reply = await RP_NET.stream(cfg, b.messages,
    {temperature: (opts.temperature || 0.9) + 0.15, signal: opts.signal}, opts.onToken);
  if(!RP_OOC.check(reply, name)){
    last.candidates = last.candidates || [last.content];
    last.candidates.push(reply);
    last.ci = last.candidates.length - 1;
    last.content = reply;
    last.ts = Date.now();
  }
  return {history: h};
}

function swipe(msg, dir){
  if(!msg.candidates || msg.candidates.length < 2) return false;
  var n = msg.candidates.length;
  msg.ci = ((msg.ci || 0) + dir + n) % n;
  msg.content = msg.candidates[msg.ci];
  return true;
}


/* 群聊发送一轮。speakers: 本轮发言人序列（数组；兼容单个名字符串），
 * 依次生成，每位发言人都能看到本轮前面发言人的回复。
 * opts 同 send, 另加: members(成员名数组)。assistant 消息带 speaker 字段。
 * 回调: onSpeaker(speaker, idx) 每位开始前；onSpeakerDone(speaker, idx) 每位完成后。 */
async function sendGroup(runId, members, speakers, text, opts){
  opts = opts || {};
  if(!Array.isArray(speakers)) speakers = speakers ? [speakers] : [];
  var cfg = opts.cfg || {};
  var h = opts.history || [];
  var run = (window.__DATA__.runs || {})[runId] || {};
  var budget = opts.budget || {};
  if(!budget.maxContext && cfg.maxContext) budget.maxContext = cfg.maxContext;

  h.push(tagUserMsg(newMsg("user", text), opts));
  if(opts.onPush) opts.onPush();
  if(opts.onUserMsg) opts.onUserMsg();

  /* 世界模拟：群聊每轮用户消息推进一次 */
  try{
    if(typeof RP_WORLDSIM !== "undefined" && typeof groupKey !== "undefined")
      RP_WORLDSIM.onUserMessage(groupKey(runId, members), {novel: run.novel});
  }catch(e){}
  /* 导演系统：群聊每轮只跑一次导演（不是每位发言人一次），指令分发给各发言人 */
  try{
    if(typeof RP_DIRECTOR !== "undefined" && typeof groupKey !== "undefined")
      opts._dirText = await RP_DIRECTOR.onUserMessage(groupKey(runId, members), {cfg: cfg, history: h,
        hint: {novel: run.novel}, cardBrief: "群聊：" + members.join("、")});
  }catch(e){}

  var doneSpeakers = [], lastStats = null, aborted = false, failed = false;

  for(var si = 0; si < speakers.length && !aborted && !failed; si++){
    var speaker = speakers[si];
    if(opts.onSpeaker) opts.onSpeaker(speaker, si);
    var r = await genOneSpeaker(runId, run, members, speaker, text, h, opts, budget, cfg);
    lastStats = r.stats || lastStats;
    if(r.aborted){ aborted = true; break; }
    if(r.failed){ failed = true; break; }
    doneSpeakers.push(speaker);
    if(opts.onSpeakerDone) opts.onSpeakerDone(speaker, si);
  }

  return {history: h, aborted: aborted, stats: lastStats,
          speakers: doneSpeakers, speaker: doneSpeakers[doneSpeakers.length - 1] || null};
}

/* 群聊单发言人生成（内部）：为 speaker 构建 prompt 并生成一条回复，push 进 h */
async function genOneSpeaker(runId, run, members, speaker, text, h, opts, budget, cfg){
  var activeCard = findCard(runId, speaker) || {name: speaker, fields: {}};
  var others = members.filter(function(m){ return m !== speaker; });
  var otherCards = others.map(function(m){ return findCard(runId, m); });

  var spHint = (((activeCard.fields || {}).core_traits || "") + " " +
                  ((activeCard.fields || {}).speech_style || "")).trim();
  await RP_MEM.maybeAnalyze(runId, speaker, h, cfg,
    function(c, ms, t){ return RP_NET.complete(c, ms, t); }, spHint);
  await RP_TASKS.maybeRun(runId, speaker, h, cfg,
    function(c, ms, t){ return RP_NET.complete(c, ms, t); }, spHint);
  var b = RP_PROMPT.buildMessages(activeCard, {
    novel: run.novel, worldbook: (run.worldbook || []).concat(userLore(runId)), relations: run.relations,
    memory: RP_MEM.renderBudgeted ? "" : RP_MEM.renderPrompt(RP_MEM.get(runId, speaker)),
    memTasks: RP_TASKS.renderPrompt(runId, speaker, text),
    memBudgeted: memCtxFor(runId, speaker, activeCard),
    arc: arcTextFor(runId, speaker, activeCard),
    history: mapHistory(h),
    persona: RP_PERSONA.renderText(RP_PERSONA.resolve(runId)),
    pov: opts.pov, person: opts.person,
  }, budget);
  // 注入"在场人物"简介, 替换 post-history 为群聊版
  var briefs = otherCards.map(function(c){ return RP_GROUP.memberBrief(c); }).join("\n");
  if(briefs) b.messages[0].content += "\n\n【在场人物】\n" + briefs;
  if(opts.optCards && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + optCardsInstr(opts.optCount, opts.optMood);
  if(opts.plotOutline && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + plotRef(opts.plotOutline);
  if(opts.scenario && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + opts.scenario;
  /* 世界模拟：群聊与单聊共用同一会话时钟 */
  var wsIdG = null, wsHintG = null;
  try{
    if(typeof RP_WORLDSIM !== "undefined" && typeof groupKey !== "undefined"){
      wsIdG = groupKey(runId, members); wsHintG = {novel: run.novel};
      var wsTextG = RP_WORLDSIM.renderPrompt(wsIdG, wsHintG);
      if(wsTextG && b.messages.length && b.messages[0].role === "system")
        b.messages[0].content += "\n\n" + wsTextG;
    }
  }catch(e){}
  /* 导演指令注入（与单聊同一套） */
  try{
    if(opts._dirText && b.messages.length && b.messages[0].role === "system")
      b.messages[0].content += "\n\n" + opts._dirText;
  }catch(e){}
  var gpost = RP_GROUP.groupPostInstructions(speaker, others, opts.pov, opts.person);
  b.messages[b.messages.length - 1].content = gpost;
  b.stats.hasWorldsim = !!wsTextG;  // P0-5: Prompt 诊断用
  b.stats.hasDirector = !!opts._dirText;
  if(opts.onSystem) opts.onSystem(b.messages[0].content + "\n\n" + gpost, b.stats);

  var reply = "";
  var ctrl = {aborted: false};
  try {
    if(opts.stream === false){
      reply = await RP_NET.complete(cfg, b.messages, opts.temperature, null,
        {topP: opts.topP, maxTokens: opts.maxTokens});
    } else {
      reply = await RP_NET.stream(cfg, b.messages,
        {temperature: opts.temperature, signal: opts.signal}, opts.onToken);
    }
  } catch(e){
    if(e && e.name === "AbortError"){ ctrl.aborted = true; }
    else {
      h.push(newMsg("assistant", "⚠️ 出错了：" + e.message +
        "\n请检查设置里的 API 地址/Key/模型，以及手机网络。"));
      return {stats: b.stats, failed: true};
    }
  }
  if(ctrl.aborted) return {stats: b.stats, aborted: true};

  if(opts.oocOn !== false){
    var hit = RP_OOC.check(reply, speaker);
    if(hit){
      try {
        var retry = await RP_NET.complete(cfg, b.messages.concat([
          {role: "assistant", content: reply},
          {role: "user", content: "（刚才那句" + hit.reason +
            "，出戏了。请以" + speaker + "的身份重说一遍，不要跳出角色。）"},
        ]), opts.temperature);
        if(!RP_OOC.check(retry, speaker)){ reply = retry; }
        else {
          var am = newMsg("assistant", "【OOC 存档·" + hit.reason + "】" + reply);
          am.speaker = speaker; h.push(am);
          reply = "（" + speaker + "沉默了一下，没有接话）";
        }
      } catch(e){ /* 保留原回复 */ }
    }
  }

  reply = applyRegex(reply, getRegex(runId, speaker));
  /* 世界模拟：解析 AI 标记 */
  try{
    if(typeof RP_WORLDSIM !== "undefined" && wsIdG){
      var wresG = RP_WORLDSIM.applyReply(wsIdG, reply, wsHintG);
      if(wresG.changed) reply = wresG.clean;
    }
  }catch(e){}
  var msg = newMsg("assistant", reply);
  msg.speaker = speaker;
  h.push(msg);
  return {stats: b.stats, failed: false, aborted: false};
}

/* 穿越发送一轮：玩家扮演身份，AI 扮演世界+NPC。
 * opts: {cfg, history, onPush, onToken, onSystem, budget, signal, temperature} */
async function sendTraverse(travId, text, opts){
  opts = opts || {};
  var cfg = opts.cfg || {};
  var h = opts.history || [];
  var trav = RP_TRAVERSE.get(travId);
  if(!trav) throw new Error("穿越会话不存在");

  h.push(newMsg("user", text));
  if(opts.onPush) opts.onPush();
  if(opts.onUserMsg) opts.onUserMsg();

  /* 世界模拟：穿越会话独立时钟/天气/地点 */
  var wsIdT = "nd_travchat_" + travId;
  var wsHintT = {novel: trav.worldName || "", worldName: trav.worldName || ""};
  try{ if(typeof RP_WORLDSIM !== "undefined") RP_WORLDSIM.onUserMessage(wsIdT, wsHintT); }catch(e){}
  /* 导演系统：穿越会话同样按档位介入 */
  var dirTextT = "";
  try{
    if(typeof RP_DIRECTOR !== "undefined")
      dirTextT = await RP_DIRECTOR.onUserMessage(wsIdT, {cfg: cfg, history: h,
        hint: wsHintT, cardBrief: "穿越：" + (trav.worldName || "") + "·" + (trav.anchorTitle || "")});
  }catch(e){}

  var cardHint = "穿越世界";
  await RP_MEM.maybeAnalyze("trav", travId, h, cfg,
    function(c, ms, t){ return RP_NET.complete(c, ms, t); }, cardHint);
  var memPrompt = RP_MEM.renderPrompt(RP_MEM.get("trav", travId));

  var budget = opts.budget || {};
  if(!budget.maxContext && cfg.maxContext) budget.maxContext = cfg.maxContext;
  var worldRunId = trav.worldKind === "book" ? trav.worldId : "";
  var b = RP_TRAVERSE.buildMessages(trav, {
    history: mapHistory(h),
    memory: memPrompt,
    // run.worldbook 已由 buildWorldBible 注入, 这里只补用户世界书, 避免重复
    worldbook: userLore(worldRunId),
  }, budget);
  /* P2 穿越 P1/P3: 出戏值 / 组团 / 异世界的 prompt 增补（调用方在 opts.extraPrompt 里拼好） */
  if(opts.extraPrompt){
    b.messages.push({role: "system", content: String(opts.extraPrompt)});
    b.preview += "\n\n" + String(opts.extraPrompt);
  }
  /* 世界模拟：时间/天气/地点注入 */
  try{
    if(typeof RP_WORLDSIM !== "undefined"){
      var wsTextT = RP_WORLDSIM.renderPrompt(wsIdT, wsHintT);
      if(wsTextT && b.messages.length && b.messages[0].role === "system")
        b.messages[0].content += "\n\n" + wsTextT;
    }
  }catch(e){}
  /* 导演指令注入 */
  try{
    if(dirTextT && b.messages.length && b.messages[0].role === "system")
      b.messages[0].content += "\n\n" + dirTextT;
  }catch(e){}
  if(opts.onSystem) opts.onSystem(b.preview, b.stats);

  var reply = "";
  var ctrl = {aborted: false};
  try {
    if(opts.stream === false){
      reply = await RP_NET.complete(cfg, b.messages, opts.temperature);
    } else {
      reply = await RP_NET.stream(cfg, b.messages,
        {temperature: opts.temperature, signal: opts.signal}, opts.onToken);
    }
  } catch(e){
    if(e && e.name === "AbortError"){ ctrl.aborted = true; }
    else {
      h.push(newMsg("assistant", "⚠️ 出错了：" + e.message +
        "\n请检查设置里的 API 地址/Key/模型，以及手机网络。"));
      return {history: h, aborted: false, stats: b.stats};
    }
  }
  if(ctrl.aborted) return {history: h, aborted: true, stats: b.stats};

  // 解析 <ws> 世界状态块：合并进世界状态，正文里去掉
  var parsed = RP_TRAVERSE.parseWsBlock(reply);
  if(parsed.patch){
    var st = RP_TRAVERSE.getState(travId);
    RP_TRAVERSE.saveState(travId, RP_TRAVERSE.mergeState(st, parsed.patch));
  }
  reply = parsed.clean || reply;

  /* 世界模拟：解析 AI 的 ⟦时间/天气/地点⟧ 标记并从正文剥离 */
  try{
    if(typeof RP_WORLDSIM !== "undefined"){
      var wresT = RP_WORLDSIM.applyReply(wsIdT, reply, wsHintT);
      if(wresT.changed) reply = wresT.clean;
    }
  }catch(e){}

  h.push(newMsg("assistant", reply));
  return {history: h, aborted: false, stats: b.stats,
          worldState: RP_TRAVERSE.getState(travId)};
}

return {send: send, regenerate: regenerate, swipe: swipe, sendGroup: sendGroup,
        sendTraverse: sendTraverse,
        greeting: greeting, findCard: findCard, mapHistory: mapHistory, tagUserMsg: tagUserMsg};
})();
