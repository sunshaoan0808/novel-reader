/* App 端蒸馏 LLM 直连客户端 (2026-10-07)。
 * 不走服务器, App 直接调在线 LLM 网关 (OpenAI 兼容接口)。
 * API Key 由用户在设置页填写, 存 localStorage (nd_llm_key)。
 */
var DISTILL_LLM = (function(){
"use strict";

function cfg(){
  var c = {baseUrl: "https://zen.claw.ssan.me/v1", key: "", model: "mimo-v2.6-flash-free"};
  try{
    var s = JSON.parse(localStorage.getItem("nd_distill_llm") || "{}");
    if(s.baseUrl) c.baseUrl = s.baseUrl;
    if(s.key) c.key = s.key;
    if(s.model) c.model = s.model;
  }catch(e){}
  /* 复用主设置页已配置的 LLM（用户投诉：蒸馏不应再填一遍 Key）。
     优先级：蒸馏独立配置 > 主设置 nd_api_cfg_v1 */
  if(!c.key){
    try{
      var main = JSON.parse(localStorage.getItem("nd_api_cfg_v1") || "{}");
      if(main.key){ c.key = main.key; c._fromMain = true; }
      if(main.base && !s.baseUrl) c.baseUrl = main.base;
      if(main.model && !s.model) c.model = main.model;
    }catch(e){}
  }
  return c;
}

function saveCfg(c){
  localStorage.setItem("nd_distill_llm", JSON.stringify(c));
}

// 调用统计
var _stats = {calls: 0, errors: 0, totalMs: 0, startTime: 0};
function getStats(){
  return {calls: _stats.calls, errors: _stats.errors, totalMs: _stats.totalMs};
}
function resetStats(){
  _stats.calls = 0; _stats.errors = 0; _stats.totalMs = 0; _stats.startTime = 0;
}
function fmtStats(){
  var s = (_stats.totalMs / 1000).toFixed(0);
  return "调用 " + _stats.calls + " 次" + (_stats.errors ? " (失败 " + _stats.errors + ")" : "") + " · 耗时 " + s + "s";
}

async function chat(messages, opts){
  opts = opts || {};
  var c = cfg();
  if(!c.key) throw new Error("未配置 LLM API Key, 请到设置页填写");
  _stats.calls++;
  var t0 = Date.now();
  var model = opts.model || c.model;
  var url = c.baseUrl.replace(/\/$/, "") + "/chat/completions";
  var lastErr = null;
  var models = [model];
  // fallback
  if(model !== "mimo-v2.5-free") models.push("mimo-v2.5-free");
  for(var mi = 0; mi < models.length; mi++){
    for(var attempt = 0; attempt < 3; attempt++){
      try{
        var r = await fetch(url, {
          method: "POST",
          headers: {"Content-Type": "application/json", "Authorization": "Bearer " + c.key},
          body: JSON.stringify({model: models[mi], messages: messages, temperature: opts.temp || 0.7})
        });
        if(!r.ok) throw new Error("HTTP " + r.status);
        var d = await r.json();
        var content = (((d.choices || [])[0] || {}).message || {}).content || "";
        if(!content.trim()) throw new Error("空正文");
        _stats.totalMs += Date.now() - t0;
        return {content: content, model: models[mi]};
      }catch(e){
        lastErr = e;
        if(attempt < 2) await new Promise(res=>setTimeout(res, 2000 * (attempt + 1)));
      }
    }
  }
  _stats.errors++;
  _stats.totalMs += Date.now() - t0;
  throw lastErr || new Error("LLM 调用失败");
}

return {cfg: cfg, saveCfg: saveCfg, chat: chat, getStats: getStats, resetStats: resetStats, fmtStats: fmtStats};
})();
