/* App 端别名消解 (2026-10-07): 移植自 novel-distill/novel_distill/alias.py。
 * BookNLP name_coref 中文适配: 别名表全字优先 > 头衔停用 > 有序子串索引
 * > 子集消除 > 频率+近度裁决。歧义走 LLM 裁决。
 */
var DISTILL_ALIAS = (function(){
"use strict";

var COMPOUND_SURNAMES = ["欧阳","司马","上官","诸葛","皇甫","尉迟","公孙","轩辕",
  "令狐","钟离","宇文","长孙","慕容","鲜于","闾丘","司徒","司空","夏侯","端木","南宫"];

var GENERIC_TITLES = ["夫人","太太","奶奶","爷","老爷","少爷","小姐","姑娘",
  "大人","将军","丞相","王爷","皇上","娘娘","公子","先生","师父","师傅","大哥",
  "二哥","大姐","妹妹","哥哥","弟弟","姐姐","父亲","母亲","爹","娘"];

function splitSurname(name){
  if(name.length >= 3 && COMPOUND_SURNAMES.indexOf(name.slice(0, 2)) >= 0)
    return [name.slice(0, 2), name.slice(2)];
  return [name.slice(0, 1), name.slice(1)];
}

function prefixAliasOk(alias, target){
  if(!alias || !target || alias.length < 2 || target.length < 2) return true;
  var sa = splitSurname(alias), st = splitSurname(target);
  if(sa[0] !== st[0] || !sa[1] || !st[1]) return true;
  return sa[1].indexOf(st[1]) >= 0 || st[1].indexOf(sa[1]) >= 0 ||
         alias.indexOf(target) >= 0 || target.indexOf(alias) >= 0;
}

function buildSubpartIndex(knownNames, minLen){
  minLen = minLen || 2;
  var index = {};
  knownNames.forEach(function(name){
    var n = name.length;
    for(var i = 0; i < n; i++){
      for(var j = i + minLen; j <= n; j++){
        var s = name.slice(i, j);
        if(s === name) continue;
        if(!index[s]) index[s] = [];
        if(index[s].indexOf(name) < 0) index[s].push(name);
      }
    }
  });
  return index;
}

function canonStats(chunks, knownNames){
  var stats = {};
  chunks.forEach(function(ch, ci){
    var text = ch.text;
    knownNames.forEach(function(name){
      var c = text.split(name).length - 1;
      if(c){
        var prev = stats[name] || [0, -1, -1];
        stats[name] = [prev[0] + c, ci, text.lastIndexOf(name)];
      }
    });
  });
  return stats;
}

function tiebreakKey(canon, stats){
  var s = stats[canon] || [0, -1, -1];
  return [s[1], s[2], s[0]]; // 近度主导
}

function isJunkAlias(alias){
  return /^[\d\s]+$/.test(alias) || alias.length < 2;
}

function independentHits(chunks, surface, knownNames){
  // 子集消除: surface 只在正名内部出现则不单独成实体
  var total = 0, ev = [];
  chunks.forEach(function(ch){
    var text = ch.text;
    var idx = 0, count = 0;
    while((idx = text.indexOf(surface, idx)) >= 0){
      // 检查是否被更长的正名包含
      var contained = knownNames.some(function(n){
        return n !== surface && n.indexOf(surface) >= 0 &&
               text.slice(Math.max(0, idx - 4), idx + surface.length + 4).indexOf(n) >= 0;
      });
      if(!contained){
        count++;
        if(ev.length < 3) ev.push(ch.id + "@" + idx);
      }
      idx += surface.length;
    }
    total += count;
  });
  return [total, ev];
}

function booknlpCluster(chunks, knownNames, table, blocked, log){
  log = log || function(){};
  blocked = blocked || [];
  var known = {};
  knownNames.forEach(function(n){ known[n] = true; });
  var direct = {}, cands = {};
  // 1. 别名表全字优先
  Object.keys(table || {}).forEach(function(alias){
    var canon = table[alias];
    if(blocked.indexOf(alias) >= 0 || alias === canon) return;
    direct[alias] = canon;
  });
  // 2/3. 有序子串索引 + 头衔停用 + 子集消除
  var index = buildSubpartIndex(knownNames);
  var stats = canonStats(chunks, knownNames);
  Object.keys(index).sort().forEach(function(surface){
    var canons = index[surface];
    if(blocked.indexOf(surface) >= 0 || known[surface] || direct[surface]) return;
    if(GENERIC_TITLES.indexOf(surface) >= 0) return;
    if(isJunkAlias(surface)) return;
    var hits = independentHits(chunks, surface, knownNames);
    if(hits[0] === 0) return;
    if(canons.length === 1){
      direct[surface] = canons[0];
    }else{
      var kept = canons.filter(function(c){ return prefixAliasOk(surface, c); });
      if(kept.length === 0) return;
      if(kept.length === 1){
        direct[surface] = kept[0];
        return;
      }
      // 频率+近度裁决
      var winner = kept[0], bestKey = tiebreakKey(kept[0], stats);
      kept.slice(1).forEach(function(c){
        var k = tiebreakKey(c, stats);
        if(k[0] > bestKey[0] || (k[0] === bestKey[0] && (k[1] > bestKey[1] || (k[1] === bestKey[1] && k[2] > bestKey[2])))){
          winner = c; bestKey = k;
        }
      });
      cands[surface] = {target: winner, targets: kept.slice().sort(), evidence: hits[1], rule: "booknlp:subpart+ambig"};
    }
  });
  if(Object.keys(direct).length) log("[alias] 直接合并 " + Object.keys(direct).length + " 条");
  return {direct: direct, cands: cands};
}

async function judgeAmbiguous(cands, chunks, onProgress){
  // LLM 裁决歧义项
  var results = {};
  var keys = Object.keys(cands);
  for(var i = 0; i < keys.length; i++){
    var alias = keys[i];
    var cand = cands[alias];
    if(onProgress) onProgress(i + 1, keys.length, "裁决别名 " + alias);
    try{
      var r = await DISTILL_LLM.chat([
        {role: "system", content: "你是别名裁决器。判断别名指代哪个人物，返回 JSON: {\"canonical\": \"正名\", \"conf\": 0-10}"},
        {role: "user", content: JSON.stringify({alias: alias, candidates: cand.targets, evidence: cand.evidence})}
      ]);
      var m = r.content.match(/\{[^}]+\}/);
      if(m){
        var d = JSON.parse(m[0]);
        if(d.conf >= 8 && d.canonical) results[alias] = d.canonical;
      }
    }catch(e){}
  }
  return results;
}

return {
  booknlpCluster: booknlpCluster,
  judgeAmbiguous: judgeAmbiguous,
  prefixAliasOk: prefixAliasOk,
  GENERIC_TITLES: GENERIC_TITLES
};
})();
