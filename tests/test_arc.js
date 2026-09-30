const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P0-3: 十人物弧光写回 + RP_ARC 模块
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
key: i => Object.keys(store)[i] || null,
get length(){ return Object.keys(store).length; },
};
const ctx = {localStorage, console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/data.js", "utf8"), ctx, {filename: "data.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/arc.js", "utf8"), ctx, {filename: "rp/arc.js"});
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

const NAMES = ["刘姥姥","晴雯","林黛玉","王夫人","王熙凤","秦钟","薛宝钗","袭人","贾宝玉","贾母"];
const cards = vm.runInContext("__DATA__.rp_cards.honglou_full", ctx);
t("红楼卡10张", Array.isArray(cards) && cards.length === 10);
const byName = {};
for(const c of cards) byName[c.name] = c;

// ---- 任务1: 10 卡弧光字段非空 ----
for(const n of NAMES){
  const f = (byName[n] && byName[n].fields) || {};
  t(n + " arc_type非空", !!f.arc_type);
  t(n + " arc_start非空", !!f.arc_start);
  t(n + " arc_mid非空", !!f.arc_mid);
  t(n + " arc_end非空", !!f.arc_end);
  t(n + " timeline_stage非空", !!f.timeline_stage);
}
// 弧光类型取值符合文档
const expType = {"林黛玉":"fall","贾宝玉":"awakening","薛宝钗":"flat","王熙凤":"fall",
"贾母":"flat","王夫人":"awakening","袭人":"fall","晴雯":"fall","刘姥姥":"rise","秦钟":"fall"};
for(const n of NAMES) t(n + " arc_type=" + expType[n], byName[n].fields.arc_type === expType[n]);

// ---- 黛玉旧值已替换 ----
t("黛玉arc_start不再是旧分块值",
  byName["林黛玉"].fields.arc_start !== "冷面妒意、以反话伤人");
t("黛玉arc_start含入府开局", byName["林黛玉"].fields.arc_start.indexOf("黛玉入府之初") >= 0);

// ---- 任务2: RP_ARC ----
t("RP_ARC已加载", vm.runInContext("typeof RP_ARC", ctx) === "object");
for(const n of NAMES){
  const p = vm.runInContext(
    "RP_ARC.renderArcPrompt(" + JSON.stringify(byName[n]) + ", 'honglou_full')", ctx);
  t(n + " prompt含timeline_stage", p.indexOf(byName[n].fields.timeline_stage) >= 0);
  t(n + " prompt300字内", p.length <= 300);
  t(n + " prompt非空", p.length > 0);
}
const dySum = vm.runInContext(
  "RP_ARC.arcSummary(" + JSON.stringify(byName["林黛玉"]) + ", 'honglou_full')", ctx);
t("arcSummary结构", dySum.type === "fall" && dySum.stage === "大观园诗社时期"
  && typeof dySum.start === "string" && Array.isArray(dySum.mids) && typeof dySum.end === "string");
t("黛玉mids=5", dySum.mids.length === 5);
t("arcSummary typeLabel", dySum.typeLabel === "陨落");
const dyPrompt = vm.runInContext(
  "RP_ARC.renderArcPrompt(" + JSON.stringify(byName["林黛玉"]) + ", 'honglou_full')", ctx);
t("黛玉prompt含陨落弧", dyPrompt.indexOf("陨落弧") >= 0);
t("黛玉prompt含起承转合", dyPrompt.indexOf("起：") >= 0 && dyPrompt.indexOf("转：") >= 0 && dyPrompt.indexOf("合：") >= 0);

// ---- 阶段覆盖值优先生效 ----
const key = "nd_arcstage_honglou_full_林黛玉";
localStorage.setItem(key, "宝玉成婚时期");
const ovStage = vm.runInContext(
  "RP_ARC.getStage(" + JSON.stringify(byName["林黛玉"]) + ", 'honglou_full')", ctx);
t("覆盖值优先", ovStage === "宝玉成婚时期");
const ovPrompt = vm.runInContext(
  "RP_ARC.renderArcPrompt(" + JSON.stringify(byName["林黛玉"]) + ", 'honglou_full')", ctx);
t("prompt用覆盖阶段", ovPrompt.indexOf("宝玉成婚时期") >= 0);
t("覆盖后仍300字内", ovPrompt.length <= 300);
localStorage.removeItem(key);
const backStage = vm.runInContext(
  "RP_ARC.getStage(" + JSON.stringify(byName["林黛玉"]) + ", 'honglou_full')", ctx);
t("清除覆盖回默认值", backStage === "大观园诗社时期");

// ---- setStage 写入/清除 ----
vm.runInContext("RP_ARC.setStage(" + JSON.stringify(byName["晴雯"]) + ", 'honglou_full', '大观园诗社时期')", ctx);
t("setStage写入覆盖", localStorage.getItem("nd_arcstage_honglou_full_晴雯") === "大观园诗社时期");
vm.runInContext("RP_ARC.setStage(" + JSON.stringify(byName["晴雯"]) + ", 'honglou_full', '怡红院时期')", ctx);
t("setStage选回默认清覆盖", localStorage.getItem("nd_arcstage_honglou_full_晴雯") === null);

// ---- 无弧光卡片 ----
const empty = vm.runInContext("RP_ARC.renderArcPrompt({name:'路人',fields:{}}, 'x')", ctx);
t("无弧光卡prompt为空", empty === "");

console.log(`arc: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
