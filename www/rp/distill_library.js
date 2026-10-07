/* 作品资料库 (2026-10-07): 借鉴 TavernWeave build-work-library。
 * 理念: 资料库是原始事实集合，角色卡是从资料库"编译"出来的。
 * 人工可编辑资料库，编辑后重新编译角色卡。
 * 事实: {character, field, value, source, chunk_id, edited}
 * source: canon(原文实证) / ref(间接旁证) / inference(合理推断) / unknown(无依据)
 */
var DISTILL_LIBRARY = (function(){
"use strict";

// 获取某角色的全部事实
function getFacts(pkgId, charName){
  var prov = DISTILL_PACKAGE.getData(pkgId, "provenance");
  if(!prov || !prov.facts) return [];
  return prov.facts.filter(function(f){ return f.character === charName; });
}

// 按字段分组事实
function groupByField(facts){
  var groups = {};
  facts.forEach(function(f){
    if(!groups[f.field]) groups[f.field] = [];
    groups[f.field].push(f);
  });
  return groups;
}

// 编辑一条事实 (按 index)
function editFact(pkgId, charName, factIndex, newValue){
  var prov = DISTILL_PACKAGE.getData(pkgId, "provenance");
  if(!prov || !prov.facts) return false;
  var facts = prov.facts.filter(function(f){ return f.character === charName; });
  var target = facts[factIndex];
  if(!target) return false;
  // 找到原数组中的位置
  var idx = prov.facts.indexOf(target);
  prov.facts[idx] = {
    character: target.character,
    field: target.field,
    value: newValue,
    source: "inference",  // 人工编辑标记为推断
    chunk_id: target.chunk_id,
    edited: true,
    edited_at: Date.now()
  };
  DISTILL_PACKAGE.saveData(pkgId, "provenance", prov);
  return true;
}

// 删除一条事实
function deleteFact(pkgId, charName, factIndex){
  var prov = DISTILL_PACKAGE.getData(pkgId, "provenance");
  if(!prov || !prov.facts) return false;
  var facts = prov.facts.filter(function(f){ return f.character === charName; });
  var target = facts[factIndex];
  if(!target) return false;
  var idx = prov.facts.indexOf(target);
  prov.facts.splice(idx, 1);
  DISTILL_PACKAGE.saveData(pkgId, "provenance", prov);
  return true;
}

// 新增一条事实
function addFact(pkgId, charName, field, value, source){
  var prov = DISTILL_PACKAGE.getData(pkgId, "provenance");
  if(!prov) prov = {package: pkgId, built: Date.now(), facts: []};
  if(!prov.facts) prov.facts = [];
  prov.facts.push({
    character: charName,
    field: field,
    value: value,
    source: source || "inference",
    chunk_id: null,
    edited: true,
    edited_at: Date.now()
  });
  DISTILL_PACKAGE.saveData(pkgId, "provenance", prov);
  return true;
}

// 从资料库重新编译角色卡
// 逻辑: 同一字段的多条事实按 source 优先级合并 (canon > ref > inference > unknown)
function recompileCard(pkgId, charName){
  var facts = getFacts(pkgId, charName);
  if(!facts.length) throw new Error("没有事实数据");

  var groups = groupByField(facts);
  var priority = {canon: 4, ref: 3, inference: 2, unknown: 1};
  // 人工编辑过的事实优先 (用户明确修正过)
  function prio(f){ return (priority[f.source] || 0) + (f.edited ? 10 : 0); }

  var distill = {};
  Object.keys(groups).forEach(function(field){
    var fs = groups[field].sort(function(a, b){ return prio(b) - prio(a); });
    // 取最高优先级的事实，拼接同优先级的多条
    var top = prio(fs[0]);
    var vals = fs.filter(function(f){ return prio(f) === top; })
      .map(function(f){
        var v = f.value;
        // 保留来源标注
        if(f.chunk_id && v.indexOf(f.chunk_id) < 0){
          v += " [" + f.source + ":" + f.chunk_id + "]";
        } else if(v.indexOf("[" + f.source) < 0){
          v += " [" + f.source + "]";
        }
        return v;
      });
    distill[field] = vals.join("；");
  });

  var card = DISTILL_PACKAGE.getCharacterCard(pkgId, charName) || {name: charName};
  card._distill = distill;
  if(distill.core_identity) card.description = distill.core_identity;
  if(distill.core_traits) card.personality = distill.core_traits;
  DISTILL_PACKAGE.saveCharacterCard(pkgId, charName, card);

  return card;
}

// 资料库统计
function stats(pkgId){
  var prov = DISTILL_PACKAGE.getData(pkgId, "provenance");
  if(!prov || !prov.facts) return {total: 0, bySource: {}, edited: 0};
  var bySource = {};
  var edited = 0;
  prov.facts.forEach(function(f){
    bySource[f.source] = (bySource[f.source] || 0) + 1;
    if(f.edited) edited++;
  });
  return {total: prov.facts.length, bySource: bySource, edited: edited};
}

return {
  getFacts: getFacts,
  groupByField: groupByField,
  editFact: editFact,
  deleteFact: deleteFact,
  addFact: addFact,
  recompileCard: recompileCard,
  stats: stats
};
})();
