/* 可执行剧情运行时：沿 worldcard 导演蓝图（stages/nodes）推进剧情。
 * 纯状态机 + prompt 素材，零 LLM。
 *
 * 导演铁律（本模块自我约束）：
 * 1. 绝不替玩家做决定；2. 绝不写正文/对话/旁白/心理描写；
 * 3. 只做状态推进与 prompt 素材组装。
 * 防剧透：intent 进入 prompt 一律截断 200 字并标注"改编化用"，绝不整段照搬。
 *
 * 状态键：nd_plotrun_<id>（localStorage，小 JSON）。
 * 世界卡读取只读不拥有：加载权在 app.js 的 loadWorldcard，本模块只读缓存。
 */
var RP_PLOTRUN = (function(){
"use strict";

/* ---------- 存储（全部 try/catch，参考 director.js） ---------- */
function keyOf(id){ return "nd_plotrun_" + id; }
function lsGet(k){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(e){ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }
catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("剧情线进度保存失败", e); } }
function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }

/* ---------- 工具 ---------- */
function cut(s, n){ s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; }
/* P2-11: 收敛到 escutil.js 的 escH()；独立加载（测试 vm）无 escH 时回退同款实现 */
var esc = (typeof escH === "function") ? escH : function(s){ return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function newId(){ return "pr" + Date.now().toString(36) + Math.floor(Math.random()*1296).toString(36); }

/* ---------- 世界卡读取（只读） ---------- */
function worldcardOf(runId){
  try{ if(typeof getWorldcard === "function"){ var wc = getWorldcard(runId); if(wc) return wc; } }catch(e){}
  try{ if(typeof window !== "undefined"){ var w2 = window["__WORLDCARD_" + runId]; if(w2) return w2; } }catch(e){}
  return null;
}
function directorOf(runId){
  var wc = worldcardOf(runId);
  if(!wc || !wc.directorDefinitions || !wc.directorDefinitions.length) return null;
  return wc.directorDefinitions[0];
}
function stagesOf(runId){ var dd = directorOf(runId); return (dd && dd.stages) || []; }
function nodesOf(runId){ var dd = directorOf(runId); return (dd && dd.nodes) || []; }
function stageNodes(runId, stageId){
  return nodesOf(runId).filter(function(n){ return n && n.stageId === stageId; });
}
function nodeById(runId, nodeId){
  var ns = nodesOf(runId);
  for(var i=0;i<ns.length;i++) if(ns[i] && ns[i].id === nodeId) return ns[i];
  return null;
}
function stageById(runId, stageId){
  var ss = stagesOf(runId);
  for(var i=0;i<ss.length;i++) if(ss[i] && ss[i].id === stageId) return ss[i];
  return null;
}

/* ---------- 状态 ---------- */
function start(runId, stageId){
  var nodes = stageNodes(runId, stageId), first = null, i;
  for(i=0;i<nodes.length;i++){ if(!((nodes[i].dependsOn || []).length)){ first = nodes[i]; break; } }
  if(!first && nodes.length) first = nodes[0];
  var st = { v:1, id:newId(), runId:runId, stageId:stageId,
    currentNodeId: first ? first.id : null,
    completedNodeIds:[], choices: [],
    startedAt:Date.now(), updatedAt:Date.now() };
  save(st);
  return st;
}
function load(id){ var st = lsGet(keyOf(id)); return (st && st.v === 1) ? st : null; }
function save(st){ if(!st || !st.id) return; st.updatedAt = Date.now(); lsSet(keyOf(st.id), st); }
function reset(id){ lsDel(keyOf(id)); }
function allStates(){
  var out = [];
  try{
    for(var i=0;i<localStorage.length;i++){
      var k = null;
      try{ k = localStorage.key(i); }catch(e){}
      if(k && k.indexOf("nd_plotrun_") === 0){
        var st = lsGet(k);
        if(st && st.v === 1) out.push(st);
      }
    }
  }catch(e){}
  return out;
}
function latestFor(runId, stageId){
  var best = null, all = allStates();
  for(var i=0;i<all.length;i++){
    var st = all[i];
    if(st.runId === runId && st.stageId === stageId){
      if(!best || (st.updatedAt || 0) > (best.updatedAt || 0)) best = st;
    }
  }
  return best;
}

/* ---------- 推进（纯规则） ---------- */
function nextNode(state){
  if(!state) return null;
  var nodes = stageNodes(state.runId, state.stageId);
  var done = {}, cids = state.completedNodeIds || [], i, j, k;
  for(i=0;i<cids.length;i++) done[cids[i]] = true;
  for(j=0;j<nodes.length;j++){
    var n = nodes[j];
    if(!n || !n.id || done[n.id]) continue;
    var deps = n.dependsOn || [], ok = true;
    for(k=0;k<deps.length;k++) if(!done[deps[k]]){ ok = false; break; }
    if(ok) return n;
  }
  return null; /* 本幕走完 */
}
function completeNode(state, nodeId, choice){
  if(!state || !nodeId) return state;
  var cids = state.completedNodeIds || (state.completedNodeIds = []);
  if(cids.indexOf(nodeId) < 0) cids.push(nodeId);
  if(choice !== undefined && choice !== null && String(choice) !== ""){
    state.choices.push({ nodeId:nodeId, choice:cut(choice, 200), ts:Date.now() });
  }
  var nxt = nextNode(state);
  state.currentNodeId = nxt ? nxt.id : null;
  save(state);
  return state;
}
/* 后悔药：弹出最后一次 completeNode 的效果（决策点重新选择用） */
function revertLast(state){
  if(!state) return state;
  var chs = state.choices || [];
  var ch = chs.pop();
  if(ch && ch.nodeId){
    var cids = state.completedNodeIds || [];
    var i = cids.lastIndexOf(ch.nodeId);
    if(i >= 0) cids.splice(i, 1);
    state.currentNodeId = ch.nodeId;
  }
  save(state);
  return state;
}
function progress(state){
  if(!state) return { done:0, total:0, pct:0 };
  var total = stageNodes(state.runId, state.stageId).length;
  var done = (state.completedNodeIds || []).length;
  return { done:done, total:total, pct: total ? Math.round(done / total * 100) : 0 };
}
function isFinished(state){
  return !!state && state.currentNodeId === null && (state.completedNodeIds || []).length > 0;
}

/* ---------- 导演 prompt 素材 ---------- */
function bansFor(node){
  var bans = [], cs = (node && node.constraints) || [];
  for(var i=0;i<cs.length;i++){
    var c = String(cs[i] == null ? "" : cs[i]).trim();
    if(c) bans.push("不许违反：" + cut(c, 80));
  }
  return bans;
}
function choicesFor(node){
  /* foreground 返回 null：由导演 LLM 按 intent 生成 2~3 个选项（见集成说明）；
     background 返回 []：无需玩家选择，直接织入叙事。 */
  if(!node) return [];
  return node.execution === "foreground" ? null : [];
}
function directorBlock(state){
  if(!state || !state.currentNodeId) return "";
  var node = nodeById(state.runId, state.currentNodeId);
  if(!node) return "";
  var stage = stageById(state.runId, state.stageId);
  var lines = [];
  lines.push("【剧情节点】" + (stage ? "（" + stage.title + "）" : "") + "当前事件：" + cut(node.title, 40));
  /* intent 一律截断并标注改编化用，绝不整段照搬（防剧透式背书） */
  lines.push("事件概要（改编化用，绝不照搬原文）： " + cut(node.intent, 200));
  var conds = node.conditions || [], cd = [], i;
  for(i=0;i<conds.length;i++){
    var d = conds[i] && conds[i].description ? conds[i].description : conds[i];
    d = String(d == null ? "" : d).trim();
    if(d) cd.push(cut(d, 60));
  }
  if(cd.length) lines.push("触发条件：" + cd.join("；"));
  var bans = bansFor(node);
  if(bans.length) lines.push("禁令：" + bans.join("；"));
  if(node.execution === "foreground"){
    lines.push("本节点为【前台决策点】：呈现事件后必须停下，把选择权交给玩家；"
      + "选项走【剧情选项】卡输出（不要在正文里重复列选项）；也接受玩家自由行动；"
      + "绝不替玩家做决定、不写正文。");
  }else{
    lines.push("本节点为【后台事件】：自然织入叙事，不打断玩家。");
  }
  var actors = node.actorIds || [];
  if(actors.length) lines.push("相关演员：" + actors.slice(0, 6).join("、"));
  lines.push("（以上为剧情调度素材，不进入正文；正文仍由扮演 AI 按世界状态生成）");
  return lines.join("\n");
}

/* ---------- 选幕 UI 数据 ---------- */
function listStages(runId){
  var stages = stagesOf(runId), out = [], i;
  for(i=0;i<stages.length;i++){
    var s = stages[i];
    if(!s || !s.id) continue;
    var total = stageNodes(runId, s.id).length;
    var st = latestFor(runId, s.id);
    var done = st ? (st.completedNodeIds || []).length : 0;
    var fin = !!st && isFinished(st);
    out.push({ id:s.id, title:s.title, description:s.description,
      total:total, done:done, pct: total ? Math.round(done / total * 100) : 0,
      resumable: !!st && !fin, finished: fin, plotrunId: st ? st.id : null });
  }
  return out;
}

/* ---------- 决策点判定（供发送链路强制选项卡） ---------- */
function decisionNode(travId){
  /* traverse 会话当前剧情节点若为前台决策点则返回节点，否则 null */
  try{
    if(typeof RP_TRAVERSE === "undefined") return null;
    var t = RP_TRAVERSE.get(travId);
    var st = (t && t.plotrunId) ? load(t.plotrunId) : null;
    var n = (st && st.currentNodeId) ? nodeById(st.runId, st.currentNodeId) : null;
    return (n && n.execution === "foreground") ? n : null;
  }catch(e){ return null; }
}

/* ---------- HUD ---------- */
function hudHTML(state){
  if(!state) return "";
  var stage = stageById(state.runId, state.stageId);
  var p = progress(state);
  return '<span class="simchip plotchip" title="剧情模式：沿原著因果线推进，决策点停下等你选择">'
    + '📜 ' + esc(stage ? stage.title : "剧情") + ' ' + p.done + '/' + p.total + '</span>';
}

var api = {
  start:start, load:load, reset:reset,
  nextNode:nextNode, completeNode:completeNode, revertLast:revertLast, progress:progress, isFinished:isFinished,
  directorBlock:directorBlock, choicesFor:choicesFor, bansFor:bansFor,
  decisionNode:decisionNode,
  hudHTML:hudHTML, listStages:listStages, latestFor:latestFor, allStates:allStates,
  nodeById:nodeById, stageById:stageById,
  _cut:cut
};
return api;
})();
