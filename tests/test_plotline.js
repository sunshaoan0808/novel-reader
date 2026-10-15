const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
let pass=0, fail=0; const t=(n,c)=>{c?pass++:(fail++,console.log("FAIL:",n));};

function takeDecl(src, name){
let i = src.indexOf("const "+name+" ");
if(i<0) i = src.indexOf("var "+name+" ");
let d=0, instr=null;
for(let k=i;k<src.length;k++){
const ch=src[k];
if(instr){ if(ch===instr && src[k-1]!=="\\") instr=null; continue;}
if(ch==="`"||ch==="\""||ch==="\x27"){ instr=ch; continue;}
if(ch==="{") d++; else if(ch==="}") d--;
else if(ch===";" && d===0) return src.slice(i,k+1);
}
throw new Error("unbalanced "+name);
}
function takeFn(src, name){
const re = new RegExp("function\\s+"+name+"\\s*\\(");
const m = src.match(re); if(!m) throw new Error("no fn "+name);
let d=0; const j=src.indexOf("{",m.index);
for(let k=j;k<src.length;k++){
if(src[k]==="{") d++; else if(src[k]==="}"){ d--; if(!d) return src.slice(m.index,k+1);}
}
throw new Error("unbalanced fn "+name);
}

// ---- data/char_plots.js: 原著剧情大纲数据 ----
const dsrc = fs.readFileSync(WWW+"/data/char_plots.js","utf8");
const dctx = {console, window:{}};
vm.createContext(dctx);
vm.runInContext(dsrc, dctx);
/* char_plots.js 按 runId 分层: CHAR_PLOTS[runId][人物名] */
const PLOTS = dctx.window.CHAR_PLOTS.honglou_full;
const CHARS = ["贾宝玉","林黛玉","薛宝钗","王熙凤","贾母","王夫人","袭人","晴雯","刘姥姥","秦钟"];
t("10 个人物全有", CHARS.every(n=>typeof PLOTS[n]==="string" && PLOTS[n].length>50));
t("每份含人物名", CHARS.every(n=>PLOTS[n].includes(n)));
t("每份长度受控(<=1600字)", CHARS.every(n=>PLOTS[n].length<=1600));
t("含原著剧情脉络标识", PLOTS["林黛玉"].includes("原著剧情脉络"));
t("黛玉有焚稿/南归级关键事件", /焚稿|南归|葬花/.test(PLOTS["林黛玉"]));

// ---- chat.js: plotRef 参考式注入(非指令) ----
const csrc = fs.readFileSync(WWW+"/rp/chat.js","utf8");
const cctx = {console}; vm.createContext(cctx);
vm.runInContext(takeFn(csrc,"plotRef"), cctx);
const ref = vm.runInContext('plotRef("测试大纲")', cctx);
t("plotRef 含大纲", ref.includes("测试大纲"));
t("plotRef 有参考标识", ref.includes("角色原著剧情"));
t("plotRef 无指令文案",!/目标|推进|达成/.test(ref));
t("plotInstr 已删除",!csrc.includes("plotInstr"));
t("单聊+群聊+重生都注入 plotRef", (csrc.match(/plotRef\(opts\.plotOutline\)/g)||[]).length===3);
t("无 plotGoal 残留",!csrc.includes("plotGoal"));

// ---- app.js: 剧情线存取 v27 ----
const asrc = fs.readFileSync(WWW+"/app.js","utf8");
const store = {};
const actx = {console, CHAT:{mode:"single",runId:"r1",name:"林黛玉",members:[]},
window:{CHAR_PLOTS:{"r1":PLOTS}},
localStorage:{getItem:k=>store[k]??null, setItem:(k,v)=>{store[k]=String(v);}}};
vm.createContext(actx);
for(const f of ["bundledPlotFor","plotKey","getPlot","savePlot","bundledPlot","activePlotOutline"]) vm.runInContext(takeDecl(asrc,f), actx);
const E=c=>vm.runInContext(c,actx);
t("单聊 key 不变", E("plotKey()")==="nd_plot_r1_林黛玉");
t("未保存时用捆绑大纲", E("activePlotOutline()")===PLOTS["林黛玉"]);
E('savePlot({outline:"读者自编大纲",updatedAt:123})');
t("用户版优先于捆绑", E("activePlotOutline()")==="读者自编大纲");
E('savePlot({outline:"",updatedAt:124})');
t("清空后返回空(不回退捆绑)", E("activePlotOutline()")==="");
E('CHAT={mode:"group",runId:"r1",name:null,members:["林黛玉","贾宝玉"]}');
t("群聊 key 按成员排序", E("plotKey()")==="nd_plot_r1_g_"+["林黛玉","贾宝玉"].sort().join("_"));
const g = E("activePlotOutline()");
t("群聊拼接成员大纲", g.includes("林黛玉") && g.includes("贾宝玉"));
E('CHAT={mode:"single",runId:"r1",name:"原创角色",members:[]}');
t("无数据角色返回空", E("activePlotOutline()")==="");
t("activePlotGoal 已删除",!asrc.includes("activePlotGoal("));
t("达成结算弹窗已删除", !asrc.includes("目标达成") && !asrc.includes("要结算"));
t("plotEditor 存在", asrc.includes("window.plotEditor"));
t("编辑器是大纲语义", asrc.includes("原著剧情大纲") && asrc.includes("恢复原著大纲"));
t("编辑器无目标语义",!asrc.includes("保存目标") &&!asrc.includes("达成结算"));
t("发送透传 plotOutline", (asrc.match(/plotOutline: activePlotOutline\(\)/g)||[]).length===2);
t("正文区无 plotbar 入口", !asrc.includes('id="plotbar"') && !asrc.includes("原著剧情大纲 · 点击编辑"));
t("抽屉入口改名", asrc.includes('icon("book-open")') && asrc.includes("剧情线") &&!asrc.includes("🎯 剧情线"));
t("index.html 引入数据", fs.readFileSync(WWW+"/index.html","utf8").includes('src="data/char_plots.js"'));
console.log(`plotline: ${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
