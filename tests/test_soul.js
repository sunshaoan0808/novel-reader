const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// Soul 数据层: schema / 写保护 / trajectory / 视角记忆 / profile 绑定
const ctx = {console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/soul.js", "utf8"), ctx, {filename: "rp/soul.js"});
const RP_SOUL = ctx.RP_SOUL;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

function mkCard(){
  return {
    name: "林黛玉",
    description: "潇湘妃子，寄人篱下",
    personality: "敏感,多疑,才华横溢,率真",
    fields: {hp: 80, level: 5},
    scenario: "大观园潇湘馆",
    extensions: {}
  };
}

/* 1. fromCard 生成 */
(function(){
  var soul = RP_SOUL.fromCard(mkCard());
  t("fromCard: soul_md 非空", soul.soul_md.length > 0);
  t("fromCard: 4 条 traits", soul.persona.core_traits.length === 4);
  t("fromCard: origin 来自 scenario", soul.background.origin === "大观园潇湘馆");
  t("fromCard: stats 保留 hp", soul.character.stats.hp === 80);
  t("fromCard: schema_version", soul.schema_version === RP_SOUL.SCHEMA_V);
})();

/* 2. 写保护 */
(function(){
  var card = mkCard();
  card.extensions.soul = RP_SOUL.fromCard(card);
  var cases = [
    "soul_md", "persona", "persona.core_traits",
    "background", "background.secrets",
    "rules", "rules.decision"
  ];
  var allBlocked = cases.every(function(p){
    return !RP_SOUL.write(card, p, "hacked").ok;
  });
  t("写保护: 7 条不可变路径全拒绝", allBlocked);
  /* 确认没被写坏 */
  t("写保护: persona 未被污染",
    RP_SOUL.read(card, "persona.core_traits").length === 4);
})();

/* 3. 可写路径 */
(function(){
  var card = mkCard();
  card.extensions.soul = RP_SOUL.fromCard(card);
  t("可写: character.stats", RP_SOUL.write(card, "character.stats.hp", 90).ok);
  t("可写: memory.short_term.context",
    RP_SOUL.write(card, "memory.short_term.context", {scene: "潇湘馆"}).ok);
  t("可写: 未知顶层拒绝",
    !RP_SOUL.write(card, "hacker.field", 1).ok);
  t("读取: hp=90", RP_SOUL.read(card, "character.stats.hp") === 90);
})();

/* 4. trajectory */
(function(){
  var card = mkCard();
  RP_SOUL.log(card, "黛玉", "葬花", "花冢已成");
  RP_SOUL.log(card, "宝玉", "劝慰", "黛玉稍霁");
  var traj = RP_SOUL.read(card, "trajectory");
  t("trajectory: 2 条", traj.length === 2);
  t("trajectory: 字段完整",
    traj[0].t && traj[0].actor === "黛玉" && traj[0].action === "葬花");
})();

/* 5. trajectory 压缩 */
(function(){
  var card = mkCard();
  for(var i = 0; i < 210; i++) RP_SOUL.log(card, "sys", "a" + i, "r" + i);
  var traj = RP_SOUL.read(card, "trajectory");
  t("压缩: 触发后 ≤61 条", traj.length <= 61);
  t("压缩: 首条为折叠标记", traj[0].action === "__compressed__");
  t("压缩: 保留最近原文", traj[traj.length - 1].action === "a209");
})();

/* 6. 视角记忆隔离 */
(function(){
  var card = mkCard();
  RP_SOUL.addFact(card, "黛玉", "我瞒着宝玉藏了帕子");
  RP_SOUL.addFact(card, "宝玉", "屋里没什么可疑");
  RP_SOUL.addFact(card, null, "今天下雨");
  var m1 = RP_SOUL.getMemory(card, "黛玉");
  var m2 = RP_SOUL.getMemory(card, "宝玉");
  t("视角隔离: 黛玉只见自己的", m1.perspective.length === 1 &&
    m1.perspective[0].text.indexOf("帕子") >= 0);
  t("视角隔离: 宝玉只见自己的", m2.perspective.length === 1 &&
    m2.perspective[0].text.indexOf("可疑") >= 0);
  t("视角隔离: 共享事实双方可见",
    m1.facts.length === 1 && m2.facts.length === 1);
})();

/* 7. 情感记忆 */
(function(){
  var card = mkCard();
  RP_SOUL.addEmotional(card, "悲伤", "花落人亡两不知");
  var m = RP_SOUL.getMemory(card, null);
  t("情感记忆: 写入读取", m.emotional.length === 1 &&
    m.emotional[0].emotion === "悲伤");
})();

/* 8. profile 绑定 */
(function(){
  var card = mkCard();
  t("profile: 默认空", RP_SOUL.getProfile(card) === "");
  RP_SOUL.bindProfile(card, "Qwen");
  t("profile: 绑定读取", RP_SOUL.getProfile(card) === "Qwen");
})();

/* 9. validate */
(function(){
  var card = mkCard();
  var v0 = RP_SOUL.validate(card);
  t("validate: 无 soul 包", !v0.ok);
  card.extensions.soul = RP_SOUL.fromCard(card);
  var v1 = RP_SOUL.validate(card);
  t("validate: 完整包通过", v1.ok);
  delete card.extensions.soul.memory;
  var v2 = RP_SOUL.validate(card);
  t("validate: 缺字段报错", !v2.ok && v2.issues.length > 0);
})();

/* 10. getSoul 兼容 raw.extensions */
(function(){
  var card = {raw: {extensions: {soul: RP_SOUL.blankSoul()}}};
  t("getSoul: 兼容 raw.extensions", RP_SOUL.getSoul(card) !== null);
})();

/* 11. ensureSoul 收养 raw.extensions 里的导入 soul，不建空盖掉 */
(function(){
  var imported = RP_SOUL.blankSoul();
  imported.memory = {facts: ["imported-fact"]};
  var card = {raw: {extensions: {soul: imported}}};
  var s = RP_SOUL.ensureSoul(card);
  t("ensureSoul: 返回导入的 soul（非空对象）",
    s && s.memory && s.memory.facts[0] === "imported-fact");
  t("ensureSoul: 已收养到顶层 card.extensions.soul",
    card.extensions && card.extensions.soul === s);
  /* 写操作落到被收养的对象上 */
  RP_SOUL.write(card, {kind: "fact", text: "new-fact"});
  t("ensureSoul: 写操作不丢导入数据",
    s.memory.facts.indexOf("imported-fact") >= 0);
})();

console.log("\nPASS: " + pass + " FAIL: " + fail);
process.exit(fail ? 1 : 0);
