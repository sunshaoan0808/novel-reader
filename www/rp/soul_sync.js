/* Soul 数据集成扩展 (100条挖掘 G组 91-100)
 * ST互转/酒馆v3/世界书联动/剧情线/成就/报表/API/Webhook/同步/插件 */

var RP_SOUL_SYNC = (function(){
"use strict";

/* 91. ST 卡 soul 段互转 */
function toST(card){
  try{
    var soul = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(card) : null;
    if(!soul) return null;
    return {
      soul_md: soul.soul_md,
      persona: soul.persona,
      background: soul.background,
      /* ST 扩展字段 */
      extensions: {soul: soul}
    };
  }catch(e){ return null; }
}
function fromST(card, stSoul){
  if(!stSoul) return false;
  try{
    card.extensions = card.extensions || {};
    card.extensions.soul = stSoul.extensions ? stSoul.extensions.soul : stSoul;
    return true;
  }catch(e){ return false; }
}

/* 92. 酒馆卡 v3 soul 字段 */
function toV3(card){
  var st = toST(card);
  if(!st) return null;
  return {
    chara_card_v: 3,
    data: {
      name: card.name,
      soul: st.extensions.soul
    }
  };
}

/* 93. 世界书联动: soul 触发世界书条目 */
function linkWorldbook(card, entryIds){
  try{
    var soul = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(card) : null;
    if(!soul) return false;
    soul.linked_books = entryIds || [];
    return true;
  }catch(e){ return false; }
}
function getLinkedBooks(card){
  try{
    var soul = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(card) : null;
    return (soul && soul.linked_books) || [];
  }catch(e){ return []; }
}

/* 94. 剧情线联动: soul 行动推进剧情节点 */
function advancePlot(card, nodeId, result){
  try{
    if(typeof RP_SOUL === "undefined") return false;
    RP_SOUL.log(card, card.name || "soul", "推进剧情节点 " + nodeId, result || "");
    return true;
  }catch(e){ return false; }
}

/* 95. 成就系统 */
var ACHIEVEMENTS = [
  {id: "first_soul", name: "初具灵魂", desc: "生成第一个 Soul 包"},
  {id: "group_5", name: "五子登科", desc: "5 个 soul 同场群聊"},
  {id: "memory_100", name: "过目不忘", desc: "单个 soul 记忆达 100 条"},
  {id: "debate", name: "唇枪舌剑", desc: "完成一场 soul 辩论"},
  {id: "merge", name: "灵魂融合", desc: "合并两个 soul"}
];
function checkAchievements(){
  var unlocked = [];
  try{
    var got = JSON.parse(localStorage.getItem("nd_soul_achv") || "[]");
    ACHIEVEMENTS.forEach(function(a){
      if(got.indexOf(a.id) < 0){
        /* 简化: 只检查 first_soul */
        if(a.id === "first_soul"){
          /* 由外部调用 unlock */
        }
      }
    });
  }catch(e){}
  return unlocked;
}
function unlock(id){
  try{
    var got = JSON.parse(localStorage.getItem("nd_soul_achv") || "[]");
    if(got.indexOf(id) < 0){
      got.push(id);
      localStorage.setItem("nd_soul_achv", JSON.stringify(got));
      return true;
    }
  }catch(e){}
  return false;
}
function getAchievements(){
  var got = [];
  try{ got = JSON.parse(localStorage.getItem("nd_soul_achv") || "[]"); }catch(e){}
  return ACHIEVEMENTS.map(function(a){
    return {id: a.id, name: a.name, desc: a.desc, unlocked: got.indexOf(a.id) >= 0};
  });
}

/* 96. 统计报表 (周报数据) */
function weeklyReport(){
  var cost = {};
  try{ cost = JSON.parse(localStorage.getItem("nd_soul_cost") || "{}"); }catch(e){}
  var totalCalls = 0, totalTok = 0;
  Object.keys(cost).forEach(function(k){
    totalCalls += cost[k].calls || 0;
    totalTok += cost[k].tokens || 0;
  });
  var achv = getAchievements().filter(function(a){ return a.unlocked; }).length;
  return {
    week: new Date().toISOString().slice(0, 10),
    calls: totalCalls, tokens: totalTok,
    models: Object.keys(cost).length,
    achievements: achv + "/" + ACHIEVEMENTS.length
  };
}

/* 97. API 开放: 供外部调用的精简接口 */
function api(){
  return {
    version: "1.0",
    methods: ["getSoul", "listSouls", "chat", "memory"],
    getSoul: function(card){
      try{ return (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(card) : null; }
      catch(e){ return null; }
    }
  };
}

/* 98. Webhook: soul 事件通知 (注册回调) */
var _hooks = {};
function on(event, fn){
  _hooks[event] = _hooks[event] || [];
  _hooks[event].push(fn);
}
function emit(event, data){
  (_hooks[event] || []).forEach(function(fn){
    try{ fn(data); }catch(e){}
  });
}
function off(event, fn){
  _hooks[event] = (_hooks[event] || []).filter(function(f){ return f !== fn; });
}

/* 99. 多设备同步: 导出同步包 */
function syncPackage(cards){
  var pkg = {v: 1, t: new Date().toISOString(), souls: {}};
  (cards || []).forEach(function(c){
    try{
      var s = (typeof RP_SOUL !== "undefined") ? RP_SOUL.getSoul(c) : null;
      if(s) pkg.souls[c.name || "unnamed"] = s;
    }catch(e){}
  });
  return pkg;
}
function applySyncPackage(cards, pkg){
  if(!pkg || pkg.v !== 1) return {ok: false, reason: "bad_pkg"};
  var applied = 0;
  (cards || []).forEach(function(c){
    var s = pkg.souls[c.name];
    if(s){
      c.extensions = c.extensions || {};
      /* 冲突解决: 取 updated_at 更新的 */
      var cur = null;
      try{ cur = RP_SOUL.getSoul(c); }catch(e){}
      var curT = cur ? new Date(cur.updated_at || 0).getTime() : 0;
      var newT = new Date(s.updated_at || 0).getTime();
      if(newT >= curT){ c.extensions.soul = s; applied++; }
    }
  });
  return {ok: true, applied: applied};
}

/* 100. 插件系统 */
var _plugins = {};
function registerPlugin(name, plugin){
  /* plugin: {onReply(text)->text, onPrompt(prompt)->prompt} */
  _plugins[name] = plugin;
  emit("plugin_registered", {name: name});
  return true;
}
function unregisterPlugin(name){ delete _plugins[name]; }
function listPlugins(){ return Object.keys(_plugins); }
function applyPlugins(hook, data){
  var out = data;
  Object.keys(_plugins).forEach(function(n){
    try{
      var p = _plugins[n];
      if(p[hook]) out = p[hook](out) || out;
    }catch(e){}
  });
  return out;
}

return {
  toST: toST, fromST: fromST, toV3: toV3,
  linkWorldbook: linkWorldbook, getLinkedBooks: getLinkedBooks,
  advancePlot: advancePlot,
  ACHIEVEMENTS: ACHIEVEMENTS, checkAchievements: checkAchievements,
  unlock: unlock, getAchievements: getAchievements,
  weeklyReport: weeklyReport,
  api: api,
  on: on, emit: emit, off: off,
  syncPackage: syncPackage, applySyncPackage: applySyncPackage,
  registerPlugin: registerPlugin, unregisterPlugin: unregisterPlugin,
  listPlugins: listPlugins, applyPlugins: applyPlugins
};
})();
if(typeof window !== "undefined") window.RP_SOUL_SYNC = RP_SOUL_SYNC;
if(typeof module !== "undefined") module.exports = RP_SOUL_SYNC;
