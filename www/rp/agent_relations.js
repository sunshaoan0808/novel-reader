/* 关系动态更新+锁定 (2026-10-07): 借鉴 Marinara-Engine Relationship Tracker。
 * 蒸馏时的关系是静态的；聊天中关系会演变。
 * - 后台从对话检测关系变化，更新动态关系层
 * - 用户可锁定某条关系，锁了 AI 就不再动它
 * - 动态层优先于蒸馏静态层
 * 存储：localStorage["nd_rel_dyn_<runId>[_<卡id>]"] = [{a, b, summary, type, locked, updated}]
 */
var AGENT_RELATIONS = (function(){
"use strict";

/* 导入卡全部共用 runId="imported", 键必须再挂卡 id, 否则所有导入卡共用一个动态关系池
   (A 卡的演变会污染 B 卡的关系表)。老池 nd_rel_dyn_imported 兼容读见 RP_SCOPE。
   cardName 是「当前聊天那张卡」的名字: 蒸馏 run 不需要(后缀恒空), imported 用它定位卡 id。 */
function keyOf(runId, cardName){ return RP_SCOPE.key("nd_rel_dyn_", runId, cardName); }

function getDyn(runId, cardName){
  return RP_SCOPE.read(keyOf(runId, cardName), RP_SCOPE.legacyKey("nd_rel_dyn_", runId));
}
function setDyn(runId, cardName, arr){
  try{ RP_SCOPE.write(keyOf(runId, cardName), arr); }catch(e){}
}

/* 合并：动态层覆盖静态层 */
function merged(runId, staticRels, cardName){
  var dyn = getDyn(runId, cardName);
  if(!dyn.length) return staticRels || [];
  var map = {};
  (staticRels || []).forEach(function(r){
    var k = relKey(r.source_character, r.target_character);
    map[k] = r;
  });
  dyn.forEach(function(d){
    var k = relKey(d.a, d.b);
    map[k] = {
      source_character: d.a,
      target_character: d.b,
      relationship_summary: d.summary,
      type: d.type || "",
      _dynamic: true,
      _locked: !!d.locked
    };
  });
  return Object.keys(map).map(function(k){ return map[k]; });
}

function relKey(a, b){
  return [a, b].sort().join("|");
}

/* 后台检测关系变化 (每 6 轮跑一次) */
async function detectChanges(runId, name, history, callChat, cfg){
  try{
    if(localStorage.getItem("nd_reldyn_off") === "1") return {updated: 0};
  }catch(e){}
  var count = 0;
  try{ count = parseInt(localStorage.getItem("nd_reldyn_count_" + runId) || "0"); }catch(e){}
  count++;
  try{ localStorage.setItem("nd_reldyn_count_" + runId, String(count)); }catch(e){}
  if(count % 6 !== 0) return {updated: 0};

  var dyn = getDyn(runId, name);
  var lockedPairs = dyn.filter(function(d){ return d.locked; })
    .map(function(d){ return d.a + "-" + d.b; }).join("、");

  var recent = history.slice(-10).map(function(m){
    return (m.role === "user" ? "用户" : name) + ": " + (m.content || "").slice(0, 400);
  }).join("\n");

  try{
    var r = await callChat(cfg, [
      {role: "system", content:
        "你是关系观察员。从对话中判断人物关系是否有实质变化。\n" +
        "只报告：关系亲密度显著变化、新建立的关系、关系破裂。\n" +
        "不要报告：一次性情绪、已有关系中无变化的。\n" +
        (lockedPairs ? "以下关系已锁定，不要动：" + lockedPairs + "\n" : "") +
        "返回 JSON 数组，最多2条: [{\"a\":\"人物A\",\"b\":\"人物B\",\"summary\":\"关系描述\",\"type\":\"positive/neutral/negative/complicated\"}]\n" +
        "无变化返回 []。只返回 JSON。"},
      {role: "user", content: recent}
    ], 0.3);
    var m = r.match(/\[[\s\S]*\]/);
    if(!m) return {updated: 0};
    var changes = JSON.parse(m[0]);
    if(!Array.isArray(changes) || !changes.length) return {updated: 0};

    var updated = 0;
    changes.slice(0, 2).forEach(function(c){
      if(!c.a || !c.b || !c.summary) return;
      var k = relKey(c.a, c.b);
      // 锁定的跳过
      var existing = dyn.find(function(d){ return relKey(d.a, d.b) === k; });
      if(existing && existing.locked) return;
      if(existing){
        existing.summary = c.summary;
        existing.type = c.type || existing.type;
        existing.updated = Date.now();
      }else{
        dyn.push({a: c.a, b: c.b, summary: c.summary,
          type: c.type || "neutral", locked: false, updated: Date.now()});
      }
      updated++;
    });
    if(updated) setDyn(runId, name, dyn);
    return {updated: updated};
  }catch(e){ return {updated: 0}; }
}
/* 用户锁定/解锁 */
function setLock(runId, a, b, locked, cardName){
  var dyn = getDyn(runId, cardName);
  var k = relKey(a, b);
  var ex = dyn.find(function(d){ return relKey(d.a, d.b) === k; });
  if(ex){ ex.locked = !!locked; }
  else if(locked){
    dyn.push({a: a, b: b, summary: "", type: "neutral", locked: true, updated: Date.now()});
  }
  setDyn(runId, cardName, dyn);
}
function isLocked(runId, a, b, cardName){
  var dyn = getDyn(runId, cardName);
  var k = relKey(a, b);
  var ex = dyn.find(function(d){ return relKey(d.a, d.b) === k; });
  return !!(ex && ex.locked);
}

function setEnabled(on){
  try{
    if(on) localStorage.removeItem("nd_reldyn_off");
    else localStorage.setItem("nd_reldyn_off", "1");
  }catch(e){}
}

return {
  getDyn: getDyn,
  merged: merged,
  detectChanges: detectChanges,
  setLock: setLock,
  isLocked: isLocked,
  setEnabled: setEnabled
};
})();
