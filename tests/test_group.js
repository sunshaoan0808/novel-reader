const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 群聊 v2: planSpeakers / findMentioned / nextInList / talkativeness / order
const src = fs.readFileSync(WWW+"/rp/group.js", "utf8");
const ctx = {console};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const G = vm.runInContext("RP_GROUP", ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

const MS = ["贾宝玉", "林黛玉", "薛宝钗", "王熙凤"];

// 点名
t("点名全名", G.findMentioned("宝钗你怎么看", MS).join() === "薛宝钗");
t("点名去姓简称", G.findMentioned("黛玉来了", MS).join() === "林黛玉");
t("无点名", G.findMentioned("今天天气不错", MS).length === 0);
t("点名多人", G.findMentioned("宝玉黛玉都来", MS).join() === "贾宝玉,林黛玉");
// 简称重名冲突时不点
t("简称冲突不误点",
  G.findMentioned("熙凤来了", ["王熙凤", "李熙凤"]).length === 0);

// planSpeakers: 被点名者优先（其余 talk=0 不激活）
let sp = G.planSpeakers("宝钗你怎么看", MS, {"贾宝玉":0,"林黛玉":0,"薛宝钗":0,"王熙凤":0}, null);
t("点名优先且唯一", sp.join() === "薛宝钗");

// talkativeness 100 全激活，上限 3
sp = G.planSpeakers("大家好", MS, {"贾宝玉":100,"林黛玉":100,"薛宝钗":100,"王熙凤":100}, null);
t("全员激活上限3", sp.length === 3);
t("激活按成员顺序", sp.join() === "贾宝玉,林黛玉,薛宝钗");

// talkativeness 0 无人激活 → 随机兜底恰好 1 人
sp = G.planSpeakers("大家好", MS, {"贾宝玉":0,"林黛玉":0,"薛宝钗":0,"王熙凤":0}, "贾宝玉");
t("兜底恰好1人", sp.length === 1);
t("兜底不连庄", sp[0] !== "贾宝玉");

// 点名 + talk 激活混合：点名排第一
sp = G.planSpeakers("@王熙凤", MS, {"贾宝玉":100,"林黛玉":0,"薛宝钗":0,"王熙凤":0}, null);
t("点名排第一", sp[0] === "王熙凤" && sp.includes("贾宝玉"));

// 兼容接口
t("pickSpeaker 单人", G.pickSpeaker("宝钗你怎么看", MS, null, null) === "薛宝钗");

// 轮流
t("nextInList 轮转", G.nextInList(MS, "林黛玉") === "薛宝钗");
t("nextInList 回绕", G.nextInList(MS, "王熙凤") === "贾宝玉");
t("nextInList 无上轮", G.nextInList(MS, null) === "贾宝玉");

// 默认值（node 无 localStorage）
t("getTalk 默认50", G.getTalk("r1", "贾宝玉") === 50);
t("getOrder 默认natural", G.getOrder("r1", "k") === "natural");
t("MAX_SPEAKERS 为3", G.MAX_SPEAKERS === 3);

console.log(`\ngroup v2: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
