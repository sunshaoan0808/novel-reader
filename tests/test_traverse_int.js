// test_traverse_int.js: 穿越 P1/P2 集成点（traverse.js 新增分支）
// 世界注册表回退 / pending 世界不编造 / 异世界身份行 / AI 补完世界卡合并
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const ctx = {console, TextDecoder};
const ls = (function(){ const m={}; return {
getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
ctx.localStorage = ls;
ctx.window = {__DATA__: {runs:{r1:{run_id:"r1", novel:"红楼梦", worldbook:[]}}, rp_cards:{}}};
ctx.__DATA__ = ctx.window.__DATA__;
ctx.RP = {findCard:()=>null};
ctx.RP_GROUP = {memberBrief:(c)=>c.name};
/* RP_TRAVERSE2 最小 mock：世界注册表 */
ctx.RP_TRAVERSE2 = {
  getWorld: (key)=>{
    if(key==="shuihu") return {key:"shuihu", kind:"book", title:"水浒传", status:"pending",
      note:"水浒蒸馏管线运行中，profile/plot 落地后接入，此处不预置任何人物剧情"};
    if(key==="honglou") return {key:"honglou", kind:"book", title:"红楼梦", status:"ready", note:""};
    return null;
  }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/prompt.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/traverse.js", "utf8"), ctx);
const T = vm.runInContext("RP_TRAVERSE", ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c? pass++: (fail++, console.log("FAIL:", n)); };

// --- 世界注册表回退 ---
t("注册表回退：水浒", T.worldDisplayName("book", "shuihu") === "《水浒传》");
t("未知世界仍未知", T.worldDisplayName("book", "nope") === "未知世界");
t("真实 run 优先", T.worldDisplayName("book", "r1") === "《红楼梦》");

// --- pending 世界不编造 ---
const pb = T.buildWorldBible("book", "shuihu");
t("pending世界bg不编造", pb.bg.indexOf("不要编造") >= 0);
t("pending世界无人物条目", pb.loreEntries.length === 0);

// --- 异世界身份行 ---
t("isekai身份行", T.identityOneLiner({mode:"isekai", charName:"林黛玉"}).indexOf("林黛玉") >= 0
  && T.identityOneLiner({mode:"isekai", charName:"林黛玉"}).indexOf("异世界") >= 0);

// --- AI 补完世界卡合并（nd_wb2_） ---
ls.setItem("nd_wb2_card_c1", JSON.stringify({bg:"补完设定：夜之城2077年", anchors:["荒坂塔潜入"], updatedAt: 1}));
ctx.RP_CARDIMPORT = {findById:(id)=>id==="c1"? {id:"c1", name:"浪人",
  fields:{core_identity:"前特工", core_traits:"冷酷"}, scenario:"夜之城",
  worldbook:[{title:"夜之城", trigger_keywords:["夜之城"], content:"不夜城", priority:55}]}: null};
const cb = T.buildWorldBible("card", "c1");
t("补完bg合并", cb.bg.indexOf("AI 补完世界设定") >= 0 && cb.bg.indexOf("补完设定") >= 0);
t("补完锚点合并", cb.loreEntries.some(e=>e.title.indexOf("AI 补完") >= 0 && e.content.indexOf("荒坂塔潜入") >= 0));
t("原文不丢", cb.bg.indexOf("夜之城") >= 0);

console.log(`traverse_int: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
