/* Lorebook Keeper (2026-10-07): 借鉴 Marinara-Engine Lorebook Keeper。
 * 聊天后自动从对话中提取重要事实，写入用户世界书 (nd_lore_<runId>)，
 * 世界书越玩越厚。Post-Processing 阶段运行，失败不打断。
 * 设计要点：
 * - 只提取"新事实"（人物关系变化、地点、物品、约定），不提取闲聊
 * - 去重：与已有条目语义重复的不加
 * - 用户可在世界书页删除/编辑 Keeper 加的条目
 */
var AGENT_LOREKEEPER = (function(){
"use strict";

function loreKey(runId){ return "nd_lore_" + runId; }

function getLore(runId){
  try{ return JSON.parse(localStorage.getItem(loreKey(runId)) || "[]"); }
  catch(e){ return []; }
}
function setLore(runId, arr){
  try{ localStorage.setItem(loreKey(runId), JSON.stringify(arr)); }catch(e){}
}

/* 从最近 N 轮对话提取新事实 (LLM) */
async function extractFacts(runId, name, history, callChat, cfg){
  // 取最近 4 轮
  var recent = history.slice(-8).map(function(m){
    return (m.role === "user" ? "用户" : name) + ": " + (m.content || "").slice(0, 500);
  }).join("\n");

  var existing = getLore(runId).map(function(e){ return e.title; }).join("、");

  try{
    var r = await callChat(cfg, [
      {role: "system", content:
        "你是世界书记录员。从对话中提取值得长期记住的新事实。\n" +
        "只提取：人物关系变化、新地点、新物品、约定/承诺、重要事件。\n" +
        "不提取：闲聊、情绪、已有条目 (" + (existing || "无") + ") 中已有的。\n" +
        "返回 JSON 数组，最多3条: [{\"title\":\"短标题\",\"keys\":[\"触发词\"],\"content\":\"事实描述\"}]\n" +
        "无新事实返回 []。只返回 JSON。"},
      {role: "user", content: recent}
    ], 0.3);
    var m = r.match(/\[[\s\S]*\]/);
    if(!m) return [];
    var facts = JSON.parse(m[0]);
    return Array.isArray(facts) ? facts.slice(0, 3) : [];
  }catch(e){ return []; }
}

/* Post-Processing 入口：回复后调用 */
async function onReply(runId, name, history, callChat, cfg){
  // 开关：默认开
  try{
    if(localStorage.getItem("nd_lorekeeper_off") === "1") return {added: 0};
  }catch(e){}
  // 每 4 轮跑一次，避免太频繁
  var count = 0;
  try{ count = parseInt(localStorage.getItem("nd_lorekeeper_count_" + runId) || "0"); }catch(e){}
  count++;
  try{ localStorage.setItem("nd_lorekeeper_count_" + runId, String(count)); }catch(e){}
  if(count % 4 !== 0) return {added: 0};

  var facts = await extractFacts(runId, name, history, callChat, cfg);
  if(!facts.length) return {added: 0};

  var lore = getLore(runId);
  var added = 0;
  facts.forEach(function(f){
    if(!f.title || !f.content) return;
    // 去重：标题相似的不加
    var dup = lore.some(function(e){
      return e.title === f.title ||
        (e.content && f.content && e.content.slice(0, 20) === f.content.slice(0, 20));
    });
    if(dup) return;
    lore.push({
      title: f.title,
      keys: f.keys || [],
      content: f.content,
      priority: 60,
      enabled: true,
      fromKeeper: true,  // 标记为 Keeper 自动加的
      created: Date.now()
    });
    added++;
  });
  if(added) setLore(runId, lore);
  return {added: added, facts: facts};
}

function setEnabled(on){
  try{
    if(on) localStorage.removeItem("nd_lorekeeper_off");
    else localStorage.setItem("nd_lorekeeper_off", "1");
  }catch(e){}
}
function isEnabled(){
  try{ return localStorage.getItem("nd_lorekeeper_off") !== "1"; }
  catch(e){ return true; }
}

return {
  onReply: onReply,
  setEnabled: setEnabled,
  isEnabled: isEnabled
};
})();
