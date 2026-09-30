/* 穿越 P1/P2/P3 纯逻辑模块
 * P1: AI 身份捏造完整版（genIdentityFull / rerollField）+ 现代人携带物模板 +
 *     出戏值（detectOoc / addOoc）+ 角色卡世界补完（extractSeed / genWorldBible）
 * P2: 异世界框架（WORLD_REGISTRY / isekaiSession / isekaiPrompt）
 * P3: 组团穿越（planParty 复用 RP_GROUP 调度 / partyPrompt / 小队增删）
 * 依赖: RP_TRAVERSE（会话存储，可选）、RP_GROUP（发言调度，可选降级）
 * 注意：本模块只做纯逻辑，不碰 app.js / style.css / index.html，接线由集成者完成。
 * 所有外部引用（RP_TRAVERSE / RP_GROUP / localStorage）均有 typeof 存在性守卫，Node 可跑。
 */
const RP_TRAVERSE2 = (function(){
"use strict";

/* ================= 存储守卫 ================= */
function lsGet(k){
  try { return (typeof localStorage !== "undefined")? localStorage.getItem(k): null; }
  catch(e){ return null; }
}
function lsSet(k, v){
  try { if(typeof localStorage !== "undefined") localStorage.setItem(k, v); }
  catch(e){}
}

/* ================= 通用小工具 ================= */
function str(v, fb){ v = (v == null)? "": String(v).trim(); return v || (fb || ""); }
function toStrArr(v){
  if(!Array.isArray(v)) return [];
  var out = [];
  v.forEach(function(x){ x = str(x); if(x && out.indexOf(x) < 0) out.push(x); });
  return out;
}
function parseJsonObj(raw, errMsg){
  var t = String(raw || "").replace(/```json|```/g, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) throw new Error(errMsg);
  try { return JSON.parse(t.slice(a, b + 1)); }
  catch(e){ throw new Error(errMsg); }
}
function scfgOf(cfg){
  cfg = cfg || {};
  return {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
}

/* ================= P1: 身份捏造完整版 ================= */
var IDENT_FIELDS = [
  {key: "name", label: "姓名"},
  {key: "gender", label: "性别"},
  {key: "age", label: "年龄"},
  {key: "looks", label: "容貌"},
  {key: "origin", label: "出身家世"},
  {key: "traits", label: "性格"},
  {key: "talent", label: "特长"},
  {key: "items", label: "携带物"},
  {key: "situation", label: "初始处境"},
  {key: "hooks", label: "人物关系钩子"},
];

/* 现代人直穿默认携带物模板 */
var MODERN_ITEMS = [
  {name: "手机", durability: "电量20%", uses: 3},
  {name: "打火机", durability: "", uses: 20},
  {name: "一包纸巾", durability: "", uses: 10},
];
function cloneItems(items){
  return (items || []).map(function(it){
    if(typeof it === "string") return {name: it, durability: "", uses: 1};
    it = it || {};
    return {name: String(it.name || ""), durability: String(it.durability || ""),
            uses: (it.uses == null)? 1: it.uses};
  });
}
/* 消耗一件携带物一次：uses-1，用尽则移除。纯函数，不改原数组。 */
function useItem(items, name){
  var out = [];
  (items || []).forEach(function(raw){
    var it = (typeof raw === "string")?
      {name: raw, durability: "", uses: 1}:
      {name: String((raw || {}).name || ""), durability: String((raw || {}).durability || ""),
       uses: ((raw || {}).uses == null)? 1: raw.uses};
    if(it.name === name){
      var left = it.uses - 1;
      if(left > 0) out.push({name: it.name, durability: it.durability, uses: left});
      /* 用尽：不 push，即移除 */
    } else {
      out.push(it);
    }
  });
  return out;
}

/* AI 一次生成完整身份卡 JSON。opts.modern=true（或愿望含现代人/直穿）时携带物固定为现代人三件套。 */
async function genIdentityFull(wish, worldName, cfg, callChat, opts){
  opts = opts || {};
  var modern = !!opts.modern || /现代人|直穿|带着手机/.test(String(wish || ""));
  var itemRule = modern?
    "携带物固定为现代人三件套（手机/打火机/一包纸巾），items 字段照抄这三件，不要自行发挥。":
    "items 给 3 件符合该时代的随身物品（字符串数组）。";
  var prompt = "玩家想以「" + wish + "」穿越到" + worldName + "的世界。" +
    "请生成一张完整的身份卡，只输出一个 JSON 对象，不要解释：\n" +
    "{\"name\":\"姓名\",\"nameCandidates\":[\"备选名1\",\"备选名2\",\"备选名3\"]," +
    "\"gender\":\"男/女\",\"age\":\"年龄\",\"looks\":\"容貌（一句话）\"," +
    "\"origin\":\"出身家世（一句话）\",\"traits\":\"性格（一句话）\",\"talent\":\"特长（一句话）\"," +
    "\"items\":[\"携带物1\",\"携带物2\",\"携带物3\"]," +
    "\"situation\":\"初始处境（一句话，交代开场时身在何处、在做什么）\"," +
    "\"hooks\":[\"与原著人物的关系钩子1\",\"关系钩子2\",\"关系钩子3\"]}。\n" +
    "要求：身份必须符合该世界的时代与逻辑，具体不悬浮；" +
    "nameCandidates 恰好 3 个不同的备选名；hooks 给 2-3 条与原著主要人物的关系钩子；" + itemRule;
  var raw = await callChat(scfgOf(cfg), [{role: "user", content: prompt}], 0.7);
  var o = parseJsonObj(raw, "身份生成失败：AI 返回不是合法 JSON，换个愿望重试");
  var cands = toStrArr(o.nameCandidates).slice(0, 3);
  if(!cands.length && o.name) cands = [str(o.name)];
  var hooks = toStrArr(o.hooks).slice(0, 3);
  return {
    name: str(o.name, "无名氏"), nameCandidates: cands,
    gender: str(o.gender), age: str(o.age), looks: str(o.looks),
    origin: str(o.origin), traits: str(o.traits), talent: str(o.talent),
    items: modern? cloneItems(MODERN_ITEMS): toStrArr(o.items).slice(0, 3),
    situation: str(o.situation), hooks: hooks,
    modern: modern, wish: wish, worldName: worldName,
  };
}

/* 只重随单个字段，返回该字段的新值（name 返回 3 备选数组，hooks/items 返回数组，其余返回字符串）。不改动 draft。 */
async function rerollField(fieldKey, draft, wish, worldName, cfg, callChat, opts){
  opts = opts || {};
  draft = draft || {};
  var fld = null;
  IDENT_FIELDS.forEach(function(f){ if(f.key === fieldKey) fld = f; });
  if(!fld) throw new Error("未知身份字段：" + fieldKey);
  if(fieldKey === "items" && (opts.modern || draft.modern)) return cloneItems(MODERN_ITEMS);
  var want;
  if(fieldKey === "name") want = "返回 JSON {\"value\":[\"备选名1\",\"备选名2\",\"备选名3\"]}（恰好 3 个不同的新名字）";
  else if(fieldKey === "hooks") want = "返回 JSON {\"value\":[\"关系钩子1\",\"关系钩子2\"]}（2-3 条与原著人物的关系钩子）";
  else if(fieldKey === "items") want = "返回 JSON {\"value\":[\"携带物1\",\"携带物2\",\"携带物3\"]}（3 件符合时代的随身物品）";
  else want = "返回 JSON {\"value\":\"新的" + fld.label + "（一句话）\"}";
  var prompt = "玩家想以「" + wish + "」穿越到" + worldName + "。" +
    "当前身份草稿（仅供参考风格，不要照搬）：\n" +
    JSON.stringify({name: draft.name, gender: draft.gender, origin: draft.origin, traits: draft.traits}) +
    "\n只重随「" + fld.label + "」这一个字段，" + want + "。只输出这个 JSON，不要解释。";
  var raw = await callChat(scfgOf(cfg), [{role: "user", content: prompt}], 0.9);
  var o = parseJsonObj(raw, "重随失败：AI 返回不是合法 JSON");
  var v = o.value;
  if(fieldKey === "name" || fieldKey === "hooks" || fieldKey === "items")
    return toStrArr(v).slice(0, 3);
  return str(v);
}

/* ================= P1: 出戏值 ================= */
var OOC_WORDS = [
  "手机", "电脑", "平板", "电话", "短信", "充电", "电池", "屏幕", "鼠标", "键盘",
  "网络", "WiFi", "微信", "QQ", "微博", "抖音", "快手", "朋友圈", "点赞", "转发",
  "直播", "弹幕", "网红", "主播", "带货", "打赏",
  "外卖", "快递", "网购", "淘宝", "京东", "美团", "饿了么", "滴滴", "扫码", "二维码",
  "支付宝", "银行卡", "ATM",
  "飞机", "火车", "高铁", "地铁", "汽车", "电动车", "出租车", "公交车", "登机牌",
  "电灯", "空调", "电梯", "冰箱", "洗衣机", "微波炉",
  "超市", "商场", "便利店", "红绿灯", "斑马线",
  "水泥", "钢筋", "口罩", "核酸", "疫苗", "健康码",
  "咖啡", "奶茶", "汉堡", "可乐", "电影", "电视剧",
  "热搜", "吃瓜", "追星", "应援", "选秀", "出道", "演唱会", "周边", "抢票", "退票", "改签",
  "护照", "签证", "留学", "移民",
  "奥运会", "世界杯", "NBA", "电竞",
  "无人机", "机器人", "人工智能", "编程", "代码", "服务器", "新能源",
  "特斯拉", "华为", "小米", "安卓",
  "王者荣耀", "英雄联盟", "原神", "宝可梦", "马里奥",
  "火影忍者", "海贼王", "名侦探柯南", "鬼灭之刃", "假面骑士", "数码宝贝", "游戏王",
  "奥特曼", "迪迦", "高达",
];
/* 纯函数：返回文本中命中的现代词数组（按词表顺序，去重） */
function detectOoc(text){
  var s = String(text || ""), hits = [];
  OOC_WORDS.forEach(function(w){ if(s.indexOf(w) >= 0) hits.push(w); });
  return hits;
}
/* 出戏值累加：state.ooc = clamp(0..100, 原值 + 命中词数*15)；同步写入 state.flags.ooc。
 * ooc>=80 时 triggered=true（触发特殊事件标记）。返回 {state, hits, triggered}。 */
function addOoc(state, text){
  state = state || {};
  var hits = detectOoc(text);
  var ooc = Math.max(0, Math.min(100, (parseInt(state.ooc, 10) || 0) + hits.length * 15));
  state.ooc = ooc;
  state.flags = state.flags || {};
  state.flags.ooc = ooc;
  return {state: state, hits: hits, triggered: ooc >= 80};
}

/* ================= P1: 角色卡世界补完 ================= */
/* 纯函数：从 RP_CARDIMPORT 卡对象抽世界设定种子文本 */
function extractSeed(card){
  card = card || {};
  var parts = [];
  if(card.name) parts.push("主角：" + card.name);
  if(card.scenario) parts.push("世界设定：" + card.scenario);
  var raw = card.raw || {};
  if(raw.description) parts.push("人物描述：" + String(raw.description).slice(0, 400));
  if(raw.personality) parts.push("人物性格：" + String(raw.personality).slice(0, 200));
  var book = raw.character_book || {};
  (book.entries || []).forEach(function(e){
    if(e && e.content) parts.push("世界书·" + (e.name || "条目") + "：" + String(e.content).slice(0, 300));
  });
  var f = card.fields || {};
  if(f.core_identity && !raw.description) parts.push("主角设定：" + String(f.core_identity).slice(0, 200));
  return parts.join("\n");
}
/* 纯函数：解析 AI 返回的世界 Bible JSON，并按字段标注来源（原文 / AI补完）。可单独测试。 */
function parseWorldBible(raw, seedText){
  var o = parseJsonObj(raw, "世界补完失败：AI 返回不是合法 JSON");
  seedText = String(seedText || "").replace(/\s+/g, "");
  function srcOf(val){
    var texts = (Array.isArray(val)? val: [val]).filter(function(x){ return str(x); }).map(function(x){ return String(x); });
    if(!texts.length) return "AI补完";
    var hit = 0;
    texts.forEach(function(x){
      var norm = x.replace(/\s+/g, "");
      var found = false;
      [10, 8, 6].forEach(function(n){
        if(!found && norm.length >= n && seedText.indexOf(norm.slice(0, n)) >= 0) found = true;
      });
      if(found) hit++;
    });
    return hit >= Math.ceil(texts.length / 2)? "原文": "AI补完";
  }
  var bg = str(o.bg);
  var places = toStrArr(o.places).slice(0, 6);
  var factions = toStrArr(o.factions).slice(0, 4);
  var customs = toStrArr(o.customs).slice(0, 5);
  var anchors = toStrArr(o.anchors).slice(0, 5);
  while(anchors.length < 3) anchors.push("（待补完）");
  return {
    bg: bg, places: places, factions: factions, customs: customs, anchors: anchors,
    sources: {
      bg: srcOf(bg), places: srcOf(places), factions: srcOf(factions),
      customs: srcOf(customs), anchors: srcOf(anchors),
    },
  };
}
/* AI 补完角色卡世界：从 scenario/description/character_book 提取种子，补完为世界 Bible */
async function genWorldBible(card, cfg, callChat){
  var seed = extractSeed(card);
  var prompt = "你是世界观补完助手。根据以下角色卡设定种子，补完该世界的世界观 Bible，" +
    "只输出一个 JSON 对象，不要解释：\n" + seed +
    "\nJSON 格式：{\"bg\":\"世界背景总述（3-5句）\"," +
    "\"places\":[\"地点名：一句话描述\",3-6个]," +
    "\"factions\":[\"势力/组织：一句话\",2-4个]," +
    "\"customs\":[\"风俗/规则\",3-5条]," +
    "\"anchors\":[\"剧情锚点标题\",3-5个]}。\n" +
    "要求：优先沿用种子原文的设定；种子没写的再合理补完，不要与种子矛盾。";
  var raw = await callChat(scfgOf(cfg), [{role: "user", content: prompt}], 0.7);
  return parseWorldBible(raw, seed);
}

/* ================= P2: 异世界框架 ================= */
var WORLD_REGISTRY = {};
function registerWorld(def){
  if(!def || !def.key) throw new Error("registerWorld: 需要 key");
  WORLD_REGISTRY[def.key] = {
    key: def.key, kind: def.kind || "book",
    title: def.title || def.key, status: def.status || "pending", note: def.note || "",
  };
  return WORLD_REGISTRY[def.key];
}
function listWorlds(){
  return Object.keys(WORLD_REGISTRY).map(function(k){ return WORLD_REGISTRY[k]; });
}
function getWorld(key){ return WORLD_REGISTRY[key] || null; }

/* 内置注册：红楼（ready） */
registerWorld({key: "honglou", kind: "book", title: "红楼梦", status: "ready",
  note: "红楼梦蒸馏管线产物（profile/plot）已落地，可直接接入"});
/* 水浒接入点：蒸馏管线（profile/plot）落地后，在此处把 status 改为 ready 并补 runId 等接入信息；
 * 在此之前严禁预置任何水浒人物/剧情内容。 */
registerWorld({key: "shuihu", kind: "book", title: "水浒传", status: "pending",
  note: "水浒蒸馏管线运行中，profile/plot 落地后接入，此处不预置任何人物剧情"});

/* 异世界穿越会话：复用 nd_trav_ 前缀与 RP_TRAVERSE.save（若存在） */
function isekaiSession(o){
  o = o || {};
  var s = {
    id: "t" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    mode: "isekai",
    srcKind: o.srcKind || "", srcId: o.srcId || "", srcName: o.srcName || "",
    dstKey: o.dstKey || "", dstKind: o.dstKind || "", dstId: o.dstId || "",
    fusion: (o.fusion === "reborn")? "reborn": "outsider",
    charName: o.charName || "",
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  if(typeof RP_TRAVERSE !== "undefined" && RP_TRAVERSE && RP_TRAVERSE.save){
    RP_TRAVERSE.save(s);
  } else {
    lsSet("nd_trav_" + s.id, JSON.stringify(s));
  }
  return s;
}
/* 异世界 prompt 增补段：融合方式 outsider/reborn 文案不同；目标 pending 时加"不要编造"约束 */
function isekaiPrompt(trav, worldDef){
  trav = trav || {}; worldDef = worldDef || {};
  var dstName = worldDef.title? "《" + worldDef.title + "》": (trav.dstKey || "目标世界");
  var lines = ["「异世界穿越」"];
  lines.push("源头：" + (trav.srcName || "原世界") + " → 目标：" + dstName);
  if(trav.fusion === "reborn"){
    lines.push("融合方式：转生。AI 在目标世界为你安排一个合理的新身份（出身、年龄、处境自洽），" +
      "你保留原世界的性格与记忆；言行举止必须符合新身份的见识与能力。");
  } else {
    lines.push("融合方式：异乡人。你完整保留原来的身份、记忆与能力；" +
      "目标世界的人视你为来历不明的异人，按该世界的逻辑对你做出真实反应。");
  }
  if(worldDef.status === "pending"){
    lines.push("重要约束：目标世界资料尚未接入，不要编造目标世界的具体人物剧情，" +
      "用开放式异世界推进——聚焦玩家当下的处境、遭遇与选择。");
  }
  lines.push("绝不替玩家说话、行动或做决定；绝不写玩家的心理活动。");
  return lines.join("\n");
}

/* ================= P3: 组团穿越 ================= */
/* 降级点名检测：全名命中，或去姓简称（≥2字且不重名）——与 RP_GROUP.findMentioned 同语义 */
function fallbackMentioned(userText, members){
  var out = [];
  if(!userText) return out;
  members.forEach(function(m){ if(userText.indexOf(m) >= 0) out.push(m); });
  if(out.length) return out;
  members.forEach(function(m, i){
    var short = m.length > 1 ? m.slice(1) : m;
    if(short.length < 2) return;
    if(userText.indexOf(short) < 0) return;
    var clash = members.some(function(x, j){ return j !== i && x.slice(1).indexOf(short) >= 0; });
    if(!clash) out.push(m);
  });
  return out;
}
function fallbackPlan(userText, members, talkMap, lastSpeaker, maxN){
  var speakers = fallbackMentioned(userText, members).slice(0, maxN);
  var i, m, t;
  for(i = 0; i < members.length && speakers.length < maxN; i++){
    m = members[i];
    if(speakers.indexOf(m) >= 0) continue;
    t = talkMap[m];
    t = (t == null)? 50: Math.max(0, Math.min(100, t));
    if(Math.random() * 100 < t) speakers.push(m);
  }
  if(!speakers.length){
    var pool = members.filter(function(x){ return x !== lastSpeaker; });
    if(!pool.length) pool = members.slice();
    if(pool.length) speakers.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return speakers;
}
/* 组团发言调度：companions=[{name, talk}]，talk 缺省 50；maxSpeakers 默认 3。
 * 有 RP_GROUP 时复用其 planSpeakers，否则用 talkativeness 简易 roll 点降级。返回发言人名字数组。 */
function planParty(userText, companions, lastSpeaker, opts){
  opts = opts || {};
  companions = companions || [];
  var names = companions.map(function(c){ return c.name; });
  var talkMap = {};
  companions.forEach(function(c){ talkMap[c.name] = (c.talk == null)? 50: c.talk; });
  var maxN = opts.maxSpeakers || 3;
  if(typeof RP_GROUP !== "undefined" && RP_GROUP && RP_GROUP.planSpeakers){
    return RP_GROUP.planSpeakers(userText, names, talkMap, lastSpeaker, {maxSpeakers: maxN});
  }
  return fallbackPlan(userText, names, talkMap, lastSpeaker, maxN);
}
/* 组团 prompt 增补段 */
function partyPrompt(trav){
  trav = trav || {};
  return "「组团穿越」\n" +
    "1. 队友是独立角色：按各自人设自主发言、行动，互相拌嘴、互相照应，像真正的同伴。\n" +
    "2. 玩家可以直接点名指挥某位队友（如「宝钗你去看看」），被点名的队友优先响应。\n" +
    "3. 绝不替玩家说话、行动或做决定；绝不写玩家的心理活动。\n" +
    "4. 队友不知道自己是 NPC，对世界的变化按自身逻辑做出真实反应。";
}
/* 小队：nd_travparty_<travId>，JSON 数组 [{name, runId, cardId}]，上限 3 个队友 */
var PARTY_PRE = "nd_travparty_";
function getCompanions(travId){
  try { return JSON.parse(lsGet(PARTY_PRE + travId)) || []; }
  catch(e){ return []; }
}
function addCompanion(travId, cardRef){
  cardRef = cardRef || {};
  var list = getCompanions(travId);
  var dup = list.some(function(c){ return c.name === cardRef.name; });
  if(dup) return {ok: true, dup: true, list: list};
  if(list.length >= 3) return {ok: false, reason: "小队已满（上限3人）", list: list};
  list.push({name: cardRef.name || "", runId: cardRef.runId || "", cardId: cardRef.cardId || "",
    talk: (cardRef.talk == null ? 50 : cardRef.talk)});
  lsSet(PARTY_PRE + travId, JSON.stringify(list));
  return {ok: true, list: list};
}
function removeCompanion(travId, name){
  var list = getCompanions(travId).filter(function(c){ return c.name !== name; });
  lsSet(PARTY_PRE + travId, JSON.stringify(list));
  return list;
}

return {
  /* P1 */
  IDENT_FIELDS: IDENT_FIELDS,
  MODERN_ITEMS: MODERN_ITEMS, cloneItems: cloneItems, useItem: useItem,
  genIdentityFull: genIdentityFull, rerollField: rerollField,
  OOC_WORDS: OOC_WORDS, detectOoc: detectOoc, addOoc: addOoc,
  extractSeed: extractSeed, parseWorldBible: parseWorldBible, genWorldBible: genWorldBible,
  /* P2 */
  registerWorld: registerWorld, listWorlds: listWorlds, getWorld: getWorld,
  isekaiSession: isekaiSession, isekaiPrompt: isekaiPrompt,
  /* P3 */
  planParty: planParty, partyPrompt: partyPrompt,
  addCompanion: addCompanion, removeCompanion: removeCompanion, getCompanions: getCompanions,
};
})();
