/* 备份提醒 (2026-10-07): 借鉴 Tavo 定期备份提醒。
 * 蒸馏包是用户心血，超过阈值未备份就提醒。
 */
var DISTILL_BACKUP = (function(){
"use strict";

var KEY = "distill_backup_reminder";
var DEFAULT_DAYS = 14;

function cfg(){
  try{
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  }catch(e){ return {}; }
}

function saveCfg(c){
  localStorage.setItem(KEY, JSON.stringify(c));
}

function getDays(){
  var c = cfg();
  return c.days || DEFAULT_DAYS;
}

function setDays(d){
  var c = cfg();
  c.days = d;
  saveCfg(c);
}

// 记录备份时间
function markBackedUp(pkgId){
  var c = cfg();
  c["backup_" + pkgId] = Date.now();
  saveCfg(c);
}

// 检查需要提醒的包
function checkNeeded(){
  var days = getDays();
  var threshold = days * 24 * 3600 * 1000;
  var now = Date.now();
  var c = cfg();
  var pkgs = DISTILL_PACKAGE.listPackages();
  var needed = [];
  pkgs.forEach(function(p){
    var last = c["backup_" + p.id] || p.created;
    if(now - last > threshold){
      needed.push({
        id: p.id,
        novel: p.novel,
        daysAgo: Math.floor((now - last) / (24 * 3600 * 1000))
      });
    }
  });
  return needed;
}

// 渲染提醒横幅 (在蒸馏首页调用)
function renderBanner(){
  var needed = checkNeeded();
  if(!needed.length) return "";
  return `<div style="font-size:calc(13px * var(--fs));color:#f0ad4e;background:rgba(240,173,78,.1);border:1px solid #f0ad4e;border-radius:8px;padding:10px;margin-bottom:12px">
    💾 以下剧本包超过 ${getDays()} 天未备份：
    ${needed.map(function(n){ return `<div>· ${esc(n.novel)} (${n.daysAgo} 天前)</div>`; }).join("")}
    <div style="margin-top:8px">
      <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="DISTILL_BACKUP.dismiss()">稍后提醒</button>
      <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="DISTILL_BACKUP.gotoSettings()">设置</button>
    </div>
  </div>`;
}

function dismiss(){
  // 7天后再提醒
  var c = cfg();
  c.snooze_until = Date.now() + 7 * 24 * 3600 * 1000;
  saveCfg(c);
  if(typeof DISTILL_UI !== "undefined") DISTILL_UI.show();
}

function shouldShow(){
  var c = cfg();
  if(c.snooze_until && Date.now() < c.snooze_until) return false;
  return checkNeeded().length > 0;
}

function gotoSettings(){
  var days = prompt("备份提醒周期（天）:", getDays());
  if(days && parseInt(days) > 0){
    setDays(parseInt(days));
    alert("已设为 " + days + " 天");
  }
  if(typeof DISTILL_UI !== "undefined") DISTILL_UI.show();
}

/* P2-11: 收敛到 escutil.js 的 escH()（此前只转 & <，现统一为全实体转义）；
   独立加载（测试 vm）无 escH 时回退同款实现 */
var esc = (typeof escH === "function") ? escH : function(s){ return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };

return {
  markBackedUp: markBackedUp,
  checkNeeded: checkNeeded,
  renderBanner: renderBanner,
  shouldShow: shouldShow,
  dismiss: dismiss,
  gotoSettings: gotoSettings,
  getDays: getDays,
  setDays: setDays
};
})();
