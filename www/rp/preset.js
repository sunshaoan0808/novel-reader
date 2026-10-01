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
 * - v1 范围保留: injection_position=chat 的深度注入暂不支持(实测 MoM 预设中没有)。
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
function _saveAll(a){ try{ localStorage.setItem(LS_KEY, JSON.stringify(a)); }catch(e){} }

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
function parseFile(json){
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
  var params = {};
  if(d.temperature != null && isFinite(+d.temperature)) params.temperature = +d.temperature;
  if(d.top_p != null && isFinite(+d.top_p)) params.top_p = +d.top_p;
  var preset = {
    id: "st" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    name: String(d.name || "未命名预设").slice(0, 60),
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
 */
function assemble(preset, parts){
  var msgs = [];
  var scope = newScope();
  var ctx = {charName: parts.charName, userName: parts.userName,
             lastUserMessage: _lastUserMessage(parts), scope: scope};
  (preset.prompts || []).forEach(function(p){
    if(!p || p.enabled === false) return;
    if(p.marker){
      var key = _markerKey(p);
      if(key === "history"){
        (parts.history || []).forEach(function(m){
          if(m && m.content) msgs.push({role: m.role === "assistant" ? "assistant" : "user", content: m.content});
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

window.RP_PRESET = {
  list: list, get: get, save: save, remove: remove,
  parseFile: parseFile, expandMacros: expandMacros, evalMacros: evalMacros,
  newScope: newScope, assemble: assemble, sysTokens: sysTokens,
  LS_KEY: LS_KEY, GLOBALS_KEY: GLOBALS_KEY
};
})();
