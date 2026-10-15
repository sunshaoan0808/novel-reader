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

/* ---- 截断自动续写 ----
 * finish_reason=length 是确定截断; 某些渠道不返回 finish_reason, 此时用启发式:
 * 正文够长(>200字)且结尾不是完整句子(无句末标点)视为截断。content_filter 等
 * 其他原因不续写。续写最多一次, 由调用方透传 extra._noContinue 关闭。 */
function looksTruncated(text, finishReason){
  if(finishReason === "length") return true;
  if(finishReason && finishReason !== "stop") return false;
  var t = String(text || "").trim();
  if(!finishReason && t.length > 200 && !/[。！？.!?…」』"'）\]$]/.test(t)) return true;
  return false;
}
/* 拼接续写: 去掉续写开头与原文结尾的重叠(最多 24 字), 避免复读 */
function stitchOverlap(a, b){
  a = String(a || ""); b = String(b || "");
  var max = Math.min(24, a.length, b.length);
  for(var n = max; n > 0; n--){
    if(a.slice(a.length - n) === b.slice(0, n)) return a + b.slice(n);
  }
  return a + b;
}
var CONTINUE_PROMPT = "你的上一条回复被截断了, 请从截断处继续写完, 不要重复已经写过的内容, 不要解释。";
async function continueOnce(cfg, messages, partial, temperature, extra){
  var ex = extra || {};
  var ms = messages.concat([
    {role: "assistant", content: partial},
    {role: "user", content: CONTINUE_PROMPT},
  ]);
  var q = adapterFor().buildRequest(
    {base: cfg.base, key: cfg.key, model: cfg.model}, ms,
    {temperature: temperature, stream: false, topP: ex.topP, maxTokens: ex.maxTokens || 1024});
  var r = await fetch(q.url, {method: "POST", headers: q.headers,
                              body: JSON.stringify(q.body),
                              /* P1-2: 透传取消信号（soul 并行等非流式调用也需要可取消） */
                              signal: ex.signal || undefined});
  if(!r.ok) throw new Error("接口返回 " + r.status);
  var d = await r.json();
  var m = d.choices && d.choices[0] && d.choices[0].message;
  return ((m && m.content) || "").trim();
}

/* 非流式（摘要/问候/测试用） */
async function complete(cfg, messages, temperature, modelOverride, extra){
  var c = {base: cfg.base, key: cfg.key, model: modelOverride || cfg.model};
  var ex = extra || {};
  var q = adapterFor().buildRequest(c, messages, {temperature: temperature, stream: false,
    topP: ex.topP, maxTokens: ex.maxTokens});
  var r = await fetch(q.url, {method: "POST", headers: q.headers,
                              body: JSON.stringify(q.body),
                              /* P1-2: 透传取消信号（soul 并行等非流式调用也需要可取消） */
                              signal: ex.signal || undefined});
  if(!r.ok) throw new Error("接口返回 " + r.status);
  var d = await r.json();
  var ch = d.choices && d.choices[0];
  var m = ch && ch.message;
  var text = ((m && m.content) || "(空回复)").trim();
  /* 截断自动续写一次 */
  if(!ex._noContinue && looksTruncated(text, ch && ch.finish_reason)){
    try{
      var more = await continueOnce(c, messages, text, temperature,
        {topP: ex.topP, maxTokens: ex.maxTokens});
      if(more) text = stitchOverlap(text, more);
    }catch(e){/* 续写失败就用原文 */}
  }
  return text;
}

/* vision: OpenAI 兼容图文消息 (看图写卡用)。模型是否真支持 vision 由调用方按
 * RP_MODELTAGS 能力标签判断, 这里只负责把图发出去。 */
async function visionComplete(cfg, imageDataUrl, prompt, modelOverride, extra){
  var c = {base: cfg.base, key: cfg.key, model: modelOverride || cfg.model};
  var ex = extra || {};
  var base = (c.base || "").replace(/\/+$/, "");
  var body = {
    model: c.model,
    messages: [{role: "user", content: [
      {type: "text", text: prompt},
      {type: "image_url", image_url: {url: imageDataUrl}},
    ]}],
    temperature: ex.temperature != null ? ex.temperature : 0.7,
    max_tokens: ex.maxTokens || 4000,
  };
  var r = await fetch(base + "/chat/completions", {method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + c.key},
    body: JSON.stringify(body)});
  if(!r.ok) throw new Error("接口返回 " + r.status);
  var d = await r.json();
  var ch = d.choices && d.choices[0];
  var m = ch && ch.message;
  var text = ((m && m.content) || "").trim();
  if(!ex._noContinue && looksTruncated(text, ch && ch.finish_reason)){
    try{
      var more = await continueOnce(c,
        [{role: "user", content: prompt + "\n(附图略, 上文是对该图的角色卡 JSON)"}],
        text, 0.7, {maxTokens: 4000});
      if(more) text = stitchOverlap(text, more);
    }catch(e){}
  }
  return text;
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
  var buf = "", full = "", finishReason = null;
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
        var ch0 = j.choices && j.choices[0];
        if(ch0 && ch0.finish_reason) finishReason = ch0.finish_reason;
        var tok = ch0 && ch0.delta && ch0.delta.content || "";
        if(tok){ full += tok; if(onToken) onToken(tok); }
      } catch(e){}
    }
  }
  /* 流式截断自动续写一次(非流式补完, 续写部分同样走 onToken) */
  if(looksTruncated(full, finishReason)){
    try{
      var more = await continueOnce(cfg, messages, full, opts.temperature,
        {topP: opts.topP, maxTokens: opts.maxTokens});
      if(more){
        var stitched = stitchOverlap(full, more);
        var appended = stitched.slice(full.length);
        full = stitched;
        if(appended && onToken) onToken(appended);
      }
    }catch(e){}
  }
  return full.trim() || "(空回复)";
}

return {listModels: listModels, generateImage: generateImage, tts: tts, complete: complete, stream: stream,
        visionComplete: visionComplete,
        adapterFor: adapterFor};
})();

/* 对话运行时 */

/* 用户自建世界书条目 (App 内编辑, localStorage)。键规则与 LoreKeeper / 世界书管理器共用
   RP_SCOPE: 导入卡按卡 id 隔离, 老池 nd_lore_imported 兼容读。 */
function userLore(runId, name){
  try{
    var arr = RP_SCOPE.readKeyed("nd_lore_", runId, name);
    return arr.filter(function(e){ return e.enabled !== false; }).map(function(e){
      return {title: e.title, trigger_keywords: e.keys || [], rules: e.content,
              priority: e.priority != null ? e.priority : 60, budget: 300,
              constant: !!e.constant};
    });
  }catch(e){ return []; }
}
/* prompt 的世界书数组, 三处 buildMessages 共用:
   蒸馏 run 的 run.worldbook → 导入卡自带的 character_book 条目 → 用户自建条目。
   去重按 title+content (同 traverse.js:386 的做法): synthRunFor 给导入卡合成的
   run.worldbook 就是卡自带世界书, 与 card.worldbook 是同一批条目, 不去重会双份进 prompt。 */
function promptWorldbook(run, runId, card, name){
  var all = (run.worldbook || []).concat((card && card.worldbook) || [], userLore(runId, name));
  var seen = {}, out = [];
  all.forEach(function(e){
    var k = (e && (e.title || "") + "￨" + (e.content || e.rules || "")).slice(0, 200);
    if(!seen[k]){ seen[k] = 1; out.push(e); }
  });
  return out;
}
/* prompt 的 run 兜底 (B4): 非蒸馏 runId (imported/custom 等) 在 window.__DATA__.runs 里
   没有对应条目, 下游拿到的 run 恒是 {} —— novel/worldbook/relations 三个 prompt 装配输入全空。
   这里按卡合成一个最小 run: custom 用卡片自己的 novel + 绑定的世界 run 世界书,
   其它非蒸馏 runId 从导入卡库取卡 (novel/卡自带世界书), 与 custom 同构。
   蒸馏 runId (__DATA__.runs 里有键) 一律不合成: 真 run 优先。找不到卡则返回 null,
   调用方保持原行为 (run = {})。 */
function synthRunFor(runId, name){
  if(!runId) return null;
  var RUNS = (window.__DATA__ && window.__DATA__.runs) || {};
  if(runId === "custom" && typeof RP_WRITER !== "undefined"){
    var _cc = RP_WRITER.findCustom(name) || {};
    var _wr = _cc.worldRunId ? (RUNS[_cc.worldRunId] || {}) : {};
    return {novel: _cc.novel || "自定义", worldbook: _wr.worldbook || [], relations: []};
  }
  if(RUNS[runId]) return null;
  if(typeof RP_CARDIMPORT === "undefined") return null;
  var _ic = RP_CARDIMPORT.find(name);
  if(!_ic) return null;
  return {novel: _ic.novel || "", worldbook: _ic.worldbook || [], relations: []};
}
/* 声明式正则替换 (ST Regex 简化版: 只做 find/replace, 不执行代码) */
function getRegex(runId, name){
  try{ return JSON.parse(localStorage.getItem("nd_regex_" + runId + "_" + name)) || []; }
  catch(e){ return []; }
}
function applyRegex(text, rules, depth){
  if(!text || !rules || !rules.length) return text;
  /* ST 语义(engine.js): markdownOnly 只在 markdown 显示路径执行(本机气泡即 markdown
   * 渲染, 视为显示路径); 纯 promptOnly(只在 prompt 构建时执行)本机无此路径, 跳过;
   * minDepth/maxDepth 按 depth 过滤(新回复 depth=0)。 */
  if(depth == null) depth = 0;
  var out = text;
  rules.forEach(function(r){
    if(r.enabled === false || !r.find) return;
    if(r.promptOnly && !r.markdownOnly) return;
    if(r.minDepth != null && depth < r.minDepth) return;
    if(r.maxDepth != null && depth > r.maxDepth) return;
    try{ out = out.replace(new RegExp(r.find, r.flags || "g"), r.replace == null ? "" : r.replace); }
    catch(e){ /* 非法正则跳过 */ }
  });
  return out;
}

/* S 级补全: 穿越的正则键名。魂穿用被附身角色名, 肉身/异世界用世界名 */
function travRegexName(trav){
  if(!trav) return "穿越";
  if(trav.mode === "soul" && trav.charName) return trav.charName;
  return trav.worldName || "穿越";
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

/* 2026-10-07: 管线反 OOC 纠错条目 (run.corrections 按人物过滤)。
   提到所有 runId 分支之前算一次: 以前它挂在 rp_cards 循环体内, 而 imported/custom
   分支提前 return, 这两类卡拿不到这个字段, 反 OOC 段对它们恒空。 */
function oocCorrectionsFor(runId, name){
  try{
    var run = (window.__DATA__ && window.__DATA__.runs || {})[runId] || {};
    var corrs = run.corrections || [];
    return corrs.filter(function(c){ return c && c.character === name && c.prompt_injection_rule; });
  }catch(e){ return []; }
}

/* 非蒸馏 run 的卡片字段透传形状。normalizeTavern (cardimport.js:229-255) 归一化出
   scenario/systemPrompt/postHistoryInstructions/creatorNotes/characterVersion/creator/
   bookMeta/depthPrompt/sysNote/groupOnlyGreetings, imported/custom 分支以前一个都没回,
   下游 (prompt.js:369-370, 409, 495-499 的组装; app.js 的设定视图) 只能见 {}。
   规则: 源卡里有的原样透传, 没有的给空串/空数组/null —— 不编造, 也不静默丢字段。 */
function passthroughFields(src){
  var c = src || {};
  return {
    id: c.id || "",
    novel: c.novel || "",
    scenario: c.scenario || "",
    systemPrompt: c.systemPrompt || "",
    postHistoryInstructions: c.postHistoryInstructions || "",
    creatorNotes: c.creatorNotes || "",
    characterVersion: c.characterVersion || "",
    creator: c.creator || "",
    bookMeta: c.bookMeta || null,
    depthPrompt: c.depthPrompt || null,
    sysNote: c.sysNote || "",
    groupOnlyGreetings: Array.isArray(c.groupOnlyGreetings) ? c.groupOnlyGreetings : [],
    worldbook: Array.isArray(c.worldbook) ? c.worldbook : []
  };
}

function findCard(runId, name){
  var corrs = oocCorrectionsFor(runId, name);
  // 蒸馏包: runId 为 "distill_<pkgId>"
  if(runId && runId.indexOf("distill_") === 0 && typeof DISTILL_PACKAGE !== "undefined"){
    try{
      var pkgId = runId.slice(8);
      var card = DISTILL_PACKAGE.getCharacterCard(pkgId, name);
      if(card){
        var openings = [];
        try{
          var all = DISTILL_PACKAGE.getData(pkgId, "openings") || {};
          openings = all[name] || [];
        }catch(e){}
        return {
          name: card.name,
          fields: card._distill || {},
          description: card.description || "",
          personality: card.personality || "",
          greeting: (openings[0] && openings[0].text) || card.first_mes || "",
          altGreetings: openings.slice(1).map(function(o){ return o.text; }),
          scenario: "",
          exampleDialogue: "",
          oocCorrections: corrs
        };
      }
    }catch(e){}
    return null;
  }
  /* custom 卡字段形状与 imported 同构 (卡片编辑器产出的卡: cardwriter.js:162-164, 199-204)。
     自创卡本来就没有 scenario/systemPrompt 这类 P0 字段, 这里给空串而不是省略,
     下游的读法与导入卡一致, 不用到处判 undefined。 */
  if(runId === "custom" && typeof RP_WRITER !== "undefined"){
    var cc = RP_WRITER.findCustom(name);
    if(cc){
      var cf = passthroughFields(cc);
      return {id: cf.id, name: cc.name, novel: cf.novel, worldRunId: cc.worldRunId || "",
        fields: cc.fields || {}, greeting: cc.greeting || "",
        altGreetings: cc.altGreetings || [], exampleDialogue: cc.exampleDialogue || "",
        exampleBlocks: cc.exampleBlocks || [], scenario: cf.scenario,
        systemPrompt: cf.systemPrompt, postHistoryInstructions: cf.postHistoryInstructions,
        creatorNotes: cf.creatorNotes, characterVersion: cf.characterVersion,
        creator: cf.creator, bookMeta: cf.bookMeta, depthPrompt: cf.depthPrompt,
        sysNote: cf.sysNote, groupOnlyGreetings: cf.groupOnlyGreetings,
        worldbook: cf.worldbook, oocCorrections: corrs};
    }
  }
  if(runId === "imported" && typeof RP_CARDIMPORT !== "undefined"){
    var ic = RP_CARDIMPORT.find(name);
    /* exampleBlocks 必须透传: 少了它, 导入卡的 few-shot 就只剩 exampleDialogue 原文,
       而那段原文带 {{user}} 标签, 进 prompt 后 subMacros 把它展开成"你", 撞上开头
       "你是<角色名>" —— 导入卡聊天人称翻转的主因(回归见 tests/test_imported_pronoun.js) */
    if(ic){
      var pf = passthroughFields(ic);
      return {id: pf.id, name: ic.name, novel: pf.novel, fields: ic.fields || {},
        greeting: (typeof RP_CARDIMPORT.greetingOf === "function" ? RP_CARDIMPORT.greetingOf(ic) : null) || ic.greeting || "",
        altGreetings: ic.altGreetings || [], exampleDialogue: ic.exampleDialogue || "",
        exampleBlocks: ic.exampleBlocks || [],
        /* worldbook 必须透传: character_book 在导入时已解析成条目存好(cardimport.js
           normalizeTavern), 少了这个字段, 用户写在卡里的世界书一个字也进不了 prompt
           (回归见 tests/test_imported_parity_phase1.js) */
        worldbook: pf.worldbook,
        scenario: pf.scenario, systemPrompt: pf.systemPrompt,
        postHistoryInstructions: pf.postHistoryInstructions, creatorNotes: pf.creatorNotes,
        characterVersion: pf.characterVersion, creator: pf.creator, bookMeta: pf.bookMeta,
        depthPrompt: pf.depthPrompt, sysNote: pf.sysNote,
        groupOnlyGreetings: pf.groupOnlyGreetings,
        oocCorrections: corrs};
    }
  }
  var cards = (window.__DATA__ && window.__DATA__.rp_cards || {})[runId] || [];
  for(var i = 0; i < cards.length; i++) if(cards[i].name === name){
    var cd = cards[i];
    cd.oocCorrections = corrs;
    return cd;
  }
  return null;
}

function newMsg(role, content){
  return {mid: nextMsgId(), role: role, content: content, ts: Date.now(),
          candidates: role === "assistant" ? [content] : undefined, ci: 0};
}

/* P0-1: prompt.js 三池预算用的记忆上下文 (cardId 取不到则 renderBudgeted 内回退 runId_name) */
/* LeanMem: query 透传当前用户问题, 供 Adaptive Evidence Composition 自适应调三池权重 */
function memCtxFor(runId, name, card, novel, temporal, query, apex){
  return {runId: runId, name: name, cardId: (card && (card.id || card.cardId)) || null,
    novel: novel || null, temporal: temporal || null, query: query || "", apex: apex || null};
}
/* APEX-MEM 检索时冲突消解：similar 池 record 候选先按人物收窄，矛盾时便宜小模型裁决一次。
 * 无候选/无矛盾时零额外调用；任何异常返回 null（调用方走旧 record 渲染路径）。 */
async function apexFor(runId, name, card, query, cfg, callChat){
  try{
    if(typeof RP_APEX === "undefined" || !RP_APEX.on()) return null;
    return await RP_APEX.apexFor(runId, name, card, query, cfg, callChat);
  }catch(e){ return null; }
}
/* 时序感知检索（Chronos 思路）：故事进度 S 之前的事件进 similar 池，防"提前知道剧本" */
async function temporalFor(storyKey, card, novel, h){
  try{
    if(typeof RP_TEMPORAL === "undefined") return null;
    var recent = (h || []).slice(-4).map(function(m){ return (m && m.content) || ""; });
    return await RP_TEMPORAL.retrieveTemporal(storyKey, card, novel, recent, 5);
  }catch(e){ return null; }
}
/* P0-3: 人物弧光 prompt 段 (无弧光卡返回空字符串, 注入层自行跳过)
 * 2026-09-30 修: 形参顺序与三处调用点 (runId, name, card) 对齐;
 * 之前定义为 (card, runId) 导致 renderArcPrompt 拿到字符串 card, 弧光恒为空。 */
function arcTextFor(runId, name, card){
  try{
    if(typeof RP_ARC !== "undefined" && RP_ARC.renderArcPrompt)
      return RP_ARC.renderArcPrompt(card, runId) || "";
  }catch(e){}
  return "";
}
/* PPA 二遍对齐的对齐依据: 铁律 + 弧光 + 画像库(profile3) + 故事进度约束一句话 */
function ppaBasisFor(runId, name, card, storyKey, arcText){
  var basis = {iron: "", arc: arcText || "", profile: [], storyLine: ""};
  try{
    var cardId = (card && (card.id || card.cardId)) || null;
    if(typeof RP_MEM !== "undefined"){
      basis.iron = String(RP_MEM.getIronLaw(runId, name, cardId) || "").slice(0, 400);
      var st = RP_MEM.get(runId, name) || {};
      basis.profile = (st.profile3 || []).map(function(p){ return p && p.text; }).filter(Boolean);
    }
  }catch(e){}
  try{
    if(typeof RP_TEMPORAL !== "undefined" && storyKey){
      var s = RP_TEMPORAL.getS(storyKey, card || null);
      if(s && s.chapter)
        basis.storyLine = "当前故事进度为第" + s.chapter + "回; 该回之后发生的事角色一概不知, 初稿若有提及必须删改。";
    }
  }catch(e){}
  return basis;
}
/* 导演文本是否含关键情节点: 委托 RP_PPA.isKeyRound (启发式, 见 ppa.js) */
function ppaKeyRound(dirText){
  return (typeof RP_PPA !== "undefined") ? RP_PPA.isKeyRound(dirText) : false;
}

async function greeting(runId, name, cfg, novel){
  var card = findCard(runId, name);
  /* 卡片原开场白优先: first_mes/greeting 为正统开场, 多开场白作为候选一起随机。
   * 以前导入卡的 first_mes 只塞进 typical_lines(纯数组还被 val 吞掉), 有 key 时又被模型重写,
   * 导致卡片原开场白永远出不来。 */
  if(card){
    /* ST 语义: first_mes 是固定开场, alternate_greetings 需用户手动选择才用。
     * 以前从池里随机抽, 每次开场不一样, 用户困惑 (实测确认)。 */
    var g0 = card.greeting && String(card.greeting).trim();
    if(g0) return g0;
    var pool = [];
    (card.altGreetings || []).forEach(function(g){
      g = String(g == null ? "" : g).trim();
      if(g && pool.indexOf(g) < 0) pool.push(g);
    });
    if(pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  /* 2026-10-07: 管线 openings (蒸馏产物, 按档案生成), 优先于现场 LLM 生成, 省调用且稳定 */
  try{
    var prun = (window.__DATA__ && window.__DATA__.runs || {})[runId] || {};
    var pops = (prun.openings || {})[name] || [];
    if(pops.length){
      var pt = String((pops[0] && pops[0].text) || pops[0] || "").trim();
      if(pt) return pt;
    }
  }catch(e){}
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

/* S-6 按卡温度 (对标 Kindroid user_set_temperature 0.6–1.8): 卡片温度覆盖全局 */
function cardTempOf(card, fallback){
  if(card && card.temperature != null && isFinite(+card.temperature))
    return Math.max(0.1, Math.min(2, +card.temperature));
  return fallback;
}

/* 章节进度：构建知识截止指令。run.sections 为章节列表，chapterIdx>=0 时生效 */
function buildChapterInstr(run, chapterIdx){
  try{
    if(typeof chapterIdx !== "number" || chapterIdx < 0) return "";
    var secs = (run && run.sections) || [];
    if(!secs.length || chapterIdx >= secs.length) return "";
    var chTitle = (secs[chapterIdx] && secs[chapterIdx].title) || ("第" + (chapterIdx+1) + "章");
    var knownPlot = secs.slice(0, chapterIdx+1).map(function(s, i){
      return "第" + (i+1) + "章《" + (s.title||"") + "》：" + (s.summary||"").slice(0, 200);
    }).join("\n");
    return "【时间点锁定】当前故事时间点：第" + (chapterIdx+1) + "章《" + chTitle + "》。"
      + "你只知道第" + (chapterIdx+1) + "章及之前发生的事情，对之后（第" + (chapterIdx+2) + "章及以后）的剧情、人物命运、结局一无所知。"
      + "绝对不要透露、暗示或利用未来章节的任何信息；如果用户问起之后的事，要以角色身份表示不知道。"
      + "以下是你已知晓的剧情（截止到当前章节）：\n" + knownPlot;
  }catch(e){ return ""; }
}

/* 发送一轮。opts: {cfg, history, onPush, onToken, onSystem, budget, signal,
 *                 temperature, oocOn, cardName} */
async function send(runId, name, text, opts){
  opts = opts || {};
  var cfg = opts.cfg || {};
  var h = opts.history || [];
  var run = (window.__DATA__ && window.__DATA__.runs || {})[runId] || {};
  /* 非蒸馏 runId (imported/custom/其它卡片库 runId) 没有真 run, 按卡合成最小 run */
  var _syn = synthRunFor(runId, name);
  if(_syn) run = _syn;
  var card = findCard(runId, name) || {name: name, fields: {}};
  /* 聊天设置 per-chat 参数覆盖 */
  try{
    var _csId = (typeof chatKey !== "undefined") ? chatKey(runId, name) : (runId + "|" + name);
    var _tp = parseFloat(localStorage.getItem("nd_temp_" + _csId));
    if(isFinite(_tp)) opts.temperature = _tp;
    var _mt = parseInt(localStorage.getItem("nd_maxtok_" + _csId));
    if(isFinite(_mt) && _mt > 0) opts.maxTokens = _mt;
  }catch(e){}
  /* Card Evolution: 已接受的建议覆盖卡字段 */
  try{
    if(typeof AGENT_CARDEVO !== "undefined"){
      AGENT_CARDEVO.getSuggestions(runId, name).forEach(function(s){
        if(s.status === "accepted" && s.field && s.newVal){
          card.fields = card.fields || {};
          card.fields[s.field] = s.newVal;
        }
      });
    }
  }catch(e){}
  /* S-6 按卡温度: 卡片温度覆盖全局 */
  opts.temperature = cardTempOf(card, opts.temperature);

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
      dirText = await RP_DIRECTOR.onUserMessage(wsId, {cfg: cfg, history: h, runId: runId,
        hint: wsHint, cardBrief: cardBriefOf(card)});
  }catch(e){}
  var temporal = await temporalFor(wsId, card, run.novel, h);
  var apex = await apexFor(runId, name, card, text, cfg,
    function(c, ms, t){ return RP_NET.complete(c, ms, t); });
  var arcText = arcTextFor(runId, name, card); // PPA 对齐依据复用, 避免重复计算
  /* 方向二：画像动态检索（零 LLM，失败不打断；命中明细见 window.__lastPortrait） */
  var portEnrich = {text:"", hits:[], banned:[]};
  try{ if(typeof RP_PORTRAIT!=="undefined") portEnrich = RP_PORTRAIT.enrich(card, text, h); }catch(e){}
  try{ window.__lastPortrait = portEnrich; }catch(e){}
  var b = RP_PROMPT.buildMessages(card, {
    novel: run.novel, worldbook: promptWorldbook(run, runId, card, name), relations: (typeof AGENT_RELATIONS !== "undefined" ? AGENT_RELATIONS.merged(runId, run.relations, name) : run.relations),
    memory: memPrompt, memTasks: memTasks,
    memBudgeted: memCtxFor(runId, name, card, run.novel, temporal, text, apex),
    arc: arcText,
    history: mapHistory(h),
    persona: RP_PERSONA.renderText(RP_PERSONA.resolve(runId)),
    personaName: (function(){ try{ var p = RP_PERSONA.resolve(runId); return (p && p.name) || ""; }catch(e){ return ""; } })(),
    sceneText: opts.sceneText || "", /* S-7 高权重场景 */
    pov: opts.pov, person: opts.person,
    concise: !!opts.concise, /* Tier2 #15 简洁回复开关 */
  }, budget);
  /* 画像动态检索段落后置拼入（不改 prompt.js） */
  try{
    if(portEnrich.text && b.messages.length && b.messages[0].role==="system")
      b.messages[0].content += "\n\n" + portEnrich.text;
  }catch(e){}
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
  /* Push Story: 一次性剧情推进指令 */
  try{
    if(typeof AGENT_PUSHSTORY !== "undefined"){
      var pushText = AGENT_PUSHSTORY.injectPrompt(wsId);
      if(pushText && b.messages.length && b.messages[0].role === "system")
        b.messages[0].content += "\n\n" + pushText;
      if(pushText) b.stats.hasPushStory = true;
    }
  }catch(e){}
  b.stats.hasWorldsim = !!wsText;   // P0-5: Prompt 诊断用
  b.stats.hasDirector = !!dirText;
  if(opts.optCards && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + optCardsInstr(opts.optCount, opts.optMood);
  if(opts.plotOutline && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + plotRef(opts.plotOutline);
  if(opts.scenario && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + opts.scenario;
  /* 章节进度：角色知识截止到所选章节 */
  try{
    var chInstr = buildChapterInstr(run, opts.chapterIdx);
    if(chInstr && b.messages.length && b.messages[0].role === "system"){
      b.messages[0].content += "\n\n" + chInstr;
      b.stats.hasChapterLock = true;
      b.stats.chapterIdx = opts.chapterIdx;
    }
  }catch(e){}
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

  /* Continuity Checker: LLM 检查逻辑矛盾，发现则自动修一次 */
  try{
    if(typeof AGENT_CONTINUITY !== "undefined" && AGENT_CONTINUITY.isEnabled()){
      var contR = await AGENT_CONTINUITY.check(runId, name, reply, h,
        function(c, ms, t){ return RP_NET.complete(c, ms, t); }, cfg);
      if(contR.issues && contR.issues.length){
        console.log("[Continuity] 发现 " + contR.issues.length + " 处矛盾，尝试修复");
        var fixed = await AGENT_CONTINUITY.fix(runId, name, reply, contR.issues, h,
          function(c, ms, t){ return RP_NET.complete(c, ms, t); }, cfg);
        if(fixed && fixed !== reply) reply = fixed;
      }
    }
  }catch(e){}
  reply = applyRegex(reply, getRegex(runId, name));
  /* 世界模拟：解析 AI 的 ⟦时间/天气/地点⟧ 标记并从正文剥离 */
  try{
    if(typeof RP_WORLDSIM !== "undefined"){
      var wres = RP_WORLDSIM.applyReply(wsId, reply, wsHint);
      if(wres.changed) reply = wres.clean;
    }
  }catch(e){}
  /* PPA 二遍对齐 (arXiv:2506.11857): 第一遍已流式输出; 第二遍只修人设/知识边界,
   * 失败/超时保留第一遍。气泡 "对齐中…" 经由 opts.onAligning 提示。 */
  var ppaR = null;
  try{
    if(typeof RP_PPA !== "undefined"){
      ppaR = await RP_PPA.maybeAlign({
        ppa: opts.ppa, userText: text, keyRound: ppaKeyRound(dirText),
        callChat: function(c, ms, t, m){ return RP_NET.complete(c, ms, t, m); },
        cfg: cfg, name: name, draft: reply,
        basis: ppaBasisFor(runId, name, card, wsId, arcText),
        onAligning: opts.onAligning
      });
      if(ppaR) reply = ppaR.text;
    }
  }catch(e){ ppaR = null; }
  /* S-4 召回指示器: 把本次注入的记忆段标签/世界书命中挂在消息上, 气泡 🧠 角标用 */
  var am = newMsg("assistant", reply);
  if(b.stats.memHits && b.stats.memHits.length) am.memHits = b.stats.memHits;
  if(b.stats.loreHits && b.stats.loreHits.length) am.loreHits = b.stats.loreHits;
  h.push(am);
  /* 角色卡演变审计: 后台建议卡更新，从不自动改，失败不打断 */
  try{
    if(typeof AGENT_CARDEVO !== "undefined"){
      AGENT_CARDEVO.audit(runId, name, card, h,
        function(c, ms, t){ return RP_NET.complete(c, ms, t); }, cfg
      ).then(function(r){
        if(r && r.suggested) console.log("[CardEvo] +" + r.suggested + " 条卡更新建议");
      }).catch(function(){});
    }
  }catch(e){}
  /* 关系动态更新: 后台检测关系变化，失败不打断 */
  try{
    if(typeof AGENT_RELATIONS !== "undefined"){
      AGENT_RELATIONS.detectChanges(runId, name, h,
        function(c, ms, t){ return RP_NET.complete(c, ms, t); }, cfg
      ).then(function(r){
        if(r && r.updated) console.log("[RelDyn] +" + r.updated + " 条关系更新");
      }).catch(function(){});
    }
  }catch(e){}
  /* Lorebook Keeper: 后台提取新事实进世界书，失败不打断 */
  try{
    if(typeof AGENT_LOREKEEPER !== "undefined"){
      AGENT_LOREKEEPER.onReply(runId, name, h,
        function(c, ms, t){ return RP_NET.complete(c, ms, t); }, cfg
      ).then(function(r){
        if(r && r.added) console.log("[LoreKeeper] +" + r.added + " 条新事实");
      }).catch(function(){});
    }
  }catch(e){}
  /* 游玩统计：记一轮 + prompt/回复 token 估算（纯本地，RP_STATS） */
  try{
    if(typeof RP_STATS !== "undefined"){
      var _pc = b.messages.map(function(m){
        var c = m && m.content;
        return (typeof c === "string") ? c : (c ? JSON.stringify(c) : "");
      }).join("\n");
      RP_STATS.recordTurn(runId, name, _pc, reply, false);
    }
  }catch(e){}
  if(ppaR){
    b.stats.ppa = {ran: true, changed: ppaR.changed, mode: ppaR.mode}; // P0-5: 诊断用
    try{ RP_PPA.recordAlign(wsId, h.length, ppaR.changed); }catch(e){}
  }
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
  var run = (window.__DATA__ && window.__DATA__.runs || {})[runId] || {};
  var card = findCard(runId, name) || {name: name, fields: {}};
  /* S-6 按卡温度: regenerate 同样覆盖 */
  opts.temperature = cardTempOf(card, opts.temperature);
  var mem = RP_MEM.get(runId, name);
  var upto = h.indexOf(last);
  var lastUserText = "";
  for(var u = upto - 1; u >= 0; u--){
    if(h[u].role === "user"){ lastUserText = h[u].content || ""; break; }
  }
  var wsIdRe = (typeof chatKey !== "undefined") ? chatKey(runId, name) : (runId + "|" + name);
  var temporalRe = await temporalFor(wsIdRe, card, run.novel, h.slice(0, upto));
  var apexRe = await apexFor(runId, name, card, lastUserText, cfg,
    function(c, ms, t){ return RP_NET.complete(c, ms, t); });
  var arcTextRe = arcTextFor(runId, name, card);
  var b = RP_PROMPT.buildMessages(card, {
    novel: run.novel, worldbook: promptWorldbook(run, runId, card, name), relations: (typeof AGENT_RELATIONS !== "undefined" ? AGENT_RELATIONS.merged(runId, run.relations, name) : run.relations),
    memory: RP_MEM.renderBudgeted ? "" : RP_MEM.renderPrompt(mem),
    memTasks: RP_TASKS.renderPrompt(runId, name, lastUserText),
    memBudgeted: memCtxFor(runId, name, card, run.novel, temporalRe, lastUserText, apexRe),
    arc: arcTextRe,
    history: mapHistory(h.slice(0, upto)),
    persona: RP_PERSONA.renderText(RP_PERSONA.resolve(runId)),
    pov: opts.pov, person: opts.person,
    concise: !!opts.concise, /* Tier2 #15 简洁回复开关 */
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
  /* PPA 二遍对齐: regenerate 同样走对齐 (无导演轮, 只看关键词/档位) */
  var ppaReR = null;
  try{
    if(typeof RP_PPA !== "undefined"){
      ppaReR = await RP_PPA.maybeAlign({
        ppa: opts.ppa, userText: lastUserText, keyRound: false,
        callChat: function(c, ms, t, m){ return RP_NET.complete(c, ms, t, m); },
        cfg: cfg, name: name, draft: reply,
        basis: ppaBasisFor(runId, name, card, wsIdRe, arcTextRe),
        onAligning: opts.onAligning
      });
      if(ppaReR) reply = ppaReR.text;
    }
  }catch(e){ ppaReR = null; }
  if(ppaReR){ try{ RP_PPA.recordAlign(wsIdRe, h.length, ppaReR.changed); }catch(e){} }
  if(!RP_OOC.check(reply, name)){
    last.candidates = last.candidates || [last.content];
    last.candidates.push(reply);
    last.ci = last.candidates.length - 1;
    last.content = reply;
    last.ts = Date.now();
    /* 游玩统计：重抽只记 token，不记轮数（纯本地，RP_STATS） */
    try{
      if(typeof RP_STATS !== "undefined"){
        var _pc2 = b.messages.map(function(m){
          var c = m && m.content;
          return (typeof c === "string") ? c : (c ? JSON.stringify(c) : "");
        }).join("\n");
        RP_STATS.recordTurn(runId, name, _pc2, reply, true);
      }
    }catch(e){}
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
  var run = (window.__DATA__ && window.__DATA__.runs || {})[runId] || {};
  var budget = opts.budget || {};
  if(!budget.maxContext && cfg.maxContext) budget.maxContext = cfg.maxContext;

  /* Soul 并行模式: per-chat 开关 + 成员有 soul 包时走并行路径 */
  try{
    if(typeof RP_SOUL_ORCH !== "undefined" && typeof chatKey !== "undefined"){
      var _sChatId = chatKey(runId, (members || []).join(","));
      if(RP_SOUL_ORCH.shouldUseSoulMode(runId, members, _sChatId)){
        var sr = await RP_SOUL_ORCH.sendGroupSoul(runId, members, text, {
          cfg: cfg, history: h, temperature: opts.temperature,
          maxTokens: opts.maxTokens, chatId: _sChatId,
          scene: opts.scene || "", contextToken: opts.contextToken,
          signal: opts.signal, /* P1-2: soul 并行可取消 */
          onSpeaker: opts.onSpeaker, selectMode: opts.soulSelectMode
        });
        /* trajectory 已在 sendGroupSoul 内记录 */
        return {history: sr.history, aborted: false, stats: sr.stats,
                speakers: sr.speakers, speaker: sr.speakers[sr.speakers.length - 1] || null,
                mode: "soul", turnId: sr.turnId};
      }
    }
  }catch(e){
    /* soul 路径失败回退传统串行 */
    try{ console.warn("[soul] parallel failed, fallback:", e.message); }catch(_){}
  }

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
      opts._dirText = await RP_DIRECTOR.onUserMessage(groupKey(runId, members), {cfg: cfg, history: h, runId: runId,
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
  var wsIdSpk = (typeof groupKey !== "undefined") ? groupKey(runId, members) : (runId + "|" + speaker);
  var temporalSpk = await temporalFor(wsIdSpk, activeCard, run.novel, h);
  var apexSpk = await apexFor(runId, speaker, activeCard, text, cfg,
    function(c, ms, t){ return RP_NET.complete(c, ms, t); });
  var arcTextSpk = arcTextFor(runId, speaker, activeCard);
  var b = RP_PROMPT.buildMessages(activeCard, {
    novel: run.novel, worldbook: promptWorldbook(run, runId, activeCard, speaker), relations: (typeof AGENT_RELATIONS !== "undefined" ? AGENT_RELATIONS.merged(runId, run.relations, speaker) : run.relations),
    memory: RP_MEM.renderBudgeted ? "" : RP_MEM.renderPrompt(RP_MEM.get(runId, speaker)),
    memTasks: RP_TASKS.renderPrompt(runId, speaker, text),
    memBudgeted: memCtxFor(runId, speaker, activeCard, run.novel, temporalSpk, text, apexSpk),
    arc: arcTextSpk,
    history: mapHistory(h),
    persona: RP_PERSONA.renderText(RP_PERSONA.resolve(runId)),
    personaName: (function(){ try{ var p = RP_PERSONA.resolve(runId); return (p && p.name) || ""; }catch(e){ return ""; } })(),
    sceneText: opts.sceneText || "", /* S-7 高权重场景(群聊同样生效) */
    pov: opts.pov, person: opts.person,
    concise: !!opts.concise, /* Tier2 #15 简洁回复开关 */
  }, budget);
  // 注入"在场人物"简介, 替换 post-history 为群聊版
  var briefs = otherCards.map(function(c){ return RP_GROUP.memberBrief(c); }).join("\n");
  if(briefs) b.messages[0].content += "\n\n【在场人物】\n" + briefs;
  /* 角色关系设定（群设置里配的 "A是B的…"）：注入群聊 prompt */
  try{
    if(typeof RP_GROUP.renderRels === "function"){
      var gk2 = members.slice().sort().join("_");
      var relText = RP_GROUP.renderRels(runId, gk2);
      if(relText && b.messages.length && b.messages[0].role === "system")
        b.messages[0].content += "\n\n【角色关系】\n" + relText;
    }
  }catch(e){}
  if(opts.optCards && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + optCardsInstr(opts.optCount, opts.optMood);
  if(opts.plotOutline && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + plotRef(opts.plotOutline);
  if(opts.scenario && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + opts.scenario;
  /* 章节进度（群聊） */
  try{
    var chInstrG = buildChapterInstr(run, opts.chapterIdx);
    if(chInstrG && b.messages.length && b.messages[0].role === "system"){
      b.messages[0].content += "\n\n" + chInstrG;
      b.stats.hasChapterLock = true;
    }
  }catch(e){}
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
  /* PPA 二遍对齐: 群聊每位发言人独立对齐, 关键轮按群聊导演文本判定 */
  var ppaSpkR = null;
  try{
    if(typeof RP_PPA !== "undefined"){
      ppaSpkR = await RP_PPA.maybeAlign({
        ppa: opts.ppa, userText: text, keyRound: ppaKeyRound(opts._dirText),
        callChat: function(c, ms, t, m){ return RP_NET.complete(c, ms, t, m); },
        cfg: cfg, name: speaker, draft: reply,
        basis: ppaBasisFor(runId, speaker, activeCard, wsIdSpk, arcTextSpk),
        onAligning: opts.onAligning
      });
      if(ppaSpkR) reply = ppaSpkR.text;
    }
  }catch(e){ ppaSpkR = null; }
  var msg = newMsg("assistant", reply);
  msg.speaker = speaker;
  h.push(msg);
  if(ppaSpkR){ try{ RP_PPA.recordAlign(wsIdSpk, h.length, ppaSpkR.changed); }catch(e){} }
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
  /* S 级补全: 穿越同样走 ST 预设组装 (设置页绑定的预设) */
  try{ if(!budget.stPreset && typeof resolveStPreset === "function") budget.stPreset = resolveStPreset(); }catch(e){}
  /* S-6 按卡温度: 魂穿卡片世界时用卡片温度 */
  try{
    var __tc = (typeof RP_TRAVERSE.travCard === "function") ? RP_TRAVERSE.travCard(trav) : null;
    opts.temperature = cardTempOf(__tc, opts.temperature);
  }catch(e){}
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
  /* 剧情选项卡: 与单聊/群聊一致, 由 RP 设置里的选项开关控制 */
  if(opts.optCards && b.messages.length && b.messages[0].role === "system")
    b.messages[0].content += "\n\n" + optCardsInstr(opts.optCount, opts.optMood);
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

  /* S 级补全: 穿越回复同样过正则 (与单聊/群聊一致) */
  try{ reply = applyRegex(reply, getRegex("trav", travRegexName(trav))); }catch(e){}

  /* 世界模拟：解析 AI 的 ⟦时间/天气/地点⟧ 标记并从正文剥离 */
  try{
    if(typeof RP_WORLDSIM !== "undefined"){
      var wresT = RP_WORLDSIM.applyReply(wsIdT, reply, wsHintT);
      if(wresT.changed) reply = wresT.clean;
    }
  }catch(e){}
  /* PPA 二遍对齐: 穿越链路同样接入, 无对齐依据 (无铁律/弧光/故事进度) 时自动跳过 */
  var ppaTR = null;
  try{
    if(typeof RP_PPA !== "undefined"){
      ppaTR = await RP_PPA.maybeAlign({
        ppa: opts.ppa, userText: text, keyRound: ppaKeyRound(dirTextT),
        callChat: function(c, ms, t, m){ return RP_NET.complete(c, ms, t, m); },
        cfg: cfg, name: trav.anchorTitle || trav.worldName || "世界", draft: reply,
        basis: ppaBasisFor("trav", travId, null, wsIdT, ""),
        onAligning: opts.onAligning
      });
      if(ppaTR) reply = ppaTR.text;
    }
  }catch(e){ ppaTR = null; }

  h.push(newMsg("assistant", reply));
  if(ppaTR){ try{ RP_PPA.recordAlign(wsIdT, h.length, ppaTR.changed); }catch(e){} }
  return {history: h, aborted: false, stats: b.stats,
          worldState: RP_TRAVERSE.getState(travId)};
}

return {send: send, regenerate: regenerate, swipe: swipe, sendGroup: sendGroup,
        sendTraverse: sendTraverse,
        greeting: greeting, findCard: findCard, mapHistory: mapHistory, tagUserMsg: tagUserMsg,
        synthRunFor: synthRunFor};
})();
