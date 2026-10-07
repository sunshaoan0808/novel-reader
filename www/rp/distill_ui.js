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

function esc(s){
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function show(){
  S.step = 0;
  render();
}

function stepDots(){
  var labels = ["上传", "发现角色", "配置", "蒸馏", "剧本包"];
  return `<div style="display:flex;gap:4px;margin-bottom:16px">` +
    labels.map(function(l, i){
      var c = i === S.step ? "var(--gold)" : i < S.step ? "var(--ink)" : "var(--line)";
      return `<div style="flex:1;text-align:center;font-size:11px;color:${c}">
        <div style="height:4px;background:${c};border-radius:2px;margin-bottom:4px"></div>${l}</div>`;
    }).join("") + `</div>`;
}

function render(){
  var v = document.getElementById("view");
  var html = `<h2 class="sec">手机蒸馏</h2>` + stepDots();
  if(S.step === 0) html += renderUpload();
  else if(S.step === 1) html += renderDiscover();
  else if(S.step === 2) html += renderConfig();
  else if(S.step === 3) html += renderDistill();
  else if(S.step === 4) html += renderPackages();
  v.innerHTML = html;
  wire();
}

function renderUpload(){
  var pkgs = DISTILL_PACKAGE.listPackages();
  return `<div class="card">
    <div style="font-size:13px;color:var(--ink-dim);margin-bottom:12px">
      上传小说，自动发现角色，蒸馏成剧本包。LLM 走在线 API。
    </div>
    <div class="field">
      <label>小说文件 (.txt)</label>
      <input type="file" id="d_file" accept=".txt" style="width:100%">
      <div id="d_fileinfo" style="font-size:12px;color:var(--ink-faint);margin-top:4px"></div>
    </div>
    <div class="btnrow">
      <button class="btn primary" id="d_next0" disabled>下一步 →</button>
    </div>
  </div>
  ${pkgs.length ? `<h2 class="sec">已有剧本包 (${pkgs.length})</h2>` +
    pkgs.map(function(p){
      return `<div class="card" style="padding:12px" onclick="DISTILL_UI.openPackage('${p.id}')">
        <div style="font-weight:600">${esc(p.novel)}</div>
        <div style="font-size:12px;color:var(--ink-faint)">${p.charCount} 个角色 · ${new Date(p.created).toLocaleDateString()}</div>
      </div>`;
    }).join("") : ""}`;
}

function renderDiscover(){
  if(!S.discovered.length){
    return `<div class="card"><div id="d_disc_msg">正在发现角色...</div>
      <div id="d_disc_bar" style="height:8px;background:var(--line);border-radius:4px;margin-top:8px">
      <i style="display:block;height:100%;width:0;background:var(--gold);border-radius:4px"></i></div></div>`;
  }
  return `<div class="card">
    <div style="font-size:13px;margin-bottom:12px">发现 <b>${S.discovered.length}</b> 个角色，勾选要蒸馏的：</div>
    <div style="max-height:400px;overflow-y:auto">
    ${S.discovered.map(function(c, i){
      var checked = S.selected[c.name] !== false ? "checked" : "";
      return `<label style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">
        <input type="checkbox" data-char="${esc(c.name)}" ${checked} style="margin-right:10px">
        <div style="flex:1">
          <div style="font-weight:600">${esc(c.name)}
            <span style="font-size:11px;color:var(--gold)">★${c.importance}</span></div>
          <div style="font-size:11px;color:var(--ink-faint)">
            出现 ${c.count} 次${c.aliases.length ? " · 别名: " + c.aliases.map(esc).join("、") : ""}</div>
        </div>
      </label>`;
    }).join("")}
    </div>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" id="d_back1">← 上一步</button>
      <button class="btn primary" id="d_next1">下一步 →</button>
    </div>
  </div>`;
}

function renderConfig(){
  var llmCfg = DISTILL_LLM.cfg();
  var selCount = Object.keys(S.selected).filter(function(k){ return S.selected[k]; }).length;
  return `<div class="card">
    <div style="font-size:13px;margin-bottom:12px">已选 <b>${selCount}</b> 个角色</div>
    <div class="field">
      <label>LLM API Key</label>
      <input type="password" id="d_key" value="${esc(llmCfg.key || "")}" placeholder="OpenAI 兼容接口 Key" style="width:100%">
    </div>
    <div class="field">
      <label>蒸馏深度</label>
      <select id="d_depth" style="width:100%;padding:8px">
        <option value="quick">快速 (画像+关系)</option>
        <option value="full" selected>完整 (画像+关系+剧情+世界书)</option>
      </select>
    </div>
    <div class="btnrow">
      <button class="btn" id="d_back2">← 上一步</button>
      <button class="btn" id="d_savekey">保存 Key</button>
      <button class="btn primary" id="d_start">开始蒸馏</button>
    </div>
  </div>`;
}

function renderDistill(){
  return `<div class="card">
    <div id="d_stages"></div>
    <div id="d_bar" style="height:8px;background:var(--line);border-radius:4px;margin-top:12px">
      <i style="display:block;height:100%;width:0;background:var(--gold);border-radius:4px"></i></div>
    <div id="d_msg" style="font-size:12px;margin-top:8px">准备...</div>
  </div><div id="d_results"></div>`;
}

function renderPackages(){
  var pkgs = DISTILL_PACKAGE.listPackages();
  if(!pkgs.length) return `<div class="empty">还没有剧本包</div>`;
  return `<h2 class="sec">剧本包 (${pkgs.length})</h2>` + pkgs.map(function(p){
    return `<div class="card" style="padding:12px" onclick="DISTILL_UI.openPackage('${p.id}')">
      <div style="font-weight:600">${esc(p.novel)}</div>
      <div style="font-size:12px;color:var(--ink-faint)">${p.charCount} 个角色</div>
    </div>`;
  }).join("");
}

function wire(){
  var f = document.getElementById("d_file");
  if(f) f.addEventListener("change", onFile);

  var n0 = document.getElementById("d_next0");
  if(n0) n0.addEventListener("click", function(){ S.step = 1; render(); runDiscover(); });

  var b1 = document.getElementById("d_back1");
  if(b1) b1.addEventListener("click", function(){ S.step = 0; render(); });
  var n1 = document.getElementById("d_next1");
  if(n1) n1.addEventListener("click", function(){
    // 收集选中
    document.querySelectorAll("[data-char]").forEach(function(cb){
      S.selected[cb.getAttribute("data-char")] = cb.checked;
    });
    S.step = 2; render();
  });

  var b2 = document.getElementById("d_back2");
  if(b2) b2.addEventListener("click", function(){ S.step = 1; render(); });
  var sk = document.getElementById("d_savekey");
  if(sk) sk.addEventListener("click", function(){
    var c = DISTILL_LLM.cfg();
    c.key = document.getElementById("d_key").value.trim();
    DISTILL_LLM.saveCfg(c);
    alert("已保存");
  });
  var st = document.getElementById("d_start");
  if(st) st.addEventListener("click", onStartDistill);
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
        var be = barEl(); if(be && be.firstChild) be.firstChild.style.width = (d / t * 100) + "%";
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
  var key = document.getElementById("d_key").value.trim();
  if(!key){ alert("请填写 API Key"); return; }
  var c = DISTILL_LLM.cfg(); c.key = key; DISTILL_LLM.saveCfg(c);
  var depth = document.getElementById("d_depth").value;
  var chars = Object.keys(S.selected).filter(function(k){ return S.selected[k]; });
  if(!chars.length){ alert("请至少选一个角色"); return; }

  S.step = 3; render();
  S.running = true;

  var stages = [
    {id: "alias", label: "别名消解"},
    {id: "profile", label: "人物画像"},
    {id: "relations", label: "关系抽取"}
  ];
  if(depth === "full") stages.push({id: "plot", label: "剧情+世界书"});

  var stEl = document.getElementById("d_stages");
  stEl.innerHTML = stages.map(function(s){
    return `<div id="d_stage_${s.id}" style="font-size:13px;padding:4px 0;color:var(--ink-faint)">○ ${s.label}</div>`;
  }).join("");

  function setStage(id, st){
    var el = document.getElementById("d_stage_" + id);
    if(!el) return;
    el.innerHTML = (st === "run" ? "◉ " : st === "done" ? "● " : "○ ") + el.textContent.slice(2);
    el.style.color = st === "run" ? "var(--gold)" : st === "done" ? "var(--ink)" : "var(--ink-faint)";
  }
  function prog(msg, pct){
    var m = document.getElementById("d_msg"); if(m) m.textContent = msg;
    var b = document.getElementById("d_bar"); if(b && b.firstChild) b.firstChild.style.width = (pct || 0) + "%";
  }

  var ckptKey = "nd_distill_ckpt_" + S.pkg.id;
  var checkpoint = {};
  try{ checkpoint = JSON.parse(localStorage.getItem(ckptKey) || "{}"); }catch(e){}

  try{
    // 别名
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
    setStage("profile", "run");
    var profiles = await DISTILL_CORE.distillNovel(S.chunks, chars, {
      checkpoint: checkpoint,
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
    setStage("relations", "run");
    var edges = DISTILL_RELATIONS.extractPairs(S.chunks, chars, aliasMap, {});
    await DISTILL_RELATIONS.enrichEdges(edges, function(d, t, m){ prog("[关系] " + m, 50 + d / t * 15); });
    DISTILL_PACKAGE.saveData(S.pkg.id, "relations", edges);
    setStage("relations", "done");

    // 剧情 (完整模式)
    if(depth === "full"){
      setStage("plot", "run");
      var summaries = await DISTILL_PLOT.summarizeChunks(S.chunks, chars, aliasMap, {
        checkpoint: checkpoint,
        onProgress: function(d, t, m){ prog("[剧情] " + m, 65 + d / t * 20); },
        onCheckpoint: function(cp){ try{ localStorage.setItem(ckptKey, JSON.stringify(cp)); }catch(e){} }
      });
      var sections = await DISTILL_PLOT.buildOutline(summaries, {});
      var conflicts = await DISTILL_PLOT.extractConflicts(sections, {});
      var arcs = await DISTILL_PLOT.extractArcs(chars, summaries, {});
      var pairs = DISTILL_PLOT.pairForeshadowing(summaries, {});
      DISTILL_PACKAGE.saveData(S.pkg.id, "plot", {sections: sections, conflicts: conflicts, arcs: arcs, pairs: pairs});
      setStage("plot", "done");
    }

    S.running = false;
    try{ localStorage.removeItem(ckptKey); }catch(e){}
    prog("完成! 剧本包已生成", 100);
    setTimeout(function(){ S.step = 4; render(); }, 1500);
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
  v.innerHTML = `<h2 class="sec">${esc(pkg.novel)}</h2>
    <div style="font-size:12px;color:var(--ink-faint);margin-bottom:12px">剧本包 · ${cards.length} 个角色</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    ${cards.map(function(c){
      return `<div class="card" style="padding:12px" onclick="DISTILL_UI.openCharacter('${id}','${esc(c.name)}')">
        <div style="font-weight:600">${esc(c.name)}</div>
        <div style="font-size:11px;color:var(--ink-faint)">★${c.importance} ${c.hasCard ? "· 已蒸馏" : ""}</div>
      </div>`;
    }).join("")}
    </div>
    <div class="btnrow" style="margin-top:16px">
      <button class="btn" onclick="DISTILL_UI.show()">← 返回</button>
    </div>`;
}

function openCharacter(pkgId, name){
  var card = DISTILL_PACKAGE.getCharacterCard(pkgId, name);
  var v = document.getElementById("view");
  if(!card){
    v.innerHTML = `<div class="empty">角色卡未生成</div><button class="btn" onclick="DISTILL_UI.show()">返回</button>`;
    return;
  }
  var d = card._distill || {};
  v.innerHTML = `<h2 class="sec">${esc(name)}</h2>
    <div class="card">
      ${d.core_identity ? `<div class="kvline"><b>身份</b>：${esc(d.core_identity)}</div>` : ""}
      ${d.core_traits ? `<div class="kvline"><b>性格</b>：${esc(d.core_traits)}</div>` : ""}
      ${d.speech_style ? `<div class="kvline"><b>说话</b>：${esc(d.speech_style)}</div>` : ""}
      ${d.soul_goal ? `<div class="kvline"><b>追求</b>：${esc(d.soul_goal)}</div>` : ""}
      ${d.background ? `<div class="kvline"><b>背景</b>：${esc(d.background)}</div>` : ""}
      ${d.key_bonds ? `<div class="kvline"><b>关系</b>：${esc(d.key_bonds)}</div>` : ""}
    </div>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" onclick="DISTILL_UI.show()">← 返回</button>
      <button class="btn primary" onclick="chatWith('${esc(name)}')">开聊</button>
    </div>`;
}

return {show: show, openPackage: openPackage, openCharacter: openCharacter};
})();
