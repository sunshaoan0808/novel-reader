const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 角色卡兼容回归: ST v1/v2/v3 字段在导入->prompt->导出链路的存活
// 修: system_prompt/post_history_instructions/creator_notes 进 prompt;
// mes_example 保留多轮结构 (exampleBlocks), 不再配假 opener;
// 卡片世界书走 RP_LOREBOOK.importST (secondary_keys/selectiveLogic/constant/position/probability/depth 透传);
// v3 depth_prompt/group_only_greetings; 导出 roundtrip 不丢字段;
// 开场白固定用 first_mes (ST 语义), 不再从池随机抽
const RPTEST = "/home/hatch/workspace/rp-test/misaka_card.json";
const JXY = "/home/hatch/workspace/user/files/jiangxueying_1.2.0.png";

function mkCtx(){
  const store = {};
  const ls = {getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] || null, get length(){ return Object.keys(store).length; }};
  const ctx = {localStorage: ls, console,
    atob: s => Buffer.from(String(s), "base64").toString("binary"),
    btoa: s => Buffer.from(String(s), "binary").toString("base64"),
    TextDecoder: TextDecoder};
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  [[WWW + "/rp/cardimport.js", ";globalThis.RP_CARDIMPORT=RP_CARDIMPORT;"],
   [WWW + "/rp/lorebook.js", ";globalThis.RP_LOREBOOK=RP_LOREBOOK;"],
   [WWW + "/rp/prompt.js", ";globalThis.RP_PROMPT=RP_PROMPT;"],
   [WWW + "/rp/cardexport.js", ";globalThis.RP_CARDEXPORT=RP_CARDEXPORT;"]
  ].forEach(([f, tail]) => vm.runInContext(fs.readFileSync(f, "utf8") + tail, ctx, {filename: f}));
  return ctx;
}
const ctx = mkCtx();
const CI = ctx.RP_CARDIMPORT, PM = ctx.RP_PROMPT, CE = ctx.RP_CARDEXPORT;

let pass = 0, fail = 0;
function t(name, cond){
  if(cond){ pass++; } else { fail++; console.log("FAIL:", name); }
}
function loadCard(p){
  const buf = fs.readFileSync(p);
  if(p.endsWith(".png"))
    return CI.normalizeTavern(CI.parseCardJson(CI.extractChara(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))));
  return CI.normalizeTavern(CI.parseCardJson(buf.toString("utf8")));
}

/* ---- 美琴手写 ST v2 卡 ---- */
const misaka = loadCard(RPTEST);
const misakaRaw = JSON.parse(fs.readFileSync(RPTEST, "utf8"));
t("v2 system_prompt 保留为一等字段", !!misaka.systemPrompt);
t("v2 creator_notes 保留为一等字段", !!misaka.creatorNotes);
t("v2 alternate_greetings 数量一致", misaka.altGreetings.length === misakaRaw.alternate_greetings.length);
t("v2 character_book 条目数一致", misaka.worldbook.length === misakaRaw.character_book.entries.length);
t("v2 worldbook 主键透传", (misaka.worldbook[0].key || []).length === 3);
t("v2 mes_example 多轮结构保留(有序 turns)", Array.isArray(misaka.exampleBlocks) && misaka.exampleBlocks.length > 0 &&
  misaka.exampleBlocks.every(b => Array.isArray(b.turns) && b.turns.length));
const mMsg = PM.buildMessages(misaka, {history: [], worldbook: misaka.worldbook}, {}).messages;
const sysAll = mMsg.filter(m => m.role === "system").map(m => m.content).join("\n");
t("v2 system_prompt 进入 system prompt", sysAll.includes(misakaRaw.system_prompt.slice(0, 30)));
t("v2 few-shot 无假 opener", !sysAll.includes("在园子里迎面碰见你"));
t("v2 few-shot 用真实对话块", misaka.exampleBlocks.some(b =>
  (b.turns || []).some(x => x.who === "char" && sysAll.includes(x.text.slice(0, 12)))));

/* ---- 迟归人真实 PNG ---- */
if(fs.existsSync(JXY)){
  const jxy = loadCard(JXY);
  t("png 名非空", jxy.name && jxy.name !== "未命名");
  t("png greeting 非空", !!jxy.greeting);
  t("png worldbook 非空", jxy.worldbook.length > 0);
  t("png 旧卡 ensureCompat 回填 exampleBlocks", Array.isArray(CI.ensureCompat({name: jxy.name, raw: jxy.raw}).exampleBlocks));
}else console.log("SKIP: 迟归人 PNG 不存在");

/* ---- 合成 v3 卡 ---- */
const v3 = {spec: "chara_card_v3", spec_version: "3.0", data: {
  name: "V3测试", description: "d", personality: "p", scenario: "s",
  first_mes: "hi", mes_example: "<START>\n{{user}}: 你好\n{{char}}: 你好啊",
  system_prompt: "sys3", post_history_instructions: "post3", creator_notes: "cn3",
  alternate_greetings: ["g2"], tags: ["t"],
  depth_prompt: {prompt: "depth3", role: "system", depth: 2},
  group_only_greetings: ["gg1"],
  character_book: {name: "b", scan_depth: 8, token_budget: 1500,
    entries: [{name: "e1", keys: ["k1"], secondary_keys: ["sk1"], selectiveLogic: 1,
      content: "c1", constant: false, position: "before_char", depth: 3, probability: 80,
      enabled: true, case_sensitive: true}]},
  extensions: {foo: 1}}};
const c3 = CI.normalizeTavern(CI.parseCardJson(JSON.stringify(v3)));
t("v3 depth_prompt 保留", !!(c3.depthPrompt && c3.depthPrompt.prompt === "depth3"));
t("v3 group_only_greetings 保留", (c3.groupOnlyGreetings || []).length === 1);
t("v3 bookMeta.scan_depth 保留", c3.bookMeta && c3.bookMeta.scan_depth === 8);
t("v3 entry depth 保留", c3.worldbook[0].depth === 3);
t("v3 entry probability 保留", c3.worldbook[0].probability === 80);
t("v3 entry secondary_keys 透传", (c3.worldbook[0].keysecondary || []).length === 1);
t("v3 entry selectiveLogic 透传", c3.worldbook[0].selectiveLogic === 1);
t("v3 entry position->placement", c3.worldbook[0].placement === "personality");
t("v3 post_history_instructions 保留", c3.postHistoryInstructions === "post3");
const m3 = PM.buildMessages(c3, {history: [
  {role: "user", content: "a"}, {role: "assistant", content: "b"},
  {role: "user", content: "c"}, {role: "assistant", content: "d"}], worldbook: []}, {}).messages;
const seq = m3.map(x => x.role + ":" + x.content.slice(0, 6)).join("|");
t("v3 depth_prompt 按 depth=2 插入历史中", seq.indexOf("system:depth3") > 0 &&
  seq.indexOf("system:depth3") < seq.lastIndexOf("user:c"));
t("v3 post_history 进尾部 system", m3[m3.length - 1].content.includes("post3"));
t("v3 creator_notes 进 system", m3[0].content.includes("cn3"));

/* selectiveLogic=1 (NOT ALL): 只有主键命中时纳入, 主+次全中时排除。
 * 注: 用 probability=100 的独立条目测, 避免 probability<100 的随机 roll 导致 flaky */
const v3b = {data: {name: "V3b", character_book: {entries: [
  {name: "e2", keys: ["k1"], secondary_keys: ["sk1"], selectiveLogic: 1, content: "c1", probability: 100, enabled: true}]}}};
const c3b = CI.normalizeTavern(CI.parseCardJson(JSON.stringify(v3b)));
const onlyP = ctx.RP_LOREBOOK.match(c3b.worldbook, "提到 k1 的事", 0).length;
const both = ctx.RP_LOREBOOK.match(c3b.worldbook, "提到 k1 和 sk1 的事", 0).length;
t("selectiveLogic NOT_ALL 语义正确", onlyP === 1 && both === 0);

/* ---- 导出 roundtrip ---- */
const exp = CE.buildTavernCard(c3);
t("导出 scenario 不丢", exp.data.scenario === "s");
t("导出 system_prompt roundtrip", exp.data.system_prompt === "sys3");
t("导出 post_history roundtrip", exp.data.post_history_instructions === "post3");
t("导出 creator_notes roundtrip", exp.data.creator_notes === "cn3");
t("导出 mes_example 由 exampleBlocks 重建", exp.data.mes_example.includes("{{user}}: 你好") && exp.data.mes_example.includes("{{char}}: 你好啊"));
t("导出 depth_prompt roundtrip", exp.data.depth_prompt && exp.data.depth_prompt.prompt === "depth3");
const re = CI.normalizeTavern(CI.parseCardJson(JSON.stringify(exp)));
t("导出再导入 system_prompt 存活", re.systemPrompt === "sys3");

console.log(`cardcompat: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
