const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 穿越 P3: 组团穿越（复用 RP_GROUP 调度 / 小队增删）
function mkCtx(withGroup, groupMock){
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const ctx = {localStorage, console};
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.__DATA__ = {runs: {}, rp_cards: {}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WWW + "/rp/traverse.js", "utf8"), ctx, {filename: "traverse.js"});
  if(withGroup) vm.runInContext(fs.readFileSync(WWW + "/rp/group.js", "utf8"), ctx, {filename: "group.js"});
  if(groupMock) ctx.RP_GROUP = groupMock;
  vm.runInContext(fs.readFileSync(WWW + "/rp/traverse2.js", "utf8"), ctx, {filename: "traverse2.js"});
  return {ctx, store, T2: vm.runInContext("RP_TRAVERSE2", ctx)};
}

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- 真实 RP_GROUP：点名优先 ----
{
  const {T2} = mkCtx(true);
  const comps = [{name: "薛宝钗", talk: 0}, {name: "林黛玉", talk: 0}, {name: "王熙凤", talk: 0}];
  const sp = T2.planParty("宝钗你怎么看", comps, null, {});
  t("点名优先", sp.length === 1 && sp[0] === "薛宝钗");
  // talk=0 无人主动 → 兜底恰好 1 人且不连庄
  const sp2 = T2.planParty("大家好", comps, "薛宝钗", {});
  t("talk0兜底1人", sp2.length === 1);
  t("兜底不连庄", sp2[0] !== "薛宝钗");
  // maxSpeakers 默认 3
  const many = [{name: "甲", talk: 100}, {name: "乙", talk: 100}, {name: "丙", talk: 100}, {name: "丁", talk: 100}];
  t("默认上限3", T2.planParty("大家好", many, null, {}).length === 3);
  t("maxSpeakers透传", T2.planParty("大家好", many, null, {maxSpeakers: 2}).length === 2);
  t("返回名字数组", T2.planParty("大家好", many, null, {maxSpeakers: 1})[0] === "甲");
}

// ---- talkMap 透传（捕获型 mock RP_GROUP） ----
{
  let captured = null;
  const mock = {planSpeakers: function(ut, members, talkMap, last, opts){
    captured = {ut, members, talkMap, last, opts}; return ["X"];
  }};
  const {T2} = mkCtx(false, mock);
  const r = T2.planParty("hi", [{name: "林黛玉"}, {name: "薛宝钗", talk: 80}], "nobody", {});
  t("mock被调用", r[0] === "X" && !!captured);
  t("talk缺省50", captured.talkMap["林黛玉"] === 50);
  t("talk透传80", captured.talkMap["薛宝钗"] === 80);
  t("maxSpeakers默认3透传", captured.opts.maxSpeakers === 3);
  t("lastSpeaker透传", captured.last === "nobody");
}

// ---- 无 RP_GROUP 降级：简易 roll 点 ----
{
  const {T2} = mkCtx(false);
  const comps = [{name: "薛宝钗", talk: 0}, {name: "林黛玉", talk: 0}];
  const sp = T2.planParty("宝钗你来", comps, null, {});
  t("降级点名命中", sp.length === 1 && sp[0] === "薛宝钗");
  let ok = true;
  for(let i = 0; i < 20; i++){
    const s = T2.planParty("大家好", comps, "薛宝钗", {});
    if(s.length !== 1 || s[0] === "薛宝钗") ok = false;
  }
  t("降级talk0兜底", ok);
  const act = T2.planParty("大家好",
    [{name: "甲", talk: 100}, {name: "乙", talk: 100}, {name: "丙", talk: 100}], null, {});
  t("降级talk100全激活", act.length === 3);
}

// ---- partyPrompt ----
{
  const {T2} = mkCtx(false);
  const p = T2.partyPrompt({charName: "玩家"});
  t("队友自主", p.indexOf("自主发言") >= 0 && p.indexOf("拌嘴") >= 0);
  t("点名指挥", p.indexOf("点名指挥") >= 0);
  t("不替玩家说话", p.indexOf("绝不替玩家说话") >= 0);
}

// ---- 小队增删 ----
{
  const {T2, store} = mkCtx(false);
  t("初始空", T2.getCompanions("t1").length === 0);
  let r = T2.addCompanion("t1", {name: "林黛玉", runId: "r1", cardId: "c1"});
  t("加1", r.ok === true && r.list.length === 1 && r.list[0].name === "林黛玉");
  t("字段存runId/cardId", r.list[0].runId === "r1" && r.list[0].cardId === "c1");
  t("持久化", !!store["nd_travparty_t1"]);
  t("get读回", T2.getCompanions("t1").length === 1);
  const rd = T2.addCompanion("t1", {name: "林黛玉"});
  t("重复加幂等", rd.ok === true && rd.dup === true && rd.list.length === 1);
  T2.addCompanion("t1", {name: "薛宝钗"});
  T2.addCompanion("t1", {name: "王熙凤"});
  const rFull = T2.addCompanion("t1", {name: "贾宝玉"});
  t("上限3拒绝第4人", rFull.ok === false && rFull.list.length === 3);
  t("拒绝后仍3人", T2.getCompanions("t1").length === 3);
  const after = T2.removeCompanion("t1", "薛宝钗");
  t("删除", after.length === 2 && after.every(c => c.name !== "薛宝钗"));
  t("删除持久化", T2.getCompanions("t1").length === 2);
  t("删不存在不崩", T2.removeCompanion("t1", "不存在").length === 2);
  // 不同 travId 隔离
  T2.addCompanion("t2", {name: "贾宝玉"});
  t("travId隔离", T2.getCompanions("t2").length === 1 && T2.getCompanions("t1").length === 2);
}

console.log(`traverse_p3: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
