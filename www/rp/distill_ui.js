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

  progEl.innerHTML = `<div class="card"><div id="d_bar" style="height:8px;background:var(--line);border-radius:4px"><i style="display:block;height:100%;width:0;background:var(--gold);border-radius:4px"></i></div><div id="d_msg" style="font-size:12px;margin-top:8px">开始…</div></div>`;

  try{
    var results = await DISTILL_CORE.distillNovel(state.chunks, chars, {
      checkpoint: checkpoint,
      onProgress: function(done, total, msg){
        var pct = Math.round(done / total * 100);
        var bar = document.getElementById("d_bar");
        if(bar) bar.firstChild.style.width = pct + "%";
        var m = document.getElementById("d_msg");
        if(m) m.textContent = pct + "% · " + msg;
      },
      onCheckpoint: function(ckpt){
        try{ localStorage.setItem(ckptKey, JSON.stringify(ckpt)); }catch(e){}
      }
    });
    state.results = results;
    state.running = false;
    showResults(results);
    // 清除 checkpoint
    try{ localStorage.removeItem(ckptKey); }catch(e){}
  }catch(e){
    state.running = false;
    document.getElementById("d_msg").textContent = "出错: " + e.message;
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
