const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// ST 世界书导出回归测试: RP_LOREBOOK.exportST (importST 的逆操作)
// 真实 fixture: tests/fixtures/lorebook-jiangxueying.json
// (迟归人 v1.2.0 PNG 内嵌 character_book 44 条中抽 4 条, 变体字段)
// 往返: 真实世界书 -> importST -> exportST -> importST, 条目一致
function mkCtx(){
const store = {};
const localStorage = {
getItem: (k)=> (k in store ? store[k] : null),
setItem: (k, v)=>{ store[k] = String(v); },
removeItem: (k)=>{ delete store[k]; },
};
const ctx = {console, localStorage};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/lorebook.js", "utf8"), ctx, {filename: "lorebook.js"});
return ctx;
}
const ctx = mkCtx();
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const run = (code)=> vm.runInContext(code, ctx);

const raw = JSON.parse(fs.readFileSync("tests/fixtures/lorebook-jiangxueying.json", "utf8"));
ctx.__raw = raw;
const a = run(`RP_LOREBOOK.importST(__raw)`);
t("真实世界书导入成功", a && a.length === 4);

// ---- 导出形状: ST 经典 schema ----
ctx.__a = a;
const out = run(`RP_LOREBOOK.exportST(__a)`);
t("导出 entries 为字典", out && out.entries && typeof out.entries === "object"
  && !Array.isArray(out.entries));
t("导出条目数一致", Object.keys(out.entries).length === 4);
const e0 = out.entries[Object.keys(out.entries)[0]];
const need = ["uid","key","keysecondary","comment","content","constant","selective",
  "selectiveLogic","order","position","disable","probability","useProbability",
  "depth","group","groupOverride","groupWeight","caseSensitive","matchWholeWords","extensions"];
t("导出条目含 ST 经典字段", need.every(k=> k in e0));
t("key 为数组", Array.isArray(e0.key));

// ---- 往返: 导出 -> 再导入, 与第一次导入一致(id 除外, 导入时重生成) ----
ctx.__out = out;
const b = run(`RP_LOREBOOK.importST(__out)`);
t("导出可被 importST 读回", b && b.length === 4);
const strip = (o)=>{ const c = Object.assign({}, o); delete c.id; return c; };
t("往返条目一致",
  JSON.stringify(a.map(strip)) === JSON.stringify(b.map(strip)));

// ---- placement 逆映射 ----
const pos = run(`(function(){
  const L = RP_LOREBOOK;
  const mk = (placement, placementPosition)=> L.exportST([{content:"x", placement, placementPosition}]);
  const one = (d)=> d.entries[Object.keys(d.entries)[0]];
  return [
    one(mk("personality","before")).position,
    one(mk("personality","after")).position,
    one(mk("default","before")).position,
    one(mk("default","after")).position,
    one(mk("scenario","after")).position,
    one(mk("scenario","after")).placement
  ];
})()`);
t("personality/before -> before_char", pos[0] === "before_char");
t("personality/after -> after_char", pos[1] === "after_char");
t("default/before -> before_an", pos[2] === "before_an");
t("default/after -> after_an", pos[3] === "after_an");
t("scenario 标记为 after_scenario 且 placement 原样保留",
  pos[4] === "after_scenario" && pos[5] === "scenario");
// scenario 条目往返不丢 placement
const sc = run(`(function(){
  const L = RP_LOREBOOK;
  const back = L.importST(L.exportST([{content:"x", placement:"scenario", placementPosition:"after"}]));
  return back[0].placement;
})()`);
t("scenario 条目往返 placement 不丢", sc === "scenario");

// ---- 边界 ----
const empty = run(`RP_LOREBOOK.exportST(null)`);
t("空输入不抛错", empty && typeof empty.entries === "object"
  && Object.keys(empty.entries).length === 0);

// ---- 静态: UI 入口 ----
const asrc = fs.readFileSync(WWW+"/app.js", "utf8");
t("导出 ST 世界书 button", asrc.indexOf("exportStLore(") >= 0);
t("window.exportStLore", asrc.indexOf("window.exportStLore") >= 0);

console.log(`\nstlorebook_export: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
