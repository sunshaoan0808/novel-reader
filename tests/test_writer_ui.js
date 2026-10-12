const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// ---- 轻量 DOM/环境桩 ----
const els = {};
function mkEl(){ return {innerHTML:"", textContent:"", value:"", classList:{add(){},remove(){},toggle(){}},
  querySelectorAll(){return [];}, addEventListener(){}, scrollTo(){}, style:{}}; }
const ls = (function(){ const m={}; return {
  getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
  key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
const document = {body: mkEl(), getElementById:id=>els[id]||(els[id]=mkEl()),
  querySelector:(sel)=>{const id=String(sel).replace("#","");return els[id]||(els[id]=mkEl());}, createElement:()=>mkEl()};
const window = {__DATA__:{index:[{run_id:"r1",novel:"测试小说"}], runs:{r1:{novel:"测试小说",worldbook:[],relations:[]}}, rp_cards:{}}};
const ctx = {localStorage: ls, document, console,
  alert(){}, confirm(){return true;}, prompt(){return null;},
  setTimeout, clearTimeout};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.__DATA__ = {index:[{run_id:"r1",novel:"测试小说"}], runs:{r1:{novel:"测试小说",worldbook:[],relations:[]}}, rp_cards:{}};
vm.createContext(ctx);
for(const f of [WWW+"/rp/cardwriter.js"]) vm.runInContext(fs.readFileSync(f,"utf8"), ctx);
// app.js 需要的桩: $ esc getCfg RP_NET chatWith 等
vm.runInContext(`
localStorage.setItem("nd_api_cfg_v1", JSON.stringify({key:"k", base:"b", model:"m"}));
const RP_NET = {complete: async ()=> "Ruby 回复"};
const chatWith = (r,n)=>{ globalThis.__chatWith = [r,n]; };
`, ctx);
vm.runInContext(fs.readFileSync(WWW+"/icons.js","utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/escutil.js","utf8"), ctx); /* P0-1: app.js 用 jq() */
vm.runInContext(fs.readFileSync(WWW+"/app.js","utf8"), ctx);
let pass=0, fail=0;
const t=(n,c)=>{c?pass++:(fail++,console.log("FAIL:",n));};

vm.runInContext(`showWriter();`, ctx);
t("showWriter renders", ctx.document.getElementById("view").innerHTML.includes("新建写卡"));

vm.runInContext(`newWriter();`, ctx);
t("newWriter renders world select", ctx.document.getElementById("view").innerHTML.includes("w_world"));

ctx.document.getElementById("w_world").value = "r1";
vm.runInContext(`startWriter();`, ctx);
const sess = vm.runInContext(`RP_WRITER.listSessions()`, ctx);
t("startWriter creates session", sess.length === 1);
const sid = sess[0].id;
t("writerChat renders step", ctx.document.getElementById("view").innerHTML.includes("美学思考"));

// UI 专项: 写卡页 placeholder 不与 label 重复、带字数计数器
vm.runInContext(`showWriter();`, ctx);
const whtml = ctx.document.getElementById("view").innerHTML;
t("vibe placeholder 去掉重复前缀", whtml.includes('placeholder="比如: 嘴硬心软的落魄书生'));
t("vibe_desc 有计数器", whtml.includes('id="vibe_desc_cnt"') && whtml.includes("taCount("));
t("qg_premise 有计数器", whtml.includes('id="qg_premise_cnt"'));
t("taCount 函数存在", typeof ctx.taCount === "function");

// finalizeStep 需要 confirm=true, RP_NET.complete 桩
(async()=>{
  // 先塞两轮对话
  vm.runInContext(`var s=RP_WRITER.getSession('${sid}'); s.history=[{role:'user',content:'想写个落魄书生'},{role:'assistant',content:'有点意思'}]; RP_WRITER.saveSession(s);`, ctx);
  try{ await vm.runInContext(`finalizeStep('${sid}')`, ctx); }catch(e){ console.log("ERR finalize", e.message); }
  const s2 = vm.runInContext(`RP_WRITER.getSession('${sid}')`, ctx);
  t("finalizeStep advances", s2.step === 1 && !!s2.summaries.step0);
  console.log(`\nwriter ui: ${pass} pass, ${fail} fail`);
  process.exit(fail?1:0);
})().catch(e=>{console.log("ERR",e);process.exit(1);});
