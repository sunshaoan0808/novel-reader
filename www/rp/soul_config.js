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

return {
  list: list, save: save, add: add, del: del, get: get,
  resolveForSoul: resolveForSoul,
  setChatOverride: setChatOverride, getChatOverride: getChatOverride,
  profilesCardHTML: profilesCardHTML,
  addProfileUI: addProfileUI, delProfile: delProfile,
  testProfile: testProfile, refreshProfilesList: refreshProfilesList,
  bindSelectHTML: bindSelectHTML, readBindSelect: readBindSelect,
  debugHTML: debugHTML, clearDebug: clearDebug, refreshDebug: refreshDebug
};

})();
if(typeof window !== "undefined") window.RP_SOUL_CFG = RP_SOUL_CFG;
if(typeof module !== "undefined") module.exports = RP_SOUL_CFG;
