const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 回归: 穿越各页模板渲染 (用 mock DOM 跑真实函数), 重点防属性引号错乱
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
body: mkEl(),
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
index: [{run_id: "r1", novel: "红楼梦", characters: ["林黛玉", "贾宝玉"], n_chunks: 10}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "林黛玉", fields: {core_identity: "林如海之女", core_traits: "敏感多思"}}]},
};
const ctx = {localStorage: ls, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){}, fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
ctx.CHAR_PLOTS = {"林黛玉": "\n· 黛玉进贾府：初见宝玉\n· 葬花吟：与宝钗夜话"};
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "data/char_plots.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW+"/" + f, "utf8"), ctx, {filename: f});
}
// data.js 会覆盖 __DATA__; 加载完再注入测试数据
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);
const viewHTML = () => els["view"].innerHTML;

let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n));};

// 所有 onclick="..." 属性必须在下一个 > 之前闭合
function onclickWellFormed(html){
const re = /onclick="/g;
let m;
while((m = re.exec(html))){
const q = html.indexOf('"', m.index + 9);
const gt = html.indexOf(">", m.index + 9);
if(q < 0 || q > gt) return false;
}
return true;
}
function noBrokenClass(html){
return html.indexOf('class=" ') < 0 && html.indexOf('""') < 0;
}

// ---- 穿越首页 ----
vm.runInContext("setNav('traverse')", ctx);
let h = viewHTML();
t("首页有魂穿卡", h.indexOf("魂穿") >= 0);
t("首页有肉身卡", h.indexOf("肉身穿越") >= 0);
t("首页P2/P3锁定", h.indexOf("P2") >= 0 && h.indexOf("P3") >= 0);
t("首页onclick闭合", onclickWellFormed(h));
t("首页无破碎class", noBrokenClass(h));
t("首页模式卡片4个", (h.match(/travmode(\s|")/g) || []).length === 4);
t("首页导入按钮", h.indexOf("导入角色卡") >= 0);

// ---- 魂穿锚点页 ----
vm.runInContext("soulAnchors('r1','林黛玉')", ctx);
h = viewHTML();
t("锚点页标题", h.indexOf("林黛玉") >= 0);
t("锚点有从头开始", h.indexOf("从头开始") >= 0);
t("锚点有黛玉进府", h.indexOf("黛玉进府") >= 0);
t("锚点有OOC开关", h.indexOf("oocRemind") >= 0);
t("锚点页onclick闭合", onclickWellFormed(h));

// ---- 肉身身份页 ----
vm.runInContext("bodyIdentity('book','r1')", ctx);
h = viewHTML();
t("身份页有AI生成", h.indexOf("AI 生成") >= 0);
t("身份页有现代人直穿", h.indexOf("现代人直穿") >= 0);
["idName","idGender","idAge","idOrigin","idTraits","idTalent","idSituation"].forEach(id=>{
t("身份字段 " + id, h.indexOf('id="' + id + '"') >= 0);
});
t("身份页onclick闭合", onclickWellFormed(h));

// ---- 世界状态编辑器 ----
vm.runInContext(`
var _s = RP_TRAVERSE.newSession({mode:"soul", worldKind:"book", worldId:"r1",
worldName:"《红楼梦》", charName:"林黛玉", anchorTitle:"黛玉进贾府", oocRemind:true});
RP_TRAVERSE.saveState(_s.id, {date:"某日", loc:"潇湘馆", favor:{"贾宝玉":5},
items:["帕子"], progress:"初入", flags:{}});
CHAT = {mode:"traverse", travId:_s.id};
travWsEditor();
`, ctx);
h = viewHTML();
t("状态页有日期地点进度", h.indexOf('id="wsDate"') >= 0 && h.indexOf('id="wsLoc"') >= 0 && h.indexOf('id="wsProg"') >= 0);
t("状态页显示物品", h.indexOf("帕子") >= 0);
t("状态页显示好感", h.indexOf("贾宝玉") >= 0 && h.indexOf("好感 5") >= 0);
t("状态页onclick闭合", onclickWellFormed(h));

// ---- 身份查看页 ----
vm.runInContext("travIdentityView()", ctx);
h = viewHTML();
t("身份查看页渲染", h.indexOf("林黛玉") >= 0);

// ---- 交互: 魂穿开始 (读锚点单选 + OOC 开关, 覆盖 $("id") 漏 # 回归) ----
(async ()=>{
const p = vm.runInContext("soulStart('r1','林黛玉')", ctx);
await p;
const rec = vm.runInContext("RP_TRAVERSE.recent()[0]", ctx);
t("soulStart建会话", rec && rec.charName === "林黛玉" && rec.mode === "soul");
t("soulStart锚点", rec && /冷子兴|故事开端|从头开始/.test(rec.anchorTitle||""));
t("soulStart切聊天", vm.runInContext("CHAT.mode", ctx) === "traverse");

// ---- 交互: 肉身开始 (读身份表单字段) ----
vm.runInContext(`
  bodyIdentity('book','r1');
  document.querySelector("#idName").value = "沈默";
  document.querySelector("#idGender").value = "男";
  document.querySelector("#idAge").value = "二十";
  document.querySelector("#idOrigin").value = "江南";
  document.querySelector("#idTraits").value = "内敛";
  document.querySelector("#idTalent").value = "过目不忘";
  document.querySelector("#idSituation").value = "投亲";
  bodyStart("book","r1");
`, ctx);
const rec2 = vm.runInContext("RP_TRAVERSE.recent()[0]", ctx);
t("bodyStart建会话", rec2 && rec2.mode === "body");
const idt = vm.runInContext("RP_TRAVERSE.getIdentity(RP_TRAVERSE.recent()[0].identityId)", ctx);
t("bodyStart身份名", idt && idt.name === "沈默");
t("bodyStart身份特质", idt && idt.traits === "内敛" && idt.talent === "过目不忘");

// ---- 世界状态栏渲染 ----
vm.runInContext("renderWsBar()", ctx);
t("wsbar渲染", /潇湘馆|查看/.test(els["wsbar"].innerHTML));

// ---- 回归: 顶栏隐藏必须收起布局占位, 不能只 translate 留黑条 ----
(function(){
const toggles = [];
const head = mkEl();
head.offsetHeight = 65;
head.classList = {add(){}, remove(){},
toggle(c, on){ toggles.push([c, !!on]); }, contains(){ return false; }};
const log = mkEl(); log.scrollTop = 0; log.scrollHeight = 3000;
els["chathead"] = head; els["chatlog"] = log;
vm.runInContext("attachHeadHide()", ctx);
log.scrollTop = 500; log.onscroll();           // 下滑过 140 -> 隐藏
t("headhide: 加上hide类", toggles.some(x=>x[0]==="hide"&&x[1]));
t("headhide: 收起占位marginTop=-65px", head.style.marginTop === "-65px");
log.scrollTop = 100; log.onscroll();           // 回滚 -> 显示
t("headhide: 去掉hide类", toggles.some(x=>x[0]==="hide"&&!x[1]));
t("headhide: 恢复marginTop", head.style.marginTop === "");
})();

console.log(`traverse ui: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
})();
