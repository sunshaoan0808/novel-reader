/* Soul 运行时策略 - 并发/超时/降级/预算统一入口
 *
 * 所有 soul 的 LLM 调用走 RP_SOUL_RT.call(), 不直接裸调。
 * 策略:
 *   - 并发队列: 最多 MAX_CONCURRENT 并行, 超出排队
 *   - per-soul 超时: SOUL_TIMEOUT_MS, 超时按失败处理
 *   - 降级链: soul 绑定 profile -> 全局默认 cfg -> 跳过
 *   - 预算熔断: 单轮 token 上限, 超了拒绝新调用
 *   - per-soul token 计数
 *   - 竞态保护: 调用完成时验证 contextToken 未变
 */

var RP_SOUL_RT = (function(){
"use strict";

function getMaxConcurrent(){
  try{
    var v = parseInt(localStorage.getItem("nd_soul_concurrent") || "3");
    return Math.max(1, Math.min(8, v || 3));
  }catch(e){ return 3; }
}
function getTimeoutMs(){
  try{
    var v = parseInt(localStorage.getItem("nd_soul_timeout") || "60000");
    return Math.max(10000, Math.min(180000, v || 60000));
  }catch(e){ return 60000; }
}
var MAX_CONCURRENT = 3;
var SOUL_TIMEOUT_MS = 60000;
var TURN_TOKEN_BUDGET = 12000; /* 单轮 token 上限 */

/* 并发队列 */
var running = 0;
var queue = [];

function next(){
  while(queue.length > 0 && running < getMaxConcurrent()){
    var job = queue.shift();
    running++;
    job();
  }
}

/* token 计数 (per-soul, per-turn) */
var tokenStats = {}; /* turnId -> {soulName: {prompt, completion, total}} */
var currentTurn = null;

/* 调用历史 (调试用, 最多保留 50 条) */
var callHistory = [];
var CALL_HISTORY_MAX = 50;

function logCall(entry){
  callHistory.push(Object.assign({t: new Date().toISOString()}, entry));
  if(callHistory.length > CALL_HISTORY_MAX) callHistory.shift();
  /* 成本统计 */
  try{
    var ck = "nd_soul_cost";
    var cost = JSON.parse(localStorage.getItem(ck) || "{}");
    var mk = entry.model || "unknown";
    cost[mk] = cost[mk] || {calls: 0, tokens: 0, ms: 0};
    cost[mk].calls++;
    cost[mk].tokens += (entry.tokens || 0);
    cost[mk].ms += (entry.ms || 0);
    localStorage.setItem(ck, JSON.stringify(cost));
  }catch(e){}
}
function getCostStats(){
  try{ return JSON.parse(localStorage.getItem("nd_soul_cost") || "{}"); }
  catch(e){ return {}; }
}
function clearCostStats(){
  try{ localStorage.removeItem("nd_soul_cost"); }catch(e){}
}

function getCallHistory(){
  return callHistory.slice().reverse(); /* 最新的在前 */
}

function clearCallHistory(){
  callHistory = [];
}

function startTurn(turnId){
  currentTurn = turnId;
  tokenStats[turnId] = {};
}

function recordTokens(soulName, usage){
  if(!currentTurn) return;
  var st = tokenStats[currentTurn][soulName] =
    tokenStats[currentTurn][soulName] || {prompt: 0, completion: 0, total: 0};
  if(usage){
    st.prompt += usage.prompt_tokens || 0;
    st.completion += usage.completion_tokens || 0;
    st.total += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  }
}

function turnTotal(){
  if(!currentTurn || !tokenStats[currentTurn]) return 0;
  var sum = 0, m = tokenStats[currentTurn];
  for(var k in m) sum += m[k].total;
  return sum;
}

function getStats(turnId){
  return tokenStats[turnId || currentTurn] || {};
}

/* 超时包装 */
function withTimeout(promise, ms, soulName){
  return new Promise(function(resolve, reject){
    var timer = setTimeout(function(){
      reject(new Error("soul 超时: " + soulName + " (" + ms + "ms)"));
    }, ms);
    promise.then(function(v){
      clearTimeout(timer); resolve(v);
    }, function(e){
      clearTimeout(timer); reject(e);
    });
  });
}

/* 解析 profile 为 cfg {base, key, model} */
function resolveProfile(profileName, defaultCfg){
  /* profiles 存 localStorage nd_api_profiles, 默认回退全局 nd_api_cfg_v1 */
  try{
    var profiles = JSON.parse(localStorage.getItem("nd_api_profiles") || "[]");
    if(profileName){
      for(var i = 0; i < profiles.length; i++){
        if(profiles[i].name === profileName){
          return {
            base: profiles[i].base || defaultCfg.base,
            key: profiles[i].key || defaultCfg.key,
            model: profiles[i].model || defaultCfg.model
          };
        }
      }
    }
  }catch(e){}
  return {base: defaultCfg.base, key: defaultCfg.key, model: defaultCfg.model};
}

/* 核心调用入口
 * opts: {soulName, profile, cfg(全局默认), messages, temperature,
 *        contextToken(竞态保护), onToken(usage 回调)}
 * 返回 {ok, text, usage, model, fallback} */
function callSoul(opts){
  return new Promise(function(resolve){
    queue.push(function(){
      doCall(opts).then(function(r){
        running--; next(); resolve(r);
      }, function(e){
        running--; next();
        resolve({ok: false, error: String(e && e.message || e), soulName: opts.soulName});
      });
    });
    next();
  });
}

async function doCall(opts){
  var soulName = opts.soulName || "unknown";

  /* 预算熔断 */
  if(turnTotal() >= TURN_TOKEN_BUDGET){
    return {ok: false, error: "budget_exceeded", soulName: soulName, skipped: true};
  }

  /* 竞态保护: 开始前检查 */
  var tokenAtStart = opts.contextToken;

  /* 降级链: profile -> 默认 */
  var cfgs = [];
  var pcfg = resolveProfile(opts.profile, opts.cfg || {});
  if(pcfg.base && pcfg.key) cfgs.push({cfg: pcfg, level: "profile"});
  var dcfg = opts.cfg || {};
  if(dcfg.base && dcfg.key){
    /* 去重: profile 和默认相同则只试一次 */
    if(!cfgs.length || cfgs[0].cfg.model !== dcfg.model || cfgs[0].cfg.base !== dcfg.base){
      cfgs.push({cfg: dcfg, level: "default"});
    }
  }
  if(!cfgs.length){
    return {ok: false, error: "no_api_config", soulName: soulName, skipped: true};
  }

  var lastErr = null;
  var startMs = Date.now();
  for(var i = 0; i < cfgs.length; i++){
    try{
      var c = cfgs[i].cfg;
      var p = (typeof RP_NET !== "undefined")
        ? RP_NET.complete(c, opts.messages, opts.temperature, null, {maxTokens: opts.maxTokens, signal: opts.signal})
        : Promise.reject(new Error("RP_NET 未加载"));
      var r = await withTimeout(p, opts.timeoutMs || getTimeoutMs(), soulName);

      /* 竞态保护: 完成后验证 */
      if(opts.contextToken !== undefined && opts.contextToken !== tokenAtStart){
        logCall({soul: soulName, model: c.model, ms: Date.now() - startMs,
                 ok: false, error: "context_changed"});
        return {ok: false, error: "context_changed", soulName: soulName, aborted: true};
      }

      /* r 可能是 string (complete 返回文本) */
      var text = (typeof r === "string") ? r : (r.text || r.content || "");
      if(opts.onToken && r && r.usage) opts.onToken(soulName, r.usage);
      recordTokens(soulName, r && r.usage);
      logCall({soul: soulName, model: c.model, ms: Date.now() - startMs,
               ok: true, fallback: cfgs[i].level,
               tokens: r && r.usage ? (r.usage.total_tokens || 0) : 0});

      return {ok: true, text: text, model: c.model,
              fallback: cfgs[i].level, soulName: soulName};
    }catch(e){
      lastErr = e;
      /* 超时/上下文变化不继续降级 */
      if(/超时|context_changed/.test(String(e && e.message))) break;
    }
  }
  logCall({soul: soulName, model: (cfgs[0] && cfgs[0].cfg.model) || "?",
           ms: Date.now() - startMs, ok: false,
           error: String(lastErr && lastErr.message || lastErr)});
  return {ok: false, error: String(lastErr && lastErr.message || lastErr),
          soulName: soulName};
}

/* Profile 管理 */
function listProfiles(){
  try{ return JSON.parse(localStorage.getItem("nd_api_profiles") || "[]"); }
  catch(e){ return []; }
}

function saveProfiles(list){
  try{ localStorage.setItem("nd_api_profiles", JSON.stringify(list || [])); }
  catch(e){}
}

function getProfile(name){
  var ps = listProfiles();
  for(var i = 0; i < ps.length; i++) if(ps[i].name === name) return ps[i];
  return null;
}

return {
  MAX_CONCURRENT: MAX_CONCURRENT,
  SOUL_TIMEOUT_MS: SOUL_TIMEOUT_MS,
  TURN_TOKEN_BUDGET: TURN_TOKEN_BUDGET,
  callSoul: callSoul,
  startTurn: startTurn,
  turnTotal: turnTotal,
  getStats: getStats,
  recordTokens: recordTokens,
  resolveProfile: resolveProfile,
  listProfiles: listProfiles,
  saveProfiles: saveProfiles,
  getProfile: getProfile,
  getCallHistory: getCallHistory,
  clearCallHistory: clearCallHistory,
  getMaxConcurrent: getMaxConcurrent, getTimeoutMs: getTimeoutMs,
  getCostStats: getCostStats, clearCostStats: clearCostStats
};

})();
if(typeof window !== "undefined") window.RP_SOUL_RT = RP_SOUL_RT;
if(typeof module !== "undefined") module.exports = RP_SOUL_RT;
