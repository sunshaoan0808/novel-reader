const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 借鉴清单第 1/3/4 项回归测试: Janitor 世界书 schema / 记忆结构化字段 / Facts 独立产品面
// 纯 JS + 向后兼容; 不用全角方括号标记 (写入管线会剥离, 用纯文本断言)

const ctx1 = {console}; vm.createContext(ctx1);
vm.runInContext(fs.readFileSync(WWW + "/rp/lorebook.js", "utf8"), ctx1);
const RP_LOREBOOK = vm.runInContext("RP_LOREBOOK", ctx1);

const ctx2 = {console}; vm.createContext(ctx2);
vm.runInContext(fs.readFileSync(WWW + "/rp/lorebook.js", "utf8"), ctx2);
vm.runInContext(fs.readFileSync(WWW + "/rp/prompt.js", "utf8"), ctx2);
const RP_PROMPT = vm.runInContext("RP_PROMPT", ctx2);

const store = {};
const localStorage = {
  getItem: (k)=> (k in store ? store[k] : null),
  setItem: (k, v)=>{ store[k] = String(v); },
  removeItem: (k)=>{ delete store[k]; },
};
let rpcfg = {leanmem: true};
const ctx3 = {console, localStorage, getRpCfg: ()=>Object.assign({}, rpcfg)};
vm.createContext(ctx3);
vm.runInContext(fs.readFileSync(WWW + "/rp/memory.js", "utf8"), ctx3);
const RP_MEM = vm.runInContext("RP_MEM", ctx3);

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

/* ================= 第 1 项: Janitor 世界书 schema ================= */
/* --- schema 默认值 --- */
const d0 = RP_LOREBOOK.normalize({}, 4);
t("schema 默认 probability=100", d0.probability === 100);
t("schema 默认 matchWholeWords=true", d0.matchWholeWords === true);
t("schema 默认 selectiveLogic=0(AND_ANY)", d0.selectiveLogic === 0);
t("schema 默认 minMessages=0", d0.minMessages === 0);
t("schema 默认 constant=false", d0.constant === false);
t("schema 默认 inclusionGroup=[]", Array.isArray(d0.inclusionGroup) && d0.inclusionGroup.length === 0);
t("schema 默认 groupWeight=100", d0.groupWeight === 100);
t("schema 默认 placement=default", d0.placement === "default");
t("schema priority 由位置派生(index+1)", d0.priority === 5);
t("schema 默认 case_sensitive=false", d0.case_sensitive === false);
t("schema 无 token budget 字段", d0.tokenBudget === undefined && d0.budget === undefined);
/* --- 向后兼容老条目 --- */
const leg = RP_LOREBOOK.normalize({title: "旧标题", trigger_keywords: ["a", "b"], rules: "旧正文", priority: 60}, 0);
t("老条目 title->name", leg.name === "旧标题");
t("老条目 trigger_keywords->key", leg.key.join(",") === "a,b");
t("老条目 rules->content", leg.content === "旧正文");
t("老条目缺字段给默认值", leg.probability === 100 && leg.selectiveLogic === 0 && leg.minMessages === 0);
const legOrder = RP_LOREBOOK.normalizeAll([
  {title: "低", trigger_keywords: ["x"], content: "c", priority: 40},
  {title: "高", trigger_keywords: ["x"], content: "c", priority: 80},
]);
t("老式 priority 越大越先迁移", legOrder[0].name === "高" && legOrder[1].name === "低");
t("迁移后 priority 重算为位置", legOrder[0].priority === 1 && legOrder[1].priority === 2);
const newOrder = RP_LOREBOOK.normalizeAll([
  {name: "甲", key: ["x"], content: "c"}, {name: "乙", key: ["x"], content: "c"},
]);
t("新式表保持原序", newOrder[0].name === "甲" && newOrder[1].name === "乙");
/* --- 互斥组只注一条 --- */
const grpEntries = [
  {name: "战甲", key: ["战斗"], content: "甲", inclusionGroup: ["combat"]},
  {name: "战乙", key: ["战斗"], content: "乙", inclusionGroup: ["combat"]},
];
const grpHit = RP_LOREBOOK.match(grpEntries, "开始战斗了", 10);
t("互斥组只激活一条", grpHit.length === 1);
const grpPrio = [
  {name: "先", key: ["打"], content: "a", inclusionGroup: ["g"], prioritizeInclusion: true},
  {name: "后", key: ["打"], content: "b", inclusionGroup: ["g"], prioritizeInclusion: true},
];
const grpPrioHit = RP_LOREBOOK.match(grpPrio, "打起来了", 10);
t("prioritizeInclusion 按 priority 取首", grpPrioHit.length === 1 && grpPrioHit[0].name === "先");
const noGrp = RP_LOREBOOK.match([
  {name: "甲", key: ["x"], content: "a", inclusionGroup: ["g"]},
  {name: "乙", key: ["y"], content: "b", inclusionGroup: ["h"]},
], "x y", 10);
t("不同组互不干扰", noGrp.length === 2);
/* --- probability 掷骰边界 --- */
const p0 = RP_LOREBOOK.match([{name: "零", key: ["k"], content: "c", probability: 0}], "k", 10);
t("probability=0 永不命中", p0.length === 0);
const p100 = RP_LOREBOOK.match([{name: "全", key: ["k"], content: "c", probability: 100}], "k", 10);
t("probability=100 恒命中", p100.length === 1);
const pClamp = RP_LOREBOOK.normalize({probability: 150}, 0);
t("probability 钳制到 100", pClamp.probability === 100);
/* --- 次级关键词四值逻辑 --- */
const mk4 = (logic, sec)=>[{name: "t", key: ["a"], keysecondary: sec, selectiveLogic: logic, content: "c"}];
t("AND_ANY(0): 主+次命中", RP_LOREBOOK.match(mk4(0, ["b"]), "a b", 10).length === 1);
t("AND_ANY(0): 只有主不命中", RP_LOREBOOK.match(mk4(0, ["b"]), "a", 10).length === 0);
t("AND_ALL(3): 次级全命中才纳入", RP_LOREBOOK.match(mk4(3, ["b", "c"]), "a b", 10).length === 0);
t("AND_ALL(3): 全命中通过", RP_LOREBOOK.match(mk4(3, ["b", "c"]), "a b c", 10).length === 1);
t("NOT_ANY(2): 任一次级命中即排除", RP_LOREBOOK.match(mk4(2, ["b"]), "a b", 10).length === 0);
t("NOT_ANY(2): 无次级命中通过", RP_LOREBOOK.match(mk4(2, ["b"]), "a", 10).length === 1);
t("NOT_ALL(1): 次级全命中才排除", RP_LOREBOOK.match(mk4(1, ["b", "c"]), "a b c", 10).length === 0);
t("NOT_ALL(1): 部分命中不排除", RP_LOREBOOK.match(mk4(1, ["b", "c"]), "a b", 10).length === 1);
/* --- RegEx / 大小写 / 整词 --- */
t("RegEx 关键词 /.../ 命中", RP_LOREBOOK.match([{name: "r", key: ["/大.*?园/"], content: "c"}], "去了大花园", 10).length === 1);
t("非法正则不崩溃", RP_LOREBOOK.match([{name: "r", key: ["/(/"], content: "c"}], "无关文本", 10).length === 0);
t("默认不区分大小写", RP_LOREBOOK.match([{name: "c", key: ["ABC"], content: "c"}], "abc", 10).length === 1);
t("case_sensitive=true 区分", RP_LOREBOOK.match([{name: "c", key: ["ABC"], content: "c", case_sensitive: true}], "abc", 10).length === 0);
t("matchWholeWords: king 不匹配 liking", RP_LOREBOOK.match([{name: "w", key: ["king"], content: "c"}], "liking", 10).length === 0);
t("matchWholeWords: 整词命中", RP_LOREBOOK.match([{name: "w", key: ["king"], content: "c"}], "the king came", 10).length === 1);
t("CJK 无词边界按子串命中", RP_LOREBOOK.match([{name: "z", key: ["大观园"], content: "c"}], "去了大观园散步", 10).length === 1);
/* --- minMessages --- */
t("minMessages 未达不激活", RP_LOREBOOK.match([{name: "m", key: ["k"], content: "c", minMessages: 3}], "k", 2).length === 0);
t("minMessages 达即激活", RP_LOREBOOK.match([{name: "m", key: ["k"], content: "c", minMessages: 3}], "k", 5).length === 1);
t("constant 跳过 minMessages", RP_LOREBOOK.match([{name: "m", key: [], content: "c", constant: true, minMessages: 99}], "无关", 1).length === 1);
/* --- priority 排序 --- */
const priHit = RP_LOREBOOK.match([
  {name: "后", key: ["x"], content: "b"}, {name: "前", key: ["x"], content: "a"},
], "x", 10);
t("priority 小的在前", priHit[0].name === "后" && priHit[0].priority === 1);
/* --- ST 导入映射 --- */
const stData = {entries: {
  "1": {name: "条目一", content: "正文", key: "a,b", comment: "备注", caseSensitive: true,
        match_whole_word: false, group: "g1,g2", secondary_keys: "s1,s2"},
  "2": {title: "别名标题", entry: "别名正文", keywords: "c", notes: "n2",
        case_sensitive: false, matchWholeWords: true, inclusionGroup: ["g3"], keysecondary: ["s3"]},
}};
const stOut = RP_LOREBOOK.importST(stData);
t("ST 导入条数", stOut && stOut.length === 2);
t("ST key 字符串按逗号切分", stOut[0].key.join(",") === "a,b");
t("ST comment/notes 别名", stOut[0].comment === "备注" && stOut[1].comment === "n2");
t("ST name/title 别名", stOut[1].name === "别名标题");
t("ST content/entry 别名", stOut[1].content === "别名正文");
t("ST key/keywords 别名", stOut[1].key.join(",") === "c");
t("ST caseSensitive 别名", stOut[0].case_sensitive === true);
t("ST match_whole_word 别名", stOut[0].matchWholeWords === false);
t("ST group->inclusionGroup", stOut[0].inclusionGroup.join(",") === "g1,g2");
t("ST secondary_keys 别名", stOut[0].keysecondary.join(",") === "s1,s2");
t("ST 非法输入返回 null", RP_LOREBOOK.importST({foo: 1}) === null && RP_LOREBOOK.importST(null) === null);
/* --- build 组装 --- */
const bEntries = [];
for(let i = 0; i < 30; i++) bEntries.push({name: "条" + i, key: ["k"], content: "内容" + i});
const bb = RP_LOREBOOK.build(bEntries, "k", 100000, 10);
t("build 上限 8 条", bb.hits.length === 8);
t("build hits 含 probability/priority", bb.hits[0].probability === 100 && bb.hits[0].priority === 1 && typeof bb.hits[0].title === "string");
t("build 预算 0 无注入", RP_LOREBOOK.build(bEntries, "k", 0, 10).hits.length === 0);
const pl = RP_LOREBOOK.build([
  {name: "默认条", key: ["k"], content: "d"},
  {name: "人设条", key: ["k"], content: "p", placement: "personality"},
], "k", 100000, 10);
t("placement 默认进 text", pl.text.includes("默认条") && !pl.text.includes("人设条"));
t("placement personality 进 placed.core", (pl.placed.core || "").includes("人设条"));
/* --- RP_PROMPT 委托 (向后兼容) --- */
const pw = [
  {title: "大观园", trigger_keywords: ["大观园", "潇湘馆"], content: "贾府的园子", priority: 60, enabled: true},
  {name: "新条", key: ["大观园"], content: "新内容", probability: 100},
];
const ph = RP_PROMPT.matchLore(pw, "昨天去了大观园散步", 10);
t("RP_PROMPT.matchLore 委托新逻辑", ph.length === 2 && ph[0].probability === 100);
const pb = RP_PROMPT.buildLore(pw, "昨天去了大观园散步", 900, 10);
t("buildLore hits 保持标题字符串(老契约)", Array.isArray(pb.hits) && typeof pb.hits[0] === "string");
t("buildLore hitDetails 带 probability/priority", pb.hitDetails && pb.hitDetails[0].probability === 100 && pb.hitDetails[0].priority === 1);
const card = {name: "林黛玉", fields: {}};
const bm = RP_PROMPT.buildMessages(card, {novel: "红楼梦", worldbook: pw, relations: [], memory: "",
  history: [{role: "user", content: "我们去大观园走走"}]}, {maxContext: 8192, response: 512});
t("buildMessages stats.loreHitDetails", Array.isArray(bm.stats.loreHitDetails) && bm.stats.loreHitDetails.length > 0);
const plm = RP_PROMPT.buildMessages(card, {novel: "红楼梦",
  worldbook: [{name: "锚", key: ["x"], content: "锚内容", placement: "personality"}], relations: [], memory: "",
  history: [{role: "user", content: "x"}]}, {maxContext: 8192, response: 512});
t("placement 条目拼入人设段", plm.preview.includes("锚内容"));

/* ================= 第 3 项: 记忆数据模型丰富化 ================= */
const p3prompt = RP_MEM.buildAnalysisPrompt3("黛玉", "", {}, "新对话");
t("prompt 要求抽取结构化字段", p3prompt.includes("emotionalTone") && p3prompt.includes("relationshipImpact") && p3prompt.includes("participants"));
t("prompt 缺失留空不编造", p3prompt.includes("不要编造"));
t("prompt 含 relationship 段", p3prompt.includes("communicationPreferences") && p3prompt.includes("currentLocation"));
const evJSON = JSON.stringify({drop: false,
  event: [{topic: "中秋夜宴", t_anchor: "今晚", state: "尽欢而散", location: "大观园", participants: "宝玉、黛玉",
    agreements: "明日再聚", type: "聚会", status: "已结束", emotionalTone: "欢快", attitudeToUser: "亲近", relationshipImpact: "升温"}],
  profile: [], facts: [], record: []});
const evSt = RP_MEM.parseState3(evJSON, {});
const ev0 = evSt.event3[0];
t("event3 结构化字段落盘", ev0.location === "大观园" && ev0.participants === "宝玉、黛玉" && ev0.agreements === "明日再聚"
  && ev0.type === "聚会" && ev0.status === "已结束" && ev0.emotionalTone === "欢快"
  && ev0.attitudeToUser === "亲近" && ev0.relationshipImpact === "升温");
/* 演化合并: 新值填空位, 不覆盖已有 */
const evSt2 = RP_MEM.parseState3(JSON.stringify({drop: false,
  event: [{topic: "中秋夜宴续", t_anchor: "今晚", state: "又添新话", location: "潇湘馆"}], profile: [], facts: [], record: []}), evSt);
const evM = evSt2.event3.find(e=>e.topic === "中秋夜宴");
t("合并只填空位", evM && evM.location === "大观园" && evM.merged === 2);
/* 老数据缺字段容错 */
const oldEv = {migrated3: true, profile3: [], record3: [],
  event3: [{id: 1, topic: "旧事", t_anchor: "昨天", state: "旧态"}]};
const oldEvOut = RP_MEM.parseState3(JSON.stringify({drop: false, event: [], profile: [], facts: [], record: []}), oldEv);
t("老 event3 缺字段读取容错", oldEvOut.event3[0].location === undefined && oldEvOut.event3[0].topic === "旧事");
/* relationship 段 */
const relJSON = JSON.stringify({drop: false, profile: [
  {text: "与宝玉渐近", relationship: {stage: "暧昧", boundaries: "发乎情", type: "爱情", communicationPreferences: "含蓄", currentLocation: "大观园"}},
  "喜欢吃甜食"], event: [], facts: [], record: []});
const relSt = RP_MEM.parseState3(relJSON, {});
t("profile3 relationship 段落盘", relSt.profile3[0].relationship && relSt.profile3[0].relationship.stage === "暧昧"
  && relSt.profile3[0].relationship.currentLocation === "大观园");
t("字符串 profile 条目仍兼容", relSt.profile3[1].text === "喜欢吃甜食" && relSt.profile3[1].relationship === undefined);
/* maybeAnalyze 水位不丢 */
(async ()=>{
  const hist = [];
  for(let i = 0; i < 12; i++) hist.push({mid: "m" + i, role: i % 2 ? "assistant" : "user", content: "消息" + i});
  RP_MEM.save("w1", "甲", {mood: null, short: [], long: "", up_to: 0});
  const fakeJSON = JSON.stringify({drop: false, mood: {state: "平静", filter: ""}, profile: ["新事实"],
    facts: [{text: "爱穿白衣", cat: "外貌"}], event: [{topic: "散步", t_anchor: "今晨", state: "愉快", location: "园中"}],
    record: ["gist 一句"]});
  const r = await RP_MEM.maybeAnalyze("w1", "甲", hist, {}, async ()=>fakeJSON, "");
  const wst = RP_MEM.get("w1", "甲");
  t("maybeAnalyze 水位推进到最后消息", r.analyzed === true && wst.up_to_msg_id === "m11" && wst.up_to === 12);
  t("maybeAnalyze 写入 facts 自动区", (wst.profile3 || []).some(p=>p.fact && p.auto && p.text === "爱穿白衣"));
  t("maybeAnalyze 写入 event 结构化字段", (wst.event3 || []).some(e=>e.location === "园中"));

/* ================= 第 4 项: Facts 独立产品面 ================= */
  t("FACT_CATS 五分类", JSON.stringify(RP_MEM.FACT_CATS) === JSON.stringify(["外貌", "怪癖", "关系", "偏好", "其他"]));
  t("FACTS_MAX_CHARS=2000", RP_MEM.FACTS_MAX_CHARS === 2000);
  const fst = RP_MEM.parseState3(JSON.stringify({drop: false, profile: [], facts: [
    {text: "左眉有痣", cat: "外貌"}, {text: "爱收集石头", cat: "怪癖"}, {text: "乱分类", cat: "不存在"}], event: [], record: []}), {});
  const fa = fst.profile3.filter(p=>p.fact);
  t("自动 facts 落盘带分类", fa.length === 3 && fa[0].auto === true && fa[0].cat === "外貌");
  t("非法分类归为其他", fa[2].cat === "其他");
  const fst2 = RP_MEM.parseState3(JSON.stringify({drop: false, profile: [], facts: [
    {text: "左眉有痣", cat: "外貌"}], event: [], record: []}), fst);
  t("自动 facts 去重", fst2.profile3.filter(p=>p.fact).length === 3);
  /* 手动区 */
  RP_MEM.save("f1", "乙", {mood: null, short: [], long: "", up_to: 0});
  const ar = RP_MEM.addFact("f1", "乙", {text: "手动补充的习惯", cat: "偏好"});
  t("addFact 成功", ar.ok === true);
  const gf = RP_MEM.getFacts(RP_MEM.get("f1", "乙"));
  t("自动/手动分区", gf.manual.length === 1 && gf.manual[0].cat === "偏好" && gf.auto.length === 0);
  t("addFact 空文本拒绝", RP_MEM.addFact("f1", "乙", {text: "  "}).ok === false);
  const er = RP_MEM.editFact("f1", "乙", ar.id, {text: "改后的习惯", cat: "怪癖"});
  const gf2 = RP_MEM.getFacts(RP_MEM.get("f1", "乙"));
  t("editFact 生效", er.ok === true && gf2.manual[0].text === "改后的习惯" && gf2.manual[0].cat === "怪癖");
  t("delFact 生效", RP_MEM.delFact("f1", "乙", ar.id) === true && RP_MEM.getFacts(RP_MEM.get("f1", "乙")).manual.length === 0);
  /* 上限: fact 文本上限 120 字, 2000 字总量约 16 条 */
  RP_MEM.save("f2", "丙", {mood: null, short: [], long: "", up_to: 0});
  let addOk = true;
  for(let i = 0; i < 16; i++) if(!RP_MEM.addFact("f2", "丙", {text: "x".repeat(120), cat: "其他"}).ok) addOk = false;
  t("上限内可添加", addOk === true);
  const over = RP_MEM.addFact("f2", "丙", {text: "y".repeat(120), cat: "其他"});
  t("超限返回 over", over.ok === false && over.err === "over");
  t("factsChars 统计", RP_MEM.factsChars(RP_MEM.get("f2", "丙")) === 1920);
  /* 编辑超限: 直接种子化超长旧数据, 再编辑触发 */
  RP_MEM.save("f3", "丁", {mood: null, short: [], long: "", up_to: 0, migrated3: true, profile3: [
    {id: 1, text: "x".repeat(1950), cat: "其他", fact: true, auto: false, updatedAt: Date.now()},
    {id: 2, text: "short", cat: "其他", fact: true, auto: false, updatedAt: Date.now()}]});
  const overEdit = RP_MEM.editFact("f3", "丁", 2, {text: "z".repeat(120), cat: "其他"});
  t("编辑超限也拒绝", overEdit.ok === false && overEdit.err === "over");

  console.log(`borrow_a (1/3/4): ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
