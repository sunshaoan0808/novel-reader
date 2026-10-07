/* Card Evolution Auditor (2026-10-07): 借鉴 Marinara-Engine Card Evolution Auditor。
 * 观察角色在游玩中的变化，建议改角色卡，但从不自动改。
 * 每条建议都要用户确认后才生效。
 * 存储：localStorage["nd_cardevo_<runId>_<name>"] = [{field, oldVal, newVal, reason, status}]
 * status: pending/accepted/rejected
 */
var AGENT_CARDEVO = (function(){
"use strict";

function keyOf(runId, name){ return "nd_cardevo_" + runId + "_" + name; }

function getSuggestions(runId, name){
  try{ return JSON.parse(localStorage.getItem(keyOf(runId, name)) || "[]"); }
  catch(e){ return []; }
}
function setSuggestions(runId, name, arr){
  try{ localStorage.setItem(keyOf(runId, name), JSON.stringify(arr)); }catch(e){}
}
function pendingCount(runId, name){
  return getSuggestions(runId, name).filter(function(s){ return s.status === "pending"; }).length;
}

/* 后台审计 (每 10 轮跑一次) */
async function audit(runId, name, card, history, callChat, cfg){
  try{
    if(localStorage.getItem("nd_cardevo_off") === "1") return {suggested: 0};
  }catch(e){}
  // 已有太多待处理的不再加
  if(pendingCount(runId, name) >= 5) return {suggested: 0};

  var count = 0;
  try{ count = parseInt(localStorage.getItem("nd_cardevo_count_" + runId + "_" + name) || "0"); }catch(e){}
  count++;
  try{ localStorage.setItem("nd_cardevo_count_" + runId + "_" + name, String(count)); }catch(e){}
  if(count % 10 !== 0) return {suggested: 0};

  var fields = card.fields || {};
  var cardSummary = ["核心特质: " + (fields.core_traits || "未设"),
    "说话风格: " + (fields.speech_style || "未设"),
    "背景: " + (fields.background || "未设")].join("\n");

  var recent = history.slice(-12).map(function(m){
    return (m.role === "user" ? "用户" : name) + ": " + (m.content || "").slice(0, 400);
  }).join("\n");

  try{
    var r = await callChat(cfg, [
      {role: "system", content:
        "你是角色卡审计员。对比角色卡设定和最近对话，判断角色是否有值得更新到卡上的持久变化。\n" +
        "只建议：性格成长/转变、新掌握的技能、关系地位变化、 lasting 的伤/标记。\n" +
        "不建议：一次性情绪、临时状态、剧情细节。\n" +
        "当前卡：\n" + cardSummary + "\n" +
        "返回 JSON 数组，最多2条: [{\"field\":\"core_traits/speech_style/background\",\"suggestion\":\"建议的新描述\",\"reason\":\"理由\"}]\n" +
        "无建议返回 []。只返回 JSON。"},
      {role: "user", content: recent}
    ], 0.3);
    var m = r.match(/\[[\s\S]*\]/);
    if(!m) return {suggested: 0};
    var suggestions = JSON.parse(m[0]);
    if(!Array.isArray(suggestions) || !suggestions.length) return {suggested: 0};

    var existing = getSuggestions(runId, name);
    var added = 0;
    suggestions.slice(0, 2).forEach(function(s){
      if(!s.field || !s.suggestion) return;
      // 去重：同字段待处理的
      var dup = existing.some(function(e){
        return e.field === s.field && e.status === "pending";
      });
      if(dup) return;
      existing.push({
        field: s.field,
        oldVal: fields[s.field] || "",
        newVal: s.suggestion,
        reason: s.reason || "",
        status: "pending",
        created: Date.now()
      });
      added++;
    });
    if(added) setSuggestions(runId, name, existing);
    return {suggested: added};
  }catch(e){ return {suggested: 0}; }
}

/* 用户接受/拒绝 */
function accept(runId, name, idx){
  var arr = getSuggestions(runId, name);
  if(arr[idx]){ arr[idx].status = "accepted"; setSuggestions(runId, name, arr); }
  return arr[idx];
}
function reject(runId, name, idx){
  var arr = getSuggestions(runId, name);
  if(arr[idx]){ arr[idx].status = "rejected"; setSuggestions(runId, name, arr); }
}

function setEnabled(on){
  try{
    if(on) localStorage.removeItem("nd_cardevo_off");
    else localStorage.setItem("nd_cardevo_off", "1");
  }catch(e){}
}

return {
  getSuggestions: getSuggestions,
  pendingCount: pendingCount,
  audit: audit,
  accept: accept,
  reject: reject,
  setEnabled: setEnabled
};
})();
