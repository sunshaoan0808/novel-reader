const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// Soul 配置: Profile CRUD + 绑定优先级
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const ctx = {console, localStorage};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = {getElementById: function(){ return null; }};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/soul.js", "utf8"), ctx, {filename: "rp/soul.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_config.js", "utf8"), ctx, {filename: "rp/soul_config.js"});
const RP_SOUL = ctx.RP_SOUL, RP_SOUL_CFG = ctx.RP_SOUL_CFG;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

/* 1. Profile CRUD */
(function(){
  var r1 = RP_SOUL_CFG.add({name: "Qwen", base: "https://q/v1", key: "qk", model: "qwen-max"});
  t("add: 成功", r1.ok);
  var r2 = RP_SOUL_CFG.add({name: "Qwen"});
  t("add: 重名拒绝", !r2.ok && r2.reason === "dup_name");
  var r3 = RP_SOUL_CFG.add({name: ""});
  t("add: 空名拒绝", !r3.ok);
  t("list: 1 个", RP_SOUL_CFG.list().length === 1);
  t("get: 读到", RP_SOUL_CFG.get("Qwen").model === "qwen-max");
  RP_SOUL_CFG.del("Qwen");
  t("del: 删除", RP_SOUL_CFG.list().length === 0);
})();

/* 2. 绑定优先级: soul > chat > default */
(function(){
  RP_SOUL_CFG.add({name: "P1", model: "m1"});
  RP_SOUL_CFG.add({name: "P2", model: "m2"});
  var card = {name: "黛玉", extensions: {}};
  card.extensions.soul = RP_SOUL.fromCard(card);

  /* 无绑定: 走默认 (第一个) */
  var r0 = RP_SOUL_CFG.resolveForSoul(card, "chat1");
  t("优先级: 默认", r0.profile === "P1" && r0.level === "default");

  /* soul 绑定优先 */
  RP_SOUL.bindProfile(card, "P2");
  var r1 = RP_SOUL_CFG.resolveForSoul(card, "chat1");
  t("优先级: soul 绑定", r1.profile === "P2" && r1.level === "soul");

  /* soul 绑定不存在时回退 */
  RP_SOUL.bindProfile(card, "不存在");
  var r1b = RP_SOUL_CFG.resolveForSoul(card, "chat1");
  t("优先级: soul 绑定无效回退", r1b.level === "default");

  /* chat 覆盖 (soul 无有效绑定时) */
  RP_SOUL_CFG.setChatOverride("chat1", "P2");
  var r2 = RP_SOUL_CFG.resolveForSoul(card, "chat1");
  t("优先级: chat 覆盖", r2.profile === "P2" && r2.level === "chat");

  /* soul 绑定 > chat 覆盖 */
  RP_SOUL.bindProfile(card, "P1");
  var r3 = RP_SOUL_CFG.resolveForSoul(card, "chat1");
  t("优先级: soul > chat", r3.profile === "P1" && r3.level === "soul");

  /* 清除 chat 覆盖 */
  RP_SOUL_CFG.setChatOverride("chat1", "");
  t("chat 覆盖清除", RP_SOUL_CFG.getChatOverride("chat1") === "");
})();

/* 3. 空 Profile 列表 */
(function(){
  delete store["nd_api_profiles"];
  var card = {name: "x", extensions: {soul: RP_SOUL.blankSoul()}};
  var r = RP_SOUL_CFG.resolveForSoul(card, "c1");
  t("无 Profile: level=none", r.level === "none" && r.profile === "");
})();

console.log("\nPASS: " + pass + " FAIL: " + fail);
process.exit(fail ? 1 : 0);
