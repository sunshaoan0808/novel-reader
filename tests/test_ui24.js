const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// ---- 轻量 DOM/环境桩 (同 test_writer_ui) ----
const els = {};
function mkEl(){ return {innerHTML:"", textContent:"", value:"", classList:{add(){},remove(){},toggle(){}},
  querySelectorAll(){return [];}, addEventListener(){}, scrollTo(){}, style:{}}; }
const ls = (function(){ const m={}; return {
  getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
  key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
const document = {body: mkEl(), getElementById:id=>els[id]||(els[id]=mkEl()),
  querySelector:(sel)=>{const id=String(sel).replace("#","");return els[id]||(els[id]=mkEl());}, createElement:()=>mkEl()};
const DATA = {index:[{run_id:"r1",novel:"测试小说"}],
  runs:{r1:{run_id:"r1", novel:"测试小说", worldbook:[], relations:[],
    profiles:[{name:"阿绫", md:"**core_identity**: 机灵俏皮的少女剑客"}]}},
  rp_cards:{}};
const window = {__DATA__: DATA};
const ctx = {localStorage: ls, document, console,
  alert(){}, confirm(){return true;}, prompt(){return null;},
  setTimeout, clearTimeout};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of [WWW+"/rp/cardwriter.js"]) vm.runInContext(fs.readFileSync(f,"utf8"), ctx);
vm.runInContext(`
localStorage.setItem("nd_api_cfg_v1", JSON.stringify({key:"k", base:"b", model:"m"}));
const RP_NET = {complete: async ()=> "Ruby 回复"};
const chatWith = (r,n)=>{ globalThis.__chatWith = [r,n]; };
`, ctx);
vm.runInContext(fs.readFileSync(WWW+"/icons.js","utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/escutil.js","utf8"), ctx); /* P1-12: app.js 用到 jq() */
vm.runInContext(fs.readFileSync(WWW+"/app.js","utf8"), ctx);
let pass=0, fail=0;
const t=(n,c)=>{c?pass++:(fail++,console.log("FAIL:",n));};

// 1) charCardHTML 结构
const h1 = vm.runInContext(`charCardHTML({name:"阿绫", tag:"测试小说", sum:"机灵少女", oncard:"go()", ops:"<button>开聊</button>"})`, ctx);
t("charcard 结构", h1.includes('class="charcard"') && h1.includes('class="charcover cc') && h1.includes("阿绫") && h1.includes("机灵少女") && h1.includes("开聊"));
t("封面默认头像", h1.includes('src="bg/avatar_default.jpg"')); /* v3: 首字大字已换成默认头像图 */

// 2) charCoverCls 确定性
const c1 = vm.runInContext(`charCoverCls("阿绫")`, ctx);
const c2 = vm.runInContext(`charCoverCls("阿绫")`, ctx);
t("封面类确定", c1 === c2 && /^cc[0-3]$/.test(c1));

// 3) 情景预设 → 场景卡片
vm.runInContext(`CHAT = {mode:"single"}; renderScenChips();`, ctx);
const sc = els["scenbar"].innerHTML;
t("场景 chips 渲染", sc.includes("scenchip") && sc.includes("哄睡") && !sc.includes("scencard"));
t("场景 4 张", (sc.match(/scenchip(?! off)/g)||[]).length === 4);

// 4) charList → 网格
vm.runInContext(`RUN = __DATA__.runs.r1;`, ctx);
const cl = vm.runInContext(`charList(RUN.profiles)`, ctx);
t("人物网格", cl.includes("chargrid") && cl.includes("阿绫") && cl.includes("机灵俏皮"));
const cl0 = vm.runInContext(`charList([])`, ctx);
t("人物空状态", cl0.includes("empty") && cl0.includes("🎭"));

// 5) charSumFor: profile core_identity
const sf = vm.runInContext(`charSumFor("r1","阿绫")`, ctx);
t("charSumFor 取 tagline", sf.includes("机灵俏皮"));

// 6) showChatPicker → 网格 (INDEX 需先赋值)
vm.runInContext(`INDEX = __DATA__.index; showChatPicker();`, ctx);
const pk = els["view"].innerHTML;
t("选角色网格", pk.includes("chargrid") && pk.includes("阿绫"));

// 7) showWriter 自创卡网格 + 空状态
vm.runInContext(`showWriter();`, ctx);
const w0 = els["view"].innerHTML;
t("写卡空状态", w0.includes("🎭") && w0.includes("新建写卡"));
vm.runInContext(`localStorage.setItem("nd_custom_chars", JSON.stringify([{id:"c1", name:"测试卡", novel:"自定义", fields:{core_identity:"冷面杀手"}, createdAt:1}]))`, ctx);
vm.runInContext(`showWriter();`, ctx);
const w1 = els["view"].innerHTML;
t("写卡网格", w1.includes("chargrid") && w1.includes("测试卡") && w1.includes("冷面杀手") && w1.includes("导出"));

// 8) 输入栏: 旁白按钮在输入框左侧
const bar = vm.runInContext(`chatbarInner(false)`, ctx);
t("旁白按钮在左", bar.indexOf('id="narrbtn"') < bar.indexOf('id="chat_in"'));
t("发送按钮在右", bar.indexOf('id="chat_in"') < bar.lastIndexOf("<button"));

console.log(`\nui24: ${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
