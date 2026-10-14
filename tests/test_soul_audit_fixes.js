/* 2026-10-14 浮生审计修复回归: P0 参数错位 / P1 key 不匹配+groupKey 碰撞 / P2 命名空间 / P3 死代码 */
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const ctx = {console, localStorage, setTimeout, clearTimeout, Promise};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
const promptsSeen = [];
ctx.RP_NET = {
  complete: function(cfg, messages, temp){
    var last = messages[messages.length - 1].content;
    promptsSeen.push(last);
    return Promise.resolve(JSON.stringify({dialogue: "好", action: "点头", inner: "", silence: false}));
  }
};
var cards = {};
ctx.RP = {findCard: function(runId, name){ return cards[name] || null; }};
vm.runInContext(fs.readFileSync(WWW + "/rp/soul.js", "utf8"), ctx, {filename: "rp/soul.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_runtime.js", "utf8"), ctx, {filename: "rp/soul_runtime.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_orch.js", "utf8"), ctx, {filename: "rp/soul_orch.js"});
const RP_SOUL = ctx.RP_SOUL, RP_SOUL_ORCH = ctx.RP_SOUL_ORCH;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };
function mkCard(name, personality){
  var c = {name: name, description: name + "传", personality: personality || "温柔,聪慧",
    fields: {}, scenario: "", extensions: {}};
  c.extensions.soul = RP_SOUL.fromCard(c);
  cards[name] = c;
  return c;
}

async function main(){
  mkCard("黛玉");

  /* P0: twoStageCall 必须把 card(不是 soul 对象/名字符串)传给 buildSoulPrompt */
  promptsSeen.length = 0;
  var card = cards["黛玉"];
  var r = await RP_SOUL_ORCH.twoStageCall("黛玉", card, "大观园", "你好", [],
    {think: {name: "t"}, speak: {name: "s"}}, {});
  t("P0: 两阶段调用成功", r && r.ok === true);
  t("P0: think 阶段 prompt 有人设", promptsSeen[0].indexOf("你是黛玉") >= 0);
  t("P0: think 阶段 prompt 有性格", promptsSeen[0].indexOf("温柔") >= 0);
  t("P0: think 阶段无 [object Object]", promptsSeen[0].indexOf("[object Object]") < 0);
  t("P0: speak 阶段 prompt 有人设", promptsSeen[1].indexOf("你是黛玉") >= 0);
  t("P0: speak 阶段无 [object Object]", promptsSeen[1].indexOf("[object Object]") < 0);
  /* 源码级: twoStageCall 内两次调用首参必须是 card */
  var src = fs.readFileSync(WWW + "/rp/soul_orch.js", "utf8");
  var calls = src.match(/buildSoulPrompt\((card|soul|soulName), soulName,/g) || [];
  t("P0: 源码两次调用首参都是 card", calls.length === 2 && calls.every(function(c){ return c.indexOf("(card,") >= 0; }));

  /* P1: saveChatParams / saveChatSoulProfile 必须走 soulChatId() */
  var appSrc = fs.readFileSync(WWW + "/app.js", "utf8");
  var scp = appSrc.match(/window\.saveChatParams = \(\)=>\{[\s\S]*?\n\};/);
  var scsp = appSrc.match(/window\.saveChatSoulProfile = \(\)=>\{[\s\S]*?\n\};/);
  t("P1: saveChatParams 用 soulChatId()", scp && scp[0].indexOf("soulChatId()") >= 0);
  t("P1: saveChatSoulProfile 用 soulChatId()", scsp && scsp[0].indexOf("soulChatId()") >= 0);
  t("P1: 不再用 chatKey(runId, CHAT.name)", scp[0].indexOf("CHAT.name") < 0 && scsp[0].indexOf("CHAT.name") < 0);

  /* P1: groupKey 碰撞免疫 + 老 key 兼容 */
  var gkm = appSrc.match(/^const groupKey = .*$/m);
  var groupKey = eval("(" + gkm[0].replace(/^const groupKey =\s*/, "").replace(/;$/, "") + ")");
  t("P1: groupKey 碰撞消除", groupKey("r1", ["a_b", "c"]) !== groupKey("r1", ["a", "b_c"]));
  t("P1: 无下划线名字 key 不变(兼容老数据)", groupKey("r1", ["a", "b"]) === "nd_group_r1_a_b");
  t("P1: 成员顺序不影响", groupKey("r1", ["b", "a"]) === groupKey("r1", ["a", "b"]));

  /* P2: per-soul key 按 runId 命名空间隔离 (经 sendGroupSoul 入口设置) */
  await RP_SOUL_ORCH.sendGroupSoul("rX", ["黛玉"], "hi", {
    cfg: {base: "https://f/v1", key: "k", model: "m"}, history: [], chatId: "cX"
  });
  RP_SOUL_ORCH.setChattiness("黛玉", "chatty");
  t("P2: chatty 写命名空间 key", store["nd_soul_chatty_rX_黛玉"] === "chatty");
  t("P2: 不污染无命名空间 key", !("nd_soul_chatty_黛玉" in store));
  /* 读回退: 老 key 数据仍可读 */
  store["nd_soul_chatty_宝玉"] = "quiet";
  await RP_SOUL_ORCH.sendGroupSoul("rY", ["宝玉"], "hi", {
    cfg: {base: "https://f/v1", key: "k", model: "m"}, history: [], chatId: "cY"
  });
  t("P2: 老 key 回退可读", RP_SOUL_ORCH.getChattiness("宝玉") === 0.3);

  /* P3: index.html 不再加载死代码模块 */
  var html = fs.readFileSync(WWW + "/index.html", "utf8");
  var dead = ["soul_y.js", "soul_zz.js", "soul_aa.js", "soul_ab.js", "soul_ac.js",
    "soul_ad.js", "soul_ae.js", "soul_af.js", "soul_ag.js", "soul_ah.js",
    "soul_ai.js", "soul_aj.js", "soul_ak.js"];
  t("P3: 13 个死模块无 script 标签", dead.every(function(f){ return html.indexOf(f) < 0; }));

  console.log("\nPASS: " + pass + " FAIL: " + fail);
  process.exit(fail ? 1 : 0);
}
main().catch(function(e){ console.log("FATAL:", e); process.exit(1); });
