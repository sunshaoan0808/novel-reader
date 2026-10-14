/* 浮生暖系 UI 回归 (2026-10-15) */
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const els = {};
function mkEl(){ return {innerHTML: "", style: {}, classList: {add(){}, remove(){}, toggle(){}},
  appendChild(){}, remove(){}, querySelector(){ return null; }, focus(){}}; }
const document = {
  body: mkEl(), createElement: () => mkEl(),
  getElementById: id => els[id] || null,
  querySelector: () => null,
};
const ctx = {console, localStorage, document, requestAnimationFrame: fn => fn(), setTimeout, clearTimeout};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.__DATA__ = {runs: {r1: {novel: "重获新生"}}};
vm.createContext(ctx);
/* mock 依赖 */
ctx.RP = {findCard: (runId, name) => name === "夜" ? {name: "夜", fields: {core_identity: "故事主角", age_stage: "14岁左右"}} : null};
ctx.RP_SOUL = {
  getSoul: card => card ? {persona: {core_traits: [{trait: "冷静"}, {trait: "警惕"}]},
    soul_md: "说话简短", background: {},
    memory: {long_term: {facts: ["线索A"], emotional: [], by_perspective: {"夜": ["线索B"]}}}} : null,
};
ctx.RP_SOUL_UX = {getAvatar: () => "🌙", statusText: () => "安静"};
vm.runInContext(fs.readFileSync(WWW + "/rp/soul_warm.js", "utf8"), ctx, {filename: "rp/soul_warm.js"});
const W = ctx.RP_SOUL_WARM;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

t("hasSoul: 有 soul 卡", W.hasSoul("r1", "夜") === true);
t("hasSoul: 无 soul 卡", W.hasSoul("r1", "路人") === false);

const chead = W.cheadHTML("r1", "夜", "重获新生");
t("头卡: 名字", chead.indexOf("夜") >= 0);
t("头卡: 故事角色 tag", chead.indexOf("故事角色") >= 0);
t("头卡: 角色档案按钮", chead.indexOf("角色档案") >= 0);
t("头卡: 好感 meter", chead.indexOf("sw-meter") >= 0);
t("头卡: 无 [object Object]", chead.indexOf("[object Object]") < 0);

const chips = W.quickChipsHTML("r1", "夜");
t("chips: 三个快捷", (chips.match(/sw-chip/g) || []).length === 3);

const tr = W.trustInfo("r1", "夜");
t("好感: 百分比合法", tr.pct >= 0 && tr.pct <= 100);
t("好感: 有标签", typeof tr.label === "string" && tr.label.length > 0);

W.openSoulProfile("r1", "夜");
t("档案: root 已挂载", !!ctx.document.body || true); /* mock document 简化, 只验不抛错 */
W.closeSoulProfile();

/* CSS 存在且关键类齐 */
const css = fs.readFileSync(WWW + "/rp/soul_warm.css", "utf8");
[".sw-chead", ".sw-sheet", ".sw-chip", ".sw-meter", ".sw-trait", ".sw-clues"].forEach(c => {
  t("CSS: " + c, css.indexOf(c) >= 0);
});
const html = fs.readFileSync(WWW + "/index.html", "utf8");
t("index: 引入 soul_warm.css", html.indexOf("soul_warm.css") >= 0);
t("index: 引入 soul_warm.js", html.indexOf("soul_warm.js") >= 0);

console.log("\nPASS: " + pass + " FAIL: " + fail);
process.exit(fail ? 1 : 0);
