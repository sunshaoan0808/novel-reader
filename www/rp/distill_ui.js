/* 蒸馏 UI v2 (2026-10-07): 5 步向导。
 * Step 0 上传 → Step 1 发现角色(自动) → Step 2 配置 → Step 3 蒸馏 → Step 4 剧本包
 */
var DISTILL_UI = (function(){
"use strict";

var S = {
  step: 0,
  text: null, fileName: null, chunks: [],
  discovered: [],   // 发现的角色
  selected: {},     // 选中的角色名
  pkg: null,
  running: false
};

/* P2-11: 收敛到 escutil.js 的 escH()（此前只转 & < >，现统一为全实体转义）；
   独立加载（测试 vm）无 escH 时回退同款实现 */
var esc = (typeof escH === "function") ? escH : function(s){ return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };

/* HTML 属性转义：esc 现已含双引号转义，escA 仅保留为语义别名（data-* 属性值专用）。
 * dataset 读出即原文，无 JS 解析层，只需 HTML 层转义（XSS 修复 2026-10-13）。 */
function escA(s){
  return esc(s);
}

function show(){
  S.step = 0;
  render();
}

function stepDots(){
  /* 顺序：上传 → 配置LLM → 发现角色 → 计划书 → 蒸馏 → 剧本包
     LLM 必须在发现之前配好，否则发现时的 LLM 确认直接报错 */
  var labels = ["上传", "配置", "发现角色", "计划书", "蒸馏", "剧本包"];
  return `<div class="dsteps">` +
    labels.map(function(l, i){
      var st = i === S.step ? "cur" : i < S.step ? "done" : "";
      return `<div class="dstep ${st}"><div class="ds-dot">${i < S.step ? "✓" : (i+1)}</div><div class="ds-label">${l}</div></div>` +
        (i < labels.length - 1 ? `<div class="ds-line ${i < S.step ? "done" : ""}"></div>` : "");
    }).join("") + `</div>`;
}

function render(){
  var v = document.getElementById("view");
  var banner = "";
  try{
    if(typeof DISTILL_BACKUP !== "undefined" && S.step === 0 && DISTILL_BACKUP.shouldShow()){
      banner = DISTILL_BACKUP.renderBanner();
    }
  }catch(e){}
  var html = `<h2 class="sec">手机蒸馏</h2>` + stepDots() + banner;
  if(S.step === 0) html += renderUpload();
  else if(S.step === 1) html += renderConfig();
  else if(S.step === 2) html += renderDiscover();
  else if(S.step === 3) html += renderPlan();
  else if(S.step === 4) html += renderDistill();
  else if(S.step === 5) html += renderPackages();
  v.innerHTML = html;
  wire();
}

// 旧任务历史 (从任务 tab 迁移)
function renderTaskHistory(){
  var ts = [];
  try{ ts = JSON.parse(localStorage.getItem("nd_tasks") || "[]"); }catch(e){}
  if(!ts.length) return "";
  return `<h2 class="sec">历史任务 (${ts.length})</h2>` +
    ts.map(function(t){
      return `<div class="card" style="padding:10px;margin-bottom:8px">
        <div style="font-weight:600;font-size:calc(13px * var(--fs))">${esc(t.novel || t.id)}</div>
        <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint)">${esc(t.created_at || "")} · ${esc(t.status || "排队中")}</div>
      </div>`;
    }).join("");
}

function renderUpload(){
  var pkgs = DISTILL_PACKAGE.listPackages();
  return `<div class="card">
    <div style="font-size:calc(13px * var(--fs));color:var(--ink-dim);margin-bottom:12px">
      上传小说，自动发现角色，蒸馏成剧本包。LLM 走在线 API。
    </div>
    <div class="field">
      <label>小说文件 (.txt)</label>
      <!-- P0-22：原生 <input type=file> 在 WebView 里是浏览器默认外观 + 英文文案
           （"Choose File / No file chosen"），与全站墨金调完全脱节。改成自绘上传区：
           真 input 藏起来，label 当可点目标，未选文件时给中文空状态。 -->
      <input type="file" id="d_file" accept=".txt" class="d_fileinput">
      <label class="dropzone" for="d_file" id="d_dropzone">
        <span class="dz-ico" id="d_dzico">${typeof icon === "function" ? icon("upload", 20) : ""}</span>
        <span class="dz-main" id="d_dzmain">选择小说文件</span>
        <span class="dz-sub" id="d_dzsub">点这里从手机里挑一个 .txt</span>
      </label>
      <div id="d_fileinfo" class="dz-info"></div>
    </div>
    <div class="btnrow">
      <button class="btn primary" id="d_next0" disabled>下一步 →</button>
    </div>
  </div>
  ${renderTaskHistory()}
  ${pkgs.length ? `<h2 class="sec">已有剧本包 (${pkgs.length})</h2>` +
    pkgs.map(function(p){
      return `<div class="card card--tap" style="padding:12px" data-dact="openPackage" data-did="${p.id}">
        <div style="font-weight:600">${esc(p.novel)}</div>
        <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">${p.charCount} 个角色 · ${new Date(p.created).toLocaleDateString()}</div>
      </div>`;
    }).join("") : ""}`;
}

function renderDiscover(){
  if(!S.discovered.length){
    return `<div class="card"><div id="d_disc_msg">正在发现角色...</div>
      <div id="d_disc_bar" style="height:8px;background:var(--line);border-radius:4px;margin-top:8px">
      <i style="display:block;height:100%;width:0;background:var(--gold);border-radius:4px"></i></div></div>`;
  }
  var warnHtml = "";
  if(S.discovered.warnings && S.discovered.warnings.length){
    warnHtml = `<div style="font-size:calc(12px * var(--fs));color:#f0ad4e;background:rgba(240,173,78,.1);border:1px solid #f0ad4e;border-radius:6px;padding:8px;margin-bottom:12px">⚠️ ${S.discovered.warnings.map(esc).join("<br>")}</div>`;
  }
  return `<div class="card">
    ${warnHtml}
    <div style="font-size:calc(13px * var(--fs));margin-bottom:12px">发现 <b>${S.discovered.length}</b> 个角色，勾选要蒸馏的：</div>
    <div style="max-height:400px;overflow-y:auto">
    ${S.discovered.map(function(c, i){
      var checked = S.selected[c.name] !== false ? "checked" : "";
      return `<label class="dchar">
        <input type="checkbox" data-char="${esc(c.name)}" ${checked}>
        <img class="dchar-avatar" src="bg/avatar_default.jpg" alt="">
        <div style="flex:1;min-width:0">
          <div class="dchar-name">${esc(c.name)}
            <span class="dchar-star">★${c.importance}</span></div>
          <div class="dchar-meta">
            出现 ${c.count} 次${c.aliases.length ? " · 别名: " + c.aliases.map(esc).join("、") : ""}</div>
          ${c.reason ? `<div class="dchar-reason">💡 ${esc(c.reason)}</div>` : ""}
        </div>
      </label>`;
    }).join("")}
    </div>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" id="d_back1">← 上一步</button>
      <button class="btn primary" id="d_plan">生成计划书 →</button>
    </div>
  </div>`;
}

// A1: 问答式配置 (Cardwright: 按轮提问替代表单)
var QA_QUESTIONS = [
  {id: "depth", q: "这次想蒸多深？", options: [
    {v: "quick", t: "快速", d: "只蒸画像+关系，省 token", rec: false},
    {v: "full", t: "完整", d: "画像+关系+剧情+世界书，全都要", rec: true}
  ]},
  {id: "confirm", q: "确认开始？", options: [
    {v: "yes", t: "开始蒸馏", d: "", rec: true},
    {v: "back", t: "返回修改", d: "", rec: false}
  ]}
];
var QA_STATE = {step: 0, answers: {}};

function renderConfig(){
  var llmCfg = DISTILL_LLM.cfg();
  // 问答模式
  if(S.qaMode){
    return renderConfigQA();
  }
  /* LLM 配置：优先复用主设置页（nd_api_cfg_v1），用户只选模型，不填 Key。
     模型下拉框读设置页缓存的模型列表（nd_models），默认选中用户已配置的模型，
     也支持手动输入（对齐设置页行为，不再写死模型名） */
  var llmBlock;
  if(llmCfg.key){
    var keySrc = llmCfg._fromMain ? "设置页已配置" : "蒸馏独立配置";
    var modelList = [];
    try{ modelList = JSON.parse(localStorage.getItem("nd_models") || "[]"); }catch(e){}
    var curModel = llmCfg.model || "";
    var modelOpts = modelList.map(function(m){
      return `<option value="${esc(m)}"${m === curModel ? " selected" : ""}>${esc(m)}</option>`;
    }).join("");
    // 用户已配的模型不在列表里时，补一项保证选中态
    if(curModel && modelList.indexOf(curModel) < 0){
      modelOpts = `<option value="${esc(curModel)}" selected>${esc(curModel)}</option>` + modelOpts;
    }
    llmBlock = `<div class="field">
      <label>LLM <span style="font-size:calc(11px * var(--fs));color:var(--gold)">✓ ${keySrc}的 Key，无需填写</span></label>
      <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">Key: ${esc(llmCfg.key.slice(0,4))}****${esc(llmCfg.key.slice(-4))}</div>
    </div>
    <div class="field">
      <label>模型</label>
      <select id="d_model" style="width:100%;padding:8px">${modelOpts}</select>
      <input id="d_model_custom" placeholder="或手动输入模型名" value="" style="width:100%;margin-top:6px">
    </div>`;
  }else{
    llmBlock = `<div class="field">
      <label>LLM API Key <span style="font-size:calc(11px * var(--fs));color:var(--ink-faint)">（设置页也未配置，请填写）</span></label>
      <input type="password" id="d_key" value="" placeholder="OpenAI 兼容接口 Key" style="width:100%">
    </div>`;
  }
  return `<div class="card">
    <div style="font-size:calc(13px * var(--fs));margin-bottom:12px">先配置 LLM，再发现角色
      <a href="javascript:void(0)" onclick="DISTILL_UI.qaMode(true)" style="font-size:calc(12px * var(--fs));margin-left:8px">💬 换问答式</a></div>
    ${llmBlock}
    <div class="field">
      <label>蒸馏深度</label>
      <select id="d_depth" style="width:100%;padding:8px">
        <option value="quick">快速 (画像+关系)</option>
        <option value="full" selected>完整 (画像+关系+剧情+世界书)</option>
      </select>
    </div>
    <div class="btnrow">
      <button class="btn" id="d_back2">← 上一步</button>
      <button class="btn primary" id="d_todiscover">开始发现角色 →</button>
    </div>
  </div>`;
}

function renderConfigQA(){
  var q = QA_QUESTIONS[QA_STATE.step];
  if(!q) return "";
  var html = `<div class="card">
    <div style="font-size:calc(13px * var(--fs));margin-bottom:12px">💬 ${esc(q.q)}
      <a href="javascript:void(0)" onclick="DISTILL_UI.qaMode(false)" style="font-size:calc(12px * var(--fs));margin-left:8px">切回表单</a></div>`;
  q.options.forEach(function(o){
    html += `<button class="btn" style="width:100%;margin-bottom:8px;text-align:left" data-dact="qaAnswer" data-dqid="${q.id}" data-dv="${o.v}">
      <b>${esc(o.t)}</b>${o.rec ? ' <span style="color:var(--gold);font-size:calc(11px * var(--fs))">推荐</span>' : ""}
      ${o.d ? `<div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">${esc(o.d)}</div>` : ""}
    </button>`;
  });
  html += `</div>`;
  return html;
}

function renderPlan(){
  var p = S.plan;
  if(!p) return `<div class="card"><div>正在生成计划书...</div></div>`;
  return `<div class="card">
    <div style="font-size:calc(15px * var(--fs));font-weight:600;margin-bottom:12px">蒸馏计划书</div>

    <div style="font-size:calc(13px * var(--fs));font-weight:600;margin:12px 0 6px">一、蒸馏角色 (${p.chars.length} 人)</div>
    ${p.chars.map(function(c){
      return `<div style="font-size:calc(13px * var(--fs));padding:6px 0;border-bottom:1px solid var(--line)">
        <b>${esc(c.name)}</b> <span style="font-size:calc(11px * var(--fs));color:var(--gold)">★${c.importance}</span>
        <div style="font-size:calc(12px * var(--fs));color:var(--ink-dim);margin-top:2px">推荐理由: ${esc(c.reason)}</div>
      </div>`;
    }).join("")}

    <div style="font-size:calc(13px * var(--fs));font-weight:600;margin:12px 0 6px">二、蒸馏深度</div>
    <div style="font-size:calc(13px * var(--fs))">${p.depth === "full" ? "完整 (画像+关系+剧情+世界书)" : "快速 (画像+关系)"}</div>

    <div style="font-size:calc(13px * var(--fs));font-weight:600;margin:12px 0 6px">三、预估成本</div>
    <div style="font-size:calc(13px * var(--fs));color:var(--ink-dim)">
      约 ${p.estCalls} 次 API 调用 · 预计 ${p.estTime} · ${p.estChunks} 个文本块
    </div>

    <div style="font-size:calc(13px * var(--fs));font-weight:600;margin:12px 0 6px">四、不做清单</div>
    <div style="font-size:calc(13px * var(--fs));color:var(--ink-dim)">${p.excludes.map(esc).join("<br>")}</div>

    <div class="btnrow" style="margin-top:16px">
      <button class="btn" id="d_backplan">← 返回修改</button>
      <button class="btn primary" id="d_confirm">确认，开始蒸馏</button>
    </div>
  </div>`;
}

/* 从配置页保存 LLM 选择（点"开始发现角色"时调用） */
function saveLlmChoice(){
  var c = DISTILL_LLM.cfg();
  var keyInput = document.getElementById("d_key");
  if(keyInput){
    var key = keyInput.value.trim();
    if(!key){ alert("请填写 API Key（设置页也未配置）"); return false; }
    c.key = key; c._fromMain = false; DISTILL_LLM.saveCfg(c);
  }else{
    var modelSel = document.getElementById("d_model");
    var modelCustom = document.getElementById("d_model_custom");
    var picked = (modelCustom && modelCustom.value.trim()) || (modelSel && modelSel.value);
    if(picked){ c.model = picked; DISTILL_LLM.saveCfg(c); }
  }
  if(!DISTILL_LLM.cfg().key){ alert("未配置 LLM API Key"); return false; }
  var depthSel = document.getElementById("d_depth");
  if(depthSel) S.depth = depthSel.value;
  return true;
}

async function onGenPlan(){
  /* 配置页已在"开始发现角色"时保存 LLM 选择，这里直接读 */
  var c = DISTILL_LLM.cfg();
  if(!c.key){ alert("未配置 LLM API Key，请返回上一步配置"); return; }
  var chars = Object.keys(S.selected).filter(function(k){ return S.selected[k]; });
  if(!chars.length){ alert("请至少选一个角色"); return; }
  S.step = 3; render();

  // 生成推荐理由 (LLM)
  var charInfos = chars.map(function(n){
    var d = S.discovered.find(function(x){ return x.name === n; }) || {};
    return {name: n, importance: d.importance || 5, count: d.count || 0, aliases: d.aliases || []};
  });

  try{
    var r = await DISTILL_LLM.chat([
      {role: "system", content: "你是蒸馏规划师。为每个角色写一句推荐理由(为什么值得蒸馏)。返回JSON，格式:{reasons:{角色名:理由}}"},
      {role: "user", content: JSON.stringify({characters: charInfos, novel: S.fileName})}
    ]);
    var m = r.content.match(/\{[\s\S]*\}/);
    var reasons = m ? JSON.parse(m[0]).reasons || {} : {};
    charInfos.forEach(function(ci){
      ci.reason = reasons[ci.name] || ("出现 " + ci.count + " 次，重要性 ★" + ci.importance);
    });
  }catch(e){
    charInfos.forEach(function(ci){
      ci.reason = "出现 " + ci.count + " 次，重要性 ★" + ci.importance;
    });
  }

  // 预估
  var nChunks = S.chunks.length;
  var nChars = chars.length;
  var estCalls = nChunks * nChars + nChars * 3 + 20; // 画像 + 合并 + 其他
  if(S.depth === "full") estCalls += nChunks + 20;
  var estMin = Math.round(estCalls * 0.25);

  var unselected = S.discovered.filter(function(d){ return !S.selected[d.name]; }).length;

  S.plan = {
    chars: charInfos,
    depth: S.depth,
    estCalls: estCalls,
    estTime: estMin > 60 ? Math.round(estMin / 60 * 10) / 10 + " 小时" : estMin + " 分钟",
    estChunks: nChunks,
    excludes: [
      "未选中的 " + unselected + " 个角色不蒸馏",
      S.depth === "quick" ? "快速模式: 不做剧情层 (大纲/冲突/弧光/伏笔) 和世界书" : "完整模式: 包含剧情层和世界书",
      "probe/judge/correction 质检环不做",
      "embedding 伏笔配对不做 (用关键词版)"
    ]
  };
  render();
}

function renderDistill(){
  var pauseBtn = S.running ?
    (S.paused ?
      `<button class="btn primary" id="d_resume" style="flex:1">▶ 继续</button>` :
      `<button class="btn" id="d_pause" style="flex:1">⏸ 暂停</button>`) : "";
  return `<div class="card">
    <div id="d_stages"></div>
    <div id="d_bar" style="height:8px;background:var(--line);border-radius:4px;margin-top:12px">
      <i style="display:block;height:100%;width:0;background:var(--gold);border-radius:4px"></i></div>
    <div id="d_msg" style="font-size:calc(12px * var(--fs));margin-top:8px">准备...</div>
    ${pauseBtn ? `<div class="btnrow" style="margin-top:12px">${pauseBtn}</div>` : ""}
  </div><div id="d_results"></div>`;
}

function togglePause(){
  S.paused = !S.paused;
  render();
  // 恢复渲染后需要重建 stages 显示
  if(S.running) restoreStages();
}
// 暂停后重渲染会清空 stages，用 S._stageState 恢复
function restoreStages(){
  // 由 onStartDistill 维护 S._stageState
  var stEl = document.getElementById("d_stages");
  if(!stEl || !S._stageState) return;
  stEl.innerHTML = S._stageState;
}

function renderPackages(){
  var pkgs = DISTILL_PACKAGE.listPackages();
  if(!pkgs.length) return `<div class="empty">还没有剧本包</div>`;
  var citeWarn = S.citationWarnings ? `<div style="font-size:calc(12px * var(--fs));color:#f0ad4e;margin:8px 0">⚠️ ${esc(S.citationWarnings)}</div>` : "";
  return `<h2 class="sec">剧本包 (${pkgs.length})</h2>` + citeWarn + pkgs.map(function(p){
    return `<div class="card card--tap" style="padding:12px" data-dact="openPackage" data-did="${p.id}">
      <div style="font-weight:600">${esc(p.novel)}</div>
      <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">${p.charCount} 个角色</div>
    </div>`;
  }).join("");
}

/* P1-3 修复：document 级委托监听只注册一次（模块加载时），wire() 每次 render 不再累加。
 * 旧实现 wire() 每 render +1 click +1 change 监听 → 点暂停翻转 N 次、选文件 import N 次。 */
function onPauseClick(e){
  if(e.target && (e.target.id === "d_pause" || e.target.id === "d_resume")) togglePause();
}
function onImportChange(e){
  if(e.target && e.target.id === "d_import_pkg" && e.target.files[0]){
    importPkg(e.target.files[0]);
    e.target.value = "";
  }
}
function wire(){
  /* 暂停/恢复、导入文件选择均为一次性 document 委托（render 重建 DOM，无需重绑） */
  var f = document.getElementById("d_file");
  if(f) f.addEventListener("change", onFile);

  var n0 = document.getElementById("d_next0");
  if(n0) n0.addEventListener("click", function(){ S.step = 1; render(); });

  /* 配置页 → 发现页：先保存 LLM 选择，再跑发现 */
  var td = document.getElementById("d_todiscover");
  if(td) td.addEventListener("click", function(){
    if(!saveLlmChoice()) return;
    S.step = 2; render(); runDiscover();
  });

  var b2 = document.getElementById("d_back2");
  if(b2) b2.addEventListener("click", function(){ S.step = 0; render(); });

  var b1 = document.getElementById("d_back1");
  if(b1) b1.addEventListener("click", function(){ S.step = 1; render(); });
  var pl = document.getElementById("d_plan");
  if(pl) pl.addEventListener("click", function(){
    // 收集选中
    document.querySelectorAll("[data-char]").forEach(function(cb){
      S.selected[cb.getAttribute("data-char")] = cb.checked;
    });
    onGenPlan();
  });
  var cf = document.getElementById("d_confirm");
  if(cf) cf.addEventListener("click", onStartDistill);
  var bp = document.getElementById("d_backplan");
  if(bp) bp.addEventListener("click", function(){ S.step = 2; render(); });
}

function onFile(e){
  var file = e.target.files[0];
  if(!file) return;
  var rd = new FileReader();
  rd.onload = function(){
    S.text = rd.result;
    S.fileName = file.name.replace(/\.txt$/i, "");
    S.chunks = DISTILL_CHUNK.chunkNovel(S.text);
    S.discovered = [];
    S.selected = {};
    S.pkg = null;
    document.getElementById("d_fileinfo").textContent =
      file.name + " · " + S.text.length + " 字 · " + S.chunks.length + " 块";
    document.getElementById("d_next0").disabled = false;
    /* P0-22：选好后把上传区切到"已选"态（换图标 + 主副文案），
       状态写在用户看得到的地方，不是底部一行小字 */
    var dz = document.getElementById("d_dropzone");
    if(dz) dz.classList.add("has-file");
    var ico = document.getElementById("d_dzico");
    if(ico && typeof icon === "function") ico.innerHTML = icon("check", 20);
    var dzm = document.getElementById("d_dzmain");
    if(dzm) dzm.textContent = file.name.replace(/\.txt$/i, "");
    var dzs = document.getElementById("d_dzsub");
    if(dzs) dzs.textContent = "点这里换一个文件";
  };
  rd.readAsText(file, "utf-8");
}

async function runDiscover(){
  var msgEl = function(){ return document.getElementById("d_disc_msg"); };
  var barEl = function(){ return document.getElementById("d_disc_bar"); };
  try{
    S.discovered = await DISTILL_DISCOVER.discover(S.text, {
      onProgress: function(d, t, m){
        var me = msgEl(); if(me) me.textContent = m;
        var be = barEl(); if(be && be.firstElementChild) be.firstElementChild.style.width = (d / t * 100) + "%";
      }
    });
    // 默认选中 Top 12
    S.discovered.forEach(function(c, i){ S.selected[c.name] = i < 12; });
    // 创建剧本包
    S.pkg = DISTILL_PACKAGE.createPackage(S.fileName);
    S.pkg.characters = S.discovered;
    DISTILL_PACKAGE.updatePackage(S.pkg);
    render();
  }catch(e){
    var me = msgEl(); if(me) me.textContent = "发现失败: " + e.message;
  }
}

async function onStartDistill(){
  var chars = S.plan ? S.plan.chars.map(function(c){ return c.name; }) :
    Object.keys(S.selected).filter(function(k){ return S.selected[k]; });
  var depth = S.depth || "full";
  if(!chars.length){ alert("请至少选一个角色"); return; }

  S.step = 4; render();
  S.running = true;
  S.paused = false;
  S._stageState = "";
  if(window.DISTILL_LLM && DISTILL_LLM.resetStats) DISTILL_LLM.resetStats();

  // 暂停检查: 在每个 await 前调用，暂停时阻塞
  async function waitIfPaused(){
    while(S.paused && S.running){
      var m = document.getElementById("d_msg");
      if(m) m.textContent = "已暂停，点击继续恢复…";
      await new Promise(function(r){ setTimeout(r, 500); });
    }
  }

  var stages = [
    {id: "alias", label: "别名消解"},
    {id: "profile", label: "人物画像"},
    {id: "relations", label: "关系抽取"}
  ];
  if(depth === "full") stages.push({id: "plot", label: "剧情+世界书"});

  var stEl = document.getElementById("d_stages");
  stEl.innerHTML = stages.map(function(s){
    return `<div id="d_stage_${s.id}" style="font-size:calc(13px * var(--fs));padding:4px 0;color:var(--ink-faint)">○ ${s.label}</div>`;
  }).join("");

  function setStage(id, st){
    var el = document.getElementById("d_stage_" + id);
    if(!el) return;
    el.innerHTML = (st === "run" ? "◉ " : st === "done" ? "● " : "○ ") + el.textContent.slice(2);
    el.style.color = st === "run" ? "var(--gold)" : st === "done" ? "var(--ink)" : "var(--ink-faint)";
    var stEl = document.getElementById("d_stages");
    if(stEl) S._stageState = stEl.innerHTML;
  }
  function prog(msg, pct){
    var stat = (window.DISTILL_LLM && DISTILL_LLM.fmtStats) ? DISTILL_LLM.fmtStats() : "";
    var m = document.getElementById("d_msg"); if(m) m.textContent = msg + (stat ? "  [" + stat + "]" : "");
    var b = document.getElementById("d_bar"); if(b && b.firstElementChild) b.firstElementChild.style.width = (pct || 0) + "%";
  }

  var ckptKey = "nd_distill_ckpt_" + S.pkg.id;
  var checkpoint = {};
  try{ checkpoint = JSON.parse(localStorage.getItem(ckptKey) || "{}"); }catch(e){}

  try{
    // 别名
    await waitIfPaused();
    setStage("alias", "run");
    var aliasMap = checkpoint.aliasMap || {};
    if(!checkpoint.aliasMap){
      var ar = DISTILL_ALIAS.booknlpCluster(S.chunks, chars, {}, []);
      aliasMap = Object.assign({}, ar.direct);
      if(Object.keys(ar.cands).length){
        var judged = await DISTILL_ALIAS.judgeAmbiguous(ar.cands, S.chunks, function(d, t, m){ prog(m, 10 + d / t * 10); });
        Object.assign(aliasMap, judged);
      }
      checkpoint.aliasMap = aliasMap;
      localStorage.setItem(ckptKey, JSON.stringify(checkpoint));
    }
    prog("别名: " + Object.keys(aliasMap).length + " 条", 20);
    setStage("alias", "done");

    // 画像
    await waitIfPaused();
    setStage("profile", "run");
    var profiles = await DISTILL_CORE.distillNovel(S.chunks, chars, {
      checkpoint: checkpoint,
      shouldPause: function(){ return S.paused; },
      onProgress: function(d, t, m){ prog("[画像] " + m, 20 + d / t * 30); },
      onCheckpoint: function(cp){ try{ localStorage.setItem(ckptKey, JSON.stringify(cp)); }catch(e){} }
    });
    // 存角色卡进剧本包
    chars.forEach(function(ch){
      if(profiles[ch]){
        var card = {
          name: ch,
          description: profiles[ch].fields.core_identity || "",
          personality: profiles[ch].fields.core_traits || "",
          first_mes: "",
          _distill: profiles[ch].fields
        };
        DISTILL_PACKAGE.saveCharacterCard(S.pkg.id, ch, card);
      }
    });
    setStage("profile", "done");

    // 关系
    await waitIfPaused();
    setStage("relations", "run");
    var edges = DISTILL_RELATIONS.extractPairs(S.chunks, chars, aliasMap, {});
    await DISTILL_RELATIONS.enrichEdges(edges, function(d, t, m){ prog("[关系] " + m, 50 + d / t * 15); }, {shouldPause: function(){ return S.paused; }});
    DISTILL_PACKAGE.saveData(S.pkg.id, "relations", edges);
    setStage("relations", "done");

    // 剧情 (完整模式)
    if(depth === "full"){
      await waitIfPaused();
      setStage("plot", "run");
      var summaries = await DISTILL_PLOT.summarizeChunks(S.chunks, chars, aliasMap, {
        checkpoint: checkpoint,
        shouldPause: function(){ return S.paused; },
        onProgress: function(d, t, m){ prog("[剧情] " + m, 65 + d / t * 20); },
        onCheckpoint: function(cp){ try{ localStorage.setItem(ckptKey, JSON.stringify(cp)); }catch(e){} }
      });
      var sections = await DISTILL_PLOT.buildOutline(summaries, {});
      var conflicts = await DISTILL_PLOT.extractConflicts(sections, {});
      var arcs = await DISTILL_PLOT.extractArcs(chars, summaries, {});
      var pairs = DISTILL_PLOT.pairForeshadowing(summaries, {});
      DISTILL_PACKAGE.saveData(S.pkg.id, "plot", {sections: sections, conflicts: conflicts, arcs: arcs, pairs: pairs});

      // 世界书
      prog("[世界书] 提取世界观...", 88);
      var worldbook = await DISTILL_WORLDBOOK.extractWorldbook(summaries, chars, {
        shouldPause: function(){ return S.paused; },
        onProgress: function(m){ prog("[世界书] " + m, 88); }
      });
      DISTILL_PACKAGE.saveData(S.pkg.id, "worldbook", worldbook);

      // 开场白
      prog("[开场白] 生成中...", 95);
      await DISTILL_OPENINGS.generateAll(S.pkg.id, chars, {
        shouldPause: function(){ return S.paused; },
        onProgress: function(d, t, m){ prog("[开场白] " + m, 95 + d / t * 4); }
      });
      setStage("plot", "done");
    }

    S.running = false;
    try{ localStorage.removeItem(ckptKey); }catch(e){}
    // 保存 chunks 轻量引用供时序泄漏检测
    try{
      window._distillChunks = (S.chunks || []).map(function(c){
        return {id: c.id, text: (c.text || "").slice(0, 2000)};
      });
    }catch(e){}
    // 构建出处索引 + 引用校验 (存在性 + 内容真实性)
    try{
      var chars = Object.keys(S.selected).filter(function(k){ return S.selected[k]; });
      var idx = DISTILL_PROVENANCE.buildIndex(S.pkg.id, chars);
      // B1: 补充来源哈希+字符位置
      try{ DISTILL_PROVENANCE.enrichSourceLocation(idx, S.chunks); }catch(e){}
      // B2: 证据确定性分级
      try{ DISTILL_PROVENANCE.gradeCertainty(idx); }catch(e){}
      var chunkIds = (S.chunks || []).map(function(c){ return c.id; });
      var badId = DISTILL_PROVENANCE.validateCitations(idx, chunkIds);
      var badContent = DISTILL_PROVENANCE.verifyCitationContent(idx, S.chunks);
      var warns = [];
      if(badId.length) warns.push(badId.length + " 条引用指向不存在的 chunk");
      if(badContent.length) warns.push(badContent.length + " 条引用内容在原文找不到 (无锚定)");
      S.citationWarnings = warns.length ? warns.join("；") + "，可能为 LLM 幻觉" : null;
      // 存无锚定引用供质量门使用
      try{ DISTILL_PACKAGE.saveData(S.pkg.id, "unanchored", badContent.map(function(b){
        return {character: b.fact.character, field: b.fact.field, value: b.fact.value.slice(0, 50)};
      })); }catch(e){}
    }catch(e){}
    prog("完成! 剧本包已生成", 100);
    // 文风抽取 (后台，不阻塞)
    try{
      if(S.chunks && S.chunks.length && typeof DISTILL_STYLE !== "undefined"){
        var samples = S.chunks.slice(0, 3).map(function(c){ return c.text; });
        DISTILL_STYLE.extract(S.pkg.id, S.pkg.novel, samples, {}).then(function(card){
          console.log("文风卡已生成:", card.name);
        }).catch(function(e){ console.log("文风抽取跳过:", e.message); });
      }
    }catch(e){}
    setTimeout(function(){ S.step = 5; render(); }, 1500);
  }catch(e){
    S.running = false;
    prog("出错: " + e.message, 0);
  }
}

function openPackage(id){
  var pkg = DISTILL_PACKAGE.getPackage(id);
  if(!pkg) return;
  var cards = DISTILL_PACKAGE.listCharacterCards(id);
  var v = document.getElementById("view");
  var qualityHtml = "";
  try{
    if(typeof DISTILL_QUALITY !== "undefined"){
      qualityHtml = DISTILL_QUALITY.renderReport(DISTILL_QUALITY.check(id));
    }
  }catch(e){}
  var wb = DISTILL_PACKAGE.getData(id, "worldbook");
  var wbCount = wb ? (wb.rules || []).length + (wb.locations || []).length + (wb.factions || []).length : 0;
  // M1: Memory Usage (Character.AI)
  var memHtml = "";
  try{
    if(typeof DISTILL_MEMORY !== "undefined"){
      memHtml = DISTILL_MEMORY.renderUsage(id);
    }
  }catch(e){}
  v.innerHTML = `<h2 class="sec">${esc(pkg.novel)}</h2>
    <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:12px">剧本包 · ${cards.length} 个角色${wbCount ? " · " + wbCount + " 条世界书" : ""}</div>
    ${qualityHtml}
    ${memHtml}
    ${wbCount ? `<button class="btn" style="margin-bottom:12px" data-dact="showWorldbook" data-did="${id}">📖 世界书 (${wbCount})</button>` : ""}
    <button class="btn" style="margin-bottom:12px;margin-left:8px" data-dact="runAudit" data-did="${id}">🔍 审计员</button>
    <button class="btn" style="margin-bottom:12px;margin-left:8px" data-dact="runProbes" data-did="${id}">🎭 人格探针</button>
    <button class="btn" style="margin-bottom:12px;margin-left:8px" onclick="DISTILL_UI.showStyles()">✒️ 文风库</button>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    ${cards.map(function(c){
      return `<div class="card card--tap" style="padding:12px" data-dact="openCharacter" data-did="${id}" data-dname="${escA(c.name)}">
        <div style="font-weight:600">${esc(c.name)}</div>
        <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint)">★${c.importance} ${c.hasCard ? "· 已蒸馏" : ""}</div>
      </div>`;
    }).join("")}
    </div>
    <div class="btnrow" style="margin-top:16px">
      <button class="btn" onclick="DISTILL_UI.show()">← 返回</button>
      <button class="btn" data-dact="exportPkg" data-did="${id}">📤 导出</button>
      <button class="btn" onclick="document.getElementById('d_import_pkg').click()">📥 导入</button>
      <input type="file" id="d_import_pkg" accept=".json" style="display:none">
    </div>`;
}

var _charStage = "late"; // 当前查看阶段

function renderAnnotated(text){
  // 渲染带四态标注的文本
  if(!text) return "";
  return esc(text).replace(/\[(canon|ref|inference|unknown)(?::([a-z0-9_\-]+))?\]/gi,
    function(m, s, c){
      var label = DISTILL_PROVENANCE.SOURCE_LABEL[s.toLowerCase()] || s;
      var color = DISTILL_PROVENANCE.SOURCE_COLOR[s.toLowerCase()] || "var(--ink-faint)";
      var title = c ? "来源: " + c : label;
      return `<span style="font-size:calc(10px * var(--fs));color:${color};border:1px solid ${color};border-radius:3px;padding:0 4px;margin-left:4px" title="${esc(title)}">${label}</span>`;
    });
}

function openCharacter(pkgId, name, stage){
  stage = stage || _charStage;
  _charStage = stage;
  var card = DISTILL_PACKAGE.getCharacterCard(pkgId, name);
  var v = document.getElementById("view");
  if(!card){
    v.innerHTML = `<div class="empty">角色卡未生成</div><button class="btn" onclick="DISTILL_UI.show()">返回</button>`;
    return;
  }
  var d = card._distill || {};
  // 按阶段取 (防剧透: early 只看 early, mid 看 early+mid, late 全看)
  var stageData = d[stage] || {};
  if(stage === "mid") stageData = Object.assign({}, d.early, d.mid);
  if(stage === "late") stageData = d; // 顶层为全量

  var prov = DISTILL_PACKAGE.getData(pkgId, "provenance");
  var provStats = prov ? DISTILL_PROVENANCE.stats(prov) : null;

  v.innerHTML = `<h2 class="sec">${esc(name)}</h2>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      ${["early","mid","late"].map(function(s){
        var label = s === "early" ? "前期" : s === "mid" ? "中期" : "后期";
        var active = s === stage ? "var(--gold)" : "var(--line)";
        return `<button class="btn" style="flex:1;border-color:${active}" data-dact="openCharacter" data-did="${pkgId}" data-dname="${escA(name)}" data-dstage="${s}">${label}</button>`;
      }).join("")}
    </div>
    <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint);margin-bottom:8px">当前查看: ${stage === "early" ? "前期 (防剧透)" : stage === "mid" ? "中期" : "后期 (全量)"}</div>
    <div class="card">
      ${stageData.core_identity ? `<div class="kvline"><b>身份</b>：${renderAnnotated(stageData.core_identity)}</div>` : ""}
      ${stageData.brief_intro ? `<div class="kvline"><b>简介</b>：${renderAnnotated(stageData.brief_intro)}</div>` : ""}
      ${stageData.core_traits ? `<div class="kvline"><b>性格</b>：${renderAnnotated(stageData.core_traits)}</div>` : ""}
      ${stageData.speech_style ? `<div class="kvline"><b>说话</b>：${renderAnnotated(stageData.speech_style)}</div>` : ""}
      ${stageData.soul_goal ? `<div class="kvline"><b>追求</b>：${renderAnnotated(stageData.soul_goal)}</div>` : ""}
      ${stageData.background ? `<div class="kvline"><b>背景</b>：${renderAnnotated(stageData.background)}</div>` : ""}
      ${stageData.key_bonds ? `<div class="kvline"><b>关系</b>：${renderAnnotated(stageData.key_bonds)}</div>` : ""}
      ${(stageData.age || stageData.gender || stageData.height) ? `<div class="kvline"><b>人口</b>：${[stageData.age, stageData.gender, stageData.height].filter(Boolean).join(" · ")}</div>` : ""}
      ${(stageData.likes || stageData.dislikes) ? `<div class="kvline"><b>好恶</b>：${stageData.likes ? "喜 " + renderAnnotated(stageData.likes) : ""}${stageData.dislikes ? " / 厌 " + renderAnnotated(stageData.dislikes) : ""}</div>` : ""}
      ${(stageData.interests || stageData.fears) ? `<div class="kvline"><b>心理</b>：${stageData.interests ? "趣 " + renderAnnotated(stageData.interests) : ""}${stageData.fears ? " / 惧 " + renderAnnotated(stageData.fears) : ""}</div>` : ""}
    </div>
    ${provStats ? `<div class="card" style="margin-top:12px">
      <div style="font-size:calc(13px * var(--fs));font-weight:600;margin-bottom:8px">出处统计</div>
      <div style="font-size:calc(12px * var(--fs))">
        <span style="color:${DISTILL_PROVENANCE.SOURCE_COLOR.canon}">●</span> 原文实证 ${provStats.canon || 0}
        <span style="color:${DISTILL_PROVENANCE.SOURCE_COLOR.ref};margin-left:8px">●</span> 间接旁证 ${provStats.ref || 0}
        <span style="color:${DISTILL_PROVENANCE.SOURCE_COLOR.inference};margin-left:8px">●</span> 合理推断 ${provStats.inference || 0}
      </div>
      <button class="btn" style="margin-top:8px" data-dact="showProvenance" data-did="${pkgId}" data-dname="${escA(name)}">查看出处索引</button>
    </div>` : ""}
    ${function(){
      var openings = [];
      try{
        var all = DISTILL_PACKAGE.getData(pkgId, "openings") || {};
        openings = all[name] || [];
      }catch(e){}
      if(!openings.length) return "";
      return `<div class="card" style="margin-top:12px">
        <div style="font-size:calc(13px * var(--fs));font-weight:600;margin-bottom:8px">💬 开场白 (${openings.length})</div>
        ${openings.map(function(o, i){
          return `<div style="font-size:calc(12px * var(--fs));padding:6px 0;border-bottom:1px solid var(--line)">
            <div style="color:var(--gold);font-size:calc(11px * var(--fs))">${esc(o.situation || ("开场" + (i+1)))}</div>
            <div style="margin-top:2px">${esc(o.text.slice(0, 120))}${o.text.length > 120 ? "..." : ""}</div>
          </div>`;
        }).join("")}
        <button class="btn" style="margin-top:8px" data-dact="regenOpenings" data-did="${pkgId}" data-dname="${escA(name)}">🔄 重新生成</button>
      </div>`;
    }()}
    <div class="card" style="margin-top:12px">
      <div style="font-size:calc(13px * var(--fs));font-weight:600;margin-bottom:8px">🎚️ 性格微调 (Tavo)</div>
      ${["rigor", "breadth", "style"].map(function(axis){
        var labels = {rigor: ["严谨", "想象"], breadth: ["单一", "多面"], style: ["固定", "多变"]};
        var val = 50;
        try{
          var prefs = JSON.parse(localStorage.getItem("distill_axis_" + pkgId + "_" + name) || "{}");
          val = prefs[axis] != null ? prefs[axis] : 50;
        }catch(e){}
        return `<div style="margin-bottom:8px">
          <div style="font-size:calc(12px * var(--fs));display:flex;justify-content:space-between">
            <span>${labels[axis][0]}</span><span>${labels[axis][1]}</span>
          </div>
          <input type="range" min="0" max="100" value="${val}" data-axis="${axis}" data-pkg="${pkgId}" data-name="${esc(name)}"
            onchange="DISTILL_UI.setAxis(this)" style="width:100%">
        </div>`;
      }).join("")}
    </div>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" onclick="DISTILL_UI.show()">← 返回</button>
      <button class="btn" data-dact="requestChange" data-did="${pkgId}" data-dname="${escA(name)}">✏️ 改动</button>
      <button class="btn" data-dact="polishCard" data-did="${pkgId}" data-dname="${escA(name)}">✨ 去AI腔</button>
      <button class="btn" data-dact="playground" data-did="${pkgId}" data-dname="${escA(name)}">🎮 试玩</button>
      <button class="btn" data-dact="dynamicGreeting" data-did="${pkgId}" data-dname="${escA(name)}">✨ 动态开场</button>
      <button class="btn primary" data-dact="chat" data-did="${pkgId}" data-dname="${escA(name)}">开聊</button>
    </div>`;
}

function showProvenance(pkgId, name){
  var prov = DISTILL_PACKAGE.getData(pkgId, "provenance");
  var v = document.getElementById("view");
  if(!prov){
    v.innerHTML = `<div class="empty">暂无出处索引</div>`;
    return;
  }
  var facts = prov.facts.filter(function(f){ return !name || f.character === name; });
  var libStats = (typeof DISTILL_LIBRARY !== "undefined") ? DISTILL_LIBRARY.stats(pkgId) : null;
  v.innerHTML = `<h2 class="sec">📚 资料库 ${name ? "· " + esc(name) : ""}
    ${name ? `<button class="btn" style="font-size:calc(12px * var(--fs));margin-left:8px" data-dact="autoExtractFacts" data-did="${pkgId}" data-dname="${escA(name)}">⚡ 自动抽取</button>` : ""}</h2>
    <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:12px">
      ${facts.length} 条事实${libStats && libStats.edited ? " · " + libStats.edited + " 条已编辑" : ""}
    </div>
    <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint);background:var(--line);border-radius:6px;padding:8px;margin-bottom:12px">
      ℹ️ 引用核验只能证明原句在原文存在，不能证明结论正确。请结合上下文判断。
    </div>
    ${facts.map(function(f, i){
      var color = DISTILL_PROVENANCE.SOURCE_COLOR[f.source] || "var(--ink-faint)";
      var label = DISTILL_PROVENANCE.SOURCE_LABEL[f.source] || f.source;
      // 找到该角色事实列表中的 index
      var charFacts = prov.facts.filter(function(x){ return x.character === f.character; });
      var fidx = charFacts.indexOf(f);
      return `<div class="card" style="padding:10px;margin-bottom:8px">
        <div style="font-size:calc(12px * var(--fs))"><b>${esc(f.field)}</b>:
          <span style="color:${color};font-size:calc(11px * var(--fs));margin-left:6px">${label}${f.chunk_id ? " · " + esc(f.chunk_id) : ""}${f.edited ? " · ✏️已编辑" : ""}</span>
          ${name ? `<span style="float:right">
            <a href="javascript:void(0)" data-dact="editFact" data-did="${pkgId}" data-dname="${escA(f.character)}" data-didx="${fidx}" style="font-size:calc(11px * var(--fs));color:var(--gold)">编辑</a>
            <a href="javascript:void(0)" data-dact="deleteFact" data-did="${pkgId}" data-dname="${escA(f.character)}" data-didx="${fidx}" style="font-size:calc(11px * var(--fs));color:#e74c3c;margin-left:8px">删除</a>
          </span>` : ""}
        </div>
        <div style="font-size:calc(13px * var(--fs));margin-top:4px">${esc(f.value)}</div>
      </div>`;
    }).join("")}
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" data-dact="openCharacter" data-did="${pkgId}" data-dname="${escA(name || "")}">← 返回</button>
      ${name ? `<button class="btn" data-dact="addFact" data-did="${pkgId}" data-dname="${escA(name)}">+ 新增事实</button>
      <button class="btn primary" data-dact="recompileCard" data-did="${pkgId}" data-dname="${escA(name)}">🔄 重新编译角色卡</button>` : ""}
    </div>`;
}

// 改动单 UI
var _pendingChange = null;

async function requestChange(pkgId, name){
  var v = document.getElementById("view");
  v.innerHTML = `<h2 class="sec">✏️ 申请改动 · ${esc(name)}</h2>
    <div class="card">
      <div style="font-size:calc(13px * var(--fs));margin-bottom:8px">一句话描述你想怎么改：</div>
      <textarea id="d_change_req" rows="3" style="width:100%;font-size:calc(14px * var(--fs));padding:8px;border:1px solid var(--line);border-radius:6px" placeholder="例如：把她改得更活泼一点，少一点忧郁"></textarea>
      <div class="btnrow" style="margin-top:12px">
        <button class="btn" data-dact="openCharacter" data-did="${pkgId}" data-dname="${escA(name)}">取消</button>
        <button class="btn primary" id="d_change_go">分析影响 →</button>
      </div>
      <div id="d_change_msg" style="font-size:calc(12px * var(--fs));margin-top:8px;color:var(--ink-faint)"></div>
    </div>`;
  document.getElementById("d_change_go").onclick = async function(){
    var req = document.getElementById("d_change_req").value.trim();
    if(!req){ alert("请先描述改动"); return; }
    var msg = document.getElementById("d_change_msg");
    msg.textContent = "AI 分析中...";
    try{
      var result = await DISTILL_CHANGE.proposeChange(pkgId, name, req, function(m){ msg.textContent = m; });
      _pendingChange = {pkgId: pkgId, name: name, result: result};
      showChangeImpacts();
    }catch(e){
      msg.textContent = "失败: " + e.message;
    }
  };
}

function showChangeImpacts(){
  var p = _pendingChange;
  if(!p) return;
  var v = document.getElementById("view");
  var r = p.result;
  v.innerHTML = `<h2 class="sec">改动影响清单 · ${esc(p.name)}</h2>
    <div class="card" style="margin-bottom:12px">
      <div style="font-size:calc(13px * var(--fs));margin-bottom:8px">${esc(r.summary)}</div>
      <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">将修改 ${r.impacts.length} 个字段：</div>
    </div>
    ${r.impacts.map(function(im, i){
      return `<div class="card" style="margin-bottom:8px;padding:10px">
        <div style="font-weight:600;font-size:calc(13px * var(--fs));margin-bottom:4px">${esc(im.label)}</div>
        <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint);margin-bottom:4px">💡 ${esc(im.reason)}</div>
        <div style="font-size:calc(12px * var(--fs));background:var(--line);border-radius:4px;padding:6px;margin-bottom:4px;max-height:80px;overflow-y:auto">
          <span style="color:var(--ink-faint)">原:</span> ${esc(im.old_value.slice(0, 200))}${im.old_value.length > 200 ? "..." : ""}
        </div>
        <div style="font-size:calc(12px * var(--fs));background:rgba(240,173,78,.1);border-radius:4px;padding:6px;max-height:80px;overflow-y:auto">
          <span style="color:#f0ad4e">新:</span> ${esc(im.new_value.slice(0, 200))}${im.new_value.length > 200 ? "..." : ""}
        </div>
      </div>`;
    }).join("")}
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" data-dact="openCharacter" data-did="${p.pkgId}" data-dname="${escA(p.name)}">取消</button>
      <button class="btn primary" onclick="DISTILL_UI.confirmChange()">确认改动</button>
    </div>
    <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint);margin-top:8px">改动将标记为 [inference] 来源</div>`;
}

function confirmChange(){
  var p = _pendingChange;
  if(!p) return;
  try{
    DISTILL_CHANGE.applyChange(p.pkgId, p.name, p.result.impacts);
    _pendingChange = null;
    openCharacter(p.pkgId, p.name);
  }catch(e){
    alert("应用失败: " + e.message);
  }
}

// 导出分享
function exportPkg(pkgId){
  try{
    var data = DISTILL_PACKAGE.exportPackage(pkgId);
    if(!data){ alert("导出失败"); return; }
    var blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "剧本包_" + (data.meta.novel || pkgId) + ".json";
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  }catch(e){
    alert("导出失败: " + e.message);
  }
}

function importPkg(file){
  var rd = new FileReader();
  rd.onload = function(){
    try{
      var data = JSON.parse(rd.result);
      if(!data.meta || !data.meta.novel) throw new Error("格式错误");
      // 创建新包
      var pkg = DISTILL_PACKAGE.createPackage(data.meta.novel + "(导入)");
      // 导入角色
      (data.meta.characters || []).forEach(function(c){
        pkg.characters.push(c);
      });
      DISTILL_PACKAGE.updatePackage(pkg);
      // 导入角色卡
      Object.keys(data.characters || {}).forEach(function(name){
        if(data.characters[name]){
          DISTILL_PACKAGE.saveCharacterCard(pkg.id, name, data.characters[name]);
        }
      });
      // 导入关系/剧情/世界书/出处
      ["relations", "plot", "worldbook", "provenance"].forEach(function(k){
        if(data[k]) DISTILL_PACKAGE.saveData(pkg.id, k, data[k]);
      });
      alert("导入成功: " + data.meta.novel);
      show();
    }catch(e){
      alert("导入失败: " + e.message);
    }
  };
  rd.readAsText(file, "utf-8");
}

// 世界书展示
function showWorldbook(pkgId){
  var wb = DISTILL_PACKAGE.getData(pkgId, "worldbook");
  var v = document.getElementById("view");
  if(!wb || (!(wb.rules || []).length && !(wb.locations || []).length && !(wb.factions || []).length)){
    v.innerHTML = `<div class="empty">暂无世界书</div><button class="btn" data-dact="openPackage" data-did="${pkgId}">← 返回</button>`;
    return;
  }
  function ruleCard(r){
    return `<div class="card" style="padding:10px;margin-bottom:8px">
      <div style="font-weight:600;font-size:calc(13px * var(--fs))">📜 ${esc(r.name)}${r.source ? ` <span style="font-size:calc(11px * var(--fs));color:var(--ink-faint)">[${esc(r.source)}]</span>` : ""}</div>
      <div style="font-size:calc(13px * var(--fs));margin-top:4px">${esc(r.rule)}</div>
      ${r.cost ? `<div style="font-size:calc(12px * var(--fs));margin-top:4px"><b>代价:</b> ${esc(r.cost)}</div>` : ""}
      ${r.limit ? `<div style="font-size:calc(12px * var(--fs))"><b>限制:</b> ${esc(r.limit)}</div>` : ""}
      ${r.exception ? `<div style="font-size:calc(12px * var(--fs))"><b>例外:</b> ${esc(r.exception)}</div>` : ""}
      ${r.conflict_hook ? `<div style="font-size:calc(12px * var(--fs));color:#f0ad4e"><b>⚔️ 冲突钩子:</b> ${esc(r.conflict_hook)}</div>` : ""}
    </div>`;
  }
  v.innerHTML = `<h2 class="sec">📖 世界书</h2>
    ${(wb.rules || []).length ? `<div style="font-weight:600;margin:12px 0 8px">世界规则 (${wb.rules.length})</div>` + wb.rules.map(ruleCard).join("") : ""}
    ${(wb.locations || []).length ? `<div style="font-weight:600;margin:12px 0 8px">重要场景 (${wb.locations.length})</div>` + wb.locations.map(function(l){
      return `<div class="card" style="padding:10px;margin-bottom:8px">
        <div style="font-weight:600;font-size:calc(13px * var(--fs))">📍 ${esc(l.name)}</div>
        <div style="font-size:calc(13px * var(--fs));margin-top:4px">${esc(l.desc)}</div>
      </div>`;
    }).join("") : ""}
    ${(wb.factions || []).length ? `<div style="font-weight:600;margin:12px 0 8px">势力组织 (${wb.factions.length})</div>` + wb.factions.map(function(f){
      return `<div class="card" style="padding:10px;margin-bottom:8px">
        <div style="font-weight:600;font-size:calc(13px * var(--fs))">🏰 ${esc(f.name)}</div>
        <div style="font-size:calc(13px * var(--fs));margin-top:4px">${esc(f.desc)}</div>
        ${(f.members || []).length ? `<div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">成员: ${f.members.map(esc).join("、")}</div>` : ""}
      </div>`;
    }).join("") : ""}
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" data-dact="openPackage" data-did="${pkgId}">← 返回</button>
    </div>`;
}

// 资料库操作
function editFact(pkgId, charName, factIndex){
  var facts = DISTILL_LIBRARY.getFacts(pkgId, charName);
  var f = facts[factIndex];
  if(!f) return;
  var v = document.getElementById("view");
  v.innerHTML = `<h2 class="sec">编辑事实 · ${esc(charName)}</h2>
    <div class="card">
      <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:8px">${esc(f.field)} · ${esc(f.source)}${f.chunk_id ? " · " + esc(f.chunk_id) : ""}</div>
      <textarea id="d_fact_val" rows="4" style="width:100%;font-size:calc(14px * var(--fs));padding:8px;border:1px solid var(--line);border-radius:6px">${esc(f.value)}</textarea>
      <div class="btnrow" style="margin-top:12px">
        <button class="btn" data-dact="showProvenance" data-did="${pkgId}" data-dname="${escA(charName)}">取消</button>
        <button class="btn primary" data-dact="saveFact" data-did="${pkgId}" data-dname="${escA(charName)}" data-didx="${factIndex}">保存</button>
      </div>
    </div>`;
}

function saveFact(pkgId, charName, factIndex){
  var val = document.getElementById("d_fact_val").value.trim();
  if(!val){ alert("内容不能为空"); return; }
  DISTILL_LIBRARY.editFact(pkgId, charName, factIndex, val);
  showProvenance(pkgId, charName);
}

function deleteFact(pkgId, charName, factIndex){
  if(!confirm("确定删除这条事实吗？")) return;
  DISTILL_LIBRARY.deleteFact(pkgId, charName, factIndex);
  showProvenance(pkgId, charName);
}

function addFact(pkgId, charName){
  var v = document.getElementById("view");
  v.innerHTML = `<h2 class="sec">新增事实 · ${esc(charName)}</h2>
    <div class="card">
      <div style="font-size:calc(13px * var(--fs));margin-bottom:8px">字段：</div>
      <select id="d_fact_field" style="width:100%;font-size:calc(14px * var(--fs));padding:8px;margin-bottom:12px;border:1px solid var(--line);border-radius:6px">
        ${DISTILL_CHANGE.EDITABLE_FIELDS.map(function(f){
          return `<option value="${f}">${DISTILL_CHANGE.FIELD_LABEL[f] || f}</option>`;
        }).join("")}
      </select>
      <div style="font-size:calc(13px * var(--fs));margin-bottom:8px">内容：</div>
      <textarea id="d_fact_val" rows="4" style="width:100%;font-size:calc(14px * var(--fs));padding:8px;border:1px solid var(--line);border-radius:6px"></textarea>
      <div class="btnrow" style="margin-top:12px">
        <button class="btn" data-dact="showProvenance" data-did="${pkgId}" data-dname="${escA(charName)}">取消</button>
        <button class="btn primary" id="d_fact_add_go">添加</button>
      </div>
    </div>`;
  document.getElementById("d_fact_add_go").onclick = function(){
    var field = document.getElementById("d_fact_field").value;
    var val = document.getElementById("d_fact_val").value.trim();
    if(!val){ alert("内容不能为空"); return; }
    DISTILL_LIBRARY.addFact(pkgId, charName, field, val, "inference");
    showProvenance(pkgId, charName);
  };
}

function recompileCard(pkgId, charName){
  if(!confirm("将根据当前资料库事实重新生成角色卡，确定吗？")) return;
  try{
    DISTILL_LIBRARY.recompileCard(pkgId, charName);
    openCharacter(pkgId, charName);
  }catch(e){
    alert("重编译失败: " + e.message);
  }
}

async function regenOpenings(pkgId, charName){
  if(!confirm("重新生成开场白？")) return;
  var card = DISTILL_PACKAGE.getCharacterCard(pkgId, charName);
  if(!card) return;
  try{
    var openings = await DISTILL_OPENINGS.generateOpenings(charName, card._distill, {});
    if(openings.length){
      var all = DISTILL_PACKAGE.getData(pkgId, "openings") || {};
      all[charName] = openings;
      DISTILL_PACKAGE.saveData(pkgId, "openings", all);
      card.first_mes = openings[0].text;
      card.alternate_greetings = openings.slice(1).map(function(o){ return o.text; });
      DISTILL_PACKAGE.saveCharacterCard(pkgId, charName, card);
    }
    openCharacter(pkgId, charName);
  }catch(e){
    alert("生成失败: " + e.message);
  }
}

var api = {show: show, openPackage: openPackage, openCharacter: openCharacter, showProvenance: showProvenance,
  requestChange: requestChange, confirmChange: confirmChange,
  editFact: editFact, saveFact: saveFact, deleteFact: deleteFact, addFact: addFact, recompileCard: recompileCard,
  showWorldbook: showWorldbook,
  showStyles: function(){
    var cards = DISTILL_STYLE.listCards();
    var v = document.getElementById("view");
    var html = `<h2 class="sec">✒️ 文风库 (${cards.length})</h2>
      <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:12px">调用文风 = 对应作家执笔，可续写/创作</div>`;
    if(!cards.length){
      html += `<div class="card"><div style="font-size:calc(13px * var(--fs));color:var(--ink-faint)">暂无文风卡。蒸馏小说时会自动抽取。</div></div>`;
    }
    cards.forEach(function(c){
      var total = Object.keys(c.sheet || {}).reduce(function(n, k){ return n + (c.sheet[k] || []).length; }, 0);
      html += `<div class="card card--tap" style="margin-bottom:8px;padding:12px" data-dact="showStyleDetail" data-did="${c.id}">
        <div style="font-weight:600">${esc(c.name)}</div>
        <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">${total} 条风格特征 · ${c.signature_lines.length} 句式</div>
      </div>`;
    });
    html += `<button class="btn" onclick="DISTILL_UI.show()">返回</button>`;
    v.innerHTML = html;
  },
  showStyleDetail: function(id){
    var c = DISTILL_STYLE.getCard(id);
    if(!c) return;
    var v = document.getElementById("view");
    var html = `<h2 class="sec">✒️ ${esc(c.name)}</h2>`;
    Object.keys(DISTILL_STYLE.CATEGORIES).forEach(function(cat){
      var items = (c.sheet[cat] || []);
      if(!items.length) return;
      html += `<div class="card" style="margin-bottom:8px"><div style="font-weight:600;font-size:calc(13px * var(--fs));margin-bottom:6px">${DISTILL_STYLE.CATEGORIES[cat]}</div>`;
      items.forEach(function(it){
        html += `<div style="font-size:calc(13px * var(--fs));margin-bottom:4px">• ${esc(it.claim)}</div>`;
        if(it.evidence) html += `<div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-left:12px;margin-bottom:6px">例：${esc(it.evidence.slice(0, 80))}</div>`;
      });
      html += `</div>`;
    });
    if(c.signature_lines.length){
      html += `<div class="card" style="margin-bottom:8px"><div style="font-weight:600;font-size:calc(13px * var(--fs));margin-bottom:6px">标志性句式</div>`;
      c.signature_lines.forEach(function(l){
        html += `<div style="font-size:calc(13px * var(--fs));margin-bottom:4px">“${esc(l.slice(0, 100))}”</div>`;
      });
      html += `</div>`;
    }
    html += `<div class="btnrow" style="margin-top:12px">
      <button class="btn" onclick="DISTILL_UI.showStyles()">← 返回</button>
      <button class="btn" style="color:#e74c3c" data-dact="deleteStyle" data-did="${id}">删除</button>
      <button class="btn primary" data-dact="useStyle" data-did="${id}">✍️ 用此文风续写</button>
    </div>`;
    v.innerHTML = html;
  },
  useStyle: function(id){
    var c = DISTILL_STYLE.getCard(id);
    if(!c) return;
    var prompt = DISTILL_STYLE.toPrompt(c);
    var text = prompt("续写内容（会按【" + c.name + "】文风生成）：", "");
    if(!text) return;
    // 存待用，下次聊天/写卡时注入
    try{ localStorage.setItem("distill_active_style", JSON.stringify({id: id, prompt: prompt})); }catch(e){}
    alert("已选用【" + c.name + "】文风，将在下次生成时应用");
    DISTILL_UI.showStyles();
  },
  dynamicGreeting: async function(pkgId, name){
    var stage = prompt("当前阶段？(early/mid/late，可空)", "");
    var text = await DISTILL_OPENINGS.generateDynamic(pkgId, name, {stage: stage || undefined});
    if(text) alert("动态开场白：\n\n" + text);
    else alert("生成失败");
  },
  autoExtractFacts: async function(pkgId, name){
    if(!confirm("自动抽取 " + name + " 的事实？(1次LLM调用)")) return;
    var facts = await DISTILL_LIBRARY.autoExtract(pkgId, name, {
      onProgress: function(msg){ console.log(msg); }
    });
    alert("抽取了 " + facts.length + " 条事实");
    DISTILL_UI.showLibrary(pkgId, name);
  },
  setAxis: function(el){
    var pkgId = el.getAttribute("data-pkg");
    var name = el.getAttribute("data-name");
    var axis = el.getAttribute("data-axis");
    var val = parseInt(el.value);
    try{
      var prefs = JSON.parse(localStorage.getItem("distill_axis_" + pkgId + "_" + name) || "{}");
      prefs[axis] = val;
      localStorage.setItem("distill_axis_" + pkgId + "_" + name, JSON.stringify(prefs));
    }catch(e){}
  },
  getAxisPrompt: function(pkgId, name){
    // 返回三轴对应的 prompt 补充
    var prefs = {};
    try{ prefs = JSON.parse(localStorage.getItem("distill_axis_" + pkgId + "_" + name) || "{}"); }catch(e){}
    var parts = [];
    var rigor = prefs.rigor != null ? prefs.rigor : 50;
    var breadth = prefs.breadth != null ? prefs.breadth : 50;
    var style = prefs.style != null ? prefs.style : 50;
    if(rigor < 30) parts.push("回答严谨克制，少发散");
    else if(rigor > 70) parts.push("回答富有想象力，可适当发散");
    if(breadth < 30) parts.push("性格表现单一集中");
    else if(breadth > 70) parts.push("性格表现多面立体");
    if(style < 30) parts.push("对话风格固定一致");
    else if(style > 70) parts.push("对话风格灵活多变");
    return parts.join("；");
  },
  runProbes: async function(id){
    var cards = DISTILL_PACKAGE.listCharacterCards(id);
    if(!cards.length){ alert("没有角色卡"); return; }
    // 选一个人
    var name = cards[0].name;
    if(cards.length > 1){
      var sel = prompt("探针哪个人物？\n" + cards.map(function(c){ return c.name; }).join("\n"), name);
      if(!sel) return;
      name = sel;
    }
    if(!confirm("对 " + name + " 运行9道人格探针？(约18次LLM调用)")) return;
    var v = document.getElementById("view");
    v.innerHTML = `<h2 class="sec">🎭 人格探针 · ${esc(name)}</h2><div id="probeProg" style="font-size:calc(14px * var(--fs))"></div><div id="probeLog"></div>`;
    var result = await DISTILL_PROBES.probe(id, name, {
      onProgress: function(i, n, msg){
        var el = document.getElementById("probeProg");
        if(el) el.textContent = msg;
      }
    });
    var html = `<h2 class="sec">🎭 探针结果 · ${esc(name)}</h2>
      <div style="font-size:calc(13px * var(--fs));margin-bottom:12px">${result.pass ? "✅ 通过" : "⚠️ 存疑"} (${result.ooc_count}/9 题 OOC)</div>`;
    result.results.forEach(function(r, i){
      var icon = r.ooc ? "🔴" : "🟢";
      html += `<div class="card" style="margin-bottom:8px">
        <div style="font-size:calc(13px * var(--fs));font-weight:600">${icon} Q${i+1}: ${esc(r.question)}</div>
        <div style="font-size:calc(13px * var(--fs));margin-top:4px">答：${esc(r.answer.slice(0, 100))}</div>
        ${r.ooc ? `<div style="font-size:calc(12px * var(--fs));color:#f0ad4e;margin-top:4px">OOC: ${esc(r.reason)}</div>` : ""}
      </div>`;
    });
    html += `<button class="btn" data-dact="openPackage" data-did="${id}">返回</button>`;
    v.innerHTML = html;
  },
  qaMode: function(on){
    S.qaMode = on;
    if(on){ QA_STATE.step = 0; QA_STATE.answers = {}; }
    render();
  },
  qaAnswer: function(qid, val){
    if(qid === "depth"){
      QA_STATE.answers.depth = val;
      // 直接设到 S
      S.depth = val;
      QA_STATE.step = 1;
      render();
    }else if(qid === "confirm"){
      if(val === "yes"){
        S.qaMode = false;
        onPlan();  // 生成计划书
      }else{
        QA_STATE.step = 0;
        render();
      }
    }
  },
  polishCard: function(pkgId, name){
    var card = DISTILL_PACKAGE.getCharacterCard(pkgId, name);
    if(!card || !card._distill) return;
    var total = 0;
    Object.keys(card._distill).forEach(function(k){
      var v = card._distill[k];
      if(typeof v !== "string") return;
      var r = DISTILL_QUALITY.polishAiCliche(v);
      if(r.fixed > 0){ card._distill[k] = r.text; total += r.fixed; }
    });
    if(total > 0){
      DISTILL_PACKAGE.saveCharacterCard(pkgId, name, card);
      alert("修复了 " + total + " 处 AI 腔表达");
      DISTILL_UI.openCharacter(pkgId, name);
    }else{
      alert("没有发现 AI 腔，无需修复");
    }
  },
  runAudit: async function(id){
    var cards = DISTILL_PACKAGE.listCharacterCards(id);
    if(!cards.length){ alert("没有角色卡"); return; }
    if(!confirm("审计 " + cards.length + " 个角色? (每人1次LLM调用)")) return;
    var v = document.getElementById("view");
    v.innerHTML = `<h2 class="sec">🔍 审计中...</h2><div id="auditProg" style="font-size:calc(14px * var(--fs))"></div>`;
    var results = await DISTILL_AUDITOR.auditAll(id, cards.map(function(c){ return c.name; }), {
      onProgress: function(i, n, msg){
        var el = document.getElementById("auditProg");
        if(el) el.textContent = i + "/" + n + " " + msg;
      }
    });
    var html = `<h2 class="sec">🔍 审计结果</h2>`;
    Object.keys(results).forEach(function(name){
      var r = results[name];
      var badge = r.pass ? "✅" : "⚠️";
      html += `<div class="card" style="margin-bottom:8px"><div style="font-weight:600">${badge} ${esc(name)}</div>`;
      (r.issues || []).forEach(function(iss){
        html += `<div style="font-size:calc(13px * var(--fs));color:var(--ink-faint);margin-top:4px">• [${iss.severity}] ${esc(iss.desc)}</div>`;
      });
      if(!(r.issues || []).length) html += `<div style="font-size:calc(13px * var(--fs));color:var(--ink-faint)">无问题</div>`;
      html += `</div>`;
    });
    html += `<button class="btn" data-dact="openPackage" data-did="${id}">返回</button>`;
    v.innerHTML = html;
  }, exportPkg: exportPkg, regenOpenings: regenOpenings};

/* 点击事件委托（XSS 修复 2026-10-13）：替代全部内联 onclick 字符串模板。
 * 动态值走 data-* 属性（escA 做 HTML 属性转义，含双引号）；dataset 读出即原文，
 * 不再经过 JS 字符串解析层，故反斜杠 / 引号 / 换行均无害。静态 onclick 保留。 */
function onDelegatedClick(e){
  var el = null;
  try{ el = (e.target && e.target.closest) ? e.target.closest("[data-dact]") : null; }
  catch(err){ el = null; }
  if(!el) return;
  var d = el.dataset || {}, act = d.dact, idx = parseInt(d.didx, 10);
  try{
    switch(act){
      case "openPackage": api.openPackage(d.did); break;
      case "openCharacter": api.openCharacter(d.did, d.dname, d.dstage); break;
      case "showProvenance": api.showProvenance(d.did, d.dname); break;
      case "showWorldbook": api.showWorldbook(d.did); break;
      case "runAudit": api.runAudit(d.did); break;
      case "runProbes": api.runProbes(d.did); break;
      case "exportPkg": api.exportPkg(d.did); break;
      case "qaAnswer": api.qaAnswer(d.dqid, d.dv); break;
      case "requestChange": api.requestChange(d.did, d.dname); break;
      case "polishCard": api.polishCard(d.did, d.dname); break;
      case "playground":
        if(typeof DISTILL_PLAYGROUND !== "undefined") DISTILL_PLAYGROUND.open(d.did, d.dname);
        break;
      case "dynamicGreeting": api.dynamicGreeting(d.did, d.dname); break;
      case "chat":
        if(typeof chatWith === "function") chatWith("distill_" + d.did, d.dname);
        break;
      case "autoExtractFacts": api.autoExtractFacts(d.did, d.dname); break;
      case "editFact": api.editFact(d.did, d.dname, idx); break;
      case "deleteFact": api.deleteFact(d.did, d.dname, idx); break;
      case "saveFact": api.saveFact(d.did, d.dname, idx); break;
      case "addFact": api.addFact(d.did, d.dname); break;
      case "recompileCard": api.recompileCard(d.did, d.dname); break;
      case "showStyles": api.showStyles(); break;
      case "showStyleDetail": api.showStyleDetail(d.did); break;
      case "useStyle": api.useStyle(d.did); break;
      case "deleteStyle":
        if(confirm("删除？")){ DISTILL_STYLE.deleteCard(d.did); api.showStyles(); }
        break;
    }
  }catch(err){ try{ console.warn("[distill_ui] dact failed:", act, err); }catch(e2){} }
}
if(typeof document !== "undefined" && document && typeof document.addEventListener === "function"){
  document.addEventListener("click", onDelegatedClick);
  document.addEventListener("click", onPauseClick);
  document.addEventListener("change", onImportChange);
}

return api;
})();
