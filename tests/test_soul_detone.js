const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// Soul 去AI味模块: prompt 注入 + 确定性后处理 (mock localStorage, 不烧 token)
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const ctx = {console, localStorage};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/soul.js", "utf8"), ctx, {filename: "rp/soul.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_detone.js", "utf8"), ctx, {filename: "rp/soul_detone.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_orch.js", "utf8"), ctx, {filename: "rp/soul_orch.js"});
const RP_DETONE = ctx.RP_DETONE, RP_SOUL_ORCH = ctx.RP_SOUL_ORCH, RP_SOUL = ctx.RP_SOUL;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };
const eq = (a, b) => String(a) === String(b);

function reset(){ for(const k in store) delete store[k]; }

async function main(){
  reset();
  /* 默认开启 */
  t("默认开启", RP_DETONE.isEnabled() === true);

  /* 1. R1 翻案腔：不是……而是…… */
  t("R1: 不是…而是→是",
    eq(RP_DETONE.cleanText("真正的壁垒不是技术，而是认知。"), "真正的壁垒是认知。"));
  t("R1: 无逗号版",
    eq(RP_DETONE.cleanText("这不是工具的问题而是思维方式的问题。"), "这是思维方式的问题。"));
  t("R1: 并非变体",
    eq(RP_DETONE.cleanText("这并非运气，而是实力。"), "这是实力。"));
  t("R1: 不在于变体",
    eq(RP_DETONE.cleanText("问题不在于钱，而在于人。"), "问题在于人。"));
  t("R1: 与其说变体",
    eq(RP_DETONE.cleanText("与其说他是累，不如说他是心死了。"), "他是心死了。"));

  /* 2. R9 起手式 */
  t("R9: 说白了",
    eq(RP_DETONE.cleanText("说白了，这个项目预算不足。"), "这个项目预算不足。"));
  t("R9: 分句首",
    eq(RP_DETONE.cleanText("他很累。说白了，就是不想干了。"), "他很累。就是不想干了。"));

  /* 3. R5a 提示语冒号 */
  t("R5a: 一句话总结",
    eq(RP_DETONE.cleanText("一句话总结：这个方案成本太高。"), "这个方案成本太高。"));
  t("R5a: 核心是",
    eq(RP_DETONE.cleanText("核心是：先解决支付问题。"), "先解决支付问题。"));

  /* 4. 正常对话不被误伤 */
  t("不误伤: 无而是的不是句",
    eq(RP_DETONE.cleanText("你不是要走吗？"), "你不是要走吗？"));
  t("不误伤: 普通陈述",
    eq(RP_DETONE.cleanText("我今天很开心。"), "我今天很开心。"));
  t("不误伤: 他说冒号 (非提示语)",
    eq(RP_DETONE.cleanText("他说：明天再谈。"), "他说：明天再谈。"));
  t("不误伤: R10 翻译腔只走 prompt 层，后处理不动",
    eq(RP_DETONE.cleanText("然而，这个方案并不适用。"), "然而，这个方案并不适用。"));
  t("不误伤: 空串/空值",
    RP_DETONE.cleanText("") === "" && RP_DETONE.cleanText(null) === "");

  /* 5. cleanReply 三字段 */
  var r = RP_DETONE.cleanReply({dialogue: "说白了，我不是针对你，而是就事论事。",
    action: "真正的关键不是速度，而是方向。", inner: "核心是：先冷静。",
    silence: false, extra: 123});
  t("cleanReply: dialogue", eq(r.dialogue, "我是就事论事。"));
  t("cleanReply: action", eq(r.action, "真正的关键是方向。"));
  t("cleanReply: inner", eq(r.inner, "先冷静。"));
  t("cleanReply: 非字符串字段保留", r.silence === false && r.extra === 123);

  /* 6. 开关关闭时零影响 */
  RP_DETONE.setEnabled(false);
  t("关闭后 isEnabled false", RP_DETONE.isEnabled() === false);
  var dirty = "说白了，真正的壁垒不是技术，而是认知。一句话总结：不行。";
  t("关闭后 cleanText 原样返回", RP_DETONE.cleanText(dirty) === dirty);
  var ro = {dialogue: dirty, action: dirty, silence: false};
  t("关闭后 cleanReply 返回同一对象", RP_DETONE.cleanReply(ro) === ro);
  t("关闭后 promptBlock 为空", RP_DETONE.promptBlock() === "");
  RP_DETONE.setEnabled(true);
  t("重新开启", RP_DETONE.isEnabled() === true);

  /* 7. promptBlock 内容 */
  var pb = RP_DETONE.promptBlock();
  t("promptBlock 非空", pb.length > 50);
  t("promptBlock 含去AI味标记", pb.indexOf("去AI味") >= 0);
  t("promptBlock 含文风卡优先条款", pb.indexOf("文风卡") >= 0);

  /* 8. 集成: buildSoulPrompt 注入 */
  var card = {name: "黛玉", description: "黛玉其人", fields: {}, scenario: "", extensions: {}};
  card.extensions.soul = RP_SOUL.fromCard(card);
  var p1 = RP_SOUL_ORCH.buildSoulPrompt(card, "黛玉", "大观园", "你好", []);
  t("buildSoulPrompt 含去AI味指令", p1.indexOf("去AI味") >= 0);
  RP_DETONE.setEnabled(false);
  var p2 = RP_SOUL_ORCH.buildSoulPrompt(card, "黛玉", "大观园", "你好", []);
  t("关闭后 prompt 无去AI味指令", p2.indexOf("去AI味") < 0);
  RP_DETONE.setEnabled(true);

  /* 9. 未加载 RP_DETONE 时 soul_orch 不崩 (向后兼容) */
  const ctx2 = {console, localStorage};
  ctx2.window = ctx2; ctx2.globalThis = ctx2;
  vm.createContext(ctx2);
  vm.runInContext(fs.readFileSync(WWW + "/rp/soul.js", "utf8"), ctx2, {filename: "rp/soul.js"});
  vm.runInContext(fs.readFileSync(WWW + "/rp/soul_orch.js", "utf8"), ctx2, {filename: "rp/soul_orch.js"});
  var card2 = {name: "宝玉", fields: {}, extensions: {}};
  card2.extensions.soul = ctx2.RP_SOUL.fromCard(card2);
  var p3 = ctx2.RP_SOUL_ORCH.buildSoulPrompt(card2, "宝玉", "", "hi", []);
  t("无 RP_DETONE 时 buildSoulPrompt 正常", p3.indexOf("输出 JSON") >= 0 && p3.indexOf("去AI味") < 0);
  var pr = ctx2.RP_SOUL_ORCH.parseSoulReply('{"dialogue":"说白了好","action":"","inner":"","silence":false}');
  t("无 RP_DETONE 时 parseSoulReply 不清洗", pr.dialogue === "说白了好");

  console.log("\nPASS: " + pass + " FAIL: " + fail);
  process.exit(fail ? 1 : 0);
}
main();
