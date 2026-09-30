/* RP 引擎 v2: token-budget-first 分段组装 (对标 SillyTavern / RisuAI / Prompt Poet)
 *
 * 预算公式: maxContext − response − priming
 * 永久段(人设/示例/记忆/lore)按 priority 先占预算, 历史从新到旧填剩余。
 * 纠偏指令放在历史之后、生成端之前 (post-history), 不在 system 开头。
 * token 估算: 1 汉字 ≈ 1.6 token, 1 英文词 ≈ 1.3 token (移动端无 tokenizer 的可接受降级)。
 */
const RP_PROMPT = (function(){
"use strict";

var LABELS = {
  core_identity:"身份", gender:"性别", age_stage:"年龄段",
  soul_goal:"自觉目标", hidden_desire:"隐秘欲望", inner_need:"深层需求",
  core_traits:"性格", temperament_type:"气质", values:"价值观",
  moral_bottom_line:"道德底线", moral_position:"善恶定位",
  fatal_flaw:"致命缺陷", pressure_truth:"极限下的真相",
  shadow_side:"阴影面", big_five:"大五人格", ooc_redline:"绝不做的事",
  speech_style:"说话风格", cadence:"语速节奏",
  signature_phrases:"口头禅", typical_lines:"典型台词",
  subtext_style:"潜台词", sentence_openers:"常用开头",
  forbidden_fillers:"禁用口癖",
  life_timeline:"生平", social_soil:"出身", socio_economics:"经济/教育/信仰",
  key_bonds:"关键羁绊", faction_position:"阵营立场",
  visual_identity:"视觉识别", voice_dressing:"声音着装",
  appearance_feature:"外貌", physical_marks:"身体印记",
  signature_items:"随身物品", reputation:"外界评价",
  action_pattern:"行动模式", stress_response:"压力反应",
  fear_triggers:"恐惧触发", taboo_topics:"禁忌话题",
};

var LAYERS = {
  identity: ["core_identity","gender","age_stage"],
  core: ["soul_goal","hidden_desire","inner_need","core_traits","temperament_type",
    "values","moral_bottom_line","moral_position","fatal_flaw","pressure_truth",
    "shadow_side","big_five","ooc_redline"],
  speech: ["speech_style","cadence","signature_phrases","typical_lines",
    "subtext_style","sentence_openers","forbidden_fillers"],
  background: ["life_timeline","social_soil","socio_economics","key_bonds",
    "faction_position","visual_identity","voice_dressing","appearance_feature",
    "physical_marks","signature_items","reputation","action_pattern",
    "stress_response","fear_triggers","taboo_topics"],
};

function val(f){
  if(f == null) return "";
  if(typeof f === "string") return f.trim();
  /* 纯数组字段(typical_lines 等在各处都存成数组): 逐行拼, 以前这里直接吞成空字符串 */
  if(Array.isArray(f)){
    return f.map(function(it){ return String(it == null ? "" : it).trim(); })
      .filter(function(it){ return it; }).join("\n").trim();
  }
  var parts = [];
  if(f.v) parts.push(String(f.v).trim());
  (f.items || []).forEach(function(it){
    it = String(it).trim();
    if(it) parts.push("· " + it);
  });
  return parts.join("\n").trim();
}

function estTokens(s){
  s = String(s || "");
  var zh = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  var en = (s.match(/[A-Za-z]+/g) || []).length;
  var rest = Math.max(0, s.length - zh - en * 4);
  return Math.ceil(zh * 1.6 + en * 1.3 + rest * 0.5);
}

function renderFields(card, names){
  var out = [];
  names.forEach(function(n){
    var v = val(card.fields[n]);
    if(v) out.push("- " + (LABELS[n] || n) + "：" + v);
  });
  return out.join("\n");
}

function itemsOf(card, name){
  var f = card.fields[name];
  if(!f) return [];
  if(typeof f === "string") return f ? [f] : [];
  /* 纯数组字段直接取用(同 val) */
  if(Array.isArray(f)){
    return f.map(function(it){ return String(it == null ? "" : it).trim(); })
      .filter(function(it){ return it; });
  }
  var out = [];
  if(f.v) out.push(f.v);
  (f.items || []).forEach(function(i){ if(i) out.push(i); });
  return out;
}

/* P0-4: few-shot 对话示例, 从 typical_lines 生成; P1-2: 卡片自带 example_dialogue 追加拼入 */
function buildExamples(card, name, budgetTokens){
  var lines = itemsOf(card, "typical_lines").slice(0, 3);
  var extra = String((card && card.exampleDialogue) || "").trim();
  if(!lines.length && !extra) return "";
  var openers = [
    "在园子里迎面碰见你，你会说什么？",
    "有人惹你不痛快了，你会说什么？",
    "夜深了，你独自一人时喃喃说什么？",
  ];
  var parts = ["【对话示例（学她的语气，不要复读句子）】"];
  var used = estTokens(parts[0]);
  for(var i = 0; i < lines.length; i++){
    var blk = "用户：" + openers[i % openers.length] + "\n" + name + "：" + lines[i].slice(0, 120);
    var t = estTokens(blk);
    if(used + t > budgetTokens) break;
    parts.push(blk);
    used += t;
  }
  if(extra){
    var xt = estTokens(extra);
    if(used + xt <= budgetTokens) parts.push("【卡片自带对话示例】\n" + extra.slice(0, 800));
  }
  return parts.length > 1 ? parts.join("\n") : "";
}

/* P0-4 lorebook: Janitor 式完整 schema, 逻辑在 RP_LOREBOOK (www/rp/lorebook.js)。
 * RP_LOREBOOK 存在时委托它 (probability/minMessages/互斥组/四值逻辑/RegEx/depth);
 * 不存在时 (如只加载 prompt.js 的旧单测) 走下面的老逻辑兜底。 */
/* 返回命中的世界书条目 (已按 priority 排序, 小的在前)。抽出来供"触发可视化"复用。 */
function normEntry(e){
  return {
    title: e.title || "",
    text: e.rules || e.content || "",
    keys: e.trigger_keywords || [],
    priority: e.priority != null ? e.priority : 50,
    budget: e.budget != null ? e.budget : 300,
    constant: !!e.constant,
    scan_depth: e.scan_depth != null ? e.scan_depth : 2,
    selective: e.selective || null,
  };
}
function matchLoreLegacy(worldbook, recentText){
  if(!worldbook || !worldbook.length) return [];
  var wb = (Array.isArray(worldbook) ? worldbook : [worldbook]).map(normEntry);
  function hit(e){
    if(e.constant) return true;
    var keys = e.keys || [];
    var primary = e.selective && e.selective.primary ? e.selective.primary : keys;
    var pHit = primary.some(function(k){ return recentText.indexOf(k) >= 0; });
    if(!pHit) return false;
    if(e.selective && e.selective.secondary){
      var sHit = e.selective.secondary.some(function(k){ return recentText.indexOf(k) >= 0; });
      var logic = e.selective.logic || "and";
      return logic === "or" ? true : sHit;
    }
    return keys.some(function(k){ return recentText.indexOf(k) >= 0; }) || e.constant;
  }
  return wb.filter(hit).sort(function(a, b){ return b.priority - a.priority; });
}
function matchLore(worldbook, recentText, msgCount){
  if(typeof RP_LOREBOOK !== "undefined"){
    return RP_LOREBOOK.match(worldbook, recentText, msgCount).map(function(e){
      return {title: e.name, text: e.content, keys: e.key, priority: e.priority,
        probability: e.probability, constant: e.constant, placement: e.placement,
        placementPosition: e.placementPosition, inclusionGroup: e.inclusionGroup,
        groupWeight: e.groupWeight, minMessages: e.minMessages,
        selectiveLogic: e.selectiveLogic, name: e.name, content: e.content};
    });
  }
  return matchLoreLegacy(worldbook, recentText);
}
var LORE_MAX_HITS = 8;  /* 单次注入上限: 按 priority 取前 N, 避免触发泛滥 */
/* textOrMessages: 字符串(老调用) 或消息数组(支持条目级 depth 扫描窗口)。
 * 返回 {text, hits:[标题...], hitDetails:[{title,probability,priority}...], placed:{段->文本}}。
 * hits 保持标题字符串数组 (老契约); Inspector 用 hitDetails 展示 probability/priority。 */
function buildLoreLegacy(worldbook, recentText, budgetTokens){
  var sel = matchLoreLegacy(worldbook, recentText);
  var lines = [], hits = [], used = 0;
  for(var i = 0; i < sel.length && hits.length < LORE_MAX_HITS; i++){
    var e = sel[i];
    var t = "《" + e.title + "》：" + e.text;
    var need = Math.min(estTokens(t), e.budget);
    if(used + need > budgetTokens) continue;
    lines.push("- " + t);
    hits.push(e.title || "");
    used += need;
  }
  return {text: lines.join("\n"), hits: hits};
}
function buildLore(worldbook, textOrMessages, budgetTokens, msgCount){
  if(typeof RP_LOREBOOK !== "undefined"){
    var res = RP_LOREBOOK.build(worldbook, textOrMessages, budgetTokens, msgCount, estTokens);
    return {text: res.text, placed: res.placed,
      hits: res.hits.map(function(h){ return h.title; }), hitDetails: res.hits};
  }
  var rt = Array.isArray(textOrMessages)
    ? textOrMessages.slice(-4).map(function(m){ return m.content; }).join("\n")
    : textOrMessages;
  return buildLoreLegacy(worldbook, rt, budgetTokens);
}
/* placed 世界书拼到对应 prompt 段 (personality->core, scenario->background, exampleDialogs->examples) */
function lorePlacedText(loreRes, anchor){
  if(!loreRes || !loreRes.placed || !loreRes.placed[anchor]) return "";
  return "\n" + loreRes.placed[anchor];
}

function pickRelations(relations, name){
  if(!relations || !relations.length) return "";
  return relations.filter(function(r){
    return r.source_character === name || r.target_character === name;
  }).slice(0, 5).map(function(r){
    var other = r.source_character === name ? r.target_character : r.source_character;
    return "- 与" + other + "：" + (r.relationship_summary || r.type || "");
  }).join("\n");
}

/* P0-3: post-history 纠偏指令 (视角/人称可配; 默认: 玩家主视角+第二人称) */
function postInstructions(name, pov, person){
  pov = pov || "player"; person = person || "second";
  var s = "【最后指令】你正在与玩家进行角色扮演对话。";
  if(pov === "char")
    s += "叙事以" + name + "为中心：深入描写" + name + "的所见所感、内心活动与行动，玩家是" + name + "故事中的互动对象。";
  else
    s += "叙事以玩家为中心：镜头跟随玩家，描写玩家视角下的所见所闻、所作所为；" + name + "通过对话、神态与行动来回应玩家，不要写大段" + name + "的内心独白喧宾夺主。";
  if(person === "first")
    s += "人称：第一人称，" + name + "以“我”自称进行叙事与对话；用“你”指代玩家。";
  else if(person === "third")
    s += "人称：第三人称叙事，以“" + name + "”或“他/她”指代" + name + "；用“你”指代玩家。";
  else
    s += "人称：第二人称叙事，以“你”指代玩家；" + name + "在对话中自称“我”出于说话需要，但叙事部分不要用“我”指代玩家——每条消息已有" + name + "的署名标识，不必反复自报家门，避免“我”泛滥出戏。";
  s += "绝不自称 AI/模型/程序，不替玩家说话或行动；不知道的事按人物见识反应，不用现代知识；回复简洁自然。";
  return s;
}

/* 叙事者模式: 主叙事(第二人称感官)+平行叙事(第三人称暗线)+角色主动推进剧情 */
var NARRATOR_INSTR = "【叙事者模式】你同时承担叙事与扮演双重任务：\n" +
"1. 主叙事：以第二人称（\"你\"）描写用户当前能通过感官感知到的剧情，用小说笔法推进；用户无法感知的事一律留白，不写。\n" +
"2. 平行叙事：对用户不知情、但正在发生的关键事件（如其他角色的行动、暗处的决定），用第三人称客观叙述，穿插在合适位置。\n" +
"3. 主动推进：即使用户没有明确指示，也要按角色设定让在场角色主动说话、行动，让剧情自己走下去，不要等用户推，不要原地打转。\n" +
"4. 方向：保持剧情张力，稳步向前推进；如有【当前剧情目标】，一切为它服务。";

/* P1-1 预设: 分段顺序/开关/预算比例可配置 (Risu 式预设, 不做 ST 拖拽) */
var PRESETS = {
  classic: {name: "经典序", desc: "完整人设，适合长上下文",
    order: {identity: 5, persona: 6, core: 10, arc: 15, memory: 20, speech: 30, examples: 40, background: 50, relations: 60, lore: 70},
    loreRatio: 0.2},
  lite: {name: "精简序", desc: "去背景/示例，省 token，适合小上下文",
    order: {identity: 5, persona: 6, core: 10, arc: 15, memory: 15, speech: 20, relations: 30, lore: 40},
    loreRatio: 0.12},
  immers: {name: "沉浸序", desc: "说话方式优先，代入感最强",
    order: {identity: 5, persona: 6, speech: 10, examples: 15, core: 20, arc: 22, memory: 25, background: 40, relations: 50, lore: 60},
    loreRatio: 0.15},
  narr: {name: "叙事者", desc: "双线叙事+角色主动推进剧情，适合跑剧情",
    order: {identity: 5, persona: 6, narrator: 8, core: 10, speech: 15, arc: 18, memory: 20, examples: 30, relations: 40, background: 50, lore: 60},
    loreRatio: 0.15},
};

/* 借鉴清单 Tier2 #15: 简洁回复开关 (Janitor "Snappier, more concise replies. Leave off for longer responses.")。
 * ctx.concise 为真时 system 追加本指令; max_tokens 由调用方调低。 */
var CONCISE_INSTR = "简洁回复：回答简短精炼，直奔主题，避免冗长铺垫；除非用户明确要求，否则不要写长段落，保持节奏轻快。";

/* 主入口: 返回 {messages, stats, preview} */
function buildMessages(card, ctx, budget){
  ctx = ctx || {};
  budget = budget || {};
  var maxCtx = budget.maxContext || 8192;
  var reserve = budget.response || 512;
  var priming = budget.priming || 200;
  var avail = Math.max(1024, maxCtx - reserve - priming);
  var name = card.name;

  var recentText = (ctx.history || []).slice(-4).map(function(m){ return m.content; }).join("\n");

  var preset = PRESETS[(budget && budget.preset) || "classic"] || PRESETS.classic;
  var P = preset.order;
  var perm = [];   // {kind, text, pri}
  function add(kind, text){ if(text && P[kind] != null) perm.push({kind: kind, text: text, pri: P[kind]}); }

  // lore 用独立预算; 传消息数组以支持条目级 depth 扫描窗口; 触发可视化只显示实际注入的条目
  var loreBudget = Math.min(900, Math.floor(avail * preset.loreRatio));
  var histForLore = ctx.history || [];
  var loreRes = buildLore(ctx.worldbook, histForLore, loreBudget, histForLore.length);
  var loreHitTitles = loreRes.hits;
  var loreHitDetails = loreRes.hitDetails || null;

  add("identity", "你是" + name + "，《" + (ctx.novel || "") + "》中的人物。");
  add("persona", ctx.persona ? "【玩家人设】\n" + ctx.persona : "");
  add("narrator", NARRATOR_INSTR);
  add("core", "【核心人设】\n" + renderFields(card, LAYERS.identity.concat(LAYERS.core))
    + lorePlacedText(loreRes, "core"));
  /* P0-1: memory 段走三池预算 (RP_MEM.renderBudgeted); 退化路径用 ctx.memory 纯文本 */
  var memBudget = (budget && budget.memBudget) || 1000;
  var memRes = null;
  if(ctx.memBudgeted && typeof RP_MEM !== "undefined" && RP_MEM.renderBudgeted){
    memRes = RP_MEM.renderBudgeted(ctx.memBudgeted.runId, ctx.memBudgeted.name,
      memBudget, {cardId: ctx.memBudgeted.cardId, novel: ctx.memBudgeted.novel,
        temporal: ctx.memBudgeted.temporal, query: ctx.memBudgeted.query,
        apex: ctx.memBudgeted.apex});
  }
  var memSeg = memRes ? memRes.text : (ctx.memory || "");
  var memTasks = ctx.memTasks || "";
  if(memSeg && memTasks) memSeg += "\n" + memTasks;
  else if(memTasks) memSeg = memTasks;
  add("memory", memSeg ? "【长期记忆】\n" + memSeg : "");
  /* P0-3: 人物弧光段 (当前 timeline_stage, 无弧光卡为空) */
  add("arc", ctx.arc ? "【人物弧光】\n" + ctx.arc : "");
  add("speech", "【说话方式】\n" + renderFields(card, LAYERS.speech));
  add("examples", buildExamples(card, name, 600) + lorePlacedText(loreRes, "examples"));
  add("background", "【背景】\n" + renderFields(card, LAYERS.background) + lorePlacedText(loreRes, "background"));
  var rel = pickRelations(ctx.relations, name);
  add("relations", rel ? "【人物关系】\n" + rel : "");
  add("lore", loreRes.text);

  perm.sort(function(a, b){ return a.pri - b.pri; });
  var sysParts = [], used = 0, dropped = [], segTokens = {};
  for(var i = 0; i < perm.length; i++){
    var sg = perm[i], t = estTokens(sg.text);
    if(used + t > avail){ dropped.push(sg.kind); continue; }
    sysParts.push(sg.text);
    used += t;
    segTokens[sg.kind] = t;  // P0-5: 各段 token 供 Prompt 诊断展示
  }

  var left = avail - used;
  var hist = [], hUsed = 0, hDropped = 0;
  var src = ctx.history || [];
  for(var j = src.length - 1; j >= 0; j--){
    var m = src[j];
    var mt = estTokens(m.content) + 6;
    if(hUsed + mt > left){ hDropped = j + 1; break; }
    hist.unshift({role: m.role, content: m.content});
    hUsed += mt;
  }

  var sysText = sysParts.join("\n\n");
  if(ctx.concise) sysText += "\n\n" + CONCISE_INSTR; /* #15 简洁回复指令 */
  var messages = [{role: "system", content: sysText}];
  for(var k = 0; k < hist.length; k++) messages.push(hist[k]);
  var post = postInstructions(name, ctx.pov, ctx.person);
  messages.push({role: "system", content: post});

  return {
    messages: messages,
    stats: {maxCtx: maxCtx, avail: avail, sysTokens: used, histTokens: hUsed,
            histKept: hist.length, histDropped: hDropped, droppedSegs: dropped,
            segTokens: segTokens, memPools: memRes ? memRes.pools : null,
            loreHits: loreHitTitles, loreHitDetails: loreHitDetails, preset: preset.name, concise: !!ctx.concise},
    preview: sysText + "\n\n" + post,
  };
}

return {
  buildMessages: buildMessages, postInstructions: postInstructions, PRESETS: PRESETS,
  estTokens: estTokens, renderFields: renderFields, LAYERS: LAYERS, matchLore: matchLore,
  buildLore: buildLore, LABELS: LABELS, buildExamples: buildExamples,
  CONCISE_INSTR: CONCISE_INSTR,
};
})();
