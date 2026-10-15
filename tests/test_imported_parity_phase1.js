/* 导入卡平等待遇 Phase1 回归测试
 *   B1 导入卡自带世界书(character_book) → prompt 的 lore 链路
 *   B2 用户世界书存储按卡隔离(旧池 nd_lore_imported 兼容读)
 *   B3 动态关系存储按卡隔离(旧池 nd_rel_dyn_imported 兼容读)
 *   B6 CHAR_PLOTS 按 runId 分层, 同名不同书不串味(旧扁平结构兼容读)
 *
 * 沙箱写法参照 tests/test_imported_pronoun.js; app.js 整文件载入参照
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
/* 载入 rp/* 模块 + app.js, 返回带 localStorage 桩的上下文 */
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
    setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
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

/* 两张各带 character_book 的 ST 卡 */
function mkRaw(name, novel, wbContent){
  return {name: name, tags: [novel], description: name + "其人。", personality: "寡言",
    scenario: "夜。", first_mes: "……" + name + "抬眼。",
    character_book: {name: novel + "志", entries: [
      {keys: ["银铃"], content: wbContent, enabled: true, constant: false}]}};
}
const RAWA = mkRaw("沈砚", "夜行录", "银铃是当铺的镇店之物，摇三声即有人来。");
const RAWB = mkRaw("白薇", "青灯录", "银针浸在药庐第三格的铜盆里。");
function seedTwoCards(ctx){
  vm.runInContext("RP_CARDIMPORT.add(RP_CARDIMPORT.normalizeTavern(" + JSON.stringify(RAWA) + "));", ctx);
  vm.runInContext("RP_CARDIMPORT.add(RP_CARDIMPORT.normalizeTavern(" + JSON.stringify(RAWB) + "));", ctx);
}
const cardIds = (ctx)=> vm.runInContext(
  "[RP_CARDIMPORT.find('沈砚').id, RP_CARDIMPORT.find('白薇').id]", ctx);

async function main(){
/* 每个小节独立兜底: 断言前的调用炸了也要把后续小节跑完, 否则一个红点吞掉整份报告 */
const sec = async (name, fn)=>{ try{ await fn(); }catch(e){ fail++; console.log("FAIL:", name, "小节抛异常:", e && e.message); } };

/* ==================================================================== */
/* B1 导入卡自带世界书 → buildMessages 的 lore 链路                       */
/* ==================================================================== */
{
  const c = mkCtx(RP_FILES);
  vm.runInContext("window.__DATA__ = {index:[], runs:{}, rp_cards:{}};", c);
  seedTwoCards(c);

  const live = vm.runInContext("RP.findCard('imported','沈砚')", c);
  t("B1 findCard(imported) 带出 worldbook 字段", !!(live && Array.isArray(live.worldbook)),
    JSON.stringify(live && live.worldbook));
  t("B1 世界书条目内容随 findCard 透传",
    live && (live.worldbook || []).some(e => String(e.content || "").indexOf("银铃") >= 0),
    JSON.stringify(live && live.worldbook));

  /* 端到端: 走 RP.send 真路径, 拦下 buildMessages 的入参。
     buildMessages 一旦被替换就抛哨兵, 避免后面真的去联网。 */
  c.__cap = null;
  vm.runInContext(`
    RP_PROMPT.buildMessages = function(card, opts){
      window.__cap = opts;
      throw new Error("__SENTINEL__");
    };`, c);
  try{ await vm.runInContext('RP.send("imported","沈砚","你听。",{cfg:{},history:[]})', c); }
  catch(e){ /* 哨兵 */ }
  const cap = c.__cap;
  t("B1 send() 确实调到了 buildMessages", !!cap);
  const wb = (cap && cap.worldbook) || [];
  t("B1 buildMessages 的 worldbook 含卡自带条目",
    wb.some(e => String(e.content || "").indexOf("银铃") >= 0), JSON.stringify(wb));
}

/* ==================================================================== */
/* B2 / B3 两张导入卡的 lore 与关系动态互不串, 且写入走新键              */
/* ==================================================================== */
await sec("B2/B3 按卡隔离", async()=>{
  const c = mkCtx(RP_FILES);
  vm.runInContext("window.__DATA__ = {index:[], runs:{}, rp_cards:{}};", c);
  seedTwoCards(c);
  const [ida, idb] = cardIds(c);

  const LK = c.AGENT_LOREKEEPER, AR = c.AGENT_RELATIONS;

  /* --- B2 lore --- */
  LK.setLore("imported", "沈砚", [{title: "A卡条目", content: "当铺的规矩", enabled: true}]);
  t("B2 lore 写入的是按卡隔离的新键",
    !!c.__store["nd_lore_imported_" + ida], JSON.stringify(Object.keys(c.__store)));
  t("B2 另一张卡没有拿到这个键", !c.__store["nd_lore_imported_" + idb]);
  t("B2 不再写旧的共享池 nd_lore_imported", c.__store["nd_lore_imported"] === undefined);
  t("B2 A 卡读回自己的条目", LK.getLore("imported", "沈砚").length === 1);
  t("B2 B 卡读到的是空池(不串味)", LK.getLore("imported", "白薇").length === 0,
    JSON.stringify(LK.getLore("imported", "白薇")));

  /* --- B3 关系动态 --- */
  AR.setLock("imported", "沈砚", "掌柜夫人", true, "沈砚");
  t("B3 关系动态写入的是按卡隔离的新键",
    !!c.__store["nd_rel_dyn_imported_" + ida], JSON.stringify(Object.keys(c.__store)));
  t("B3 不再写旧的共享池 nd_rel_dyn_imported", c.__store["nd_rel_dyn_imported"] === undefined);
  t("B3 A 卡读回自己的动态关系", AR.getDyn("imported", "沈砚").length === 1);
  t("B3 B 卡的动态关系池为空(不串味)", AR.getDyn("imported", "白薇").length === 0);
  t("B3 merged 也按卡隔离", AR.merged("imported", [], "白薇").length === 0 &&
    AR.merged("imported", [], "沈砚").length === 1);

  /* --- prompt 侧: userLore 走同一套键 --- */
  c.__cap = null;
  vm.runInContext(`
    RP_PROMPT.buildMessages = function(card, opts){ window.__cap = opts; throw new Error("__SENTINEL__"); };`, c);
  try{ await vm.runInContext('RP.send("imported","白薇","你来晚了。",{cfg:{},history:[]})', c); }
  catch(e){ /* 哨兵 */ }
  const wb = (c.__cap && c.__cap.worldbook) || [];
  t("B2 B 卡的 prompt 里看不到 A 卡的用户条目",
    !wb.some(e => String(e.content || "").indexOf("当铺的规矩") >= 0),
    JSON.stringify(wb));
});

/* ==================================================================== */
/* 老键兼容: nd_lore_imported / nd_rel_dyn_imported 新键无数据时回落       */
/* ==================================================================== */
await sec("老键兼容", async()=>{
  const c = mkCtx(RP_FILES);
  vm.runInContext("window.__DATA__ = {index:[], runs:{}, rp_cards:{}};", c);
  seedTwoCards(c);
  const [ida] = cardIds(c);
  c.localStorage.setItem("nd_lore_imported", JSON.stringify([{title: "旧池条目", content: "老数据", enabled: true}]));
  c.localStorage.setItem("nd_rel_dyn_imported", JSON.stringify([{a: "旧甲", b: "旧乙", summary: "旧关系"}]));

  const LK = c.AGENT_LOREKEEPER, AR = c.AGENT_RELATIONS;
  t("B2 老池 lore 在新键无数据时能被读到", LK.getLore("imported", "沈砚").length === 1,
    JSON.stringify(LK.getLore("imported", "沈砚")));
  t("B3 老池关系动态在新键无数据时能被读到", AR.getDyn("imported", "沈砚").length === 1,
    JSON.stringify(AR.getDyn("imported", "沈砚")));

  /* 新键一旦有数据, 就不再回落老池(否则用户在卡 A 里删干净的条目会被老池复活) */
  LK.setLore("imported", "沈砚", []);
  t("B2 新键有数据后不再回落老池", LK.getLore("imported", "沈砚").length === 0,
    JSON.stringify(LK.getLore("imported", "沈砚")));

  /* 蒸馏 runId 不受影响, 键名保持原样 */
  t("B2 蒸馏 runId 的 lore 键名不变",
    !!c.__store["nd_lore_honglou_full"] === false); /* 只写不读, 确认无越权写 */
});

/* ==================================================================== */
/* B6 CHAR_PLOTS 按 runId 分层                                             */
/* ==================================================================== */
await sec("B6 CHAR_PLOTS 按 runId 分层", async()=>{
  const c = mkCtx(RP_FILES.concat(["app.js"]));
  /* 同名角色出现在两部书里: 分层结构必须各取各的; 另留一条旧扁平结构做兼容 */
  vmEval(c, "window.CHAR_PLOTS = " + JSON.stringify({
    "honglou_full": {"林黛玉": "【红楼梦】黛玉线"},
    "shuihu_full":  {"林黛玉": "【水浒】黛玉线"},
    "孙二娘": "【旧扁平】孙二娘线",   /* 旧结构: 直接挂在顶层 */
  }) + ";");
  vmEval(c, "window.__DATA__ = {index:[], runs:{}, rp_cards:{}};");
  /* app.js 的 CHAT 是脚本顶层的 let 绑定, 不挂 window, 只能就地改字段 */
  const setChat = (o)=> vmEval(c, "CHAT.runId=" + JSON.stringify(o.runId || null) + ";" +
    "CHAT.name=" + JSON.stringify(o.name || null) + ";" +
    "CHAT.mode=" + JSON.stringify(o.mode || "single") + ";" +
    "CHAT.members=" + JSON.stringify(o.members || []) + ";");

  setChat({runId: "honglou_full", name: "林黛玉"});
  const hl = vmEval(c, "activePlotOutline()");
  t("B6 分层: 红楼取到红楼自己的大纲", hl === "【红楼梦】黛玉线", hl);
  setChat({runId: "shuihu_full", name: "林黛玉"});
  const sh = vmEval(c, "activePlotOutline()");
  t("B6 分层: 换书后同名角色不再串味", sh === "【水浒】黛玉线", sh);

  setChat({runId: "honglou_full", name: "孙二娘"});
  t("B6 旧扁平结构仍能兜底读到",
    vmEval(c, "activePlotOutline()") === "【旧扁平】孙二娘线",
    vmEval(c, "activePlotOutline()"));

  /* soulOutlineFor 的回退分支(魂穿锚点页)同样按 runId 取 */
  const s1 = vmEval(c, "soulOutlineFor('honglou_full','林黛玉')");
  const s2 = vmEval(c, "soulOutlineFor('shuihu_full','林黛玉')");
  t("B6 soulOutlineFor 回退分支按 runId 隔离",
    s1 === "【红楼梦】黛玉线" && s2 === "【水浒】黛玉线", s1 + " | " + s2);

  /* 群聊拼接各成员大纲同样按 runId 取 */
  setChat({runId: "shuihu_full", mode: "group", members: ["林黛玉"]});
  t("B6 群聊拼接成员大纲也按 runId 取",
    vmEval(c, "bundledPlot()") === "【水浒】黛玉线", vmEval(c, "bundledPlot()"));
});

console.log(`imported_parity_phase1: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
}
main();