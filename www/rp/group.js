/* 群聊 v2：对标 SillyTavern Natural Order
 *
 * 发言调度（每轮可 1-3 人依次发言）：
 *   1. 点名：用户消息里出现成员名（全名，或去姓简称≥2字且不重名）→ 被点名者优先发言
 *   2. 未被点名的成员按 talkativeness(0-100, 默认50) 逐人 roll 点激活
 *      0%=Shy（除非被点名否则不主动说），100%=Chatty（必说）
 *   3. 无人激活 → 随机兜底（尽量不连庄）
 * 排序策略（群维度可配）：
 *   natural（默认）：点名优先 + talkativeness 激活
 *   list：按成员列表顺序轮流，一轮一人
 * 手动点名（抽屉点名字 / @名字）在任何策略下都优先。
 */
const RP_GROUP = (function(){
"use strict";

var MAX_SPEAKERS = 3;

function lsGet(k){
  try{
    if(typeof localStorage === "undefined") return null;
    return localStorage.getItem(k);
  }catch(e){ return null; }
}
function lsSet(k, v){
  try{
    if(typeof localStorage === "undefined") return;
    localStorage.setItem(k, v);
  }catch(e){}
}

/* ---- talkativeness（发言欲 0-100，默认 50） ---- */
function talkKey(runId, name){ return "nd_talk_" + runId + "_" + name; }
function getTalk(runId, name){
  var v = parseInt(lsGet(talkKey(runId, name)), 10);
  return isNaN(v) ? 50 : Math.max(0, Math.min(100, v));
}
function setTalk(runId, name, v){
  v = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
  lsSet(talkKey(runId, name), String(v));
}
function talkMapFor(runId, members){
  var m = {};
  (members || []).forEach(function(n){ m[n] = getTalk(runId, n); });
  return m;
}

/* ---- 排序策略（群维度） ---- */
function orderKey(runId, gkey){ return "nd_gorder_" + runId + "_" + gkey; }
function getOrder(runId, gkey){
  return lsGet(orderKey(runId, gkey)) || "natural";
}
function setOrder(runId, gkey, v){
  lsSet(orderKey(runId, gkey), (v === "list") ? "list" : "natural");
}

/* ---- 点名检测：全名命中，或去姓简称（≥2字且不重名） ---- */
function findMentioned(userText, members){
  if(!userText) return [];
  var out = [], i;
  for(i = 0; i < members.length; i++){
    if(userText.indexOf(members[i]) !== -1) out.push(members[i]);
  }
  if(out.length) return out;
  for(i = 0; i < members.length; i++){
    var short = members[i].length > 1 ? members[i].slice(1) : members[i];
    if(short.length < 2) continue;
    if(userText.indexOf(short) === -1) continue;
    var clash = members.some(function(m, j){
      return j !== i && m.slice(1).indexOf(short) !== -1;
    });
    if(!clash) out.push(members[i]);
  }
  return out;
}

/* ---- Natural Order：一轮的发言人序列（点名优先，其次 talkativeness roll） ---- */
function planSpeakers(userText, members, talkMap, lastSpeaker, opts){
  opts = opts || {};
  var maxN = opts.maxSpeakers || MAX_SPEAKERS;
  talkMap = talkMap || {};
  var speakers = findMentioned(userText, members).slice(0, maxN);
  var i, m, t;
  if(speakers.length < maxN){
    for(i = 0; i < members.length && speakers.length < maxN; i++){
      m = members[i];
      if(speakers.indexOf(m) !== -1) continue;
      t = talkMap[m];
      t = (t == null) ? 50 : Math.max(0, Math.min(100, t));
      if(Math.random() * 100 < t) speakers.push(m);
    }
  }
  if(!speakers.length){
    // 随机兜底：尽量不连庄
    var pool = members.filter(function(x){ return x !== lastSpeaker; });
    if(!pool.length) pool = members.slice();
    if(pool.length) speakers.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return speakers;
}

/* ---- List Order：按成员顺序轮流，一轮一人 ---- */
function nextInList(members, lastSpeaker){
  if(!members || !members.length) return null;
  var idx = members.indexOf(lastSpeaker);
  return members[(idx + 1) % members.length];
}

/* ---- 旧接口：单发言人（兼容保留） ---- */
function pickSpeaker(userText, members, talkMap, lastSpeaker){
  var s = planSpeakers(userText, members, talkMap, lastSpeaker, {maxSpeakers: 1});
  return s.length ? s[0] : null;
}

/* ---- 角色关系设定（对标 Talkie "Add a Relationship": "X is Y's …" 句式） ----
 * 存储: nd_grel_<runId>_<gkey> = [{a, b, rel}]，渲染为 "A是B的rel" 注入群聊 prompt */
function relKey(runId, gkey){ return "nd_grel_" + runId + "_" + gkey; }
function getRels(runId, gkey){
  try{
    var v = JSON.parse(lsGet(relKey(runId, gkey)) || "[]");
    return Array.isArray(v) ? v.filter(function(r){ return r && r.a && r.b && r.rel; }) : [];
  }catch(e){ return []; }
}
function saveRels(runId, gkey, rels){
  lsSet(relKey(runId, gkey), JSON.stringify(rels || []));
}
/* 解析建群时的关系文本：每行 "A是B的C"，返回 {ok:[{a,b,rel}], bad:行数} */
function parseRelLines(text, members){
  var ok = [], bad = 0;
  String(text || "").split(/\n/).forEach(function(line){
    line = String(line).trim();
    if(!line) return;
    var m = line.match(/^(.+?)是(.+?)的(.+)$/);
    if(!m){ bad++; return; }
    var a = m[1].trim(), b = m[2].trim(), rel = m[3].trim();
    if(!a || !b || !rel){ bad++; return; }
    if(members && members.length && (members.indexOf(a) < 0 || members.indexOf(b) < 0)){ bad++; return; }
    ok.push({a: a, b: b, rel: rel});
  });
  return {ok: ok, bad: bad};
}
function addRel(runId, gkey, a, b, rel){
  if(!a || !b || !rel) return false;
  var rels = getRels(runId, gkey);
  rels.push({a: a, b: b, rel: rel});
  saveRels(runId, gkey, rels);
  return true;
}
function delRel(runId, gkey, idx){
  var rels = getRels(runId, gkey);
  if(idx < 0 || idx >= rels.length) return false;
  rels.splice(idx, 1);
  saveRels(runId, gkey, rels);
  return true;
}
/* 渲染成 prompt 文本："A是B的rel"，每行一条；空返回 "" */
function renderRels(runId, gkey){
  return getRels(runId, gkey).map(function(r){ return r.a + "是" + r.b + "的" + r.rel; }).join("\n");
}

/* 成员一句话简介（从人设卡字段取） */
function memberBrief(card){
var f = (card && card.fields) || {};
var t = f.core_identity || f.soul_goal || "";
t = String(t).replace(/\s+/g, " ").slice(0, 42);
return (card? card.name: "?") + "：" + (t || "在场人物");
}

/* 群聊 post-history 指令：只许以活跃角色身份说话 */
function groupPostInstructions(active, others, pov, person){
  pov = pov || "player"; person = person || "second";
  var s = "现在是群聊，你正在扮演" + active + "与玩家对话。";
  if(pov === "char")
    s += "叙事以" + active + "为中心：可深入描写" + active + "的所见所感、内心活动与行动。";
  else
    s += "叙事以玩家为中心：镜头跟随玩家，" + active + "通过对话、神态与行动来回应玩家，不要写大段" + active + "的内心独白喧宾夺主。";
  if(person === "first")
    s += "人称：第一人称，" + active + "以“我”自称进行叙事与对话；用“你”指代玩家。";
  else if(person === "third")
    s += "人称：第三人称叙事，以“" + active + "”或“他/她”指代" + active + "；用“你”指代玩家。";
  else
    s += "人称：第二人称叙事，以“你”指代玩家；叙事部分不要用“我”指代玩家——每条消息已有" + active + "的署名标识，不必反复自报家门，避免“我”泛滥出戏。";
  s += "绝不替在场其他人（" + others.join("、") + "）说话或行动，绝不自称其他人；"
    + "绝不自称 AI/模型/程序；可以用符合人设的方式直接称呼在场人物；回复简洁自然。";
  return s;
}

return {
pickSpeaker: pickSpeaker,
planSpeakers: planSpeakers,
findMentioned: findMentioned,
nextInList: nextInList,
getTalk: getTalk,
setTalk: setTalk,
talkMapFor: talkMapFor,
getOrder: getOrder,
setOrder: setOrder,
getRels: getRels,
saveRels: saveRels,
addRel: addRel,
delRel: delRel,
renderRels: renderRels,
parseRelLines: parseRelLines,
memberBrief: memberBrief,
groupPostInstructions: groupPostInstructions,
MAX_SPEAKERS: MAX_SPEAKERS,
};
})();
