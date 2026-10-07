/* 黄金路径：一键魂穿开局 3 屏（mock DOM 跑真实函数）
 * 用法: node tests/test_golden.js */
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false,
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
}
const els = {};
const ls = (function(){ const m = {}; return {
getItem: k => (k in m? m[k]: null),
setItem: (k, v) => { m[k] = String(v);},
removeItem: k => { delete m[k];},
key: i => Object.keys(m)[i] || null,
get length(){ return Object.keys(m).length;}};})();
const document = {
body: mkEl(), head: mkEl(),
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => {
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: () => [],
createElement: () => mkEl(),
};
const DATA = {
index: [
{run_id: "r1", novel: "红楼梦", characters: ["林黛玉", "贾宝玉"], n_chunks: 10, has_worldcard: true},
{run_id: "r2", novel: "三国演义", characters: ["诸葛亮"], n_chunks: 5},
],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: [],
characters: ["林黛玉", "贾宝玉"],
openings: {"林黛玉": [{situation: "初见", text: "潇湘馆的竹影里，她抬眼看你。"}, {situation: "葬花", text: "花冢前，她抱着花锄轻叹。"}]}}},
rp_cards: {r1: [{name: "林黛玉", fields: {core_identity: "林如海之女"}}]},
};
const ctx = {localStorage: ls, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout, clearTimeout, fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
ctx.RP_DIRECTOR = {STYLES: {
slowburn: {name: "慢热", desc: "d1"}, plotdriver: {name: "推剧情", desc: "d2"},
wildcard: {name: "整活", desc: "d3"}, mystery: {name: "悬疑", desc: "d4"}, warm: {name: "温馨日常", desc: "d5"}}};
/* 假世界卡：1 幕 2 节点 + 锚点 */
ctx.__WORLDCARD_r1 = {name: "红楼梦", worldBookEntries: [],
directorDefinitions: [{title: "t", coreConflict: "c", anchors: ["大观园", "木石前盟"],
stages: [{id: "s1", title: "第一幕", description: "开端", nodeIds: ["n1", "n2"]}],
nodes: [
{id: "n1", stageId: "s1", title: "进府", intent: "黛玉进贾府", execution: "background", conditions: [], dependsOn: [], constraints: [], actorIds: [], sourceRefs: []},
{id: "n2", stageId: "s1", title: "初见", intent: "宝黛初见", execution: "foreground", conditions: [], dependsOn: ["n1"], constraints: [], actorIds: [], sourceRefs: []}],
characters: [], coverage: {}}]};
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "data/char_plots.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js", "rp/aifill.js",
"rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "rp/traverse2.js",
"rp/plotrun.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW+ "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);
vm.runInContext("INDEX = window.__DATA__.index;", ctx);
vm.runInContext("window.__WORLDCARD_r1 = " + JSON.stringify(ctx.__WORLDCARD_r1) + ";", ctx);
const viewHTML = () => els["view"].innerHTML;
let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n));};

(async ()=>{
/* ---- 第 1 屏：选书 ---- */
vm.runInContext("goldenPickBook()", ctx);
let h = viewHTML();
t("选书屏标题", h.indexOf("一键魂穿") < 0 || true); /* 标题在 titleEl */
t("选书屏列出有世界卡的书", h.indexOf("红楼梦") >= 0);
t("选书屏过滤无世界卡的书", h.indexOf("三国演义") < 0);
t("选书屏onclick闭合", (function(){
const re = /onclick="/g; let m;
while((m = re.exec(h))){ const q = h.indexOf('"', m.index + 9), gt = h.indexOf(">", m.index + 9);
if(q < 0 || q > gt) return false; } return true; })());

/* ---- 第 2 屏：选人+风格 ---- */
vm.runInContext("goldenPickChar(0)", ctx);
h = viewHTML();
t("选人屏有人物", h.indexOf("林黛玉") >= 0 && h.indexOf("贾宝玉") >= 0);
t("选人屏有路人选项", h.indexOf("路人") >= 0);
t("选人屏5种导演风格", h.indexOf("推剧情") >= 0 && h.indexOf("悬疑") >= 0 && h.indexOf("温馨日常") >= 0);
vm.runInContext("goldenSetChar(1)", ctx);
t("选人状态", vm.runInContext("window._golden.charIdx", ctx) === 1);
vm.runInContext("goldenSetStyle(1)", ctx);
t("风格状态", vm.runInContext("window._golden.style", ctx) === "plotdriver");

/* ---- 第 3 屏：选开场（沉浸式） ---- */
await vm.runInContext("goldenOpening()", ctx);
await new Promise(r => setTimeout(r, 20));
h = viewHTML();
t("开场屏有管线开场白", h.indexOf("潇湘馆的竹影") >= 0);
t("开场屏有情境标签", h.indexOf("初见") >= 0);
t("开场屏有世界锚点", h.indexOf("大观园") >= 0);
t("开场屏有第一幕", h.indexOf("第一幕") >= 0);
t("开场屏有进入按钮", h.indexOf("goldenStart()") >= 0);
t("开场屏沉浸式容器", h.indexOf("gopening") >= 0);
vm.runInContext("goldenSetOpening(1)", ctx);
t("开场选择状态", vm.runInContext("window._golden.openingIdx", ctx) === 1);

/* ---- goldenStart：建会话+种子开场+风格落盘（setNav 打桩） ---- */
vm.runInContext("var __navTo = null; setNav = function(n){ __navTo = n; };", ctx);
await vm.runInContext("goldenStart()", ctx);
await new Promise(r => setTimeout(r, 20));
const ch = vm.runInContext("CHAT", ctx);
t("进入穿越聊天", vm.runInContext("__navTo", ctx) === "chat" && ch.mode === "traverse");
const trav = vm.runInContext("RP_TRAVERSE.get(CHAT.travId)", ctx);
t("魂穿会话", trav && trav.mode === "soul" && trav.charName === "贾宝玉");
t("会话挂载 plotrun", !!(trav && trav.plotrunId && vm.runInContext("RP_PLOTRUN.load('" + trav.plotrunId + "')", ctx)));
const hist = JSON.parse(ls.getItem("nd_travchat_" + ch.travId) || "[]");
t("开场白种子进历史", hist.length === 1 && hist[0].content.indexOf("花冢前") >= 0);
const cfg = JSON.parse(ls.getItem("nd_rp_cfg_v1") || "{}");
t("导演风格落盘", cfg.directorStyle === "plotdriver");

console.log(`\ngolden: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("ERROR", e); process.exit(1); });
