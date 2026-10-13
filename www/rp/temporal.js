/* RP_TEMPORAL: Chronos 式时序感知检索 v1（防角色"提前知道剧本"）。
* 故事进度 S（回目）存 nd_storytime_<chatId>；similar 池只取 ch <= S 的事件，
* 以【往事】块注入，并明确告知 AI 不得提及 S 之后的事。无日历/非红楼/关闭时静默跳过。 */
var RP_TEMPORAL = (function(){
"use strict";
var CAL_URL = "data/event_calendar.json";
var NOVEL = "红楼梦";
var TOP_N = 5;

/* timeline_stage -> 回目映射（近似值，依据通行本回目常识；如实标注近似） */
var STAGE_MAP = [
[/黛玉入府/, 3], /* 第三回：林黛玉进荣国府 */
[/协理宁国府/, 14], /* 第十三回：王熙凤协理宁国府 */
[/家塾/, 9], /* 第九回：宝玉秦钟入家塾 */
[/二进荣国府/, 39], /* 第三十九回：刘姥姥二进荣国府 */
[/诗社/, 37], /* 第三十七回：海棠诗社 */
[/怡红院/, 30], /* 约第三十回前后：宝玉居怡红院（近似） */
[/大观园/, 25] /* 约第二十五回前后：大观园入住（近似） */
];
var DEFAULT_CH = 25;

function clampCh(n){ n = parseInt(n, 10); if(isNaN(n)) return DEFAULT_CH; return Math.max(1, Math.min(120, n));}
function storeKey(chatId){ return "nd_storytime_" + chatId;}

function defaultChapter(card){
try{
var ts = String((card && card.fields && card.fields.timeline_stage) || "");
for(var i = 0; i < STAGE_MAP.length; i++) if(STAGE_MAP[i][0].test(ts)) return STAGE_MAP[i][1];
}catch(e){}
return DEFAULT_CH;
}
/* 返回 {chapter, manual} */
function getS(chatId, card){
try{
var raw = localStorage.getItem(storeKey(chatId));
if(raw!= null){
var v = JSON.parse(raw);
if(v && v.chapter!= null) return {chapter: clampCh(v.chapter), manual: true};
}
}catch(e){}
return {chapter: defaultChapter(card), manual: false};
}
function setS(chatId, chapter){
var c = clampCh(chapter);
try{ localStorage.setItem(storeKey(chatId), JSON.stringify({chapter: c}));}catch(e){}
return c;
}
function fmtChapter(ch){ return "第" + ch + "回";}

function enabled(){
try{
if(typeof getRpCfg === "function"){ var c = getRpCfg(); return c.temporal!== false;}
}catch(e){}
return true;
}

var _cal = null, _loading = null, _failNotified = false;
function calendarFor(novel){
if(novel!== NOVEL) return Promise.resolve(null);
if(_cal) return Promise.resolve(_cal);
if(_loading) return _loading;
_loading = fetch(CAL_URL).then(function(r){ if(!r.ok) throw new Error("http"); return r.json();})
.then(function(j){ _cal = j; return _cal;})
.catch(function(){ _loading = null;
/* P2-5: fetch 失败不再永远静默——一次性提示（固定文案防刷屏），时序检索自动降级为不可用 */
if(!_failNotified){ _failNotified = true;
  try{ if(typeof rpToast === "function") rpToast("事件日历加载失败，时序检索（往事注入）本次不可用"); }catch(e){} }
return null;});
return _loading;
}
/* 测试/诊断用：直接注入日历数据，绕过 fetch */
function _setCalendarForTest(arr){ _cal = arr;}

/* 关键词打分：字符 bigram 重叠 + 人名加权；纯 JS，单机零依赖 */
function bigrams(s){
var m = {}, i, b;
s = String(s || "");
for(i = 0; i < s.length - 1; i++){ b = s.substr(i, 2); m[b] = (m[b] || 0) + 1;}
return m;
}
function scoreEvent(ev, textBi, text){
var s = 0, i, c;
var ebi = bigrams((ev.s || "") + (ev.sub || ""));
for(var b in ebi){ if(textBi[b]) s += Math.min(ebi[b], textBi[b]);}
if(ev.sub && text.indexOf(ev.sub) >= 0) s += 6;
var chars = ev.c || [];
for(i = 0; i < chars.length && i < 5; i++){ c = chars[i]; if(c && text.indexOf(c) >= 0) s += 4;}
return s;
}
function est(s){
try{ if(typeof RP_MEM!== "undefined" && RP_MEM.estTokens) return RP_MEM.estTokens(s);}catch(e){}
return Math.max(1, Math.ceil(String(s || "").length / 1.6));
}

/* 主入口：返回 {chapter, manual, text(完整【往事】块), items, future}；不可用时返回 null（静默跳过） */
async function retrieveTemporal(chatId, card, novel, recentTexts, topN){
if(!enabled()) return null;
var st = getS(chatId, card);
var S = st.chapter;
var cal = await calendarFor(novel);
if(!cal ||!cal.length) return null;
var text = (recentTexts || []).join("\n");
if(!String(text).trim()) return null;
var textBi = bigrams(text);
var scored = [], future = 0, i, ev;
for(i = 0; i < cal.length; i++){
ev = cal[i];
if(ev.ch > S){ future++; continue;}
var sc = scoreEvent(ev, textBi, text);
if(sc > 0) scored.push({ev: ev, sc: sc});
}
scored.sort(function(a, b){ return b.sc - a.sc;});
var top = scored.slice(0, topN || TOP_N);
var name = (card && card.name) || "角色";
var head = "【往事】（以下为" + name + "在" + fmtChapter(S) + "及之前已知的事；"
+ fmtChapter(S) + "之后发生的事角色一概不知，叙述中绝不得提及、暗示或预告）";
if(!top.length) return {chapter: S, manual: st.manual, text: "", items: 0, future: future};
var lines = top.map(function(x){
return "（第" + x.ev.ch + "回）" + String(x.ev.s).slice(0, 72);
});
return {chapter: S, manual: st.manual, text: head + "\n" + lines.join("\n"), items: top.length, future: future};
}

/* 人物词汇表（APEX-MEM 人物→事件索引用）：日历 c 数组已归一化的人名去重；未加载时返回空数组 */
function persons(){
  var out = [], seen = {};
  try{
    (_cal || []).forEach(function(ev){
      (ev.c || []).forEach(function(c){
        c = String(c || "");
        if(c && !seen[c]){ seen[c] = 1; out.push(c); }
      });
    });
  }catch(e){}
  return out;
}

return {
getS: getS, setS: setS, clampCh: clampCh, defaultChapter: defaultChapter,
fmtChapter: fmtChapter, enabled: enabled, persons: persons,
calendarFor: calendarFor, retrieveTemporal: retrieveTemporal,
_setCalendarForTest: _setCalendarForTest, _STAGE_MAP: STAGE_MAP
};
})();
