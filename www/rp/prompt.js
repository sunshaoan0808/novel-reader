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
  /* P0-3 人物弧光 (B17)。这张表是卡片编辑器(app.js editCard/saveCardEdit)唯一的字段清单,
     arc_* 不登记就等于"字段无法表示" —— 用户手填了保存时也会被丢弃。
     RP_ARC 只读 card.fields 的这几个键(timeline_stage 另有一条阶段覆盖存储)。
     刻意不进 LAYERS: renderFields 只渲染 LAYERS 里列的键, 弧光不重复进 prompt,
     注入由 RP_ARC.renderArcPrompt 单独负责(见本文件 add("arc", ...) 那一行)。 */
  arc_type:"弧光类型", arc_start:"弧光·起", arc_mid:"弧光·转",
  arc_end:"弧光·合", timeline_stage:"当前阶段",
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

/* ST 宏替换: {{char}}->角色名, {{user}}->玩家名(无则"你"); 大小写/空格容忍, 全局替换 */
function subMacros(text, charName, userName){
  var s = String(text == null ? "" : text);
  var cn = String(charName || "");
  var un = String(userName || "你");
  s = s.replace(/{{\s*char\s*\d*\s*}}/gi, cn);
  s = s.replace(/{{\s*user\s*}}/gi, un);
  return s;
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

/* 卡片示例文本的说话人标签归一化: 行首 {{user}}/{{char}} 直接换成"用户："/"<角色名>："。
 * 绝不能把 {{user}} 原样丢进 prompt——后面的 subMacros 会把它展开成"你", 而 system 开头
 * 就是"你是<角色名>", 于是"你："读起来就是模型自己在说话, 玩家的台词被算到角色头上。 */
function exampleLabels(text, name){
  return String(text == null ? "" : text)
    .replace(/^([ \t]*)\{\{\s*user\s*\}\}\s*[:：]/gim, "$1用户：")
    .replace(/^([ \t]*)\{\{\s*char\s*\}\}\s*[:：]/gim, "$1" + name + "：");
}

/* P0-4: few-shot 对话示例。优先用卡片 mes_example 的真实多轮结构 (exampleBlocks);
 * 旧卡(只有 typical_lines)退化为"台词示例", 不再配三个写死的假问题 (问答错位是实测确认的 bug)。
 *
 * 说话人标签是这一段的命门, 2026-10-15 连修三处(回归见 tests/test_imported_pronoun.js):
 *  1) 逐轮给标签。旧实现把一个 <START> 块里所有角色台词 join 成一串只挂一个"角色名：",
 *     轮次一多标签就落在错的句子上; 现在按 turns 原序逐条标注;
 *  2) 轮次顺序原样保留(exampleBlocks 侧修复, 旧解析按说话人分桶会把"角色先开口"的块重排成
 *     "角色在回答自己还没听到的话");
 *  3) 段头给图例, 钉死"用户"=玩家、"角色名"=角色, 免得与正文第二人称"你"抢指代。 */
function buildExamples(card, name, budgetTokens){
  var parts = ["【对话示例】「用户：」是玩家说的话，「" + name + "：」是" + name + "说的话；" +
               "按卡片原文的轮次展示，学语气，不要复读句子。"];
  var used = estTokens(parts[0]);
  function pushBlk(text){
    var t = estTokens(text);
    if(used + t > budgetTokens) return false;
    parts.push(text);
    used += t;
    return true;
  }
  var blocks = (card && card.exampleBlocks) || [];
  var i;
  for(i = 0; i < blocks.length && parts.length < 5; i++){
    var turns = (blocks[i] && blocks[i].turns) || [];
    var blk = turns.map(function(t){
      var txt = String((t && t.text) || "").trim();
      if(!txt) return "";
      return (t.who === "char" ? name : "用户") + "：" + txt.slice(0, t.who === "char" ? 300 : 200);
    }).filter(Boolean).join("\n");
    if(blk && !pushBlk(blk)) break;
  }
  if(parts.length === 1){
    /* 旧卡回退: typical_lines 是孤立台词, 不虚构用户问句 */
    var greet = String((card && card.greeting) || "").trim();
    var lines = itemsOf(card, "typical_lines").filter(function(l){
      return l && l !== greet && l.length <= 400;
    }).slice(0, 3);
    if(lines.length){
      var tl = name + "的台词示例：\n" + lines.map(function(l, ix){
        return (ix + 1) + ". " + l.slice(0, 120);
      }).join("\n");
      pushBlk(tl);
    }
  }
  /* 卡片自带示例对话: 原文照进(顺序天然正确), 只把说话人标签换成与上文同一套; 与 mes_example
     常是同一段, 同文去重 */
  var extra = String((card && card.exampleDialogue) || "").trim();
  if(extra){
    var labeled = exampleLabels(extra, name).slice(0, 800);
    if(labeled && parts.join("\n").indexOf(labeled) < 0){
      var xt = estTokens(labeled);
      if(used + xt <= budgetTokens) parts.push("【卡片自带对话示例】\n" + labeled);
    }
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
  s += "绝不自称 AI/模型/程序；不知道的事按人物见识反应，不用现代知识；回复简洁自然。";
  /* 玩家行动铁律 (ST/RisuAI jailbreak 写法借鉴: 具体、可执行, 点名身体动作/心理活动/代做决定,
   * 而不是空泛的"不要替玩家行动"。实测曾漏过"接过你手里的汽水瓶"这类, 故逐条点名) */
  s += "【玩家行动铁律】1. 玩家的身体只属于玩家：绝不描写玩家的任何身体动作（如点头、摇头、伸手、转身、坐下、接过东西）；" +
    "2. 绝不写玩家的心理活动、想法、情绪与感受；" +
    "3. 绝不替玩家做决定、绝不替玩家回答 NPC 的问题——玩家没说出口的话，一个字都不许替他说。违反任何一条即 OOC。";
  return s;
}

/* 叙事者模式: 主叙事(第二人称感官)+平行叙事(第三人称暗线)+角色主动推进剧情。
 * 人称约定写在最前: 旧版第一句"你同时承担..."里的"你"指模型, 第二句"以第二人称(你)描写用户"
 * 里的"你"指玩家, 同一个词隔一行换一次指代, 模型只能靠猜——这正是导入卡聊天里我/你翻转的
 * 另一半来源(另一半是 few-shot 的说话人标签, 见 buildExamples)。 */
var NARRATOR_INSTR = "【叙事者模式】你同时承担叙事与扮演双重任务。\n" +
"人称约定(先读这条)：本指令里凡是直接称呼叙事者的“你”, 都指你自己；下面说的叙事第二人称“你”, 指玩家本人。两处含义不同, 不要混用。\n" +
"1. 主叙事：叙事部分一律用第二人称“你”指代玩家, 写玩家能通过感官感知到的剧情, 用小说笔法推进；玩家无法感知的事一律留白, 不写。叙事里绝不出现玩家的第一人称“我”。\n" +
"2. 平行叙事：对玩家不知情、但正在发生的关键事件（如其他角色的行动、暗处的决定），用第三人称客观叙述，穿插在合适位置。\n" +
"3. 角色台词：角色开口时自称“我”, 称呼玩家用“你”；无论叙事还是台词, “你”永远是玩家, 角色永远用“我”或自己的名字自称。\n" +
"4. 主动推进：即使用户没有明确指示，也要按角色设定让在场角色主动说话、行动，让剧情自己走下去，不要等用户推，不要原地打转。\n" +
"5. 方向：保持剧情张力，稳步向前推进；如有【当前剧情目标】，一切为它服务。";

/* P1-1 预设: 分段顺序/开关/预算比例可配置 (Risu 式预设, 不做 ST 拖拽) */
var PRESETS = {
  classic: {name: "经典序", desc: "完整人设，适合长上下文",
    order: {identity: 5, scene: 5.5, persona: 6, sysprompt: 7, ooc: 9, tags: 8, core: 10, arc: 15, memory: 20, speech: 30, flair: 35, examples: 40, background: 50, relations: 60, lore: 70},
    loreRatio: 0.2},
  lite: {name: "精简序", desc: "去背景/示例，省 token，适合小上下文",
    order: {identity: 5, scene: 5.5, persona: 6, sysprompt: 7, ooc: 9, tags: 8, core: 10, arc: 15, memory: 15, speech: 20, flair: 35, relations: 30, lore: 40},
    loreRatio: 0.12},
  immers: {name: "沉浸序", desc: "说话方式优先，代入感最强",
    order: {identity: 5, scene: 5.5, persona: 6, sysprompt: 7, ooc: 9, tags: 8, speech: 10, flair: 35, examples: 15, core: 20, arc: 22, memory: 25, background: 40, relations: 50, lore: 60},
    loreRatio: 0.15},
  narr: {name: "叙事者", desc: "双线叙事+角色主动推进剧情，适合跑剧情",
    order: {identity: 5, scene: 5.5, persona: 6, sysprompt: 7, ooc: 9, tags: 8, narrator: 8, core: 10, speech: 15, flair: 35, arc: 18, memory: 20, examples: 30, relations: 40, background: 50, lore: 60},
    loreRatio: 0.15},
};

/* S-5 按卡文风档 (对标 Kindroid llm_flair): companion / roleplay / narrative / classic / minimal。
 * 角色级选项, 不是全局预设。 */
var FLAIR = {
  companion: {name: "陪伴", desc: "像亲密朋友聊天",
    instr: "【文风·陪伴】像亲密朋友聊天：温暖、主动关心，生活气息浓；多倾听多回应，不过度戏剧化，不写大段独白。"},
  roleplay: {name: "扮演", desc: "强代入角色扮演",
    instr: "【文风·扮演】强代入角色扮演：神态、动作、语气都贴紧角色，允许适度的舞台化描写，让角色活起来。"},
  narrative: {name: "叙事", desc: "小说笔法",
    instr: "【文风·叙事】小说笔法：环境、心理、暗线并重，节奏舒缓，描写占比高，对话点到为止。"},
  classic: {name: "经典", desc: "默认均衡",
    instr: "【文风·经典】默认均衡：对话与叙事自然交织，不刻意偏向任何一端。"},
  minimal: {name: "极简", desc: "短句克制",
    instr: "【文风·极简】短句为主，克制留白：不解释、不铺垫、不总结，让对话自己往前走。"},
};
function flairInstr(f){
  var k = String(f || "").trim().toLowerCase();
  return (FLAIR[k] && FLAIR[k].instr) || "";
}

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
  /* v37: ST 预设模式。budget.stPreset 为解析后的预设对象时, 走预设顺序组装,
   * marker 替换为 App 侧对应分段, 否则走经典单 system 组装。 */
  var stP = (budget && budget.stPreset && Array.isArray(budget.stPreset.prompts) &&
    typeof RP_PRESET !== "undefined") ? budget.stPreset : null;

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
  /* S-7 高权重场景: 160 字符内，identity 段之后置顶注入 */
  var sceneSeg = String(ctx.sceneText || "").trim().slice(0, 160);
  add("scene", sceneSeg ? "【当前场景（高权重）】\n" + sceneSeg : "");
  add("persona", ctx.persona ? "【玩家人设】\n" + ctx.persona : "");
  /* P0 卡兼容: 卡片 system_prompt / creator_notes 进 system (以前被静默丢弃) */
  var sysPromptSeg = "";
  if(card.systemPrompt) sysPromptSeg += String(card.systemPrompt).trim();
  if(card.creatorNotes) sysPromptSeg += (sysPromptSeg ? "\n" : "") + "【作者注】\n" + String(card.creatorNotes).trim();
  /* 2026-10-07: 管线反 OOC 纠错 (probe→judge→correction), 高优先级注入。
   * card.oocCorrections 由 findCard 从 run.corrections 按人物名过滤挂载。 */
  var oocSeg = "";
  var oocs = (card && card.oocCorrections) || [];
  if(oocs.length){
    oocSeg = "【OOC 纠错（最高优先级，严格遵守）】\n" + oocs.map(function(c, i){
      return (i + 1) + ". " + String((c && c.prompt_injection_rule) || "").trim();
    }).filter(function(s){ return s.replace(/^\d+\.\s*/, ""); }).join("\n");
  }
  add("ooc", oocSeg);
  add("sysprompt", sysPromptSeg);
  /* S-9 行为标签 (对标 PolyBuzz #tsundere): 轻量行为调参, 比写整段 prompt 门槛低 */
  var tagList = (card.tags || []).map(function(t){ return String(t == null ? "" : t).trim(); }).filter(Boolean).slice(0, 12);
  add("tags", tagList.length ? "【行为标签】" + tagList.join("、") : "");
  /* S-5 按卡文风档 */
  add("flair", flairInstr(card.flair));
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
  add("memory", memSeg ? "【长期记忆】\n" + memSeg + "\n(约束：引用记忆时只能用上面列出的内容，不得编造未提及的往事细节。)" : "");
  /* P0-3: 人物弧光段 (当前 timeline_stage, 无弧光卡为空) */
  add("arc", ctx.arc ? "【人物弧光】\n" + ctx.arc : "");
  add("speech", "【说话方式】\n" + renderFields(card, LAYERS.speech));
  add("examples", buildExamples(card, name, 600) + lorePlacedText(loreRes, "examples"));
  add("background", "【背景】\n" + renderFields(card, LAYERS.background) +
    (card.scenario ? "\n世界设定：" + String(card.scenario).trim() : "") + lorePlacedText(loreRes, "background"));
  var rel = pickRelations(ctx.relations, name);
  add("relations", rel ? "【人物关系】\n" + rel + "\n(约束：不得编造上面未列出的人物关系。)" : "");
  add("lore", loreRes.text ? loreRes.text + "\n(约束：世界书只作为背景参考，不得编造书中未记载的设定细节。)" : "");

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
  var messages, sysText, post;
  var stDropped = [], stName = null;
  if(stP){
    /* ---- ST 预设组装 ---- */
    stName = stP.name;
    var parts = {
      persona: ctx.persona ? "【玩家人设】\n" + ctx.persona : "",
      charDesc: ["你是" + name + "，《" + (ctx.novel || "") + "》中的人物。",
        "【核心人设】\n" + renderFields(card, LAYERS.identity.concat(LAYERS.core)) + lorePlacedText(loreRes, "core"),
        memSeg ? "【长期记忆】\n" + memSeg : "",
        ctx.arc ? "【人物弧光】\n" + ctx.arc : "",
        rel ? "【人物关系】\n" + rel : ""].filter(Boolean).join("\n\n"),
      charPers: [NARRATOR_INSTR, "【说话方式】\n" + renderFields(card, LAYERS.speech)].filter(Boolean).join("\n\n"),
      scenario: "【背景】\n" + renderFields(card, LAYERS.background) +
        (card.scenario ? "\n世界设定：" + String(card.scenario).trim() : "") + lorePlacedText(loreRes, "background"),
      examples: buildExamples(card, name, 600) + lorePlacedText(loreRes, "examples"),
      loreBefore: "",
      lore: loreRes.text || "",
      history: [],
      charName: name, userName: ctx.personaName
    };
    /* 预设自身超预算: 从前向后丢非 marker 的 system 条目(保结尾 jailbreak/prefill) */
    var pList = stP.prompts.slice();
    var pUsed = (typeof RP_PRESET.sysTokens === "function") ? RP_PRESET.sysTokens({prompts: pList}, parts) : 0;
    var guard = 0;
    while(pUsed > avail && guard++ < 200){
      var di = -1;
      for(var qi = 0; qi < pList.length; qi++)
        if(!pList[qi].marker && pList[qi].role === "system"){ di = qi; break; }
      if(di < 0) break;
      stDropped.push(pList[di].name);
      pList.splice(di, 1);
      pUsed = RP_PRESET.sysTokens({prompts: pList}, parts);
    }
    used = pUsed;
    left = avail - used;
    for(var j = src.length - 1; j >= 0; j--){
      var m = src[j];
      var mt = estTokens(m.content) + 6;
      if(hUsed + mt > left){ hDropped = j + 1; break; }
      hist.unshift({role: m.role, content: m.content});
      hUsed += mt;
    }
    parts.history = hist;
    messages = RP_PRESET.assemble({prompts: pList}, parts);
    if(ctx.concise){ /* 简洁指令并入首条 system */
      for(var ci = 0; ci < messages.length; ci++)
        if(messages[ci].role === "system"){ messages[ci].content += "\n\n" + CONCISE_INSTR; break; }
    }
    sysText = messages.map(function(mm){ return "[" + mm.role + "]\n" + mm.content; }).join("\n\n");
    post = "";
  }else{
  for(var j2 = src.length - 1; j2 >= 0; j2--){
    var m2 = src[j2];
    var mt2 = estTokens(m2.content) + 6;
    if(hUsed + mt2 > left){ hDropped = j2 + 1; break; }
    hist.unshift({role: m2.role, content: m2.content});
    hUsed += mt2;
  }

  sysText = sysParts.join("\n\n");
  /* ST 宏全局替换(酒馆卡 description/personality 常带 {{char}}/{{user}}, 不替换模型看到字面宏) */
  sysText = subMacros(sysText, name, ctx.personaName);
  if(ctx.concise) sysText += "\n\n" + CONCISE_INSTR; /* #15 简洁回复指令 */
  messages = [{role: "system", content: sysText}];
  for(var k = 0; k < hist.length; k++) messages.push(hist[k]);
  post = postInstructions(name, ctx.pov, ctx.person);
  /* P0 卡兼容: 卡片 post_history_instructions 拼到 post-history 位置 (ST 语义: 历史之后、生成之前) */
  if(card.postHistoryInstructions) post += "\n" + String(card.postHistoryInstructions).trim();
  post = subMacros(post, name, ctx.personaName);
  messages.push({role: "system", content: post});
  /* P0 卡兼容 v3: depth_prompt 按 depth 插到历史中 (ST 语义: 距末尾 depth 条消息处) */
  if(card.depthPrompt && card.depthPrompt.prompt){
    var dd = Math.max(0, Math.min(hist.length, card.depthPrompt.depth || 0));
    var at = 1 + hist.length - dd;
    messages.splice(at, 0, {role: card.depthPrompt.role || "system",
      content: subMacros(card.depthPrompt.prompt, name, ctx.personaName)});
  }
  }

  return {
    messages: messages,
    stats: {maxCtx: maxCtx, avail: avail, sysTokens: used, histTokens: hUsed,
            histKept: hist.length, histDropped: hDropped, droppedSegs: dropped,
            segTokens: segTokens, memPools: memRes ? memRes.pools : null,
            memHits: memRes ? memRes.hits : null, /* S-4 召回指示器: 本次注入的记忆段标签 */
            loreHits: loreHitTitles, loreHitDetails: loreHitDetails, preset: preset.name, concise: !!ctx.concise,
            stPreset: stName, stDropped: stDropped},
    preview: sysText + "\n\n" + post,
  };
}

return {
  buildMessages: buildMessages, postInstructions: postInstructions, PRESETS: PRESETS,
  estTokens: estTokens, renderFields: renderFields, LAYERS: LAYERS, matchLore: matchLore,
  buildLore: buildLore, LABELS: LABELS, buildExamples: buildExamples,
  CONCISE_INSTR: CONCISE_INSTR, subMacros: subMacros,
  FLAIR: FLAIR, flairInstr: flairInstr,
};
})();
