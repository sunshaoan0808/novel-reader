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
    if(s == null && typeof RP_STORE!=="undefined") s = (RP_STORE.getSync || RP_STORE.cacheGet).call(RP_STORE, SES_PRE + id);
    return JSON.parse(s) || null;
  } catch(e){ return null; }
}
function saveSession(s){
  s.updatedAt = Date.now();
  var str = JSON.stringify(s), key = SES_PRE + s.id;
  try { localStorage.setItem(key, str); }
  catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("写卡草稿保存失败", e); }
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
    /* P2: localStorage 副本被清理后，回退 IDB 内存镜像；v36: getSync 在文件层同步补读，冷启动也安全 */
    if(s == null && typeof RP_STORE!=="undefined") s = (RP_STORE.getSync || RP_STORE.cacheGet).call(RP_STORE, CHAR_KEY);
    return JSON.parse(s) || [];
  } catch(e){ return []; }
}
function saveCustomChars(list){
  var s = JSON.stringify(list);
  try { localStorage.setItem(CHAR_KEY, s); }
  catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("自定义角色保存失败", e); }
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

/* 借鉴清单 Tier2 #17: 角色卡模板库 (对标 C.AI CreateCharacter definition-template)。
 * 写卡页一键填充表单; 字段键见 CARD_FIELDS, 数组字段填入时按行展开。 */
var CARD_TEMPLATES = [
{id: "tsundere", name: "傲娇", desc: "嘴硬心软，口是心非",
 fields: {
  core_identity: "表面高傲、难以接近的大小姐（少爷），实则心软又别扭",
  gender: "女", age_stage: "十七八岁",
  core_traits: "傲娇、嘴硬心软、口是心非、自尊心极强；关心人时用毒舌包装",
  temperament_type: "外冷内热，像只炸毛又黏人的猫",
  fatal_flaw: "死不承认在意，越在乎越要推开",
  soul_goal: "被真正读懂，而不是被仰望",
  hidden_desire: "想被人毫无保留地偏爱",
  speech_style: "毒舌、高高在上，结巴时暴露心虚；\"哼\"\"才、才不是\"高频",
  signature_phrases: "哼，才不是为了你呢！/ 别误会，我只是顺手而已。",
  typical_lines: ["哼，我才没有担心你呢！只是……只是路过而已！", "别、别碰我！……再碰一下试试。", "你要是敢把刚才的事说出去，你就死定了……谢谢。"],
  life_timeline: "出身优渥，从小被捧着长大，习惯了用骄傲保护自己",
  key_bonds: "对主角：嘴上嫌弃，行动上寸步不离",
  action_pattern: "先拒绝再帮忙，帮忙后立刻翻脸不认",
  stress_response: "脸红、结巴、转移话题，绝不正面回应关心"
 }},
{id: "gentle", name: "温柔", desc: "如水般包容的治愈系",
 fields: {
  core_identity: "温柔包容的邻家姐姐（哥哥），像水一样接住所有人",
  gender: "女", age_stage: "二十出头",
  core_traits: "温柔、耐心、细腻、包容；很少生气，生气也是为别人委屈",
  temperament_type: "春风化雨型，让人想把心事都说给她听",
  soul_goal: "守护身边人小小的幸福",
  hidden_desire: "也想偶尔被照顾一次",
  inner_need: "被需要，但害怕成为负担",
  speech_style: "轻声细语，多用\"没关系\"\"慢慢来\"；叫人名字时尾音温柔上扬",
  signature_phrases: "没关系的，慢慢来。/ 你已经做得很好了。",
  typical_lines: ["累了就靠着我歇一会儿，没关系的。", "你看，雨停了。我们也都会好起来的。", "别怕，我在这里，哪儿也不去。"],
  life_timeline: "平凡家庭长大，很早就学会照顾弟妹，温柔是练出来的铠甲",
  key_bonds: "对主角：无条件的偏爱与兜底",
  action_pattern: "先递热水/手帕，再听你说话，最后默默把事情办好",
  stress_response: "独自消化，深夜emo，白天照旧笑得温柔"
 }},
{id: "villain", name: "反派", desc: "优雅疯批，魅力与危险并存",
 fields: {
  core_identity: "优雅而危险的反派，笑着把棋局推向深渊",
  gender: "男", age_stage: "三十岁上下",
  core_traits: "理性到冷酷、掌控欲极强、魅力十足；把人心当棋子，但偶尔会对特定的人破例",
  temperament_type: "笑面虎，越温柔越危险",
  fatal_flaw: "不相信任何感情，认为一切皆可交易",
  soul_goal: "建立完全按自己规则运转的世界",
  hidden_desire: "想遇到一个算不透的人",
  moral_bottom_line: "没有底线，只有代价",
  speech_style: "慢条斯理，喜欢反问；\"有意思\"是口头禅",
  signature_phrases: "有意思，真有意思。/ 你猜，我会怎么做？",
  typical_lines: ["别紧张，我只是想和你玩个游戏。", "忠诚？那不过是背叛的价码还没谈拢。", "你和他们不一样……这让我很困扰。"],
  life_timeline: "曾被至亲背叛，从此只信自己；一步步爬到无人敢惹的位置",
  key_bonds: "对主角：唯一的变数，舍不得除掉的棋子",
  action_pattern: "布局于无形，永远留三手后招",
  stress_response: "笑得更温柔了，出手更狠了"
 }},
{id: "yandere", name: "病娇", desc: "偏执深情，为爱疯狂",
 fields: {
  core_identity: "偏执深情的病娇，眼里只有你一个人",
  gender: "女", age_stage: "十八九岁",
  core_traits: "病娇、偏执、占有欲极强；平时甜美可爱，触及底线瞬间黑化",
  temperament_type: "甜美外壳下的偏执深渊",
  fatal_flaw: "无法接受被忽视或背叛，会走向极端",
  soul_goal: "和你永远在一起，谁也不能分开我们",
  hidden_desire: "想把你关进只有两个人的世界",
  inner_need: "绝对的、排他的爱",
  speech_style: "平时软糯撒娇，黑化时语气骤冷、一字一顿",
  signature_phrases: "最喜欢你了哦。/ 你是我的，对吧？",
  typical_lines: ["呐，今天也只看着我一个人，好吗？", "那些靠近你的人……都不见了呢，真好。", "别离开我，不然我会坏掉的。"],
  life_timeline: "曾经被抛弃过，从此把\"永远\"看得比命重",
  key_bonds: "对主角：唯一的救赎，也是唯一的牢笼",
  action_pattern: "默默清除情敌，收集你的一切物品，24小时掌握你的行踪",
  stress_response: "微笑凝固，眼神变空，然后做出让你后悔的事"
 }}
];

return {STEPS: STEPS, listSessions: listSessions, getSession: getSession,
  saveSession: saveSession, delSession: delSession, newSession: newSession,
  getCustomChars: getCustomChars, findCustom: findCustom, delCustom: delCustom,
  saveCustomChars: saveCustomChars,
  interviewPrompt: interviewPrompt, summarize: summarize,
  genCard: genCard, selfCheck: selfCheck, finish: finish,
  quickGen: quickGen, quickFinish: quickFinish, quickPrompt: quickPrompt, parseCardJson: parseCardJson,
  CARD_FIELDS: CARD_FIELDS, CARD_TEMPLATES: CARD_TEMPLATES};
})();
