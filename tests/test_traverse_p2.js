const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 穿越 P2: 世界注册表 / 异世界会话 / 异世界 prompt
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
const T1 = vm.runInContext("RP_TRAVERSE", ctx);

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- 注册表读写 ----
const w = T2.registerWorld({key: "testw", kind: "card", title: "测试世界", status: "ready", note: "测试"});
t("registerWorld返回", w.key === "testw" && w.status === "ready");
t("getWorld", T2.getWorld("testw").title === "测试世界");
t("listWorlds含", T2.listWorlds().some(x => x.key === "testw"));
t("getWorld未知null", T2.getWorld("nope") === null);
let threw = "";
try { T2.registerWorld({}); } catch(e){ threw = e.message; }
t("缺key抛错", /需要 key/.test(threw));
t("缺省status为pending", T2.registerWorld({key: "p1"}).status === "pending");

// ---- 内置注册 ----
const hl = T2.getWorld("honglou");
t("红楼ready", hl && hl.status === "ready" && hl.title === "红楼梦" && hl.kind === "book");
const sh = T2.getWorld("shuihu");
t("水浒pending", sh && sh.status === "pending" && sh.kind === "book");
t("水浒note非空且声明不预置", !!sh.note && sh.note.indexOf("不预置任何人物剧情") >= 0);

// ---- isekaiSession ----
const s = T2.isekaiSession({srcKind: "book", srcId: "r1", srcName: "《红楼梦》",
  dstKey: "shuihu", dstKind: "book", fusion: "outsider", charName: "林黛玉"});
t("mode为isekai", s.mode === "isekai" && !!s.id);
t("字段齐", s.srcKind === "book" && s.srcId === "r1" && s.srcName === "《红楼梦》" &&
  s.dstKey === "shuihu" && s.fusion === "outsider" && s.charName === "林黛玉");
t("复用nd_trav_前缀存储", !!store["nd_trav_" + s.id]);
t("RP_TRAVERSE可读回", T1.get(s.id) && T1.get(s.id).mode === "isekai");
const s2 = T2.isekaiSession({dstKey: "honglou"});
t("fusion缺省outsider", s2.fusion === "outsider");

// ---- isekaiPrompt ----
const pOut = T2.isekaiPrompt(
  {srcName: "《红楼梦》", dstKey: "shuihu", fusion: "outsider"}, T2.getWorld("shuihu"));
const pRe = T2.isekaiPrompt(
  {srcName: "《红楼梦》", dstKey: "honglou", fusion: "reborn"}, T2.getWorld("honglou"));
t("outsider文案", pOut.indexOf("异乡人") >= 0 && pOut.indexOf("保留原来的身份") >= 0);
t("reborn文案", pRe.indexOf("转生") >= 0 && pRe.indexOf("新身份") >= 0);
t("两种融合文案不同", pOut !== pRe);
t("pending含不要编造", pOut.indexOf("不要编造") >= 0 &&
  pOut.indexOf("不要编造目标世界的具体人物剧情") >= 0);
t("ready不含不要编造", pRe.indexOf("不要编造") < 0);
t("不替玩家说话", pOut.indexOf("绝不替玩家说话") >= 0);
t("目标名渲染", pOut.indexOf("《水浒传》") >= 0);

console.log(`traverse_p2: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
