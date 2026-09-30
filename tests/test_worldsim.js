const fs = require("fs"), vm = require("vm"), assert = require("assert");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 世界模拟三件套回归：时间/天气/地理（纯逻辑，不依赖 DOM）
const ls = (function(){ const m = {}; return {
getItem: k => (k in m? m[k]: null),
setItem: (k, v) => { m[k] = String(v);},
removeItem: k => { delete m[k];},
clear: () => { for(const k in m) delete m[k];},
};})();
const ctx = { localStorage: ls, console, Math, Date, JSON};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/worldsim.js", "utf8"), ctx);
const W = ctx.RP_WORLDSIM;
let n = 0;
const t = (name, fn)=>{ ls.clear(); fn(); n++; console.log("ok -", name);};

t("古代时间格式化", ()=>{
const st = W.ensure("c1", {novel:"红楼梦"});
assert.strictEqual(st.mode, "ancient");
assert.strictEqual(W.fmtTime(st), "乾隆十五年三月十二日 巳时初");
});
t("现代时间格式化", ()=>{
const st = W.ensure("c2", {novel:"原创"});
assert.strictEqual(st.mode, "modern");
assert.ok(/^\d+月\d+日 \d\d:\d\d$/.test(W.fmtTime(st)));
});
t("时辰边界", ()=>{
assert.strictEqual(W.shichenOf(0), "子时正");
assert.strictEqual(W.shichenOf(1380), "子时初"); // 23:00
assert.strictEqual(W.shichenOf(720), "午时正"); // 12:00
});
t("现代跨日进位", ()=>{
const st = W.ensure("c3", {});
W.setDateTime("c3", 2026, 9, 30, 1410); // 23:30
W.adjustTime("c3", 60);
const s2 = W.get("c3");
assert.strictEqual(s2.d, 1); assert.strictEqual(s2.m, 10); assert.strictEqual(s2.min, 30);
});
t("古代跨月进位（30天/月）", ()=>{
const st = W.ensure("c4", {novel:"红楼梦"});
W.setDateTime("c4", null, 3, 30, 1400);
W.adjustTime("c4", 120);
const s2 = W.get("c4");
assert.strictEqual(s2.m, 4); assert.strictEqual(s2.d, 1);
});
t("天气枚举与季节", ()=>{
assert.strictEqual(W.weatherName(3), "雨");
assert.strictEqual(W.seasonOf(7), "summer");
assert.strictEqual(W.seasonOf(12), "winter");
assert.strictEqual(W.seasonName(4), "春");
});
t("加权随机可复现", ()=>{
const a = W.pickWeighted([[0,50],[1,50]], 0.1), b = W.pickWeighted([[0,50],[1,50]], 0.1);
assert.strictEqual(a, b); assert.strictEqual(a, 0);
assert.strictEqual(W.pickWeighted([[0,50],[1,50]], 0.9), 1);
});
t("天气流转", ()=>{
const st = W.ensure("c5", {});
st.wx = 0; st.m = 7;
W.driftWeather(st, 0.99); // 夏季高权重应落到雨/雷
assert.ok(st.wx === 3 || st.wx === 6, "wx=" + st.wx);
});
t("地点移动消耗时间", ()=>{
const st = W.ensure("c6", {novel:"红楼梦"});
const before = st.min;
W.moveTo("c6", "宁国府", "", {novel:"红楼梦"});
const s2 = W.get("c6");
assert.strictEqual(W.curPlace(s2).name, "宁国府");
assert.strictEqual(s2.min, (before + 30) % 1440);
});
t("同地点移动不扣时间", ()=>{
const st = W.ensure("c7", {novel:"红楼梦"});
const before = st.min;
W.moveTo("c7", "大观园", "", {novel:"红楼梦"});
assert.strictEqual(W.get("c7").min, before);
});
t("未知地点自动登记", ()=>{
W.moveTo("c8", "栊翠庵", "妙玉居处", {});
const s2 = W.get("c8");
assert.ok(W.findPlace(s2, "栊翠庵"));
assert.strictEqual(W.findPlace(s2, "栊翠庵").desc, "妙玉居处");
});
t("AI标记解析", ()=>{
const mk = W.parseMarkers("明早见⟦+30分钟⟧，记得带伞⟦天气=雨⟧，去⟦地点=潇湘馆⟧");
assert.strictEqual(mk.timeAdd, 30);
assert.strictEqual(mk.weather, 3);
assert.strictEqual(mk.place, "潇湘馆");
const mk2 = W.parseMarkers("过两日⟦+2小时⟧再说⟦+1天⟧");
assert.strictEqual(mk2.timeAdd, 120 + 1440);
});
t("applyReply 剥离并应用", ()=>{
W.ensure("c9", {novel:"红楼梦"});
const before = W.get("c9").min;
const r = W.applyReply("c9", "（雨声潺潺）⟦天气=雨⟧⟦+60分钟⟧", {novel:"红楼梦"});
assert.ok(r.changed);
assert.strictEqual(r.clean, "（雨声潺潺）");
const s2 = W.get("c9");
assert.strictEqual(s2.wx, 3);
assert.strictEqual(s2.min, (before + 60) % 1440);
assert.ok(r.clean.indexOf("⟦") < 0);
});
t("无标记不改动", ()=>{
const r = W.applyReply("c10", "普通回复", {});
assert.strictEqual(r.changed, false);
assert.strictEqual(r.clean, "普通回复");
});
t("prompt注入含三要素", ()=>{
const p = W.renderPrompt("c11", {novel:"红楼梦"});
assert.ok(p.indexOf("") === 0);
assert.ok(/时间：/.test(p) && /天气：/.test(p) && /地点：/.test(p));
assert.ok(p.indexOf("⟦天气=雨⟧") > 0); // AI 调整约定
});
t("关闭后不注入", ()=>{
const ctx2 = { localStorage: ls, console, Math, Date, JSON,
getRpCfg: ()=>({worldsim:false})};
vm.createContext(ctx2);
vm.runInContext(fs.readFileSync(WWW + "/rp/worldsim.js", "utf8"), ctx2);
assert.strictEqual(ctx2.RP_WORLDSIM.renderPrompt("cx", {}), "");
assert.strictEqual(ctx2.RP_WORLDSIM.briefHTML("cx", {}), "");
assert.strictEqual(ctx2.RP_WORLDSIM.enabled(), false);
});
t("按消息数自动推进", ()=>{
W.ensure("c12", {novel:"红楼梦"});
const s0 = W.get("c12"), m0 = s0.min;
W.onUserMessage("c12", {novel:"红楼梦"}); // 1
W.onUserMessage("c12", {novel:"红楼梦"}); // 2
assert.strictEqual(W.get("c12").min, m0); // 未到3轮不推进
W.onUserMessage("c12", {novel:"红楼梦"}); // 3
assert.strictEqual(W.get("c12").min, (m0 + 30) % 1440); // 默认每3轮+30分钟
});
t("briefHTML 三芯片", ()=>{
const h = W.briefHTML("c13", {novel:"红楼梦"});
assert.ok(h.indexOf("simchip") > 0);
assert.ok(h.indexOf("大观园") > 0);
});
t("世界模板识别", ()=>{
assert.strictEqual(W.detectWorld({novel:"水浒传全本"}), "shuihu");
assert.strictEqual(W.detectWorld({worldName:"红楼梦·大观园"}), "honglou");
assert.strictEqual(W.detectWorld({novel:"原创都市"}), "modern");
const st = W.ensure("c14", {novel:"水浒传"});
assert.strictEqual(W.curPlace(st).name, "梁山泊");
assert.strictEqual(st.era, "宣和");
});
console.log(`\n${n} pass, 0 fail`);
