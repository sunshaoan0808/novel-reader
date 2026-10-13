/* ST 预设(酒馆 preset)导入与组装。
 * 覆盖: SillyTavern 文本预设 JSON(含 prompts 数组)。导入后按条目顺序组装 prompt,
 * marker 条目( personaDescription / charDescription / charPersonality / scenario /
 * dialogueExamples / worldInfoBefore / worldInfoAfter / chatHistory )替换为 App 侧
 * 对应内容, 其余 enabled 条目按 role 注入。
 *
 * v2 (2026-10-01):
 * - 保留全部条目(含 disabled)及其 enabled 状态, 设置页可逐条开关并持久化。
 * - 变量宏按条目顺序在单次组装内求值: setvar/getvar/addvar/incvar/decvar
 *   (局部) + setglobalvar/getglobalvar (全局, localStorage 持久化)。
 *   另支持 MoM 实测出现的全部宏: trim/newline/pick/random/user/char/
 *   time/date/weekday/lastUserMessage/注释。未知宏剥离。
 * - v2 范围保留: injection_position=chat 的深度注入暂不支持(实测 MoM 预设中没有)。
 * - v3 (2026-10-03): ST 任意组合。assemble() 支持 injection_position=chat 按
 *   injection_depth 注入历史(0=紧贴末尾); 新增条目增删改排 API
 *   (addEntry/updateEntry/moveEntry/deleteEntry), 自定义条目走同一套组装与宏求值。
 */
(function(){
"use strict";

var LS_KEY = "nd_stpresets";
var GLOBALS_KEY = "nd_stglobalvars";

/* identifier -> parts 键 */
var MARKER_PARTS = {
  personaDescription: "persona",
  charDescription: "charDesc",
  charPersonality: "charPers",
  scenario: "scenario",
  dialogueExamples: "examples",
  worldInfoBefore: "loreBefore",
  worldInfoAfter: "lore",
  chatHistory: "history"
};

function _load(){
  try{ var a = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch(e){ return []; }
}
function _saveAll(a){ try{ localStorage.setItem(LS_KEY, JSON.stringify(a)); }
catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("预设保存失败", e); } }

function list(){ return _load(); }
function get(id){
  if(!id) return null;
  var a = _load();
  for(var i = 0; i < a.length; i++) if(a[i] && a[i].id === id) return a[i];
  return null;
}
function save(p){
  var a = _load(), found = false;
  for(var i = 0; i < a.length; i++) if(a[i] && a[i].id === p.id){ a[i] = p; found = true; break; }
  if(!found) a.push(p);
  _saveAll(a);
}
function remove(id){ _saveAll(_load().filter(function(p){ return !p || p.id !== id; })); }

/* 全局变量存取(ST setglobalvar/getglobalvar, 跨会话持久化) */
function _getGlobals(){
  try{ var g = JSON.parse(localStorage.getItem(GLOBALS_KEY) || "{}"); return (g && typeof g === "object") ? g : {}; }
  catch(e){ return {}; }
}
function _setGlobals(g){ try{ localStorage.setItem(GLOBALS_KEY, JSON.stringify(g)); }catch(e){} }

/* 解析 ST 预设文件 JSON。保留全部条目(含 disabled)与 enabled 状态, 供逐条开关。
 * 成功返回 {ok:true, preset}; 失败 {ok:false, err} */
function parseFile(json, fallbackName){
  var d;
  try{ d = (typeof json === "string") ? JSON.parse(json) : json; }
  catch(e){ return {ok: false, err: "json"}; }
  if(!d || !Array.isArray(d.prompts)) return {ok: false, err: "noprompts"};
  var prompts = [];
  d.prompts.forEach(function(p, idx){
    if(!p) return;
    var content = String(p.content == null ? "" : p.content);
    var isMarker = !!p.marker;
    var role = (p.role === "user" || p.role === "assistant") ? p.role : "system";
    var ext = p.extension || {};
    prompts.push({
      name: String(p.name || ("条目" + (idx + 1))),
      role: role,
      content: content,
      marker: isMarker,
      identifier: String(p.identifier || ""),
      enabled: p.enabled !== false,
      group: String(ext.entryGrouping || p.entryGrouping || ""),
      injection_position: p.injection_position || "",
      injection_depth: (p.injection_depth == null ? null : +p.injection_depth),
      pos: idx
    });
  });
  if(!prompts.length) return {ok: false, err: "empty"};
  /* ST 的 prompt_order 才是实际生效的配置（按角色覆盖启用状态和排序）。
   * 忽略它会导致多启用几十条、prompt 体积失控。取第一条 prompt_order
   * （导入的预设通常只有一条模板），按它的 enabled 和顺序重排。 */
  try{
    var po = d.prompt_order;
    if(Array.isArray(po) && po.length && Array.isArray(po[0].order) && po[0].order.length){
      var orderMap = {}, orderIdx = {};
      po[0].order.forEach(function(o, i){
        if(!o || !o.identifier) return;
        orderMap[o.identifier] = (o.enabled !== false);
        orderIdx[o.identifier] = i;
      });
      var hasAny = prompts.some(function(p){ return p.identifier in orderMap; });
      /* 只有 prompt_order 覆盖了大部分条目时才采用；残缺的 order（比如只含
       * 十几条）是导出时的角色残留，不能覆盖全局启用状态。 */
      var coverCount = prompts.filter(function(p){ return p.identifier in orderMap; }).length;
      if(hasAny && coverCount >= prompts.length * 0.8){
        prompts.forEach(function(p){
          if(p.identifier in orderMap) p.enabled = orderMap[p.identifier];
        });
        prompts.sort(function(a, b){
          var ia = (a.identifier in orderIdx) ? orderIdx[a.identifier] : 1e9;
          var ib = (b.identifier in orderIdx) ? orderIdx[b.identifier] : 1e9;
          return ia - ib;
        });
        prompts.forEach(function(p, i){ p.pos = i; });
      }
    }
  }catch(e){}
  var params = {};
  if(d.temperature != null && isFinite(+d.temperature)) params.temperature = +d.temperature;
  if(d.top_p != null && isFinite(+d.top_p)) params.top_p = +d.top_p;
  var preset = {
    id: "st" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    name: String(d.name || fallbackName || "未命名预设").slice(0, 60),
    at: Date.now(),
    params: params,
    prompts: prompts
  };
  return {ok: true, preset: preset};
}

/* 新变量作用域(单次组装内有效) */
function newScope(){ return {vars: {}}; }

function _num(x){ var n = Number(String(x).trim()); return isNaN(n) ? null : n; }

/* ST 宏求值: 按文本顺序单遍扫描, 变量宏在 ctx.scope 内即时生效。
 * ctx: {charName, userName, lastUserMessage, scope} */
function evalMacros(text, ctx){
  var t = String(text == null ? "" : text);
  ctx = ctx || {};
  var scope = ctx.scope || newScope();
  var cn = ctx.charName || "角色", un = ctx.userName || "你";
  var now = new Date();
  function pad(n){ return (n < 10 ? "0" : "") + n; }
  t = t.replace(/\{\{([\s\S]*?)\}\}/g, function(m, inner){
    var parts = String(inner).split("::");
    var name = parts[0].trim().toLowerCase();
    var args = parts.slice(1);
    var rest = args.join("::");
    switch(name){
      case "char": return cn;
      case "user": return un;
      case "time": return pad(now.getHours()) + ":" + pad(now.getMinutes());
      case "date": return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
      case "weekday": return "周" + "日一二三四五六".charAt(now.getDay());
      case "trim": case "trimtokens": return "";
      case "newline": return "\n";
      case "pick": case "random": {
        var opts = rest.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
        return opts.length ? opts[Math.floor(Math.random() * opts.length)] : "";
      }
      case "setvar": {
        var vn = (args[0] || "").trim();
        if(vn) scope.vars[vn] = args.slice(1).join("::");
        return "";
      }
      case "getvar": {
        var gv = scope.vars[rest.trim()];
        return gv == null ? "" : String(gv);
      }
      case "addvar": {
        var an = (args[0] || "").trim();
        var av = args.slice(1).join("::");
        if(an){
          var cur = scope.vars[an]; if(cur == null) cur = "";
          var n1 = _num(cur), n2 = _num(av);
          scope.vars[an] = (n1 !== null && n2 !== null && String(cur).trim() !== "") ? String(n1 + n2) : String(cur) + av;
        }
        return "";
      }
      case "incvar": case "decvar": {
        var kn = rest.trim();
        if(kn){
          var cv = _num(scope.vars[kn]); if(cv === null) cv = 0;
          scope.vars[kn] = String(cv + (name === "incvar" ? 1 : -1));
        }
        return "";
      }
      case "setglobalvar": {
        var sgn = (args[0] || "").trim();
        if(sgn){ var g = _getGlobals(); g[sgn] = args.slice(1).join("::"); _setGlobals(g); }
        return "";
      }
      case "getglobalvar": {
        var ggv = _getGlobals()[rest.trim()];
        return ggv == null ? "" : String(ggv);
      }
      case "lastusermessage": {
        var lum = ctx.lastUserMessage;
        return lum == null ? "" : String(lum);
      }
      default:
        /* {{// 注释}} 与未知宏: 剥离, 不让字面宏污染 prompt */
        return "";
    }
  });
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* 单文本宏展开(无跨条目变量, 兼容旧调用) */
function expandMacros(text, charName, userName){
  return evalMacros(text, {charName: charName, userName: userName, scope: newScope()});
}

function _markerKey(p){
  if(p.identifier && MARKER_PARTS[p.identifier]) return MARKER_PARTS[p.identifier];
  var n = String(p.name || "").toLowerCase();
  if(n === "chat history") return "history";
  return null;
}

function _lastUserMessage(parts){
  if(parts.lastUserMessage != null) return parts.lastUserMessage;
  var h = parts.history || [];
  for(var i = h.length - 1; i >= 0; i--)
    if(h[i] && h[i].role !== "assistant" && h[i].content) return h[i].content;
  return "";
}

/* 按预设顺序组装 messages。disabled 条目跳过; 变量宏在单次组装内按顺序求值。
 * parts: {persona, charDesc, charPers, scenario, examples, loreBefore, lore,
 *         history:[{role,content}], charName, userName, lastUserMessage?}
 * 返回 [{role, content}]，history 在 chatHistory marker 处展开。
 * ST 任意组合: injection_position==="chat" 的条目按 injection_depth 注入历史中
 * (depth=N 表示插在历史末尾 N 条消息之前, 0=紧贴末尾)。
 */
function assemble(preset, parts){
  var msgs = [];
  var scope = newScope();
  var ctx = {charName: parts.charName, userName: parts.userName,
             lastUserMessage: _lastUserMessage(parts), scope: scope};
  var chatInj = [];   // 聊天深度注入条目, 按预设顺序稍后处理
  var histStart = -1, histMsgIdx = []; // 历史块起点 + 纯聊天消息在 msgs 中的下标
  (preset.prompts || []).forEach(function(p){
    if(!p || p.enabled === false) return;
    if(!p.marker && p.injection_position === "chat"){ chatInj.push(p); return; }
    if(p.marker){
      var key = _markerKey(p);
      if(key === "history"){
        histStart = msgs.length;
        (parts.history || []).forEach(function(m){
          if(m && m.content){ histMsgIdx.push(msgs.length); msgs.push({role: m.role === "assistant" ? "assistant" : "user", content: m.content}); }
        });
        return;
      }
      var text = key ? String(parts[key] || "") : "";
      if(text) msgs.push({role: "system", content: text});
      return;
    }
    var c = evalMacros(p.content, ctx);
    if(c) msgs.push({role: p.role, content: c});
  });
  /* 聊天深度注入: depth 按纯聊天消息计数(已注入的条目不计入), 按预设顺序逐个插入 */
  chatInj.forEach(function(p){
    var c = evalMacros(p.content, ctx);
    if(!c) return;
    var depth = (p.injection_depth == null || !isFinite(+p.injection_depth)) ? 0
      : Math.max(0, Math.floor(+p.injection_depth));
    if(histStart < 0){ msgs.push({role: p.role, content: c}); return; }
    var n = histMsgIdx.length, at;
    if(depth <= 0) at = n ? histMsgIdx[n - 1] + 1 : histStart; // 0=紧贴历史末尾
    else if(depth >= n) at = histStart;
    else at = histMsgIdx[n - depth];
    msgs.splice(at, 0, {role: p.role, content: c});
    for(var i = 0; i < histMsgIdx.length; i++) if(histMsgIdx[i] >= at) histMsgIdx[i]++;
  });
  return msgs;
}

/* 预设的非 history 消息 token 估算(供 budget): 复用 RP_PROMPT.estTokens(若可用) */
function sysTokens(preset, parts){
  var est = (typeof RP_PROMPT !== "undefined" && RP_PROMPT.estTokens) ? RP_PROMPT.estTokens
    : function(s){ return Math.ceil(String(s || "").length / 2); };
  var scope = newScope();
  var ctx = {charName: parts.charName, userName: parts.userName,
             lastUserMessage: _lastUserMessage(parts), scope: scope};
  var t = 0;
  (preset.prompts || []).forEach(function(p){
    if(!p || p.enabled === false) return;
    if(p.marker){
      var key = _markerKey(p);
      if(!key || key === "history") return;
      t += est(String(parts[key] || ""));
    }else{
      t += est(evalMacros(p.content, ctx));
    }
  });
  return t;
}

/* ---- ST 任意组合: 条目增删改排 (Prompt Manager) ---- */
/* 规范化一条自定义/导入条目 */
function normEntry(e, idx){
  e = e || {};
  var role = (e.role === "user" || e.role === "assistant") ? e.role : "system";
  var ip = (e.injection_position === "chat") ? "chat" : "";
  var idp = (e.injection_depth == null || !isFinite(+e.injection_depth)) ? 0
    : Math.max(0, Math.floor(+e.injection_depth));
  return {
    name: String(e.name || ("条目" + (idx + 1))).slice(0, 60),
    role: role,
    content: String(e.content == null ? "" : e.content),
    marker: !!e.marker,
    identifier: String(e.identifier || ""),
    enabled: e.enabled !== false,
    group: String(e.group || e.entryGrouping || "自定义"),
    injection_position: ip,
    injection_depth: ip === "chat" ? idp : null,
    pos: idx
  };
}
function _rePos(p){
  (p.prompts || []).forEach(function(e, k){ if(e) e.pos = k; });
}
function addEntry(pid, entry){
  var p = get(pid); if(!p) return null;
  p.prompts = p.prompts || [];
  p.prompts.push(normEntry(entry, p.prompts.length));
  save(p); return p;
}
function updateEntry(pid, i, fields){
  var p = get(pid), e = p && p.prompts[i]; if(!e) return null;
  fields = fields || {};
  if(fields.name != null) e.name = String(fields.name).slice(0, 60) || e.name;
  if(fields.role === "user" || fields.role === "assistant" || fields.role === "system") e.role = fields.role;
  if(fields.content != null) e.content = String(fields.content);
  if(fields.enabled != null) e.enabled = !!fields.enabled;
  if(fields.injection_position === "chat" || fields.injection_position === ""){
    e.injection_position = fields.injection_position;
    e.injection_depth = fields.injection_position === "chat"
      ? Math.max(0, Math.floor(+fields.injection_depth || 0)) : null;
  }
  save(p); return e;
}
function moveEntry(pid, i, delta){
  var p = get(pid); if(!p || !p.prompts) return null;
  var j = i + delta;
  if(j < 0 || j >= p.prompts.length) return p;
  var t = p.prompts[i]; p.prompts[i] = p.prompts[j]; p.prompts[j] = t;
  _rePos(p); save(p); return p;
}
function deleteEntry(pid, i){
  var p = get(pid); if(!p || !p.prompts || !p.prompts[i]) return null;
  p.prompts.splice(i, 1); _rePos(p); save(p); return p;
}

window.RP_PRESET = {
  list: list, get: get, save: save, remove: remove,
  parseFile: parseFile, expandMacros: expandMacros, evalMacros: evalMacros,
  newScope: newScope, assemble: assemble, sysTokens: sysTokens,
  addEntry: addEntry, updateEntry: updateEntry, moveEntry: moveEntry,
  deleteEntry: deleteEntry, normEntry: normEntry,
  LS_KEY: LS_KEY, GLOBALS_KEY: GLOBALS_KEY
};
})();
