/* 质量门 (2026-10-07): 借鉴 Cardwright 导出检查 + dama-cyber 三档。
 * 剧本包导出/完成前跑纯规则检查，零 token。
 * 输出: {score, level: "pass"|"warn"|"fail", checks: [{id, level, msg}]}
 */
var DISTILL_QUALITY = (function(){
"use strict";

// 画像期望字段 (distill_core.js 的 8 字段)
var PROFILE_FIELDS = ["core_identity", "core_traits", "appearance", "speech_style",
  "background", "relationships_summary", "key_events", "arc_summary"];

function check(pkgId){
  var checks = [];
  var pkg = DISTILL_PACKAGE.getPackage(pkgId);
  if(!pkg){
    return {score: 0, level: "fail", checks: [{id: "pkg", level: "fail", msg: "剧本包不存在"}]};
  }

  var cards = DISTILL_PACKAGE.listCharacterCards(pkgId);
  var withCard = cards.filter(function(c){ return c.hasCard; });

  // 1. 角色卡覆盖率
  if(!cards.length){
    checks.push({id: "chars", level: "fail", msg: "没有角色"});
  } else if(withCard.length < cards.length){
    checks.push({id: "chars", level: "warn",
      msg: "角色卡 " + withCard.length + "/" + cards.length + " 已生成"});
  } else {
    checks.push({id: "chars", level: "pass",
      msg: "角色卡 " + withCard.length + "/" + cards.length + " 已生成"});
  }

  // 2. 字段完整度
  var fieldTotal = 0, fieldFilled = 0;
  withCard.forEach(function(c){
    var card = DISTILL_PACKAGE.getCharacterCard(pkgId, c.name);
    var d = (card && card._distill) || {};
    PROFILE_FIELDS.forEach(function(f){
      fieldTotal++;
      if(d[f] && String(d[f]).trim().length > 10) fieldFilled++;
    });
  });
  var fieldRate = fieldTotal ? fieldFilled / fieldTotal : 0;
  if(fieldRate >= 0.8){
    checks.push({id: "fields", level: "pass",
      msg: "字段完整度 " + Math.round(fieldRate * 100) + "%"});
  } else if(fieldRate >= 0.5){
    checks.push({id: "fields", level: "warn",
      msg: "字段完整度 " + Math.round(fieldRate * 100) + "%，部分字段缺失"});
  } else {
    checks.push({id: "fields", level: "fail",
      msg: "字段完整度仅 " + Math.round(fieldRate * 100) + "%，建议重蒸"});
  }

  // 3. 引用覆盖率 (四态标注)
  var prov = DISTILL_PACKAGE.getData(pkgId, "provenance");
  if(prov && prov.facts && prov.facts.length){
    var st = DISTILL_PROVENANCE.stats(prov);
    var total = prov.facts.length;
    var grounded = (st.canon || 0) + (st.ref || 0);
    var rate = grounded / total;
    // 引用存在性校验
    var chunkIds = []; // 包内不存 chunks，跳过存在性检查
    if(rate >= 0.6){
      checks.push({id: "citations", level: "pass",
        msg: "引用覆盖 " + Math.round(rate * 100) + "% (" + grounded + "/" + total + " 有依据)"});
    } else if(rate >= 0.3){
      checks.push({id: "citations", level: "warn",
        msg: "引用覆盖 " + Math.round(rate * 100) + "%，" + (st.unknown || 0) + " 条无依据"});
    } else {
      checks.push({id: "citations", level: "fail",
        msg: "引用覆盖仅 " + Math.round(rate * 100) + "%，多为无依据推断"});
    }
  } else {
    checks.push({id: "citations", level: "warn", msg: "无出处索引"});
  }

  // 4. 关系覆盖率
  var rels = DISTILL_PACKAGE.getData(pkgId, "relations") || [];
  var relChars = {};
  rels.forEach(function(e){
    relChars[e.source_character] = 1;
    relChars[e.target_character] = 1;
  });
  var relCover = withCard.length ? Object.keys(relChars).length / withCard.length : 0;
  if(relCover >= 0.7){
    checks.push({id: "relations", level: "pass",
      msg: "关系覆盖 " + Object.keys(relChars).length + "/" + withCard.length + " 人"});
  } else if(rels.length){
    checks.push({id: "relations", level: "warn",
      msg: "关系覆盖 " + Object.keys(relChars).length + "/" + withCard.length + " 人"});
  } else {
    checks.push({id: "relations", level: "warn", msg: "无关系数据"});
  }

  // 5. 剧情完整度 (完整模式)
  var plot = DISTILL_PACKAGE.getData(pkgId, "plot");
  if(plot){
    var ok = (plot.sections && plot.sections.length) && (plot.conflicts && plot.conflicts.length);
    checks.push(ok ?
      {id: "plot", level: "pass", msg: "剧情层完整 (" + plot.sections.length + " 节大纲)"} :
      {id: "plot", level: "warn", msg: "剧情层不完整"});
  }

  // 综合评分
  var score = 0;
  checks.forEach(function(c){
    score += c.level === "pass" ? 20 : c.level === "warn" ? 10 : 0;
  });
  score = Math.min(100, score);
  var level = "pass";
  if(checks.some(function(c){ return c.level === "fail"; })) level = "fail";
  else if(checks.some(function(c){ return c.level === "warn"; })) level = "warn";

  return {score: score, level: level, checks: checks};
}

var LEVEL_ICON = {pass: "✅", warn: "⚠️", fail: "❌"};
var LEVEL_COLOR = {pass: "var(--gold)", warn: "#f0ad4e", fail: "#e74c3c"};

function renderReport(q){
  return `<div class="card" style="margin-bottom:12px">
    <div style="font-weight:600;margin-bottom:8px">质量门 <span style="color:${LEVEL_COLOR[q.level]}">${LEVEL_ICON[q.level]} ${q.score}分</span></div>
    ${q.checks.map(function(c){
      return `<div style="font-size:12px;padding:3px 0">
        <span style="color:${LEVEL_COLOR[c.level]}">${LEVEL_ICON[c.level]}</span> ${esc(c.msg)}</div>`;
    }).join("")}
  </div>`;
}

return {
  check: check,
  renderReport: renderReport,
  LEVEL_ICON: LEVEL_ICON,
  PROFILE_FIELDS: PROFILE_FIELDS
};
})();
