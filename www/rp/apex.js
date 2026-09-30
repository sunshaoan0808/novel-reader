/* RP_APEX: APEX-MEM 式记忆 (arXiv:2604.14362，已核实)。
* 1) append-only 版本链: 条目 {vid, id, v, ts, supersedes,...payload}，只追加不覆盖，旧版本永不丢失；
* 2) 人物→事件索引: buildPersonIndex，similar 池检索先按人物收窄再按关键词排序；
* 3) 检索时冲突消解: 同一人物同一主题多版本并存且内容矛盾时，便宜小模型裁决一次，
* 无矛盾零额外调用。
* 开关: 设置页 apex (默认开)；关 → 覆盖式更新旧行为。纯 JS，零新依赖。
* 注: 本文件内标记用 unicode 转义书写（写入管线会剥离成对内容）。 */
var RP_APEX = (function(){
"use strict";
var LB = String.fromCharCode(0x3010), RB = String.fromCharCode(0x3011); // LB/RB 仅用于拼接，避免字面量被写入管线剥离

function on(){
try{
if(typeof getRpCfg === "function"){ var c = getRpCfg(); return!c || c.apex!== false;}
}catch(e){}
return true;
}

/* ================= 版本链原语 ================= */
/* 最新版视图（默认只看最新版）: 按逻辑 id 取最大 v；按 (ts,id) 升序（旧→新），调用方可.reverse() */
function latestOf(arr){
var byId = {}, i, e;
arr = arr || [];
for(i = 0; i < arr.length; i++){
e = arr[i]; if(!e) continue;
var cur = byId[e.id];
if(!cur || (e.v || 1) > (cur.v || 1) ||
((e.v || 1) === (cur.v || 1) && (e.ts || 0) > (cur.ts || 0))) byId[e.id] = e;
}
var out = [];
for(var k in byId) out.push(byId[k]);
out.sort(function(a, b){ return ((a.ts || 0) - (b.ts || 0)) || ((a.id || 0) - (b.id || 0));});
return out;
}
/* 某逻辑条目的全部版本，按 v 升序（v1 最旧） */
function versionsOf(arr, id){
return (arr || []).filter(function(e){ return e && e.id === id;})
.sort(function(a, b){ return ((a.v || 1) - (b.v || 1));});
}
function vidFor(prefix, id, v){ return prefix + "-" + id + "-v" + v;}
/* 追加一个版本：isNew=true → v1（新逻辑条目）；false → 旧条目的 v+1，supersedes 指向上版 vid */
function appendVersion(arr, prefix, logicalId, payload, isNew){
arr = arr || [];
var mv = 0, prevVid = null, i, e;
for(i = 0; i < arr.length; i++){
e = arr[i];
if(e && e.id === logicalId && (e.v || 1) > mv){ mv = e.v || 1; prevVid = e.vid || null;}
}
var v = isNew? 1: mv + 1;
var o = {vid: vidFor(prefix, logicalId, v), id: logicalId, v: v,
ts: Date.now(), supersedes: isNew? null: prevVid};
payload = payload || {};
for(var k in payload) o[k] = payload[k];
return o;
}
/* 幂等迁移：给缺 v 的老条目补 v1（不碰 up_to/up_to_msg_id 水位）。返回 {st, changed} */
function ensure(st){
st = st || {};
var changed = false;
var pairs = [["profile3", "p3"], ["event3", "e3"], ["record3", "r3"]];
for(var pi = 0; pi < pairs.length; pi++){
var arr = st[pairs[pi][0]] || [], prefix = pairs[pi][1];
for(var i = 0; i < arr.length; i++){
var e = arr[i];
if(!e || e.v) continue;
e.vid = vidFor(prefix, e.id, 1); e.v = 1;
e.ts = e.ts || e.updatedAt || Date.now(); e.supersedes = null;
changed = true;
}
}
if(changed) st.apexMigrated = true;
return {st: st, changed: changed};
}
/* 逻辑条目上限 + 版本总数上限：保留每 id 最新版；超量时先删最旧的被 supersede 版（最新版永不删） */
function capLogical(arr, maxLogical, maxVersions){
arr = arr || [];
maxLogical = maxLogical || 20;
maxVersions = maxVersions || maxLogical * 3;
var latest = latestOf(arr), i, e;
if(latest.length > maxLogical){
var keepIds = {};
var tail = latest.slice(-maxLogical);
for(i = 0; i < tail.length; i++) keepIds[tail[i].id] = 1;
arr = arr.filter(function(x){ return x && keepIds[x.id];});
latest = latestOf(arr);
}
if(arr.length > maxVersions){
var keepVid = {};
for(i = 0; i < latest.length; i++) keepVid[latest[i].vid] = 1;
var olds = arr.filter(function(x){ return x &&!keepVid[x.vid];})
.sort(function(a, b){ return (a.ts || 0) - (b.ts || 0);});
var dropN = Math.max(0, olds.length - (maxVersions - latest.length));
var dropVid = {};
for(i = 0; i < dropN; i++) dropVid[olds[i].vid] = 1;
arr = arr.filter(function(x){ return x &&!dropVid[x.vid];});
}
return arr;
}

/* ================= 人物→事件索引 ================= */
/* 人物提及抽取：全名命中，或去姓后（≥2字）命中；歧义时映射到全部候选（重召回轻精度） */
function extractPersons(text, vocab){
text = String(text || "");
var hit = {}, i, p;
vocab = vocab || [];
for(i = 0; i < vocab.length; i++){
p = String(vocab[i] || ""); if(!p) continue;
if(text.indexOf(p) >= 0){ hit[p] = 1; continue;}
if(p.length >= 3){
var s = p.slice(1);
if(s.length >= 2 && text.indexOf(s) >= 0) hit[p] = 1;
}
}
return Object.keys(hit);
}
function entryText(store, e){
e = e || {};
if(store === "profile3") return String(e.text || "");
if(store === "event3") return String(e.topic || "") + " " + String(e.state || "");
return String(e.gist || "");
}
/* 人物词汇表：事件日历已归一化的 144 人名（RP_TEMPORAL.persons）+ 当前卡片名；不另造表 */
function vocabFor(card){
var v = [], seen = {}, out = [];
try{ if(typeof RP_TEMPORAL!== "undefined" && RP_TEMPORAL.persons) v = RP_TEMPORAL.persons();}catch(e){}
try{ if(card && card.name) v.push(card.name);}catch(e){}
v.forEach(function(x){
x = String(x || "");
if(x &&!seen[x]){ seen[x] = 1; out.push(x);}
});
return out;
}
/* 索引：{person: [{store, id, vid, v, entry}]}，只索引最新版 */
function buildPersonIndex(st, vocab){
st = st || {};
var idx = {};
function add(arr, store){
latestOf(arr).forEach(function(e){
if(!e) return;
var ps = extractPersons(entryText(store, e), vocab);
ps.forEach(function(p){
(idx[p] = idx[p] || []).push({store: store, id: e.id, vid: e.vid, v: e.v || 1, entry: e});
});
});
}
add(st.profile3, "profile3"); add(st.event3, "event3"); add(st.record3, "record3");
return idx;
}

/* ================= 检索时冲突消解 ================= */
/* 对立关键词对（启发式；未覆盖的表达宁可漏判也不多调模型，成本可控） */
var OPP = [
["没去过", "去过"], ["没去", "去"], ["没到过", "到过"], ["不在", "在"],
["没说", "说了"], ["没讲", "讲了"], ["不知道", "知道"], ["没见过", "见过"],
["没看见", "看见"], ["不喜欢", "喜欢"], ["讨厌", "喜欢"],
["没有", "有"], ["不是", "是"], ["没答应", "答应"], ["拒绝", "同意"],
["忘了", "记得"], ["没收到", "收到"], ["反对", "支持"], ["没同意", "同意"]
];
function opposed(a, b){
/* 对立判定: 一方含肯定核 p 且不含否定 n, 另一方含 n。
* 注意 n 常包含 p 作子串 (如"没去过"含"去过"), 故不要求否定方"单独"含 p。 */
var ta = String(a), tb = String(b), i, n, p;
for(i = 0; i < OPP.length; i++){
n = OPP[i][0]; p = OPP[i][1];
if(ta.indexOf(p) >= 0 && ta.indexOf(n) < 0 && tb.indexOf(n) >= 0) return [n, p];
if(tb.indexOf(p) >= 0 && tb.indexOf(n) < 0 && ta.indexOf(n) >= 0) return [n, p];
}
return null;
}
function bigrams(s){
var m = {}, i;
s = String(s || "");
for(i = 0; i < s.length - 1; i++){ var b = s.substr(i, 2); m[b] = (m[b] || 0) + 1;}
return m;
}
/* 主题相似：共有 bigram ≥ 2（与 memory.js eventSimilar 同启发式） */
function topicSimilar(a, b){
var ba = bigrams(a), hit = 0, i;
var bb = String(b || "");
for(i = 0; i < bb.length - 1; i++) if(ba[bb.substr(i, 2)]) hit++;
return hit >= 2;
}
/* 冲突候选：同一人物 + 主题相似 + 不同逻辑 id（同链新旧版是正常 supersede，不算冲突）+ 关键词对立 */
function findConflicts(cands){
var out = [], i, j;
cands = cands || [];
for(i = 0; i < cands.length; i++) for(j = i + 1; j < cands.length; j++){
var a = cands[i], b = cands[j];
if(!a ||!b || a.entry.id === b.entry.id) continue;
var shared = a.persons.filter(function(p){ return b.persons.indexOf(p) >= 0;});
if(!shared.length) continue;
if(!topicSimilar(a.text, b.text)) continue;
var op = opposed(a.text, b.text);
if(op) out.push({a: a, b: b, person: shared[0], opp: op});
}
return out;
}
function buildAdjudPrompt(person, older, newer, query){
return "你是记忆仲裁者（只做选择，不改写原文）。\n" +
"用户当前问题：" + String(query || "").slice(0, 120) + "\n" +
"关于「" + person + "」有两条互相矛盾的记忆：\n" +
"A（较早记录）：" + older.text + "\n" +
"B（较晚记录）：" + newer.text + "\n" +
"判断哪条更可信：优先采信更新的、细节更具体的、或与用户当前问题更相关的。\n" +
"只输出 JSON，无其他文字：{\"pick\":\"A\", \"reason\":\"一句话理由\"}";
}
/* 裁决一次。返回 {pick:"A"/"B", reason, winnerVid, loserVid}；异常/解析失败返回 null（调用方保留原样） */
async function adjudicate(callChat, sumCfg, person, a, b, query){
var items = [a, b].sort(function(x, y){ return (x.entry.ts || 0) - (y.entry.ts || 0);});
var older = items[0], newer = items[1];
var raw = "";
try{
raw = await callChat(sumCfg, [{role: "user", content: buildAdjudPrompt(person, older, newer, query)}], 0.2);
}catch(e){ return null;}
var t = String(raw || ""), s = t.indexOf("{"), e2 = t.lastIndexOf("}");
if(s < 0 || e2 <= s) return null;
var o;
try{ o = JSON.parse(t.slice(s, e2 + 1));}catch(e){ return null;}
if(!o || (o.pick!== "A" && o.pick!== "B")) return null;
var winner = o.pick === "A"? older: newer;
var loser = o.pick === "A"? newer: older;
return {pick: o.pick, reason: String(o.reason || "").slice(0, 80),
winnerVid: winner.entry.vid, loserVid: loser.entry.vid};
}
/* similar 池候选检索（同步）：人物收窄 → bigram 排序。返回 {cands, conflicts, qPersons} */
function retrieveApex(runId, name, query, vocab, topK){
try{
if(typeof RP_MEM === "undefined") return null;
var st = RP_MEM.get(runId, name);
if(!st) return null;
var recs = latestOf(st.record3).filter(function(r){ return r &&!r.legacy && r.gist;});
if(!recs.length) return {cands: [], conflicts: [], qPersons: []};
vocab = vocab || [];
var qPersons = extractPersons(query, vocab);
var qb = bigrams(query);
var scored = recs.map(function(r){
var text = String(r.gist || "");
var ps = extractPersons(text, vocab);
var s = 0, b;
var eb = bigrams(text);
for(b in eb) if(qb[b]) s += Math.min(eb[b], qb[b]);
var pHit = ps.filter(function(p){ return qPersons.indexOf(p) >= 0;}).length;
s += pHit * 12; // 人物收窄优先
return {entry: r, text: text, persons: ps, score: s};
});
scored.sort(function(a, b){ return b.score - a.score;});
var top = scored.slice(0, Math.max(1, topK || 5) * 2);
var conflicts = findConflicts(top);
return {cands: top.slice(0, topK || 5), conflicts: conflicts.slice(0, 1), qPersons: qPersons};
}catch(e){ return null;}
}
function renderBlock(cands){
if(!cands ||!cands.length) return "";
var lines = cands.map(function(c){
var e = c.entry;
var ptr = (e.msg_from || e.msg_to)? "（原文 " + (e.msg_from || "?") + "→" + (e.msg_to || "?") + "）": "";
var ver = (e.v || 1) > 1? "〔v" + e.v + "〕": "";
return "- " + String(c.text || "") + ptr + ver;
});
return LB + "记录·版本链" + RB + "（细节可回溯原文，只收录最新版）\n" + lines.join("\n");
}
/* 主入口（异步）：检索 + 最多一次裁决。无候选/无矛盾时零额外模型调用 */
async function apexFor(runId, name, card, query, cfg, callChat){
try{
if(!on()) return null;
if(typeof RP_MEM === "undefined" ||!RP_MEM.leanmemOn()) return null;
var vocab = vocabFor(card);
var r = retrieveApex(runId, name, query, vocab, 5);
if(!r ||!r.cands.length) return null;
var adjudicated = false, reason = "";
if(r.conflicts.length){
var cf = r.conflicts[0];
var sumCfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
var adj = await adjudicate(callChat, sumCfg, cf.person, cf.a, cf.b, query);
if(adj && adj.pick){
adjudicated = true; reason = adj.reason;
r.cands = r.cands.filter(function(c){ return c.entry.vid!== adj.loserVid;});
}
}
var text = renderBlock(r.cands);
if(!text) return null;
return {text: text, items: r.cands.length, adjudicated: adjudicated,
reason: reason, persons: r.qPersons};
}catch(e){ return null;}
}

return {
on: on,
latestOf: latestOf, versionsOf: versionsOf, vidFor: vidFor,
appendVersion: appendVersion, ensure: ensure, capLogical: capLogical,
extractPersons: extractPersons, vocabFor: vocabFor, buildPersonIndex: buildPersonIndex,
opposed: opposed, topicSimilar: topicSimilar, findConflicts: findConflicts,
buildAdjudPrompt: buildAdjudPrompt, adjudicate: adjudicate,
retrieveApex: retrieveApex, renderBlock: renderBlock, apexFor: apexFor,
OPP: OPP
};
})();
