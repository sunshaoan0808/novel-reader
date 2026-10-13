/* 世界模拟三件套：时间 / 天气 / 地理（沉浸式 RP）
* 设计借鉴（只抄思路，不抄代码）：
* - Chronicle(sillytavern 扩展): 状态存每会话元数据、compact briefing 注入、
* 地点注册表+★当前位置、Living world 每轮自动更新、按题材预设
* - Marinara Engine: GameState 单对象(date/time/location/weather)、HUD 世界状态条、
* 手动覆盖字段、从 AI 回复自动更新
* - st_var_manager: 天气用整数枚举防拼写漂移
* 状态键：nd_worldsim_<chatId>（localStorage，小 JSON，不走 IDB）
* AI 调整约定：回复里可带 ⟦+30分钟⟧ / ⟦+2小时⟧ / ⟦+1天⟧ / ⟦天气=雨⟧ / ⟦地点=潇湘馆⟧，
* 解析后从正文剥离，不显示给用户。
*/
var RP_WORLDSIM = (function(){
"use strict";

/* 天气枚举：id 固定，显示名映射（防 AI 自由发挥导致漂移） */
var WEATHER = [
{id: 0, name: "晴", icon: "ws_sun"},
{id: 1, name: "多云", icon: "ws_cloud"},
{id: 2, name: "阴", icon: "ws_cloud"},
{id: 3, name: "雨", icon: "ws_rain"},
{id: 4, name: "雪", icon: "ws_snow"},
{id: 5, name: "雾", icon: "ws_fog"},
{id: 6, name: "雷阵雨", icon: "ws_storm"},
];
var WX_BY_NAME = {};
WEATHER.forEach(function(w){ WX_BY_NAME[w.name] = w.id;});

/* 季节流转表：season -> [weatherId, weight] */
var SEASON_WX = {
spring: [[0,35],[1,25],[2,15],[3,20],[5,5]],
summer: [[0,30],[1,20],[2,10],[3,25],[6,15]],
autumn: [[0,35],[1,25],[2,20],[3,12],[5,8]],
winter: [[0,30],[1,20],[2,25],[4,20],[5,5]],
};

/* 十二时辰 */
var SHICHEN = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];

/* 世界模板（Chronicle presets 思路）：新会话按题材初始化 */
var WORLDS = {
honglou: {label: "红楼梦", mode: "ancient", era: "乾隆", year: 15, m: 3, d: 12, min: 540,
places: [
{id: "dgy", name: "大观园", desc: "贾府为元春省亲修建的园林，如今是宝玉与众姐妹诗社起居之所", mood: "繁华中透着人事将尽的清寂"},
{id: "rjf", name: "荣国府", desc: "贾母、王夫人居处，贾府权力中心", mood: "礼数森严，暗流涌动"},
{id: "ngf", name: "宁国府", desc: "贾珍、尤氏当家，秦可卿丧事后更显颓败", mood: "荒唐奢靡，门庭渐冷"},
{id: "xxg", name: "潇湘馆", desc: "林黛玉居处，竹影潇潇", mood: "幽静多病，诗意清寒"},
{id: "yhy", name: "怡红院", desc: "贾宝玉居处，花团锦簇", mood: "热闹温柔，脂粉香浓"},
], start: "dgy"},
shuihu: {label: "水浒传", mode: "ancient", era: "宣和", year: 2, m: 6, d: 15, min: 420,
places: [
{id: "lsb", name: "梁山泊", desc: "八百里水泊，忠义堂聚义之所", mood: "豪气干云，戒备森严"},
{id: "dj", name: "东京", desc: "大宋都城，繁华与权谋交织", mood: "繁华似锦，危机四伏"},
{id: "ycx", name: "郓城县", desc: "宋江、晁盖发迹之地", mood: "市井烟火，暗藏江湖"},
{id: "dxgs", name: "大相国寺", desc: "鲁智深倒拔垂杨柳处，菜园禅林", mood: "庄严清净，武风隐隐"},
], start: "lsb"},
sanguo: {label: "三国演义", mode: "ancient", era: "建安", year: 13, m: 7, d: 20, min: 480,
places: [
{id: "xc", name: "许昌", desc: "曹魏都城，挟天子以令诸侯", mood: "威严肃杀，谋士如云"},
{id: "jy", name: "荆州", desc: "刘备暂居，卧龙未出", mood: "暗流涌动，静待风云"},
{id: "jd", name: "江东", desc: "孙氏基业，周瑜掌军", mood: "水军威武，少年意气"},
], start: "xc"},
modern: {label: "现代", mode: "modern", y: 2026, m: 9, d: 30, min: 480,
places: [
{id: "apt", name: "市中心公寓", desc: "你租住的高层公寓，落地窗看得到江", mood: "安静私密，灯火可亲"},
{id: "cafe", name: "街角咖啡馆", desc: "常去的那家，老板记得你的口味", mood: "慵懒温暖，适合长谈"},
{id: "office", name: "公司", desc: "格子间与会议室，日复一日", mood: "忙碌压抑，偶有八卦"},
], start: "apt"},
};

function keyOf(chatId){ return "nd_worldsim_" + chatId;}
function lsGet(k){ try{ var v = localStorage.getItem(k); return v? JSON.parse(v): null;}catch(e){ return null;}}
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v));}catch(e){}}

/* 全局配置（读 app.js 的 getRpCfg，测试环境无则用默认） */
function gcfg(){
var d = {worldsim: true, wsPerMsg: 3, wsStepMin: 30, wsWxAuto: true, wsWxEvery: 5};
try{ if(typeof getRpCfg!== "undefined"){ var c = getRpCfg() || {}; for(var k in d){ if(c[k]!== undefined) d[k] = c[k];}}}catch(e){}
return d;
}
function enabled(){ return!!gcfg().worldsim;}

function detectWorld(hint){
hint = hint || {};
var s = String(hint.novel || "") + " " + String(hint.worldName || "");
if(/红楼/.test(s)) return "honglou";
if(/水浒/.test(s)) return "shuihu";
if(/三国/.test(s)) return "sanguo";
return "modern";
}

function mkState(tplKey){
var t = WORLDS[tplKey] || WORLDS.modern;
var st = {v: 1, tpl: tplKey, mode: t.mode, wx: 0, msgCount: 0, travelMin: 30, cur: t.start, places: [], present: []};
if(t.mode === "ancient"){ st.era = t.era; st.y = t.year;}
else { st.y = t.y;}
st.m = t.m; st.d = t.d; st.min = t.min;
t.places.forEach(function(p){ st.places.push({id: p.id, name: p.name, desc: p.desc, mood: p.mood});});
return st;
}

function get(chatId){ return lsGet(keyOf(chatId));}
function save(chatId, st){ lsSet(keyOf(chatId), st);}
function ensure(chatId, hint){
var st = get(chatId);
if(st && st.v === 1) return st;
st = mkState(detectWorld(hint));
save(chatId, st);
return st;
}

/* ---------- 时间 ---------- */
function seasonOf(m){ return (m>=3&&m<=5)?"spring":(m>=6&&m<=8)?"summer":(m>=9&&m<=11)?"autumn":"winter";}
function shichenOf(min){
var h = Math.floor(min/60)%24;
var idx = Math.floor(((h+1)%24)/2);
var half = (h%2===1)? "初": "正"; /* 每时辰前一小时为初、后一小时为正，如子初=23-0点 */
return SHICHEN[idx] + "时" + half;
}
function cnNum(n){ /* 1-99 转中文数字，年月日显示用 */
var d = ["","一","二","三","四","五","六","七","八","九"];
if(n<=10) return n===10?"十":d[n];
if(n<20) return "十"+d[n-10];
var t = Math.floor(n/10), o = n%10;
return d[t]+"十"+(o?d[o]:"");
}
function fmtTime(st){
var hh = String(Math.floor(st.min/60)).padStart(2,"0"), mm = String(st.min%60).padStart(2,"0");
if(st.mode === "ancient"){
return (st.era||"") + cnNum(st.y) + "年" + cnNum(st.m) + "月" + cnNum(st.d) + "日 " + shichenOf(st.min);
}
return st.m + "月" + st.d + "日 " + hh + ":" + mm;
}
function addMinutes(st, n){
var total = st.min + n, days = Math.floor(total/1440);
st.min = ((total%1440)+1440)%1440;
if(days!== 0){
if(st.mode === "modern"){
var dt = new Date(Date.UTC(st.y, st.m-1, st.d + days));
st.y = dt.getUTCFullYear(); st.m = dt.getUTCMonth()+1; st.d = dt.getUTCDate();
} else {
var d = st.d + days;
while(d > 30){ d -= 30; st.m++; if(st.m > 12){ st.m = 1; st.y++;}}
while(d < 1){ d += 30; st.m--; if(st.m < 1){ st.m = 12; st.y--;}}
st.d = d;
}
}
return st;
}

/* ---------- 天气 ---------- */
function weatherName(id){ var w = WEATHER[id]; return w? w.name: "晴";}
function weatherIcon(id){ var w = WEATHER[id]; return w? w.icon: "ws_sun";}
function pickWeighted(table, rnd){
rnd = (rnd == null)? Math.random(): rnd;
var sum = 0, i;
for(i=0;i<table.length;i++) sum += table[i][1];
var r = rnd*sum;
for(i=0;i<table.length;i++){ r -= table[i][1]; if(r <= 0) return table[i][0];}
return table[table.length-1][0];
}
function driftWeather(st, rnd){
var table = SEASON_WX[seasonOf(st.m)] || SEASON_WX.spring;
var nid = pickWeighted(table, rnd);
if(nid === st.wx && table.length > 1){ /* 50% 概率换一个，避免长期不变 */
if((rnd == null? Math.random(): rnd) < 0.5){
var alt = table.filter(function(t){ return t[0]!== st.wx;});
nid = pickWeighted(alt, rnd);
}
}
st.wx = nid;
return st;
}

/* ---------- 地理 ---------- */
function curPlace(st){
for(var i=0;i<st.places.length;i++) if(st.places[i].id === st.cur) return st.places[i];
return st.places[0] || {id: "?", name: "未知", desc: "", mood: ""};
}
function findPlace(st, name){
name = String(name||"").trim();
for(var i=0;i<st.places.length;i++) if(st.places[i].name === name) return st.places[i];
return null;
}
function moveTo(chatId, name, desc, hint){
var st = ensure(chatId, hint);
name = String(name||"").trim();
if(!name) return st;
var p = findPlace(st, name);
if(!p){ /* Chronicle 式 AI 发现：未知地点自动登记 */
p = {id: "p"+Date.now().toString(36), name: name, desc: desc||"", mood: ""};
st.places.push(p);
}
if(p.id!== st.cur){
st.cur = p.id;
addMinutes(st, st.travelMin || 30); /* 移动消耗时间，联动时间系统 */
}
save(chatId, st);
return st;
}

/* ---------- 自动推进（Living world 思路：每轮用户消息后） ---------- */
function onUserMessage(chatId, hint){
if(!enabled()) return get(chatId);
var st = ensure(chatId, hint);
var c = gcfg();
st.msgCount = (st.msgCount||0) + 1;
var perMsg = Math.max(1, c.wsPerMsg|0), stepMin = Math.max(0, c.wsStepMin|0);
if(st.msgCount % perMsg === 0 && stepMin > 0) addMinutes(st, stepMin);
var wxEvery = Math.max(1, c.wsWxEvery|0);
if(c.wsWxAuto && st.msgCount % wxEvery === 0) driftWeather(st);
save(chatId, st);
return st;
}

/* ---------- AI 标记解析 ---------- */
var MARK_RE = /⟦([^⟧]*)⟧/g;
function parseMarkers(text){
var out = {timeAdd: 0, weather: null, place: null};
var m;
MARK_RE.lastIndex = 0;
while((m = MARK_RE.exec(text))){
var s = m[1].trim();
var tm = s.match(/^\+(\d+)\s*分钟$/); if(tm){ out.timeAdd += parseInt(tm[1],10); continue;}
var th = s.match(/^\+(\d+)\s*小时$/); if(th){ out.timeAdd += parseInt(th[1],10)*60; continue;}
var td = s.match(/^\+(\d+)\s*天$/); if(td){ out.timeAdd += parseInt(td[1],10)*1440; continue;}
var tw = s.match(/^天气\s*=\s*(.+)$/); if(tw){ var wid = WX_BY_NAME[tw[1].trim()]; if(wid!= null) out.weather = wid; continue;}
var tp = s.match(/^地点\s*=\s*(.+)$/); if(tp){ out.place = tp[1].trim(); continue;}
}
return out;
}
function applyReply(chatId, text, hint){
if(!enabled() ||!text) return {clean: text, changed: false};
MARK_RE.lastIndex = 0;
if(text.indexOf("⟦") < 0) return {clean: text, changed: false};
var mk = parseMarkers(text);
var clean = String(text).replace(MARK_RE, "").replace(/[ \t]+\n/g, "\n").trim();
var changed = false;
var st = ensure(chatId, hint);
if(mk.timeAdd){ addMinutes(st, mk.timeAdd); changed = true;}
if(mk.weather!= null){ st.wx = mk.weather; changed = true;}
if(mk.place){ /* 地点标记走 moveTo（含移动耗时），但 AI 已在叙述中铺垫则不重复扣时间 */
var p = findPlace(st, mk.place);
if(!p){ p = {id: "p"+Date.now().toString(36), name: mk.place, desc: "", mood: ""}; st.places.push(p);}
if(p.id!== st.cur){ st.cur = p.id; changed = true;}
}
if(changed) save(chatId, st);
if(clean!== text) changed = true;
return {clean: clean, changed: changed};
}

/* ---------- prompt 注入（compact briefing，几十 token） ---------- */
function renderPrompt(chatId, hint){
if(!enabled()) return "";
var st = ensure(chatId, hint);
var p = curPlace(st);
var lines = ["",
"时间：" + fmtTime(st),
"天气：" + weatherName(st.wx) + "（" + seasonName(st.m) + "）",
"地点：" + p.name + (p.mood? "——" + p.mood: "")];
if(st.present && st.present.length) lines.push("在场人物：" + st.present.join("、"));
lines.push("要求：你的叙述必须呼应以上时间/天气/地点（如深夜则万籁俱寂、雨天则描写雨声），不得写出矛盾的时辰天气；" +
"如剧情需要改变时间/天气/地点/在场人物，在回复中用 ⟦+30分钟⟧ / ⟦天气=雨⟧ / ⟦地点=宁国府⟧ / ⟦在场=宝玉,黛玉⟧ 标记（标记会被系统解析，不显示给用户）。");
return lines.join("\n");
}
function seasonName(m){
return {spring:"春",summer:"夏",autumn:"秋",winter:"冬"}[seasonOf(m)];
}

/* ---------- HUD ---------- */
/* P2-11: 收敛到 escutil.js 的 escH()；独立加载（测试 vm）无 escH 时回退同款实现 */
var esc = (typeof escH === "function") ? escH : function(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function briefHTML(chatId, hint){
if(!enabled()) return "";
var st = ensure(chatId, hint);
var p = curPlace(st);
var ic = (typeof icon!== "undefined")? icon: function(){ return "";};
return '<span class="simchip">' + ic("clock",12) + " " + esc(fmtTime(st)) + "</span>" +
'<span class="simchip">' + ic(weatherIcon(st.wx),12) + " " + esc(weatherName(st.wx)) + "</span>" +
'<span class="simchip">' + ic("pin",12) + " " + esc(p.name) + "</span>" +
((st.present && st.present.length) ? '<span class="simchip">' + ic("users",12) + " " + esc(st.present.join("、")) + "</span>" : "");
}

/* 手动调整（设置页/编辑器调用） */
function setWeather(chatId, id, hint){ var st = ensure(chatId, hint); if(WEATHER[id]){ st.wx = id; save(chatId, st);} return st;}
function adjustTime(chatId, minutes, hint){ var st = ensure(chatId, hint); addMinutes(st, minutes); save(chatId, st); return st;}
function setDateTime(chatId, y, m, d, min, hint){
var st = ensure(chatId, hint);
if(y) st.y = y; if(m) st.m = m; if(d) st.d = d; if(min!= null) st.min = min;
save(chatId, st); return st;
}
function addPlace(chatId, name, desc, mood, hint){
var st = ensure(chatId, hint);
if(!findPlace(st, name)) st.places.push({id: "p"+Date.now().toString(36), name: name, desc: desc||"", mood: mood||""});
save(chatId, st); return st;
}

return {
WEATHER: WEATHER, SEASON_WX: SEASON_WX, SHICHEN: SHICHEN, WORLDS: WORLDS,
keyOf: keyOf, get: get, save: save, ensure: ensure, enabled: enabled,
detectWorld: detectWorld, seasonOf: seasonOf, seasonName: seasonName,
shichenOf: shichenOf, fmtTime: fmtTime, addMinutes: addMinutes,
weatherName: weatherName, weatherIcon: weatherIcon, pickWeighted: pickWeighted, driftWeather: driftWeather,
curPlace: curPlace, findPlace: findPlace, moveTo: moveTo, addPlace: addPlace,
onUserMessage: onUserMessage, parseMarkers: parseMarkers, applyReply: applyReply,
renderPrompt: renderPrompt, briefHTML: briefHTML,
setWeather: setWeather, adjustTime: adjustTime, setDateTime: setDateTime,
};
})();
