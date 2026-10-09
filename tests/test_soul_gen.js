const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// Soul 生成器: prompt 构建 + 结果解析 + 写入 (mock LLM)
const ctx = {console, setTimeout: setTimeout};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/soul.js", "utf8"), ctx, {filename: "rp/soul.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_gen.js", "utf8"), ctx, {filename: "rp/soul_gen.js"});
const RP_SOUL = ctx.RP_SOUL, RP_SOUL_GEN = ctx.RP_SOUL_GEN;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

function mkCard(){
  return {name: "林黛玉", description: "潇湘妃子", personality: "敏感,才华横溢",
    scenario: "大观园", fields: {speech_style: "诗意"}, extensions: {}};
}

async function main(){
  var card = mkCard();

  /* 1. prompt 构建 */
  var p = RP_SOUL_GEN.buildGenPrompt(card);
  t("prompt: 含名字", p.indexOf("林黛玉") >= 0);
  t("prompt: 含 JSON 格式要求", p.indexOf("soul_md") >= 0 && p.indexOf("core_traits") >= 0);
  t("prompt: 含已知信息", p.indexOf("潇湘妃子") >= 0);

  /* 2. 解析: 正常 */
  var good = '{"soul_md": "宪章", "persona": {"core_traits": [], "motivations": [], "values": [], "relationships": {}}, "background": {"origin": "", "history": "", "secrets": ""}, "rules": {"decision": "", "interaction": "", "action": ""}}';
  var pr1 = RP_SOUL_GEN.parseGenResult(good);
  t("解析: 正常", pr1.ok && pr1.data.soul_md === "宪章");

  /* 3. 解析: 无 JSON */
  var pr2 = RP_SOUL_GEN.parseGenResult("今天天气不错");
  t("解析: 无 JSON 失败", !pr2.ok);

  /* 4. 解析: 缺段 */
  var pr3 = RP_SOUL_GEN.parseGenResult('{"soul_md": "x"}');
  t("解析: 缺段失败", !pr3.ok);

  /* 5. 解析: 带 markdown 包裹 */
  var pr4 = RP_SOUL_GEN.parseGenResult('```json\n' + good + '\n```');
  t("解析: markdown 包裹", pr4.ok);

  /* 6. 生成全流程 (mock) */
  var mockGen = JSON.stringify({
    soul_md: "敏感而骄傲的诗魂",
    persona: {
      core_traits: [{trait: "敏感", intensity: 85, description: "泪点低"}],
      motivations: ["守住潇湘馆"],
      values: ["真情", "清白"],
      relationships: {"贾宝玉": "知己"}
    },
    background: {origin: "姑苏", history: "寄人篱下", secrets: "藏了帕子"},
    rules: {decision: "宁折不弯", interaction: "以诗会友", action: "先想后做"}
  });
  var callFn = function(cfg, messages, temp){
    return Promise.resolve(mockGen);
  };
  var gr = await RP_SOUL_GEN.generate(card, {}, callFn);
  t("生成: 成功", gr.ok);
  var soul = RP_SOUL.getSoul(card);
  t("生成: soul_md", soul.soul_md === "敏感而骄傲的诗魂");
  t("生成: traits", soul.persona.core_traits.length === 1);
  t("生成: secrets", soul.background.secrets === "藏了帕子");
  t("生成: rules", soul.rules.decision === "宁折不弯");

  /* 7. 生成后写保护仍生效 */
  var wr = RP_SOUL.write(card, "persona.core_traits", []);
  t("生成后: 写保护", !wr.ok);

  /* 8. 批量生成 */
  var c2 = mkCard(); c2.name = "薛宝钗";
  var batch = await RP_SOUL_GEN.generateBatch([card, c2], {}, callFn, null);
  t("批量: 2 个都 ok", batch.length === 2 && batch.every(function(r){ return r.ok; }));

  /* 9. LLM 失败 */
  var failFn = function(){ return Promise.reject(new Error("挂了")); };
  var gr2 = await RP_SOUL_GEN.generate(mkCard(), {}, failFn);
  t("生成: LLM 失败", !gr2.ok && gr2.reason.indexOf("llm") === 0);

  console.log("\nPASS: " + pass + " FAIL: " + fail);
  process.exit(fail ? 1 : 0);
}

main().catch(function(e){ console.log("FATAL:", e); process.exit(1); });
