const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 穿越 P1: 身份捏造完整版 / 携带物 / 出戏值 / 世界补完
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
vm.runInContext(fs.readFileSync(WWW + "/rp/traverse2.js", "utf8"), ctx, {filename: "traverse2.js"});
const T2 = vm.runInContext("RP_TRAVERSE2", ctx);

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- IDENT_FIELDS ----
t("IDENT_FIELDS 10项", T2.IDENT_FIELDS.length === 10);
t("IDENT_FIELDS 含携带物/钩子",
  T2.IDENT_FIELDS.some(f => f.key === "items" && f.label === "携带物") &&
  T2.IDENT_FIELDS.some(f => f.key === "hooks" && f.label === "人物关系钩子"));

// ---- genIdentityFull ----
const identJson = JSON.stringify({
  name: "柳湘莲", nameCandidates: ["柳湘莲", "柳文清", "柳子玉"],
  gender: "男", age: "二十", looks: "面如冠玉",
  origin: "世家子弟，家道中落", traits: "豪爽仗义", talent: "剑术高超",
  items: ["长剑", "酒葫芦", "碎银"],
  situation: "刚进京城，在酒馆独饮",
  hooks: ["与贾宝玉是旧交", "受过薛蟠恩惠", "暗恋史湘云未敢表白"],
});
const mockChat = async (cfg, messages, temp) => identJson;

(async function(){
  const idt = await T2.genIdentityFull("仗剑江湖的侠客", "《红楼梦》", {}, mockChat);
  t("完整卡姓名", idt.name === "柳湘莲");
  t("3备选名", Array.isArray(idt.nameCandidates) && idt.nameCandidates.length === 3 &&
    idt.nameCandidates[2] === "柳子玉");
  t("hooks 3条", idt.hooks.length === 3 && idt.hooks[0] === "与贾宝玉是旧交");
  t("容貌/出身/特长/处境", idt.looks === "面如冠玉" && idt.origin.indexOf("家道中落") >= 0 &&
    idt.talent === "剑术高超" && idt.situation.indexOf("酒馆") >= 0);
  t("普通携带物", idt.items.join() === "长剑,酒葫芦,碎银" && idt.modern === false);

  // 现代人直穿：携带物固定三件套带耐久
  const idt2 = await T2.genIdentityFull("现代人直穿", "《红楼梦》", {}, mockChat);
  t("现代人modern标记", idt2.modern === true);
  t("现代携带物3件", idt2.items.length === 3);
  t("手机带电量耐久", idt2.items[0].name === "手机" && idt2.items[0].durability === "电量20%" &&
    idt2.items[0].uses === 3);
  t("打火机/纸巾", idt2.items[1].name === "打火机" && idt2.items[2].name === "一包纸巾");

  // 解析失败抛中文 Error
  let threw = "";
  try { await T2.genIdentityFull("x", "《红楼梦》", {}, async () => "not json"); }
  catch(e){ threw = e.message; }
  t("解析失败抛错", /不是合法 JSON/.test(threw));

  // ---- rerollField ----
  const draft = {name: "柳湘莲", gender: "男", origin: "世家子弟", traits: "豪爽仗义"};
  const draftBefore = JSON.stringify(draft);
  const rName = await T2.rerollField("name", draft, "侠客", "《红楼梦》", {},
    async () => JSON.stringify({value: ["新名一", "新名二", "新名三"]}));
  t("重随name返回3备选", Array.isArray(rName) && rName.length === 3 && rName[0] === "新名一");
  const rTraits = await T2.rerollField("traits", draft, "侠客", "《红楼梦》", {},
    async () => JSON.stringify({value: "阴郁寡言"}));
  t("重随traits返回字符串", rTraits === "阴郁寡言");
  const rHooks = await T2.rerollField("hooks", draft, "侠客", "《红楼梦》", {},
    async () => JSON.stringify({value: ["钩子一", "钩子二"]}));
  t("重随hooks返回数组", Array.isArray(rHooks) && rHooks.length === 2);
  t("draft不变", JSON.stringify(draft) === draftBefore);
  const rItemsModern = await T2.rerollField("items", {modern: true}, "现代人直穿", "《红楼梦》", {},
    async () => { throw new Error("不应调用AI"); });
  t("现代人重随携带物走模板", rItemsModern.length === 3 && rItemsModern[0].name === "手机");
  let threw2 = "";
  try { await T2.rerollField("nope", draft, "x", "《红楼梦》", {}, async () => "{}"); }
  catch(e){ threw2 = e.message; }
  t("未知字段抛错", /未知身份字段/.test(threw2));

  // ---- MODERN_ITEMS / useItem ----
  t("MODERN_ITEMS模板", T2.MODERN_ITEMS.length === 3 &&
    T2.MODERN_ITEMS[0].name === "手机" && T2.MODERN_ITEMS[0].durability === "电量20%" &&
    T2.MODERN_ITEMS[0].uses === 3 && T2.MODERN_ITEMS[1].uses === 20 &&
    T2.MODERN_ITEMS[2].name === "一包纸巾");
  const items0 = T2.cloneItems(T2.MODERN_ITEMS);
  const items1 = T2.useItem(items0, "手机");
  t("消耗一次uses-1", items1[0].uses === 2 && items0[0].uses === 3);
  t("useItem纯函数", items0[0].uses === 3 && items1 !== items0);
  const items2 = T2.useItem(T2.useItem(items1, "手机"), "手机");
  t("用尽移除", items2.length === 2 && items2.every(i => i.name !== "手机"));
  const items3 = T2.useItem(items2, "打火机");
  t("不影响其他物品", items3.length === 2 && items3[0].uses === 19);
  const items4 = T2.useItem(items3, "不存在");
  t("消耗不存在物品不变", items4.length === 2);

  // ---- detectOoc / addOoc ----
  t("OOC词表>=30", T2.OOC_WORDS.length >= 30);
  const hits = T2.detectOoc("我掏出手机给黛玉看直播，弹幕都在刷666");
  t("命中现代词", hits.indexOf("手机") >= 0 && hits.indexOf("直播") >= 0 && hits.indexOf("弹幕") >= 0);
  t("无命中返回空", T2.detectOoc("今日天气甚好，宜去潇湘馆品茶").length === 0);
  const st = {ooc: 0, flags: {}};
  const r1 = T2.addOoc(st, "我拿出手机拍照");
  t("累加15/词", r1.state.ooc === 15 && r1.hits.length === 1 && r1.triggered === false);
  t("flags.ooc同步", r1.state.flags.ooc === 15);
  const r2 = T2.addOoc(r1.state, "坐飞机点外卖刷抖音看直播");
  t("多词累加", r2.state.ooc === 15 + 4 * 15 && r2.hits.length === 4);
  const r3 = T2.addOoc({ooc: 70, flags: {}}, "打电话叫滴滴");
  t("80触发", r3.state.ooc === 100 && r3.triggered === true);
  t("上限钳制100", T2.addOoc({ooc: 95, flags: {}}, "手机电脑").state.ooc === 100);

  // ---- extractSeed / parseWorldBible / genWorldBible ----
  const card = {
    name: "浪人", scenario: "夜之城，一座不夜城",
    fields: {core_identity: "前特工"},
    raw: {description: "冷酷的前特工",
      character_book: {entries: [{name: "夜总会", content: "城中最热闹的夜总会"}]}},
  };
  const seed = T2.extractSeed(card);
  t("extractSeed含scenario", seed.indexOf("夜之城") >= 0);
  t("extractSeed含世界书", seed.indexOf("夜总会") >= 0);
  t("extractSeed空卡不崩", T2.extractSeed(null) === "" && T2.extractSeed({}).length === 0);
  const bibleJson = JSON.stringify({
    bg: "夜之城，一座不夜城，霓虹之下暗流涌动。",
    places: ["黑市：AI 补完的地下交易场", "天台酒吧：AI 补完的观景点"],
    factions: ["夜枭帮：AI 补完的帮派"],
    customs: ["午夜不开灯：AI 补完的习俗"],
    anchors: ["初入夜之城", "夜总会风波"],
  });
  const bible = T2.parseWorldBible(bibleJson, seed);
  t("bg标注原文", bible.sources.bg === "原文");
  t("places标注AI补完", bible.sources.places === "AI补完");
  t("anchors数量3-5", bible.anchors.length >= 3 && bible.anchors.length <= 5);
  const bible2 = await T2.genWorldBible(card, {}, async () => bibleJson);
  t("genWorldBible走parse", bible2.bg.indexOf("夜之城") >= 0 && bible2.sources.bg === "原文");
  let threw3 = "";
  try { T2.parseWorldBible("garbage", seed); } catch(e){ threw3 = e.message; }
  t("世界补完解析失败抛错", /不是合法 JSON/.test(threw3));

  console.log(`traverse_p1: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("FATAL", e && e.stack || e); process.exit(1); });
