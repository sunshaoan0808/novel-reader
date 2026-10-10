/* Soul 数据层 - WorldLines 式角色灵魂包 (纯前端实现)
 *
 * 结构 (存 card.extensions.soul):
 *   soul_md      散文宪章 [不可变]
 *   persona/     心理内核 [不可变]
 *   background/  来历 [不可变]
 *   rules/       决策护栏 [不可变]
 *   character/   RPG 数值 [可写]
 *   memory/      记忆 [可写] (含角色视角 + 情感记忆)
 *   trajectory/  行动日志 [可写] (append-only, 自动压缩)
 *
 * 写保护: 任何经 RP_SOUL.write 的写入自动拦截不可变路径。
 */

var RP_SOUL = (function(){
"use strict";

var SCHEMA_V = 1;

/* 不可变路径前缀 (写保护) */
var IMMUTABLE_PREFIXES = [
  "soul_md",
  "persona",
  "background",
  "rules"
];

/* 可写顶层 key */
var MUTABLE_TOP = ["character", "memory", "trajectory"];

/* trajectory 上限 */
var TRAJ_MAX = 200;        /* 超过触发压缩 */
var TRAJ_KEEP_RAW = 50;    /* 压缩后保留最近 N 条原文 */
var TRAJ_SIZE_CAP = 100 * 1024; /* 单 soul trajectory 100KB 硬上限 */

/* ---- 内部工具 ---- */

function isImmutablePath(path){
  var p = String(path || "");
  for(var i = 0; i < IMMUTABLE_PREFIXES.length; i++){
    var pre = IMMUTABLE_PREFIXES[i];
    if(p === pre || p.indexOf(pre + ".") === 0 || p.indexOf(pre + "/") === 0) return true;
  }
  return false;
}

function getPath(obj, path){
  var parts = String(path).split(".");
  var cur = obj;
  for(var i = 0; i < parts.length; i++){
    if(cur == null || typeof cur !== "object") return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function setPath(obj, path, val){
  var parts = String(path).split(".");
  var cur = obj;
  for(var i = 0; i < parts.length - 1; i++){
    var k = parts[i];
    if(cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
}

function deepClone(o){
  try{ return JSON.parse(JSON.stringify(o)); }catch(e){ return o; }
}

/* 从 card 取 extensions.soul (不存在返回 null) */
function getSoul(card){
  try{
    var ext = (card && card.extensions) || ((card && card.raw && card.raw.extensions)) || {};
    var s = ext.soul;
    if(s && typeof s === "object") return s;
    /* 兼容 raw.extensions 直挂 */
    if(card && card.raw && card.raw.extensions && card.raw.extensions.soul) return card.raw.extensions.soul;
    return null;
  }catch(e){ return null; }
}

/* 确保 card.extensions.soul 存在, 返回 soul 对象 (可写引用) */
function ensureSoul(card){
  /* 先收养已存在的 soul（包括 raw.extensions 里的导入残留），避免建空对象盖掉导入数据 */
  var existing = getSoul(card);
  if(existing && typeof existing === "object"){
    card.extensions = card.extensions || {};
    if(card.extensions.soul !== existing) card.extensions.soul = existing;
    return existing;
  }
  card.extensions = card.extensions || {};
  card.extensions.soul = blankSoul();
  return card.extensions.soul;
}

/* 空 soul 包 */
function blankSoul(){
  return {
    schema_version: SCHEMA_V,
    soul_md: "",
    persona: {core_traits: [], motivations: [], values: [], relationships: {}},
    background: {origin: "", history: "", secrets: ""},
    character: {stats: {}, inventory: [], status: {}},
    rules: {decision: "", interaction: "", action: ""},
    memory: {
      short_term: {context: {}, recent: []},
      long_term: {facts: [], emotional: [], by_perspective: {}}
    },
    trajectory: [],
    character_book: []
  };
}

/* ---- 对外 API ---- */

/* 从现有角色卡生成基础 soul 包 (确定性, 不调 LLM)
 * persona 从卡片字段映射, background/rules 留空待用户补 */
function fromCard(card){
  var s = blankSoul();
  var f = (card && card.fields) || {};
  var desc = String((card && card.description) || "");
  var pers = String((card && card.personality) || "");

  /* soul_md: 用描述+性格拼宪章初稿 */
  var md = [];
  if(desc) md.push(desc);
  if(pers) md.push(pers);
  s.soul_md = md.join("\n\n");

  /* persona.core_traits: 尝试从 personality 拆条目 */
  if(pers){
    var traits = pers.split(/[,，、;；]/).map(function(t){ return t.trim(); })
      .filter(function(t){ return t.length > 0 && t.length < 30; }).slice(0, 8);
    s.persona.core_traits = traits.map(function(t){ return {trait: t, intensity: 60, description: ""}; });
  }

  /* background.origin: 用 scenario 填充 */
  var sc = String((card && card.scenario) || "");
  if(sc) s.background.origin = sc;

  /* character.stats: 保留卡片已有数值字段 */
  ["hp", "mp", "atk", "def", "level", "exp"].forEach(function(k){
    if(f[k] != null) s.character.stats[k] = f[k];
  });

  return s;
}

/* 写保护的写入: path 如 "memory.long_term.facts"
 * 返回 {ok, reason} */
function write(card, path, value){
  if(isImmutablePath(path)){
    return {ok: false, reason: "immutable: " + path};
  }
  var top = String(path).split(".")[0];
  if(MUTABLE_TOP.indexOf(top) < 0){
    return {ok: false, reason: "unknown top-level: " + top};
  }
  try{
    var soul = ensureSoul(card);
    setPath(soul, path, deepClone(value));
    return {ok: true};
  }catch(e){
    return {ok: false, reason: String(e && e.message || e)};
  }
}

/* 读取 (不可变区也可读) */
function read(card, path){
  var soul = getSoul(card);
  if(!soul) return undefined;
  if(!path) return deepClone(soul);
  return deepClone(getPath(soul, path));
}

/* 角色专属世界书: 只有该 soul 可见的私有知识 */
function addLore(card, keys, content){
  var soul = getSoul(card);
  if(!soul || !content) return false;
  soul.character_book = soul.character_book || [];
  soul.character_book.push({
    keys: Array.isArray(keys) ? keys : [String(keys)],
    content: String(content).slice(0, 2000),
    enabled: true,
    t: new Date().toISOString()
  });
  return true;
}
function getLore(card){
  var soul = getSoul(card);
  return soul ? (soul.character_book || []) : [];
}
function matchLore(card, text){
  var book = getLore(card);
  var t = String(text || "").toLowerCase();
  return book.filter(function(e){
    if(e.enabled === false) return false;
    return (e.keys || []).some(function(k){
      return t.indexOf(String(k).toLowerCase()) >= 0;
    });
  });
}

/* trajectory: 追加一条 {t, actor, action, result} */
function log(card, actor, action, result){
  var soul = ensureSoul(card);
  soul.trajectory = soul.trajectory || [];
  soul.trajectory.push({
    t: new Date().toISOString(),
    actor: String(actor || ""),
    action: String(action || ""),
    result: String(result == null ? "" : result)
  });
  /* 超限自动压缩 (同步压缩摘要位, LLM 摘要延迟到后台) */
  if(soul.trajectory.length > TRAJ_MAX){
    compress(soul, false);
  }
  /* 硬上限: 按字节截断最旧 */
  try{
    var size = JSON.stringify(soul.trajectory).length;
    while(size > TRAJ_SIZE_CAP && soul.trajectory.length > TRAJ_KEEP_RAW){
      soul.trajectory.shift();
      size = JSON.stringify(soul.trajectory).length;
    }
  }catch(e){}
  return soul.trajectory.length;
}

/* trajectory 压缩: 保留最近 N 条原文, 更早的折叠为摘要占位
 * llmSummary: 可选, 已由 LLM 生成的摘要文本 (后台任务传入) */
function compress(soul, llmSummary){
  soul.trajectory = soul.trajectory || [];
  if(soul.trajectory.length <= TRAJ_MAX) return false;
  var cutoff = soul.trajectory.length - TRAJ_KEEP_RAW;
  var old = soul.trajectory.slice(0, cutoff);
  var summary = llmSummary || ("[自动折叠 " + old.length + " 条历史行动]");
  soul.trajectory = [{t: old[0].t, actor: "system", action: "__compressed__", result: summary}]
    .concat(soul.trajectory.slice(cutoff));
  return true;
}

/* 记忆: 添加事实 (带视角) */
function addFact(card, perspective, fact){
  var soul = ensureSoul(card);
  var mem = soul.memory.long_term;
  if(perspective && perspective !== "shared"){
    mem.by_perspective[perspective] = mem.by_perspective[perspective] || [];
    mem.by_perspective[perspective].push({
      t: new Date().toISOString(),
      text: String(fact)
    });
  }else{
    mem.facts.push({t: new Date().toISOString(), text: String(fact)});
  }
}

/* 记忆: 添加情感记忆 */
function addEmotional(card, emotion, text){
  var soul = ensureSoul(card);
  soul.memory.long_term.emotional.push({
    t: new Date().toISOString(),
    emotion: String(emotion || ""),
    text: String(text || "")
  });
}

/* 记忆: 读取 (视角隔离)
 * perspective 为 null 取共享 + 情感; 指定视角追加该视角 */
function getMemory(card, perspective){
  var soul = getSoul(card);
  if(!soul) return {facts: [], emotional: [], perspective: []};
  var lt = soul.memory.long_term;
  return {
    facts: deepClone(lt.facts || []),
    emotional: deepClone(lt.emotional || []),
    perspective: perspective ? deepClone((lt.by_perspective || {})[perspective] || []) : []
  };
}

/* 短期记忆: 场景上下文 */
function setContext(card, ctx){
  return write(card, "memory.short_term.context", ctx || {});
}

/* 绑定 profile (llm 配置) */
function bindProfile(card, profileName){
  card.extensions = card.extensions || {};
  card.extensions.llm = card.extensions.llm || {};
  card.extensions.llm.profile = String(profileName || "");
}

function getProfile(card){
  try{ return ((card.extensions || {}).llm || {}).profile || ""; }
  catch(e){ return ""; }
}

/* 校验 soul 包完整性 */
function validate(card){
  var soul = getSoul(card);
  var issues = [];
  if(!soul){ return {ok: false, issues: ["no soul pack"]}; }
  if(soul.schema_version !== SCHEMA_V){
    issues.push("schema_version mismatch: " + soul.schema_version + " != " + SCHEMA_V);
  }
  ["persona", "background", "character", "rules", "memory", "trajectory"].forEach(function(k){
    if(soul[k] == null) issues.push("missing: " + k);
  });
  return {ok: issues.length === 0, issues: issues};
}

return {
  SCHEMA_V: SCHEMA_V,
  getSoul: getSoul,
  ensureSoul: ensureSoul,
  blankSoul: blankSoul,
  fromCard: fromCard,
  write: write,
  read: read,
  log: log,
  addLore: addLore, getLore: getLore, matchLore: matchLore,
  compress: compress,
  addFact: addFact,
  addEmotional: addEmotional,
  getMemory: getMemory,
  setContext: setContext,
  bindProfile: bindProfile,
  getProfile: getProfile,
  validate: validate,
  isImmutablePath: isImmutablePath
};

})();
if(typeof window !== "undefined") window.RP_SOUL = RP_SOUL;
if(typeof module !== "undefined") module.exports = RP_SOUL;
