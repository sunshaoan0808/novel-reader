/* 导入卡平等待遇 Phase2/Phase3 回归测试
 * Phase2:
 *   B4 非蒸馏 runId 的合成 run (imported/custom 都能拿到 novel/worldbook/relations)
 *   B5 oocCorrections 挂载提到 runId 分支之前 (imported/custom/distilled 三个分支都有)
 *   B12 时序感知基准卡的导入卡兜底 (app.js temporalCardFor)
 *   B20 findCard 对 imported/custom 返回完整卡 (scenario/systemPrompt/bookMeta/…)
 * Phase3 (内容面板补齐):
 *   B10 关系管理静态层走合成 run + 导入卡解释性空态 (app.js relRunFor/relEmptyText)
 *   B11 立绘外貌回落卡片库, 无外貌留空并提示去编辑器补 (portraitCardFor/hasAppearanceFor/portraitNoAppHint)
 *   B15 魂穿无预设锚点时降级为「自由开局」 (app.js anchorOptionsHTML)
 *   B13 loadWorldcard("imported") 短路, 不再发注定 404 的 script 请求
 *   B14 导演无因果蓝图时的小字提示 (app.js noBlueprintNote, 设置页导演卡片)
 *   B9  无章节时隐藏抽屉入口与徽章, chapterPicker 静默返回 (app.js chapterEntryHTML)
 *
 * 沙箱写法参照 tests/test_imported_parity_phase1.js; app.js 整文件载入参照
 * tests/test_chatsearch.js。
 */
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";

const vmEval = (c, code)=> vm.runInContext(code, c);
let pass = 0, fail = 0;
const t = (n, c, d)=>{ c ? pass++ : (fail++, console.log("FAIL:", n, d === undefined ? "" : d)); };

function mkEl(){
  return {innerHTML: "", textContent: "", value: "", checked: false, tagName: "", scrollTop: 0,
    classList: {add(){}, remove(){}, toggle(){}, contains(){ return false; }},
    style: {}, dataset: {}, children: [], childNodes: [],
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
    insertBefore(){}, replaceChild(){}, cloneNode(){ return mkEl(); },
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    closest(){ return null; }, scrollTo(){}, focus(){}, blur(){}, click(){},
    getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0}; }};
}
/* 载入 rp/* 模块 (+app.js), 返回带 localStorage 桩的上下文 */
function mkCtx(files){
  const store = {};
  const ls = {getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] || null, get length(){return Object.keys(store).length; }};
  const els = {};
  const doc = {body: mkEl(), head: mkEl(), documentElement: mkEl(),
    getElementById: id => els[id] || (els[id] = mkEl()),
    querySelector: sel => { const m = String(sel).match(/^#([\w-]+)$/); return m ? (els[m[1]] || (els[m[1]] = mkEl())) : null; },
    querySelectorAll: () => [], createElement: () => mkEl(), createTextNode: () => mkEl()};
  const ctx = {localStorage: ls, document: doc, console, __store: store,
    alert(){}, confirm(){ return true; }, prompt(){ return null; },
    setTimeout: () => 0, clearTimeout(){}, clearInterval(){}, setInterval: () => 0,
    fetch: () => Promise.reject(new Error("no net")),
    requestAnimationFrame: () => 0, scrollTo(){}, devicePixelRatio: 2};
  ctx.window = ctx; ctx.globalThis = ctx; ctx.localStorage = ls;
  vm.createContext(ctx);
  for(const f of files) vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
  return ctx;
}
const RP_FILES = ["data.js", "icons.js", "rp/escutil.js", "rp/scope.js", "rp/lorebook.js", "rp/prompt.js",
  "rp/preset.js", "rp/persona.js", "rp/memory.js", "rp/apex.js", "rp/tasks.js",
  "rp/cardwriter.js", "rp/ooc.js", "rp/playstats.js", "rp/portrait.js", "rp/chat.js",
  "rp/aifill.js", "rp/group.js", "rp/cardexport.js", "rp/cardimport.js",
  "rp/agent_lorekeeper.js", "rp/agent_relations.js", "rp/agent_cardevo.js", "rp/warn.js"];

/* 蒸馏基线数据: 一条 run, 带世界书/关系/纠错, 配一张 rp_cards 卡 */
const BASE_RUNS = {honglou_full: {run_id: "honglou_full", novel: "红楼梦",
  worldbook: [{title: "红楼条目", content: "大观园的规矩", enabled: true}],
  relations: [{a: "林黛玉", b: "贾宝玉", summary: "两小无猜"}],
  corrections: [
    {character: "林黛玉", prompt_injection_rule: "黛玉不许说英文"},
    {character: "薛宝钗", prompt_injection_rule: "宝钗不许动手"},
    {character: "林黛玉", note: "没有 prompt_injection_rule 的条目, 不该进 prompt"}]}};
const BASE_CARDS = {honglou_full: [{name: "林黛玉", fields: {timeline_stage: "大观园时期"}},
  {name: "薛宝钗", fields: {}}]};

/* 一张带 P0 一等字段 + character_book 的 ST 卡 (B4/B5/B12/B20 复用) */
function mkRaw(name, novel){
  return {name: name, tags: [novel], description: name + "其人。", personality: "寡言",
    scenario: "夜雨敲窗。", system_prompt: "扮演" + name + ", 语气克制。",
    post_history_instructions: "回复不超过三段。", creator_notes: "作者是个夜猫子。",
    creator: "作者甲", character_version: "2.1",
    first_mes: "……" + name + "抬眼。", alternate_greetings: ["……" + name + "搁下笔。"],
    mes_example: "{{user}}: 你来了？\n{{char}}: 嗯。",
    /* example_dialogue 走 extensions (cardimport.js:227-228), 与 mes_example 是两条路 */
    extensions: {example_dialogue: "你来了？<START>嗯。"},
    character_book: {name: novel + "志", entries: [
      {keys: ["银铃"], content: "银铃是当铺的镇店之物, 摇三声即有人来。", enabled: true}]}};
}
function seedCard(ctx, raw){
  vmEval(ctx, "RP_CARDIMPORT.add(RP_CARDIMPORT.normalizeTavern(" + JSON.stringify(raw) + "));");
}
/* 自创卡走 localStorage 直写 (RP_WRITER 的生成入口都要 LLM) */
function seedCustom(ctx, card){
  const list = JSON.parse(vmEval(ctx, "JSON.stringify(RP_WRITER.getCustomChars())") || "[]");
  list.unshift(card);
  ctx.localStorage.setItem("nd_custom_chars", JSON.stringify(list));
}
const mkCtxBase = (withApp)=> {
  const c = mkCtx(withApp ? RP_FILES.concat(["app.js"]) : RP_FILES);
  vmEval(c, "window.__DATA__ = " + JSON.stringify(
    {index: [], runs: BASE_RUNS, rp_cards: BASE_CARDS}) + ";");
  return c;
};
const RAW_A = mkRaw("沈砚", "夜行录");
const RAW_B = mkRaw("白薇", "青灯录");
const CUSTOM = {id: "c_test", name: "云娘", novel: "自定义", worldRunId: "honglou_full",
  fields: {core_traits: "爽利"}, greeting: "……云娘笑。", altGreetings: ["……云娘挑眉。"],
  exampleDialogue: "{{user}}: 在么\n{{char}}: 在。", createdAt: 1};

/* 走 RP.send 真路径, 拦下 buildMessages 的入参 (buildMessages 被替换后抛哨兵) */
async function captureBuild(c, runId, name, text){
  c.__cap = null; c.__err = null;
  vmEval(c, `(function(){
    if(!RP_PROMPT.__orig) RP_PROMPT.__orig = RP_PROMPT.buildMessages;
    RP_PROMPT.buildMessages = function(card, opts){
      window.__cap = {card: card, opts: opts};
      throw new Error("__SENTINEL__"); };
  })()`);
  try{ await vmEval(c, "RP.send(" + JSON.stringify(runId) + "," + JSON.stringify(name) + "," +
    JSON.stringify(text || "你听。") + ",{cfg:{},history:[]})"); }
  catch(e){ if(!/__SENTINEL__/.test(String(e && e.message))) c.__err = e; }
  vmEval(c, "RP_PROMPT.buildMessages = RP_PROMPT.__orig;");
  if(!c.__cap && c.__err) console.log("  (send 异常:", c.__err && c.__err.message, ")");
  return c.__cap;
}

async function main(){
/* 每个小节独立兜底: 断言前的调用炸了也要把后续小节跑完, 否则一个红点吞掉整份报告 */
const sec = async (name, fn)=>{ try{ await fn(); }catch(e){ fail++; console.log("FAIL:", name, "小节抛异常:", e && e.message); } };

/* ==================================================================== */
/* B4 合成 run: imported / custom / 蒸馏 runId                          */
/* ==================================================================== */
await sec("B4 合成 run", async()=>{
  const c = mkCtxBase(false);
  seedCard(c, RAW_A);
  seedCustom(c, CUSTOM);

  const imp = vmEval(c, "JSON.stringify(RP.synthRunFor('imported','沈砚'))");
  const ir = imp ? JSON.parse(imp) : null;
  t("B4 imported 合成出 run", !!ir, imp);
  t("B4 imported 的 novel 取自卡片", ir && ir.novel === "夜行录", ir && ir.novel);
  t("B4 imported 的 worldbook 取自卡自带 character_book",
    ir && (ir.worldbook || []).some(e => String(e.content || "").indexOf("银铃") >= 0), imp);
  t("B4 imported 的 relations 是空数组", ir && Array.isArray(ir.relations) && ir.relations.length === 0, imp);

  const cus = vmEval(c, "JSON.stringify(RP.synthRunFor('custom','云娘'))");
  const cr = cus ? JSON.parse(cus) : null;
  t("B4 custom 合成出 run", !!cr, cus);
  t("B4 custom 的 novel 取自卡片", cr && cr.novel === "自定义", cr && cr.novel);
  t("B4 custom 的 worldbook 仍取绑定的蒸馏 run",
    cr && (cr.worldbook || []).some(e => String(e.content || "").indexOf("大观园的规矩") >= 0), cus);

  t("B4 蒸馏 runId 不合成 (真 run 优先)",
    vmEval(c, "RP.synthRunFor('honglou_full','林黛玉')") === null,
    vmEval(c, "JSON.stringify(RP.synthRunFor('honglou_full','林黛玉'))"));
  t("B4 找不到卡时返回 null (调用方保持 run={})",
    vmEval(c, "RP.synthRunFor('imported','查无此人')") === null,
    vmEval(c, "JSON.stringify(RP.synthRunFor('imported','查无此人'))"));
  t("B4 空 runId 返回 null", vmEval(c, "RP.synthRunFor('', '沈砚')") === null);

  /* RP_CARDIMPORT 缺席 (模块没加载) 时不得抛错, 也不得凭空造 run */
  const bare = mkCtx(RP_FILES.filter(f => f !== "rp/cardimport.js"));
  vmEval(bare, "window.__DATA__ = " + JSON.stringify({index: [], runs: BASE_RUNS, rp_cards: BASE_CARDS}) + ";");
  t("B4 卡片库缺席时安全降级为 null",
    vmEval(bare, "JSON.stringify(RP.synthRunFor('imported','沈砚'))") === "null",
    vmEval(bare, "JSON.stringify(RP.synthRunFor('imported','沈砚'))"));

  /* 端到端: send() 装配出的 prompt 真的吃到了 novel/worldbook */
  const cap = await captureBuild(c, "imported", "沈砚");
  t("B4 send() 走到了 buildMessages", !!cap, "cap=" + JSON.stringify(c && c.__err && c.__err.message));
  if(cap){
    t("B4 send() 给导入卡带上了 novel", cap.opts.novel === "夜行录", cap.opts.novel);
    const wb = cap.opts.worldbook || [];
    t("B4 send() 的 worldbook 含卡自带条目",
      wb.some(e => String(e.content || "").indexOf("银铃") >= 0), JSON.stringify(wb));
    /* 合成 run.worldbook 与 card.worldbook 是同一批条目, 不去重会双份进 prompt */
    t("B4 卡自带条目在 prompt 里只出现一次",
      wb.filter(e => String(e.content || "").indexOf("银铃") >= 0).length === 1,
      JSON.stringify(wb.map(e => e.title)));
    t("B4 send() 的 relations 仍是数组 (下游 merged 有输入)", Array.isArray(cap.opts.relations));
  }

  /* 蒸馏 run 不受影响: 世界书与关系仍来自真 run */
  const cap2 = await captureBuild(c, "honglou_full", "林黛玉");
  if(cap2){
    t("B4 蒸馏 run 的 worldbook 仍来自 __DATA__.runs",
      (cap2.opts.worldbook || []).some(e => String(e.content || "").indexOf("大观园的规矩") >= 0),
      JSON.stringify(cap2.opts.worldbook));
    t("B4 蒸馏 run 的 relations 仍来自 __DATA__.runs", (cap2.opts.relations || []).length === 1,
      JSON.stringify(cap2.opts.relations));
  }
});

/* ==================================================================== */
/* B5 oocCorrections: 三个 runId 分支都挂上                               */
/* ==================================================================== */
await sec("B5 oocCorrections", async()=>{
  const c = mkCtxBase(false);
  seedCard(c, RAW_A);
  seedCustom(c, CUSTOM);

  const impOoc = vmEval(c, "JSON.stringify(RP.findCard('imported','沈砚').oocCorrections)");
  t("B5 imported 卡的 oocCorrections 是数组", Array.isArray(JSON.parse(impOoc)), impOoc);
  const cusOoc = vmEval(c, "JSON.stringify(RP.findCard('custom','云娘').oocCorrections)");
  t("B5 custom 卡的 oocCorrections 是数组", Array.isArray(JSON.parse(cusOoc)), cusOoc);
  t("B5 imported 卡无管线数据时为空数组", JSON.parse(impOoc).length === 0, impOoc);

  /* 蒸馏卡: 仍按人物过滤, 且只收带 prompt_injection_rule 的条目 */
  const d1 = JSON.parse(vmEval(c, "JSON.stringify(RP.findCard('honglou_full','林黛玉').oocCorrections)"));
  t("B5 蒸馏卡按人物过滤 (别人家的纠错条目不混入)", d1.length === 1, JSON.stringify(d1));
  t("B5 蒸馏卡只取带 prompt_injection_rule 的条目",
    d1[0] && d1[0].prompt_injection_rule === "黛玉不许说英文", JSON.stringify(d1));
  const d2 = JSON.parse(vmEval(c, "JSON.stringify(RP.findCard('honglou_full','薛宝钗').oocCorrections)"));
  t("B5 另一张蒸馏卡拿到自己那条", d2.length === 1 && d2[0].prompt_injection_rule === "宝钗不许动手",
    JSON.stringify(d2));

  /* 端到端: send() 传给 prompt 的卡带着按人物过滤后的纠错条目 */
  const cap = await captureBuild(c, "honglou_full", "林黛玉");
  t("B5 send() 带上带 oocCorrections 的卡",
    !!(cap && cap.card && Array.isArray(cap.card.oocCorrections) && cap.card.oocCorrections.length === 1),
    JSON.stringify(cap && cap.card && cap.card.oocCorrections));
  const capI = await captureBuild(c, "imported", "沈砚");
  t("B5 导入卡的 oocCorrections 为空数组",
    !!(capI && capI.card && Array.isArray(capI.card.oocCorrections) && capI.card.oocCorrections.length === 0),
    JSON.stringify(capI && capI.card && capI.card.oocCorrections));
});

/* ==================================================================== */
/* B12 时序感知基准卡: 导入卡兜底                                        */
/* ==================================================================== */
await sec("B12 时序感知兜底", async()=>{
  const c = mkCtxBase(true);
  seedCard(c, RAW_A);

  const tc = vmEval(c, "JSON.stringify(temporalCardFor('imported','沈砚'))");
  const tcr = tc ? JSON.parse(tc) : null;
  t("B12 导入卡兜底命中 (rp_cards 里没有 imported 这个键)", !!tcr, tc);
  t("B12 兜底拿到的是卡库里的那张卡", tcr && tcr.name === "沈砚", tcr && tcr.name);
  t("B12 找不到的卡名兜底为 null",
    vmEval(c, "temporalCardFor('imported','查无此人')") === null);

  const dt = vmEval(c, "JSON.stringify(temporalCardFor('honglou_full','林黛玉'))");
  t("B12 蒸馏 run 仍走 rp_cards 原路径", dt && JSON.parse(dt).name === "林黛玉", dt);
  t("B12 蒸馏 run 未命中时不误回落成别的卡",
    vmEval(c, "temporalCardFor('honglou_full','查无此人')") === null,
    vmEval(c, "JSON.stringify(temporalCardFor('honglou_full','查无此人'))"));
});

/* ==================================================================== */
/* B20 findCard 对 imported/custom 返回完整卡                             */
/* ==================================================================== */
await sec("B20 完整卡片字段", async()=>{
  const c = mkCtxBase(false);
  seedCard(c, RAW_A);
  seedCard(c, RAW_B);
  seedCustom(c, CUSTOM);

  const raw = vmEval(c, "JSON.stringify(RP.findCard('imported','沈砚'))");
  const cd = JSON.parse(raw);
  t("B20 imported 带出 id", !!(cd.id && String(cd.id).length > 1), raw);
  t("B20 imported 带出 name/novel", cd.name === "沈砚" && cd.novel === "夜行录", raw);
  t("B20 imported 带出 worldbook 数组", Array.isArray(cd.worldbook) &&
    cd.worldbook.some(e => String(e.content || "").indexOf("银铃") >= 0), raw);
  t("B20 imported 带出 scenario", cd.scenario === "夜雨敲窗。", cd.scenario);
  t("B20 imported 带出 systemPrompt", cd.systemPrompt === "扮演沈砚, 语气克制。", cd.systemPrompt);
  t("B20 imported 带出 postHistoryInstructions", cd.postHistoryInstructions === "回复不超过三段。",
    cd.postHistoryInstructions);
  t("B20 imported 带出 creatorNotes", cd.creatorNotes === "作者是个夜猫子。", cd.creatorNotes);
  t("B20 imported 带出 creator/characterVersion",
    cd.creator === "作者甲" && cd.characterVersion === "2.1",
    cd.creator + "|" + cd.characterVersion);
  t("B20 imported 带出 bookMeta", !!(cd.bookMeta && cd.bookMeta.name === "夜行录志"),
    JSON.stringify(cd.bookMeta));
  t("B20 imported 带出 fields.typical_lines (示例台词)",
    Array.isArray((cd.fields || {}).typical_lines) && cd.fields.typical_lines.length > 0,
    JSON.stringify(cd.fields));
  t("B20 imported 保留 greeting 回退", String(cd.greeting).indexOf("抬眼") >= 0, cd.greeting);
  t("B20 imported 带出 exampleBlocks (few-shot 分块)", Array.isArray(cd.exampleBlocks) &&
    cd.exampleBlocks.length > 0 && Array.isArray(cd.exampleBlocks[0].turns),
    JSON.stringify(cd.exampleBlocks));
  t("B20 imported 带出 altGreetings/exampleDialogue",
    Array.isArray(cd.altGreetings) && cd.altGreetings.length === 1 &&
    String(cd.exampleDialogue).indexOf("你来了？") >= 0, raw);

  /* custom 卡形状与 imported 同构: 字段在, 只是源卡本来就没有的那些给空串/空数组 */
  const craw = vmEval(c, "JSON.stringify(RP.findCard('custom','云娘'))");
  const cc = JSON.parse(craw);
  const KEYS = ["id", "name", "novel", "fields", "greeting", "altGreetings", "exampleDialogue",
    "exampleBlocks", "scenario", "systemPrompt", "postHistoryInstructions", "creatorNotes",
    "characterVersion", "creator", "bookMeta", "depthPrompt", "sysNote",
    "groupOnlyGreetings", "worldbook", "oocCorrections"];
  t("B20 custom 卡补齐了全部透传字段",
    KEYS.every(k => Object.prototype.hasOwnProperty.call(cc, k)),
    KEYS.filter(k => !Object.prototype.hasOwnProperty.call(cc, k)).join(","));
  t("B20 custom 卡字段值正确 (name/novel/greeting/fields)",
    cc.name === "云娘" && cc.novel === "自定义" && String(cc.greeting).indexOf("云娘笑") >= 0 &&
    (cc.fields || {}).core_traits === "爽利", craw);
  t("B20 custom 卡源卡没有的字段给的是空串/空数组, 不是 undefined",
    cc.scenario === "" && cc.systemPrompt === "" && Array.isArray(cc.worldbook) &&
    cc.worldbook.length === 0 && cc.bookMeta === null && cc.depthPrompt === null, craw);

  /* 端到端: 补齐的字段真的进了 prompt (prompt.js 的 systemPrompt/creatorNotes/scenario/
     postHistoryInstructions 四个消费点) */
  const built = JSON.parse(vmEval(c,
    "JSON.stringify(RP_PROMPT.buildMessages(RP.findCard('imported','沈砚'), " +
    "{novel:'夜行录', history:[], persona:'', maxContext:4096}).messages)"));
  const sys = built.filter(m => m.role === "system").map(m => m.content).join("\n");
  t("B20 systemPrompt 进了 system prompt", sys.indexOf("扮演沈砚, 语气克制。") >= 0, sys.slice(0, 400));
  t("B20 creatorNotes 进了 system prompt", sys.indexOf("作者是个夜猫子。") >= 0, sys.slice(0, 400));
  t("B20 scenario 进了 prompt", sys.indexOf("夜雨敲窗。") >= 0, sys.slice(0, 600));
  t("B20 postHistoryInstructions 进了 prompt", sys.indexOf("回复不超过三段。") >= 0, sys.slice(0, 800));
});

/* ==================================================================== */
/* Phase 3 内容面板补齐 (B10 关系静态层 / B11 立绘外貌 / B15 魂穿锚点 /     */
/*                    B13 导演蓝图短路 + B14 无蓝图提示 / B9 章节入口)     */
/* ==================================================================== */

/* ==================================================================== */
/* B10 关系管理静态层: 导入卡走合成 run + 解释性空态                       */
/* ==================================================================== */
await sec("B10 关系静态层", async()=>{
  const c = mkCtxBase(true);
  seedCard(c, RAW_A);

  const run = JSON.parse(vmEval(c, "JSON.stringify(relRunFor('imported','沈砚'))"));
  t("B10 导入卡取到合成 run 的 novel", run.novel === "夜行录", JSON.stringify(run));
  t("B10 合成 run 的 relations 是数组", Array.isArray(run.relations), JSON.stringify(run));
  const d = JSON.parse(vmEval(c, "JSON.stringify(relRunFor('honglou_full','林黛玉'))"));
  t("B10 蒸馏 runId 仍返回真 run", d.novel === "红楼梦" && (d.relations||[]).length === 1,
    JSON.stringify(d));
  t("B10 查无此卡时降级为空 run 对象",
    vmEval(c, "JSON.stringify(relRunFor('imported','查无此人'))") === "{}",
    vmEval(c, "JSON.stringify(relRunFor('imported','查无此人'))"));

  const et = JSON.parse(vmEval(c, "JSON.stringify([relEmptyText('imported'), relEmptyText('honglou_full')])"));
  t("B10 导入卡空态解释「无蒸馏静态关系」", /没有蒸馏出的静态关系/.test(et[0]) &&
    /自动抽取/.test(et[0]) && /锁定/.test(et[0]), et[0]);
  t("B10 蒸馏 run 空态文案不变", et[1] === "暂无关系数据", et[1]);

  /* 端到端: 导入卡页面渲染出的是解释性空态 */
  vmEval(c, "CHAT.runId='imported'; CHAT.name='沈砚'; showRelManager();");
  const html = vmEval(c, "document.getElementById('view').innerHTML");
  t("B10 导入卡关系页渲染解释性空态", /没有蒸馏出的静态关系/.test(html) &&
    html.indexOf("暂无关系数据") < 0, html.slice(0, 300));

  /* 蒸馏 run 有静态关系时照旧渲染关系卡, 不出现解释文案 */
  const c2 = mkCtxBase(true);
  vmEval(c2, "window.__DATA__ = " + JSON.stringify({index: [], runs: {relrun: {run_id: "relrun",
    novel: "某书", relations: [{source_character: "林黛玉", target_character: "贾宝玉",
      relationship_summary: "两小无猜"}]}}, rp_cards: {}}) + ";");
  vmEval(c2, "CHAT.runId='relrun'; CHAT.name='林黛玉'; showRelManager();");
  const h2 = vmEval(c2, "document.getElementById('view').innerHTML");
  t("B10 蒸馏卡关系页仍渲染静态关系", h2.indexOf("贾宝玉") >= 0 && h2.indexOf("两小无猜") >= 0,
    h2.slice(0, 400));
  t("B10 蒸馏卡有关系时不出现解释性空态", h2.indexOf("没有蒸馏出的静态关系") < 0, h2.slice(0, 400));
});

/* ==================================================================== */
/* B11 立绘外貌字段: 导入卡回落卡片库, 无外貌就留空 + 提示                   */
/* ==================================================================== */
await sec("B11 立绘外貌", async()=>{
  const c = mkCtxBase(true);
  /* 一张有外貌的导入卡 (与"看图写卡"同构: fields.appearance_feature) */
  vmEval(c, "RP_CARDIMPORT.add({id:'imp_app', name:'白薇', novel:'青灯录', " +
    "fields:{core_traits:'冷静', appearance_feature:'月白长衫，眉目清俊'}});");
  /* 一张没有外貌字段的 ST 卡 (normalizeTavern 不写外貌) */
  seedCard(c, RAW_A);

  const p1 = vmEval(c, "portraitPrompt('imported','白薇')");
  t("B11 导入卡 prompt 吃到了卡里的外貌", p1.indexOf("月白长衫，眉目清俊") >= 0, p1);
  t("B11 导入卡 prompt 的书名取自卡", p1.indexOf("《青灯录》") >= 0, p1);

  const p2 = vmEval(c, "portraitPrompt('imported','沈砚')");
  t("B11 无外貌字段时该段留空", p2.indexOf("外貌：。") >= 0, p2);
  t("B11 无外貌字段时不编造也不出 undefined",
    p2.indexOf("undefined") < 0 && p2.indexOf("NaN") < 0 && p2.indexOf("[object") < 0, p2);

  t("B11 hasAppearanceFor 对有外貌的卡为真",
    vmEval(c, "hasAppearanceFor('imported','白薇')") === true);
  t("B11 hasAppearanceFor 对没有外貌的卡为假",
    vmEval(c, "hasAppearanceFor('imported','沈砚')") === false);
  t("B11 有外貌时不出现引导提示", vmEval(c, "portraitNoAppHint('imported','白薇')") === "");
  const hint = vmEval(c, "portraitNoAppHint('imported','沈砚')");
  t("B11 无外貌时提示引导去编辑器补「外貌」",
    /没有外貌/.test(hint) && /编辑/.test(hint) && /外貌/.test(hint), hint);

  /* 蒸馏 run: rp_cards 的视觉识别/外貌字段照旧生效, 且不回落同名导入卡 */
  const c2 = mkCtxBase(true);
  seedCard(c2, RAW_A); /* 导入卡里有一张叫"林黛玉"吗? 没有; 用同名卡验证不串味 */
  vmEval(c2, "RP_CARDIMPORT.add({id:'imp_same', name:'林黛玉', novel:'串味卡', " +
    "fields:{appearance_feature:'这是导入卡的外貌, 不该出现'}});");
  vmEval(c2, "window.__DATA__.rp_cards.honglou_full = [" +
    "{name:'林黛玉', fields:{visual_identity:'眉如墨画'}}, " +
    "{name:'薛宝钗', fields:{appearance_feature:'唇未点朱'}}];");
  const p3 = vmEval(c2, "portraitPrompt('honglou_full','林黛玉')");
  t("B11 蒸馏卡仍取 rp_cards 的视觉识别", p3.indexOf("眉如墨画") >= 0, p3);
  t("B11 蒸馏 run 查不到卡时不回落同名导入卡",
    p3.indexOf("这是导入卡的外貌") < 0, p3);
  t("B11 蒸馏卡有 appearance_feature 时优先用它",
    vmEval(c2, "portraitPrompt('honglou_full','薛宝钗')").indexOf("唇未点朱") >= 0,
    vmEval(c2, "portraitPrompt('honglou_full','薛宝钗')"));
});

/* ==================================================================== */
/* B15 魂穿锚点: 无预设锚点时降级为「自由开局」                             */
/* ==================================================================== */
await sec("B15 魂穿锚点空态", async()=>{
  const c = mkCtxBase(true);
  seedCard(c, RAW_A);
  /* traverse.js 的 anchorsFor 永远兜底给一条 {id:"start"}; 有大纲时才会多出真锚点 */
  vmEval(c, "window.RP_TRAVERSE = {anchorsFor: (t)=> (t && t.anchors && t.anchors.length) ? " +
    "[{id:'start',title:'从头开始：刚睁开眼'},{id:'a2',title:'黛玉进府'}] " +
    ": [{id:'start',title:'从头开始：刚睁开眼'}]};");
  /* 导入卡没有 nd_plot_* 也没有内联大纲 -> 只剩内置那条 start */
  vmEval(c, "soulAnchors('imported','沈砚');");
  const html = vmEval(c, "document.getElementById('view').innerHTML");
  t("B15 导入卡魂穿页有「自由开局」选项", html.indexOf("自由开局") >= 0, html.slice(0, 400));
  t("B15 该选项默认选中且走 custom 分支",
    /value="custom" checked/.test(html), html.slice(0, 400));
  t("B15 自定输入框仍在(用户可补切入点)", html.indexOf('id="anchorCustom"') >= 0);

  /* 蒸馏卡有真锚点时原样列出, 不出现降级文案 */
  const c2 = mkCtxBase(true);
  vmEval(c2, "window.RP_TRAVERSE = {anchorsFor: (t)=> (t && t.anchors && t.anchors.length) ? " +
    "[{id:'start',title:'从头开始：刚睁开眼'},{id:'a2',title:'黛玉进府'}] " +
    ": [{id:'start',title:'从头开始：刚睁开眼'}]};");
  vmEval(c2, "window.CHAR_PLOTS = {honglou_full: {'林黛玉': {anchors:['黛玉进府']}}};");
  vmEval(c2, "soulAnchors('honglou_full','林黛玉');");
  const h2 = vmEval(c2, "document.getElementById('view').innerHTML");
  t("B15 蒸馏卡仍列出真锚点", h2.indexOf("黛玉进府") >= 0, h2.slice(0, 500));
  t("B15 蒸馏卡有锚点时不出现降级文案", h2.indexOf("自由开局") < 0, h2.slice(0, 500));
});

/* ==================================================================== */
/* B13 loadWorldcard 短路 + B14 导演无蓝图提示                             */
/* ==================================================================== */
await sec("B13/B14 导演蓝图", async()=>{
  const c = mkCtxBase(true);
  seedCard(c, RAW_A);
  vmEval(c, "window.__ce = 0; var __origCE = document.createElement; " +
    "document.createElement = function(t){ window.__ce++; return __origCE(t); };");
  const wc = await vmEval(c, "loadWorldcard('imported')");
  t("B13 imported 的 loadWorldcard 直接 resolve null", wc === null, JSON.stringify(wc));
  t("B13 imported 不再创建 script 标签(消除注定 404)",
    vmEval(c, "String(window.__ce)") === "0", "createElement=" + vmEval(c, "String(window.__ce)"));
  t("B13 imported 不写失败标记",
    vmEval(c, "JSON.stringify(Object.keys(_wcFailed))") === "[]",
    vmEval(c, "JSON.stringify(Object.keys(_wcFailed))"));
  /* 蒸馏 run 仍走真加载路径 */
  vmEval(c, "loadWorldcard('honglou_full');");
  t("B13 蒸馏 run 仍会拉 worldcard 脚本",
    Number(vmEval(c, "String(window.__ce)")) >= 1, "createElement=" + vmEval(c, "String(window.__ce)"));

  /* B14 无蓝图提示 */
  vmEval(c, "window.__DATA__.index = [{run_id:'honglou_full', has_worldcard:true}, " +
    "{run_id:'plainrun', has_worldcard:false}];");
  const noteImp = vmEval(c, "noBlueprintNote('imported')");
  t("B14 导入卡提示无原著因果蓝图", /无原著因果蓝图/.test(noteImp) && /通用模式/.test(noteImp), noteImp);
  t("B14 有 worldcard 的蒸馏 run 不提示",
    vmEval(c, "noBlueprintNote('honglou_full')") === "",
    vmEval(c, "noBlueprintNote('honglou_full')"));
  t("B14 index 里 has_worldcard=false 的 run 提示",
    /无原著因果蓝图/.test(vmEval(c, "noBlueprintNote('plainrun')")),
    vmEval(c, "noBlueprintNote('plainrun')"));
  t("B14 已载入 worldcard 但没导演定义时仍按无蓝图处理",
    (function(){
      vmEval(c, "window.__WORLDCARD_emptywc = {directorDefinitions: []};");
      return /无原著因果蓝图/.test(vmEval(c, "noBlueprintNote('emptywc')"));
    })());
  t("B14 已载入 worldcard 且有导演定义时不提示",
    (function(){
      vmEval(c, "window.__WORLDCARD_okwc = {directorDefinitions: [{coreConflict:'x'}]};");
      return vmEval(c, "noBlueprintNote('okwc')") === "";
    })());

  /* 导演设置面板真的把这句渲染出来了 */
  vmEval(c, "CHAT.runId='imported'; showSettings();");
  const s1 = vmEval(c, "document.getElementById('view').innerHTML");
  t("B14 导演设置面板含无蓝图小字", s1.indexOf("无原著因果蓝图") >= 0, s1.slice(0, 200));
  vmEval(c, "CHAT.runId='honglou_full'; showSettings();");
  const s2 = vmEval(c, "document.getElementById('view').innerHTML");
  t("B14 有蓝图时设置面板不出现该小字", s2.indexOf("无原著因果蓝图") < 0);
});

/* ==================================================================== */
/* B9 章节入口: 无 sections 时隐藏按钮/徽章, chapterPicker 静默返回          */
/* ==================================================================== */
await sec("B9 章节入口", async()=>{
  const c = mkCtxBase(true);
  vmEval(c, "window.__DATA__ = " + JSON.stringify({index: [], runs: {honglou_full: {run_id: "honglou_full",
    novel: "红楼梦", sections: [{title: "第一回"}, {title: "第二回"}]}}, rp_cards: {}}) + ";");
  vmEval(c, "window.__toasts = []; window.rpToast = (m)=>{ window.__toasts.push(m); };");

  /* 有章节: 按钮与徽章都在, picker 正常渲染 */
  vmEval(c, "CHAT.runId='honglou_full'; CHAT.name='林黛玉';");
  const withSec = JSON.parse(vmEval(c, "JSON.stringify([chapterEntryHTML(true), chapterEntryHTML(false)])"));
  t("B9 有章节时单聊入口带徽章", withSec[0].indexOf("章节进度") >= 0 &&
    withSec[0].indexOf('id="chapter_badge"') >= 0, withSec[0]);
  t("B9 有章节时群聊入口不带徽章", withSec[1].indexOf("章节进度") >= 0 &&
    withSec[1].indexOf("chapter_badge") < 0, withSec[1]);
  vmEval(c, "document.getElementById('view').innerHTML='KEEP'; chapterPicker();");
  t("B9 有章节时 picker 渲染章节页",
    vmEval(c, "document.getElementById('view').innerHTML").indexOf("章节进度") >= 0);
  t("B9 有章节时不弹 toast", vmEval(c, "String(window.__toasts.length)") === "0");

  /* 导入卡: 无 sections -> 入口与徽章都不渲染, picker 静默返回 */
  vmEval(c, "CHAT.runId='imported'; CHAT.name='沈砚';");
  const noSec = JSON.parse(vmEval(c, "JSON.stringify([chapterEntryHTML(true), chapterEntryHTML(false)])"));
  t("B9 无章节时入口返回空串(按钮与徽章一起消失)",
    noSec[0] === "" && noSec[1] === "", JSON.stringify(noSec));
  vmEval(c, "window.__toasts = []; document.getElementById('view').innerHTML='KEEP'; chapterPicker();");
  t("B9 无章节时 picker 不弹 toast", vmEval(c, "String(window.__toasts.length)") === "0",
    vmEval(c, "JSON.stringify(window.__toasts)"));
  t("B9 无章节时 picker 不改页面(静默返回)",
    vmEval(c, "document.getElementById('view').innerHTML") === "KEEP",
    vmEval(c, "document.getElementById('view').innerHTML"));
  t("B9 getSections 本体不动: 蒸馏 run 仍拿到章节",
    vmEval(c, "(function(){CHAT.runId='honglou_full';return getSections().length})()") === 2);
});


console.log(`imported_parity_phase23: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
}
main();