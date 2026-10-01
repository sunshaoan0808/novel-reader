/* RP_LOREBOOK: Janitor 式世界书完整 schema
 * 对标 Janitor AI webroot PLe(默认条目构造)/TLe(四值逻辑)/NLe(ST 导入归一化)。
 * 条目匹配 + 互斥组过滤 + probability 掷骰 + minMessages 门限 + placement 插入锚定 + ST JSON 导入。
 * 注意: 条目级无 token budget 字段 (Janitor 包内未找到; 控制靠 priority+probability+constant+minMessages+depth)。
 * 纯函数模块, 无 DOM 依赖, 可在 node vm 里单测。
 */
var RP_LOREBOOK = (function(){
"use strict";

/* 次级关键词四值逻辑 (Janitor TLe 枚举, 注意 NOT_ALL=1 / NOT_ANY=2 的非常规编号) */
var SELECTIVE = {AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3};
var SELECTIVE_NAMES = ["AND ANY", "AND ALL", "NOT ANY", "NOT ALL"];

/* placement -> prompt 段锚定 (Janitor: personality/scenario/exampleDialogs 之后; before/after 可选) */
var PLACEMENTS = ["default", "personality", "scenario", "exampleDialogs"];
var PLACEMENT_ANCHOR = {personality: "core", scenario: "background", exampleDialogs: "examples"};

/* event3 结构化字段 (Talkie memory_profile_*, 任务第 3 项) 的渲染标签, 集中一处 */
var EVENT_FIELD_LABELS = {
  location: "地点", participants: "参与者", agreements: "约定与任务", type: "类型",
  status: "状态", emotionalTone: "情感基调", attitudeToUser: "对用户的态度",
  relationshipImpact: "关系影响"
};

var LORE_MAX_HITS = 8; /* 单次注入上限: 按 priority 取前 N, 避免触发泛滥 */

function num(v, d){ v = parseFloat(v); return isFinite(v) ? v : d; }
function str(v){ return v == null ? "" : String(v); }
function arrOf(v){ return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function trimStr(x){ return String(x == null ? "" : x).trim(); }
function uid(p){ return (p || "lore") + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

/* token 估算: 与 RP_PROMPT.estTokens 同公式 (lorebook.js 独立可用) */
function estTokens(s){
  s = String(s || "");
  var zh = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  var en = (s.match(/[A-Za-z]+/g) || []).length;
  var rest = Math.max(0, s.length - zh - en * 4);
  return Math.ceil(zh * 1.6 + en * 1.3 + rest * 0.5);
}

/* 归一化单条目。
 * 老字段映射: title->name, trigger_keywords/keys->key, rules->content。
 * 缺字段给 Janitor 默认值 (见规格 1.1 PLe)。priority 由列表位置派生 (priority=index+1)。
 * 老式 priority(越大越先, 数字) 记在 _legacyPriority, 由 normalizeAll 做一次性语义迁移。 */
function normalize(e, index){
  e = e || {};
  var isLegacyShape = (e.title != null || e.trigger_keywords != null || e.rules != null) &&
                      e.key === undefined && e.name === undefined;
  var keys = e.key !== undefined ? arrOf(e.key)
           : (e.keys !== undefined ? arrOf(e.keys) : arrOf(e.trigger_keywords));
  var keysec = e.keysecondary !== undefined ? arrOf(e.keysecondary) : arrOf(e.secondaryKeys);
  var grp = e.inclusionGroup;
  if(typeof grp === "string") grp = grp.split(/[,，、]/).map(trimStr).filter(Boolean);
  else grp = arrOf(grp).map(trimStr).filter(Boolean);
  var logic = Math.floor(num(e.selectiveLogic, 0));
  if([0, 1, 2, 3].indexOf(logic) < 0) logic = 0;
  var place = PLACEMENTS.indexOf(e.placement) >= 0 ? e.placement : "default";
  var depth = (e.depth === undefined || e.depth === null || e.depth === "") ? null
            : Math.min(10, Math.max(1, Math.floor(num(e.depth, 0))));
  if(depth === 0 || !isFinite(depth)) depth = null;
  var _content = e.content != null ? e.content : e.rules;
  if(Array.isArray(_content)) _content = _content.join("\n"); /* 蒸馏世界书 rules 为数组 */
  return {
    id: e.id || uid("lore"),
    name: trimStr(e.name != null ? e.name : e.title),
    enabled: e.enabled !== false && e.disable !== true,
    content: trimStr(_content),
    comment: trimStr(e.comment),
    key: keys.map(trimStr).filter(Boolean),
    keysecondary: keysec.map(trimStr).filter(Boolean),
    selectiveLogic: logic,
    case_sensitive: !!e.case_sensitive,
    matchWholeWords: e.matchWholeWords !== undefined ? !!e.matchWholeWords : true,
    minMessages: Math.max(0, Math.floor(num(e.minMessages, 0))),
    probability: Math.min(100, Math.max(0, num(e.probability, 100))),
    priority: (index || 0) + 1,
    _legacyPriority: (isLegacyShape && typeof e.priority === "number") ? e.priority : null,
    constant: !!e.constant,
    inclusionGroup: grp,
    groupWeight: (e.groupWeight === undefined || e.groupWeight === "" || e.groupWeight === null)
                 ? 100 : Math.max(1, num(e.groupWeight, 100)),
    prioritizeInclusion: !!e.prioritizeInclusion,
    keyMatchPriority: !!e.keyMatchPriority,
    placement: place,
    placementPosition: e.placementPosition === "before" ? "before" : "after",
    depth: depth,
    activationMode: e.activationMode || "standard",
    activationScript: str(e.activationScript),
    category: trimStr(e.category) || "other",
    tags: arrOf(e.tags),
    extensions: (e.extensions && typeof e.extensions === "object") ? e.extensions : {}
  };
}

/* 归一化整表: 老式 priority(越大越先) 仅对含老条目的表做一次稳定重排, 然后重算 priority=index+1。
 * 纯新式表 (priority 已由位置派生) 直接按原序重算, 幂等。 */
function normalizeAll(entries){
  var list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean)
    .map(function(e, i){ return normalize(e, i); });
  var hasLegacy = list.some(function(e){ return e._legacyPriority != null; });
  if(hasLegacy){
    list = list.map(function(e, i){ return {e: e, i: i}; }).sort(function(a, b){
      var pa = a.e._legacyPriority == null ? 50 : a.e._legacyPriority; /* 老缺省 50 */
      var pb = b.e._legacyPriority == null ? 50 : b.e._legacyPriority;
      if(pb !== pa) return pb - pa; /* 老语义: 越大越先 */
      return a.i - b.i;
    }).map(function(x, ni){ x.e.priority = ni + 1; return x.e; });
  } else {
    list.forEach(function(e, ni){ e.priority = ni + 1; });
  }
  return list;
}

/* 关键词匹配: /pattern/flags 视为 RegEx (case_sensitive 对正则无效, Janitor ignoredOnRegexKeys);
 * 纯 CJK key 无词边界概念, 子串命中即算 whole word。 */
function parseRegexKey(k){
  k = trimStr(k);
  if(k.length < 2 || k.charAt(0) !== "/") return null;
  var last = k.lastIndexOf("/");
  if(last <= 0) return null;
  var flags = k.slice(last + 1);
  if(!/^[gimsuy]*$/.test(flags)) return null;
  try { return new RegExp(k.slice(1, last), flags); }
  catch(e){ return null; }
}
function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function keyMatches(k, text, opts){
  opts = opts || {};
  k = trimStr(k); text = str(text);
  if(!k) return false;
  var rx = parseRegexKey(k);
  if(rx) return rx.test(text);
  var key = k, t = text;
  if(!opts.case_sensitive){ key = key.toLowerCase(); t = t.toLowerCase(); }
  if(t.indexOf(key) < 0) return false;
  if(!opts.matchWholeWords) return true;
  if(!/[A-Za-z0-9_]/.test(key)) return true; /* CJK 等无词边界: 子串即整词 */
  var re = new RegExp("\\b" + escRe(key) + "\\b", opts.case_sensitive ? "" : "i");
  return re.test(text);
}

/* 单条目求值: 返回 -1=未命中; 否则返回命中的主关键词数 (constant 返回 0)。 */
function evalEntry(e, text){
  if(e.constant) return 0;
  var pHits = e.key.filter(function(k){ return keyMatches(k, text, e); }).length;
  if(!pHits) return -1;
  var sec = e.keysecondary;
  if(sec.length){
    var sHits = sec.filter(function(k){ return keyMatches(k, text, e); }).length;
    var L = e.selectiveLogic;
    if(L === SELECTIVE.AND_ANY && !sHits) return -1;                    /* 任一次级命中才纳入 */
    if(L === SELECTIVE.AND_ALL && sHits !== sec.length) return -1;     /* 全部命中才纳入 */
    if(L === SELECTIVE.NOT_ANY && sHits > 0) return -1;                /* 任一命中即排除 */
    if(L === SELECTIVE.NOT_ALL && sHits === sec.length) return -1;     /* 全命中才排除 */
  }
  return pHits;
}

/* 互斥组过滤: 每组只激活一条 (groupWeight 加权随机; prioritizeInclusion 时按 priority 取首)。 */
function filterGroups(list){
  var groups = {}, nogroup = [];
  list.forEach(function(e){
    if(e.constant || !e.inclusionGroup.length){ nogroup.push(e); return; }
    e.inclusionGroup.forEach(function(g){ (groups[g] = groups[g] || []).push(e); });
  });
  var picked = {}, pickedList = [];
  Object.keys(groups).forEach(function(g){
    var cands = groups[g].filter(function(e){ return !picked[e.id]; });
    if(!cands.length) return;
    var win;
    if(cands[0].prioritizeInclusion){
      win = cands.slice().sort(function(a, b){ return a.priority - b.priority; })[0];
    } else {
      var total = 0;
      cands.forEach(function(e){ total += (e.groupWeight || 100); });
      var r = Math.random() * total, acc = 0;
      win = cands[cands.length - 1];
      for(var i = 0; i < cands.length; i++){
        acc += (cands[i].groupWeight || 100);
        if(r < acc){ win = cands[i]; break; }
      }
    }
    picked[win.id] = true;
    pickedList.push(win);
  });
  var fin = nogroup.concat(pickedList);
  fin.sort(function(a, b){ return a.priority - b.priority; });
  return fin;
}

function postFilter(list){
  /* keyMatchPriority: 按命中关键词数优先, 再按 priority (小的强)。 */
  list.sort(function(a, b){
    var ka = a.keyMatchPriority ? -(a._m || 0) : 0;
    var kb = b.keyMatchPriority ? -(b._m || 0) : 0;
    if(ka !== kb) return ka - kb;
    return a.priority - b.priority;
  });
  /* probability 掷骰 (百分制; constant 恒中) */
  list = list.filter(function(e){
    if(e.constant) return true;
    if(e.probability >= 100) return true;
    if(e.probability <= 0) return false;
    return Math.random() * 100 < e.probability;
  });
  return filterGroups(list);
}

/* 匹配: entries 原始条目数组; text 文本(或消息数组, 见 matchMessages); msgCount 聊天消息数(供 minMessages)。 */
function match(entries, text, msgCount){
  var list = normalizeAll(entries);
  text = str(text);
  var out = [];
  list.forEach(function(e){
    if(!e.enabled) return;
    if(!e.constant && e.minMessages > 0 && msgCount != null && msgCount < e.minMessages) return;
    var m = evalEntry(e, text);
    if(m < 0) return;
    e._m = m;
    out.push(e);
  });
  return postFilter(out);
}

/* 按消息数组匹配: 每条目用 depth (默认 4) 决定扫描最近 N 条消息。 */
function matchMessages(entries, messages, msgCount){
  var list = normalizeAll(entries);
  var msgs = (messages || []).map(function(m){
    return typeof m === "string" ? m : str(m && m.content);
  });
  var out = [];
  list.forEach(function(e){
    if(!e.enabled) return;
    if(!e.constant && e.minMessages > 0 && msgCount != null && msgCount < e.minMessages) return;
    var text = e.constant ? "" : msgs.slice(-(e.depth || 4)).join("\n");
    var m = evalEntry(e, text);
    if(m < 0) return;
    e._m = m;
    out.push(e);
  });
  return postFilter(out);
}

/* 组装注入文本: textOrMessages 可为字符串或消息数组。
 * 返回 {text, placed:{anchor->文本}, hits:[{title, probability, priority}]}。
 * placement != default 的条目进 placed, 由调用方拼到对应 prompt 段 (personality->core 等)。 */
function build(entries, textOrMessages, budgetTokens, msgCount, estFn){
  estFn = estFn || estTokens;
  budgetTokens = Math.max(0, num(budgetTokens, 0));
  var matched = Array.isArray(textOrMessages)
    ? matchMessages(entries, textOrMessages, msgCount)
    : match(entries, textOrMessages, msgCount);
  var lines = [], placed = {}, hits = [];
  matched.forEach(function(e){
    if(hits.length >= LORE_MAX_HITS) return;
    var line = "- 《" + (e.name || "无标题") + "》：" + e.content;
    var anchor = PLACEMENT_ANCHOR[e.placement];
    if(anchor){
      var cur = placed[anchor] || "";
      placed[anchor] = e.placementPosition === "before"
        ? line + (cur ? "\n" + cur : "")
        : (cur ? cur + "\n" : "") + line;
    } else {
      lines.push(line);
    }
    hits.push({title: e.name || "无标题", probability: e.probability, priority: e.priority});
  });
  /* 无条目级 budget (Janitor 无此字段): 只按总预算裁剪默认段 */
  var used = 0, keptLines = [], keptIdx = [];
  for(var i = 0; i < lines.length; i++){
    var t = estFn(lines[i]);
    if(used + t > budgetTokens) continue;
    used += t; keptLines.push(lines[i]); keptIdx.push(i);
  }
  var keptHits = [];
  var di = 0;
  hits.forEach(function(h, i){
    if(keptIdx[di] === i){ keptHits.push(h); di++; }
  });
  return {text: keptLines.join("\n"), placed: placed, hits: keptHits};
}

/* ST 世界书 JSON -> 本机条目 (别名映射见规格 1.5 NLe; 缺字段走 Janitor 默认)。
 * 接受 {entries: {...}|[...]}; priority 一律由列表位置派生。 */
/* ST position 语义映射到本机 placement/placementPosition。
 * ST 经典: 0=角色定义前 1=角色定义后 2=作者注前 3=作者注后 4=按depth;
 * RisuAI 系变体(真实卡实证): "before_char"/"after_char" 字符串。 */
function mapStPosition(p){
  if(typeof p === "string"){
    var s = p.toLowerCase();
    if(s === "before_char") return {placement: "personality", placementPosition: "before"};
    if(s === "after_char") return {placement: "personality", placementPosition: "after"};
    if(s === "before_an") return {placement: "default", placementPosition: "before"};
    if(s === "after_an") return {placement: "default", placementPosition: "after"};
    return null;
  }
  if(typeof p === "number" && isFinite(p)){
    if(p === 0) return {placement: "personality", placementPosition: "before"};
    if(p === 1) return {placement: "personality", placementPosition: "after"};
    if(p === 2) return {placement: "default", placementPosition: "before"};
    if(p === 3) return {placement: "default", placementPosition: "after"};
    if(p === 4) return {placement: "default", placementPosition: "after"};
  }
  return null;
}
function importST(d){
  var raw = d && d.entries;
  if(!raw) return null;
  var list = Array.isArray(raw) ? raw.slice() : Object.keys(raw).map(function(k){ return raw[k]; });
  /* 真实卡的经典 ST 字段常藏在 extensions 里(如 selectiveLogic/group/depth), 顶层用变体名;
   * insertion_order/order/display_index 决定条目顺序(越小越靠前), 缺省保持原序(稳定排序)。 */
  list = list.map(function(e, i){ return {e: e, i: i}; }).sort(function(a, b){
    var ka = firstVal(a.e && a.e.insertion_order, a.e && a.e.order,
                       a.e && a.e.extensions && a.e.extensions.display_index);
    var kb = firstVal(b.e && b.e.insertion_order, b.e && b.e.order,
                       b.e && b.e.extensions && b.e.extensions.display_index);
    var na = (ka === undefined || ka === null || ka === "") ? Infinity : +ka;
    var nb = (kb === undefined || kb === null || kb === "") ? Infinity : +kb;
    if(na !== nb) return na - nb;
    return a.i - b.i;
  }).map(function(x){ return x.e; });
  var out = [];
  list.forEach(function(e){
    if(!e) return;
    var ext = (e.extensions && typeof e.extensions === "object") ? e.extensions : {};
    var content = firstStr(e.content, e.entry, e.text);
    if(!content) return;
    var keys = splitKeys(firstVal(e.key, e.keys, e.keywords));
    var secs = splitKeys(firstVal(e.keysecondary, e.secondaryKeys, e.secondary_keys));
    var grpRaw = firstVal(e.inclusionGroup, e.group, ext.group);
    var mw = firstVal(e.matchWholeWords, e.match_whole_word, e.matchWholeWord, ext.match_whole_words);
    var pos = mapStPosition(firstVal(e.position, ext.position));
    var prob = (ext.useProbability === false) ? 100 : firstVal(e.probability, ext.probability);
    var mergedExt = {};
    for(var k in ext) mergedExt[k] = ext[k];
    /* use_regex=true 但 key 不是 /re/flags 写法时, 本机仍按字面匹配(限制, 已注明) */
    if(e.use_regex !== undefined) mergedExt.use_regex = e.use_regex;
    /* NLe 的 matchWholeWords 缺省为 false (PLe 为 true), 此处忠实还原 */
    out.push(normalize({
      id: uid("st"),
      name: firstStr(e.name, e.title),
      content: content,
      comment: firstStr(e.comment, e.notes),
      key: keys,
      keysecondary: secs,
      enabled: e.enabled !== undefined ? !!e.enabled
             : (e.active !== undefined ? !!e.active
             : (e.disable !== undefined ? !e.disable : true)),
      case_sensitive: !!(firstVal(e.case_sensitive, e.caseSensitive, ext.case_sensitive)),
      matchWholeWords: mw === undefined ? false : !!mw,
      inclusionGroup: grpRaw,
      constant: !!e.constant,
      probability: prob,
      minMessages: e.minMessages,
      selectiveLogic: firstVal(e.selectiveLogic, ext.selectiveLogic),
      groupWeight: firstVal(e.groupWeight, ext.group_weight),
      prioritizeInclusion: e.prioritizeInclusion,
      keyMatchPriority: e.keyMatchPriority,
      placement: pos ? pos.placement : e.placement,
      placementPosition: pos ? pos.placementPosition : e.placementPosition,
      depth: firstVal(e.depth, ext.depth),
      category: e.category,
      extensions: mergedExt
    }, out.length));
  });
  return out.length ? out : null;
}
function firstVal(){
  for(var i = 0; i < arguments.length; i++){
    if(arguments[i] !== undefined) return arguments[i];
  }
  return undefined;
}
function firstStr(){
  for(var i = 0; i < arguments.length; i++){
    var v = arguments[i];
    if(v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function splitKeys(v){
  var a = Array.isArray(v) ? v : (typeof v === "string" ? v.split(/[,，、]/)
                : (v == null ? [] : [v]));
  return a.map(trimStr).filter(Boolean);
}

  /* ST position 逆映射: 本机 placement/placementPosition -> ST position 字符串。
 * 四种经典组合用 RisuAI 系字符串(本机导入可读回); scenario/exampleDialogs 是
 * Janitor 系概念, ST 无对应, 用 "after_scenario"/"after_example_dialogs" 标记
 * (ST 会忽略未知值, 本机重导入时经 placement 字段还原, 见 exportST)。 */
function placementToStPosition(placement, placementPosition){
  if(placement === "personality") return placementPosition === "before" ? "before_char" : "after_char";
  if(placement === "scenario") return "after_scenario";
  if(placement === "exampleDialogs") return "after_example_dialogs";
  return placementPosition === "before" ? "before_an" : "after_an";
}

/* 本机条目 -> SillyTavern 世界书 JSON (importST 的逆操作)。
 * 写 ST 经典 schema: {entries: {uid: {uid,key,keysecondary,comment,content,
 * constant,selective,selectiveLogic,order,position,disable,probability,
 * useProbability,depth,group,groupOverride,groupWeight,caseSensitive,
 * matchWholeWords,extensions}}}。
 * placement/placementPosition/depth 同时原样写出, 供本机重导入还原
 * (ST 会忽略它不认识的顶层字段)。 */
function exportST(list){
  var entries = {};
  (list || []).forEach(function(raw, i){
    var e = normalize(raw, i);
    var uid = str(e.id) || ("lore" + i);
    var prob = (e.probability == null ? 100 : +e.probability);
    var grp = (e.inclusionGroup || []).join(",");
    entries[uid] = {
      uid: uid,
      key: e.key || [],
      keysecondary: e.keysecondary || [],
      comment: e.comment || "",
      content: e.content || "",
      constant: !!e.constant,
      selective: (e.keysecondary || []).length > 0,
      selectiveLogic: (e.selectiveLogic == null ? 0 : +e.selectiveLogic),
      order: (e.priority == null ? (i + 1) : +e.priority),
      position: placementToStPosition(e.placement, e.placementPosition),
      disable: e.enabled === false,
      probability: prob,
      useProbability: prob < 100,
      depth: (e.depth == null ? null : +e.depth),
      group: grp,
      groupOverride: !!e.prioritizeInclusion,
      groupWeight: (e.groupWeight == null ? 100 : +e.groupWeight),
      caseSensitive: !!e.case_sensitive,
      matchWholeWords: !!e.matchWholeWords,
      placement: e.placement || "default",
      placementPosition: e.placementPosition || "after",
      extensions: (e.extensions && typeof e.extensions === "object") ? e.extensions : {}
    };
  });
  return {entries: entries};
}

return {
  SELECTIVE: SELECTIVE,
  SELECTIVE_NAMES: SELECTIVE_NAMES,
  PLACEMENTS: PLACEMENTS,
  PLACEMENT_ANCHOR: PLACEMENT_ANCHOR,
  EVENT_FIELD_LABELS: EVENT_FIELD_LABELS,
  LORE_MAX_HITS: LORE_MAX_HITS,
  normalize: normalize,
  normalizeAll: normalizeAll,
  keyMatches: keyMatches,
  match: match,
  matchMessages: matchMessages,
  build: build,
  importST: importST,
  exportST: exportST,
  estTokens: estTokens
};
})();
