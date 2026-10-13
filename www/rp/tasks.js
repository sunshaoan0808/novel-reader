/* RP 引擎: 通用周期分析任务 (借鉴 RUBY Analyzer 任务契约)
 * 每个角色(run)可配多个分析任务:
 *   {id, name, prompt, cycle, keywords[], mode, enabled}
 *   mode: 'constant' 常驻注入 / 'selective' 按需注入(关键词命中时) / 'off' 仅存档
 * 触发: 周期 (自上次运行新增消息数 >= cycle) 或 关键词 (新增消息命中 keywords)
 * 状态: {output, up_to, updatedAt} 存 nd_ataskstate_<run>_<name>_<id>
 * 提示词变量: {{CHAR_NAME}} {{CARD_HINT}} {{PREV_OUTPUT}} {{NEW_DIALOG}}
 * 内置三层记忆仍由 RP_MEM 负责, 本引擎只管自定义任务; 失败绝不打断聊天。
 */
const RP_TASKS = (function(){
"use strict";
var defKey = function(r, n){ return "nd_atasks_" + r + "_" + n; };
var stateKey = function(r, n, id){ return "nd_ataskstate_" + r + "_" + n + "_" + id; };

function getDefs(runId, name){
  try { return JSON.parse(localStorage.getItem(defKey(runId, name))) || []; }
  catch(e){ return []; }
}
function saveDefs(runId, name, defs){
  try { localStorage.setItem(defKey(runId, name), JSON.stringify(defs)); } catch(e){}
}
function getState(runId, name, id){
  try { return JSON.parse(localStorage.getItem(stateKey(runId, name, id))) || null; }
  catch(e){ return null; }
}
function saveState(runId, name, id, st){
  try { localStorage.setItem(stateKey(runId, name, id), JSON.stringify(st)); }
  catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("任务进度保存失败", e); }
}
function clearState(runId, name, id){
  try { localStorage.removeItem(stateKey(runId, name, id)); } catch(e){}
}
function nextId(defs){
  var m = 0;
  defs.forEach(function(d){ var n = parseInt(String(d.id).replace(/[^0-9]/g, "")) || 0; if(n > m) m = n; });
  return "t" + (m + 1);
}
function normDef(d){
  return {
    id: String(d.id || ""),
    name: String(d.name || "未命名任务").slice(0, 30),
    prompt: String(d.prompt || ""),
    cycle: Math.max(0, parseInt(d.cycle) || 0),
    keywords: String(d.keywords || "").split(/[,，、\n]/).map(function(s){ return s.trim(); }).filter(Boolean).slice(0, 20),
    mode: (d.mode === "selective" || d.mode === "off") ? d.mode : "constant",
    enabled: d.enabled !== false
  };
}

function hitKw(text, kws){
  if(!text || !kws.length) return false;
  return kws.some(function(k){ return k && text.indexOf(k) !== -1; });
}

/* 是否触发. 返回 false 或原因字符串 */
function shouldFire(runId, name, def, history){
  if(!def.enabled || !def.prompt) return false;
  var st = getState(runId, name, def.id);
  var up_to = (st && st.up_to) || 0;
  var fresh = history.slice(up_to);
  if(!fresh.length) return false;
  if(def.cycle > 0 && fresh.length >= def.cycle) return "cycle";
  if(def.keywords.length){
    var txt = fresh.map(function(m){ return String(m.content || ""); }).join("\n");
    if(hitKw(txt, def.keywords)) return "keyword";
  }
  return false;
}

function replaceVars(tpl, vars){
  return String(tpl).replace(/\{\{(CHAR_NAME|CARD_HINT|PREV_OUTPUT|NEW_DIALOG)\}\}/g,
    function(m, k){ return vars[k] != null ? vars[k] : m; });
}

function fmtDialog(history, from, name){
  return history.slice(from).map(function(m){
    return (m.role === "user" ? "我" : (m.speaker || name)) + ": " + String(m.content || "").slice(0, 300);
  }).join("\n").slice(0, 8000);
}

/* 跑一轮到期任务. forceId: 强制跑某个任务(忽略触发条件). 返回跑了的任务名数组 */
async function maybeRun(runId, name, history, cfg, callChat, cardHint, forceId){
  var defs = getDefs(runId, name).map(normDef);
  var ran = [];
  for(var i = 0; i < defs.length; i++){
    var def = defs[i];
    var reason = forceId ? (def.id === forceId && def.enabled && def.prompt ? "manual" : false)
                         : shouldFire(runId, name, def, history);
    if(!reason) continue;
    var st = getState(runId, name, def.id);
    var up_to = (st && st.up_to) || 0;
    var dlg = fmtDialog(history, up_to, name);
    if(!dlg.trim()) continue;
    var prompt = replaceVars(def.prompt, {
      CHAR_NAME: name,
      CARD_HINT: cardHint || "",
      PREV_OUTPUT: (st && st.output) || "(无上次输出)",
      NEW_DIALOG: dlg
    });
    var tcfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
    try {
      var out = await callChat(tcfg, [{role: "user", content: prompt}], 0.3);
      if(out && out.trim()){
        saveState(runId, name, def.id, {output: out.trim().slice(0, 2000),
          up_to: history.length, updatedAt: Date.now(), reason: reason});
        ran.push(def.name);
      }
    } catch(e){ /* 失败: 下次重试, 不打断 */ }
  }
  return ran;
}

/* 组装注入 prompt. recentText: 最近用户消息(用于 selective 召回) */
function renderPrompt(runId, name, recentText){
  var defs = getDefs(runId, name).map(normDef);
  var out = "";
  defs.forEach(function(def){
    if(!def.enabled || def.mode === "off") return;
    var st = getState(runId, name, def.id);
    if(!st || !st.output) return;
    if(def.mode === "selective" && !hitKw(recentText, def.keywords)) return;
    out += "【分析:" + def.name + "】\n" + st.output + "\n";
  });
  return out;
}

function describe(def){
  var d = normDef(def);
  var trig = [];
  if(d.cycle > 0) trig.push("每" + d.cycle + "条");
  if(d.keywords.length) trig.push("关键词:" + d.keywords.join("/"));
  var mode = d.mode === "constant" ? "常驻" : (d.mode === "selective" ? "按需" : "存档");
  return (d.enabled ? "" : "[停用]") + d.name + " (" + mode + (trig.length ? ", " + trig.join("+") : ", 手动") + ")";
}

return {getDefs: getDefs, saveDefs: saveDefs, getState: getState, saveState: saveState,
  clearState: clearState, nextId: nextId, normDef: normDef,
  maybeRun: maybeRun, renderPrompt: renderPrompt, describe: describe,
  shouldFire: shouldFire};
})();
