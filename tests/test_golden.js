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
insertAdjacentHTML(pos, html){ if(pos === "afterbegin") this.innerHTML = html + this.innerHTML; else this.innerHTML += html; },
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
for(const f of ["data.js", "icons.js", "data/covers.js", "data/char_plots.js", "rp/escutil.js", "rp/prompt.js", "rp/persona.js",
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
t("选书屏标题", vm.runInContext("titleEl.innerHTML", ctx).indexOf("一键魂穿") >= 0); /* P1-13: 原断言恒真，现查真实标题 */
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

/* ---- 易用性/美观度修复回归 ---- */
t("缺口文案人话", vm.runInContext("humanizeGap('主题层未命中经济/文化关键词：未生成 economy/culture 条目')", ctx)
  === "经济、文化相关描写较少，世界书暂未收录");
t("chunk转段文本", vm.runInContext("humanizeGap('10 个 chunk 无主角出场未参与蒸馏')", ctx)
  === "10 段文本 无主角出场未参与蒸馏");
t("空缺口不崩", vm.runInContext("humanizeGap(null)", ctx) === "");
/* 产物页：书墙 v2（bw-card/bw-cover/bw-meta），旧 badge 断言已过时 */
vm.runInContext("showRuns()", ctx);
h = viewHTML();
t("书墙卡片有元信息", h.indexOf("bw-meta") >= 0 && h.indexOf("角色") >= 0);
t("书名渲染", h.indexOf("bw-name") >= 0 && h.indexOf("红楼梦") >= 0);
/* 主题感知：无硬编码紫色 */
const css = fs.readFileSync(WWW + "/style.css", "utf8");
t("样式无紫色硬编码", !/(6c4dff|7c5cff|b14dff|a78bfa)/i.test(css));
t("开场页跟随主题", css.indexOf(".gopening") >= 0 && /\.gopening[\s\S]{0,400}?var\(--bg\)/.test(css));

/* ---- 顶栏底栏与中间统一 ---- */
t("顶栏透明", /#topbar[\s\S]{0,300}?background:\s*transparent/.test(css));
t("底栏走主题变量", /#mainnav[\s\S]{0,400}?background:\s*var\(--nav-bg\)/.test(css));
t("聊天顶栏走主题变量", /\.chathead[\s\S]{0,400}?background:\s*var\(--nav-bg\)/.test(css));
t("聊天底栏走主题变量", /\.chatbar\{[^}]*background:\s*var\(--nav-bg\)/.test(css));
t("actionbar走主题变量", /\.actionbar[\s\S]{0,400}?background:\s*var\(--nav-bg\)/.test(css));
const themeJs = fs.readFileSync(WWW + "/rp/theme.js", "utf8");
t("三主题都有nav-bg", (themeJs.match(/"--nav-bg"/g) || []).length === 3);
t("栏位无硬编码棕色", !/#topbar[\s\S]{0,300}?rgba\(2[034],1[678],[01][357]/.test(css));

/* ---- 书封面 ---- */
t("封面映射红楼", vm.runInContext("window.BOOKCOVER['红楼梦']", ctx) === "data/covers/honglou.jpg");
t("封面映射水浒", vm.runInContext("window.BOOKCOVER['水浒传']", ctx) === "data/covers/shuihu.jpg");
t("封面文件存在", fs.existsSync(WWW + "/data/covers/honglou.jpg") && fs.existsSync(WWW + "/data/covers/shuihu.jpg"));
vm.runInContext("showRuns()", ctx);
h = viewHTML();
t("有封面的书渲染bw-cover", h.indexOf('class="bw-cover"') >= 0 && h.indexOf("data/covers/honglou.jpg") >= 0);
t("无封面的书回退默认封面", h.indexOf("bw-cover-default") >= 0); /* r2 三国演义无封面 */

/* ---- run 详情页封面横幅 ---- */
vm.runInContext("RUN = {run_id:'r1', novel:'红楼梦', n_chunks:224, profiles:[], sections:[]}; setTab('chars')", ctx);
h = viewHTML();
t("详情页有封面横幅", h.indexOf('class="runbanner"') >= 0 && h.indexOf("data/covers/honglou.jpg") >= 0);
vm.runInContext("setTab('outline')", ctx);
t("切换tab横幅不重复", (viewHTML().match(/class="runbanner"/g) || []).length === 1);
vm.runInContext("RUN = {run_id:'r2', novel:'三国演义', n_chunks:100, profiles:[]}; setTab('chars')", ctx);
t("无封面的书不展示横幅", viewHTML().indexOf('class="runbanner"') < 0);
t("横幅CSS存在", /\.runbanner[\s\S]{0,200}?border-radius:14px/.test(css));

/* ---- 十项美化回归 ---- */
t("tagline按标点截断", vm.runInContext("tagline({md:'- core_identity: 依附女婿家过活的积年老寡妇，为人精明能干极会见风使舵，乡间贫农门户出身却惯会察言观色，平生最得意的是攀上了贾府这门贵亲'})", ctx) === "依附女婿家过活的积年老寡妇，为人精明能干极会见风使舵，乡间贫农门户出身却惯会察言观色，");
t("tagline短文本不截", vm.runInContext("tagline({md:'- core_identity: 军师'})", ctx) === "军师");
t("isChipTag过滤长剧透", vm.runInContext("isChipTag('被宋江赐死以绝后患者')", ctx) === false);
t("isChipTag保留短标签", vm.runInContext("isChipTag('军师')", ctx) === true && vm.runInContext("isChipTag('步军头领')", ctx) === true);
t("cardTags过滤后干净", (()=>{ const tags = vm.runInContext("cardTags({novel:'水浒传', fields:{role_tags:'军师，被宋江赐死以绝后患者'}})", ctx); return tags.indexOf("军师") >= 0 && tags.indexOf("被宋江赐死以绝后患者") < 0; })());
t("skeleton存在", vm.runInContext("skeletonHTML(3).indexOf('skelwrap')", ctx) >= 0);
t("选项卡壹贰叁", (()=>{ const h = vm.runInContext("optCardHTML({intro:'选', options:['a','b'], tips:''}, true, 0)", ctx); return h.indexOf("壹") >= 0 && h.indexOf("贰") >= 0; })());
vm.runInContext("goldenPickBook()", ctx);
t("选书页有封面", viewHTML().indexOf('class="bookcover gbk"') >= 0);
t("印章CSS存在", /\.tm-seal[\s\S]{0,300}?border-radius:7px/.test(css));
t("统计格CSS存在", /\.statgrid[\s\S]{0,80}?grid-template-columns:1fr 1fr/.test(css));
t("空状态分隔线", /\.empty::before[\s\S]{0,200}?linear-gradient/.test(css));
t("骨架屏CSS存在", /@keyframes skelsh/.test(css));

/* ---- 易用性十项回归 ---- */
// 1. 后悔药
vm.runInContext("CHAT={mode:'traverse',travId:'t9',runId:'r1',name:'林黛玉'};", ctx);
vm.runInContext("var EM9=String.fromCharCode(0xFE0F,0x20E3),NL=String.fromCharCode(10);", ctx);
vm.runInContext("var decC='选吧<small>'+NL+'intro'+NL+'1'+EM9+'选A'+NL+'2'+EM9+'选B</small>';", ctx);
vm.runInContext("localStorage.setItem('nd_travchat_t9',JSON.stringify([{role:'assistant',content:decC,ts:1},{role:'user',content:'选A',ts:2},{role:'assistant',content:'好',ts:3}]));", ctx);
t("repickInfo命中决策", vm.runInContext("repickInfo()!==null && repickInfo().decIdx===0", ctx) === true);
vm.runInContext("localStorage.setItem('nd_travchat_t9',JSON.stringify([{role:'assistant',content:'hi',ts:1},{role:'user',content:'hello',ts:2}]));", ctx);
t("repickInfo非决策返回null", vm.runInContext("repickInfo()===null", ctx) === true);
vm.runInContext("CHAT={mode:'single',runId:'r1',name:'林黛玉'};", ctx);
t("repickInfo非traverse返回null", vm.runInContext("repickInfo()===null", ctx) === true);
// 2. API横幅
vm.runInContext(`localStorage.removeItem("nd_api_cfg_v1"); showChatPicker();`, ctx);
t("无Key选人页有横幅", viewHTML().indexOf("apibanner") >= 0);
vm.runInContext(`localStorage.setItem("nd_api_cfg_v1", JSON.stringify({key:"sk-x",base:"https://x",model:"m"})); showChatPicker();`, ctx);
t("有Key无横幅", viewHTML().indexOf("apibanner") < 0);
// 3. 字号
t("字号默认1", vm.runInContext("getFontScale()", ctx) === 1);
vm.runInContext(`localStorage.setItem("nd_font_scale","1.15");`, ctx);
t("字号读取1.15", vm.runInContext("getFontScale()", ctx) === 1.15);
vm.runInContext(`localStorage.removeItem("nd_font_scale");`, ctx);
// 4. 设置搜索不崩
t("filterSettings不崩", (()=>{ try{ vm.runInContext("filterSettings('壁纸')", ctx); return true; }catch(e){ return false; } })());
// 5. 快捷条
t("无模块时快捷条为空", vm.runInContext("dailyStripHTML()", ctx) === "");
vm.runInContext(`window.RP_CHECKIN={hasToday:()=>false,streak:()=>3,checkin:()=>({isNew:true,streak:4})};
window.RP_ACHV={count:()=>2,DEFS:[1,2,3]};`, ctx);
t("快捷条有签到成就", (()=>{ const h = vm.runInContext("dailyStripHTML()", ctx); return h.indexOf("签到")>=0 && h.indexOf("成就")>=0; })());
// 6. 穿越时间线说明
t("穿越页有时间线说明", (()=>{ try{ vm.runInContext("showTraverse()", ctx); return viewHTML().indexOf("独立的时间线")>=0; }catch(e){ return false; } })());
// 10. simbar单行
t("simbar单行横滑", /\.simbar[\s\S]{0,400}?flex-wrap:nowrap/.test(css));

console.log(`\ngolden: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("ERROR", e); process.exit(1); });
