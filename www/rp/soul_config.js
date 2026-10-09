/* Soul 配置 UI - Profile 管理 + 角色绑定 + 优先级解析
 *
 * Profile: {name, base, key, model} 存 localStorage.nd_api_profiles
 * 绑定优先级: soul 绑定 > 聊天覆盖 > 全局默认
 */

var RP_SOUL_CFG = (function(){
"use strict";

var PROFILES_KEY = "nd_api_profiles";
var CHAT_OVERRIDE_PREFIX = "nd_soul_profile_"; /* + chatId */

/* ============ Profile CRUD ============ */

function list(){
  try{ return JSON.parse(localStorage.getItem(PROFILES_KEY) || "[]"); }
  catch(e){ return []; }
}

function save(arr){
  try{ localStorage.setItem(PROFILES_KEY, JSON.stringify(arr || [])); }
  catch(e){}
}

function add(p){
  var arr = list();
  p = p || {};
  var name = String(p.name || "").trim();
  if(!name) return {ok: false, reason: "empty_name"};
  for(var i = 0; i < arr.length; i++){
    if(arr[i].name === name) return {ok: false, reason: "dup_name"};
  }
  arr.push({
    name: name,
    base: String(p.base || "").trim(),
    key: String(p.key || ""),
    model: String(p.model || "").trim()
  });
  save(arr);
  return {ok: true};
}

function del(name){
  var arr = list().filter(function(p){ return p.name !== name; });
  save(arr);
}

function get(name){
  var arr = list();
  for(var i = 0; i < arr.length; i++) if(arr[i].name === name) return arr[i];
  return null;
}

/* ============ 绑定优先级解析 ============ */

/* 解析某 soul 在某聊天中实际用的 profile 名
 * 返回 {profile (name 或 ""), level: "soul"|"chat"|"default"|"none"} */
function resolveForSoul(card, chatId){
  /* 1. soul 绑定 */
  try{
    var sp = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getProfile(card) : "";
    if(sp && get(sp)) return {profile: sp, level: "soul"};
  }catch(e){}

  /* 2. 聊天覆盖 */
  try{
    if(chatId){
      var cp = localStorage.getItem(CHAT_OVERRIDE_PREFIX + chatId);
      if(cp && get(cp)) return {profile: cp, level: "chat"};
    }
  }catch(e){}

  /* 3. 全局默认 (第一个 profile, 或 "" 表示用主配置) */
  var arr = list();
  if(arr.length) return {profile: arr[0].name, level: "default"};
  return {profile: "", level: "none"};
}

/* 聊天覆盖设置/清除 */
function setChatOverride(chatId, profileName){
  try{
    if(!profileName) localStorage.removeItem(CHAT_OVERRIDE_PREFIX + chatId);
    else localStorage.setItem(CHAT_OVERRIDE_PREFIX + chatId, profileName);
  }catch(e){}
}

function getChatOverride(chatId){
  try{ return localStorage.getItem(CHAT_OVERRIDE_PREFIX + chatId) || ""; }
  catch(e){ return ""; }
}

/* ============ Settings 页 UI ============ */

/* 渲染 Profile 管理卡片 HTML (插到设置页"连接"区) */
function profilesCardHTML(){
  var arr = list();
  var rows = arr.map(function(p){
    return "<div class=\"kv\" style=\"display:flex;justify-content:space-between;align-items:center\">" +
      "<span><b>" + escHtml(p.name) + "</b> <span class=\"dim\">" +
      escHtml(p.model || "(未设模型)") + "</span></span>" +
      "<span><button class=\"btn ghost\" onclick=\"RP_SOUL_CFG.testProfile('" +
      escHtml(p.name).replace(/'/g, "\\'") + "')\">测试</button> " +
      "<button class=\"btn ghost\" onclick=\"RP_SOUL_CFG.delProfile('" +
      escHtml(p.name).replace(/'/g, "\\'") + "')\">删除</button></span></div>";
  }).join("");
  return "<div class=\"setcard\"><h3>🔌 多模型配置 <span class=\"dim\">Soul 多智能体用</span></h3>" +
    "<div class=\"kv\">每个配置 = 一套 API 地址/Key/模型。角色可单独绑定不同模型，避免同质化。不配则全部走上面的主配置。</div>" +
    "<div id=\"soul_profiles_list\">" + (rows || "<div class=\"dim\">暂无额外配置</div>") + "</div>" +
    "<div class=\"field\" style=\"margin-top:8px\"><label>名称</label>" +
    "<input id=\"sp_name\" placeholder=\"如 Qwen\"></div>" +
    "<div class=\"field\"><label>API 地址 (空=用主配置)</label>" +
    "<input id=\"sp_base\" placeholder=\"https://...\"></div>" +
    "<div class=\"field\"><label>API Key (空=用主配置)</label>" +
    "<input id=\"sp_key\" type=\"password\" placeholder=\"sk-...\"></div>" +
    "<div class=\"field\"><label>模型</label>" +
    "<input id=\"sp_model\" placeholder=\"如 qwen-max\"></div>" +
    "<div class=\"btnrow\"><button class=\"btn\" onclick=\"RP_SOUL_CFG.addProfileUI()\">＋ 添加</button></div>" +
    "</div>";
}

function escHtml(s){
  return String(s == null ? "" : s).replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* 供 index.html 内联 onclick 调用 */
function addProfileUI(){
  var name = document.getElementById("sp_name").value;
  var r = add({
    name: name,
    base: document.getElementById("sp_base").value,
    key: document.getElementById("sp_key").value,
    model: document.getElementById("sp_model").value
  });
  if(!r.ok){ alert(r.reason === "dup_name" ? "名称已存在" : "名称不能为空"); return; }
  refreshProfilesList();
  document.getElementById("sp_name").value = "";
  document.getElementById("sp_base").value = "";
  document.getElementById("sp_key").value = "";
  document.getElementById("sp_model").value = "";
}

function delProfile(name){
  if(!confirm("删除配置「" + name + "」?")) return;
  del(name);
  refreshProfilesList();
}

async function testProfile(name){
  var p = get(name);
  if(!p){ alert("找不到"); return; }
  /* 用主配置补空字段 */
  var main = {};
  try{ main = JSON.parse(localStorage.getItem("nd_api_cfg_v1") || "{}"); }catch(e){}
  var cfg = {
    base: p.base || main.base, key: p.key || main.key, model: p.model || main.model
  };
  if(!cfg.base || !cfg.key){ alert("地址或 Key 为空 (主配置也没填)"); return; }
  try{
    var r = await fetch(cfg.base.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + cfg.key},
      body: JSON.stringify({model: cfg.model, messages: [{role: "user", content: "hi"}],
        max_tokens: 5})
    });
    alert(r.ok ? "连接正常 (" + cfg.model + ")" : "失败: HTTP " + r.status);
  }catch(e){
    alert("失败: " + (e.message || e));
  }
}

function refreshProfilesList(){
  var el = document.getElementById("soul_profiles_list");
  if(!el) return;
  var arr = list();
  el.innerHTML = arr.map(function(p){
    return "<div class=\"kv\" style=\"display:flex;justify-content:space-between;align-items:center\">" +
      "<span><b>" + escHtml(p.name) + "</b> <span class=\"dim\">" +
      escHtml(p.model || "(未设模型)") + "</span></span>" +
      "<span><button class=\"btn ghost\" onclick=\"RP_SOUL_CFG.testProfile('" +
      escHtml(p.name).replace(/'/g, "\\'") + "')\">测试</button> " +
      "<button class=\"btn ghost\" onclick=\"RP_SOUL_CFG.delProfile('" +
      escHtml(p.name).replace(/'/g, "\\'") + "')\">删除</button></span></div>";
  }).join("") || "<div class=\"dim\">暂无额外配置</div>";
}

/* ============ 角色卡绑定 UI ============ */

/* 角色卡编辑器用的下拉 HTML */
function bindSelectHTML(card){
  var cur = "";
  try{ cur = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getProfile(card) : ""; }catch(e){}
  var opts = "<option value=\"\">默认 (跟全局)</option>" + list().map(function(p){
    return "<option value=\"" + escHtml(p.name) + "\"" +
      (p.name === cur ? " selected" : "") + ">" +
      escHtml(p.name) + " · " + escHtml(p.model || "") + "</option>";
  }).join("");
  return "<div class=\"field\"><label>绑定模型 <span class=\"dim\">Soul 多智能体时此角色用的模型</span></label>" +
    "<select id=\"ce_soul_profile\">" + opts + "</select></div>";
}

/* 从编辑器读取绑定值 */
function readBindSelect(){
  var el = document.getElementById("ce_soul_profile");
  return el ? el.value : "";
}

/* ============ 调用追踪调试视图 ============ */

function debugHTML(){
  var hist = [];
  try{
    if(typeof RP_SOUL_RT !== "undefined") hist = RP_SOUL_RT.getCallHistory();
  }catch(e){}
  var rows = hist.map(function(h){
    return "<div class=\"kv\" style=\"font-size:12px\">" +
      "<span>" + (h.ok ? "OK" : "FAIL") + " <b>" + escHtml(h.soul) + "</b></span>" +
      "<span class=\"dim\">" + escHtml(h.model || "") +
      (h.fallback && h.fallback !== "profile" ? " (降级:" + escHtml(h.fallback) + ")" : "") +
      " · " + (h.ms || 0) + "ms" +
      (h.tokens ? " · " + h.tokens + "tok" : "") +
      (h.error ? " · " + escHtml(String(h.error).slice(0, 60)) : "") +
      "</span></div>";
  }).join("");
  return "<div class=\"setcard\"><h3>Soul 调用追踪 <span class=\"dim\">最近 " + hist.length + " 次</span></h3>" +
    (rows || "<div class=\"dim\">暂无调用记录</div>") +
    (hist.length ? "<div class=\"btnrow\" style=\"margin-top:8px\"><button class=\"btn ghost\" onclick=\"RP_SOUL_CFG.clearDebug()\">清空</button></div>" : "") +
    "</div>";
}

function clearDebug(){
  try{ if(typeof RP_SOUL_RT !== "undefined") RP_SOUL_RT.clearCallHistory(); }catch(e){}
  refreshDebug();
}

function refreshDebug(){
  var el = document.getElementById("soul_debug_wrap");
  if(el) el.innerHTML = debugHTML();
}

/* ============ Soul 预览页 ============ */

function soulViewHTML(card, runId, name){
  var soul = null;
  try{
    if(typeof RP_SOUL !== "undefined") soul = RP_SOUL.getSoul(card);
  }catch(e){}
  if(!soul){
    return "<div class=\"card\"><div class=\"name\">还没有灵魂包</div>" +
      "<div class=\"meta\">Soul 包是角色的独立心智: 人设内核、记忆、行动日志。</div>" +
      "<div class=\"btnrow\" style=\"margin-top:8px\">" +
      "<button class=\"btn\" onclick=\"RP_SOUL_CFG.genSoulUI('" +
      escHtml(runId).replace(/'/g, "\\'") + "','" +
      escHtml(name).replace(/'/g, "\\'") + "')\">一键生成 Soul 包</button></div></div>";
  }
  var pp = soul.persona || {}, bg = soul.background || {};
  var mem = (soul.memory || {}).long_term || {};
  var traj = soul.trajectory || [];
  var traits = (pp.core_traits || []).map(function(tt){
    var tn = typeof tt === "string" ? tt : (tt.trait || "");
    var ti = (typeof tt === "object" && tt.intensity) ? " (" + tt.intensity + ")" : "";
    return "<span class=\"tagchip\">" + escHtml(tn + ti) + "</span>";
  }).join(" ");
  var facts = (mem.facts || []).slice(-5).map(function(f){
    return "<div class=\"kv\">· " + escHtml(typeof f === "string" ? f : (f.text || "")) + "</div>";
  }).join("");
  var emos = (mem.emotional || []).slice(-3).map(function(e){
    return "<div class=\"kv\">" + escHtml(e.emotion || "") + ": " +
      escHtml((e.text || "").slice(0, 60)) + "</div>";
  }).join("");
  var trajs = traj.slice(-5).reverse().map(function(x){
    return "<div class=\"kv\" style=\"font-size:12px\"><span class=\"dim\">" +
      escHtml((x.t || "").slice(11, 16)) + "</span> " +
      escHtml(x.actor || "") + " " + escHtml((x.action || "").slice(0, 40)) + "</div>";
  }).join("");
  var profile = "";
  try{ profile = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getProfile(card) : ""; }catch(e){}
  return "<div class=\"card\"><div class=\"name\" style=\"font-size:14px\">宪章</div>" +
    "<div style=\"font-size:13px\">" + escHtml((soul.soul_md || "未填写").slice(0, 300)) + "</div></div>" +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:14px\">性格特质</div>" +
    "<div>" + (traits || "<span class=\"dim\">无</span>") + "</div></div>" +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:14px\">动机</div>" +
    "<div class=\"kv\">" + escHtml((pp.motivations || []).join("、") || "无") + "</div></div>" +
    (bg.secrets ? "<div class=\"card\"><div class=\"name\" style=\"font-size:14px\">秘密</div>" +
    "<div style=\"font-size:13px\">" + escHtml(bg.secrets.slice(0, 200)) + "</div></div>" : "") +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:14px\">记忆 (" +
    ((mem.facts || []).length) + " 条)</div>" +
    (facts || "<div class=\"dim\">暂无</div>") + (emos || "") +
    "<div class=\"btnrow\" style=\"margin-top:8px\">" +
    "<button class=\"btn ghost\" style=\"font-size:12px\" onclick=\"RP_SOUL_CFG.editMemoryUI('" +
    escHtml(runId).replace(/'/g, "\\'") + "','" +
    escHtml(name).replace(/'/g, "\\'") + "')\">编辑记忆</button></div></div>" +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:14px\">行动日志 (" + traj.length + " 条)</div>" +
    (trajs || "<div class=\"dim\">暂无</div>") + "</div>" +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:14px\">绑定模型</div>" +
    "<div class=\"kv\">" + escHtml(profile || "默认") + "</div></div>";
}

async function genSoulUI(runId, name){
  if(!confirm("为「" + name + "」生成 Soul 包?")) return;
  var card = null;
  try{ if(typeof RP !== "undefined" && RP.findCard) card = RP.findCard(runId, name); }catch(e){}
  if(!card){ alert("找不到卡片"); return; }
  var cfg = {};
  try{ cfg = JSON.parse(localStorage.getItem("nd_api_cfg_v1") || "{}"); }catch(e){}
  if(!cfg.key){ alert("先去设置配好 API"); return; }
  alert("生成中，请稍候...");
  try{
    var r = await RP_SOUL_GEN.generate(card, cfg, function(c, ms, t){ return RP_NET.complete(c, ms, t); });
    if(r.ok){
      try{ if(typeof RP_CARDIMPORT !== "undefined" && card.id) RP_CARDIMPORT.update(card); }catch(e){}
      alert("Soul 包已生成");
      if(typeof renderDetail === "function") renderDetail();
    }else{ alert("生成失败: " + (r.reason || "")); }
  }catch(e){ alert("生成失败: " + (e.message || e)); }
}

/* 冲突仲裁 UI: 返回冲突徽章 HTML, 点击后弹窗选择 */
function conflictBadgeHTML(conflicts, msgIdx){
  if(!conflicts || !conflicts.length) return "";
  return "<div style=\"margin-top:6px\"><button class=\"btn ghost\" style=\"font-size:11px;color:var(--danger)\" " +
    "onclick=\"RP_SOUL_CFG.arbitrateUI(" + msgIdx + ")\">⚠️ 动作冲突 (" + conflicts.length + ") 点击裁决</button></div>";
}

/* 附体: 从群聊切换到与指定 soul 的单聊 (保留群聊上下文) */
function possessSoul(runId, soulName){
  if(!confirm("附体「" + soulName + "」? 将切换到与 TA 的单聊。")) return;
  try{
    if(typeof showChat === "function"){
      /* 保存群聊位置以便返回 */
      try{ localStorage.setItem("nd_possess_return", JSON.stringify({runId: runId})); }catch(e){}
      showChat(runId, soulName);
    }
  }catch(e){ alert("切换失败: " + (e.message || e)); }
}

function arbitrateUI(msgIdx){
  var h = [];
  try{
    if(typeof getHist === "function" && typeof CHAT !== "undefined"){
      h = getHist("nd_chat_" + CHAT.runId + "_" + CHAT.name);
    }
  }catch(e){}
  var m = h[msgIdx];
  if(!m || !m._conflicts || !m._conflicts.length){ alert("没有冲突数据"); return; }
  var opts = m._conflicts.map(function(c, i){
    return (i+1) + ". " + c.a + "「" + (c.actionA||"") + "」 vs " + c.b + "「" + (c.actionB||"") + "」";
  }).join("\n");
  var pick = prompt("动作冲突，请裁决 (输入编号，选胜者):\n\n" + opts + "\n\n输入 0 表示都不采用");
  if(pick == null) return;
  var idx = parseInt(pick) - 1;
  if(isNaN(idx) || idx < -1 || idx >= m._conflicts.length){ alert("无效选择"); return; }
  m._conflictResolved = true;
  m._conflictWinner = idx >= 0 ? m._conflicts[idx] : null;
  try{
    if(typeof saveHist === "function" && typeof CHAT !== "undefined"){
      saveHist("nd_chat_" + CHAT.runId + "_" + CHAT.name, h);
    }
  }catch(e){}
  alert(idx >= 0 ? "已裁决: " + m._conflicts[idx].a + " 获胜" : "已裁决: 双方动作都不采用");
  if(typeof renderChat === "function") renderChat();
}

function editMemoryUI(runId, name){
  var card = null;
  try{ if(typeof RP !== "undefined" && RP.findCard) card = RP.findCard(runId, name); }catch(e){}
  if(!card){ alert("找不到卡片"); return; }
  var soul = null;
  try{ soul = RP_SOUL.getSoul(card); }catch(e){}
  if(!soul){ alert("还没有 Soul 包"); return; }
  var mem = soul.memory.long_term || {};
  var facts = (mem.facts || []).map(function(f, i){
    return i + ": " + (typeof f === "string" ? f : (f.text || ""));
  }).join("\n");
  var input = prompt("编辑共享记忆 (每行一条):\n\n" + facts);
  if(input == null) return;
  var lines = input.split("\n").map(function(l){ return l.trim(); }).filter(Boolean);
  soul.memory.long_term.facts = lines.map(function(l){ return {t: new Date().toISOString(), text: l}; });
  try{ if(typeof RP_CARDIMPORT !== "undefined" && card.id) RP_CARDIMPORT.update(card); }catch(e){}
  alert("已保存 " + lines.length + " 条");
  if(typeof renderDetail === "function") renderDetail();
}

return {
  list: list, save: save, add: add, del: del, get: get,
  resolveForSoul: resolveForSoul,
  setChatOverride: setChatOverride, getChatOverride: getChatOverride,
  profilesCardHTML: profilesCardHTML,
  addProfileUI: addProfileUI, delProfile: delProfile,
  testProfile: testProfile, refreshProfilesList: refreshProfilesList,
  bindSelectHTML: bindSelectHTML, readBindSelect: readBindSelect,
  debugHTML: debugHTML, clearDebug: clearDebug, refreshDebug: refreshDebug,
  soulViewHTML: soulViewHTML, genSoulUI: genSoulUI, editMemoryUI: editMemoryUI,
  conflictBadgeHTML: conflictBadgeHTML, arbitrateUI: arbitrateUI,
  possessSoul: possessSoul
};

})();
if(typeof window !== "undefined") window.RP_SOUL_CFG = RP_SOUL_CFG;
if(typeof module !== "undefined") module.exports = RP_SOUL_CFG;
