const fs = require("fs"), vm = require("vm"), assert = require("assert");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 可执行剧情运行时回归：纯状态机 + prompt 素材，零 LLM / 零 DOM。
// localStorage 全 mock；worldcard 用 fixture 经 getWorldcard 注入。
function mkStore(){
  const m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    clear: () => { for(const k in m) delete m[k]; },
    key: i => Object.keys(m)[i] || null,
    get length(){ return Object.keys(m).length; },
  };
}
const WC = {
  name: "测试小说（小说世界）",
  directorDefinitions: [{
    title: "测试因果蓝图",
    stages: [
      {id:"stage-00", title:"开端", description:"主角出场。", nodeIds:["event-e0","event-e1","event-e2"], completion:false},
      {id:"stage-01", title:"高潮", description:"决战。", nodeIds:["event-e3"], completion:false},
    ],
    nodes: [
      {id:"event-e0", stageId:"stage-00", title:"主角上山",
       intent:"主角A被逼上山，投奔山寨。" + "x".repeat(300),
       actorIds:["actor-主角A"], execution:"background",
       conditions:[], dependsOn:[], constraints:[], sourceRefs:["ch001"]},
      {id:"event-e1", stageId:"stage-00", title:"夜袭官军",
       intent:"官军夜袭山寨，主角A迎战，店小二C暗中相助。",
       actorIds:["actor-主角A"], execution:"foreground",
       conditions:[{id:"c1", description:"官军已兵临山下"}],
       dependsOn:["event-e0"], constraints:["店小二C不可提前知晓密道"], sourceRefs:["ch002"]},
      {id:"event-e2", stageId:"stage-00", title:"庆功",
       intent:"大胜之后摆宴庆功。",
       actorIds:[], execution:"background",
       conditions:[], dependsOn:["event-e1"], constraints:[], sourceRefs:["ch003"]},
      {id:"event-e3", stageId:"stage-01", title:"决战",
       intent:"最终决战。",
       actorIds:[], execution:"foreground",
       conditions:[], dependsOn:[], constraints:[], sourceRefs:["ch004"]},
    ],
    characters: [{id:"actor-主角A", name:"主角A", aliases:["A哥"]}],
    coverage: {complete:false, gaps:[]},
  }],
};
function mkCtx(wc){
  const ls = mkStore();
  const ctx = { console, JSON, Math, Date, localStorage: ls,
    getWorldcard: (id) => (id === "wctest" ? wc : null) };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WWW + "/rp/plotrun.js", "utf8"), ctx);
  return { ctx, P: ctx.RP_PLOTRUN, ls };
}
const eq = (a, b, msg)=> assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
let n = 0;
const t = (name, fn)=>{ const r = fn(); n++; return Promise.resolve(r).then(()=> console.log("ok -", name)); };

(async ()=>{
await t("start：首节点为 dependsOn 为空的第一个", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  assert.strictEqual(st.currentNodeId, "event-e0");
  assert.strictEqual(st.runId, "wctest");
  eq(st.completedNodeIds, []);
  const back = P.load(st.id);
  assert.strictEqual(back.id, st.id); // 已落盘
});
await t("推进规则：dependsOn 未满足不推进、不跳关", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  assert.strictEqual(P.nextNode(st).id, "event-e0");
  P.completeNode(st, "event-e0", "上山");
  assert.strictEqual(P.nextNode(st).id, "event-e1"); // 不是 e2
  assert.strictEqual(st.currentNodeId, "event-e1");
  assert.strictEqual(st.choices.length, 1);
  assert.strictEqual(st.choices[0].choice, "上山");
});
await t("foreground/background 区分", ()=>{
  const { P } = mkCtx(WC);
  const fg = P.nodeById("wctest", "event-e1");
  const bg = P.nodeById("wctest", "event-e0");
  assert.strictEqual(P.choicesFor(fg), null); // foreground：导演 LLM 生成选项
  eq(P.choicesFor(bg), []); // background：无需选择
  eq(P.choicesFor(null), []);
});
await t("constraints 进 ban", ()=>{
  const { P } = mkCtx(WC);
  const bans = P.bansFor(P.nodeById("wctest", "event-e1"));
  assert.ok(bans.some(b => b.indexOf("店小二C不可提前知晓密道") >= 0));
  assert.ok(bans.every(b => b.indexOf("不许违反") === 0));
  eq(P.bansFor(P.nodeById("wctest", "event-e0")), []);
});
await t("directorBlock：intent 截断 + 改编标注，不整段照搬", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  const blk = P.directorBlock(st);
  assert.ok(blk.indexOf("【剧情节点】") >= 0);
  assert.ok(blk.indexOf("改编化用，绝不照搬原文") >= 0);
  assert.ok(blk.indexOf("…") >= 0, "长 intent 被截断");
  assert.strictEqual(blk.indexOf("x".repeat(250)), -1, "300 字 intent 未整段进入");
  assert.ok(blk.indexOf("（以上为剧情调度素材，不进入正文") >= 0);
});
await t("directorBlock：前台决策点停下等玩家，后台织入", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  P.completeNode(st, "event-e0");
  const fg = P.directorBlock(st);
  assert.ok(fg.indexOf("【前台决策点】") >= 0);
  assert.ok(fg.indexOf("绝不替玩家做决定") >= 0);
  assert.ok(fg.indexOf("禁令：") >= 0 && fg.indexOf("店小二C不可提前知晓密道") >= 0);
  assert.ok(fg.indexOf("触发条件：") >= 0 && fg.indexOf("官军已兵临山下") >= 0);
  const st2 = P.start("wctest", "stage-00");
  const bg = P.directorBlock(st2);
  assert.ok(bg.indexOf("【后台事件】") >= 0);
  assert.ok(bg.indexOf("绝不替玩家做决定") < 0 || bg.indexOf("前台决策点") < 0);
});
await t("走完一幕：nextNode 返回 null，progress 100%", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  P.completeNode(st, "event-e0");
  P.completeNode(st, "event-e1", "迎战");
  P.completeNode(st, "event-e2");
  assert.strictEqual(P.nextNode(st), null);
  assert.strictEqual(P.isFinished(st), true);
  eq(P.progress(st), {done:3, total:3, pct:100});
  assert.strictEqual(P.directorBlock(st), "", "走完后无当前节点，block 为空");
});
await t("断点续玩：load 恢复进度，latestFor 找到", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  P.completeNode(st, "event-e0", "上山");
  const id = st.id;
  // 状态已落 localStorage：load 即断点恢复
  const back = P.load(id);
  assert.strictEqual(back.completedNodeIds.length, 1);
  assert.strictEqual(back.currentNodeId, "event-e1");
  assert.strictEqual(back.choices[0].choice, "上山");
  const latest = P.latestFor("wctest", "stage-00");
  assert.strictEqual(latest.id, id);
});
await t("listStages：选幕数据带完成度与续玩标记", ()=>{
  const { P } = mkCtx(WC);
  let ss = P.listStages("wctest");
  assert.strictEqual(ss.length, 2);
  assert.strictEqual(ss[0].total, 3);
  assert.strictEqual(ss[0].done, 0);
  assert.strictEqual(ss[0].resumable, false);
  const st = P.start("wctest", "stage-00");
  P.completeNode(st, "event-e0");
  ss = P.listStages("wctest");
  assert.strictEqual(ss[0].done, 1);
  assert.strictEqual(ss[0].pct, 33);
  assert.strictEqual(ss[0].resumable, true);
  assert.strictEqual(ss[0].plotrunId, st.id);
  assert.strictEqual(ss[1].done, 0);
});
await t("hudHTML：幕标题 + n/m", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  const h = P.hudHTML(st);
  assert.ok(h.indexOf("开端") >= 0);
  assert.ok(h.indexOf("0/3") >= 0);
  assert.ok(h.indexOf("plotchip") >= 0);
  assert.strictEqual(P.hudHTML(null), "");
});
await t("reset：状态清除", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  P.reset(st.id);
  assert.strictEqual(P.load(st.id), null);
});
await t("无 worldcard 时不崩", ()=>{
  const { P } = mkCtx(null);
  const st = P.start("wctest", "stage-00");
  assert.strictEqual(st.currentNodeId, null);
  assert.strictEqual(P.nextNode(st), null);
  assert.strictEqual(P.directorBlock(st), "");
  eq(P.listStages("wctest"), []);
  eq(P.progress(st), {done:0, total:0, pct:0});
});
await t("铁律：模块不写正文、不替玩家做决定", ()=>{
  const src = fs.readFileSync(WWW + "/rp/plotrun.js", "utf8");
  assert.ok(src.indexOf("绝不替玩家做决定") >= 0, "铁律声明");
  assert.ok(!/document\./.test(src), "无 DOM 操作");
  assert.ok(src.indexOf("fetch(") < 0 && src.indexOf("XMLHttpRequest") < 0, "无网络请求");
});
await t("revertLast：弹出最后一次推进", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  const first = st.currentNodeId;
  P.completeNode(st, first, "玩家选择A");
  assert.ok(st.completedNodeIds.indexOf(first) >= 0, "已完成");
  assert.strictEqual(st.choices.length, 1, "有choice记录");
  const cur2 = st.currentNodeId;
  assert.notStrictEqual(cur2, first, "已推进到下一节点");
  P.revertLast(st);
  assert.strictEqual(st.currentNodeId, first, "currentNodeId回到决策节点");
  assert.strictEqual(st.completedNodeIds.indexOf(first), -1, "完成列表移除");
  assert.strictEqual(st.choices.length, 0, "choice记录弹出");
});
await t("revertLast：空状态不崩", ()=>{
  const { P } = mkCtx(WC);
  const st = P.start("wctest", "stage-00");
  P.revertLast(st);
  assert.strictEqual(st.choices.length, 0);
});
console.log("\n" + n + " pass, 0 fail");
})().catch(e=>{ console.error("FAIL:", e); process.exit(1); });
