const fs = require("fs"), vm = require("vm");
const els = {};
function mkEl(){ return {innerHTML:"", textContent:"", value:"", classList:{add(){},remove(){},toggle(){}},
  querySelectorAll(){return [];}, addEventListener(){}, scrollTo(){}, style:{}}; }
const ls = (function(){ const m={}; return {
  getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
  key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
const document = {body: mkEl(), getElementById:id=>els[id]||(els[id]=mkEl()),
  querySelector:(sel)=>{const id=String(sel).replace("#","");return els[id]||(els[id]=mkEl());}, createElement:()=>mkEl()};
const DATA = {index:[{run_id:"r1",novel:"测试小说",characters:["阿绫"],n_chunks:10}],
  runs:{r1:{run_id:"r1", novel:"测试小说", worldbook:[], relations:[], profiles:[]}}, rp_cards:{}};
const window = {__DATA__: DATA};
const ctx = {localStorage: ls, document, console, alert(){}, confirm(){return true;}, prompt(){return null;}, setTimeout, clearTimeout};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("assets/www/rp/cardwriter.js","utf8"), ctx);
vm.runInContext(`localStorage.setItem("nd_api_cfg_v1", JSON.stringify({key:"k",base:"b",model:"m"}));`, ctx);
vm.runInContext(fs.readFileSync("assets/www/icons.js","utf8"), ctx);
vm.runInContext(fs.readFileSync("assets/www/app.js","utf8"), ctx);

// 真实模板输出
const MODE = process.env.MOCK_MODE || "single";
vm.runInContext(`CHAT = {mode:"${MODE}", runId:"r1", name:"${MODE==="group"?"群聊":"阿绫"}", narrMode:false, asSpeaker:null, scenario:null, members:["阿绫","老白"]}; renderScenChips();`, ctx);
const scenHTML = els["scenbar"].innerHTML;
const barHTML = vm.runInContext(`chatbarInner(false)`, ctx);

const msgs = [
  ["", "阿绫", "公子，今晚月色正好，要不要出去走走？"],
  ["me", "我", "好啊，去湖边吧。"],
  ["", "阿绫", "湖边的柳树都发芽了，风一吹，柳絮像雪一样。公子你看——"],
  ["me", "我", "确实很美。你最近剑法练得如何？"],
  ["", "阿绫", "师父说我火候还差些，不过昨天我已经能连出七剑了！"],
  ["me", "我", "厉害，继续加油。"],
  ["", "阿绫", "嗯！等我练成了，就能保护公子了。"],
].map(m=>`<div class="msg ${m[0]}"><div class="avatar sm">${m[0]==="me"?"我":"阿"}</div><div><div class="who">${m[1]}</div><div class="bubble">${m[2]}</div></div></div>`).join("");

const css = fs.readFileSync("assets/www/style.css","utf8");
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body class="chatmode"><div id="app"><div id="view">
<div class="chathead" id="chathead">
<button class="backbtn">‹</button>
<div class="avatar">阿</div>
<div class="chead-main"><div class="cname">阿绫</div>
<div class="cstat"><span>测试小说</span><button><span class="mement">🧠 3条记忆</span>›</button></div></div>
<button class="menubtn">⋯</button>
</div>
<div class="chatwrap">
<div id="chatlog">${msgs}</div>
<div id="scenbar" class="scenbar">${scenHTML}</div>
<div class="chatbar">${barHTML}</div>
</div>
</div></div></body></html>`;
fs.writeFileSync("/tmp/chat_mock.html", html);
console.log("mode="+MODE,"chips:",(scenHTML.match(/scenchip/g)||[]).length,"| narrbtn first:",barHTML.indexOf("narrbtn")<barHTML.indexOf("chat_in"));
