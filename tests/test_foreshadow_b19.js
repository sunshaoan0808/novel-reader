/* B19 伏笔面板串味 · 回归测试
 *
 * 根因: www/data/foreshadow_cal.js 是纯《红楼梦》蒸馏产物, 无 runId 隔离,
 *       rp/foreshadow.js 直接读 window.__CAL__; 抽屉两处"伏笔面板"入口
 *       (app.js 单聊/群聊 drawer) 与 window.showForeshadow 无任何小说门禁,
 *       renderForeshadow 还硬编码 runs["honglou_full"]。
 *       → 任何导入卡(夜行录/青灯录…)打开伏笔面板都看到红楼伏笔。
 *
 * 修法: 入口按当前聊天的小说世界门禁 (app.js foreRunFor/foreAvailable/foreEntryHTML/
 *       showForeshadow), 只有 novel==="红楼梦" 的聊天才显示并可打开面板。
 *
 * 覆盖:
 *   1. 两张不同导入卡(小说都不是红楼梦)抽屉都无入口, 直接调用 showForeshadow
 *      弹提示且不渲染任何伏笔 —— 互不串, 也不串到红楼。
 *   2. 导入卡与红楼同名人物(都叫"林黛玉"): 导入卡看不到面板, honglou_full 的
 *      林黛玉正常看到 —— 同名不构成放行条件。
 *   3. honglou_full 红楼卡: 单聊/群聊抽屉入口都在, 面板分组与条目渲染正常。
 *   4. 非红楼蒸馏 run(水浒传)群聊也不出现入口 (门禁按小说而非按 runId 白名单)。
 *
 * 沙箱写法参照 tests/test_imported_parity_phase23.js; 真实走 showChat()/showGroupChat()
 * 渲染抽屉 DOM, 不测假 helper。
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
  "rp/agent_lorekeeper.js", "rp/agent_relations.js", "rp/agent_cardevo.js", "rp/warn.js"];

/* 蒸馏基线: 一部红楼 + 一部水浒(用来验证门禁按小说走而不是按 runId 白名单) */
const BASE_RUNS = {honglou_full: {run_id: "honglou_full", novel: "红楼梦",
    worldbook: [{title: "红楼条目", content: "大观园的规矩", enabled: true}],
    relations: [{a: "林黛玉", b: "贾宝玉", summary: "两小无猜"}],
    foreshadowing: [], corrections: []},
  shuihu_full: {run_id: "shuihu_full", novel: "水浒传", worldbook: [], relations: [],
    foreshadowing: [], corrections: []}};
const BASE_CARDS = {honglou_full: [{name: "林黛玉", fields: {timeline_stage: "大观园时期"}},
    {name: "薛宝钗", fields: {}}], shuihu_full: [{name: "林冲", fields: {}}]};

/* 事件日历 fixture: schema {t:埋设, te:回收, ch:回目, c:人物[], s:文本, k:类型, sub} */
const CAL = [
  {t:1, te:214, ch:120, c:["贾宝玉","林黛玉"], s:"绛珠还泪之约, 是全书情缘总根", k:"foreshadowing", sub:"贾宝玉"},
  {t:5, te:null, ch:5, c:["王熙凤"], s:"凤姐初见黛玉时的伏笔, 待回收", k:"foreshadowing", sub:"王熙凤"},
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

/* 真正走 showChat() 渲染抽屉 DOM, 返回抽屉里的伏笔面板入口片段 */
async function drawerHTML(ctx, mode, runId, name, members){
  vmEval(ctx, "CHAT.mode=" + JSON.stringify(mode) + "; CHAT.runId=" + JSON.stringify(runId) +
    "; CHAT.name=" + JSON.stringify(name) + "; CHAT.members=" + JSON.stringify(members || []) + ";");
  await vmEval(ctx, "showChat();");
  const html = vmEval(ctx, "document.getElementById('view').innerHTML");
  const m = html.match(/<button class="ditem"[^>]*>[\s\S]{0,400}?伏笔面板<\/button>/);
  return m ? m[0] : "";
}
/* 捕获 rpToast + 页面内容, 走真实 showForeshadow() */
function callShow(ctx){
  return vmEval(ctx, `(function(){
    window.__toasts = [];
    window.rpToast = (m)=>{ window.__toasts.push(m); };
    document.getElementById('view').innerHTML = 'KEEP';
    showForeshadow();
    return JSON.stringify({toasts: window.__toasts, html: document.getElementById('view').innerHTML});
  })()`);
}
const viewHTML = (ctx)=> vmEval(ctx, "document.getElementById('view').innerHTML");
const GATE_MSG = "伏笔面板仅支持《红楼梦》蒸馏剧本";

async function main(){
  const c = mkCtx(RP_FILES.concat(["app.js"]));
  vmEval(c, "window.__DATA__ = " + JSON.stringify({index: [], runs: BASE_RUNS, rp_cards: BASE_CARDS}) + ";");
  vmEval(c, "window.__CAL__ = " + JSON.stringify(CAL) + ";");
  /* 三张导入卡: 两张不同小说 + 一张与红楼同名人物 */
  seedCard(c, mkRaw("沈砚", "夜行录"));
  seedCard(c, mkRaw("白薇", "青灯录"));
  seedCard(c, mkRaw("林黛玉", "夜行录"));

  /* ---------- 1. 两张不同导入卡都看不到红楼伏笔 ---------- */
  for(const [name, novel] of [["沈砚", "夜行录"], ["白薇", "青灯录"]]){
    const btn = await drawerHTML(c, "single", "imported", name);
    t("B19 导入卡" + name + "(" + novel + ") 单聊抽屉无伏笔面板入口", btn === "", btn);
    const r = JSON.parse(callShow(c));
    t("B19 导入卡" + name + " showForeshadow 弹提示",
      r.toasts.some(m=>String(m).indexOf(GATE_MSG) >= 0), JSON.stringify(r.toasts));
    t("B19 导入卡" + name + " showForeshadow 不渲染任何伏笔",
      r.html === "KEEP", r.html);
    t("B19 导入卡" + name + " 渲染页无红楼伏笔文本",
      r.html.indexOf("绛珠还泪之约") < 0 && r.html.indexOf("凤姐初见黛玉") < 0, r.html);
  }

  /* ---------- 2. 与蒸馏书同名人物不串 ---------- */
  const sameBtn = await drawerHTML(c, "single", "imported", "林黛玉");
  t("B19 导入卡林黛玉(夜行录) 与红楼同名仍无入口", sameBtn === "", sameBtn);
  const sameR = JSON.parse(callShow(c));
  t("B19 导入卡林黛玉(夜行录) 直接调用被拦下",
    sameR.html === "KEEP" && sameR.toasts.some(m=>String(m).indexOf(GATE_MSG) >= 0),
    JSON.stringify(sameR));

  const hlBtn = await drawerHTML(c, "single", "honglou_full", "林黛玉");
  t("B19 蒸馏林黛玉(红楼梦) 入口照常存在", hlBtn.indexOf("showForeshadow()") >= 0, hlBtn);
  const hlR = JSON.parse(callShow(c));
  t("B19 蒸馏林黛玉 面板标题与条目正常渲染",
    vmEval(c, "document.getElementById('title').innerHTML").indexOf("伏笔面板") >= 0 &&
    hlR.html.indexOf("凤姐初见黛玉时的伏笔") >= 0 &&
    hlR.html.indexOf("未回收 · 1") >= 0, hlR.html.slice(0, 160));
  t("B19 蒸馏林黛玉 不弹门禁提示", !hlR.toasts.some(m=>String(m).indexOf(GATE_MSG) >= 0),
    JSON.stringify(hlR.toasts));

  /* ---------- 3. 红楼面板分组/渲染不受影响 ---------- */
  t("B19 红楼面板副标题带书名", /未回收 1 · 已回收 1/.test(
    vmEval(c, "document.getElementById('sub').textContent")),
    vmEval(c, "document.getElementById('sub').textContent"));
  t("B19 红楼面板未回收 tab 列出待回收伏笔",
    viewHTML(c).indexOf("凤姐初见黛玉时的伏笔") >= 0);
  vmEval(c, "window.fsTab('resolved');");
  const resHtml = viewHTML(c);
  t("B19 红楼面板已回收 tab 列出已回收伏笔",
    resHtml.indexOf("绛珠还泪之约") >= 0 && resHtml.indexOf("已回收 · 第 120 回兑现") >= 0,
    resHtml.slice(0, 200));
  t("B19 已回收 tab 不再出现未回收条目", resHtml.indexOf("凤姐初见黛玉时的伏笔") < 0);
  t("B19 红楼副标题按当前 run 取书名",
    vmEval(c, "document.getElementById('sub').textContent").indexOf("红楼梦") === 0,
    vmEval(c, "document.getElementById('sub').textContent"));
  /* 回目下钻仍可用 */
  vmEval(c, "window.fsTab('resolved'); window.foreshadowChapter(120);");
  t("B19 回目下钻渲染事件", viewHTML(c).indexOf("绛珠还泪之约") >= 0, viewHTML(c).slice(0, 160));

  /* ---------- 4. 群聊 + 非红楼蒸馏 run ---------- */
  const gBtn = await drawerHTML(c, "group", "honglou_full", null, ["林黛玉", "薛宝钗"]);
  t("B19 红楼群聊抽屉有伏笔面板入口", gBtn.indexOf("showForeshadow()") >= 0, gBtn);
  const shBtn = await drawerHTML(c, "group", "shuihu_full", null, ["林冲"]);
  t("B19 水浒群聊抽屉无伏笔面板入口(门禁按小说)", shBtn === "", shBtn);
  const shR = JSON.parse(callShow(c));
  t("B19 水浒群聊直接调用被拦下",
    shR.html === "KEEP" && shR.toasts.some(m=>String(m).indexOf(GATE_MSG) >= 0),
    JSON.stringify(shR));

  /* ---------- 5. 门禁 helper 自身语义 ---------- */
  const probe = (runId, name)=> vmEval(c, "(function(){CHAT.runId=" + JSON.stringify(runId) +
    ";CHAT.name=" + JSON.stringify(name) + ";return JSON.stringify(foreAvailable());})()");
  t("B19 foreAvailable: honglou_full=真", probe("honglou_full", "林黛玉") === "true");
  t("B19 foreAvailable: shuihu_full=假", probe("shuihu_full", "林冲") === "false");
  t("B19 foreAvailable: 导入卡(夜行录)=假", probe("imported", "沈砚") === "false");
  t("B19 foreAvailable: 找不到卡=假", probe("imported", "不存在的人") === "false");

  t("B19 foreAvailable: null runId=假",
      vmEval(c, "CHAT.runId=null; CHAT.name=null; JSON.stringify(foreAvailable())") === "false");
  console.log("B19: " + pass + " pass, " + fail + " fail");
  return fail === 0;
}
main().then(ok=>{ if(!ok) process.exit(1); });