/* 穿越 P0: 酒馆角色卡导入器
 * 支持 SillyTavern 角色卡 PNG（tEXt/iTXt chunk，keyword='chara'，base64 JSON）
 * 与纯 JSON（chara_card_v2 / v1 扁平格式）。
 * 解析后归一化为内部卡片 {name, fields, scenario, worldbook, raw}，
 * 存入 nd_imported_cards，可作为魂穿目标与卡片世界来源。
 */
const RP_CARDIMPORT = (function(){
"use strict";
var STORE = "nd_imported_cards";

function ascii(bytes){
  var s = "";
  for(var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function b64ToUtf8(b64){
  var bin = atob(String(b64).replace(/\s+/g, ""));
  var bytes = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* 从 PNG ArrayBuffer 里提取 chara JSON 字符串；失败抛错。
 * v3 双 chunk 卡: 同时收集 chara/ccv3, 优先返回 ccv3(v3 reader 优先读取,
 * 2026-10-07 接入 novel-distill chara_card_v3)。返回类型保持字符串。 */
function extractChara(pngBuf){
  var png = new Uint8Array(pngBuf);
  var sig = [137, 80, 78, 71, 13, 10, 26, 10], i;
  if(png.length < 20) throw new Error("不是 PNG 文件");
  for(i = 0; i < 8; i++) if(png[i] !== sig[i]) throw new Error("不是 PNG 文件");
  var pos = 8, charaText = null, ccv3Text = null;
  function grab(keyword, text){
    if(keyword === "ccv3"){ if(ccv3Text == null) ccv3Text = text; }
    else if(charaText == null) charaText = text;
  }
  while(pos + 12 <= png.length){
    var len = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
    if(len < 0 || pos + 12 + len > png.length) break;
    var type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    var data = png.subarray(pos + 8, pos + 8 + len);
    if(type === "tEXt"){
      var z = data.indexOf(0);
      var kw = z > 0 ? ascii(data.subarray(0, z)) : "";
      if(kw === "chara" || kw === "ccv3"){
        grab(kw, b64ToUtf8(ascii(data.subarray(z + 1))));
      }
    } else if(type === "iTXt"){
      var p = data.indexOf(0);
      var kw2 = p > 0 ? ascii(data.subarray(0, p)) : "";
      if(kw2 === "chara" || kw2 === "ccv3"){
        var compFlag = data[p + 1], compMethod = data[p + 2];
        if(compFlag === 0 && compMethod === 0){
          var q = p + 3, lz = data.indexOf(0, q);
          if(lz < 0){ pos += 12 + len; continue; }
          q = lz + 1;
          var tz = data.indexOf(0, q);
          if(tz < 0){ pos += 12 + len; continue; }
          q = tz + 1;
          // iTXt 文本段为 UTF-8；酒馆卡此处仍常放 base64 JSON
          var txt = new TextDecoder().decode(data.subarray(q));
          try { grab(kw2, b64ToUtf8(txt)); } catch(e){ grab(kw2, txt); }
        }
        // 压缩过的 iTXt 罕见，跳过
      }
    } else if(type === "IEND"){
      break;
    }
    pos += 12 + len;
  }
  if(ccv3Text != null) return ccv3Text;
  if(charaText != null) return charaText;
  throw new Error("这张 PNG 里没有找到角色卡数据（需要酒馆导出的卡片图）");
}

function parseCardJson(text){
  var t = String(text || "").trim().replace(/^\uFEFF/, "");
  var o = JSON.parse(t);
  if(o && o.data){                     // chara_card_v2 / chara_card_v3
    if(o.spec) o.data.spec = o.spec;   // v3 标记透传, normalizeTavern 可用
    return o.data;
  }
  if(o && (o.name || o.description)) return o;  // v1 扁平
  throw new Error("JSON 里没有角色卡字段");
}

/* 从 mes_example 提取 {{char}}: 台词行 (短引用, 供【说话方式】用) */
function exampleLines(mesExample, charName){
  var out = [];
  String(mesExample || "").split(/<START>/i).forEach(function(blk){
    blk.split("\n").forEach(function(line){
      /* P2-11: 角色名进正则前统一走 escRe 防正则注入（此前与 escRe 重复的内联转义已删） */
      var m = line.match(/^\s*\{\{\s*char\s*\}\}\s*:\s*(.+)$/i) ||
              (charName && line.match(new RegExp("^\\s*" + escRe(charName) + "\\s*[:：]\\s*(.+)$")));
      if(m && m[1].trim()) out.push(m[1].trim());
    });
  });
  return out;
}

function escRe(s){ return String(s == null ? "" : s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* mes_example 多轮结构保留: 每个 <START> 块 -> {turns:[{who, text}]}, few-shot 用真实对话, 不再配假 opener。
 *
 * 必须保留原始发言顺序: ST 卡里 {{char}} 常在 {{user}} 之前开口(承接上一轮的补充、抢话,
 * 或角色先调侃一句), 2026-10-15 之前按说话人分桶成 {user, char} 且 user 恒在前, 那类块会被
 * 重排成"角色在回答自己还没听到的话"——few-shot 一旦这样, 模型学到的问答配对就是错位的,
 * 回复里我/你的指代随之翻转(回归: tests/test_imported_pronoun.js)。 */
function exampleBlocks(mesExample, charName){
  var blocks = [];
  String(mesExample || "").split(/<START>/i).forEach(function(blk){
    var turns = [];
    /* 一条发言 = 一个说话人标签行 + 其后所有无标签续行。
     * ST 卡(实测 /home/hatch/workspace/rp-test/misaka_card.json)的角色回复常是多段:
     * 只有第一行带 {{char}}: 标签, 后面的台词段与动作段全是裸行。此前解析只收标签行,
     * 于是 few-shot 里角色只剩一个动作描写, 真正的台词全丢了。 */
    function append(who, s){
      s = String(s == null ? "" : s).replace(/\s+$/, "");
      if(!s.trim()){
        /* 空行 = 段间距, 挂在当前发言末尾 */
        if(turns.length && !/\n$/.test(turns[turns.length - 1].text)) turns[turns.length - 1].text += "\n";
        return;
      }
      if(!who) return;               /* 首个说话人标签之前的裸行(前言/空行), 丢弃 */
      if(turns.length && turns[turns.length - 1].who === who){
        var cur = turns[turns.length - 1];
        cur.text = cur.text.replace(/\n+$/, "") + "\n" + s.trim();
        return;
      }
      turns.push({who: who, text: s.trim()});
    }
    blk.split("\n").forEach(function(line){
      var um = line.match(/^\s*\{\{\s*user\s*\}\}\s*:\s*(.+)$/i);
      if(um){ append("user", um[1]); return; }
      var cm = line.match(/^\s*\{\{\s*char\s*\}\}\s*:\s*(.+)$/i) ||
               (charName && line.match(new RegExp("^\\s*" + escRe(charName) + "\\s*[:：]\\s*(.+)$", "i")));
      if(cm){ append("char", cm[1]); return; }
      append(turns.length ? turns[turns.length - 1].who : null, line);
    });
    turns.forEach(function(t){ t.text = t.text.replace(/\n+$/, ""); });
    /* 只有用户说话的块不成对(角色没接话), 丢掉, 否则 few-shot 教出"玩家说了没人应" */
    if(turns.some(function(t){ return t.who === "char"; })) blocks.push({turns: turns});
  });
  return blocks;
}

/* 块形状判定: 有序 turns。旧卡(2026-10-15 前入库)只有 {user, char} 分桶, 顺序已在导入时丢失。 */
function hasTurns(b){ return !!(b && Array.isArray(b.turns) && b.turns.length); }

/* 无 raw.mes_example 可重解析时的兜底: 旧形状本就只记录了 user->char 的先后, 按原样补 turns。 */
function upgradeBlocks(blocks){
  return (blocks || []).map(function(b){
    if(hasTurns(b)) return b;
    b = b || {};
    var turns = [];
    if(b.user) turns.push({who:"user", text:String(b.user)});
    if(b.char) turns.push({who:"char", text:String(b.char)});
    return {turns: turns};
  });
}

/* Tavern 卡 -> 内部卡片 */
function normalizeTavern(d){
  d = d || {};
  var name = String(d.name || "未命名").trim() || "未命名";
  var fields = {};
  if(d.description) fields.core_identity = String(d.description).trim();
  if(d.personality) fields.core_traits = String(d.personality).trim();
  var lines = [];
  /* first_mes 不再塞进 typical_lines: 它是开场场景原文(常数千字), 不是"典型台词",
     进了 typical_lines 会污染【说话方式】并被 buildExamples 配上假 opener 生成误导性 few-shot。
     开场白走独立 greeting 字段。 */
  exampleLines(d.mes_example, name).forEach(function(l){
    if(l && lines.indexOf(l) < 0) lines.push(l);
  });
  if(lines.length) fields.typical_lines = lines.slice(0, 5);
  var sysNote = [];
  if(d.system_prompt) sysNote.push(String(d.system_prompt).trim());
  if(d.creator_notes) sysNote.push("作者注：" + String(d.creator_notes).trim());
  /* P0 卡兼容: system_prompt / post_history_instructions / creator_notes 升为一等字段,
   * 进 prompt 组装 (以前只进 sysNote, 全仓库无人渲染, 被静默丢弃) */
  var systemPrompt = String(d.system_prompt == null ? "" : d.system_prompt).trim();
  var postHistoryInstructions = String(d.post_history_instructions == null ? "" : d.post_history_instructions).trim();
  var creatorNotes = String(d.creator_notes == null ? "" : d.creator_notes).trim();
  /* v3: depth_prompt / group_only_greetings */
  var dp = (d.depth_prompt && typeof d.depth_prompt === "object") ? d.depth_prompt : null;
  var depthPrompt = dp && String(dp.prompt == null ? "" : dp.prompt).trim()
    ? {prompt: String(dp.prompt).trim(), role: dp.role === "user" || dp.role === "assistant" ? dp.role : "system",
       depth: Math.max(0, parseInt(dp.depth, 10) || 0)} : null;
  var groupOnlyGreetings = Array.isArray(d.group_only_greetings)
    ? d.group_only_greetings.map(function(g){ return String(g == null ? "" : g).trim(); }).filter(function(g){ return g; }) : [];
  var worldbook = [];
  var book = d.character_book || {};
  var rawEntries = book.entries || [];
  /* P0 卡兼容: 卡片世界书走 RP_LOREBOOK.importST, secondary_keys/selectiveLogic/
   * constant/position/probability/depth 等 ST 字段完整透传 (以前只留了 4 个字段) */
  var importOk = false;
  if(rawEntries.length && typeof RP_LOREBOOK !== "undefined" && RP_LOREBOOK.importST){
    try {
      var wb = RP_LOREBOOK.importST({entries: rawEntries});
      if(wb && wb.length){ worldbook = wb; importOk = true; }
    } catch(e){}
  }
  if(!importOk){
    rawEntries.forEach(function(e, i){
      if(!e || !e.content) return;
      worldbook.push({
        title: e.name || ("卡片世界书 " + (i + 1)),
        trigger_keywords: e.keys || e.keywords || [],
        content: String(e.content),
        priority: 55, enabled: e.enabled !== false,
      });
    });
  }
  var bookMeta = {
    name: String(book.name || "").trim(),
    scan_depth: book.scan_depth != null ? +book.scan_depth : null,
    token_budget: book.token_budget != null ? +book.token_budget : null,
    recursive_scanning: !!book.recursive_scanning,
  };
  var tags = d.tags || [];
  /* 开场白 first_mes 单独保留: 聊天/穿越开场优先用卡片原开场白, 不再只塞进 typical_lines */
  var greeting = String(d.first_mes == null ? "" : d.first_mes).trim();
  /* P1-2: 保留多开场白与示例对话(之前归一化会丢, 导出也写空) */
  var altGreetings = Array.isArray(d.alternate_greetings) ? d.alternate_greetings
    .map(function(g){ return String(g == null ? "" : g).trim(); })
    .filter(function(g){ return g; }).slice(0, 8) : [];
  var ext = (d.extensions && typeof d.extensions === "object") ? d.extensions : {};
  var exampleDialogue = String(ext.example_dialogue == null ? "" : ext.example_dialogue).trim();
  return {
    id: "imp" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    name: name,
    novel: tags[0] || "导入角色卡",
    fields: fields,
    greeting: greeting,
    altGreetings: altGreetings,
    exampleDialogue: exampleDialogue,
    exampleBlocks: exampleBlocks(d.mes_example, name),
    scenario: String(d.scenario || "").trim(),
    systemPrompt: systemPrompt,
    postHistoryInstructions: postHistoryInstructions,
    creatorNotes: creatorNotes,
    depthPrompt: depthPrompt,
    groupOnlyGreetings: groupOnlyGreetings,
    characterVersion: String(d.character_version == null ? "" : d.character_version).trim(),
    creator: String(d.creator == null ? "" : d.creator).trim(),
    /* v3 新字段 (2026-10-07): nickname / assets, ccv3 优先读取后透传 */
    cardSpec: String(d.spec == null ? "" : d.spec).trim(),
    nickname: String(d.nickname == null ? "" : d.nickname).trim(),
    assets: Array.isArray(d.assets) ? d.assets.filter(function(a){ return a != null; }) : [],
    bookMeta: bookMeta,
    sysNote: sysNote.join("\n"),
    worldbook: worldbook,
    raw: d,
    createdAt: Date.now(),
  };
}

/* ---- 本地库 ---- */
function list(){
  try {
    var s = localStorage.getItem(STORE);
    /* P2: localStorage 副本被清理后，回退 IDB 内存镜像；v36: getSync 在文件层同步补读，冷启动也安全 */
    if(s == null && typeof RP_STORE!=="undefined") s = (RP_STORE.getSync || RP_STORE.cacheGet).call(RP_STORE, STORE);
    return JSON.parse(s) || [];
  } catch(e){ return []; }
}
function save(list){
  var s = JSON.stringify(list);
  var ok = true;
  try { localStorage.setItem(STORE, s); } catch(e){ ok = false; typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("角色卡库保存失败", e); }
  /* P2: 大体积角色卡 IDB 双写（复制模式）；LS 失败时靠 syncBig 兜底，故仍尝试 */
  try{ if(typeof RP_STORE!=="undefined"){ RP_STORE.cacheSet(STORE, s); RP_STORE.syncBig(STORE, s); } }catch(e){}
  return ok;
}
function find(name){
  var l = list();
  for(var i = 0; i < l.length; i++) if(l[i].name === name){ ensureCompat(l[i]); return l[i]; }
  return null;
}
function findById(id){
  var l = list();
  for(var i = 0; i < l.length; i++) if(l[i].id === id){ ensureCompat(l[i]); return l[i]; }
  return null;
}
/* 旧卡兼容(v36): 56797f7 之前导入的卡没有独立 greeting 字段, first_mes 只进了
   typical_lines 纯数组(或只留在 raw 里)。读时回填, 不写回存储, 避免存储抖动。
   回退链: greeting -> raw.first_mes -> typical_lines 首个超长条目 */
function greetingOf(card){
  if(!card) return "";
  var g = String(card.greeting == null ? "" : card.greeting).trim();
  if(g) return g;
  var raw = (card.raw && typeof card.raw === "object") ? card.raw : {};
  var fm = String(raw.first_mes == null ? "" : raw.first_mes).trim();
  if(fm) return fm;
  var tl = card.fields && card.fields.typical_lines;
  if(Array.isArray(tl) && tl.length){
    var t0 = String(tl[0] == null ? "" : tl[0]).trim();
    /* 新卡 typical_lines 是 mes_example 短句; 超长首条基本可判定为旧卡的 first_mes */
    if(t0.length > 200) return t0;
  }
  return "";
}
function ensureGreeting(card){
  if(card && !String(card.greeting == null ? "" : card.greeting).trim()){
    var g = greetingOf(card);
    if(g) card.greeting = g;
  }
  return card;
}
/* 旧卡兼容: 本次升级前导入的卡没有 exampleBlocks/systemPrompt 等一等字段,
 * 读时从 raw 回填, 不写回存储 */
function ensureCompat(card){
  if(!card) return card;
  ensureGreeting(card);
  /* 示例块轮次顺序: 旧卡(2026-10-15 前入库)的 exampleBlocks 是 {user, char} 分桶, 顺序已丢。
     raw.mes_example 是原始文本, 重解析可得真序(这是修复对已导入卡生效的唯一途径);
     没有原文可解析时才按旧形状的 user->char 兜底。 */
  if(!Array.isArray(card.exampleBlocks) || !card.exampleBlocks.every(hasTurns)){
    var raw = (card.raw && typeof card.raw === "object") ? card.raw : {};
    var reparsed = exampleBlocks(raw.mes_example, card.name);
    card.exampleBlocks = reparsed.length ? reparsed : upgradeBlocks(card.exampleBlocks);
  }
  if(card.systemPrompt == null){
    var raw2 = (card.raw && typeof card.raw === "object") ? card.raw : {};
    card.systemPrompt = String(raw2.system_prompt == null ? "" : raw2.system_prompt).trim();
    card.postHistoryInstructions = String(raw2.post_history_instructions == null ? "" : raw2.post_history_instructions).trim();
    card.creatorNotes = String(raw2.creator_notes == null ? "" : raw2.creator_notes).trim();
  }
  return card;
}
function add(card){
  var l = list();
  l.unshift(card);
  save(l);
  return card;
}
function del(id){
  save(list().filter(function(c){ return c.id !== id; }));
}
/* P1-2: 原位更新(保留顺序), 供卡片编辑页使用 */
function update(card){
  save(list().map(function(c){ return c.id === card.id ? card : c; }));
  return card;
}

/* 文件 -> 归一化卡片（不入库，供预览确认） */
async function fromFile(file){
  var buf = await file.arrayBuffer();
  var name = (file.name || "").toLowerCase();
  var jsonText;
  if(name.slice(-4) === ".png"){
    jsonText = extractChara(buf);
  } else {
    jsonText = new TextDecoder().decode(new Uint8Array(buf));
  }
  return normalizeTavern(parseCardJson(jsonText));
}

/* ---- AI 补完缺失层 ----
 * 只做"缺啥补啥": 检测关键层缺失 -> 用户确认 -> 模型推断 -> 可编辑预览 -> 写回。
 * 原卡一字不动; 补进的字段记到 card.aiFilled, 编辑页打"AI 补完"标注。 */
var GAPFILL_KEYS = ["ooc_redline", "soul_goal", "hidden_desire", "inner_need",
  /* B17: 弧光四键纳入补完。ST 卡本身没有弧光字段(normalizeTavern 不产生这些键),
     但这是现成的、最便宜的补数通道 —— 走同一套"缺啥补啥"流程, 结果标 AI 生成,
     用户可在卡片编辑器里改。arc_type 必须落在 RP_ARC.TYPE_LABEL 的四个键上
     (fall/awakening/rise/flat), 否则详情页显示不出类型名。
     timeline_stage 故意不补: 它的候选表 RP_ARC.STAGES 是红楼梦专属的九项,
     让模型猜一个阶段等于凭空造时间坐标 —— 该字段由用户自己填。 */ "arc_type", "arc_start", "arc_mid", "arc_end"];
function missingGapfillKeys(card){
  var f = (card && card.fields) || {}, out = [];
  GAPFILL_KEYS.forEach(function(k){
    var v = f[k];
    if(v == null || String(v).trim() === "") out.push(k);
  });
  return out;
}
/* 补完 prompt: 只让模型填缺失键, 基于原卡 description/personality/scenario 推断 */
function gapfillPrompt(card, keys){
  var f = (card && card.fields) || {};
  var src = [
    "【身份】" + (f.core_identity || "（未写）"),
    "【性格】" + (f.core_traits || "（未写）"),
    "【世界设定】" + ((card && card.scenario) || "（未写）"),
    (card && card.greeting) ? "【开场白】" + String(card.greeting).slice(0, 400) : "",
    card && card.systemPrompt ? "【系统提示词】" + card.systemPrompt : "",
    f.appearance_feature ? "【外貌】" + f.appearance_feature : "",
    f.values ? "【价值观】" + f.values : "",
    f.moral_bottom_line ? "【道德底线】" + f.moral_bottom_line : "",
  ].filter(Boolean).join("\n");
  return "你是角色卡补完员。根据下面这张角色卡的原文, 推断并补全缺失的关键层, 只输出一个 JSON 对象。\n" +
    "规则:\n" +
    "1. 只填这几个键: " + keys.join(", ") + "。其他键一律不要输出。\n" +
    "2. 每个值 1-2 句话, 简洁具体, 贴合角色的说话风格, 禁止八股词(非常/极其/深深地)。\n" +
    "3. 必须能从原文推断出来; 原文没依据的就写贴合人设的合理推断, 但绝不能与原文矛盾。\n" +
    "4. ooc_redline 写 2-3 条这个角色绝不会做的事(结合性格与底线)。\n" +
    /* B17: arc_* 的约束和别的不一样 —— arc_type 是封闭枚举(RP_ARC.TYPE_LABEL),
       模型随手写"成长型"渲染不出类型名, 所以把四个键名原样列给它。 */
    (keys.indexOf("arc_type") >= 0 ? ("5. arc_type 只能取这四个值之一: "
      + (typeof RP_ARC !== "undefined" ? Object.keys(RP_ARC.TYPE_LABEL).join(" / ") : "fall / awakening / rise / flat")
      + "(不要翻译, 原样输出英文)。arc_start/arc_end 各 1 句写清弧光的起点与落点; "
        + "arc_mid 写 1-3 个转折点, 多个之间用「；」分隔。\n") : "")
    + "只输出 JSON, 不要解释。\n\n" + src;
}
function parseGapfillJson(text, keys){
  var t = String(text || "").replace(/```json|```/g, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) return null;
  try{
    var o = JSON.parse(t.slice(a, b + 1)), out = {};
    (keys || []).forEach(function(k){
      var v = o[k];
      if(v != null && String(v).trim() !== "") out[k] = String(v).trim().slice(0, 300);
    });
    return out;
  }catch(e){ return null; }
}

/* ---- 看图写卡 ----
 * 纯图片(无内嵌 chara 数据) -> vision 模型识别 -> 一人一张卡。
 * 模型是否支持 vision 由调用方按 RP_MODELTAGS 能力标签判断, 这里只组装 prompt/解析。 */
function visionCardPrompt(){
  return "你是角色卡画师。请看这张图, 识别图中所有主要人物, 为每人写一张 SillyTavern 风格角色卡, 只输出一个 JSON 对象, 格式如下:\n" +
    '{"characters": [{"name": "人物名(能看出名字就写, 看不出就按特征起名如\'蓝发少女\')", ' +
    '"appearance": "外貌特征", "description": "身份/气质描述", "personality": "性格推断", ' +
    '"scenario": "所处场景与世界氛围", "first_mes": "一句符合人设的开场白", ' +
    '"mes_example": "一段简短对话示例", ' +
    '"worldbook": [{"title": "条目名", "content": "从画面能看出的世界信息"}]}]}\n' +
    "规则:\n" +
    "1. 只输出 JSON, 不要解释; 图中有几个人就写几张, 每人独立。\n" +
    "2. personality/scenario 允许从画面合理推断, 但不要编造图中没有的剧情。\n" +
    "3. worldbook 写 2-4 条, 只写画面能直接看出的世界信息。\n" +
    "4. first_mes 用角色口吻, 20-60 字。";
}
function parseVisionCards(text){
  var t = String(text || "").replace(/```json|```/g, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) return null;
  try{
    var o = JSON.parse(t.slice(a, b + 1));
    var arr = o && o.characters;
    if(!Array.isArray(arr) || !arr.length) return null;
    return arr.filter(function(c){ return c && (c.name || c.description); });
  }catch(e){ return null; }
}
/* vision 识别出的人物 -> 内部卡片(与 normalizeTavern 同形状) */
function fromVisionChar(ch){
  ch = ch || {};
  var name = String(ch.name || "未命名").trim() || "未命名";
  var wb = [];
  (Array.isArray(ch.worldbook) ? ch.worldbook : []).forEach(function(e, i){
    if(!e || !e.content) return;
    wb.push({title: String(e.title || ("画面世界书 " + (i + 1))).slice(0, 40),
      trigger_keywords: [], content: String(e.content).slice(0, 500),
      priority: 55, enabled: true});
  });
  return {
    id: "vis" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    name: name,
    novel: "看图写卡",
    fields: {
      core_identity: String(ch.description || "").trim(),
      core_traits: String(ch.personality || "").trim(),
      appearance_feature: String(ch.appearance || "").trim(),
    },
    greeting: String(ch.first_mes || "").trim(),
    altGreetings: [],
    exampleDialogue: String(ch.mes_example || "").trim(),
    exampleBlocks: [],
    scenario: String(ch.scenario || "").trim(),
    systemPrompt: "", postHistoryInstructions: "", creatorNotes: "",
    depthPrompt: null, groupOnlyGreetings: [],
    characterVersion: "", creator: "看图写卡",
    bookMeta: {name: "", scan_depth: null, token_budget: null, recursive_scanning: false},
    sysNote: "", worldbook: wb, raw: {vision: true, source: ch},
    aiFilled: {},
    createdAt: Date.now(),
  };
}

return {
  extractChara: extractChara, parseCardJson: parseCardJson,
  normalizeTavern: normalizeTavern, exampleLines: exampleLines, exampleBlocks: exampleBlocks,
  greetingOf: greetingOf, ensureCompat: ensureCompat,
  GAPFILL_KEYS: GAPFILL_KEYS, missingGapfillKeys: missingGapfillKeys,
  gapfillPrompt: gapfillPrompt, parseGapfillJson: parseGapfillJson,
  visionCardPrompt: visionCardPrompt, parseVisionCards: parseVisionCards,
  fromVisionChar: fromVisionChar,
  list: list, find: find, findById: findById, add: add, del: del, update: update,
  fromFile: fromFile,
};
})();
