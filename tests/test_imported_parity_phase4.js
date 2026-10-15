/* 导入卡平等待遇 Phase4 回归测试 (B7 / B8 / B17)
 *
 * Phase 4 的三项都是"结构性"的: 上一轮补的是内容面板, 这一轮补的是
 * 结构上压根不可达的东西。
 *
 *   B7  六大产物页: 导入卡没有 RUN, 整排 tab 进不去。解法是"卡片档案"聚合页 ——
 *       把卡自带的 worldbook / altGreetings / 卡面字段 / 示例对话 / 标签 /
 *       AI 补完标注汇进一个面板, 蒸馏产物缺席的部分逐条给 honest 空态。
 *       铁律: 不编数据。测试用"卡上什么都没有"和"卡上只有部分东西"两种卡,
 *       断言渲染结果里绝不该出现任何蒸馏产物的痕迹(关系/伏笔/章节/大纲…)。
 *   B8  与其它导入卡组队: 成员走 allChars() 而非 RUN.profiles, startGroupChat
 *       不再硬置 RUN.run_id。测试直接起一次真群聊, 拦下 CHAT 赋值看 run_id/members。
 *   B17 弧光可录入: RP_PROMPT.LABELS 登记 arc_* 五键(编辑器唯一的字段清单),
 *       RP_CARDIMPORT.GAPFILL_KEYS 扩到含弧光四键走现成 AI 补完通道。
 *       测试跑一次"编辑 -> 保存 -> 重读"的往返, 断言一个字段都没丢。
 *
 * 沙箱写法参照 tests/test_imported_parity_phase23.js; app.js 整文件载入参照
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
/* 载入 rp/* 模块 (+app.js), 返回带 localStorage 桩的上下文。
   extra: 额外塞进 #gpick 的复选框, 用来驱动 startGroupChat。 */
function mkCtx(files, extra){
  const store = {};
  const ls = {getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] || null, get length(){return Object.keys(store).length; }};
  const els = {};
  /* #gpick 里的复选框: querySelectorAll("#gpick input:checked") 只认 checked 的 */
  const boxes = (extra || []).map(v => Object.assign(mkEl(), {value: v, checked: true}));
  const doc = {body: mkEl(), head: mkEl(), documentElement: mkEl(),
    getElementById: id => els[id] || (els[id] = mkEl()),
    querySelector: sel => { const m = String(sel).match(/^#([\w-]+)$/); return m ? (els[m[1]] || (els[m[1]] = mkEl())) : null; },
    querySelectorAll: sel => (String(sel) === "#gpick input:checked" ? boxes : []),
    createElement: () => mkEl(), createTextNode: () => mkEl()};
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
  "rp/preset.js", "rp/persona.js", "rp/memory.js", "rp/apex.js", "rp/tasks.js", "rp/arc.js",
  "rp/cardwriter.js", "rp/ooc.js", "rp/playstats.js", "rp/portrait.js", "rp/chat.js",
  "rp/aifill.js", "rp/group.js", "rp/cardexport.js", "rp/cardimport.js",
  "rp/agent_lorekeeper.js", "rp/agent_relations.js", "rp/agent_cardevo.js", "rp/warn.js"];

/* 蒸馏基线数据: 一条真 run。故意放上关系/章节/大纲/伏笔, 好让"导入卡聚合页
   绝不能把这些渲染出来"这条断言有东西可对比。 */
const BASE_RUNS = {honglou_full: {run_id: "honglou_full", novel: "红楼梦",
  profiles: [{name: "林黛玉", md: "两弯似蹙非蹙罥烟眉。"}, {name: "薛宝钗", md: "琥珀金钗。"}],
  worldbook: [{title: "红楼条目", content: "大观园的规矩", enabled: true}],
  relations: [{source_character: "林黛玉", target_character: "贾宝玉",
    relationship_summary: "两小无猜"}],
  corrections: [{character: "林黛玉", prompt_injection_rule: "黛玉不许说英文"}]}};
const BASE_CARDS = {honglou_full: [{name: "林黛玉", fields: {timeline_stage: "大观园时期"}}]};

/* 一张最"空"的 ST 卡: 没有 character_book, 没有示例对话, 没有卡面字段。
   聚合页在它身上必须全是 honest 空态。 */
function mkRawBare(name, novel){
  return {name: name, tags: [novel], description: name + "其人。", personality: "寡言"};
}
/* 一张带 character_book / 多开场 / 卡面字段的 ST 卡: 聚合页必须把这些都渲染出来 */
function mkRawRich(name, novel){
  return {name: name, tags: [novel], description: name + "其人。", personality: "寡言",
    scenario: "夜雨敲窗。", system_prompt: "扮演" + name + ", 语气克制。",
    creator_notes: "作者是个夜猫子。", creator: "作者甲",
    first_mes: "……" + name + "抬眼。", alternate_greetings: ["……" + name + "搁下笔。"],
    mes_example: "{{user}}: 你来了？\n{{char}}: 嗯。",
    extensions: {example_dialogue: "你来了？<START>嗯。落雨了。"},
    character_book: {name: novel + "志", entries: [
      {keys: ["银铃"], content: "银铃是当铺的镇店之物, 摇三声即有人来。", enabled: true}]}};
}
const seedCard = (ctx, raw)=>
  vmEval(ctx, "RP_CARDIMPORT.add(RP_CARDIMPORT.normalizeTavern(" + JSON.stringify(raw) + "));");
const RAW_A = mkRawBare("沈砚", "夜行录");
const RAW_B = mkRawBare("白薇", "青灯录");
const RAW_C = mkRawRich("柳三更", "青灯录");

const mkCtxBase = (withApp, extra)=> {
  const c = mkCtx(withApp ? RP_FILES.concat(["app.js"]) : RP_FILES, extra);
  vmEval(c, "window.__DATA__ = " + JSON.stringify(
    {index: [], runs: BASE_RUNS, rp_cards: BASE_CARDS}) + ";");
  return c;
};

/* 起一个群聊, 返回 CHAT 快照 (startGroupChat 末尾会 setNav("chat"), 桩里直接吞掉) */
function startGroup(ctx){
  ctx.__nav = null;
  vmEval(ctx, 'window.__navSeen = null; (function(){ var o = window.setNav; window.setNav = function(n){ window.__navSeen = n; }; })();');
  vmEval(ctx, "startGroupChat();");
  return JSON.parse(vmEval(ctx, "JSON.stringify({mode: CHAT.mode, runId: CHAT.runId, name: CHAT.name, members: CHAT.members})"));
}

/* =======================================================================
 * B17 弧光可录入
 * ===================================================================== */
function testB17(){
  const c = mkCtxBase(false);

  /* --- LABELS: 卡片编辑器唯一的字段清单, arc_* 不登记就"保存即丢" --- */
  const L = JSON.parse(vmEval(c, "JSON.stringify(RP_PROMPT.LABELS)"));
  const ARC_KEYS = ["arc_type", "arc_start", "arc_mid", "arc_end", "timeline_stage"];
  ARC_KEYS.forEach(k => t("LABELS 含 " + k, typeof L[k] === "string" && L[k].length > 0, L[k]));
  /* 刻意不进 LAYERS: 否则弧光会被 renderFields 重复注入 prompt */
  const LAY = JSON.parse(vmEval(c, "JSON.stringify(RP_PROMPT.LAYERS)"));
  const inLayer = Object.keys(LAY).filter(g => LAY[g].indexOf("arc_type") >= 0);
  t("弧光键不进 LAYERS(避免重复注入)", inLayer.length === 0, inLayer.join(","));
  /* 五键都有中文标签, 不是裸 key */
  t("弧光键标签非裸 key", ARC_KEYS.every(k => L[k] && L[k] !== k));

  /* --- GAPFILL_KEYS: 弧光四键走现成 AI 补完通道 --- */
  const GK = JSON.parse(vmEval(c, "JSON.stringify(RP_CARDIMPORT.GAPFILL_KEYS)"));
  ["arc_type", "arc_start", "arc_mid", "arc_end"].forEach(k =>
    t("GAPFILL_KEYS 含 " + k, GK.indexOf(k) >= 0));
  ["ooc_redline", "soul_goal", "hidden_desire", "inner_need"].forEach(k =>
    t("GAPFILL_KEYS 保留原有 " + k, GK.indexOf(k) >= 0));
  /* timeline_stage 不补: 候选表是红楼专属九项, 猜阶段等于凭空造时间坐标 */
  t("GAPFILL_KEYS 不含 timeline_stage(不自动补阶段)", GK.indexOf("timeline_stage") < 0);

  /* 缺失检测: 空卡缺全部 8 个, 填过的不再算缺失 */
  const miss = JSON.parse(vmEval(c,
    "JSON.stringify(RP_CARDIMPORT.missingGapfillKeys({fields:{}}))"));
  t("空卡缺全部补完键", miss.length === GK.length, miss.length + "/" + GK.length);
  const filled = JSON.parse(vmEval(c, "JSON.stringify(RP_CARDIMPORT.missingGapfillKeys({fields:{" +
    GK.map(k => JSON.stringify(k) + ':"x"').join(",") + "}}))"));
  t("补完键都填过则无缺失", filled.length === 0);

  /* 补完 prompt: 弧光键缺席时不写 arc 规则; 在场时必须约束 arc_type 取值 */
  const pNoArc = vmEval(c, "RP_CARDIMPORT.gapfillPrompt({fields:{core_identity:\"x\"}}, ['ooc_redline'])");
  t("不补弧光时 prompt 不提 arc_type", pNoArc.indexOf("arc_type") < 0);
  const pArc = vmEval(c, "RP_CARDIMPORT.gapfillPrompt({fields:{core_identity:\"x\"}, greeting:\"……他抬眼。\"}, " +
    JSON.stringify(GK) + ")");
  t("补弧光时 prompt 约束 arc_type 取值",
    pArc.indexOf("fall") >= 0 && pArc.indexOf("awakening") >= 0 &&
    pArc.indexOf("rise") >= 0 && pArc.indexOf("flat") >= 0);
  t("补弧光时 prompt 带开场白作为依据", pArc.indexOf("开场白") >= 0);
  t("补完 prompt 仍要求只输出 JSON", pArc.indexOf("JSON") >= 0);

  /* --- 编辑器往返: 录入 -> 保存 -> 重读, 五个弧光键一个都不能丢 --- */
  const cA = mkCtxBase(true);
  seedCard(cA, RAW_A);
  const id = JSON.parse(vmEval(cA, "JSON.stringify(RP_CARDIMPORT.list()[0].id)"));
  /* 录入: 模拟用户在编辑页填了五个弧光字段(arc_mid 多转折点用「；」分隔, 仓库就是这个约定) */
  const ARC_VALS = {arc_type: "rise", arc_start: "被迫寄人篱下", arc_mid: "渐生情愫；被人拿捏",
    arc_end: "自毁以求全", timeline_stage: "流放途中"};
  vmEval(cA, `(function(){
    var V = ${JSON.stringify(ARC_VALS)};
    Object.keys(V).forEach(function(k){
      var el = document.getElementById("cef_" + k);
      if(el) el.value = V[k];
    });
  })()`);
  /* 先让编辑页真的把字段画出来, 再存 —— 这一步验证 LABELS 真的驱动了表单 */
  vmEval(cA, "editCard('imported', " + JSON.stringify(id) + ")");
  const formHtml = vmEval(cA, "document.getElementById('view').innerHTML");
  ARC_KEYS.forEach(k => t("编辑页渲染了 " + k + " 输入框", formHtml.indexOf('id="cef_' + k + '"') >= 0));
  t("编辑页显示弧光键的中文标签", formHtml.indexOf(RP_PROMPT_LABEL(cA, "arc_type")) >= 0);

  vmEval(cA, "window.showTraverse = function(){};");   /* 保存后跳回列表页, 与字段无关, 桩掉 */
  vmEval(cA, "saveCardEdit('imported', " + JSON.stringify(id) + ")");
  const back = JSON.parse(vmEval(cA,
    "JSON.stringify(RP_CARDIMPORT.findById(" + JSON.stringify(id) + ").fields)"));
  ARC_KEYS.forEach(k => t("保存往返不丢 " + k, back[k] === ARC_VALS[k], JSON.stringify(back[k])));

  /* 弧光真进了 RP_ARC 的读数链路: 类型标签 + 起承转合 */
  const card2 = JSON.parse(vmEval(cA, "JSON.stringify(RP_CARDIMPORT.findById(" + JSON.stringify(id) + "))"));
  const sum = JSON.parse(vmEval(cA, "JSON.stringify(RP_ARC.arcSummary(" + JSON.stringify(card2) + ", 'imported'))"));
  t("RP_ARC 读得到录入的类型", sum.type === "rise" && sum.typeLabel === "上升", JSON.stringify(sum));
  t("RP_ARC 读得到录入的起/合", sum.start === ARC_VALS.arc_start && sum.end === ARC_VALS.arc_end);
  t("RP_ARC 把 arc_mid 拆成多转折点", sum.mids.length === 2, JSON.stringify(sum.mids));
  t("RP_ARC 读得到录入的阶段", sum.defaultStage === ARC_VALS.timeline_stage);
  /* 录了弧光就该进 prompt, 没录就返回空串(不给没数据的卡编弧光) */
  const arcPrompt = vmEval(cA, "RP_ARC.renderArcPrompt(" + JSON.stringify(card2) + ", 'imported')");
  t("录入后弧光进 prompt", arcPrompt.indexOf("上升") >= 0 && arcPrompt.indexOf("起：") >= 0);
  const emptyArc = vmEval(c, "RP_ARC.renderArcPrompt({name:'无弧光', fields:{}}, 'imported')");
  t("没录入时弧光 prompt 为空(不编造)", emptyArc === "", JSON.stringify(emptyArc));

  /* --- 没有弧光数据的卡, 详情页必须给 honest 空态 --- */
  const cB = mkCtxBase(true);
  seedCard(cB, RAW_A);
  const idB = JSON.parse(vmEval(cB, "JSON.stringify(RP_CARDIMPORT.list()[0].id)"));
  const arcHtml = vmEval(cB, "renderArcBody('imported', " + JSON.stringify(idB) + ", RP_CARDIMPORT.findById(" + JSON.stringify(idB) + "))");
  t("无弧光时详情页给空态", arcHtml.indexOf("暂无人物弧光资料") >= 0, arcHtml.slice(0, 80));
  t("无弧光空态不编造阶段下拉", arcHtml.indexOf("<select") < 0);
}
/* 取 app.js 上下文里的中文标签(标签表在 RP_PROMPT 上, 但断言文案从模块取避免重复硬编码) */
function RP_PROMPT_LABEL(c, k){
  return vmEval(c, "RP_PROMPT.LABELS[" + JSON.stringify(k) + "]");
}

/* =======================================================================
 * B7 卡片档案聚合页
 * ===================================================================== */
function testB7(){
  const c = mkCtxBase(true);
  seedCard(c, RAW_A);   /* 裸卡: 无 worldbook / 无示例对话 / 无卡面字段 */
  seedCard(c, RAW_C);   /* 丰富卡: 有 character_book / 多开场 / 卡面字段 */

  t("聚合页入口存在", vmEval(c, "typeof window.openCardArchive === 'function'"));
  t("落地页有卡片档案入口",
    vmEval(c, "cardLandingHTML('imported','柳三更', RP_CARDIMPORT.find('柳三更'), {}).indexOf('openCardArchive') >= 0"));

  /* --- 丰富卡: 卡上真有的东西必须都渲染出来 --- */
  const rich = vmEval(c, "openCardArchive('imported','柳三更'); document.getElementById('view').innerHTML");
  t("聚合页渲染卡自带世界书条目", rich.indexOf("银铃是当铺的镇店之物") >= 0);
  t("聚合页渲染开场白", rich.indexOf("柳三更抬眼") >= 0 && rich.indexOf("柳三更搁下笔") >= 0);
  t("聚合页渲染场景设定", rich.indexOf("夜雨敲窗") >= 0);
  t("聚合页渲染系统提示词", rich.indexOf("语气克制") >= 0);
  t("聚合页渲染示例对话", rich.indexOf("你来了") >= 0);
  t("聚合页有返回按钮", rich.indexOf("archiveBack()") >= 0);

  /* --- 裸卡: 空的部分必须是 honest 空态, 不能拿别的数据填 --- */
  const bare = vmEval(c, "openCardArchive('imported','沈砚'); document.getElementById('view').innerHTML");
  t("无世界书时给空态", bare.indexOf("这张卡没有自带世界书") >= 0);
  t("无示例对话时给空态", bare.indexOf("没有示例对话") >= 0);
  t("无自建世界书时给空态", bare.indexOf("还没写条目") >= 0);
  t("无 AI 补完字段时给空态", bare.indexOf("没有任何 AI 补完字段") >= 0);
  /* 空态要说明"怎么补" */
  t("空态给出补救路径(编辑器)", bare.indexOf("去卡片编辑器") >= 0 || bare.indexOf("去编辑器") >= 0);

  /* 铁律: 导入卡没有的东西, 一律不许出现在聚合页里 */
  const FORBIDDEN = [
    ["静态人物关系", "两小无猜"],           /* 蒸馏 run.relations 的摘要 */
    ["蒸馏世界书条目", "大观园的规矩"],     /* 蒸馏 run.worldbook */
    ["蒸馏人物档案", "两弯似蹙非蹙罥烟眉"], /* 蒸馏 run.profiles */
    ["反OOC纠错", "黛玉不许说英文"],       /* 蒸馏 run.corrections */
  ];
  FORBIDDEN.forEach(([what, needle]) =>
    t("聚合页不含" + what, bare.indexOf(needle) < 0 && rich.indexOf(needle) < 0));
  t("聚合页不含红楼人物名(跑错 run 的信号)", bare.indexOf("林黛玉") < 0 && rich.indexOf("林黛玉") < 0);

  /* 缺席清单: 逐条说清"这是什么/为什么没有/怎么补", 且不许塞假数据 */
  const ABSENT = ["人物档案 profiles", "分段大纲 sections", "静态人物关系 relations",
    "剧情线 event_dag", "世界卡 worldcard", "伏笔 / 冲突 / 修正", "判词 / 脂批 / 方法论"];
  ABSENT.forEach(k => t("缺席清单列出 " + k, bare.indexOf(k) >= 0));
  t("缺席清单标题说明是蒸馏产物", bare.indexOf("蒸馏产物 · 导入卡天然没有") >= 0);
  t("缺席清单说明了补救路径(关系)", bare.indexOf("关系管理") >= 0);

  /* 找不到卡时不白屏 */
  const gone = vmEval(c, "openCardArchive('imported','不存在的人'); document.getElementById('view').innerHTML");
  t("找不到卡时给提示而非白屏", gone.indexOf("找不到这张卡") >= 0);

  /* 返回键回落到详情页 */
  vmEval(c, "openCardArchive('imported','柳三更'); archiveBack();");
  t("返回后回到详情页", vmEval(c, "document.getElementById('view').innerHTML").length > 0);
}

/* =======================================================================
 * B8 与其它导入卡组队
 * ===================================================================== */
function testB8(){
  const c = mkCtxBase(true, ["沈砚", "白薇", "柳三更"]);
  seedCard(c, RAW_A); seedCard(c, RAW_B); seedCard(c, RAW_C);

  t("组队入口存在", vmEval(c, "typeof window.importedGroupPicker === 'function'"));

  /* 选人页: 成员来自 allChars() 里的导入卡, 不是 RUN.profiles */
  const pick = vmEval(c, "importedGroupPicker(); document.getElementById('view').innerHTML");
  ["沈砚", "白薇", "柳三更"].forEach(n => t("选人页列出导入卡 " + n, pick.indexOf('value="' + n + '"') >= 0));
  t("选人页不列蒸馏 run 的人物", pick.indexOf("林黛玉") < 0);
  t("选人页说明导入卡没有共用静态关系", pick.indexOf("没有共用的静态人物关系") >= 0);

  /* 起群: runId 不再硬置 RUN.run_id(此时 RUN 是 null, 硬置会直接抛) */
  vmEval(c, "RUN = null;");   /* 导入卡群聊没有 run: 硬取 RUN.run_id 会直接抛 */
  const chat = startGroup(c);
  t("群聊模式", chat.mode === "group");
  t("群聊 runId 为 imported 而非 RUN.run_id", chat.runId === "imported", JSON.stringify(chat));
  t("群聊成员来自 allChars()", chat.members.length === 3 &&
    chat.members.indexOf("沈砚") >= 0 && chat.members.indexOf("柳三更") >= 0, JSON.stringify(chat.members));
  t("群聊 name 为 null", chat.name === null);
  t("建群后切到 chat 页", vmEval(c, "window.__navSeen") === "chat");

  /* 关键回归: RUN 指向某个真 run 时, 导入卡群聊的 runId 仍必须是 "imported"。
     若 startGroupChat 硬取 RUN.run_id, 这里就会变成 "honglou_full" —— 群聊历史键
     (groupKey)、世界书键、关系键都会挂到那部小说底下, 两边互相串。 */
  const c4 = mkCtxBase(true, ["沈砚", "白薇"]);
  seedCard(c4, RAW_A); seedCard(c4, RAW_B);
  vmEval(c4, "importedGroupPicker(); RUN = window.__DATA__.runs.honglou_full;");
  const chat4 = startGroup(c4);
  t("RUN 指向真 run 时导入卡群聊仍不借用它", chat4.runId === "imported", JSON.stringify(chat4));
  t("借用 RUN 时成员不会混进蒸馏人物",
    chat4.members.indexOf("林黛玉") < 0 && chat4.members.length === 2, JSON.stringify(chat4.members));

  /* 蒸馏 run 侧的群聊仍然走 RUN.run_id(回归: 原来那条路不能被我改坏) */
  const c2 = mkCtxBase(true, ["林黛玉", "薛宝钗"]);
  vmEval(c2, "RUN = window.__DATA__.runs.honglou_full; groupPicker();");
  const chat2 = startGroup(c2);
  t("蒸馏 run 群聊仍用 RUN.run_id", chat2.runId === "honglou_full", JSON.stringify(chat2));
  t("蒸馏 run 群聊成员来自 RUN.profiles", chat2.members.length === 2 &&
    chat2.members.indexOf("林黛玉") >= 0);

  /* 成员不足 2 张时给 honest 空态, 不给半截选择页 */
  const c3 = mkCtxBase(true);
  seedCard(c3, RAW_A);
  const few = vmEval(c3, "importedGroupPicker(); document.getElementById('view').innerHTML");
  t("导入卡不足2张时给空态", few.indexOf("导入卡还不足 2 张") >= 0);
  t("不足2张时说明怎么补", few.indexOf("去写卡") >= 0 || few.indexOf("写卡") >= 0);
  t("不足2张时不给复选框", few.indexOf('id="gpick"') < 0);

  /* 关系编辑器: 导入卡群聊没有可继承的静态关系, 老实说明而不是假装有 */
  const relHtml = vmEval(c, `(function(){
    var box = document.getElementById("grelbox");
    var old = document.getElementById;
    document.getElementById = function(id){ return id === "grelbox" ? box : old.call(document, id); };
    renderGRelBox();
    document.getElementById = old;
    return box.innerHTML;
  })()`);
  t("导入卡群聊关系编辑器给诚实说明", relHtml.indexOf("导入卡之间没有共用的静态人物关系") >= 0, relHtml.slice(0, 90));
  t("导入卡群聊关系编辑器仍可手写关系", relHtml.indexOf('id="grel_r"') >= 0);

  /* 蒸馏 run 群聊的关系编辑器保持原样(回归) */
  const relHtml2 = vmEval(c2, `(function(){
    var box = document.getElementById("grelbox");
    var old = document.getElementById;
    document.getElementById = function(id){ return id === "grelbox" ? box : old.call(document, id); };
    renderGRelBox();
    document.getElementById = old;
    return box.innerHTML;
  })()`);
  t("蒸馏 run 关系编辑器文案不变", relHtml2.indexOf("还没设定关系") >= 0);

  /* 关系真的能落库并被 prompt 读到(RP_GROUP 只按 (runId, gkey) 分键, 不需要 run) */
  const rels = JSON.parse(vmEval(c,
    "(function(){ var gk = CHAT.members.slice().sort().join('_');" +
    " RP_GROUP.addRel(CHAT.runId, gk, '沈砚', '白薇', '师兄');" +
    " return JSON.stringify(RP_GROUP.getRels(CHAT.runId, gk)); })()"));
  t("导入卡群聊关系可写入", rels.length === 1 && rels[0].rel === "师兄", JSON.stringify(rels));
  const relText = vmEval(c,
    "(function(){ var gk = CHAT.members.slice().sort().join('_');" +
    " return RP_GROUP.renderRels(CHAT.runId, gk); })()");
  t("手写关系能渲染成 prompt 文本", relText.indexOf("沈砚") >= 0 && relText.indexOf("师兄") >= 0);

  /* 选人页入口出现在聊天选择器里, 且导入卡 <2 时换成说明 */
  const sel = vmEval(c, "showChatPicker(); document.getElementById('view').innerHTML");
  t("聊天选择器有组队入口", sel.indexOf("importedGroupPicker()") >= 0, sel.slice(0, 60));
  const sel1 = vmEval(c3, "showChatPicker(); document.getElementById('view').innerHTML");
  t("导入卡不足2张时选择器给说明", sel1.indexOf("导入卡还不满 2 张") >= 0);

  /* 群聊 prompt 装配对无 run 的导入卡不崩: rp/chat.js 的 promptWorldbook 拼的是
     run.worldbook + card.worldbook + userLore, 而 sendGroup 对无 run 的 runId 兜底成 {}。
     所以"卡自带的 worldbook 还在 findCard 里"就是它能进群聊 prompt 的全部前提。 */
  t("无 run 时 sendGroup 的 run 兜底为空对象",
    vmEval(c, "(window.__DATA__.runs||{})['imported'] === undefined"));
  const fc = JSON.parse(vmEval(c, "JSON.stringify(RP.findCard('imported','柳三更'))"));
  t("findCard 对 imported 返回带 worldbook 的完整卡",
    Array.isArray(fc.worldbook) && fc.worldbook.some(e => String(e.content||"").indexOf("银铃") >= 0),
    JSON.stringify((fc.worldbook||[]).map(e=>e.title)));
}

/* ===================================================================== */
async function main(){
  testB17();
  testB7();
  testB8();
  console.log("\nimported-parity-phase4: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
}
main();