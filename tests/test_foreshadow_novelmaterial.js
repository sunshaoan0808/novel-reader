/* B20 伏笔事件日历串进小说素材 · 回归测试
 *
 * 根因: www/data/foreshadow_cal.js 是纯《红楼梦》蒸馏产物, 无 runId 隔离;
 *       app.js 的 novelMaterial() 注入「故事大事记」时只按人名 filter
 *       RP_FORE.all(), 没有任何小说世界门禁 —— 导入卡若与红楼人物同名
 *       (如也叫"林黛玉"), 其小说素材里会混入红楼事件日历。
 *
 * 修法: novelMaterial() 的 cal 注入链路上补 B19 同一套门禁
 *       (foreRunFor/FORE_NOVEL 判定, 按 NOV.runId/NOV.name), 非红楼世界
 *       不注入红楼事件 (空 = buildMaterial 不拼该段, 不编造)。
 *
 * 覆盖:
 *   1. 同名导入卡(夜行录·林黛玉) 的小说素材不含红楼事件 —— 基线红/修完绿。
 *   2. 红楼蒸馏真卡(honglou_full·林黛玉) 的小说素材仍正常含红楼事件 (防过杀)。
 *   3. 不同名导入卡(夜行录·沈砚) 的小说素材不含红楼事件。
 *
 * 沙箱写法参照 tests/test_foreshadow_b19.js; 真实走 novelMaterial(),
 * 不测假 helper。
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
    createElement: () => mkEl(), createTextNode: () => mkEl(),
    appendChild(){}, removeChild(){}, insertBefore(){}, replaceChild(){},
    cloneNode(){ return mkEl(); }, setAttribute(){}, getAttribute(){ return null; },
    removeAttribute(){}, closest(){ return null; }, focus(){}, blur(){}, click(){},
    scrollTo(){}, addEventListener(){}, removeEventListener(){},
    getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0}; }};
}
function mkCtx(files){
  const store = {};
  const ls = {getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] || null, get length(){return Object.keys(store).length; }};
  const els = {};
  const doc = {body: mkEl(), head: mkEl(), documentElement: mkEl(),
    getElementById: id => els[id] || (els[id] = mkEl()),
    querySelector: sel => { const m = String(sel).match(/^#([\w-]+)$/);
      return m ? (els[m[1]] || (els[m[1]] = mkEl())) : null; },
    querySelectorAll: () => [], createElement: () => mkEl(), createTextNode: () => mkEl(),
    addEventListener(){}, removeEventListener(){}};
  const ctx = {localStorage: ls, document: doc, console, __store: store,
    alert(){}, confirm(){ return true; }, prompt(){ return null; },
    setTimeout: () => 0, clearTimeout(){}, clearInterval(){}, setInterval: () => 0,
    fetch: () => Promise.reject(new Error("no net")),
    requestAnimationFrame: () => 0, scrollTo(){}, devicePixelRatio: 2,
    Image: function(){ this.src = ""; }, Blob: function(){},
    URL: {createObjectURL: () => "blob:x", revokeObjectURL(){}},
    navigator: {userAgent: "node", language: "zh", clipboard: {writeText(){}}},
    matchMedia: () => ({matches:false, addEventListener(){}, addListener(){}}),
    addEventListener(){}, removeEventListener(){}};
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for(const f of files) vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
  return ctx;
}
const RP_FILES = ["data.js", "icons.js", "rp/escutil.js", "rp/scope.js", "rp/lorebook.js", "rp/prompt.js",
  "rp/preset.js", "rp/persona.js", "rp/memory.js", "rp/apex.js", "rp/tasks.js",
  "rp/cardwriter.js", "rp/ooc.js", "rp/playstats.js", "rp/portrait.js", "rp/chat.js",
  "rp/aifill.js", "rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/foreshadow.js",
  "rp/novel.js",
  "rp/agent_lorekeeper.js", "rp/agent_relations.js", "rp/agent_cardevo.js", "rp/warn.js"];

/* 蒸馏基线: 红楼 run (novel=红楼梦) */
const BASE_RUNS = {honglou_full: {run_id: "honglou_full", novel: "红楼梦",
    worldbook: [], relations: [], foreshadowing: [], corrections: []}};
const BASE_CARDS = {honglou_full: [{name: "林黛玉", fields: {timeline_stage: "大观园时期"}}]};

/* 事件日历 fixture: k 全部为 "event"(非 foreshadowing), novelMaterial 只收这类 */
const CAL = [
  {t:1, te:1, ch:2, c:["林黛玉"], s:"黛玉初进荣国府", k:"event", sub:"林黛玉"},
  {t:3, te:null, ch:5, c:["林黛玉","贾宝玉"], s:"宝玉摔玉黛玉赔泪", k:"event", sub:"贾宝玉"},
  {t:1, te:1, ch:1, c:["贾宝玉"], s:"顽石入世", k:"event", sub:"贾宝玉"}];

function mkRaw(name, novel){
  return {name: name, tags: [novel], description: name + "其人。", personality: "寡言",
    scenario: "夜雨敲窗。", system_prompt: "扮演" + name + ", 语气克制。",
    post_history_instructions: "回复不超过三段。", creator_notes: "作者是个夜猫子。",
    creator: "作者甲", character_version: "2.1",
    first_mes: "……" + name + "抬眼。", alternate_greetings: ["……" + name + "搁下笔。"],
    mes_example: "{{user}}: 你来了？\n{{char}}: 嗯。",
    extensions: {example_dialogue: "你来了？<START>嗯。"},
    character_book: {name: novel + "志", entries: [
      {keys: ["银铃"], content: "银铃是当铺的镇店之物, 摇三声即有人来。", enabled: true}]}};
}
const seedCard = (ctx, raw)=>
  vmEval(ctx, "RP_CARDIMPORT.add(RP_CARDIMPORT.normalizeTavern(" + JSON.stringify(raw) + "));");

/* 真实走 novelMaterial(): 按 NOV.runId/NOV.name 组装素材, 返回完整素材文本 */
function material(ctx, runId, name){
  return vmEval(ctx, "(function(){ NOV.runId=" + JSON.stringify(runId) +
    "; NOV.name=" + JSON.stringify(name) + "; return novelMaterial(); })()");
}

function main(){
  const c = mkCtx(RP_FILES.concat(["app.js"]));
  vmEval(c, "window.__DATA__ = " + JSON.stringify({index: [], runs: BASE_RUNS, rp_cards: BASE_CARDS}) + ";");
  vmEval(c, "window.__CAL__ = " + JSON.stringify(CAL) + ";");
  /* 同名导入卡: 夜行录的林黛玉; 不同名导入卡: 夜行录的沈砚 */
  seedCard(c, mkRaw("林黛玉", "夜行录"));
  seedCard(c, mkRaw("沈砚", "夜行录"));

  /* ---------- 1. 同名导入卡: 小说素材不许含红楼事件 ---------- */
  const sameMat = material(c, "imported", "林黛玉");
  t("B20 同名导入卡(夜行录·林黛玉) 素材不含红楼事件: 黛玉初进荣国府",
    sameMat.indexOf("黛玉初进荣国府") < 0, sameMat);
  t("B20 同名导入卡(夜行录·林黛玉) 素材不含红楼事件: 宝玉摔玉黛玉赔泪",
    sameMat.indexOf("宝玉摔玉黛玉赔泪") < 0, sameMat);
  t("B20 同名导入卡(夜行录·林黛玉) 素材无「故事大事记」段",
    sameMat.indexOf("故事大事记") < 0, sameMat);

  /* ---------- 2. 红楼蒸馏真卡: 不受影响, 事件正常注入 ---------- */
  const hlMat = material(c, "honglou_full", "林黛玉");
  t("B20 红楼真卡(honglou_full·林黛玉) 素材仍含红楼事件: 黛玉初进荣国府",
    hlMat.indexOf("黛玉初进荣国府") >= 0, hlMat);
  t("B20 红楼真卡(honglou_full·林黛玉) 素材仍含红楼事件: 宝玉摔玉黛玉赔泪",
    hlMat.indexOf("宝玉摔玉黛玉赔泪") >= 0, hlMat);
  t("B20 红楼真卡 素材含「故事大事记」段", hlMat.indexOf("故事大事记") >= 0, hlMat);

  /* ---------- 3. 不同名导入卡: 同样不含 ---------- */
  const diffMat = material(c, "imported", "沈砚");
  t("B20 导入卡(夜行录·沈砚) 素材不含红楼事件",
    diffMat.indexOf("黛玉初进荣国府") < 0 && diffMat.indexOf("顽石入世") < 0, diffMat);

  console.log("B20: " + pass + " pass, " + fail + " fail");
  return fail === 0;
}
const ok = main();
if(!ok) process.exit(1);
