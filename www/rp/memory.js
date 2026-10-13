/* RP 引擎 v2 记忆管理 (v2: 借鉴 RUBY Step7-10 的三层记忆设计)
* 状态: {mood:{state,filter}, short:[{id,time,fact,view}], long:"", up_to, updatedAt}
* - 心境 mood: 每周期从最新剧情定性, 注入 prompt 并给记忆"染色"
* - 短期 short: 最多 30 条, 每条 {时间, 主观事实, 此刻看法}; 心情变化时可改写"此刻看法"(反刍)
* - 长远 long: 队列挤出的旧记忆压成的模糊印象, 保留人脑式失真感
* 闭环: 读取上次输出 -> 更新 -> 输出完整新状态 (输出即下次输入)
* 分析失败绝不打断聊天, 下次周期重试。
*/
const RP_MEM = (function(){
"use strict";
var memKey = function(r, n){ return "nd_mem2_" + r + "_" + n;};
var SHORT_MAX = 30;

function get(runId, name){
try { return JSON.parse(localStorage.getItem(memKey(runId, name))) || null;}
catch(e){ return null;}
}
function save(runId, name, m){
try { localStorage.setItem(memKey(runId, name), JSON.stringify(m));}
catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("长期记忆保存失败", e); }
}
function clear(runId, name){
try { localStorage.removeItem(memKey(runId, name));} catch(e){}
}
function cycle(){
try {
var rc = JSON.parse(localStorage.getItem("nd_rp_cfg_v1") || "{}");
return Math.max(5, parseInt(rc.memCycle) || 10);
} catch(e){ return 10;}
}

/* 单条记忆格式化 */
function fmtItem(m){
var s = "- " + (m.time? m.time + " ": "") + (m.fact || "");
if(m.view) s += "【此刻看法: " + m.view + "】";
return s;
}

/* token 估算 (与 RP_PROMPT.estTokens 同公式: 1 汉字 ≈ 1.6 token) */
function estTokens(s){
s = String(s || "");
var zh = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
var en = (s.match(/[A-Za-z]+/g) || []).length;
var rest = Math.max(0, s.length - zh - en * 4);
return Math.ceil(zh * 1.6 + en * 1.3 + rest * 0.5);
}

/* P0-1: 三池预算比例 (近期/长远/重要), 设置页 nd_rp_cfg_v1.memPoolRatio 可调, 默认 "50/30/20" */
function memPoolRatio(){
try {
var rc = JSON.parse(localStorage.getItem("nd_rp_cfg_v1") || "{}");
var s = String(rc.memPoolRatio || "50/30/20");
var p = s.split("/").map(function(x){ return parseInt(x, 10); });
if(p.length === 3 && p.every(function(x){ return x >= 0 && isFinite(x); }) && (p[0] + p[1] + p[2]) > 0)
return {recent: p[0], similar: p[1], important: p[2]};
} catch(e){}
return {recent: 50, similar: 30, important: 20};
}

/* ============ LeanMem 三库记忆 (arXiv:2608.03463): 按可压缩性/时间动态/保真要求分流 ============
 * profile3: 稳定事实 [{id, text, updatedAt, fromPin}] 上限 20, 只追加/覆盖, 极少变更
 * event3: 带时间锚事件 [{id, topic, t_anchor, state, merged, updatedAt}] 上限 40,
 *         唯一允许跨周期"演化合并"的库 (同类 topic 合并成 temporal state)
 * record3: 轻量 gist + 原文指针 [{id, gist, msg_from, msg_to, legacy}] 上限 60, 只追加不改写
 * 开关: 设置页 leanmem (默认开); getRpCfg 不存在时(老测试上下文)走旧三池路径。 */
var PROFILE3_MAX = 20, EVENT3_MAX = 40, RECORD3_MAX = 60;
/* 第 3 项 (Talkie memory_profile_*): event3 可选结构化字段; profile3 relationship 段 */
var EVENT_STRUCT_FIELDS = ["location", "participants", "agreements", "type", "status",
  "emotionalTone", "attitudeToUser", "relationshipImpact"];
var REL_FIELDS = ["stage", "boundaries", "type", "communicationPreferences", "currentLocation"];
/* 第 4 项 (C.AI Facts): 自动事实分类 + 总量上限(字) */
var FACT_CATS = ["外貌", "怪癖", "关系", "偏好", "其他"];
var FACTS_MAX_CHARS = 2000;
function pickStructFields(src, fields, maxLen){
  var r = null;
  (fields || []).forEach(function(k){
    var v = String((src && src[k]) || "").trim().slice(0, maxLen || 80);
    if(v){ (r = r || {})[k] = v; }
  });
  return r;
}
/* 合并结构化字段: 新值只填旧值的空位, 不覆盖已有 */
function mergeStructFields(dst, src, fields){
  if(!src) return;
  (fields || []).forEach(function(k){ if(!dst[k] && src[k]) dst[k] = src[k]; });
}
/* profile3 条目是否为 Facts (自动/手动事实), 区别于稳定事实 */
function isFactEntry(p){ return !!(p && p.fact); }
function factsOf(st){
  var p3 = (st && st.profile3) || [];
  return p3.filter(isFactEntry);
}
function factsChars(st){
  var n = 0;
  factsOf(st).forEach(function(p){ n += String(p.text || "").length; });
  return n;
}
function getFacts(st){
  var fs = factsOf(st);
  return {auto: fs.filter(function(f){ return f.auto; }),
          manual: fs.filter(function(f){ return !f.auto; })};
}
function leanmemOn(){
try{
if(typeof getRpCfg !== "function") return false; // 老测试上下文: 保持旧行为
var c = getRpCfg();
return !c || c.leanmem !== false;
}catch(e){ return false; }
}
/* LeanMem Adaptive Evidence Composition: 按用户问题类型自适应调三池权重 (纯关键词启发式)。
 * 问人设/偏好 -> important 加权; 问过去/时间线 -> recent 加权; 问细节/原话 -> similar 加权。 */
function leanRatio(query, base){
var wI = 1, wR = 1, wS = 1;
var q = String(query || "");
if(q){
if(/你是谁|你的名字|你叫什么|你的性格|性格|你喜欢|喜欢|讨厌|喜好|偏好|人设|我是谁|我的名字|记住我|了解你/.test(q)) wI = 2.2;
else if(/之前|以前|那次|那天|当时|后来|然后|发生|记得|什么时候|时间线|经过|昨天|前天|上次/.test(q)) wR = 2.2;
else if(/原话|怎么说|具体|详细|复述|哪一句|原文|一字|细节|说过什么/.test(q)) wS = 2.2;
}
return {important: base.important * wI, recent: base.recent * wR, similar: base.similar * wS};
}
function nextStoreId(arr){
var m = 0;
(arr || []).forEach(function(x){ if(x && x.id > m) m = x.id; });
return m + 1;
}
/* 纯函数: 从旧 short/long 种子化三库 (不写盘)。pinned -> profile3(fromPin 标记, 展示仍在置顶区);
 * 未置顶 short -> event3; long -> record3 (legacy 标记, similar 池仍走旧"占位"渲染)。 */
function seedStores(st){
st = st || {};
var profile3 = [], event3 = [], record3 = [];
var shorts = Array.isArray(st.short) ? st.short : [];
shorts.forEach(function(m){
if(!m) return;
if(m.pin){
profile3.push({id: nextStoreId(profile3), fromPin: true,
text: String(m.fact || m.view || "").slice(0, 120), updatedAt: Date.now()});
}else{
event3.push({id: nextStoreId(event3), topic: String(m.fact || "").slice(0, 40),
t_anchor: String(m.time || ""), state: String(m.view || m.fact || "").slice(0, 120),
updatedAt: Date.now()});
}
});
var lg = String(st.long || "");
if(lg) record3.push({id: 1, gist: lg.slice(0, 120), msg_from: null, msg_to: null, legacy: true});
st.profile3 = profile3; st.event3 = event3; st.record3 = record3;
st.migrated3 = true;
return st;
}
/* 一次性迁移 (幂等): seedStores + 落盘。不碰 up_to / up_to_msg_id 水位。 */
function migrate3(runId, name, st){
st = st || {};
if(st.migrated3) return st;
seedStores(st);
save(runId, name, st);
return st;
}
/* 事件同类判定: topic 共有 bigram >= 2 则视为同类 (启发式, 演化合并用) */
function eventSimilar(a, topicB){
var ba = {}, i, ta = String((a && a.topic) || "");
for(i = 0; i < ta.length - 1; i++) ba[ta.substr(i, 2)] = 1;
var tb = String(topicB || ""), hit = 0;
for(i = 0; i < tb.length - 1; i++) if(ba[tb.substr(i, 2)]) hit++;
return hit >= 2;
}
/* LeanMem Controlled Writing: 分流输出 profile/event/record; 低信息量周期直接 drop。 */
function buildAnalysisPrompt3(name, cardHint, st, newMsgs){
st = st || {};
var prev = {profile: st.profile3 || [], event: st.event3 || [], record: st.record3 || []};
return "你是" + name + "的记忆整理者(LeanMem 分流整理)。" + (cardHint ? "人物速写: " + cardHint + "\n" : "") +
"上次整理后的三库状态(JSON, 已截断):\n" + JSON.stringify(prev).slice(0, 4000) + "\n\n" +
"自上次整理以来的新对话:\n" + newMsgs + "\n\n" +
"【第一阶段·内部思考, 禁止输出】\n" +
"1. 过滤: 寒暄(你好/在吗/嗯嗯)、重复、纯表情、无实质信息的轮次直接丢弃, 不记。\n" +
"2. 分流: 剩下的内容按三库归类——\n" +
"   profile 库: 稳定事实(喜好/习惯/身份/与\"我\"的关系进展等), 极少变化, 只写新增或变化的;\n" +
"   facts 自动事实: 本周期新出现的、值得长期记住的细节事实(外貌/怪癖/关系/偏好), 每条带 cat 分类(外貌|怪癖|关系|偏好|其他), 只写新增, 不要重复已有的;\n" +
"   event 库: 发生的事, 写成 topic(10-20字)+t_anchor(相对时间如\"今晚\")+state(30-60字当时状态/结果), 另有可选结构化字段 location/participants/agreements/type/status/emotionalTone/attitudeToUser/relationshipImpact;\n" +
"   每条 event 再打类型标签 kind, 四选一: 事件/心情/关系/初见(初次见面或第一印象→初见, 情绪状态→心情, 与某人关系变化→关系, 其他→事件);\n" +
"   record 库: 值得回溯原文的细节, 一句话 gist(如关键原话、数字、承诺)。\n" +
"3. 心境: 定性" + name + "此刻的心境(1-2个词)+50-100字此刻看世界的滤镜。\n" +
"【第二阶段·唯一输出】: 只输出一个 JSON, 无其他文字:\n" +
'{"drop":false,"mood":{"state":"1-2个词","filter":"50-100字"},' +
'"profile":["新增稳定事实, 无则[]"],' +
'"facts":[{"text":"…","cat":"外貌|怪癖|关系|偏好|其他"}],' +
'"event":[{"topic":"…","t_anchor":"…","state":"…","kind":"事件/心情/关系/初见","location":"…","participants":"…","agreements":"…","type":"…","status":"…","emotionalTone":"…","attitudeToUser":"…","relationshipImpact":"…"}],' +
'"record":["…gist…"]}。' +
"\nprofile 里关系类事实可写成对象: {\"text\":\"…\",\"relationship\":{\"stage\":\"关系阶段\",\"boundaries\":\"关系边界\",\"type\":\"关系类型\",\"communicationPreferences\":\"沟通偏好\",\"currentLocation\":\"当前位置\"}}。" +
"\nevent 结构化字段、facts、relationship 缺失留空字符串或缺省, 不要编造; 无新增则对应数组为 []。" +
"\n若本周期全是低信息量内容(寒暄/重复/无实质), 只输出 {\"drop\":true}。";
}
/* LeanMem 解析: drop -> 三库不动(水位照常推进); 新格式 -> 分流写入;
 * 旧格式(short/long) -> 走旧 parseState 再种子化 (兼容)。msgRange={from,to} 回填 record 指针。 */
function parseState3(raw, prev, msgRange){
prev = prev || {};
if(!prev.migrated3) prev = seedStores(prev);
var t = String(raw || "").replace(/```json|```/g, "");
var a = t.indexOf("{"), b = t.lastIndexOf("}");
if(a < 0 || b <= a) return null;
var o;
try { o = JSON.parse(t.slice(a, b + 1)); } catch(e){ return null; }
if(!o || typeof o !== "object") return null;
var isOld = Array.isArray(o.short) && !o.profile && !o.event && !o.record && !("drop" in o);
if(isOld){
var base = parseState(raw, prev); // 旧格式兼容 (short/long/mood)
if(base) return seedStores(base);
return null;
}
var p3 = (prev.profile3 || []).slice(), e3 = (prev.event3 || []).slice(), r3 = (prev.record3 || []).slice();
var apexW = (typeof RP_APEX !== "undefined") && RP_APEX.on(); // APEX-MEM: 开则只追加版本, 关则覆盖式旧行为
/* appendVersion 会把 payload 的字段盖到版本对象上, id 必须走 logicalId 参数, 故剥掉 */
function p3payload(rec){ var o = {}; for(var k in rec) if(k !== "id") o[k] = rec[k]; return o; }
if(!o.drop){
/* profile: 只追加/覆盖 (新条目包含旧条目或反之 -> 替换, 否则追加);
 * 条目可为字符串或 {text, relationship} 对象 (第 3 项: relationship 段 stage/boundaries/type/communicationPreferences/currentLocation) */
(o.profile || []).forEach(function(it){
var tx, rel = null;
if(it && typeof it === "object"){ tx = String(it.text || "").slice(0, 120); rel = pickStructFields(it.relationship, REL_FIELDS, 60); }
else tx = String(it || "").slice(0, 120);
if(!tx) return;
var found = -1;
for(var i = 0; i < p3.length; i++){
var e = String(p3[i].text || "");
if(e && (e.indexOf(tx) >= 0 || tx.indexOf(e) >= 0)){ found = i; break; }
}
function p3rec(base, isNew){
var rec = {id: base.id, fromPin: !!base.fromPin, text: tx, updatedAt: Date.now()};
var oldRel = pickStructFields(base.relationship, REL_FIELDS, 60);
var nr = oldRel || rel ? {} : null;
if(nr){ if(oldRel) for(var k in oldRel) nr[k] = oldRel[k];
if(rel) for(var k2 in rel) nr[k2] = rel[k2];
rec.relationship = nr; }
return rec;
}
if(apexW){
if(found >= 0){ var _nr = p3rec(p3[found], false);
p3.push(RP_APEX.appendVersion(p3, "p3", _nr.id, p3payload(_nr), false)); }
else { var _nid = nextStoreId(p3), _nr2 = p3rec({id: _nid}, true);
p3.push(RP_APEX.appendVersion(p3, "p3", _nid, p3payload(_nr2), true)); }
}else{
if(found >= 0){ var keepId = p3[found].id, keepPin = p3[found].fromPin; p3[found] = p3rec({id: keepId, fromPin: keepPin, relationship: p3[found].relationship}, false); }
else p3.push(p3rec({id: nextStoreId(p3)}, true));
}
});
/* facts 自动区 (第 4 项): maybeAnalyze 抽取的细节事实, 带 cat 分类; 老 profile3 条目无 fact 标记, 读取容错 */
var _fc = factsChars({profile3: p3});
(o.facts || []).forEach(function(f){
if(!f) return;
var tx = String(f.text || "").trim().slice(0, 120);
if(!tx) return;
var cat = FACT_CATS.indexOf(f.cat) >= 0 ? f.cat : "其他";
var dup = false;
for(var i = 0; i < p3.length; i++){
var e = String(p3[i].text || "");
if(e && (e.indexOf(tx) >= 0 || tx.indexOf(e) >= 0)){ dup = true; break; }
}
if(dup) return;
if(_fc + tx.length > FACTS_MAX_CHARS) return; /* 自动抽取超限静默跳过, 不挤掉已有 */
_fc += tx.length;
var nid = nextStoreId(p3);
var rec = {id: nid, text: tx, cat: cat, fact: true, auto: true, updatedAt: Date.now()};
if(apexW) p3.push(RP_APEX.appendVersion(p3, "p3", nid, p3payload(rec), true));
else p3.push(rec);
});
p3 = apexW ? RP_APEX.capLogical(p3, PROFILE3_MAX) : p3.slice(-PROFILE3_MAX);
/* event: 演化合并 —— 只有 event 库允许跨周期合并, profile/record 不动;
 * 第 3 项: 可选结构化字段 location/participants/agreements/type/status/emotionalTone/attitudeToUser/relationshipImpact,
 * 老数据缺字段为 undefined, 读取容错, 不迁移 */
(o.event || []).forEach(function(ev){
if(!ev) return;
var topic = String(ev.topic || "").slice(0, 40), ta = String(ev.t_anchor || "").slice(0, 20);
var state = String(ev.state || "").slice(0, 120);
var kind = normKind(ev.kind); /* #14 分型标签 */
var sf = pickStructFields(ev, EVENT_STRUCT_FIELDS, 80);
if(!topic && !state) return;
var m = null;
for(var i = 0; i < e3.length; i++) if(eventSimilar(e3[i], topic)){ m = e3[i]; break; }
if(m){
var ns = ((m.state ? m.state + "；" : "") + state).slice(0, 200);
var mg = {topic: m.topic, t_anchor: m.t_anchor || ta, state: ns, merged: (m.merged || 1) + 1, kind: kind || m.kind || ""};
mergeStructFields(mg, pickStructFields(m, EVENT_STRUCT_FIELDS, 80), EVENT_STRUCT_FIELDS);
mergeStructFields(mg, sf, EVENT_STRUCT_FIELDS);
if(apexW) e3.push(RP_APEX.appendVersion(e3, "e3", m.id, mg, false));
else { for(var k in mg) m[k] = mg[k]; m.updatedAt = Date.now(); }
}else{
var nid = nextStoreId(e3);
var ne = {topic: topic, t_anchor: ta, state: state, kind: kind, updatedAt: Date.now()};
if(sf) for(var k2 in sf) ne[k2] = sf[k2];
if(apexW) e3.push(RP_APEX.appendVersion(e3, "e3", nid, ne, true));
else { ne.id = nid; e3.push(ne); }
}
});
e3 = apexW ? RP_APEX.capLogical(pruneEvents(e3, EVENT3_MAX), EVENT3_MAX) /* #10 永久条目不参与剪枝 */
: pruneEvents(e3, EVENT3_MAX);
/* record: 只追加不改写 */
(o.record || []).forEach(function(g){
g = String(g || "").slice(0, 120);
if(!g) return;
if(apexW) r3.push(RP_APEX.appendVersion(r3, "r3", nextStoreId(r3), {gist: g,
msg_from: (msgRange && msgRange.from) || null, msg_to: (msgRange && msgRange.to) || null}, true));
else r3.push({id: nextStoreId(r3), gist: g,
msg_from: (msgRange && msgRange.from) || null, msg_to: (msgRange && msgRange.to) || null});
});
r3 = apexW ? RP_APEX.capLogical(r3, RECORD3_MAX) : r3.slice(-RECORD3_MAX);
}
var mood = (o.mood && o.mood.state) ? {state: String(o.mood.state).slice(0, 30),
filter: String(o.mood.filter || "").slice(0, 150)} : (prev.mood || null);
if(apexW){ // 保证返回状态的每条目都有版本戳 (种子条目无写入时也补 v1)
var _e3 = RP_APEX.ensure({profile3: p3, event3: e3, record3: r3});
p3 = _e3.st.profile3; e3 = _e3.st.event3; r3 = _e3.st.record3;
}
return {mood: mood, short: prev.short || [], long: prev.long || "",
profile3: p3, event3: e3, record3: r3, migrated3: true, updatedAt: Date.now()};
}

/* P0-2: 铁律记忆 (S-8: 400 -> 2000 字常驻框, 对标 Nomi Shared Notes): 按角色卡维度 nd_ironlaw_<cardId>, cardId 取不到则 runId_name */
var IRONLAW_MAX = 2000;
function ironKey(runId, name, cardId){
return "nd_ironlaw_" + (cardId || ((runId || "") + "_" + (name || "")));
}
function getIronLaw(runId, name, cardId){
try { return String(localStorage.getItem(ironKey(runId, name, cardId)) || ""); }
catch(e){ return ""; }
}
function saveIronLaw(runId, name, cardId, text){
var raw = String(text || "");
var truncated = raw.length > IRONLAW_MAX;
var t = truncated ? raw.slice(0, IRONLAW_MAX) : raw;
try { localStorage.setItem(ironKey(runId, name, cardId), t); } catch(e){}
return {saved: t, truncated: truncated, len: t.length};
}

/* 借鉴清单 Tier2 #11: 本聊摘要手写框 (Janitor "Enter a summary for your chat. This will be
 * included into the prompt as long-term memory."): 按聊天存, important 池最高优先级 (排在铁律之前)。 */
var CHATSUM_MAX = 1000;
function sumKey(runId, name){ return "nd_chatsum_" + (runId || "") + "_" + (name || ""); }
function getChatSummary(runId, name){
try { return String(localStorage.getItem(sumKey(runId, name)) || ""); }
catch(e){ return ""; }
}
function saveChatSummary(runId, name, text){
var raw = String(text || "");
var truncated = raw.length > CHATSUM_MAX;
var t = truncated ? raw.slice(0, CHATSUM_MAX) : raw;
try { localStorage.setItem(sumKey(runId, name), t); } catch(e){}
return {saved: t, truncated: truncated, len: t.length};
}

/* 借鉴清单 Tier2 #10: 永久记忆 (Talkie permanent memory)。event3 条目 perm 标记:
 * important 池置顶、不参与剪枝; 上限 PERM_MAX, 达上限用 Talkie 原文 toast。 */
var PERM_MAX = 20;
function permLimitMsg(){ return "The selected events have reached the upper limit"; }
function eventPermCount(runId, name){
var st = get(runId, name);
var ids = {}, n = 0;
((st && st.event3) || []).forEach(function(e){
if(e && e.perm && !ids[e.id]){ ids[e.id] = 1; n++; }
});
return n;
}
function setEventPerm(runId, name, id, perm){
var st = get(runId, name);
if(!st || !st.event3) return false;
var apexW = leanmemOn() && (typeof RP_APEX !== "undefined") && RP_APEX.on();
var latest = apexW ? RP_APEX.latestOf(st.event3) : st.event3;
var hit = null;
latest.forEach(function(e){ if(e && e.id == id) hit = e; });
if(!hit) return false;
if(!!hit.perm === !!perm) return true;
if(perm && eventPermCount(runId, name) >= PERM_MAX) return "limit";
if(apexW){
var base = {};
for(var k in hit) base[k] = hit[k];
base.perm = !!perm;
st.event3.push(RP_APEX.appendVersion(st.event3, "e3", hit.id, base, false));
}else{
hit.perm = !!perm; hit.updatedAt = Date.now();
}
save(runId, name, st);
return true;
}
/* 事件剪枝: 永久条目优先保留, 其余按新→旧填满 EVENT3_MAX (apex 路径保留被选 id 的全部版本) */
function pruneEvents(arr, max){
arr = arr || [];
max = max || EVENT3_MAX;
var apexW = leanmemOn() && (typeof RP_APEX !== "undefined") && RP_APEX.on();
var latest = apexW ? RP_APEX.latestOf(arr) : arr.slice();
var perms = latest.filter(function(e){ return e && e.perm; });
var rest = latest.filter(function(e){ return e && !e.perm; });
var keepN = Math.min(max, perms.length + rest.length);
var keepRest = keepN > perms.length ? rest.slice(-(keepN - perms.length)) : [];
var keepIds = {};
perms.concat(keepRest).forEach(function(e){ keepIds[e.id] = 1; });
return arr.filter(function(e){ return e && keepIds[e.id]; });
}

/* 借鉴清单 Tier2 #12: 新聊天记忆窗口 (Janitor "Set New Chat Memory window. Lower if you get errors.")。
 * 控制单次 prompt 注入的记忆总条数; 老测试上下文 (无 getRpCfg) 走默认不收紧。 */
var MEMWIN_DEFAULT = 60;
function memWindowN(){
try{
if(typeof getRpCfg !== "function") return MEMWIN_DEFAULT;
var c = getRpCfg();
var n = parseInt(c && c.memWindowN, 10);
if(isFinite(n) && n > 0) return n;
}catch(e){}
return MEMWIN_DEFAULT;
}
/* 记忆窗口裁剪: 总条数超限时按 important > recent > similar 优先级, 从末段整段裁掉 */
function applyMemWindow(pools, secLists){
var winN = memWindowN();
var total = secLists.important.n + secLists.recent.n + secLists.similar.n;
pools.windowN = winN;
pools.windowDropped = 0;
if(winN <= 0 || total <= winN) return;
var over = total - winN;
var order = ["similar", "recent", "important"];
for(var oi = 0; oi < order.length && over > 0; oi++){
var key = order[oi], sl = secLists[key];
while(over > 0 && sl.secs.length){
var last = sl.secs[sl.secs.length - 1];
if(!last.items || last.items > over) break; /* 粒度到整段, 不切半段 */
sl.secs.pop();
sl.n -= last.items; over -= last.items;
pools[key].items -= last.items;
pools[key].tokens = Math.max(0, pools[key].tokens - estTokens(last.text));
pools[key].windowDropped = (pools[key].windowDropped || 0) + last.items;
pools.windowDropped += last.items;
}
}
}

/* 借鉴清单 Tier2 #14: 事件分型标签 (对标星野记忆 card kind: 日记/羁绊/心情/MBTI/第一印象) */
var EVENT_KINDS = ["事件", "心情", "关系", "初见"];
function normKind(k){
k = String(k || "").trim();
return EVENT_KINDS.indexOf(k) >= 0 ? k : "";
}
function kindLabel(e){
return (e && e.kind && EVENT_KINDS.indexOf(e.kind) >= 0) ? e.kind : "事件";
}

/* 借鉴清单 Tier2 #13: 消息是否已进入记忆 (摘要水位内 / record 原文指针区间 / 版本链) */
function msgInMemory(runId, name, msg, history){
var st = get(runId, name) || {};
history = history || [];
var mid = msg && (msg.mid || msg.id);
var inSummary = false, inChain = false;
if(mid && history.length){
var water = -1, mi = -1, i;
for(i = 0; i < history.length; i++){
var hmid = history[i] && (history[i].mid || history[i].id);
if(st.up_to_msg_id && hmid === st.up_to_msg_id) water = i;
if(hmid === mid) mi = i;
}
inSummary = mi >= 0 && water >= 0 && mi <= water;
var recs = (st.record3 || []).filter(function(r){ return r && !r.legacy; });
for(var j = 0; j < recs.length && !inChain; j++){
var r = recs[j], fi = -1, ti = -1;
for(var k = 0; k < history.length; k++){
var km = history[k] && (history[k].mid || history[k].id);
if(r.msg_from && km === r.msg_from) fi = k;
if(r.msg_to && km === r.msg_to) ti = k;
}
if(fi >= 0 && ti >= 0 && mi >= fi && mi <= ti) inChain = true;
}
}
return {inMemory: inSummary || inChain, inSummary: inSummary, inChain: inChain};
}
function delAskText(){
return "这条消息已进入聊天记忆(摘要/版本链)。删掉它也会影响记忆——要一起清除记忆，还是只删消息？";
}

/* 借鉴清单 Tier2 #19: 记忆快照状态机 (对标猫箱 BotMemorySnapshot{GeneratePlan,RetryGenerate,SyncGenerate}) */
function memStatusKey(runId, name){ return "nd_memstatus_" + (runId || "") + "_" + (name || ""); }
function getMemStatus(runId, name){
try{
var v = JSON.parse(localStorage.getItem(memStatusKey(runId, name)) || "null");
if(v && (v.state === "running" || v.state === "done" || v.state === "fail")) return v;
}catch(e){}
return {state: "idle", at: 0};
}
function setMemStatus(runId, name, state){
try{ localStorage.setItem(memStatusKey(runId, name), JSON.stringify({state: state, at: Date.now()})); }catch(e){}
}
function memStatusLine(runId, name){
var s = getMemStatus(runId, name);
if(s.state === "running") return {state: "running", text: "记忆生成中…"};
if(s.state === "fail") return {state: "fail", text: "记忆生成失败，点我重试"};
if(s.state === "done" && s.at){
var d = new Date(s.at);
var hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
return {state: "done", text: "记忆已更新 " + hh + ":" + mm};
}
return {state: "idle", text: ""};
}

/* 按 token 预算截断一段文本 */
function truncText(s, maxTokens){
s = String(s || "");
if(estTokens(s) <= maxTokens) return s;
var approx = Math.max(1, Math.floor(maxTokens / 1.6));
return s.slice(0, approx) + "…";
}

/* P0-1: 三池记忆预算渲染 (RisuAI 三池思想)。
 * 分池: important = 铁律+置顶+心境 (永不整段丢弃, 超预算按优先级 铁律>置顶新→旧>心境 截断);
 *       recent = 未置顶短期 (新→旧, 按条丢弃); similar = 长远印象 (占位, 超预算截断/整段丢弃)。
 * 返回 {text, pools:{important:{tokens,items,dropped}, recent:{...}, similar:{...}}} */
function renderBudgeted(runId, name, budgetTokens, opts){
opts = opts || {};
budgetTokens = Math.max(0, Math.floor(budgetTokens || 0));
var st = get(runId, name) || {};
var lean = leanmemOn();
if(lean) st = migrate3(runId, name, st); // 幂等迁移: 老 short/long 进三库, 不丢水位
var apex = lean && (typeof RP_APEX !== "undefined") && RP_APEX.on();
if(apex){ var _ae = RP_APEX.ensure(st); st = _ae.st; if(_ae.changed) save(runId, name, st); }
/* APEX-MEM: 展示默认只看最新版 (旧版本保留在版本链里, 事件簿可展开查看) */
var P3 = apex ? RP_APEX.latestOf(st.profile3) : (st.profile3 || []);
var E3 = apex ? RP_APEX.latestOf(st.event3) : (st.event3 || []);
var R3 = apex ? RP_APEX.latestOf(st.record3) : (st.record3 || []);
var iron = getIronLaw(runId, name, opts.cardId);
var short = (st.short || []).slice();
var pinned = short.filter(function(m){ return m.pin; }).reverse();  // 新→旧
var rest = short.filter(function(m){ return !m.pin; }).reverse();    // 新→旧
var mood = (st.mood && st.mood.state) ? st.mood : null;
var long = String(st.long || "");

var ratio = lean ? leanRatio(opts.query, memPoolRatio()) : memPoolRatio(); // LeanMem 自适应组装
var sum = ratio.recent + ratio.similar + ratio.important;
var bImp = Math.floor(budgetTokens * ratio.important / sum);
var bRec = Math.floor(budgetTokens * ratio.recent / sum);
var bSim = budgetTokens - bImp - bRec;

var pools = {
important: {tokens: 0, items: 0, dropped: 0},
recent: {tokens: 0, items: 0, dropped: 0},
similar: {tokens: 0, items: 0, dropped: 0},
};

/* ---- 分池段收集 (#12 记忆窗口按 important > recent > similar 优先级裁条数) ---- */
var secLists = {important: {secs: [], n: 0}, recent: {secs: [], n: 0}, similar: {secs: [], n: 0}};
/* S-4 召回指示器: 记录每段命中的标签(取【】标题), 供气泡 🧠 角标展示"这次想起了什么" */
var hitLabels = [];
function pushSec(pool, text, items){
if(!text) return;
secLists[pool].secs.push({text: text, items: items || 0});
secLists[pool].n += (items || 0);
var hm = String(text).match(/【([^】]{1,12})】/);
if(hm) hitLabels.push({pool: pool, label: hm[1], items: items || 0});
}

/* ---- important 池: 本聊摘要 > 铁律 > 永久记忆 > 置顶(新→旧) > 画像库 > 心境; 永不整段丢弃 ---- */
var sumSec = "", ironSec = "", pinLines = [], moodSec = "", profLines = [], permLines = [];
var chatSum = getChatSummary(runId, name);
var impLeft = bImp;
if(budgetTokens > 0 && (chatSum || iron || pinned.length || mood || (lean && (P3.length || E3.length)))){
if(impLeft <= 0) impLeft = Math.min(budgetTokens, 200); // 再小也要保住铁律
var addImp = function(kind, text, mustKeep){
var need = estTokens(text);
if(need <= impLeft){
impLeft -= need; pools.important.tokens += need; pools.important.items++;
return text;
}
if(mustKeep || impLeft > 8){
/* 铁律永不丢: 预算再小也截断塞入, 上限放宽到整段预算 */
var cap = mustKeep ? Math.max(impLeft, Math.min(budgetTokens, 200)) : impLeft;
var cut = truncText(text, cap);
impLeft = 0; pools.important.tokens += estTokens(cut); pools.important.items++;
return cut;
}
pools.important.dropped++;
return "";
};
if(iron) ironSec = addImp("iron", "【铁律记忆】\n" + iron, true);
/* #11 本聊摘要: 最高优先级, 永不丢 (排在铁律之前) */
if(chatSum) sumSec = addImp("chatsum", "【本聊摘要】\n" + chatSum, true);
/* #10 永久记忆: important 池置顶、不参与剪枝 */
if(lean){
var eperm = E3.filter(function(e){ return e && e.perm; }).reverse(); /* 新→旧 */
for(var ei = 0; ei < eperm.length; ei++){
var ex = eperm[ei];
var pt = "- " + (ex.t_anchor ? ex.t_anchor + " " : "") + String(ex.topic || "") +
(ex.state ? "——" + ex.state : "") + " 【永久】";
var pl2 = addImp("perm", pt, false);
if(pl2) permLines.push(pl2);
}
}
for(var pi = 0; pi < pinned.length; pi++){
var pl = addImp("pin", fmtItem(pinned[pi]), false);
if(pl) pinLines.push(pl);
}
/* LeanMem: profile 库 (稳定事实) 进 important 池; fromPin 的已在置顶区展示, 跳过 */
if(lean){
var p3arr = P3;
for(var qi = 0; qi < p3arr.length; qi++){
if(p3arr[qi].fromPin) continue;
var ql = addImp("profile", "- " + String(p3arr[qi].text || ""), false);
if(ql) profLines.push(ql);
}
}
if(mood){
var mt = "【当前心境】" + mood.state + (mood.filter ? "——" + mood.filter : "");
moodSec = addImp("mood", mt, false);
}
}
if(sumSec) pushSec("important", sumSec, 1); /* #11 本聊摘要最高优先级 */
if(ironSec) pushSec("important", ironSec, 1);
if(permLines.length) /* #10 永久记忆置顶 */
pushSec("important", "【永久记忆】(手动挑选，不参与剪枝)\n" + permLines.join("\n"), permLines.length);
if(pinLines.length)
pushSec("important", "【置顶记忆】(永不遗忘, 回答时优先参考)\n" + pinLines.join("\n"), pinLines.length);
if(profLines.length){
pushSec("important", "【画像记忆】(稳定事实)\n" + profLines.join("\n"), profLines.length);
pools.important.store = "profile库";
}
if(moodSec) pushSec("important", moodSec, 1);

/* ---- recent 池: LeanMem 开 -> event 库 (新→旧, 按条丢弃); 关 -> 未置顶短期 ---- */
var recLines = [], recLeft = bRec;
if(lean && E3.length){
pools.recent.store = "event库";
var evSrc = E3.slice().reverse(); // 新→旧
for(var rei = 0; rei < evSrc.length; rei++){
var evx = evSrc[rei];
var et = "- " + (evx.t_anchor ? evx.t_anchor + " " : "") + String(evx.topic || "") +
(evx.state ? "——" + evx.state : "");
var en = estTokens(et);
if(en <= recLeft){ recLines.push(et); recLeft -= en;
pools.recent.tokens += en; pools.recent.items++; }
else pools.recent.dropped++;
}
if(recLines.length) pushSec("recent", "【事件】(新→旧)\n" + recLines.join("\n"), recLines.length);
}else{
for(var ri = 0; ri < rest.length; ri++){
var rt = fmtItem(rest[ri]);
var rn = estTokens(rt);
if(rn <= recLeft){ recLines.push(rt); recLeft -= rn;
pools.recent.tokens += rn; pools.recent.items++; }
else pools.recent.dropped++;
}
if(recLines.length) pushSec("recent", "【近期记忆】(新→旧)\n" + recLines.join("\n"), recLines.length);
}

/* ---- similar 池: 时序感知检索（Chronos 思路）优先，退化为长远印象占位 ---- */
var simLeft = bSim;
var tInfo = (opts.temporal && opts.temporal.text) ? opts.temporal : null;
if(tInfo){
pools.similar.source = "时序切片";
var tt = tInfo.text, tn = estTokens(tt);
if(tn <= simLeft){ pushSec("similar", tt, tInfo.items || 0); pools.similar.tokens = tn; pools.similar.items = tInfo.items || 0; }
else if(simLeft >= 20){
var tc = truncText(tt, simLeft);
pushSec("similar", tc, tInfo.items || 0); pools.similar.tokens = estTokens(tc); pools.similar.items = tInfo.items || 0;
}
else pools.similar.dropped = 1;
}
else if(long){
pools.similar.source = "占位";
var lt = "【长远印象】" + long;
var ln = estTokens(lt);
if(ln <= simLeft){ pushSec("similar", lt, 1); pools.similar.tokens = ln; pools.similar.items = 1; }
else if(simLeft >= 20){
var st2 = truncText(lt, simLeft);
pushSec("similar", st2, 1); pools.similar.tokens = estTokens(st2); pools.similar.items = 1;
}
else pools.similar.dropped = 1;
}

/* LeanMem: record 库 (gist + 原文指针) 补进 similar 池剩余预算, 只追加不改写;
 * legacy 种子(由旧 long 迁移)不单独渲染, 仍走上面的"占位"路径。
 * APEX-MEM: chat.js 的 apexFor 已做人物收窄 + 检索时冲突消解, 这里直接渲染干净版本。 */
var apexBlock = (apex && opts.apex && opts.apex.text) ? opts.apex : null;
if(apexBlock){
pools.similar.source = (tInfo ? "时序切片+" : "") + "记录库·版本链";
var abn = estTokens(apexBlock.text);
if(abn <= simLeft){
pushSec("similar", apexBlock.text, apexBlock.items || 0); pools.similar.tokens += abn; pools.similar.items += (apexBlock.items || 0);
}else if(simLeft >= 20){
var abc = truncText(apexBlock.text, simLeft);
pushSec("similar", abc, apexBlock.items || 0); pools.similar.tokens += estTokens(abc); pools.similar.items += (apexBlock.items || 0);
}else pools.similar.dropped++;
if(apexBlock.adjudicated){ pools.similar.adjudicated = true; pools.similar.adjudReason = apexBlock.reason || ""; }
}
if(lean && !apexBlock){
var rec3src = R3.filter(function(r){ return r && !r.legacy; }).reverse(); // 新→旧
if(rec3src.length){
var gLeft = bSim - pools.similar.tokens;
var gLines = [];
for(var gi = 0; gi < rec3src.length; gi++){
var gr = rec3src[gi];
var gt = "- " + String(gr.gist || "") +
((gr.msg_from || gr.msg_to) ? "（原文 " + (gr.msg_from || "?") + "→" + (gr.msg_to || "?") + ")" : "");
var gn = estTokens(gt);
if(gn <= gLeft){ gLines.push(gt); gLeft -= gn;
pools.similar.tokens += gn; pools.similar.items++; }
else pools.similar.dropped++;
}
if(gLines.length){
pushSec("similar", (tInfo ? "" : "【记录】(细节可回溯原文)\n") + gLines.join("\n"), gLines.length);
pools.similar.source = tInfo ? "时序切片+record库" : "record库";
}
}
}

pools.ratio = {important: bImp, recent: bRec, similar: bSim}; // 自适应后的实际预算, 供 Inspector/测试
applyMemWindow(pools, secLists); /* #12 新聊天记忆窗口裁剪 */
var secs = [];
["important", "recent", "similar"].forEach(function(pk){
secLists[pk].secs.forEach(function(s){ secs.push(s.text); });
});
return {text: secs.join("\n"), pools: pools, hits: hitLabels};
}

/* 状态渲染成 prompt 段 (置顶记忆优先, 永不遗忘) [遗留路径: prompt.js 无 RP_MEM.renderBudgeted 时的兜底] */
function renderPrompt(st){
if(!st) return "";
var out = "";
if(st.mood && st.mood.state){
out += "【当前心境】" + st.mood.state;
if(st.mood.filter) out += "——" + st.mood.filter;
out += "\n";
}
if(st.short && st.short.length){
var pinned = st.short.filter(function(m){ return m.pin; });
var rest = st.short.filter(function(m){ return !m.pin; });
if(pinned.length)
out += "【置顶记忆】(永不遗忘, 回答时优先参考)\n" + pinned.map(fmtItem).join("\n") + "\n";
if(rest.length)
out += "【近期记忆】(旧→新)\n" + rest.map(fmtItem).join("\n") + "\n";
}
if(st.long) out += "【长远印象】" + st.long + "\n";
return out;
}

/* 分析 prompt: 两阶段 (思考链禁输出 + 唯一 JSON 输出) */
function buildAnalysisPrompt(name, cardHint, st, newMsgs){
var prev = st? JSON.stringify({mood: st.mood, short: st.short, long: st.long}): "无(第一次整理)";
return "你是" + name + "的记忆整理者。" + (cardHint? "人物速写: " + cardHint + "\n": "") +
"上次整理后的记忆状态(JSON):\n" + prev + "\n\n" +
"自上次整理以来的新对话:\n" + newMsgs + "\n\n" +
"请按两阶段工作。\n" +
"第一阶段【内部思考, 禁止输出】:\n" +
"1. 定性" + name + "此刻的心境: 核心情绪是什么? 这种情绪让 TA 戴上什么颜色的眼镜看世界?\n" +
"2. 新事件: 对话里有什么值得记的事? 即使没有大事, 微小的心理波动也要记。用" + name + "的主观口吻写事实。\n" +
"3. 反刍: 结合此刻心境, 旧记忆的\"此刻看法\"有没有该改写的? (如之前觉得是冷淡, 现在觉得是害羞)\n" +
"4. 挤压: short 加上新事件若超过 " + SHORT_MAX + " 条, 最旧的几条核心情感是什么? 压成一段模糊的、感性的长印象。\n" +
"第二阶段【唯一输出内容】: 只输出一个 JSON, 无其他文字:\n" +
'{"mood":{"state":"1-2 个词, 如 隐秘的甜蜜","filter":"50-100 字, 此刻 TA 怎么看世界"},' +
'"short":[{"id":1,"time":"相对时间如 那次雨天","fact":"30-50 字主观事实","view":"30-50 字此刻看法，可空"}],' +
'"long":"200-300 字长远模糊印象, 允许失真感, 如记不清具体哪天"}' +
"\nshort 最多 " + SHORT_MAX + " 条, 按时间从旧到新, id 递增延续。";
}

function parseState(raw, prev){
if(!raw) return null;
var t = raw.replace(/```json|```/g, "");
var a = t.indexOf("{"), b = t.lastIndexOf("}");
if(a < 0 || b <= a) return null;
var o;
try { o = JSON.parse(t.slice(a, b + 1));} catch(e){ return null;}
if(!o || typeof o!== "object") return null;
var short = Array.isArray(o.short)? o.short.filter(function(m){
return m && (m.fact || m.view);
}).map(function(m, i){
return {id: m.id || (i + 1), time: m.time || "", ts: Date.now(), fact: String(m.fact || "").slice(0, 120),
view: String(m.view || "").slice(0, 120)};
}): [];
var long = String(o.long || "").slice(0, 800);
// 保留上一轮的 pin: 按 id 回填 (LLM 输出的 id 递增延续)
var pinById = {};
if(prev && prev.short) prev.short.forEach(function(m){ if(m && m.pin) pinById[m.id] = true; });
short = short.map(function(m){ if(pinById[m.id]) m.pin = true; return m; });
// 防御: 超过上限时把最旧的挤进 long
if(short.length > SHORT_MAX){
var drop = short.slice(0, short.length - SHORT_MAX);
short = short.slice(-SHORT_MAX);
var squeeze = drop.map(function(m){ return m.fact;}).join(";");
long = (long? long + "\n": "") + "[更早] " + squeeze.slice(0, 400);
}
var mood = (o.mood && o.mood.state)? {state: String(o.mood.state).slice(0, 30),
filter: String(o.mood.filter || "").slice(0, 150)}: ((prev && prev.mood) || null);
return {mood: mood, short: short, long: long, updatedAt: Date.now()};
}

/* 每周期跑一次分析。返回 {analyzed}。
 * P0-4: 水位改 msg_id 制 (up_to_msg_id): 新消息 = 该 id 之后的消息;
 * 老 up_to(索引) 做一次性迁移; delMsg/历史裁剪后水位不错位。 */
async function maybeAnalyze(runId, name, history, cfg, callChat, cardHint){
var st = get(runId, name);
var lean = leanmemOn();
if(lean) st = migrate3(runId, name, st); // 幂等迁移, 先保证三库存在; 不丢水位
if(lean && (typeof RP_APEX !== "undefined") && RP_APEX.on()){
var _ae2 = RP_APEX.ensure(st); st = _ae2.st; if(_ae2.changed) save(runId, name, st);
}
var upId = (st && st.up_to_msg_id) || null;
var idx = 0;
if(upId){
idx = -1;
for(var f = 0; f < history.length; f++){
var fmid = history[f] && (history[f].mid || history[f].id);
if(fmid === upId){ idx = f + 1; break; }
}
if(idx < 0) idx = Math.min((st && st.up_to) || 0, history.length); // 水位消息被删: 回退旧索引水位
} else {
idx = Math.min((st && st.up_to) || 0, history.length); // 老状态一次性迁移
}
if(history.length - idx < cycle()) return {analyzed: false};
var newMsgs = history.slice(idx).map(function(m){
return (m.role === "user"? "我": (m.speaker || name)) + ": " + String(m.content).slice(0, 300);
}).join("\n").slice(0, 8000);
if(!newMsgs.trim()) return {analyzed: false};
var sumCfg = {base: cfg.base, key: cfg.key, model: cfg.summaryModel || cfg.model};
/* LeanMem: record 指针 = 本周期新消息的 msg_id 区间 */
var msgRange = null;
if(lean && history.length){
var _f = history[idx], _l = history[history.length - 1];
msgRange = {from: (_f && (_f.mid || _f.id)) || null, to: (_l && (_l.mid || _l.id)) || null};
}
var raw = "";
setMemStatus(runId, name, "running"); /* #19 记忆快照状态机: 开始生成 */
try {
raw = await callChat(sumCfg, [
{role: "user", content: lean ? buildAnalysisPrompt3(name, cardHint, st, newMsgs)
: buildAnalysisPrompt(name, cardHint, st, newMsgs)},
], 0.3);
} catch(e){ setMemStatus(runId, name, "fail"); return {analyzed: false};} // 失败: 不打断, 下次重试
var next = lean ? parseState3(raw, st, msgRange) : parseState(raw, st);
if(!next){ setMemStatus(runId, name, "fail"); return {analyzed: false}; }
var lastM = history[history.length - 1];
next.up_to = history.length;
next.up_to_msg_id = (lastM && (lastM.mid || lastM.id)) || upId || null;
save(runId, name, next);
setMemStatus(runId, name, "done");
return {analyzed: true};
}

/* 置顶/取消置顶一条记忆 (按 id, 宽松比较) */
function togglePin(runId, name, id){
var st = get(runId, name);
if(!st || !st.short) return null;
var cur = null;
st.short.forEach(function(m){ if(m.id == id){ m.pin = !m.pin; cur = !!m.pin; } });
if(cur !== null) save(runId, name, st);
return cur;
}
/* 删除一条记忆 */
function delItem(runId, name, id){
var st = get(runId, name);
if(!st || !st.short) return false;
var n0 = st.short.length;
st.short = st.short.filter(function(m){ return m.id != id; });
if(st.short.length === n0) return false;
save(runId, name, st);
return true;
}
/* v36: 编辑一条自动记忆（事实/看法/时间）。P0 要求事件簿条目可编辑，之前只有删除。 */
function editItem(runId, name, id, opt){
var st = get(runId, name);
if(!st || !st.short) return {ok: false, err: "none"};
var cur = null;
st.short.forEach(function(m){ if(m && m.id == id) cur = m; });
if(!cur) return {ok: false, err: "none"};
var fact = String((opt && opt.fact) || "").trim().slice(0, 500);
if(!fact) return {ok: false, err: "empty"};
cur.fact = fact;
if(opt && opt.view !== undefined) cur.view = String(opt.view).trim().slice(0, 200);
if(opt && opt.time !== undefined) cur.time = String(opt.time).trim().slice(0, 40);
cur.updatedAt = Date.now();
save(runId, name, st);
return {ok: true};
}

/* 第 4 项 Facts 手动区: 增/改/删 (自动区由 maybeAnalyze 写入)。总量 FACTS_MAX_CHARS 字, 超限返回 over。 */
function _apexW(){ return (typeof RP_APEX !== "undefined") && RP_APEX.on(); }
function addFact(runId, name, opt){
var st = get(runId, name);
if(leanmemOn()) st = migrate3(runId, name, st);
var text = String((opt && opt.text) || "").trim().slice(0, 120);
if(!text) return {ok: false, err: "empty"};
var cat = FACT_CATS.indexOf(opt && opt.cat) >= 0 ? opt.cat : "其他";
if(factsChars(st) + text.length > FACTS_MAX_CHARS) return {ok: false, err: "over"};
var p3 = (st.profile3 || []).slice();
var nid = nextStoreId(p3);
if(_apexW()) p3.push(RP_APEX.appendVersion(p3, "p3", nid,
{text: text, cat: cat, fact: true, auto: false, updatedAt: Date.now()}, true));
else p3.push({id: nid, text: text, cat: cat, fact: true, auto: false, updatedAt: Date.now()});
p3 = _apexW() ? RP_APEX.capLogical(p3, PROFILE3_MAX) : p3.slice(-PROFILE3_MAX);
st.profile3 = p3;
save(runId, name, st);
return {ok: true, id: nid};
}
function editFact(runId, name, id, opt){
var st = get(runId, name);
if(!st || !st.profile3) return {ok: false, err: "none"};
var list = _apexW() ? RP_APEX.latestOf(st.profile3) : st.profile3;
var cur = null, i;
for(i = 0; i < list.length; i++) if(list[i] && list[i].id == id && list[i].fact){ cur = list[i]; break; }
if(!cur) return {ok: false, err: "none"};
var text = String((opt && opt.text) || "").trim().slice(0, 120);
if(!text) return {ok: false, err: "empty"};
var cat = FACT_CATS.indexOf(opt && opt.cat) >= 0 ? opt.cat : "其他";
if(factsChars(st) - String(cur.text || "").length + text.length > FACTS_MAX_CHARS)
return {ok: false, err: "over"};
var p3 = st.profile3.slice();
if(_apexW()) p3.push(RP_APEX.appendVersion(p3, "p3", cur.id,
{text: text, cat: cat, fact: true, auto: !!cur.auto, fromPin: !!cur.fromPin}, false));
else for(i = 0; i < p3.length; i++) if(p3[i] && p3[i].id == id){
p3[i].text = text; p3[i].cat = cat; p3[i].updatedAt = Date.now(); break; }
st.profile3 = p3;
save(runId, name, st);
return {ok: true};
}
function delFact(runId, name, id){
var st = get(runId, name);
if(!st || !st.profile3) return false;
var n0 = st.profile3.length;
st.profile3 = st.profile3.filter(function(p){ return !(p && p.id == id && p.fact); });
if(st.profile3.length === n0) return false;
save(runId, name, st);
return true;
}

/* P1-8: 长期记忆库用量统计 {events, pinned, shortN, longN, shortMax, pinMax} */
var PIN_MAX = 30;
/* 借鉴清单 Tier2 #5: 聊天消息 Pin 上限 5 条 (C.AI "Pin up to 5 messages"); 首次长按弹一次教育气泡 */
var MSG_PIN_MAX = 5;
var PIN_EDU_KEY = "nd_pin_edu_v1";
function msgPinLimitMsg(){ return "Pin up to 5 messages"; }
/* C.AI 教育文案中文化: "To pin a memory, press and hold any chat message. This way, {{name}} will always remember that message in this chat." */
function pinEduText(name){
return "长按任意聊天消息即可 Pin 为记忆。这样一来，" + (name || "TA") +
"在这次聊天中会永远记住这条消息。";
}
function pinEduSeen(){
try{ return localStorage.getItem(PIN_EDU_KEY) === "1"; }catch(e){ return false; }
}
function pinEduMark(){
try{ localStorage.setItem(PIN_EDU_KEY, "1"); }catch(e){}
}
/* 聊天消息 Pin 计数 (short 里 pin 的条目) */
function chatPinCount(runId, name){
var st = get(runId, name), n = 0;
((st && st.short) || []).forEach(function(m){ if(m && m.pin) n++; });
return n;
}
function canPinChatMsg(runId, name){ return chatPinCount(runId, name) < MSG_PIN_MAX; }
function memStats(runId, name){
var st = get(runId, name);
var short = (st && st.short) || [];
var pinned = 0;
short.forEach(function(m){ if(m.pin) pinned++; });
var apexS = leanmemOn() && (typeof RP_APEX !== "undefined") && RP_APEX.on();
var cntP = 0, cntE = 0, cntR = 0;
if(st){
if(apexS){ cntP = RP_APEX.latestOf(st.profile3).length;
cntE = RP_APEX.latestOf(st.event3).length; cntR = RP_APEX.latestOf(st.record3).length; }
else { cntP = (st.profile3 || []).length; cntE = (st.event3 || []).length; cntR = (st.record3 || []).length; }
}
return {events: short.length, pinned: pinned, shortN: short.length,
longN: (st && st.long) ? 1 : 0, shortMax: SHORT_MAX, pinMax: PIN_MAX,
profileN: cntP, event3N: cntE, recordN: cntR,
lean: leanmemOn() && !!(st && st.migrated3), apex: apexS && !!(st && st.apexMigrated)};
}

return {get: get, save: save, clear: clear, renderPrompt: renderPrompt,
renderBudgeted: renderBudgeted, memPoolRatio: memPoolRatio,
ironKey: ironKey, getIronLaw: getIronLaw, saveIronLaw: saveIronLaw,
IRONLAW_MAX: IRONLAW_MAX, estTokens: estTokens,
maybeAnalyze: maybeAnalyze, togglePin: togglePin, delItem: delItem, editItem: editItem,
memStats: memStats, SHORT_MAX: SHORT_MAX, PIN_MAX: PIN_MAX,
leanmemOn: leanmemOn, leanRatio: leanRatio, migrate3: migrate3, seedStores: seedStores,
buildAnalysisPrompt3: buildAnalysisPrompt3, parseState3: parseState3, eventSimilar: eventSimilar,
PROFILE3_MAX: PROFILE3_MAX, EVENT3_MAX: EVENT3_MAX, RECORD3_MAX: RECORD3_MAX,
FACT_CATS: FACT_CATS, FACTS_MAX_CHARS: FACTS_MAX_CHARS,
EVENT_STRUCT_FIELDS: EVENT_STRUCT_FIELDS, REL_FIELDS: REL_FIELDS,
isFactEntry: isFactEntry, factsOf: factsOf, factsChars: factsChars, getFacts: getFacts,
addFact: addFact, editFact: editFact, delFact: delFact,
/* 借鉴清单 Tier2 S 级小项 */
MSG_PIN_MAX: MSG_PIN_MAX, msgPinLimitMsg: msgPinLimitMsg, pinEduText: pinEduText,
pinEduSeen: pinEduSeen, pinEduMark: pinEduMark, chatPinCount: chatPinCount,
canPinChatMsg: canPinChatMsg,
PERM_MAX: PERM_MAX, permLimitMsg: permLimitMsg, setEventPerm: setEventPerm,
eventPermCount: eventPermCount, pruneEvents: pruneEvents,
CHATSUM_MAX: CHATSUM_MAX, sumKey: sumKey, getChatSummary: getChatSummary,
saveChatSummary: saveChatSummary,
MEMWIN_DEFAULT: MEMWIN_DEFAULT, memWindowN: memWindowN, applyMemWindow: applyMemWindow,
EVENT_KINDS: EVENT_KINDS, normKind: normKind, kindLabel: kindLabel,
msgInMemory: msgInMemory, delAskText: delAskText,
memStatusKey: memStatusKey, getMemStatus: getMemStatus, setMemStatus: setMemStatus,
memStatusLine: memStatusLine};
})();
