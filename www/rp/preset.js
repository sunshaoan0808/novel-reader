/* ST 预设(酒馆 preset)导入与组装。
 * 覆盖: SillyTavern 文本预设 JSON(含 prompts 数组)。导入后按条目顺序组装 prompt,
 * marker 条目( personaDescription / charDescription / charPersonality / scenario /
 * dialogueExamples / worldInfoBefore / worldInfoAfter / chatHistory )替换为 App 侧
 * 对应内容, 其余 enabled 条目按 role 注入, ST 宏做展开/剥离。
 * v1 范围: 只处理数组顺序组装; injection_position=chat 的深度注入暂不支持(实测 MoM
 * 预设中没有这类条目)。
 */
(function(){
"use strict";

var LS_KEY = "nd_stpresets";

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

/* 解析 ST 预设文件 JSON。成功返回 {ok:true, preset}; 失败 {ok:false, err} */
function parseFile(json){
  var d;
  try{ d = (typeof json === "string") ? JSON.parse(json) : json; }
  catch(e){ return {ok: false, err: "json"}; }
  if(!d || !Array.isArray(d.prompts)) return {ok: false, err: "noprompts"};
  var prompts = [];
  d.prompts.forEach(function(p){
    if(!p || p.enabled === false) return;
    var content = String(p.content || "").trim();
    var isMarker = !!p.marker;
    if(!isMarker && !content) return; /* 空条目无意义 */
    var role = (p.role === "user" || p.role === "assistant") ? p.role : "system";
    prompts.push({
      name: String(p.name || ""),
      role: role,
      content: content,
      marker: isMarker,
      identifier: String(p.identifier || "")
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

/* ST 宏展开。charName/userName 为空则用占位; 未知宏一律剥离, 不让字面宏污染 prompt。 */
function expandMacros(text, charName, userName){
  var t = String(text == null ? "" : text);
  var cn = charName || "角色", un = userName || "你";
  t = t.replace(/\{\{\s*char\s*\}\}/gi, cn).replace(/\{\{\s*user\s*\}\}/gi, un);
  /* 时间类给真值 */
  var now = new Date();
  function pad(n){ return (n < 10 ? "0" : "") + n; }
  t = t.replace(/\{\{\s*time\s*\}\}/gi, pad(now.getHours()) + ":" + pad(now.getMinutes()))
       .replace(/\{\{\s*date\s*\}\}/gi, now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()))
       .replace(/\{\{\s*weekday\s*\}\}/gi, "周" + "日一二三四五六".charAt(now.getDay()));
  /* {{pick::a,b,c}} 随机取一个 */
  t = t.replace(/\{\{\s*pick\s*::([\s\S]*?)\}\}/gi, function(m, inner){
    var opts = inner.split(/,(?![^{]*\}\})/).map(function(s){ return s.trim(); }).filter(Boolean);
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : "";
  });
  /* ST 状态机类宏: 剥离 */
  t = t.replace(/\{\{\s*(trim|trimtokens|newline)\s*\}\}/gi, "")
       .replace(/\{\{\s*setvar\s*::[\s\S]*?\}\}/gi, "")
       .replace(/\{\{\s*(getvar|addvar|incvar|decvar)\s*::[\s\S]*?\}\}/gi, "")
       .replace(/\{\{\s*\/\/[\s\S]*?\}\}/gi, "");
  /* 剩余未知宏剥离 */
  t = t.replace(/\{\{[\s\S]*?\}\}/g, "");
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function _markerKey(p){
  if(p.identifier && MARKER_PARTS[p.identifier]) return MARKER_PARTS[p.identifier];
  var n = String(p.name || "").toLowerCase();
  if(n === "chat history") return "history";
  return null;
}

/* 按预设顺序组装 messages。
 * parts: {persona, charDesc, charPers, scenario, examples, loreBefore, lore,
 *         history:[{role,content}], charName, userName}
 * 返回 [{role, content}]，history 在 chatHistory marker 处展开。
 */
function assemble(preset, parts){
  var msgs = [];
  var cn = parts.charName, un = parts.userName;
  preset.prompts.forEach(function(p){
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
    var c = expandMacros(p.content, cn, un);
    if(c) msgs.push({role: p.role, content: c});
  });
  return msgs;
}

/* 预设的非 history 消息 token 估算(供 budget): 复用 RP_PROMPT.estTokens(若可用) */
function sysTokens(preset, parts){
  var est = (typeof RP_PROMPT !== "undefined" && RP_PROMPT.estTokens) ? RP_PROMPT.estTokens
    : function(s){ return Math.ceil(String(s || "").length / 2); };
  var t = 0;
  preset.prompts.forEach(function(p){
    if(p.marker){
      var key = _markerKey(p);
      if(!key || key === "history") return;
      t += est(String(parts[key] || ""));
    }else{
      t += est(expandMacros(p.content, parts.charName, parts.userName));
    }
  });
  return t;
}

window.RP_PRESET = {
  list: list, get: get, save: save, remove: remove,
  parseFile: parseFile, expandMacros: expandMacros,
  assemble: assemble, sysTokens: sysTokens,
  LS_KEY: LS_KEY
};
})();
