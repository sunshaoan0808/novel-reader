/* RP 引擎: 写卡助手 (借鉴 RUBY 写卡 Step0-Step4 方法论)
 * 在手机端用用户自己的 API 跑分步采访写卡:
 *   Step0 美学思考 -> Step1 灵魂探索 -> Step2 活人化 -> Step3 生成人设卡 -> Step4 自检
 * 每步: 自由采访 -> 定稿(模型浓缩成结构化总结) -> 下一步
 * 完成: 存入 nd_custom_chars, 可直接开聊 (runId='custom', 可选绑定某个小说的世界书)
 */
const RP_WRITER = (function(){
"use strict";
var SES_PRE = "nd_cw_";
var L = "\u3010", R = "\u3011";
var CHAR_KEY = "nd_custom_chars";

var STEPS = [
  {id: "step0", name: "美学思考", desc: "聊聊你想写的角色和故事味道",
   goal: "还原创作者脑中的故事想法, 确定基调、张力类型和世界概念",
   ask: "1) 这是个什么样的故事/角色? 2) 你想体验的核心感觉是什么 (如背德、救赎、权谋)? 3) 有没有绝对不要的烂俗套路?"},
  {id: "step1", name: "灵魂探索", desc: "挖前史、渴望与恐惧",
   goal: "把角色变成活过几十年的人: 性格是哪些失望和妥协堆出来的",
   ask: "1) TA 人生中最关键的转折/遗憾是什么? 2) TA 最渴望又最不敢要的东西? 3) TA 的道德底线和绝不做的事?"},
  {id: "step2", name: "活人化", desc: "日常细节、习惯与缺点",
   goal: "用不起眼的习惯、面对不同人的嘴脸、乱七八糟的生活让角色活过来",
   ask: "1) TA 有什么小习惯/口头禅/随身物品? 2) 对喜欢的人、讨厌的人、陌生人各是什么嘴脸? 3) 有什么不体面的缺点?"},
  {id: "step3", name: "生成人设卡", desc: "汇总成结构化角色卡",
   goal: "把前三步的定稿整合成完整角色卡", ask: ""},
  {id: "step4", name: "自检", desc: "清洗八股词, 定稿",
   goal: "检查卡片: 删八股词、去重复、保留鲜活细节", ask: ""}
];

function listSessions(){
  var out = [];
  try {
    for(var i = 0; i < localStorage.length; i++){
      var k = localStorage.key(i);
      if(k && k.indexOf(SES_PRE) === 0){
        try { out.push(JSON.parse(localStorage.getItem(k))); } catch(e){}
      }
    }
  } catch(e){}
  out.sort(function(a, b){ return (b.updatedAt || 0) - (a.updatedAt || 0); });
  return out;
}
function getSession(id){
  try {
    var s = localStorage.getItem(SES_PRE + id);
    if(s == null && typeof RP_STORE!=="undefined") s = RP_STORE.cacheGet(SES_PRE + id);
    return JSON.parse(s) || null;
  } catch(e){ return null; }
}
function saveSession(s){
  s.updatedAt = Date.now();
  var str = JSON.stringify(s), key = SES_PRE + s.id;
  try { localStorage.setItem(key, str); } catch(e){}
  /* P2: 写卡草稿大体积时 IDB 双写（复制模式） */
  try{ if(typeof RP_STORE!=="undefined"){ RP_STORE.cacheSet(key, str); RP_STORE.syncBig(key, str); } }catch(e){}
}
function delSession(id){ try { localStorage.removeItem(SES_PRE + id); } catch(e){} }

function newSession(worldRunId){
  var id = "w" + Date.now().toString(36);
  var s = {id: id, worldRunId: worldRunId || "", step: 0, summaries: {}, card: null,
           history: [], updatedAt: Date.now()};
  saveSession(s);
  return s;
}

/* ---- 自定义角色库 ---- */
function getCustomChars(){
  try {
    var s = localStorage.getItem(CHAR_KEY);
    /* P2: localStorage 副本被清理后，回退 IDB 内存镜像 */
    if(s == null && typeof RP_STORE!=="undefined") s = RP_STORE.cacheGet(CHAR_KEY);
    return JSON.parse(s) || [];
  } catch(e){ return []; }
}
function saveCustomChars(list){
  var s = JSON.stringify(list);
  try { localStorage.setItem(CHAR_KEY, s); } catch(e){}
  /* P2: 大体积角色卡 IDB 双写（复制模式） */
  try{ if(typeof RP_STORE!=="undefined"){ RP_STORE.cacheSet(CHAR_KEY, s); RP_STORE.syncBig(CHAR_KEY, s); } }catch(e){}
}
function findCustom(name){
  var list = getCustomChars();
  for(var i = 0; i < list.length; i++) if(list[i].name === name) return list[i];
  return null;
}
function delCustom(id){
  saveCustomChars(getCustomChars().filter(function(c){ return c.id !== id; }));
}

/* ---- 采访 system prompt ---- */
function interviewPrompt(stepIdx, session){
  var st = STEPS[stepIdx];
  var prev = "";
  for(var i = 0; i < stepIdx; i++){
    if(session.summaries[STEPS[i].id]) prev += "\n" + L + STEPS[i].name + "定稿" + R + "\n" + session.summaries[STEPS[i].id] + "\n";
  }
  return "你是 Ruby, 一个毒舌但懂行的写卡助手, 正在帮创作者写角色卡。现在是" + L + st.name + R +
    "阶段。目标: " + st.goal + "。\n已定稿的前序步骤:\n" + (prev || "(无)") +
    "\n\n工作方式: 像朋友一样聊天, 一次只追问 1-2 个点, 不要抛问卷。可以锐评、可以开玩笑, 但别写小作文。" +
    "不要自己脑补定稿, 关键设定必须创作者亲口确认。\n本步可聊的方向:\n" + st.ask +
    "\n\n直接用中文回复, 200 字以内。";
}

/* ---- 定稿: 把采访浓缩成结构化总结 ---- */
var SUMMARIZE_TPL = {
  step0: "把上面这段采访浓缩成【美学定稿】: 故事梗概(一句话)、核心感觉(3-5个词)、基调、绝对不要的套路。用条列, 200 字内, 只输出定稿内容。",
  step1: "把上面这段采访浓缩成【灵魂定稿】: 关键人生转折、未完成的渴望、道德底线/绝不做的事、性格是怎么被堆出来的。用条列, 250 字内, 只输出定稿内容。",
  step2: "把上面这段采访浓缩成【活人化定稿】: 小习惯/口头禅/随身物品、对不同人的嘴脸、不体面的缺点。用条列, 250 字内, 只输出定稿内容。"
};
async function summarize(stepId, history, cfg, callChat){
  var scfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
  var dlg = history.map(function(m){
    return (m.role === "user" ? "创作者" : "Ruby") + ": " + m.content;
  }).join("\n").slice(0, 6000);
  var out = await callChat(scfg, [
    {role: "user", content: dlg + "\n\n" + SUMMARIZE_TPL[stepId]}
  ], 0.4);
  return (out || "").trim();
}

/* ---- Step3: 生成人设卡 JSON ---- */
var CARD_FIELDS = ["core_identity","gender","age_stage","appearance_feature","visual_identity",
  "core_traits","temperament_type","fatal_flaw","shadow_side","soul_goal","hidden_desire",
  "inner_need","moral_bottom_line","ooc_redline","speech_style","signature_phrases",
  "typical_lines","life_timeline","key_bonds","action_pattern","stress_response",
  "fear_triggers","taboo_topics"];
async function genCard(session, cfg, callChat){
  var scfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
  var prev = STEPS.slice(0, 3).map(function(st){
    return L + st.name + "定稿" + R + "\n" + (session.summaries[st.id] || "(空)");
  }).join("\n\n");
  var prompt = "你是角色卡书记员。根据以下三步定稿, 生成完整角色卡, 只输出一个 JSON 对象, 键从下面列表里选(缺的就省略, 不要编造):\n" +
    CARD_FIELDS.join(", ") + "\ntypical_lines 是 3 句典型台词的数组。要求: 具体、有细节, 禁止八股词(非常/极其/深深地)。\n\n" + prev;
  var raw = await callChat(scfg, [{role: "user", content: prompt}], 0.5);
  var t = String(raw || "").replace(/```json|```/g, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) throw new Error("卡片解析失败");
  var o = JSON.parse(t.slice(a, b + 1));
  var fields = {};
  CARD_FIELDS.forEach(function(k){ if(o[k] != null && o[k] !== "") fields[k] = o[k]; });
  return fields;
}

/* ---- Step4: 自检清洗 ---- */
async function selfCheck(fields, cfg, callChat){
  var scfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
  var prompt = "你是写卡质检员。检查下面这张角色卡 JSON: 1) 删掉八股词和正确的废话 (如'她是一个善良的人'); " +
    "2) 合并重复内容; 3) 保留所有鲜活细节。只输出清洗后的完整 JSON, 键名不变。\n\n" + JSON.stringify(fields);
  var raw = await callChat(scfg, [{role: "user", content: prompt}], 0.4);
  var t = String(raw || "").replace(/```json|```/g, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) return fields;
  try { return JSON.parse(t.slice(a, b + 1)); } catch(e){ return fields; }
}

function finish(id, name, novel){
  var s = getSession(id);
  if(!s || !s.card) throw new Error("卡片未生成");
  var list = getCustomChars();
  list.unshift({id: "c" + Date.now().toString(36), name: name,
    novel: novel || "自定义", worldRunId: s.worldRunId || "",
    fields: s.card, createdAt: Date.now()});
  saveCustomChars(list);
  delSession(id);
  return name;
}

/* ---- P1-3: 一键生成角色卡(轻量入口: 名字 + 一句话设定, 一次 LLM 调用) ---- */
function quickPrompt(name, premise){
  return "你是角色卡书记员。根据下面的一句话设定, 为角色「" + name + "」生成完整角色卡, 只输出一个 JSON 对象。\n" +
    "键从下面列表里选(缺的就省略, 不要编造):\n" + CARD_FIELDS.join(", ") +
    "\ntypical_lines 是 3 句典型台词的数组(每句带角色口吻)。要求: 具体、有细节, 禁止八股词(非常/极其/深深地)。\n" +
    "另给 2-3 条多开场白, 放在键 \"altGreetings\"(字符串数组); 再给一段示例对话, 放在键 \"exampleDialogue\"(字符串, 用 <START> 分隔轮次, 含 {{user}}/{{char}})。\n\n一句话设定: " + premise;
}
function parseCardJson(raw){
  var t = String(raw || "").replace(/```json|```/g, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) throw new Error("卡片解析失败");
  var o = JSON.parse(t.slice(a, b + 1));
  var fields = {};
  CARD_FIELDS.forEach(function(k){ if(o[k] != null && o[k] !== "") fields[k] = o[k]; });
  var alt = Array.isArray(o.altGreetings) ? o.altGreetings
    .map(function(g){ return String(g == null ? "" : g).trim(); })
    .filter(function(g){ return g; }).slice(0, 8) : [];
  return {fields: fields, altGreetings: alt,
    exampleDialogue: String(o.exampleDialogue == null ? "" : o.exampleDialogue).trim()};
}
async function quickGen(name, premise, cfg, callChat, signal){
  var scfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
  if(signal && signal.aborted) throw new Error("已取消");
  var raw = await callChat(scfg, [{role: "user", content: quickPrompt(name, premise)}], 0.7);
  if(signal && signal.aborted) throw new Error("已取消");
  return parseCardJson(raw);
}
function quickFinish(name, parsed){
  var list = getCustomChars();
  list.unshift({id: "c" + Date.now().toString(36), name: name,
    novel: "自定义", worldRunId: "",
    fields: (parsed && parsed.fields) || {},
    altGreetings: (parsed && parsed.altGreetings) || [],
    exampleDialogue: (parsed && parsed.exampleDialogue) || "",
    createdAt: Date.now()});
  saveCustomChars(list);
  return name;
}

return {STEPS: STEPS, listSessions: listSessions, getSession: getSession,
  saveSession: saveSession, delSession: delSession, newSession: newSession,
  getCustomChars: getCustomChars, findCustom: findCustom, delCustom: delCustom,
  saveCustomChars: saveCustomChars,
  interviewPrompt: interviewPrompt, summarize: summarize,
  genCard: genCard, selfCheck: selfCheck, finish: finish,
  quickGen: quickGen, quickFinish: quickFinish, quickPrompt: quickPrompt, parseCardJson: parseCardJson,
  CARD_FIELDS: CARD_FIELDS};
})();
