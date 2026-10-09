/* Soul 调试/运维扩展 (100条挖掘 E组 66-75)
 * 调用链/错误聚合/火焰图/Mock/沙盒/回归/日志/断点/快照 */

var RP_SOUL_DEBUG = (function(){
"use strict";

/* 66. 调用链: 记录完整调用树 */
var _trace = [];
function tracePush(entry){
  _trace.push(Object.assign({t: new Date().toISOString(), id: "tr" + Date.now().toString(36)}, entry));
  if(_trace.length > 200) _trace.shift();
}
function traceGet(){ return _trace.slice().reverse(); }
function traceClear(){ _trace = []; }
function traceTree(){
  /* 按 turnId 分组 */
  var groups = {};
  _trace.forEach(function(e){
    var k = e.turnId || "unknown";
    groups[k] = groups[k] || [];
    groups[k].push(e);
  });
  return groups;
}

/* 67. 错误聚合 */
function errorSummary(){
  var hist = [];
  try{
    if(typeof RP_SOUL_RT !== "undefined") hist = RP_SOUL_RT.getCallHistory();
  }catch(e){}
  var agg = {};
  hist.forEach(function(h){
    if(!h.ok && h.error){
      var key = String(h.error).slice(0, 40);
      agg[key] = agg[key] || {count: 0, souls: [], last: ""};
      agg[key].count++;
      if(agg[key].souls.indexOf(h.soul) < 0) agg[key].souls.push(h.soul);
      agg[key].last = h.t;
    }
  });
  return Object.keys(agg).map(function(k){
    return {error: k, count: agg[k].count, souls: agg[k].souls, last: agg[k].last};
  }).sort(function(a, b){ return b.count - a.count; });
}

/* 68. 火焰图数据: 各阶段耗时 */
function flameData(){
  var groups = traceTree();
  return Object.keys(groups).map(function(turnId){
    var calls = groups[turnId];
    var total = calls.reduce(function(a, c){ return a + (c.ms || 0); }, 0);
    return {turnId: turnId, total: total,
      calls: calls.map(function(c){ return {soul: c.soul, ms: c.ms || 0,
        pct: total ? Math.round((c.ms || 0) / total * 100) : 0}; })};
  });
}

/* 69. Mock 模式 */
var _mock = false;
var _mockReplies = {};
function setMock(on){ _mock = !!on; }
function isMock(){ return _mock; }
function setMockReply(soulName, reply){ _mockReplies[soulName] = reply; }
function getMockReply(soulName){
  return _mockReplies[soulName] || {dialogue: "（Mock 回复）", action: "", inner: "", silence: false};
}

/* 70. 沙盒测试: 隔离环境跑 prompt (不污染真实记忆) */
async function sandboxRun(prompt, cfg, callFn){
  /* 沙盒: 只跑 LLM, 不写记忆/trajectory */
  try{
    var raw = await callFn(cfg, [{role: "user", content: prompt}], 0.7);
    var text = (typeof raw === "string") ? raw : (raw.text || "");
    return {ok: true, text: text.slice(0, 2000)};
  }catch(e){
    return {ok: false, error: String(e.message || e)};
  }
}

/* 71. 回归测试用例 */
var _cases = [];
function addCase(name, prompt, expectContains){
  _cases.push({name: name, prompt: prompt, expect: expectContains || []});
}
function getCases(){ return _cases.slice(); }
function clearCases(){ _cases = []; }
async function runCases(cfg, callFn){
  var results = [];
  for(var i = 0; i < _cases.length; i++){
    var c = _cases[i];
    var r = await sandboxRun(c.prompt, cfg, callFn);
    var pass = r.ok && c.expect.every(function(e){
      return r.text.indexOf(e) >= 0;
    });
    results.push({name: c.name, pass: pass, text: (r.text || "").slice(0, 200)});
  }
  return results;
}

/* 72. 日志导出 */
function exportLogs(){
  return {
    trace: traceGet(),
    errors: errorSummary(),
    calls: (function(){
      try{ return (typeof RP_SOUL_RT !== "undefined") ? RP_SOUL_RT.getCallHistory() : []; }
      catch(e){ return []; }
    })(),
    t: new Date().toISOString()
  };
}

/* 73. 实时日志流 (订阅) */
var _subs = [];
function subscribe(fn){ _subs.push(fn); return _subs.length - 1; }
function unsubscribe(id){ _subs[id] = null; }
function emit(level, msg){
  var e = {t: new Date().toISOString(), level: level, msg: String(msg).slice(0, 500)};
  _subs.forEach(function(fn){ try{ if(fn) fn(e); }catch(err){} });
  tracePush({type: "log", level: level, msg: e.msg});
}

/* 74. 断点: 单步执行标记 */
var _breakpoints = {};
function setBreakpoint(soulName, on){
  if(on) _breakpoints[soulName] = true;
  else delete _breakpoints[soulName];
}
function hasBreakpoint(soulName){ return !!_breakpoints[soulName]; }
function getBreakpoints(){ return Object.keys(_breakpoints); }

/* 75. 状态快照 (调试时冻结) */
var _frozen = null;
function freeze(state){
  _frozen = JSON.parse(JSON.stringify(state || {}));
  _frozen.frozenAt = new Date().toISOString();
  return true;
}
function unfreeze(){ var f = _frozen; _frozen = null; return f; }
function isFrozen(){ return !!_frozen; }

return {
  tracePush: tracePush, traceGet: traceGet, traceClear: traceClear, traceTree: traceTree,
  errorSummary: errorSummary, flameData: flameData,
  setMock: setMock, isMock: isMock, setMockReply: setMockReply, getMockReply: getMockReply,
  sandboxRun: sandboxRun,
  addCase: addCase, getCases: getCases, clearCases: clearCases, runCases: runCases,
  exportLogs: exportLogs,
  subscribe: subscribe, unsubscribe: unsubscribe, emit: emit,
  setBreakpoint: setBreakpoint, hasBreakpoint: hasBreakpoint, getBreakpoints: getBreakpoints,
  freeze: freeze, unfreeze: unfreeze, isFrozen: isFrozen
};
})();
if(typeof window !== "undefined") window.RP_SOUL_DEBUG = RP_SOUL_DEBUG;
if(typeof module !== "undefined") module.exports = RP_SOUL_DEBUG;
