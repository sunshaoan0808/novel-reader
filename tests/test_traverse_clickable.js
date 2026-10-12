const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 回归: 穿越模式点击链 (v31 真机 bug: onclick="f(${JSON.stringify(x)})" 里 JSON 的双引号
// 提前终止 HTML 属性, 点下去是 SyntaxError, 子页面所有按钮无反应;
// 另: Android WebView 不实现 onShowFileChooser 时 input.click() 被静默吞掉, 见 MainActivity.java)
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
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: [{name: "林黛玉"}, {name: "贾宝玉"}]}},
rp_cards: {r1: [{name: "林黛玉", fields: {core_identity: "林如海之女", core_traits: "敏感多思"}}]},
};
const ctx = {localStorage: ls, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){}, fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
ctx.CHAR_PLOTS = {"林黛玉": "\n· 黛玉进贾府：初见宝玉"};
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "data/char_plots.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js", "rp/aifill.js",
"rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "rp/traverse2.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW+ "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);
vm.runInContext("INDEX = window.__DATA__.index;", ctx);
const viewHTML = () => els["view"].innerHTML;

let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n)); };

// 坏模式: onclick="..." 双引号属性里出现 JSON.stringify( —— JSON 自带的 " 必提前终止属性
function noJsonInDqOnclick(html){
return !/onclick="[^"]*JSON\.stringify/.test(html);
}
// 所有 onclick 属性值必须能编译(抓 SyntaxError: Unexpected end of input 这类)
function allOnclickCompile(html){
const bad = [];
const re = /onclick=('|")((?:(?!\1).)*)\1/g;
let m;
while((m = re.exec(html))){
try{ new Function(m[2]); }catch(e){ bad.push(m[2].slice(0, 60)); }
}
return bad;
}
function checkPage(name, html){
t(name + ": 无双引号onclick套JSON", noJsonInDqOnclick(html));
const bad = allOnclickCompile(html);
t(name + ": onclick全部可编译(" + (html.match(/onclick=/g)||[]).length + "个)", bad.length === 0);
if(bad.length) console.log("   BROKEN:", bad.slice(0, 3));
}

// ---- 四个模式入口可跳转 ----
vm.runInContext("setNav('traverse')", ctx);
let h = viewHTML();
checkPage("穿越首页", h);
const modes = ["soul", "body", "isekai", "party"];
const titles = {soul: "魂穿", body: "肉身穿越", isekai: "异世界穿越", party: "组团穿越"};
for(const m of modes){
t("首页有" + m + "入口", h.indexOf("travMode('" + m + "')") >= 0);
vm.runInContext("travMode('" + m + "')", ctx);
const th = viewHTML();
t(m + "可跳转", th.length > 100 && th !== h);
t(m + "标题切换", (els["title"].innerHTML || "").indexOf(titles[m]) >= 0);
checkPage("travMode:" + m, th);
vm.runInContext("setNav('traverse')", ctx); h = viewHTML();
}

// ---- 纵深: 每级子页面渲染后 onclick 仍全可编译 ----
vm.runInContext("soulPickTarget()", ctx); checkPage("魂穿选人", viewHTML());
vm.runInContext("soulAnchors('r1','林黛玉')", ctx); checkPage("魂穿锚点", viewHTML());
vm.runInContext("bodyPickWorld()", ctx); checkPage("肉身选世界", viewHTML());
vm.runInContext("bodyIdentity('book','r1')", ctx); checkPage("肉身捏身份", viewHTML());
vm.runInContext("isekaiPickSrc()", ctx); checkPage("异世界选人", viewHTML());
vm.runInContext("isekaiPickDst('r1','林黛玉')", ctx); checkPage("异世界选世界", viewHTML());
vm.runInContext("isekaiFusion('r1','林黛玉','honglou')", ctx); checkPage("异世界融合", viewHTML());
vm.runInContext("partySetup()", ctx); checkPage("组团选世界", viewHTML());
vm.runInContext("partyPickMain('book','r1')", ctx); checkPage("组团定身份", viewHTML());
vm.runInContext("partyPickMainSoul('book','r1')", ctx); checkPage("组团选人", viewHTML());
vm.runInContext("partyPickMainBody('book','r1')", ctx); checkPage("组团肉身", viewHTML());

// ---- 导入入口可触发: travImport() 必须点到 #travFile ----
vm.runInContext("setNav('traverse')", ctx);
t("导入按钮存在", viewHTML().indexOf("travImport()") >= 0);
t("#travFile存在", viewHTML().indexOf('id="travFile"') >= 0);
let fileClicked = false;
els["travFile"] = mkEl();
els["travFile"].click = () => { fileClicked = true; };
vm.runInContext("travImport()", ctx);
t("travImport触发file input点击", fileClicked);
t("travImportFile已定义", vm.runInContext("typeof travImportFile", ctx) === "function");

// ---- MainActivity 必须实现 onShowFileChooser(否则 WebView 里 input.click 被静默吞) ----
const java = fs.readFileSync("android/src/com/ling/novelreader/MainActivity.java", "utf8");
t("MainActivity实现onShowFileChooser", java.indexOf("onShowFileChooser") >= 0);
t("MainActivity有onActivityResult回传", java.indexOf("onReceiveValue") >= 0);

console.log(`traverse clickable: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
