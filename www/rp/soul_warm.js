/* 浮生暖系 UI (2026-10-15): 参考「故事馆」暖奶油设计语言
 * 角色头卡 / 角色档案底 sheet / 快捷 chips, 仅 soul 卡生效 */

var RP_SOUL_WARM = (function(){
"use strict";

function esc(s){ return String(s == null ? "" : s); }
function escH(s){
  return esc(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function jq(s){
  return esc(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function getCard(runId, name){
  try{
    if(typeof RP !== "undefined" && RP.findCard) return RP.findCard(runId, name);
  }catch(e){}
  return null;
}
function getSoul(runId, name){
  try{
    var card = getCard(runId, name);
    if(card && typeof RP_SOUL !== "undefined") return RP_SOUL.getSoul(card) || null;
  }catch(e){}
  return null;
}
/* 本聊天是否为 soul 卡 */
function hasSoul(runId, name){ return !!getSoul(runId, name); }

function avatarHTML(name, cls){
  var av = "🎭";
  try{ if(typeof RP_SOUL_UX !== "undefined") av = RP_SOUL_UX.getAvatar(name); }catch(e){}
  return "<div class=\"" + (cls || "sw-avatar") + "\">" + escH(av) + "</div>";
}

/* 好感度: 按记忆沉淀推导, 诚实标注为估算 */
function trustInfo(runId, name){
  var facts = 0;
  try{
    var soul = getSoul(runId, name);
    var lt = soul && soul.memory && soul.memory.long_term;
    if(lt){
      facts += (lt.facts || []).length + (lt.emotional || []).length;
      var bp = lt.by_perspective || {};
      Object.keys(bp).forEach(function(k){ facts += (bp[k] || []).length; });
    }
  }catch(e){}
  var pct = Math.min(96, 8 + facts * 3);
  var label = pct < 20 ? "初识" : pct < 45 ? "开始信任" : pct < 75 ? "信任" : "亲密无间";
  return {pct: pct, label: label, facts: facts};
}

function statusLine(runId, name){
  try{
    if(typeof RP_SOUL_UX !== "undefined"){
      var st = RP_SOUL_UX.statusText(name);
      if(st) return st;
      return "今天看起来安静一些。";
    }
  }catch(e){}
  return "";
}

/* 角色头卡 (放在 chathead 下方) */
function cheadHTML(runId, name, novel){
  var t = trustInfo(runId, name);
  return "" +
  "<div class=\"sw-chead\">" +
    avatarHTML(name) +
    "<div class=\"sw-chead-main\">" +
      "<div class=\"sw-chead-top\">" +
        "<span class=\"sw-name\">" + escH(name) + "</span>" +
        "<span class=\"sw-tag\">故事角色</span>" +
        "<button class=\"sw-profile-btn\" onclick=\"RP_SOUL_WARM.openSoulProfile('" + jq(runId) + "','" + jq(name) + "')\">🗂 角色档案</button>" +
      "</div>" +
      "<div class=\"sw-trust\"><span class=\"sw-trust-label\">♡ " + escH(t.label) + "</span>" +
      "<div class=\"sw-meter\"><i style=\"width:" + t.pct + "%\"></i></div></div>" +
      "<div class=\"sw-status\">" + escH(statusLine(runId, name)) + "</div>" +
    "</div>" +
  "</div>";
}

/* 快捷 chips */
function quickChipsHTML(runId, name){
  var novel = "";
  try{ novel = (((window.__DATA__ || {}).runs || {})[runId] || {}).novel || ""; }catch(e){}
  var chips = ["问他今天怎么样", novel ? ("聊聊" + novel + "的事") : "聊聊最近的事", "安慰他"];
  return "<div class=\"sw-quick\">" + chips.map(function(c){
    return "<button class=\"sw-chip\" onclick=\"RP_SOUL_WARM.fillInput('" + jq(c) + "')\">" + escH(c) + "</button>";
  }).join("") + "</div>";
}
function fillInput(text){
  try{
    var inp = document.querySelector(".chatbar input[type=text], .chatbar textarea, #chatinput");
    if(inp){ inp.value = text; inp.focus(); }
  }catch(e){}
}

/* ---------- 角色档案底 sheet ---------- */
function field(card, k){ try{ return (card.fields || {})[k] || ""; }catch(e){ return ""; } }
function traitNames(soul){
  try{
    var ts = (soul.persona || {}).core_traits || [];
    return ts.map(function(t){ return typeof t === "string" ? t : (t.trait || ""); }).filter(Boolean).slice(0, 8);
  }catch(e){ return []; }
}
function memFacts(runId, name){
  var out = [];
  try{
    var soul = getSoul(runId, name);
    var lt = soul && soul.memory && soul.memory.long_term;
    if(!lt) return out;
    var bp = (lt.by_perspective || {})[name] || [];
    out = bp.concat(lt.facts || []).slice(-6).reverse();
  }catch(e){}
  return out;
}

function openSoulProfile(runId, name){
  closeSoulProfile();
  var card = getCard(runId, name), soul = getSoul(runId, name);
  var F = function(k){ return field(card, k); };
  var t = trustInfo(runId, name);
  var traits = traitNames(soul);
  if(!traits.length && F("core_traits")){
    traits = String(F("core_traits")).split(/[,，、;；]/).map(function(x){ return x.trim(); }).filter(Boolean).slice(0, 8);
  }
  var style = F("temperament_type") || (soul && soul.soul_md ? String(soul.soul_md).slice(0, 90) : "");
  var facts = memFacts(runId, name);
  var novel = "";
  try{ novel = (((window.__DATA__ || {}).runs || {})[runId] || {}).novel || ""; }catch(e){}

  var html =
  "<div class=\"sw-scrim\" id=\"sw_scrim\" onclick=\"RP_SOUL_WARM.closeSoulProfile()\"></div>" +
  "<div class=\"sw-sheet\" id=\"sw_sheet\" role=\"dialog\" aria-label=\"角色档案\">" +
    "<div class=\"sw-sheet-head\">🗂 角色档案" +
      "<button class=\"x\" onclick=\"RP_SOUL_WARM.closeSoulProfile()\">✕</button></div>" +
    "<div class=\"sw-sheet-body\">" +
      "<div class=\"sw-sheet-hero\">" + avatarHTML(name) +
        "<div><div class=\"sw-name\" style=\"font-size:22px\">" + escH(name) + "</div>" +
        "<div class=\"sw-status\">" + (novel ? "来自《" + escH(novel) + "》" : "故事角色") + "</div>" +
        "<div class=\"sw-hero-tags\"><span class=\"sw-hero-tag\">♡ " + escH(t.label) + "</span>" +
        (F("temperament_type") ? "<span class=\"sw-hero-tag ghost\">" + escH(F("temperament_type")) + "</span>" : "") +
        "</div></div>" +
      "</div>" +
      "<div class=\"sw-sec\"><div class=\"sw-sec-t\">📋 基础信息</div><div class=\"sw-kv\">" +
        "<div><span>姓名：</span>" + escH(name) + "</div>" +
        "<div><span>身份：</span>" + escH(F("core_identity") || F("story_role") || "故事角色") + "</div>" +
        "<div><span>年龄：</span>" + escH(F("age_stage") || "—") + "</div>" +
        "<div><span>性别：</span>" + escH(F("gender") || "—") + "</div>" +
      "</div></div>" +
      (traits.length ? "<div class=\"sw-sec\"><div class=\"sw-sec-t\">🧬 性格特点</div><div class=\"sw-traits\">" +
        traits.map(function(x){ return "<span class=\"sw-trait\">" + escH(x) + "</span>"; }).join("") +
      "</div></div>" : "") +
      (style ? "<div class=\"sw-sec\"><div class=\"sw-sec-t\">💬 说话风格</div><div class=\"sw-para\">" + escH(style) + "</div></div>" : "") +
      "<div class=\"sw-sec\"><div class=\"sw-sec-t\">♡ 和我的关系</div>" +
        "<div class=\"sw-trust\"><span class=\"sw-trust-label\">目前：" + escH(t.label) + "</span>" +
        "<div class=\"sw-meter\"><i style=\"width:" + t.pct + "%\"></i></div></div></div>" +
      (facts.length ? "<div class=\"sw-sec\"><div class=\"sw-sec-t\">🔎 已知线索</div><ul class=\"sw-clues\">" +
        facts.map(function(f){ return "<li>" + escH(String(f).slice(0, 60)) + "</li>"; }).join("") +
      "</ul></div>" : "") +
    "</div>" +
    "<div class=\"sw-sheet-foot\">" +
      "<button class=\"sw-btn ghost\" onclick=\"RP_SOUL_WARM.closeSoulProfile()\">关闭</button>" +
      "<button class=\"sw-btn primary\" onclick=\"RP_SOUL_WARM.closeSoulProfile()\">开始聊天</button>" +
    "</div>" +
  "</div>";
  var d = document.createElement("div");
  d.id = "sw_profile_root";
  d.className = "soulwarm"; /* 变量作用域: sheet 挂 body 下, 需自带 soulwarm */
  d.innerHTML = html;
  document.body.appendChild(d);
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      var s = document.getElementById("sw_scrim"), sh = document.getElementById("sw_sheet");
      if(s) s.classList.add("on");
      if(sh) sh.classList.add("on");
    });
  });
}
function closeSoulProfile(){
  var root = document.getElementById("sw_profile_root");
  if(root) root.remove();
}

return {
  hasSoul: hasSoul,
  cheadHTML: cheadHTML,
  quickChipsHTML: quickChipsHTML,
  fillInput: fillInput,
  openSoulProfile: openSoulProfile,
  closeSoulProfile: closeSoulProfile,
  trustInfo: trustInfo
};
})();
if(typeof window !== "undefined") window.RP_SOUL_WARM = RP_SOUL_WARM;
if(typeof module !== "undefined") module.exports = RP_SOUL_WARM;
