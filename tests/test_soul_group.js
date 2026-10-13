const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// Soul 群聊集成: shouldUseSoulMode + sendGroupSoul (mock)
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const ctx = {console, localStorage, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
ctx.RP_NET = {
  complete: function(cfg, messages, temp){
    var last = messages[messages.length - 1].content;
    /* Selector 判断 */
    if(last.indexOf("群聊导演") >= 0){
      return Promise.resolve('{"speakers":["黛玉"],"reactions":[]}');
    }
    var who = last.indexOf("你是黛玉") >= 0 ? "黛玉" : "宝玉";
    return Promise.resolve(JSON.stringify(
      {dialogue: who + "道好", action: who + "点头", inner: "", silence: false}));
  }
};
/* findCard mock: 真实页面里 findCard 只活在 chat.js 的 RP IIFE 中 (RP.findCard),
 * 没有全局 findCard。2026-10-13 前此处 stub 了全局 findCard, 导致接线 bug
 * (soul_orch.js 裸 findCard 恒 undefined) 在测试里永远测不出来。
 * 现在按真实作用域 stub, 并加回归断言。 */
var cards = {};
ctx.RP = {findCard: function(runId, name){ return cards[name] || null; }};
vm.runInContext(fs.readFileSync(WWW + "/rp/soul.js", "utf8"), ctx, {filename: "rp/soul.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_runtime.js", "utf8"), ctx, {filename: "rp/soul_runtime.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_orch.js", "utf8"), ctx, {filename: "rp/soul_orch.js"});
const RP_SOUL = ctx.RP_SOUL, RP_SOUL_ORCH = ctx.RP_SOUL_ORCH;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

function mkCard(name){
  var c = {name: name, description: name, personality: "温柔",
    fields: {}, scenario: "", extensions: {}};
  c.extensions.soul = RP_SOUL.fromCard(c);
  cards[name] = c;
  return c;
}

async function main(){
  mkCard("黛玉"); mkCard("宝玉");

  /* 0. 回归: 真实页面无全局 findCard, 接线必须走 RP.findCard */
  t("回归: 无全局findCard", typeof ctx.findCard === "undefined");
  t("回归: 经RP.findCard仍触发", RP_SOUL_ORCH.shouldUseSoulMode("r1", ["黛玉", "宝玉"], "c1") === true);

  /* 1. shouldUseSoulMode: 2 人有 soul 包 */
  t("触发: 2 soul", RP_SOUL_ORCH.shouldUseSoulMode("r1", ["黛玉", "宝玉"], "c1") === true);

  /* 2. shouldUseSoulMode: 1 人不够 */
  t("触发: 1 人不够", RP_SOUL_ORCH.shouldUseSoulMode("r1", ["黛玉"], "c1") === false);

  /* 3. shouldUseSoulMode: 开关关闭 */
  RP_SOUL_ORCH.setSoulMode("c1", false);
  t("触发: 开关关", RP_SOUL_ORCH.shouldUseSoulMode("r1", ["黛玉", "宝玉"], "c1") === false);
  RP_SOUL_ORCH.setSoulMode("c1", true);
  t("触发: 开关开", RP_SOUL_ORCH.shouldUseSoulMode("r1", ["黛玉", "宝玉"], "c1") === true);

  /* 4. sendGroupSoul 全流程 */
  var h = [];
  var r = await RP_SOUL_ORCH.sendGroupSoul("r1", ["黛玉", "宝玉"], "大家好", {
    cfg: {base: "https://f/v1", key: "k", model: "m"},
    history: h, chatId: "c1"
  });
  t("群聊: mode=soul", r.mode === "soul");
  t("群聊: 有文本", r.text && r.text.length > 0);
  t("群聊: speakers", r.speakers.indexOf("黛玉") >= 0);
  t("群聊: 历史 push", h.length === 1 && h[0]._soul === true);
  t("群聊: stats", r.stats && typeof r.stats === "object");

  /* 5. trajectory 记录 */
  var traj = RP_SOUL.read(cards["黛玉"], "trajectory");
  t("trajectory: 记录", traj.length >= 1 && traj[0].actor === "黛玉");

  /* 6. 无 soul 包成员自动生成 */
  delete cards["宝玉"];
  var h2 = [];
  var r2 = await RP_SOUL_ORCH.sendGroupSoul("r1", ["黛玉", "宝玉"], "hi", {
    cfg: {base: "https://f/v1", key: "k", model: "m"},
    history: h2, chatId: "c1", selectMode: "auto"
  });
  /* 宝玉无 soul 包, shouldUseSoulMode 会 false, 但直接调 sendGroupSoul 应能跑 */
  t("无包成员: 能跑", r2.mode === "soul");

  console.log("\nPASS: " + pass + " FAIL: " + fail);
  process.exit(fail ? 1 : 0);
}

main().catch(function(e){ console.log("FATAL:", e); process.exit(1); });
