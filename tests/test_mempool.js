const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P0 记忆缺口回归测试: 三池预算 / 铁律2000字(S-8, 对标 Nomi Shared Notes) / msg_id 水位 / Inspector 数据一致性
const store = {};
const localStorage = {
getItem: (k)=> (k in store ? store[k] : null),
setItem: (k, v)=>{ store[k] = String(v); },
removeItem: (k)=>{ delete store[k]; },
};
const ctx = {console, localStorage};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/memory.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/prompt.js", "utf8"), ctx);
const RP_MEM = vm.runInContext("RP_MEM", ctx);
const RP_PROMPT = vm.runInContext("RP_PROMPT", ctx);
const E = (code)=>vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const pt = (n, p)=>{ p && typeof p.then === "function" ? p.then(v=>t(n, !!v), e=>{ fail++; console.log("FAIL:", n, e && e.message); }) : t(n, !!p); };

/* ---------- P0-1: 三池预算 ---------- */
const seed = {mood: {state:"甜蜜", filter:"看什么都顺眼"}, short: [
{id:1, time:"昨天", fact:"一起逛街买了点心", view:""},
{id:2, time:"今早", fact:"吵了一架", view:"其实是害羞", pin:true},
{id:3, time:"刚才", fact:"和好了", view:""},
{id:4, time:"前天", fact:"一起看了场戏", view:"", pin:true},
], long:"很久以前的模糊印象：似乎一起过过年"};
RP_MEM.save("r1", "阿绫", seed);
RP_MEM.saveIronLaw("r1", "阿绫", null, "铁律：绝不在人前提起穿越者身份");

let tiny = RP_MEM.renderBudgeted("r1", "阿绫", 400, {});
t("tiny: 铁律仍在", tiny.text.indexOf("绝不在人前提起穿越者身份") >= 0);
t("tiny: 置顶区仍在(可截断)", tiny.text.indexOf("【置顶记忆】") >= 0 && tiny.text.indexOf("一起看了") >= 0);
t("tiny: important 池有条目", tiny.pools.important.items > 0);
t("tiny: 心境被挤掉", tiny.pools.important.dropped > 0);

let starve = RP_MEM.renderBudgeted("r1", "阿绫", 24, {});
t("starve: 铁律仍在(截断也不丢)", starve.text.indexOf("铁律") >= 0);
t("starve: important 池永不整段丢弃", starve.pools.important.items > 0);
t("starve: recent 被丢弃", starve.pools.recent.dropped > 0);

let full = RP_MEM.renderBudgeted("r1", "阿绫", 10000, {});
t("full: 铁律在", full.text.indexOf("绝不在人前提起穿越者身份") >= 0);
t("full: 心境在", full.text.indexOf("甜蜜") >= 0);
t("full: 长远印象在", full.text.indexOf("模糊印象") >= 0);
t("full: 未置顶近期在", full.text.indexOf("一起逛街买了点心") >= 0);
t("full: recent 无丢弃", full.pools.recent.dropped === 0 && full.pools.recent.items === 2);

/* 预算比例可调 */
localStorage.setItem("nd_rp_cfg_v1", JSON.stringify({memPoolRatio: "10/10/80"}));
t("ratio custom parsed", JSON.stringify(RP_MEM.memPoolRatio()) === JSON.stringify({recent:10, similar:10, important:80}));
localStorage.setItem("nd_rp_cfg_v1", JSON.stringify({memPoolRatio: "abc"}));
t("ratio bad falls back", RP_MEM.memPoolRatio().recent === 50);
localStorage.removeItem("nd_rp_cfg_v1");

/* ---------- P0-2: 铁律 2000 字 (S-8) ---------- */
const long500 = "律".repeat(2500); // S-8: 2000 上限
const sr = RP_MEM.saveIronLaw("r1", "阿绫", null, long500);
t("ironlaw truncates to 2000", sr.saved.length === 2000 && sr.truncated === true);
t("ironlaw read back 2000", RP_MEM.getIronLaw("r1", "阿绫", null).length === 2000);
const sr2 = RP_MEM.saveIronLaw("r1", "阿绫", null, "短律");
t("ironlaw short not truncated", sr2.truncated === false && sr2.saved === "短律");
t("ironKey fallback", RP_MEM.ironKey("r1", "阿绫", null) === "nd_ironlaw_r1_阿绫");
t("ironKey cardId", RP_MEM.ironKey("r1", "阿绫", "c123") === "nd_ironlaw_c123");
// 恢复测试用铁律
RP_MEM.saveIronLaw("r1", "阿绫", null, "铁律：绝不在人前提起穿越者身份");

/* ---------- P0-4: msg_id 水位 ---------- */
let seq = 0;
const mkHist = (n, start)=>{ const h = []; for(let i = 0; i < n; i++) h.push({mid: "m" + (start + i), role: i % 2 ? "assistant" : "user", content: "消息" + (start + i)}); return h; };
const goodJSON = JSON.stringify({mood:{state:"平静", filter:""}, short:[{id:1, time:"", fact:"测试事实内容足够长", view:""}], long:""});
let seenPrompts = [];
const callChat = async (c, ms, tmp)=>{ seenPrompts.push(ms[0].content); return goodJSON; };

(async ()=>{
// 20 条消息, 周期 10 -> 触发分析, 水位记到 m19
let h = mkHist(20, 0);
let r = await RP_MEM.maybeAnalyze("r2", "小红", h, {}, callChat, "");
t("analyze triggered", r.analyzed === true);
let st = RP_MEM.get("r2", "小红");
t("water is msg id", st.up_to_msg_id === "m19");
t("water idx backup", st.up_to === 20);

// 删掉水位之前的一条 (delMsg), 再加 3 条 (水位后 3 条 < 10) -> 不触发, 不重复摘要
seenPrompts = [];
h.splice(5, 1);
let r2 = await RP_MEM.maybeAnalyze("r2", "小红", h.concat(mkHist(3, 100)), {}, callChat, "");
t("delMsg before water: no re-analyze", r2.analyzed === false && seenPrompts.length === 0);

// 追加 10 条新消息 -> 触发, 新消息只从水位后开始 (不重复摘要旧消息)
seenPrompts = [];
const h2 = h.concat(mkHist(3, 100)).concat(mkHist(10, 200));
let r4 = await RP_MEM.maybeAnalyze("r2", "小红", h2, {}, callChat, "");
t("new msgs trigger", r4.analyzed === true && seenPrompts.length === 1);
t("no duplicate summary", seenPrompts[0].indexOf("我: 消息0\n") < 0 && seenPrompts[0].indexOf("我: 消息200\n") >= 0);
t("water advanced", RP_MEM.get("r2", "小红").up_to_msg_id === "m209");

// 删掉水位消息本身 -> 回退索引水位, 不崩; 追加 12 条后仍能触发
h2.splice(h2.findIndex(m=>m.mid === "m209"), 1);
seenPrompts = [];
const h4 = h2.concat(mkHist(12, 300));
let r3 = await RP_MEM.maybeAnalyze("r2", "小红", h4, {}, callChat, "");
t("water msg deleted: no crash, still triggers", r3.analyzed === true && seenPrompts.length === 1);

// 老状态迁移: 只有 up_to 索引
RP_MEM.save("r3", "小蓝", {mood: null, short: [], long: "", up_to: 10});
seenPrompts = [];
let h3 = mkHist(20, 300);
let r5 = await RP_MEM.maybeAnalyze("r3", "小蓝", h3, {}, callChat, "");
t("legacy up_to migrated", r5.analyzed === true && seenPrompts[0].indexOf("消息300") < 0 && seenPrompts[0].indexOf("消息310") >= 0);
t("migrated water is id", RP_MEM.get("r3", "小蓝").up_to_msg_id === "m319");

/* ---------- P0-5: Inspector 与 stats 一致 ---------- */
const mb = RP_MEM.renderBudgeted("r1", "阿绫", 1000, {});
const b = RP_PROMPT.buildMessages({name: "阿绫", fields: {}},
{history: [], memBudgeted: {runId: "r1", name: "阿绫", cardId: null}, memTasks: ""},
{maxContext: 8192});
t("stats.memPools matches", JSON.stringify(b.stats.memPools) === JSON.stringify(mb.pools));
t("segTokens.memory tracked", (b.stats.segTokens.memory || 0) > 0);
t("inspector: important items match", b.stats.memPools.important.items === mb.pools.important.items);
// 模拟 app.js recordLastPrompt
const lp = {stats: b.stats, hasWorldsim: !!b.stats.hasWorldsim, hasDirector: !!b.stats.hasDirector, memPools: b.stats.memPools};
t("inspector payload complete", lp.stats && lp.memPools && ("hasWorldsim" in lp) && ("hasDirector" in lp));

/* ---------- v36: 事件簿条目可编辑 ---------- */
RP_MEM.save("r9", "小九", {short: [{id: 11, time: "昨天", fact: "一起逛街", view: ""}]});
let er = RP_MEM.editItem("r9", "小九", 11, {fact: "一起逛街买了点心", view: "很开心", time: "三月初三"});
t("editItem 返回 ok", er.ok === true);
let st9 = RP_MEM.get("r9", "小九");
t("editItem 改事实", st9.short[0].fact === "一起逛街买了点心");
t("editItem 改看法", st9.short[0].view === "很开心");
t("editItem 改时间", st9.short[0].time === "三月初三");
t("editItem 空事实拒绝", RP_MEM.editItem("r9", "小九", 11, {fact: "  "}).ok === false);
t("editItem 不存在 id", RP_MEM.editItem("r9", "小九", 999, {fact: "x"}).ok === false);
t("editItem 导出存在", typeof RP_MEM.editItem === "function");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})();
