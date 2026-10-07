/* 集成契约测试：plotrun × portrait 在同一上下文走完"开局→节点→画像"全链路。
 * 用法: node tests/test_plotrun_portrait_link.js */
const fs = require("fs"), vm = require("vm"), path = require("path");
let pass = 0, fail = 0;
function ok(c, name){ if(c){ pass++; } else { fail++; console.log("FAIL:", name); } }

const store = {};
const sandbox = {
  console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] || null,
    get length(){ return Object.keys(store).length; },
  },
  window: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);

/* 假世界卡：2 幕，第一幕 3 节点（含 dependsOn 链 + 1 个 foreground 决策点） */
sandbox.window.__WORLDCARD_test = {
  name: "测试书",
  directorDefinitions: [{
    title: "测试导演", coreConflict: "善恶对决", anchors: ["锚点A"],
    stages: [
      {id: "s1", title: "第一幕", description: "开端", nodeIds: ["n1","n2","n3"]},
      {id: "s2", title: "第二幕", description: "发展", nodeIds: ["n4"]},
    ],
    nodes: [
      {id: "n1", stageId: "s1", title: "风起", intent: "主角在风雪夜出发，意概要改编化用不能照搬原文很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长", execution: "background", conditions: [], dependsOn: [], constraints: ["主角不可提前知晓结局"], actorIds: ["主角"], sourceRefs: []},
      {id: "n2", stageId: "s1", title: "抉择", intent: "岔路口，主角必须选择", execution: "foreground", conditions: [{description: "抵达岔路"}], dependsOn: ["n1"], constraints: [], actorIds: ["主角"], sourceRefs: []},
      {id: "n3", stageId: "s1", title: "落幕", intent: "第一幕结束", execution: "background", conditions: [], dependsOn: ["n2"], constraints: [], actorIds: [], sourceRefs: []},
      {id: "n4", stageId: "s2", title: "新篇", intent: "第二幕开始", execution: "background", conditions: [], dependsOn: [], constraints: [], actorIds: [], sourceRefs: []},
    ],
    characters: [], coverage: {},
  }],
};
sandbox.getWorldcard = function(runId){ return sandbox.window["__WORLDCARD_" + runId] || null; };

/* decisionNode 需要的 traverse 会话 stub */
const travSessions = {};
sandbox.RP_TRAVERSE = { get: (id) => travSessions[id] || null };
for(const f of ["www/rp/plotrun.js", "www/rp/portrait.js", "www/rp/achieve.js"]){
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sandbox, {filename: f});
}
const PR = sandbox.RP_PLOTRUN, PT = sandbox.RP_PORTRAIT;
ok(PR && PT, "两模块同上下文加载");

/* ---- plotrun 全链路 ---- */
const stages = PR.listStages("test");
ok(stages.length === 2 && stages[0].total === 3, "listStages 2 幕/第一幕 3 节点");
let st = PR.start("test", "s1");
ok(st.currentNodeId === "n1", "开局落在首个无依赖节点");
let blk = PR.directorBlock(st);
ok(blk.includes("【剧情节点】") && blk.includes("改编化用") && blk.includes("不许违反"),
  "directorBlock 含节点标记+改编声明+禁令");
ok(blk.length < 900, "directorBlock 被截断防照搬 (len=" + blk.length + ")");
/* 模拟 app.js 的"发送后推进" */
PR.completeNode(st, st.currentNodeId, "玩家：继续赶路");
ok(st.currentNodeId === "n2", "推进到 n2（dependsOn n1 满足）");
blk = PR.directorBlock(st);
ok(blk.includes("前台决策点") && blk.includes("把选择权交给玩家"), "foreground 节点是决策点指令");
ok(PR.choicesFor(PR.nodeById("test", "n2")) === null, "foreground choicesFor 返回 null（导演生成选项）");
ok(JSON.stringify(PR.choicesFor(PR.nodeById("test", "n1"))) === "[]", "background choicesFor 返回 []");
PR.completeNode(st, st.currentNodeId, "玩家：选左路");
PR.completeNode(st, st.currentNodeId, "玩家：继续");
ok(PR.isFinished(st), "走完第一幕");
const p = PR.progress(st);
ok(p.done === 3 && p.total === 3 && p.pct === 100, "progress 3/3=100%");
ok(st.choices.length === 3, "玩家选择被记录");
/* 断点续玩 */
const st2 = PR.load(st.id);
ok(st2 && PR.isFinished(st2), "load 恢复已完成状态");
const hud = PR.hudHTML(st2);
ok(hud.includes("plotchip") && hud.includes("3/3"), "hudHTML 含进度");
PR.reset(st.id);
ok(PR.load(st.id) === null, "reset 清除");

/* ---- portrait 全链路 ---- */
const card = {fields: {
  ooc_redline: "背叛兄弟；临阵脱逃",
  decision_rules: "先保兄弟，再论是非",
  emotion_model: "外冷内热",
  speech_style: "话少",
}};
let r = PT.enrich(card, "他背叛了我们，我要报仇！", []);
ok(r.banned.length === 2 && r.text.includes("【硬禁令】"), "冲突场景抽出硬禁令");
ok(r.text.length <= 800, "预算内");
ok(r.hits.some(h => h.field === "decision_rules"), "命中决策准则");
let r2 = PT.enrich(card, "今天天气不错", []);
ok(r2.text === "" && r2.hits.length === 0, "无情境静默返回空");
const dbg = PT.renderDebug(r.hits, r.banned);
ok(dbg.includes("硬禁令") && dbg.includes("决策准则"), "renderDebug 可审计");
/* 契约：enrich 永远不抛 */
let threw = false;
try{ PT.enrich(null, null, null); PT.enrich({fields:{ooc_redline: 123}}, "杀", []); }catch(e){ threw = true; }
ok(!threw, "enrich 容错不抛错");

/* ---- decisionNode：决策点判定（供发送链路强制选项卡） ---- */
let dst = PR.start("test", "s1"); /* n1 background */
travSessions["t1"] = {id: "t1", plotrunId: dst.id};
ok(PR.decisionNode("t1") === null, "background 节点不强制选项卡");
PR.completeNode(dst, dst.currentNodeId, "走"); /* -> n2 foreground */
const dn = PR.decisionNode("t1");
ok(dn && dn.id === "n2", "foreground 决策点返回节点");
ok(PR.decisionNode("unknown") === null, "未知会话返回 null");
ok(PR.decisionNode(null) === null, "空 id 返回 null");
PR.completeNode(dst, dst.currentNodeId, "选左");
PR.completeNode(dst, dst.currentNodeId, "继续");
ok(PR.decisionNode("t1") === null, "走完后返回 null");

/* ---- 成就 plotline_1 ---- */
const ACHV = vm.runInContext("RP_ACHV", sandbox);
ok(ACHV && ACHV.unlock("plotline_1") === true, "走完一幕解锁成就");
ok(ACHV.unlock("plotline_1") === false, "成就解锁幂等");
ok(ACHV.has("plotline_1"), "成就已记录");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
