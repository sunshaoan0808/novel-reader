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
  return c;
}

function saveCfg(c){
  localStorage.setItem("nd_distill_llm", JSON.stringify(c));
}

async function chat(messages, opts){
  opts = opts || {};
  var c = cfg();
  if(!c.key) throw new Error("未配置 LLM API Key, 请到设置页填写");
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
        return {content: content, model: models[mi]};
      }catch(e){
        lastErr = e;
        if(attempt < 2) await new Promise(res=>setTimeout(res, 2000 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error("LLM 调用失败");
}

return {cfg: cfg, saveCfg: saveCfg, chat: chat};
})();
