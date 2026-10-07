/* App 端蒸馏 UI (2026-10-07): 手机上直接蒸馏小说。
 * 流程: 上传 txt -> 输入人物 -> 配置 API Key -> 开始蒸馏 -> 看结果。
 * 断点续跑: localStorage 存 checkpoint。
 */
var DISTILL_UI = (function(){
"use strict";

var state = {
  text: null, fileName: null,
  chunks: [], characters: [],
  running: false, results: null
};

function show(){
  var v = document.getElementById("view");
  var llmCfg = DISTILL_LLM.cfg();
  v.innerHTML = `
  <h2 class="sec">手机蒸馏</h2>
  <div class="card">
    <div style="font-size:13px;color:var(--ink-dim);margin-bottom:12px">
      上传小说 txt，在手机上直接蒸馏人物档案。LLM 走在线 API，不经过服务器。
    </div>
    <div class="field">
      <label>小说文件 (.txt)</label>
      <input type="file" id="d_file" accept=".txt" style="width:100%">
      <div id="d_fileinfo" style="font-size:12px;color:var(--ink-faint);margin-top:4px"></div>
    </div>
    <div class="field">
      <label>人物 (逗号分隔)</label>
      <input type="text" id="d_chars" placeholder="林黛玉,贾宝玉,薛宝钗" style="width:100%">
    </div>
    <div class="field">
      <label>LLM API Key</label>
      <input type="password" id="d_key" value="${escAttr(llmCfg.key)}" placeholder="zen 网关 key" style="width:100%">
      <div style="font-size:11px;color:var(--ink-faint);margin-top:4px">模型: ${esc(llmCfg.model)}</div>
    </div>
    <div class="btnrow">
      <button class="btn" id="d_savekey">保存 Key</button>
      <button class="btn primary" id="d_start">开始蒸馏</button>
    </div>
  </div>
  <div id="d_progress"></div>
  <div id="d_results"></div>`;

  document.getElementById("d_file").addEventListener("change", onFile);
  document.getElementById("d_savekey").addEventListener("click", onSaveKey);
  document.getElementById("d_start").addEventListener("click", onStart);
}

function escAttr(s){
  return String(s || "").replace(/"/g, "&quot;");
}
function esc(s){
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function onFile(e){
  var f = e.target.files[0];
  if(!f) return;
  var rd = new FileReader();
  rd.onload = function(){
    state.text = rd.result;
    state.fileName = f.name;
    state.chunks = DISTILL_CHUNK.chunkNovel(state.text);
    document.getElementById("d_fileinfo").textContent =
      f.name + " · " + state.text.length + " 字 · " + state.chunks.length + " 块";
  };
  rd.readAsText(f, "utf-8");
}

function onSaveKey(){
  var k = document.getElementById("d_key").value.trim();
  var c = DISTILL_LLM.cfg();
  c.key = k;
  DISTILL_LLM.saveCfg(c);
  alert("已保存");
}

async function onStart(){
  if(state.running){ alert("蒸馏进行中"); return; }
  if(!state.text){ alert("请先上传小说文件"); return; }
  var chars = document.getElementById("d_chars").value.split(/[,，]/).map(function(s){ return s.trim(); }).filter(Boolean);
  if(!chars.length){ alert("请输入人物"); return; }
  var key = document.getElementById("d_key").value.trim();
  if(!key){ alert("请填写 API Key"); return; }
  var c = DISTILL_LLM.cfg(); c.key = key; DISTILL_LLM.saveCfg(c);

  state.characters = chars;
  state.running = true;
  var progEl = document.getElementById("d_progress");
  var ckptKey = "nd_distill_ckpt_" + state.fileName;
  var checkpoint = {};
  try{ checkpoint = JSON.parse(localStorage.getItem(ckptKey) || "{}"); }catch(e){}

  var stages = [
    {id: "chunk", label: "分块"},
    {id: "alias", label: "别名消解"},
    {id: "profile", label: "人物画像"},
    {id: "relations", label: "关系抽取"},
    {id: "plot", label: "剧情层"}
  ];
  progEl.innerHTML = `<div class="card">
    <div id="d_stages" style="margin-bottom:12px">` +
    stages.map(function(s, i){ return `<div id="d_stage_` + s.id + `" style="font-size:13px;padding:4px 0;color:var(--ink-faint)">○ ` + s.label + `</div>`; }).join("") +
    `</div>
    <div id="d_bar" style="height:8px;background:var(--line);border-radius:4px"><i style="display:block;height:100%;width:0;background:var(--gold);border-radius:4px"></i></div>
    <div id="d_msg" style="font-size:12px;margin-top:8px">开始…</div></div>`;

  function setStage(id, status){
    var el = document.getElementById("d_stage_" + id);
    if(!el) return;
    var icon = status === "run" ? "◉" : status === "done" ? "●" : "○";
    var color = status === "run" ? "var(--gold)" : status === "done" ? "var(--ink)" : "var(--ink-faint)";
    el.style.color = color;
    el.innerHTML = icon + " " + el.textContent.slice(2);
  }
  function prog(done, total, msg){
    var pct = total ? Math.round(done / total * 100) : 0;
    var bar = document.getElementById("d_bar");
    if(bar) bar.firstChild.style.width = pct + "%";
    var m = document.getElementById("d_msg");
    if(m) m.textContent = msg;
  }
  function saveCkpt(){
    try{ localStorage.setItem(ckptKey, JSON.stringify(checkpoint)); }catch(e){}
  }

  try{
    // Stage 1: 分块 (已在上传时完成)
    setStage("chunk", "done");
    prog(1, 1, "分块完成: " + state.chunks.length + " 块");

    // Stage 2: 别名消解
    setStage("alias", "run");
    var aliasRes = DISTILL_ALIAS.booknlpCluster(state.chunks, chars, {}, [], function(m){ prog(0, 1, m); });
    var aliasMap = Object.assign({}, aliasRes.direct);
    prog(0, 1, "别名直接合并 " + Object.keys(aliasRes.direct).length + " 条, 歧义 " + Object.keys(aliasRes.cands).length + " 项待裁决");
    if(Object.keys(aliasRes.cands).length){
      var judged = await DISTILL_ALIAS.judgeAmbiguous(aliasRes.cands, state.chunks, function(d, t, m){ prog(d, t, m); });
      Object.assign(aliasMap, judged);
    }
    // 说话人归属 -> 别名信号
    var unknowns = DISTILL_SPEAKER.collectUnknownSurfaces(state.chunks, aliasMap, chars, 2, function(m){ prog(0, 1, m); });
    if(Object.keys(unknowns).length){
      var attributed = await DISTILL_SPEAKER.attributeSpeakers(unknowns, chars, function(d, t, m){ prog(d, t, m); });
      Object.assign(aliasMap, attributed);
    }
    setStage("alias", "done");
    checkpoint.aliasMap = aliasMap; saveCkpt();

    // Stage 3: 人物画像
    setStage("profile", "run");
    var profiles = await DISTILL_CORE.distillNovel(state.chunks, chars, {
      checkpoint: checkpoint,
      onProgress: function(d, t, m){ prog(d, t, "[画像] " + m); },
      onCheckpoint: function(){ saveCkpt(); }
    });
    setStage("profile", "done");
    state.results = profiles;

    // Stage 4: 关系抽取
    setStage("relations", "run");
    var edges = DISTILL_RELATIONS.extractPairs(state.chunks, chars, aliasMap, {});
    prog(0, 1, "关系候选 " + edges.length + " 条");
    await DISTILL_RELATIONS.enrichEdges(edges, function(d, t, m){ prog(d, t, "[关系] " + m); });
    setStage("relations", "done");
    state.relations = edges;

    // Stage 5: 剧情层
    setStage("plot", "run");
    var summaries = await DISTILL_PLOT.summarizeChunks(state.chunks, chars, aliasMap, {
      checkpoint: checkpoint,
      onProgress: function(d, t, m){ prog(d, t, "[剧情] " + m); },
      onCheckpoint: function(){ saveCkpt(); }
    });
    var sections = await DISTILL_PLOT.buildOutline(summaries, {onProgress: function(d, t, m){ prog(d, t, "[大纲] " + m); }});
    var conflicts = await DISTILL_PLOT.extractConflicts(sections, {onProgress: function(d, t, m){ prog(d, t, m); }});
    var arcs = await DISTILL_PLOT.extractArcs(chars, summaries, {onProgress: function(d, t, m){ prog(d, t, "[弧光] " + m); }});
    var pairs = DISTILL_PLOT.pairForeshadowing(summaries, {});
    prog(1, 1, "伏笔配对 " + pairs.length + " 对");
    setStage("plot", "done");
    state.plot = {summaries: summaries, sections: sections, conflicts: conflicts, arcs: arcs, pairs: pairs};

    state.running = false;
    showResults(profiles);
    try{ localStorage.removeItem(ckptKey); }catch(e){}
    prog(1, 1, "全部完成!");
  }catch(e){
    state.running = false;
    var m = document.getElementById("d_msg");
    if(m) m.textContent = "出错: " + e.message;
  }
}

function showResults(results){
  var el = document.getElementById("d_results");
  var names = Object.keys(results);
  if(!names.length){
    el.innerHTML = `<div class="empty">没有蒸馏出人物档案</div>`;
    return;
  }
  el.innerHTML = `<h2 class="sec">蒸馏结果 · ${names.length} 人</h2>` + names.map(function(n){
    var r = results[n];
    var f = r.fields || {};
    return `<div class="card">
      <div style="font-size:16px;font-weight:600;margin-bottom:8px">${esc(n)} <span class="badge">${r.chunks} 块</span></div>
      ${f.core_identity ? `<div class="kvline"><b>身份</b>：${esc(f.core_identity)}</div>` : ""}
      ${f.core_traits ? `<div class="kvline"><b>性格</b>：${esc(f.core_traits)}</div>` : ""}
      ${f.speech_style ? `<div class="kvline"><b>说话</b>：${esc(f.speech_style)}</div>` : ""}
      ${f.soul_goal ? `<div class="kvline"><b>追求</b>：${esc(f.soul_goal)}</div>` : ""}
    </div>`;
  }).join("");
}

return {show: show};
})();
