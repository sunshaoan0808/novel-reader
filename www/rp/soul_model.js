/* Soul 模型/成本扩展 (100条挖掘 D组 51-65)
 * 测速/自动选择/预警/分摊/额度/故障转移/批量测试/评分/预设/黑名单/智能降级/去重/流式/对比 */

var RP_SOUL_MODEL = (function(){
"use strict";

function _profiles(){
  try{
    if(typeof RP_SOUL_CFG !== "undefined") return RP_SOUL_CFG.list();
  }catch(e){}
  return [];
}
function _store(k, v){
  try{
    if(v === undefined) return localStorage.getItem(k);
    if(v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }catch(e){ return null; }
}

/* 51. 测速: 记录各 profile 延迟 */
function recordSpeed(name, ms){
  try{
    var k = "nd_soul_speed";
    var o = JSON.parse(_store(k) || "{}");
    o[name] = o[name] || {samples: []};
    o[name].samples.push(ms);
    if(o[name].samples.length > 20) o[name].samples.shift();
    o[name].avg = Math.round(o[name].samples.reduce(function(a, b){ return a + b; }, 0) / o[name].samples.length);
    _store(k, o);
  }catch(e){}
}
function getSpeeds(){
  try{ return JSON.parse(_store("nd_soul_speed") || "{}"); }
  catch(e){ return {}; }
}

/* 52. 自动选择: 按任务类型选模型 (chat=对话, think=思考, gen=生成) */
function autoPick(task){
  var speeds = getSpeeds();
  var profiles = _profiles();
  if(!profiles.length) return null;
  /* think 用最快的, gen 用第一个, chat 用评分最高的 */
  if(task === "think"){
    var best = null, bestMs = 1e9;
    profiles.forEach(function(p){
      var s = speeds[p.name];
      var ms = s ? s.avg : 5000;
      if(ms < bestMs){ bestMs = ms; best = p; }
    });
    return best || profiles[0];
  }
  if(task === "gen") return profiles[0];
  /* chat: 评分最高 */
  var ratings = {};
  try{ ratings = JSON.parse(_store("nd_soul_model_rating") || "{}"); }catch(e){}
  var top = profiles[0], topR = -1;
  profiles.forEach(function(p){
    var r = ratings[p.name] || 3;
    if(r > topR){ topR = r; top = p; }
  });
  return top;
}

/* 53. 成本预警 */
function setBudgetAlert(limit){
  _store("nd_soul_budget", String(limit));
}
function checkBudget(){
  try{
    var limit = parseInt(_store("nd_soul_budget") || "0");
    if(!limit) return {over: false};
    var cost = {};
    try{ cost = JSON.parse(_store("nd_soul_cost") || "{}"); }catch(e){}
    var total = 0;
    Object.keys(cost).forEach(function(k){ total += (cost[k].tokens || 0); });
    return {over: total >= limit, used: total, limit: limit,
      pct: Math.round(total / limit * 100)};
  }catch(e){ return {over: false}; }
}

/* 54. 成本分摊: 按 soul 统计 */
function costBySoul(){
  var hist = [];
  try{
    if(typeof RP_SOUL_RT !== "undefined") hist = RP_SOUL_RT.getCallHistory();
  }catch(e){}
  var by = {};
  hist.forEach(function(h){
    by[h.soul] = by[h.soul] || {calls: 0, tokens: 0};
    by[h.soul].calls++;
    by[h.soul].tokens += (h.tokens || 0);
  });
  return by;
}

/* 55. 免费额度追踪 (手动设置每月额度) */
function setFreeQuota(tokens){ _store("nd_soul_quota", String(tokens)); }
function quotaStatus(){
  try{
    var q = parseInt(_store("nd_soul_quota") || "0");
    if(!q) return null;
    var b = checkBudget();
    return {quota: q, used: b.used || 0, left: q - (b.used || 0)};
  }catch(e){ return null; }
}

/* 56. 故障转移: 标记失败的 profile, 下次跳过 */
function markFailed(name){
  try{
    var k = "nd_soul_failed";
    var o = JSON.parse(_store(k) || "{}");
    o[name] = Date.now();
    _store(k, o);
  }catch(e){}
}
function isFailed(name, cooldownMs){
  try{
    var o = JSON.parse(_store("nd_soul_failed") || "{}");
    var t = o[name] || 0;
    return Date.now() - t < (cooldownMs || 300000); /* 默认5分钟冷却 */
  }catch(e){ return false; }
}
function healthyProfiles(){
  return _profiles().filter(function(p){ return !isFailed(p.name); });
}

/* 57. 批量测试: 返回测试计划 (UI 逐个跑) */
function testPlan(){
  return _profiles().map(function(p){ return {name: p.name, model: p.model, status: "pending"}; });
}

/* 58. 模型评分 */
function rateModel(name, score){
  try{
    var o = JSON.parse(_store("nd_soul_model_rating") || "{}");
    o[name] = o[name] || [];
    if(!Array.isArray(o[name])) o[name] = [o[name]];
    o[name].push(score);
    if(o[name].length > 20) o[name].shift();
    /* 存平均分 */
    var avg = o[name].reduce(function(a, b){ return a + b; }, 0) / o[name].length;
    var avgO = JSON.parse(_store("nd_soul_model_avg") || "{}");
    avgO[name] = Math.round(avg * 10) / 10;
    _store("nd_soul_model_avg", avgO);
  }catch(e){}
}
function modelRatings(){
  try{ return JSON.parse(_store("nd_soul_model_avg") || "{}"); }
  catch(e){ return {}; }
}

/* 59. 温度预设 */
var TEMP_PRESETS = {creative: 1.0, balanced: 0.7, precise: 0.3};
function getTempPreset(){ return _store("nd_soul_temp") || "balanced"; }
function setTempPreset(p){ if(TEMP_PRESETS[p] !== undefined) _store("nd_soul_temp", p); }
function tempValue(){ return TEMP_PRESETS[getTempPreset()] || 0.7; }

/* 60. maxTokens 预设 */
var TOK_PRESETS = {short: 300, medium: 800, long: 2000};
function getTokPreset(){ return _store("nd_soul_tok") || "medium"; }
function setTokPreset(p){ if(TOK_PRESETS[p] !== undefined) _store("nd_soul_tok", p); }
function tokValue(){ return TOK_PRESETS[getTokPreset()] || 800; }

/* 61. 黑名单 */
function blacklist(name){ var o = _getBL(); o[name] = 1; _setBL(o); }
function unblacklist(name){ var o = _getBL(); delete o[name]; _setBL(o); }
function isBlacklisted(name){ return !!_getBL()[name]; }
function _getBL(){ try{ return JSON.parse(_store("nd_soul_blacklist") || "{}"); }catch(e){ return {}; } }
function _setBL(o){ _store("nd_soul_blacklist", o); }
function availableProfiles(){
  return _profiles().filter(function(p){ return !isBlacklisted(p.name) && !isFailed(p.name); });
}

/* 62. 智能降级: 按错误类型决定是否重试 */
function shouldRetry(error){
  var e = String(error || "").toLowerCase();
  /* 限流/超时可重试, 认证失败/模型不存在直接降级 */
  if(/rate.?limit|429|timeout|超时/.test(e)) return {retry: true, delay: 2000};
  if(/401|403|unauthorized|not.?found/.test(e)) return {retry: false, fallback: true};
  return {retry: true, delay: 1000};
}

/* 63. 请求去重: 相同 prompt 缓存 */
var _cache = {};
function cacheGet(prompt){
  var k = String(prompt).slice(0, 200);
  var e = _cache[k];
  if(e && Date.now() - e.t < 60000) return e.text; /* 1分钟缓存 */
  return null;
}
function cacheSet(prompt, text){
  var k = String(prompt).slice(0, 200);
  _cache[k] = {t: Date.now(), text: text};
  var keys = Object.keys(_cache);
  if(keys.length > 100) delete _cache[keys[0]];
}
function cacheClear(){ _cache = {}; }

/* 64. 流式开关 */
function setStreaming(on){ _store("nd_soul_stream", on ? "1" : "0"); }
function isStreaming(){ return _store("nd_soul_stream") === "1"; }

/* 65. 模型对比: 生成对比任务描述 */
function comparePlan(prompt, profileNames){
  return {
    prompt: String(prompt).slice(0, 500),
    profiles: (profileNames || []).slice(0, 3),
    t: new Date().toISOString()
  };
}

return {
  recordSpeed: recordSpeed, getSpeeds: getSpeeds,
  autoPick: autoPick,
  setBudgetAlert: setBudgetAlert, checkBudget: checkBudget,
  costBySoul: costBySoul,
  setFreeQuota: setFreeQuota, quotaStatus: quotaStatus,
  markFailed: markFailed, isFailed: isFailed, healthyProfiles: healthyProfiles,
  testPlan: testPlan,
  rateModel: rateModel, modelRatings: modelRatings,
  getTempPreset: getTempPreset, setTempPreset: setTempPreset, tempValue: tempValue,
  TEMP_PRESETS: TEMP_PRESETS,
  getTokPreset: getTokPreset, setTokPreset: setTokPreset, tokValue: tokValue,
  TOK_PRESETS: TOK_PRESETS,
  blacklist: blacklist, unblacklist: unblacklist, isBlacklisted: isBlacklisted,
  availableProfiles: availableProfiles,
  shouldRetry: shouldRetry,
  cacheGet: cacheGet, cacheSet: cacheSet, cacheClear: cacheClear,
  setStreaming: setStreaming, isStreaming: isStreaming,
  comparePlan: comparePlan
};
})();
if(typeof window !== "undefined") window.RP_SOUL_MODEL = RP_SOUL_MODEL;
if(typeof module !== "undefined") module.exports = RP_SOUL_MODEL;
