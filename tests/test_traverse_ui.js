const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 回归: 穿越各页模板渲染 (用 mock DOM 跑真实函数), 重点防属性引号错乱
function mkEl(){
/* P1-12: 记录 addEventListener 绑定，测试用 __fire(type) 触发（app 已改 addEventListener，不再用 onscroll 属性） */
const _listeners = {};
const el = {innerHTML: "", textContent: "", value: "", checked: false,
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(type, fn){ (_listeners[type] = _listeners[type] || []).push(fn); },
removeEventListener(type, fn){ const a = _listeners[type]; if(a){ const i = a.indexOf(fn); if(i >= 0) a.splice(i, 1); } },
__fire(type){ const a = _listeners[type] || []; const ev = {target: el}; a.slice().forEach(fn=>{ try{ fn(ev); }catch(e){} }); },
appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
return el;
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
head: mkEl(), /* P1-12: loadEventCal 等懒加载走 document.head.appendChild，桩补上 */
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
scrollTo(){}, devicePixelRatio: 2,
/* P1-12: paintChatBg 用 new Image() 预载壁纸，沙箱补桩 */
Image: function(){ const el = mkEl(); el.src = ""; return el; }};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
/* char_plots.js 按 runId 分层, 且下面会载入真数据; 本用例的夹具在载入之后注入 */
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "data/char_plots.js", "rp/escutil.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js", "rp/aifill.js",
"rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "rp/traverse2.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW+"/" + f, "utf8"), ctx, {filename: f});
}
// data.js 会覆盖 __DATA__; 加载完再注入测试数据, 并同步重置 INDEX
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);
vm.runInContext("INDEX = window.__DATA__.index;", ctx);
vm.runInContext('window.CHAR_PLOTS = {"r1":{"林黛玉":"\\n· 黛玉进府：初见宝玉\\n· 葬花吟：与宝钗夜话"}};', ctx);
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
/* P1-12: 只查破碎的 class 属性本身；alt="" 这类合法空属性不算破碎 */
return html.indexOf('class=" ') < 0 && html.indexOf('class=""') < 0;
}

// ---- 穿越首页 ----
vm.runInContext("setNav('traverse')", ctx);
let h = viewHTML();
t("首页有魂穿卡", h.indexOf("魂穿") >= 0);
t("首页有肉身卡", h.indexOf("肉身穿越") >= 0);
t("首页异世界/组团可点", h.indexOf("travMode('isekai')") >= 0 && h.indexOf("travMode('party')") >= 0);
t("首页onclick闭合", onclickWellFormed(h));
t("首页无破碎class", noBrokenClass(h));
t("首页模式卡片5个", (h.match(/travmode(\s|")/g) || []).length === 5);
t("首页有走原著线卡", h.indexOf("走原著线") >= 0 && h.indexOf("travMode('plotline')") >= 0);
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

// ---- P1: 世界补完页（真实卡片路径；extractSeed(card) 签名回归） ----
vm.runInContext(`RP_CARDIMPORT.add({id:"c1", name:"浪人", scenario:"夜之城，一座不夜城", fields:{}, raw:{description:"冷酷的前特工"}, worldbook:[]})`, ctx);
vm.runInContext(`travWorldComplete('card','c1')`, ctx);
h = viewHTML();
t("世界补完页种子", h.indexOf("夜之城") >= 0 && h.indexOf("浪人") >= 0);
t("世界补完页无undefined", h.indexOf("undefined") < 0);
t("世界补完页onclick闭合", onclickWellFormed(h));
vm.runInContext(`localStorage.setItem("nd_wb2_card_c1", JSON.stringify({bg:"补完背景", anchors:["锚点一","锚点二"]}))`, ctx);
const _wb = vm.runInContext(`RP_TRAVERSE.buildWorldBible('card','c1')`, ctx);
t("世界补完合并AI标注", _wb.bg.indexOf("AI 补完世界设定") >= 0 && _wb.bg.indexOf("补完背景") >= 0);
t("世界补完锚点入lore", _wb.loreEntries.some(e=>e.content === "锚点一"));
vm.runInContext(`RP_CARDIMPORT.del("c1"); localStorage.removeItem("nd_wb2_card_c1")`, ctx);

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

// ---- P1: 身份页十项字段 + 逐项重随 ----
vm.runInContext("bodyIdentity('book','r1')", ctx);
h = viewHTML();
t("身份页十项重随", (h.match(/bodyReroll\(/g) || []).length >= 10);
t("身份页备选名", h.indexOf("idNameCand") >= 0);
t("身份页携带物", h.indexOf("idItems") >= 0);
t("身份页钩子", h.indexOf("idHooks") >= 0);
t("身份页相貌", h.indexOf("idLooks") >= 0);
t("身份页onclick闭合", onclickWellFormed(h));

// ---- P2: 异世界三步 ----
vm.runInContext("isekaiPickSrc()", ctx); h = viewHTML();
t("异世界选人", h.indexOf("林黛玉") >= 0);
t("异世界选人onclick闭合", onclickWellFormed(h));
vm.runInContext("isekaiPickDst('r1','林黛玉')", ctx); h = viewHTML();
t("异世界目标世界", h.indexOf("水浒传") >= 0 && h.indexOf("数据待接入") >= 0);
t("异世界红楼已接入", h.indexOf("红楼梦") >= 0 && h.indexOf("已接入") >= 0);
t("水浒不预置人物", h.indexOf("宋江") < 0 && h.indexOf("武松") < 0);
vm.runInContext("isekaiFusion('r1','林黛玉','shuihu')", ctx); h = viewHTML();
t("异世界融合方式", h.indexOf("异乡人") >= 0 && h.indexOf("转生") >= 0);
t("异世界onclick闭合", onclickWellFormed(h));

// ---- P3: 组团三步 ----
vm.runInContext("partySetup()", ctx); h = viewHTML();
t("组团选世界", h.indexOf("talkativeness") >= 0);
t("组团onclick闭合", onclickWellFormed(h));
vm.runInContext("partyPickMain('book','r1')", ctx); h = viewHTML();
t("组团选身份", h.indexOf("魂穿") >= 0 && h.indexOf("肉身") >= 0);
vm.runInContext("partyPickMainBody('book','r1')", ctx); h = viewHTML();
t("组团肉身页", h.indexOf("pbWish") >= 0);
vm.runInContext("partyBodyNext('book','r1')", ctx); h = viewHTML();
t("组团选队友", h.indexOf("partyToggleComp(") >= 0 && h.indexOf("林黛玉") >= 0);
vm.runInContext("partyToggleComp(0); partyStart('book','r1')", ctx);
const _trav3 = vm.runInContext("RP_TRAVERSE.recent()[0]", ctx);
const _party = vm.runInContext("RP_TRAVERSE2.getCompanions('" + _trav3.id + "')", ctx);
t("组团建队+队友默认talk50", vm.runInContext("CHAT.mode", ctx) === "traverse" && _party.length === 1 && _party[0].name === "林黛玉" && _party[0].talk === 50);
vm.runInContext("travPartyTalk(0,10)", ctx);
t("组团talkativeness+10", vm.runInContext("RP_TRAVERSE2.getCompanions('" + _trav3.id + "')[0].talk", ctx) === 60);
vm.runInContext("travPartyView()", ctx); h = viewHTML();
t("队伍页显示talkativeness", h.indexOf("talkativeness") >= 0 && h.indexOf("60") >= 0);

// ---- 世界状态栏渲染 ----
vm.runInContext("renderWsBar()", ctx);
t("wsbar渲染", /潇湘馆|查看/.test(els["wsbar"].innerHTML));

// ---- 回归: v52 点按式沉浸——进页即隐藏栏（display:none），点按呼出，滑动再藏 ----
(function(){
const head = mkEl();
const log = mkEl(); log.scrollTop = 2400; log.scrollHeight = 3000; log.clientHeight = 600;
els["chathead"] = head; els["chatlog"] = log;
vm.runInContext("attachHeadHide()", ctx);
t("headhide: 初始沉浸隐藏", head.style.display === "none");
vm.runInContext("window.__setHeadHidden(false)", ctx);   // 点按呼出
t("headhide: 呼出后显示", head.style.display === "");
log.scrollTop = 2000; log.__fire("scroll");              // 上滑 |Δ|=400>8 -> 隐藏
t("headhide: 滑动后隐藏", head.style.display === "none");
vm.runInContext("window.__setHeadHidden(false)", ctx);
t("headhide: 再次呼出", head.style.display === "");
})();

console.log(`traverse ui: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
})();
