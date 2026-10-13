const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 2026-10-07 四项接 App 回归: ccv3 优先读取 / 管线 openings / OOC 纠错注入 / 剧情线
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
function mkCtx(){
const els = {}; const store = {};
const ls = {getItem: k => (k in store? store[k]: null),
setItem: (k, v) => { store[k] = String(v);},
removeItem: k => { delete store[k];},
key: i => Object.keys(store)[i] || null,
get length(){ return Object.keys(store).length;}};
const document = {body: mkEl(),
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => { const m = String(sel).match(/^#([\w-]+)$/); return m? (els[m[1]] || (els[m[1]] = mkEl())): null;},
querySelectorAll: () => [], createElement: () => mkEl()};
const ctx = {localStorage: ls, document, console, TextDecoder,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){},
fetch: () => Promise.reject(new Error("no net")),
btoa: (s)=>Buffer.from(s, "binary").toString("base64"),
atob: (s)=>Buffer.from(s, "base64").toString("binary"),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["rp/prompt.js", "rp/cardimport.js", "rp/chat.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
return ctx;
}
// 从 app.js 按名提取函数
function pickFn(name){
const src = fs.readFileSync(WWW + "/app.js", "utf8");
const i = src.indexOf("function " + name + "(");
if(i < 0) throw new Error("not found: " + name);
let d = src.indexOf("{", i), lvl = 0, j = d;
for(; j < src.length; j++){
if(src[j] === "{") lvl++;
else if(src[j] === "}"){ lvl--; if(!lvl) break; }
}
return src.slice(i, j + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n));};
const run = (ctx, code) => vm.runInContext(code, ctx);

(async () => {
const ctx = mkCtx();

/* ---- 1. ccv3 优先读取 ---- */
run(ctx, `
(function(){
  function chunk(kw, jsonB64){
    var kwB = []; for(var i=0;i<kw.length;i++) kwB.push(kw.charCodeAt(i));
    var jb = []; for(var i=0;i<jsonB64.length;i++) jb.push(jsonB64.charCodeAt(i));
    var data = kwB.concat([0]).concat(jb);
    var len = data.length;
    var hdr = [(len>>>24)&255,(len>>>16)&255,(len>>>8)&255,len&255, 116,69,88,116];
    return hdr.concat(data).concat([0,0,0,0]);
  }
  var sig = [137,80,78,71,13,10,26,10];
  var iend = [0,0,0,0, 73,69,78,68, 0,0,0,0];
  var v2 = b64encodeUnicodeForTest(JSON.stringify({spec:"chara_card_v2",spec_version:"2.0",data:{name:"旧卡",description:"v2"}}));
  var v3 = b64encodeUnicodeForTest(JSON.stringify({spec:"chara_card_v3",spec_version:"3.0",data:{name:"新卡",nickname:"阿新",description:"v3",assets:["a.png"]}}));
  var png = new Uint8Array(sig.concat(chunk("chara", v2)).concat(chunk("ccv3", v3)).concat(iend));
  window.__dualBuf = png.buffer;
})();
function b64encodeUnicodeForTest(s){ return btoa(unescape(encodeURIComponent(s))); }
`);
const spec = run(ctx, `JSON.parse(RP_CARDIMPORT.extractChara(window.__dualBuf)).spec`);
t("ccv3优先于chara", spec === "chara_card_v3");
const nm = run(ctx, `RP_CARDIMPORT.normalizeTavern(RP_CARDIMPORT.parseCardJson(RP_CARDIMPORT.extractChara(window.__dualBuf)))`);
t("v3 nickname透传", run(ctx, `(${JSON.stringify(nm)}).nickname`) === undefined || nm.nickname === "阿新");
t("v3 assets透传", Array.isArray(nm.assets) && nm.assets.length === 1);
t("v3 spec标记", nm.cardSpec === "chara_card_v3");

/* ---- 2. 管线 openings 进 cardOpenings ---- */
run(ctx, pickFn("cardOpenings") + `
window.__DATA__ = {runs: {r1: {openings: {"林黛玉": [{situation: "夜话", text: "黛玉开场白文本"}]}}}, rp_cards: {}};
RP.findCard = function(){ return {name: "林黛玉", greeting: "", altGreetings: []}; };
`);
const ops = run(ctx, `cardOpenings("r1", "林黛玉")`);
t("openings合并", Array.isArray(ops) && ops.length === 1);
t("openings文本", ops[0].text === "黛玉开场白文本");
t("openings情境标签", ops[0].label === "夜话");

/* ---- 3. OOC 纠错注入 prompt ---- */
const sys = run(ctx, `RP_PROMPT.buildMessages(
  {name: "王熙凤", fields: {}, oocCorrections: [{prompt_injection_rule: "提到王熙凤出场必须引用粉面含春威不露"}]},
  {novel: "红楼梦"}, {maxContext: 8192}
).messages.filter(function(m){return m.role==="system";}).map(function(m){return m.content;}).join("\\n")`);
t("OOC规则进system", sys.indexOf("粉面含春威不露") >= 0);
t("OOC标题", sys.indexOf("OOC 纠错") >= 0);

/* ---- 4. 无纠错时不注入 ---- */
const sys2 = run(ctx, `RP_PROMPT.buildMessages(
  {name: "贾宝玉", fields: {}}, {novel: "红楼梦"}, {maxContext: 8192}
).messages.filter(function(m){return m.role==="system";}).map(function(m){return m.content;}).join("\\n")`);
t("无纠错不注入", sys2.indexOf("OOC 纠错") < 0);

/* ---- 5. 世界卡 tab ---- */
/* P2-11: app.js 的 esc 已收敛为 escutil.js 的 escH 别名，harness 直接加载 escutil 并起本地别名 */
run(ctx, fs.readFileSync(WWW + "/rp/escutil.js", "utf8") + "\nvar esc = escH;");
run(ctx, pickFn("skeletonHTML")); /* showWorldcard 先渲染骨架屏 */
run(ctx, pickFn("humanizeGap")); /* 渲染缺口声明 */
run(ctx, pickFn("prependRunBanner")); /* render 开头插入 run banner */
run(ctx, `var _wcCache = {}, _wcFailed = {}, _wcData = null, view = document.getElementById("view"),
  RUN = {run_id: "wctest", novel: "测试小说"}, TAB = "world";`);
run(ctx, `window.__WORLDCARD_wctest = {
  name: "测试小说（小说世界）", novelMaterialStatus: "partial",
  worldBookEntries: [
    {uid:"wb-00001", comment:"世界概览", content:"江湖与朝廷对立。", entryType:"setting",
     key:["测试"], constant:false, order:80, position:"before_char", novelProvenance:{}},
    {uid:"wb-00002", comment:"次要人物", content:"店小二C（出场ch001）", entryType:"npcs",
     key:["店小二C"], constant:false, order:60, position:"before_char", novelProvenance:{}},
    {uid:"wb-00003", comment:"世界规则", content:"上山规矩：投名状方可入伙", entryType:"rules",
     key:["上山"], constant:false, order:50, position:"before_char", novelProvenance:{}}
  ],
  directorDefinitions: [{
    id:"d1", title:"测试小说剧情因果蓝图", coreConflict:"上山之争——被逼上山",
    anchors:["上山之争"],
    stages:[{id:"stage-00", title:"开端", description:"主角出场。",
              nodeIds:["event-e0"], completion:false}],
    nodes:[{id:"event-e0", stageId:"stage-00", title:"主角A上山", intent:"主角A上山。",
            actorIds:["actor-主角A"], execution:"background", conditions:[],
            dependsOn:[], constraints:[], sourceRefs:["ch001"]}],
    characters:[{id:"actor-主角A", name:"主角A", aliases:["A哥"]}],
    coverage:{complete:false, gaps:["缺口示例"]}, schemaVersion:1
  }],
  modules: []
};`);
run(ctx, pickFn("loadWorldcard") + "\n" + pickFn("getWorldcard"));
run(ctx, pickFn("showWorldcard") + "\n" + pickFn("wcSearch"));
run(ctx, `showWorldcard();`);
await new Promise(r=>setTimeout(r, 30)); /* loadWorldcard 走 Promise，等微任务落定 */
const wcHtml = run(ctx, `view.innerHTML`);
t("世界卡渲染", wcHtml.indexOf("测试小说（小说世界）") >= 0);
t("世界卡核心冲突", wcHtml.indexOf("上山之争") >= 0);
t("世界卡导演分幕", wcHtml.indexOf("开端") >= 0);
t("世界卡缺口声明", wcHtml.indexOf("缺口示例") >= 0);
t("世界卡检索框", wcHtml.indexOf('id="wc-q"') >= 0);
t("世界卡NPC", wcHtml.indexOf("店小二C") >= 0);
run(ctx, `document.getElementById("wc-q").value = "店小二"; wcSearch();`);
const wcRes = run(ctx, `document.getElementById("wc-res").innerHTML`);
t("世界卡检索命中", wcRes.indexOf("店小二C") >= 0);
run(ctx, `document.getElementById("wc-q").value = "不存在xyz"; wcSearch();`);
const wcRes2 = run(ctx, `document.getElementById("wc-res").innerHTML`);
t("世界卡检索无匹配", wcRes2.indexOf("无匹配") >= 0);

console.log("\\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.error("ERROR", e); process.exit(1); });
