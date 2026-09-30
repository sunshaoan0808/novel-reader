const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// LeanMem 三库记忆回归测试: 开关/迁移/分流/过滤/演化/自适应预算/record指针/旧格式兼容
// 注: 用 unicode 转义写标记，避免写入管线剥离导致假绿
const M_PROFILE = "【画像记忆】";
const M_EVENT = "【事件】";
const M_RECORD = "【记录】";
const M_PIN = "【置顶记忆】";
const M_LONG = "【长远印象】";
const store = {};
const localStorage = {
getItem: (k)=> (k in store? store[k]: null),
setItem: (k, v)=>{ store[k] = String(v);},
removeItem: (k)=>{ delete store[k];},
};
let rpcfg = {leanmem: true, memPoolRatio: "50/30/20", temporal: true};
const ctx = {console, localStorage, getRpCfg: ()=>Object.assign({}, rpcfg)};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/memory.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/prompt.js", "utf8"), ctx);
const RP_MEM = vm.runInContext("RP_MEM", ctx);
const RP_PROMPT = vm.runInContext("RP_PROMPT", ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c? pass++: (fail++, console.log("FAIL:", n));};
const mkHist = (n, start)=>{ const h = []; for(let i = 0; i < n; i++) h.push({mid: "m" + (start + i), role: i % 2? "assistant": "user", content: "消息" + (start + i)}); return h;};

(async ()=>{
/* ---------- 开关 ---------- */
t("leanmemOn 默认开", RP_MEM.leanmemOn() === true);
rpcfg.leanmem = false;
t("leanmemOn 可关", RP_MEM.leanmemOn() === false);
RP_MEM.save("off1", "甲", {mood: null, short: [], long: "", up_to: 0});
const oldJSON = JSON.stringify({mood: {state: "平静", filter: ""}, short: [{id: 1, time: "", fact: "旧格式事实内容", view: ""}], long: "旧印象"});
let rOff = await RP_MEM.maybeAnalyze("off1", "甲", mkHist(12, 0), {}, async ()=>oldJSON, "");
let stOff = RP_MEM.get("off1", "甲");
t("关: 旧格式仍解析", rOff.analyzed === true && stOff.short.length === 1);
t("关: 不产生三库",!stOff.profile3 &&!stOff.event3 &&!stOff.migrated3);
let bOff = RP_MEM.renderBudgeted("off1", "甲", 600, {query: "之前发生了什么"});
t("关: 无store标记",!bOff.pools.recent.store &&!bOff.pools.important.store);
t("关: 比例固定不自适应", bOff.pools.ratio.recent === 300);
rpcfg.leanmem = true;

/* ---------- 一次性迁移 ---------- */
RP_MEM.save("m1", "乙", {mood: {state: "甜蜜", filter: ""}, up_to_msg_id: "m9", up_to: 10,
short: [{id: 1, time: "昨天", fact: "一起逛街", view: "", pin: true}, {id: 2, time: "今早", fact: "吵架", view: "其实害羞"}],
long: "模糊旧印象"});
RP_MEM.renderBudgeted("m1", "乙", 600, {});
let mst = RP_MEM.get("m1", "乙");
t("迁移标记", mst.migrated3 === true);
t("pinned进profile3", mst.profile3.length === 1 && mst.profile3[0].fromPin === true && mst.profile3[0].text.indexOf("一起逛街") >= 0);
t("未置顶进event3", mst.event3.length === 1 && mst.event3[0].topic.indexOf("吵架") >= 0 && mst.event3[0].t_anchor === "今早");
t("long进record3 legacy", mst.record3.length === 1 && mst.record3[0].legacy === true);
t("迁移不丢水位", mst.up_to_msg_id === "m9" && mst.up_to === 10);
RP_MEM.renderBudgeted("m1", "乙", 600, {});
let mst2 = RP_MEM.get("m1", "乙");
t("迁移幂等", mst2.profile3.length === 1 && mst2.event3.length === 1 && mst2.record3.length === 1);

/* ---------- Controlled Writing: 分流 prompt ---------- */
const p3 = RP_MEM.buildAnalysisPrompt3("阿绫", "", {profile3: [], event3: [], record3: []}, "我: 你好\n");
t("分流prompt含三库", p3.indexOf('"profile"') >= 0 && p3.indexOf('"event"') >= 0 && p3.indexOf('"record"') >= 0);
t("分流prompt含过滤指令", p3.indexOf("drop") >= 0 && p3.indexOf("寒暄") >= 0);

/* ---------- 低信息量过滤 (drop) ---------- */
RP_MEM.save("d1", "丙", {mood: {state: "平静", filter: ""}, short: [], long: "", up_to: 0,
migrated3: true, profile3: [], event3: [], record3: []});
let rd = await RP_MEM.maybeAnalyze("d1", "丙", mkHist(12, 0), {}, async ()=>'{ "drop": true}', "");
let dst = RP_MEM.get("d1", "丙");
t("drop: 触发但三库不动", rd.analyzed === true && dst.profile3.length === 0 && dst.event3.length === 0 && dst.record3.length === 0);
t("drop: 水位照常推进", dst.up_to_msg_id === "m11");
t("drop: 心境保留", dst.mood && dst.mood.state === "平静");

/* ---------- 实质内容进对库 + record 指针 ---------- */
const newJSON = JSON.stringify({drop: false, mood: {state: "开心", filter: "看什么都顺眼"},
profile: ["喜欢吃甜点"], event: [{topic: "一起逛街买点心", t_anchor: "昨天", state: "很开心"}],
record: ["她说下次还要去那家店"]});
RP_MEM.save("e1", "丁", {mood: null, short: [], long: "", up_to: 0, migrated3: true, profile3: [], event3: [], record3: []});
let re = await RP_MEM.maybeAnalyze("e1", "丁", mkHist(12, 50), {}, async ()=>newJSON, "");
let est = RP_MEM.get("e1", "丁");
t("profile进库", re.analyzed === true && est.profile3.length === 1 && est.profile3[0].text === "喜欢吃甜点");
t("event进库", est.event3.length === 1 && est.event3[0].topic === "一起逛街买点心" && est.event3[0].t_anchor === "昨天");
t("record进库带指针", est.record3.length === 1 && est.record3[0].gist === "她说下次还要去那家店" &&
est.record3[0].msg_from === "m50" && est.record3[0].msg_to === "m61");
t("心境更新", est.mood && est.mood.state === "开心");

/* ---------- Selective Evolution: 只动 event 库 ---------- */
const newJSON2 = JSON.stringify({drop: false, mood: {state: "开心", filter: ""},
profile: ["喜欢吃甜点"],
event: [{topic: "逛街买点心", t_anchor: "今天", state: "又去了"}],
record: []});
let re2 = await RP_MEM.maybeAnalyze("e1", "丁", mkHist(24, 100), {}, async ()=>newJSON2, "");
let est2 = RP_MEM.get("e1", "丁");
t("event演化合并", re2.analyzed === true && est2.event3.length === 1 &&
(est2.event3[0].merged || 0) === 2 && est2.event3[0].state.indexOf("又去了") >= 0);
t("演化不碰profile", est2.profile3.length === 1);
t("演化不碰record", est2.record3.length === 1);

/* ---------- Adaptive Evidence Composition ---------- */
const base = {recent: 50, similar: 30, important: 20};
let rQ1 = RP_MEM.leanRatio("你喜欢吃什么", base);
t("问偏好加权important", rQ1.important > base.important && rQ1.recent === base.recent && rQ1.similar === base.similar);
let rQ2 = RP_MEM.leanRatio("之前发生了什么事", base);
t("问过去加权recent", rQ2.recent > base.recent && rQ2.important === base.important);
let rQ3 = RP_MEM.leanRatio("他原话怎么说的", base);
t("问原话加权similar", rQ3.similar > base.similar && rQ3.recent === base.recent);
let rQ0 = RP_MEM.leanRatio("", base);
t("空query保持原比例", rQ0.important === base.important && rQ0.recent === base.recent && rQ0.similar === base.similar);

RP_MEM.save("q1", "戊", {migrated3: true, mood: {state: "平静", filter: ""},
profile3: [{id: 1, text: "喜欢甜点", updatedAt: 1}],
event3: [{id: 1, topic: "逛街", t_anchor: "昨天", state: "开心", updatedAt: 1}, {id: 2, topic: "看戏", t_anchor: "前天", state: "一般", updatedAt: 1}],
record3: [{id: 1, gist: "关键原话记录", msg_from: "m1", msg_to: "m2"}],
short: [], long: ""});
let bq0 = RP_MEM.renderBudgeted("q1", "戊", 600, {});
let bqE = RP_MEM.renderBudgeted("q1", "戊", 600, {query: "之前发生了什么"});
t("集成: 问过去提升recent预算", bqE.pools.ratio.recent > bq0.pools.ratio.recent);
t("集成: important预算被压缩", bqE.pools.ratio.important < bq0.pools.ratio.important);
t("三库来源标记", bqE.pools.recent.store === "event库" && bqE.pools.similar.source === "record库" &&
bqE.pools.important.store === "profile库");
t("画像记忆标记", bqE.text.indexOf(M_PROFILE) >= 0);
t("事件标记", bqE.text.indexOf(M_EVENT) >= 0);
t("记录标记", bqE.text.indexOf(M_RECORD) >= 0);
t("record指针渲染", bqE.text.indexOf("m1") >= 0);
let bSmall = RP_MEM.renderBudgeted("q1", "戊", 100, {query: "之前发生了什么"});
let tot = bSmall.pools.important.tokens + bSmall.pools.recent.tokens + bSmall.pools.similar.tokens;
t("三库都受总预算约束", tot <= 100);

/* ---------- 旧格式 JSON 兼容 ---------- */
const oldFmt = JSON.stringify({mood: {state: "平静", filter: ""}, short: [{id: 1, time: "", fact: "旧格式事实", view: ""}], long: "旧印象"});
RP_MEM.save("c1", "己", {mood: null, short: [], long: "", up_to: 0});
let rc = await RP_MEM.maybeAnalyze("c1", "己", mkHist(12, 200), {}, async ()=>oldFmt, "");
let cst = RP_MEM.get("c1", "己");
t("旧格式兼容解析", rc.analyzed === true && cst.event3.length === 1 && cst.event3[0].topic.indexOf("旧格式事实") >= 0);
t("旧格式水位", cst.up_to_msg_id === "m211");

/* ---------- prompt.js 集成: query 透传 ---------- */
const b = RP_PROMPT.buildMessages({name: "戊", fields: {}},
{history: [], memBudgeted: {runId: "q1", name: "戊", cardId: null, query: "之前发生了什么"}},
{maxContext: 8192});
t("prompt透传query进自适应", b.stats.memPools.ratio.recent > 500);
t("stats三库来源一致", b.stats.memPools.recent.store === "event库");

/* ---------- memStats 三库计数 ---------- */
const ms = RP_MEM.memStats("e1", "丁");
t("memStats三库计数", ms.event3N === 1 && ms.recordN === 1 && ms.profileN === 1 && ms.lean === true);

/* ---------- 迁移后置顶仍在 important 池 ---------- */
RP_MEM.saveIronLaw("m1", "乙", null, "铁律测试");
let bPin = RP_MEM.renderBudgeted("m1", "乙", 10000, {});
t("置顶区保留", bPin.text.indexOf(M_PIN) >= 0);
t("画像记忆不重复置顶", (bPin.text.match(/一起逛街/g) || []).length === 1);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
})();
