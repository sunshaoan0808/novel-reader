/* 时序泄漏检测 (2026-10-07): 借鉴 Python timeleak.py (TimeChara式)。
 * 手机简化版: 纯规则启发式，零 token。
 * 原理: early 档案不应包含只在 late chunk 出现的关键信息。
 * 方法: 提取 late-only 词 (只在后期 chunk 出现的2-4字词)，
 *       检查 early 档案是否包含，命中则标记疑似泄漏。
 */
var DISTILL_TIMELEAK = (function(){
"use strict";

// 按位置三等分 chunks
function splitStages(chunks){
  var n = chunks.length;
  var e = Math.ceil(n / 3), m = Math.ceil(n * 2 / 3);
  return {
    early: chunks.slice(0, e),
    mid: chunks.slice(e, m),
    late: chunks.slice(m)
  };
}

// 提取 chunk 文本中的2-4字候选词 (简化版)
function extractTerms(text){
  var terms = {};
  var re = /[\u4e00-\u9fa5]{2,4}/g;
  var m;
  while((m = re.exec(text))){
    var w = m[0];
    // 过滤常见虚词
    if(/^(的|了|着|过|和|与|在|是|有|不|也|都|就|才|很|更|最|这|那|哪|什么|怎么|为什么)/.test(w)) continue;
    terms[w] = (terms[w] || 0) + 1;
  }
  return terms;
}

// 检测: 返回 [{character, term, stage}]
function detect(pkgId, chunks){
  var stages = splitStages(chunks);
  var earlyText = stages.early.map(function(c){ return c.text; }).join("");
  var lateText = stages.late.map(function(c){ return c.text; }).join("");

  var earlyTerms = extractTerms(earlyText);
  var lateTerms = extractTerms(lateText);

  // late-only: 在 late 出现>=3次，early 完全没出现
  var lateOnly = [];
  Object.keys(lateTerms).forEach(function(w){
    if(lateTerms[w] >= 3 && !earlyTerms[w] && w.length >= 2){
      lateOnly.push(w);
    }
  });

  var leaks = [];
  var pkg = DISTILL_PACKAGE.getPackage(pkgId);
  if(!pkg) return leaks;

  pkg.characters.forEach(function(c){
    var card = DISTILL_PACKAGE.getCharacterCard(pkgId, c.name);
    var d = (card && card._distill) || {};
    var earlyProfile = d.early || {};
    // 合并 early 所有字段文本
    var earlyText = Object.keys(earlyProfile).map(function(k){
      return earlyProfile[k] || "";
    }).join(" ");
    // 如果没有分阶段数据，跳过
    if(!earlyText.trim()) return;

    lateOnly.forEach(function(term){
      if(earlyText.indexOf(term) >= 0){
        leaks.push({character: c.name, term: term, stage: "early"});
      }
    });
  });

  return leaks;
}

return {
  detect: detect,
  splitStages: splitStages
};
})();
