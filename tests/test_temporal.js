const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// Chronos 式时序感知检索回归测试: 故事进度 S / 时序切片 / 开关 / 边界 / 接入
// 注: 用 unicode 转义写标记，避免写入管线剥离导致假绿
const PAST_MARK = "【往事】";
const store = {};
const localStorage = {
getItem: (k)=> (k in store? store[k]: null),
setItem: (k, v)=>{ store[k] = String(v);},
removeItem: (k)=>{ delete store[k];},
};
const ctx = {console, localStorage, fetch: async ()=>{ throw new Error("no fetch in test");}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/memory.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/prompt.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/temporal.js", "utf8"), ctx);
vm.runInContext("function getRpCfg(){ return Object.assign({temporal:true}, JSON.parse(localStorage.getItem('__tcfg')||'{}'));}", ctx);
const RP_TEMPORAL = vm.runInContext("RP_TEMPORAL", ctx);
const RP_MEM = vm.runInContext("RP_MEM", ctx);
const RP_PROMPT = vm.runInContext("RP_PROMPT", ctx);
const cal = JSON.parse(fs.readFileSync(WWW + "/data/event_calendar.json", "utf8"));
RP_TEMPORAL._setCalendarForTest(cal);

let pass = 0, fail = 0;
const t = (n, c)=>{ c? pass++: (fail++, console.log("FAIL:", n));};
const cardDY = {name: "林黛玉", fields: {timeline_stage: "大观园诗社时期"}};

(async()=>{
/* ---------- 故事进度 S 默认映射 ---------- */
t("stage 诗社->37", RP_TEMPORAL.defaultChapter({fields:{timeline_stage:"大观园诗社时期"}}) === 37);
t("stage 黛玉入府->3", RP_TEMPORAL.defaultChapter({fields:{timeline_stage:"黛玉入府时期"}}) === 3);
t("stage 协理宁国府->14", RP_TEMPORAL.defaultChapter({fields:{timeline_stage:"协理宁国府时期"}}) === 14);
t("stage 家塾->9", RP_TEMPORAL.defaultChapter({fields:{timeline_stage:"家塾读书时期"}}) === 9);
t("stage 二进荣国府->39", RP_TEMPORAL.defaultChapter({fields:{timeline_stage:"二进荣国府时期"}}) === 39);
t("stage 怡红院->30", RP_TEMPORAL.defaultChapter({fields:{timeline_stage:"怡红院时期"}}) === 30);
t("stage 大观园->25", RP_TEMPORAL.defaultChapter({fields:{timeline_stage:"大观园时期"}}) === 25);
t("stage 未知->25默认", RP_TEMPORAL.defaultChapter(null) === 25);
t("getS 默认37(黛玉卡)", RP_TEMPORAL.getS("newchat1", cardDY).chapter === 37);
t("getS 默认非手动", RP_TEMPORAL.getS("newchat1", cardDY).manual === false);

/* ---------- 回目边界 ---------- */
t("setS(0)->1", RP_TEMPORAL.setS("cb", 0) === 1);
t("setS(999)->120", RP_TEMPORAL.setS("cb", 999) === 120);
t("setS('abc')->25", RP_TEMPORAL.setS("cb", "abc") === 25);
t("getS 手动优先", RP_TEMPORAL.getS("cb", cardDY).manual === true && RP_TEMPORAL.getS("cb", cardDY).chapter === 25);
t("fmtChapter", RP_TEMPORAL.fmtChapter(37) === "第37回");

/* ---------- S=3: 检索不到黛玉之死 ---------- */
RP_TEMPORAL.setS("c1", 3);
let r3 = await RP_TEMPORAL.retrieveTemporal("c1", cardDY, "红楼梦", ["黛玉", "宝玉", "病"], 5);
t("S=3 有结果",!!r3 && r3.items > 0);
t("S=3 全部事件回目<=3", r3.text.split("\n").slice(1).every(l=>{
const m = l.match(/第(\d+)回/); return m && parseInt(m[1], 10) <= 3;
}));
t("S=3 切掉了未来事件", r3.future > 2000);
t("S=3 无98回之死", r3.text.indexOf("第98回") < 0);

/* ---------- S=99: 能检索到黛玉之死 ---------- */
RP_TEMPORAL.setS("c1", 99);
let r99 = await RP_TEMPORAL.retrieveTemporal("c1", cardDY, "红楼梦", ["黛玉病重", "宝玉", "死"], 5);
t("S=99 有结果",!!r99 && r99.items > 0);
t("S=99 含第98回之死", r99.text.indexOf("第98回") >= 0);
t("S=99 全部事件回目<=99", r99.text.split("\n").slice(1).every(l=>{
const m = l.match(/第(\d+)回/); return m && parseInt(m[1], 10) <= 99;
}));

/* ---------- 标记完整性（防剥离回归） ---------- */
t("标记在头部", r99.text.indexOf(PAST_MARK) === 0);
t("头部含防穿帮指令", r99.text.indexOf("一概不知") >= 0 && r99.text.indexOf("绝不得提及") >= 0);

/* ---------- 静默跳过 ---------- */
let rOther = await RP_TEMPORAL.retrieveTemporal("c1", cardDY, "三国演义", ["test"], 5);
t("非红楼 novel 返回 null", rOther === null);
let rEmpty = await RP_TEMPORAL.retrieveTemporal("c1", cardDY, "红楼梦", [" "], 5);
t("无近期文本返回 null", rEmpty === null);
RP_TEMPORAL._setCalendarForTest([]);
let rNoCal = await RP_TEMPORAL.retrieveTemporal("c1", cardDY, "红楼梦", ["test"], 5);
t("无日历返回 null", rNoCal === null);
RP_TEMPORAL._setCalendarForTest(cal);

/* ---------- 开关关闭零注入 ---------- */
localStorage.setItem("__tcfg", JSON.stringify({temporal: false}));
let rOff = await RP_TEMPORAL.retrieveTemporal("c1", cardDY, "红楼梦", ["黛玉"], 5);
t("开关关闭检索返回 null", rOff === null);
let mbOff = RP_MEM.renderBudgeted("r1", "阿绫", 600, {temporal: null});
t("开关关闭 similar 无", mbOff.text.indexOf(PAST_MARK) < 0);
t("开关关闭 similar 非时序切片", mbOff.pools.similar.source!== "时序切片");
localStorage.setItem("__tcfg", JSON.stringify({temporal: true}));

/* ---------- similar 池接入 ---------- */
RP_MEM.save("r2", "阿绫", {short: [], long: "很久以前的模糊印象"});
const tInfo = {chapter: 37, text: PAST_MARK + "（第3回）黛玉进府测试", items: 1, future: 2916};
let mb = RP_MEM.renderBudgeted("r2", "阿绫", 600, {temporal: tInfo});
t("similar 注入", mb.text.indexOf(PAST_MARK) >= 0);
t("similar source=时序切片", mb.pools.similar.source === "时序切片");
t("similar items=1", mb.pools.similar.items === 1);
let mb2 = RP_MEM.renderBudgeted("r2", "阿绫", 600, {});
t("无 temporal 回退占位", mb2.pools.similar.source === "占位" && mb2.text.indexOf("【长远印象】") >= 0);

/* ---------- prompt.js 端到端 ---------- */
const b = RP_PROMPT.buildMessages({name: "林黛玉", fields: {}},
{novel: "红楼梦", history: [],
memBudgeted: {runId: "r2", name: "林黛玉", cardId: null, novel: "红楼梦", temporal: tInfo}},
{maxContext: 8192});
t("prompt preview 含", b.preview.indexOf(PAST_MARK) >= 0);
t("stats similar source 透传", b.stats.memPools && b.stats.memPools.similar.source === "时序切片");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
})();
