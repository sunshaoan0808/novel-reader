/* Memory Usage (2026-10-07): 借鉴 Character.AI Memory.availableMemoryBox。
 * 蒸馏包"用了多少/还剩多少"可视化。
 */
var DISTILL_MEMORY = (function(){
"use strict";

// 估算 token (中文~1.5字/词，英文~4字符/词)
function estTokens(text){
  var s = String(text || "");
  var cn = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  var en = s.length - cn;
  return Math.ceil(cn / 1.5 + en / 4);
}

// 计算包的内存用量
function calcUsage(pkgId){
  var total = 0;
  var breakdown = {};

  // 角色卡
  var cards = DISTILL_PACKAGE.listCharacterCards(pkgId);
  var cardTokens = 0;
  cards.forEach(function(c){
    var card = DISTILL_PACKAGE.getCharacterCard(pkgId, c.name);
    if(card && card._distill){
      Object.keys(card._distill).forEach(function(k){
        var v = card._distill[k];
        if(typeof v === "string") cardTokens += estTokens(v);
      });
    }
  });
  breakdown.cards = cardTokens;
  total += cardTokens;

  // 世界书
  try{
    var wb = DISTILL_PACKAGE.getData(pkgId, "worldbook");
    var wbTokens = estTokens(JSON.stringify(wb || {}));
    breakdown.worldbook = wbTokens;
    total += wbTokens;
  }catch(e){}

  // 关系
  try{
    var rels = DISTILL_PACKAGE.getData(pkgId, "relations") || [];
    var relTokens = estTokens(JSON.stringify(rels));
    breakdown.relations = relTokens;
    total += relTokens;
  }catch(e){}

  // 开场白
  try{
    var openings = DISTILL_PACKAGE.getData(pkgId, "openings") || {};
    var opTokens = estTokens(JSON.stringify(openings));
    breakdown.openings = opTokens;
    total += opTokens;
  }catch(e){}

  return {total: total, breakdown: breakdown, cards: cards.length};
}

// 渲染进度条 (假设 128k 上下文)
function renderUsage(pkgId){
  var usage = calcUsage(pkgId);
  var maxTokens = 128000;  // 主流模型上下文
  var pct = Math.min(100, Math.round(usage.total / maxTokens * 100));
  var color = pct > 80 ? "#e74c3c" : pct > 50 ? "#f0ad4e" : "var(--gold)";

  var bd = usage.breakdown;
  var detail = Object.keys(bd).map(function(k){
    var labels = {cards: "角色卡", worldbook: "世界书", relations: "关系", openings: "开场白"};
    return (labels[k] || k) + ": " + bd[k].toLocaleString();
  }).join(" · ");

  return `<div class="card" style="margin-bottom:12px">
    <div style="font-size:calc(13px * var(--fs));font-weight:600;margin-bottom:8px">🧠 记忆用量</div>
    <div style="height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin-bottom:6px">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:4px"></div>
    </div>
    <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">
      约 ${usage.total.toLocaleString()} tokens (${pct}%) · ${usage.cards} 个角色<br>
      ${detail}
    </div>
  </div>`;
}

return {
  calcUsage: calcUsage,
  renderUsage: renderUsage,
  estTokens: estTokens
};
})();
