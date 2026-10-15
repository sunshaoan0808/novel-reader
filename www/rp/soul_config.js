/* Soul 配置 UI - Profile 管理 + 角色绑定 + 优先级解析
 *
 * Profile: {name, base, key, model} 存 localStorage.nd_api_profiles
 * 绑定优先级: soul 绑定 > 聊天覆盖 > 全局默认
 */

var RP_SOUL_CFG = (function(){
"use strict";

var PROFILES_KEY = "nd_api_profiles";
var CHAT_OVERRIDE_PREFIX = "nd_soul_profile_"; /* + chatId */

/* P2-43：App 内弹窗组件。uiMessage / uiConfirm / uiPrompt / rpToast 都定义在 app.js，
   而本文件先于 app.js 加载，所以在调用时才去 window 上取。
   组件缺失说明脚本顺序坏了 —— 直接抛，不静默退回原生 alert/confirm/prompt。
   say     轻提示，2.6s 自动消失（完成 / 失败 / 一句提醒）
   show    只读弹窗，正文可滚动（长 Prompt、对比表、报错详情）
   ask     二选一确认，返回 Promise<boolean|null>（取消/遮罩/Esc = null）
   askText 带输入框，返回 Promise<string|null>（取消 = null，空串是合法输入） */
function say(msg){ return window.rpToast(msg); }
function show(title, html){ return window.uiMessage(title, html); }
function ask(title, html, okLabel){ return window.uiConfirm(title, html, okLabel); }
function askText(title, html, value, opts){ return window.uiPrompt(title, html, value, opts); }

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
      "<span><button class=\"btn ghost\" data-sact=\"testProfile\" data-sname=\"" +
      escHtml(p.name) + "\">测试</button> " +
      "<button class=\"btn ghost\" data-sact=\"delProfile\" data-sname=\"" +
      escHtml(p.name) + "\">删除</button></span></div>";
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

/* P2-11: 收敛到 escutil.js 的 escH()；独立加载（测试 vm）无 escH 时回退同款实现 */
var escHtml = (typeof escH === "function") ? escH : function(s){
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  if(!r.ok){ say(r.reason === "dup_name" ? "这个名称已经有配置了" : "名称不能为空"); return; }
  refreshProfilesList();
  document.getElementById("sp_name").value = "";
  document.getElementById("sp_base").value = "";
  document.getElementById("sp_key").value = "";
  document.getElementById("sp_model").value = "";
}

async function delProfile(name){
  if(!await ask("删除多模型配置", "删除「" + escHtml(name) + "」？用它的角色会回退到降级链的下一级。", "删除")) return;
  del(name);
  refreshProfilesList();
  say("已删除「" + name + "」");
}

async function testProfile(name){
  var p = get(name);
  if(!p){ say("找不到这个配置"); return; }
  /* 用主配置补空字段 */
  var main = {};
  try{ main = JSON.parse(localStorage.getItem("nd_api_cfg_v1") || "{}"); }catch(e){}
  var cfg = {
    base: p.base || main.base, key: p.key || main.key, model: p.model || main.model
  };
  if(!cfg.base || !cfg.key){ say("地址或 Key 为空（主配置也没填）"); return; }
  say("正在测试 " + (p.name || "") + " …");
  try{
    var r = await fetch(cfg.base.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + cfg.key},
      body: JSON.stringify({model: cfg.model, messages: [{role: "user", content: "hi"}],
        max_tokens: 5})
    });
    show("连接测试 · " + escHtml(name),
      r.ok ? "连接正常（" + escHtml(cfg.model || "未设模型") + "）"
           : "失败：HTTP " + r.status + "<br><span class=\"dim\">检查地址、Key 与模型名是否匹配。</span>");
  }catch(e){
    show("连接测试 · " + escHtml(name),
      "失败：" + escHtml(String(e.message || e)) + "<br><span class=\"dim\">多半是地址不可达或没开网络权限。</span>");
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
      "<span><button class=\"btn ghost\" data-sact=\"testProfile\" data-sname=\"" +
      escHtml(p.name) + "\">测试</button> " +
      "<button class=\"btn ghost\" data-sact=\"delProfile\" data-sname=\"" +
      escHtml(p.name) + "\">删除</button></span></div>";
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
    return "<div class=\"kv\" style=\"font-size:calc(12px * var(--fs))\">" +
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

/* 降级链说明 (当前顺序: 绑定 > 聊天覆盖 > 第一个 > 主配置) */
function fallbackHTML(){
  return "<div class=\"setcard\"><h3>模型降级链</h3>" +
    "<div class=\"kv\" style=\"font-size:calc(12px * var(--fs))\"><span>1. 角色绑定</span><span class=\"dim\">角色卡单独绑定的模型</span></div>" +
    "<div class=\"kv\" style=\"font-size:calc(12px * var(--fs))\"><span>2. 聊天覆盖</span><span class=\"dim\">本聊临时指定的模型</span></div>" +
    "<div class=\"kv\" style=\"font-size:calc(12px * var(--fs))\"><span>3. 第一个 Profile</span><span class=\"dim\">多模型配置里的第一个</span></div>" +
    "<div class=\"kv\" style=\"font-size:calc(12px * var(--fs))\"><span>4. 主配置</span><span class=\"dim\">设置页的主 API</span></div>" +
    "<div class=\"meta\" style=\"margin-top:6px\">按顺序尝试，失败自动降级。调用追踪里会标注实际用了哪一级。</div>" +
    "</div>";
}

/* Prompt 预览 */
function promptPreviewHTML(){
  var prompts = {};
  try{
    if(typeof RP_SOUL_ORCH !== "undefined") prompts = RP_SOUL_ORCH.getLastPrompts();
  }catch(e){}
  var names = Object.keys(prompts);
  if(!names.length) return "<div class=\"setcard\"><h3>Prompt 预览</h3><div class=\"dim\">跑一轮群聊后这里会显示各 soul 的实际 prompt</div></div>";
  var rows = names.map(function(n){
    var p = prompts[n];
    return "<div class=\"kv\"><span><b>" + escHtml(n) + "</b> (" + p.length + "字)</span>" +
      "<span><button class=\"btn ghost\" style=\"font-size:calc(11px * var(--fs))\" data-sact=\"showPrompt\" data-sname=\"" +
      escHtml(n) + "\">查看</button> " +
      "<button class=\"btn ghost\" style=\"font-size:calc(11px * var(--fs))\" data-sact=\"replaySoulUI\" data-sname=\"" +
      escHtml(n) + "\">重跑</button></span></div>";
  }).join("");
  return "<div class=\"setcard\"><h3>Prompt 预览</h3>" + rows + "</div>";
}
function showPrompt(name){
  var prompts = {};
  try{ prompts = RP_SOUL_ORCH.getLastPrompts(); }catch(e){}
  var p = prompts[name] || "无";
  /* 原生 alert 会把换行压平还带系统滚动条；这里保格式 + 可滚动 */
  show("Prompt · " + escHtml(name), "<div class=\"cfpre\">" + escHtml(p.slice(0, 2000)) + "</div>");
}
function replaySoulUI(name){
  say("重跑功能需要群聊上下文，请在群聊里使用");
}

/* 成本统计面板 */
function costHTML(){
  var cost = {};
  try{
    if(typeof RP_SOUL_RT !== "undefined") cost = RP_SOUL_RT.getCostStats();
  }catch(e){}
  var rows = Object.keys(cost).map(function(m){
    var c = cost[m];
    return "<div class=\"kv\" style=\"font-size:calc(12px * var(--fs))\"><span>" + escHtml(m) + "</span>" +
      "<span class=\"dim\">" + c.calls + "次 · " + c.tokens + "tok · " + Math.round(c.ms/1000) + "s</span></div>";
  }).join("");
  return "<div class=\"setcard\"><h3>成本统计</h3>" +
    (rows || "<div class=\"dim\">暂无</div>") +
    (rows ? "<div class=\"btnrow\" style=\"margin-top:8px\"><button class=\"btn ghost\" onclick=\"RP_SOUL_CFG.clearCost()\">清空</button></div>" : "") +
    "</div>";
}
function clearCost(){
  try{ if(typeof RP_SOUL_RT !== "undefined") RP_SOUL_RT.clearCostStats(); }catch(e){}
  refreshPerf();
}

/* 性能设置 */
function perfHTML(){
  var conc = 3, timeout = 60;
  try{
    conc = parseInt(localStorage.getItem("nd_soul_concurrent") || "3");
    timeout = parseInt(localStorage.getItem("nd_soul_timeout") || "60000") / 1000;
  }catch(e){}
  return "<div class=\"setcard\"><h3>性能设置</h3>" +
    "<div class=\"kv\"><span>最大并行数</span><span>" +
    "<button class=\"btn ghost\" style=\"font-size:calc(12px * var(--fs))\" onclick=\"RP_SOUL_CFG.setPerf('concurrent',-1)\">-</button> " +
    conc + " <button class=\"btn ghost\" style=\"font-size:calc(12px * var(--fs))\" onclick=\"RP_SOUL_CFG.setPerf('concurrent',1)\">+</button></span></div>" +
    "<div class=\"kv\"><span>单 soul 超时 (秒)</span><span>" +
    "<button class=\"btn ghost\" style=\"font-size:calc(12px * var(--fs))\" onclick=\"RP_SOUL_CFG.setPerf('timeout',-10)\">-</button> " +
    timeout + " <button class=\"btn ghost\" style=\"font-size:calc(12px * var(--fs))\" onclick=\"RP_SOUL_CFG.setPerf('timeout',10)\">+</button></span></div>" +
    "</div>";
}
function setPerf(key, delta){
  try{
    if(key === "concurrent"){
      var v = Math.max(1, Math.min(8, (parseInt(localStorage.getItem("nd_soul_concurrent") || "3") || 3) + delta));
      localStorage.setItem("nd_soul_concurrent", String(v));
    }else{
      var t = Math.max(10, Math.min(180, (parseInt(localStorage.getItem("nd_soul_timeout") || "60000") || 60000)/1000 + delta));
      localStorage.setItem("nd_soul_timeout", String(t * 1000));
    }
  }catch(e){}
  refreshPerf();
}
function refreshPerf(){
  var el = document.getElementById("soul_perf_wrap");
  if(el) el.innerHTML = perfHTML() + costHTML();
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
      "<button class=\"btn\" data-sact=\"genSoulUI\" data-sid=\"" + escHtml(runId) +
      "\" data-sname=\"" + escHtml(name) + "\">一键生成 Soul 包</button></div></div>";
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
    return "<div class=\"kv\" style=\"font-size:calc(12px * var(--fs))\"><span class=\"dim\">" +
      escHtml((x.t || "").slice(11, 16)) + "</span> " +
      escHtml(x.actor || "") + " " + escHtml((x.action || "").slice(0, 40)) + "</div>";
  }).join("");
  var profile = "";
  try{ profile = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getProfile(card) : ""; }catch(e){}
  /* 去AI味全局开关 (RP_DETONE, 默认开) */
  var _dtOn = true;
  try{ _dtOn = (typeof RP_DETONE === "undefined") ? true : RP_DETONE.isEnabled(); }catch(e){}
  var _dtCard = "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">去AI味 (全局)</div>" +
    "<div class=\"kv\">soul 输出自动规避典型 AI 腔 (翻案腔/起手式/提示语冒号等)，prompt 注入 + 确定性后处理两层。</div>" +
    "<div class=\"btnrow\" style=\"margin-top:8px\">" +
    "<button class=\"btn" + (_dtOn ? "" : " ghost") + "\" style=\"font-size:calc(12px * var(--fs))\" " +
    "data-sact=\"setDetoneUI\" data-sid=\"" + escHtml(runId) + "\" data-sname=\"" + escHtml(name) + "\" data-slv=\"on\">开启</button>" +
    "<button class=\"btn" + (_dtOn ? " ghost" : "") + "\" style=\"font-size:calc(12px * var(--fs))\" " +
    "data-sact=\"setDetoneUI\" data-sid=\"" + escHtml(runId) + "\" data-sname=\"" + escHtml(name) + "\" data-slv=\"off\">关闭</button>" +
    "</div></div>";
  return _dtCard +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">宪章</div>" +
    "<div style=\"font-size:calc(13px * var(--fs))\">" + escHtml((soul.soul_md || "未填写").slice(0, 300)) + "</div></div>" +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">性格特质</div>" +
    "<div>" + (traits || "<span class=\"dim\">无</span>") + "</div></div>" +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">动机</div>" +
    "<div class=\"kv\">" + escHtml((pp.motivations || []).join("、") || "无") + "</div></div>" +
    (bg.secrets ? "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">秘密</div>" +
    "<div style=\"font-size:calc(13px * var(--fs))\">" + escHtml(bg.secrets.slice(0, 200)) + "</div></div>" : "") +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">记忆 (" +
    ((mem.facts || []).length) + " 条)</div>" +
    (facts || "<div class=\"dim\">暂无</div>") + (emos || "") +
    "<div class=\"btnrow\" style=\"margin-top:8px\">" +
    "<button class=\"btn ghost\" style=\"font-size:calc(12px * var(--fs))\" data-sact=\"editMemoryUI\" data-sid=\"" +
    escHtml(runId) + "\" data-sname=\"" + escHtml(name) + "\">编辑记忆</button></div></div>" +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">行动日志 (" + traj.length + " 条)</div>" +
    (trajs || "<div class=\"dim\">暂无</div>") + "</div>" +
    (function(){
      var items = {};
      try{ if(typeof RP_SOUL_ORCH !== "undefined") items = RP_SOUL_ORCH.trackItems(card); }catch(e){}
      var keys = Object.keys(items);
      if(!keys.length) return "";
      return "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">物品流转</div>" +
        keys.map(function(k){
          return "<div class=\"kv\" style=\"font-size:calc(12px * var(--fs))\"><span>" + escHtml(k) + "</span>" +
            "<span class=\"dim\">" + escHtml(items[k].holder) + "</span></div>";
        }).join("") + "</div>";
    })() +
    "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">绑定模型</div>" +
    "<div class=\"kv\">" + escHtml(profile || "默认") + "</div></div>" +
    (function(){
      var q2 = escHtml(runId), n2 = escHtml(name);
      var cur = "normal";
      try{ cur = localStorage.getItem("nd_soul_chatty_" + runId + "_" + name) || localStorage.getItem("nd_soul_chatty_" + name) || "normal"; }catch(e){}
      return "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">发言频率</div>" +
        "<div class=\"btnrow\">" +
        ["quiet", "normal", "chatty"].map(function(lv){
          var label = lv === "quiet" ? "沉默" : (lv === "normal" ? "适中" : "话痨");
          return "<button class=\"btn" + (cur === lv ? "" : " ghost") + "\" style=\"font-size:calc(12px * var(--fs))\" " +
            "data-sact=\"setChattyUI\" data-sid=\"" + q2 + "\" data-sname=\"" + n2 + "\" data-slv=\"" + lv + "\">" + label + "</button>";
        }).join("") + "</div></div>";
    })() +
    (function(){
      var h = soulHealth(card);
      var q = escHtml(runId), n = escHtml(name);
      return "<div class=\"card\"><div class=\"name\" style=\"font-size:calc(14px * var(--fs))\">健康度 " + h.score + "分</div>" +
        (h.issues.length ? "<div class=\"kv\" style=\"color:var(--danger)\">" + escHtml(h.issues.join("、")) + "</div>"
          /* P0-39：字面量 green = #008000 高饱和冷绿，与金色主色并排刺眼；
             成功语义统一走 --green(#8fb573) */
          : "<div class=\"kv\" style=\"color:var(--green)\">完整</div>") +
        "<div class=\"btnrow\" style=\"margin-top:8px;flex-wrap:wrap\">" +
        "<button class=\"btn ghost\" style=\"font-size:calc(12px * var(--fs))\" data-sact=\"exportSoulUI\" data-sid=\"" + q + "\" data-sname=\"" + n + "\">导出</button>" +
        "<button class=\"btn ghost\" style=\"font-size:calc(12px * var(--fs))\" data-sact=\"importSoulUI\" data-sid=\"" + q + "\" data-sname=\"" + n + "\">导入</button>" +
        "<button class=\"btn ghost\" style=\"font-size:calc(12px * var(--fs))\" data-sact=\"applyTemplateUI\" data-sid=\"" + q + "\" data-sname=\"" + n + "\">人格模板</button>" +
        "</div></div>";
    })();
}

async function genSoulUI(runId, name){
  var card = null;
  try{ if(typeof RP !== "undefined" && RP.findCard) card = RP.findCard(runId, name); }catch(e){}
  if(!card){ say("找不到角色卡"); return; }
  var cfg = {};
  try{ cfg = JSON.parse(localStorage.getItem("nd_api_cfg_v1") || "{}"); }catch(e){}
  if(!cfg.key){ say("先去设置页配好 API 再生成"); return; }
  if(!await ask("生成 Soul 包",
    "为「" + escHtml(name) + "」生成 Soul 包？会调用模型把角色卡拆成多层内心设定，耗时可能一两分钟，请留在本页。",
    "生成")) return;
  say("正在生成 Soul 包，请稍候…");
  try{
    var r = await RP_SOUL_GEN.generate(card, cfg, function(c, ms, t){ return RP_NET.complete(c, ms, t); });
    if(r.ok){
      try{ if(typeof RP_CARDIMPORT !== "undefined" && card.id) RP_CARDIMPORT.update(card); }catch(e){}
      say("Soul 包已生成");
      if(typeof renderDetail === "function") renderDetail();
    }else{ show("生成失败", escHtml(String(r.reason || "模型没有返回可用的 Soul 数据"))); }
  }catch(e){ show("生成失败", escHtml(String(e.message || e))); }
}

/* 冲突仲裁 UI: 返回冲突徽章 HTML, 点击后弹窗选择 */
function conflictBadgeHTML(conflicts, msgIdx){
  if(!conflicts || !conflicts.length) return "";
  return "<div style=\"margin-top:6px\"><button class=\"btn ghost\" style=\"font-size:calc(11px * var(--fs));color:var(--danger)\" " +
    "onclick=\"RP_SOUL_CFG.arbitrateUI(" + msgIdx + ")\">⚠️ 动作冲突 (" + conflicts.length + ") 点击裁决</button></div>";
}

/* 新手引导: 首次开 Soul 模式 */
function maybeShowGuide(chatId){
  try{
    if(localStorage.getItem("nd_soul_guide_seen")) return;
    localStorage.setItem("nd_soul_guide_seen", "1");
  }catch(e){ return; }
  setTimeout(function(){
    show("Soul 多智能体模式已开启", "<ul class=\"cfopts\">"
      + "<li>每个角色独立思考，用各自绑定的模型</li>"
      + "<li>@名字 可以指定只叫 TA 回应</li>"
      + "<li>角色详情页的「灵魂包」能看到 TA 的内心</li>"
      + "<li>聊天设置里有调用追踪和成本统计</li>"
      + "</ul>");
  }, 800);
}

/* 19. Soul 对比视图 */
function compareSoulsUI(runId, nameA, nameB){
  var cardA = null, cardB = null;
  try{
    if(typeof RP !== "undefined" && RP.findCard){
      cardA = RP.findCard(runId, nameA);
      cardB = RP.findCard(runId, nameB);
    }
  }catch(e){}
  if(!cardA || !cardB){ say("找不到角色卡"); return; }
  var sA = null, sB = null;
  try{ sA = RP_SOUL.getSoul(cardA); sB = RP_SOUL.getSoul(cardB); }catch(e){}
  if(!sA || !sB){ say("双方都需要先有 Soul 包"); return; }
  var rows = [
    ["宪章", (sA.soul_md || "").slice(0, 80), (sB.soul_md || "").slice(0, 80)],
    ["特质", ((sA.persona || {}).core_traits || []).map(function(t){ return typeof t === "string" ? t : t.trait; }).join("、"),
     ((sB.persona || {}).core_traits || []).map(function(t){ return typeof t === "string" ? t : t.trait; }).join("、")],
    ["价值观", ((sA.persona || {}).values || []).join(" > "), ((sB.persona || {}).values || []).join(" > ")],
    ["记忆", (((sA.memory || {}).long_term || {}).facts || []).length + "条", (((sB.memory || {}).long_term || {}).facts || []).length + "条"],
    ["健康度", soulHealth(cardA).score + "分", soulHealth(cardB).score + "分"]
  ];
  var html = "<table class=\"cftable\"><tr><th></th><th>" + escHtml(nameA) + "</th><th>" + escHtml(nameB) + "</th></tr>"
    + rows.map(function(r){
      return "<tr><td class=\"k\">" + r[0] + "</td>"
        + "<td>" + escHtml(String(r[1]).slice(0, 100)) + "</td><td>" + escHtml(String(r[2]).slice(0, 100)) + "</td></tr>";
    }).join("") + "</table>";
  /* P2-43：原先 window.open + document.write 另开一页，WebView 里常被拦、拦了就退化成
     alert 糊一整段。改成 App 内可滚动弹窗，对比表照样整屏可读。 */
  show("Soul 对比 · " + escHtml(nameA) + " / " + escHtml(nameB), html);
}

/* 附体: 从群聊切换到与指定 soul 的单聊 (保留群聊上下文) */
/* ============ Soul 导出/导入 ============ */
function exportSoulUI(runId, name){
  var card = null;
  try{ if(typeof RP !== "undefined" && RP.findCard) card = RP.findCard(runId, name); }catch(e){}
  if(!card){ say("找不到角色卡"); return; }
  var soul = null;
  try{ soul = RP_SOUL.getSoul(card); }catch(e){}
  if(!soul){ say("这个角色还没有 Soul 包"); return; }
  var blob = new Blob([JSON.stringify(soul, null, 2)], {type: "application/json"});
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name + "_soul.json";
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  say("已导出 " + name + "_soul.json");
}

function importSoulUI(runId, name){
  var card = null;
  try{ if(typeof RP !== "undefined" && RP.findCard) card = RP.findCard(runId, name); }catch(e){}
  if(!card){ say("找不到角色卡"); return; }
  var inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json";
  inp.onchange = function(){
    var f = inp.files[0];
    if(!f) return;
    var rd = new FileReader();
    rd.onload = function(){
      try{
        var d = JSON.parse(rd.result);
        if(!d.persona && !d.soul_md){ show("导入失败", "这个文件不是 Soul 包。导出文件里应当有 persona 或 soul_md 字段。"); return; }
        card.extensions = card.extensions || {};
        card.extensions.soul = d;
        try{ if(typeof RP_CARDIMPORT !== "undefined" && card.id) RP_CARDIMPORT.update(card); }catch(e){}
        say("Soul 包已导入");
        if(typeof renderDetail === "function") renderDetail();
      }catch(e){ show("解析失败", escHtml(String(e.message || e))); }
    };
    rd.readAsText(f);
  };
  inp.click();
}

/* ============ Soul 健康度 ============ */
function soulHealth(card){
  var soul = null;
  try{ soul = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(card) : null; }catch(e){}
  if(!soul) return {score: 0, issues: ["无 Soul 包"]};
  var score = 100, issues = [];
  var p = soul.persona || {}, bg = soul.background || {}, mem = (soul.memory || {}).long_term || {};
  if(!soul.soul_md){ score -= 20; issues.push("缺宪章"); }
  if(!(p.core_traits || []).length){ score -= 15; issues.push("缺性格特质"); }
  if(!(p.motivations || []).length){ score -= 10; issues.push("缺动机"); }
  if(!(p.values || []).length){ score -= 10; issues.push("缺价值观"); }
  if(!bg.origin && !bg.history){ score -= 10; issues.push("缺背景"); }
  if(!(soul.rules || {}).decision){ score -= 10; issues.push("缺决策原则"); }
  if(!((mem.facts || []).length)){ score -= 5; issues.push("无记忆"); }
  if(!(soul.trajectory || []).length){ score -= 5; issues.push("无行动日志"); }
  if(!((soul.character_book || []).length)){ score -= 5; issues.push("无私有书"); }
  else { var dis = (soul.character_book || []).filter(function(e){ return e.enabled === false; }).length;
    if(dis) issues.push(dis + " 条私有书被禁用"); }
  return {score: Math.max(0, score), issues: issues};
}

/* ============ 人格模板库 ============ */
var SOUL_TEMPLATES = [
  {name: "傲娇", traits: ["外冷内热", "口是心非", "自尊心强"], values: ["面子", "真心"], decision: "嘴上拒绝，身体诚实"},
  {name: "温柔大姐姐", traits: ["包容", "细心", "治愈"], values: ["陪伴", "理解"], decision: "先照顾对方感受"},
  {name: "腹黑", traits: ["笑面虎", "谋定后动", "掌控欲"], values: ["胜利", "信息"], decision: "让对手以为自己赢了"},
  {name: "天然呆", traits: ["单纯", "直率", "慢半拍"], values: ["开心", "朋友"], decision: "跟着感觉走"},
  {name: "高冷", traits: ["惜字如金", "独立", "观察者"], values: ["效率", "边界"], decision: "最小代价达成目标"},
  {name: "热血", traits: ["冲动", "讲义气", "不服输"], values: ["兄弟", "荣誉"], decision: "先做了再说"}
];

function setChattyUI(runId, name, level){
  /* P2 修复: 直接写 runId 命名空间 key, 不经过模块函数(模块命名空间可能指向别的 run) */
  try{ localStorage.setItem("nd_soul_chatty_" + runId + "_" + name, level); }catch(e){}
  if(typeof renderDetail === "function") renderDetail();
}

/* 去AI味全局开关 UI */
function setDetoneUI(runId, name, lv){
  try{
    if(typeof RP_DETONE !== "undefined") RP_DETONE.setEnabled(lv === "on");
  }catch(e){}
  if(typeof renderDetail === "function") renderDetail();
}

async function applyTemplateUI(runId, name){
  var card = null;
  try{ if(typeof RP !== "undefined" && RP.findCard) card = RP.findCard(runId, name); }catch(e){}
  if(!card){ say("找不到角色卡"); return; }
  var opts = SOUL_TEMPLATES.map(function(t, i){
    return "<li>" + (i+1) + ". <b>" + escHtml(t.name) + "</b>"
      + "<br><span class=\"dim\">" + escHtml((t.traits || []).slice(0, 4).join("、")) + "</span></li>";
  }).join("");
  var pick = await askText("套用人格模板",
    "<ul class=\"cfopts\">" + opts + "</ul>"
    + "<div class=\"dim\">会覆盖现有的性格特质与价值观，宪章、记忆、行动日志不受影响。</div>",
    "", {placeholder:"编号"});
  if(pick == null) return;
  var idx = parseInt(String(pick).trim()) - 1;
  if(isNaN(idx) || idx < 0 || idx >= SOUL_TEMPLATES.length){ say("编号超出范围，模板没有套用"); return; }
  var tpl = SOUL_TEMPLATES[idx];
  var soul = RP_SOUL.ensureSoul(card);
  soul.persona.core_traits = tpl.traits.map(function(t){ return {trait: t, intensity: 75, description: ""}; });
  soul.persona.values = tpl.values.slice();
  soul.rules.decision = tpl.decision;
  try{ if(typeof RP_CARDIMPORT !== "undefined" && card.id) RP_CARDIMPORT.update(card); }catch(e){}
  say("已套用「" + tpl.name + "」模板");
  if(typeof renderDetail === "function") renderDetail();
}

async function possessSoul(runId, soulName){
  if(!await ask("附体", "切换到与「" + escHtml(soulName) + "」的单聊？群聊上下文会保留，随时可以切回来。", "附体")) return;
  try{
    if(typeof showChat === "function"){
      /* 保存群聊位置以便返回 */
      try{ localStorage.setItem("nd_possess_return", JSON.stringify({runId: runId})); }catch(e){}
      showChat(runId, soulName);
    }
  }catch(e){ show("切换失败", escHtml(String(e.message || e))); }
}

async function arbitrateUI(msgIdx){
  var h = [];
  try{
    if(typeof getHist === "function" && typeof CHAT !== "undefined"){
      h = getHist("nd_chat_" + CHAT.runId + "_" + CHAT.name);
    }
  }catch(e){}
  var m = h[msgIdx];
  if(!m || !m._conflicts || !m._conflicts.length){ say("没有待裁决的动作冲突"); return; }
  var opts = m._conflicts.map(function(c, i){
    return "<li>" + (i+1) + ". " + escHtml(c.a) + " 「" + escHtml(c.actionA || "") + "」"
      + " <span class=\"dim\">vs</span> " + escHtml(c.b) + " 「" + escHtml(c.actionB || "") + "」</li>";
  }).join("");
  var pick = await askText("动作冲突，请裁决",
    "<ul class=\"cfopts\">" + opts + "</ul>"
    + "<div class=\"dim\">输入编号选胜者，输入 0 表示两个都不采用。</div>",
    "", {placeholder:"编号"});
  if(pick == null) return;
  var idx = parseInt(String(pick).trim()) - 1;
  if(isNaN(idx) || idx < -1 || idx >= m._conflicts.length){ say("编号超出范围，未做裁决"); return; }
  m._conflictResolved = true;
  m._conflictWinner = idx >= 0 ? m._conflicts[idx] : null;
  try{
    if(typeof saveHist === "function" && typeof CHAT !== "undefined"){
      saveHist("nd_chat_" + CHAT.runId + "_" + CHAT.name, h);
    }
  }catch(e){}
  say(idx >= 0 ? "已裁决：" + m._conflicts[idx].a + " 获胜" : "已裁决：双方动作都不采用");
  if(typeof renderChat === "function") renderChat();
}

async function editMemoryUI(runId, name){
  var card = null;
  try{ if(typeof RP !== "undefined" && RP.findCard) card = RP.findCard(runId, name); }catch(e){}
  if(!card){ say("找不到角色卡"); return; }
  var soul = null;
  try{ soul = RP_SOUL.getSoul(card); }catch(e){}
  if(!soul){ say("这个角色还没有 Soul 包"); return; }
  var mem = soul.memory.long_term || {};
  var facts = (mem.facts || []).map(function(f){
    return typeof f === "string" ? f : (f.text || "");
  }).join("\n");
  var input = await askText("编辑共享记忆",
    "每行一条。删掉的行会一并移除，这里只影响 Soul 的长期记忆，不动聊天记录。",
    facts, {multiline:true, rows:8, okLabel:"保存"});
  if(input == null) return;
  var lines = input.split("\n").map(function(l){ return l.trim(); }).filter(Boolean);
  soul.memory.long_term.facts = lines.map(function(l){ return {t: new Date().toISOString(), text: l}; });
  try{ if(typeof RP_CARDIMPORT !== "undefined" && card.id) RP_CARDIMPORT.update(card); }catch(e){}
  say(lines.length ? "已保存 " + lines.length + " 条记忆" : "记忆已清空");
  if(typeof renderDetail === "function") renderDetail();
}

var api = {
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
  possessSoul: possessSoul,
  exportSoulUI: exportSoulUI, importSoulUI: importSoulUI,
  soulHealth: soulHealth, applyTemplateUI: applyTemplateUI,
  setChattyUI: setChattyUI, maybeShowGuide: maybeShowGuide,
  setDetoneUI: setDetoneUI,
  compareSoulsUI: compareSoulsUI,
  costHTML: costHTML, clearCost: clearCost,
  perfHTML: perfHTML, setPerf: setPerf, refreshPerf: refreshPerf,
  fallbackHTML: fallbackHTML, promptPreviewHTML: promptPreviewHTML,
  showPrompt: showPrompt, replaySoulUI: replaySoulUI
};

/* 点击事件委托（XSS 修复 2026-10-13）：替代内联 onclick 字符串模板。
 * escHtml 含 " → &quot; 转义，data-* 属性值安全；dataset 读出即原文，
 * 不再经过 JS 字符串解析层，故反斜杠 / 引号均无害。静态 onclick 保留。 */
function onSoulCfgClick(e){
  var el = null;
  try{ el = (e.target && e.target.closest) ? e.target.closest("[data-sact]") : null; }
  catch(err){ el = null; }
  if(!el) return;
  var d = el.dataset || {}, act = d.sact;
  try{
    switch(act){
      case "testProfile": api.testProfile(d.sname); break;
      case "delProfile": api.delProfile(d.sname); break;
      case "showPrompt": api.showPrompt(d.sname); break;
      case "replaySoulUI": api.replaySoulUI(d.sname); break;
      case "genSoulUI": api.genSoulUI(d.sid, d.sname); break;
      case "editMemoryUI": api.editMemoryUI(d.sid, d.sname); break;
      case "setChattyUI": api.setChattyUI(d.sid, d.sname, d.slv); break;
      case "setDetoneUI": api.setDetoneUI(d.sid, d.sname, d.slv); break;
      case "exportSoulUI": api.exportSoulUI(d.sid, d.sname); break;
      case "importSoulUI": api.importSoulUI(d.sid, d.sname); break;
      case "applyTemplateUI": api.applyTemplateUI(d.sid, d.sname); break;
    }
  }catch(err){ try{ console.warn("[soul_config] sact failed:", act, err); }catch(e2){} }
}
if(typeof document !== "undefined" && document && typeof document.addEventListener === "function"){
  document.addEventListener("click", onSoulCfgClick);
}

return api;
})();
if(typeof window !== "undefined") window.RP_SOUL_CFG = RP_SOUL_CFG;
if(typeof module !== "undefined") module.exports = RP_SOUL_CFG;
