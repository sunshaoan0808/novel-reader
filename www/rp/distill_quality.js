/* 质量门 (2026-10-07): 借鉴 Cardwright 导出检查 + dama-cyber 三档。
 * 剧本包导出/完成前跑纯规则检查，零 token。
 * 输出: {score, level: "pass"|"warn"|"fail", checks: [{id, level, msg}]}
 */
var DISTILL_QUALITY = (function(){
"use strict";

// 画像期望字段 (distill_core.js 的 8 字段)
var PROFILE_FIELDS = ["core_identity", "brief_intro", "core_traits", "appearance", "speech_style",
  "background", "relationships_summary", "key_events", "arc_summary",
  "age", "gender", "height", "ethnicity", "likes", "dislikes", "interests", "fears"];

// AI 腔禁用模式 (dama-cyber 镜像翻转: 他的"去AI味" → 我们的"档案去AI腔")
var AI_CLICHE_PATTERNS = [
  "眼中闪过", "嘴角勾起", "眼眶微红", "不可置信", "眼底闪过", "咬了咬唇", "冷冷地说",
  "不仅是.*更是", "不是.*而是", "既.*又", "一种说不出的",
  "真正的.*是", "的意义在于", "谁说.*就一定"
];

function detectAiCliche(text){
  var hits = [];
  AI_CLICHE_PATTERNS.forEach(function(p){
    try{
      var re = new RegExp(p, "g");
      var m = text.match(re);
      if(m) hits.push({pattern: p, count: m.length});
    }catch(e){}
  });
  return hits;
}

// C1: polish 自动修复 (dama-cyber: 只报警→能修)
var AI_CLICHE_FIXES = [
  ["眼中闪过一丝", ""],
  ["眼中闪过", ""],
  ["眼底闪过", ""],
  ["嘴角勾起一抹", ""],
  ["嘴角勾起", ""],
  ["眼眶微红", "眼圈发红"],
  ["咬了咬唇", "抿了抿嘴"],
  ["冷冷地说", "说道"],
  ["不可置信地", "难以置信地"],
  ["一种说不出的", ""]
];

function polishAiCliche(text){
  var fixed = String(text || "");
  var count = 0;
  AI_CLICHE_FIXES.forEach(function(pair){
    try{
      var re = new RegExp(pair[0], "g");
      var before = fixed;
      fixed = fixed.replace(re, pair[1]);
      if(fixed !== before) count++;
    }catch(e){}
  });
  fixed = fixed.replace(/\s{2,}/g, " ").trim();
  return {text: fixed, fixed: count};
}

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

  // 2.5 AI 腔检测
  var clicheHits = [];
  withCard.forEach(function(c){
    var card = DISTILL_PACKAGE.getCharacterCard(pkgId, c.name);
    var d = (card && card._distill) || {};
    PROFILE_FIELDS.forEach(function(f){
      var val = d[f];
      if(val && typeof val === "string"){
        var hits = detectAiCliche(val);
        hits.forEach(function(h){
          clicheHits.push({character: c.name, field: f, pattern: h.pattern, count: h.count});
        });
      }
    });
  });
  if(!clicheHits.length){
    checks.push({id: "aicliche", level: "pass", msg: "无 AI 腔"});
  } else if(clicheHits.length <= 3){
    checks.push({id: "aicliche", level: "warn",
      msg: clicheHits.length + " 处疑似 AI 腔 (" + clicheHits.slice(0, 2).map(function(h){ return h.pattern; }).join("、") + ")"});
  } else {
    checks.push({id: "aicliche", level: "fail",
      msg: clicheHits.length + " 处 AI 腔，建议用改动单重写"});
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

  // 3.5 引用密度 (dama-cyber 镜像翻转: 他的"爽点密度" → 我们的"引用密度")
  // 每百字有依据引用数，衡量档案的实证扎实程度
  if(prov && prov.facts && prov.facts.length){
    var totalChars = 0, groundedCount = 0;
    prov.facts.forEach(function(f){
      totalChars += (f.value || "").length;
      if(f.source === "canon" || f.source === "ref") groundedCount++;
    });
    var density = totalChars ? (groundedCount / totalChars * 100) : 0;
    if(density >= 1.5){
      checks.push({id: "density", level: "pass",
        msg: "引用密度 " + density.toFixed(1) + "/百字"});
    } else if(density >= 0.8){
      checks.push({id: "density", level: "warn",
        msg: "引用密度 " + density.toFixed(1) + "/百字，实证偏稀疏"});
    } else {
      checks.push({id: "density", level: "fail",
        msg: "引用密度仅 " + density.toFixed(1) + "/百字，多为无依据论述"});
    }
  }

  // 3.7 孤证关系 (C2)
  var isolatedRels = rels.filter(function(e){ return e._isolated; });
  if(isolatedRels.length){
    checks.push({id: "isolated_rels", level: "warn",
      msg: isolatedRels.length + " 条关系为单chunk孤证 (可能为幻觉)"});
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

  // 4.5 无锚定引用
  var unanchored = DISTILL_PACKAGE.getData(pkgId, "unanchored") || [];
  if(unanchored.length){
    checks.push({id: "unanchored", level: "fail",
      msg: unanchored.length + " 条引用内容在原文找不到 (幻觉嫌疑)"});
  }

  // 4.7 时序泄漏 (需要 chunks 数据，包内不存时跳过)
  try{
    if(typeof DISTILL_TIMELEAK !== "undefined" && window._distillChunks){
      var leaks = DISTILL_TIMELEAK.detect(pkgId, window._distillChunks);
      if(leaks.length){
        checks.push({id: "timeleak", level: "fail",
          msg: leaks.length + " 处疑似时序泄漏 (前期档案含后期信息: " +
            leaks.slice(0, 2).map(function(l){ return l.character + ":" + l.term; }).join("、") + ")"});
      }
    }
  }catch(e){}

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
      return `<div style="font-size:calc(12px * var(--fs));padding:3px 0">
        <span style="color:${LEVEL_COLOR[c.level]}">${LEVEL_ICON[c.level]}</span> ${esc(c.msg)}</div>`;
    }).join("")}
  </div>`;
}

return {
  check: check,
  renderReport: renderReport,
  detectAiCliche: detectAiCliche,
  polishAiCliche: polishAiCliche,
  LEVEL_ICON: LEVEL_ICON,
  PROFILE_FIELDS: PROFILE_FIELDS
};
})();
