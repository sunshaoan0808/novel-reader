const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// Soul 编排层: Selector / 并行 / 整合 / 降级 (mock LLM, 不烧 token)
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const ctx = {console, localStorage, setTimeout: setTimeout, clearTimeout: clearTimeout,
  Promise: Promise};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
/* RP_NET mock: 可编程的 fake */
ctx.RP_NET = {
  _fn: null,
  complete: function(cfg, messages, temp, modelOverride, extra){
    if(ctx.RP_NET._fn) return ctx.RP_NET._fn(cfg, messages, temp, modelOverride, extra);
    return Promise.resolve("{\"dialogue\":\"你好\",\"action\":\"\",\"inner\":\"\",\"silence\":false}");
  }
};
vm.runInContext(fs.readFileSync(WWW + "/rp/soul.js", "utf8"), ctx, {filename: "rp/soul.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_runtime.js", "utf8"), ctx, {filename: "rp/soul_runtime.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_orch.js", "utf8"), ctx, {filename: "rp/soul_orch.js"});
const RP_SOUL = ctx.RP_SOUL, RP_SOUL_RT = ctx.RP_SOUL_RT, RP_SOUL_ORCH = ctx.RP_SOUL_ORCH;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

function mkSoulCard(name, secret){
  var card = {name: name, description: name + "其人", personality: "温柔,坚韧",
    fields: {}, scenario: "", extensions: {}};
  card.extensions.soul = RP_SOUL.fromCard(card);
  if(secret) RP_SOUL.getSoul(card).background.secrets = secret; /* 直接写(测试用,绕过保护) */
  return card;
}

async function main(){
  var cfg = {base: "https://fake/v1", key: "k", model: "m"};

  /* 1. 确定性选人: @提及 */
  var souls = [{name: "黛玉"}, {name: "宝玉"}];
  var d1 = RP_SOUL_ORCH.deterministicSelect("你好 @黛玉", souls, {});
  t("Selector: @提及命中", d1.speakers[0] === "黛玉" && d1.via === "mention");

  /* 2. 确定性选人: 轮询 */
  var d2 = RP_SOUL_ORCH.deterministicSelect("hi", souls, {mode: "roundrobin", lastIdx: 0});
  t("Selector: 轮询", d2.speakers[0] === "宝玉" && d2.via === "roundrobin");

  /* 3. LLM 选人 (mock) */
  ctx.RP_NET._fn = function(){
    return Promise.resolve('{"speakers":["宝玉"],"reactions":[{"name":"黛玉","type":"旁观"}]}');
  };
  var s1 = await RP_SOUL_ORCH.llmSelect("宝玉你怎么看", souls, [], cfg,
    function(c, m, tmp){ return ctx.RP_NET.complete(c, m, tmp); });
  t("Selector: LLM 选人", s1.speakers[0] === "宝玉" && s1.reactions[0].name === "黛玉");

  /* 4. LLM 选人失败降级 */
  ctx.RP_NET._fn = function(){ return Promise.reject(new Error("挂了")); };
  var s2 = await RP_SOUL_ORCH.llmSelect("hi", souls, [], cfg,
    function(c, m, tmp){ return ctx.RP_NET.complete(c, m, tmp); });
  t("Selector: 失败降级首个", s2.speakers[0] === "黛玉" && s2.via === "fallback");

  /* 5. per-soul prompt 隔离: 秘密只给自己 */
  var cardA = mkSoulCard("黛玉", "黛玉藏了帕子");
  var cardB = mkSoulCard("宝玉", "宝玉丢了玉");
  var pA = RP_SOUL_ORCH.buildSoulPrompt(cardA, "黛玉", "大观园", "你好", []);
  var pB = RP_SOUL_ORCH.buildSoulPrompt(cardB, "宝玉", "大观园", "你好", []);
  t("隔离: A 的 prompt 有 A 的秘密", pA.indexOf("帕子") >= 0);
  t("隔离: A 的 prompt 无 B 的秘密", pA.indexOf("丢了玉") < 0);
  t("隔离: B 的 prompt 无 A 的秘密", pB.indexOf("帕子") < 0);

  /* 6. 回包解析: 结构化 */
  var r1 = RP_SOUL_ORCH.parseSoulReply('{"dialogue":"好","action":"点头","inner":"想","silence":false}');
  t("解析: 结构化", r1.structured && r1.dialogue === "好" && r1.action === "点头");

  /* 7. 回包解析: 降级纯文本 */
  var r2 = RP_SOUL_ORCH.parseSoulReply("今天天气不错");
  t("解析: 纯文本降级", !r2.structured && r2.dialogue === "今天天气不错");

  /* 8. 回包解析: silence */
  var r3 = RP_SOUL_ORCH.parseSoulReply('{"dialogue":"","action":"","inner":"","silence":true}');
  t("解析: silence", r3.silence === true);

  /* 9. 并行调用 (mock) */
  ctx.RP_NET._fn = function(cfg, messages){
    var who = messages[messages.length - 1].content.indexOf("你是黛玉") >= 0 ? "黛玉" : "宝玉";
    return Promise.resolve(JSON.stringify(
      {dialogue: who + "说", action: who + "点头", inner: "", silence: false}));
  };
  var or = await RP_SOUL_ORCH.run(
    [{card: cardA, name: "黛玉"}, {card: cardB, name: "宝玉"}],
    "大观园", "大家好", [], {cfg: cfg, turnId: "test1"});
  t("并行: 2 个都 ok", or.results.length === 2 && or.results.every(function(r){ return r.ok; }));
  t("并行: 各自回包", or.results[0].reply.dialogue.indexOf("黛玉") >= 0);

  /* 10. 降级: 某个 soul 失败不传染 */
  var callCount = 0;
  ctx.RP_NET._fn = function(cfg, messages){
    callCount++;
    var who = messages[messages.length - 1].content.indexOf("你是黛玉") >= 0 ? "黛玉" : "宝玉";
    if(who === "黛玉") return Promise.reject(new Error("黛玉挂了"));
    return Promise.resolve('{"dialogue":"宝玉说","action":"","inner":"","silence":false}');
  };
  /* 注意: 降级链会试 profile 再试默认, 黛玉会调 2 次都失败 */
  var or2 = await RP_SOUL_ORCH.run(
    [{card: cardA, name: "黛玉"}, {card: cardB, name: "宝玉"}],
    "大观园", "hi", [], {cfg: cfg, turnId: "test2"});
  var okCount = or2.results.filter(function(r){ return r.ok; }).length;
  t("降级: 失败隔离", okCount === 1 && or2.results[1].ok);

  /* 11. 整合 */
  var woven = RP_SOUL_ORCH.weave([
    {name: "黛玉", ok: true, reply: {dialogue: "花落了", action: "葬花", inner: "", silence: false}},
    {name: "宝玉", ok: true, reply: {dialogue: "", action: "", inner: "", silence: true}}
  ]);
  t("整合: 含台词+动作", woven.text.indexOf("黛玉: 花落了") >= 0 &&
    woven.text.indexOf("葬花") >= 0);
  t("整合: silence 跳过", woven.text.indexOf("宝玉") < 0);

  /* 12. 写冲突检测 */
  var cfs = RP_SOUL_ORCH.detectConflicts([
    {name: "黛玉", action: "拿起桌上的剑"},
    {name: "宝玉", action: "拿起桌上的剑"}
  ]);
  t("冲突: 检出抢剑", cfs.length === 1 && cfs[0].a === "黛玉" && cfs[0].b === "宝玉");
  var cfs2 = RP_SOUL_ORCH.detectConflicts([
    {name: "黛玉", action: "葬花"},
    {name: "宝玉", action: "点头"}
  ]);
  t("冲突: 无冲突", cfs2.length === 0);

  /* 13. 预算熔断 */
  RP_SOUL_RT.startTurn("budget_test");
  for(var i = 0; i < 20; i++) RP_SOUL_RT.recordTokens("s" + i, {prompt_tokens: 1000, total: 1000});
  t("预算: 超限", RP_SOUL_RT.turnTotal() >= RP_SOUL_RT.TURN_TOKEN_BUDGET);

  /* 14. Profile 解析 */
  store["nd_api_profiles"] = JSON.stringify([
    {name: "Qwen", base: "https://q/v1", key: "qk", model: "qwen-max"}
  ]);
  var pc = RP_SOUL_RT.resolveProfile("Qwen", cfg);
  t("Profile: 解析", pc.model === "qwen-max" && pc.base === "https://q/v1");
  var pc2 = RP_SOUL_RT.resolveProfile("不存在", cfg);
  t("Profile: 回退默认", pc2.model === "m");

  console.log("\nPASS: " + pass + " FAIL: " + fail);
  process.exit(fail ? 1 : 0);
}

main().catch(function(e){ console.log("FATAL:", e); process.exit(1); });
