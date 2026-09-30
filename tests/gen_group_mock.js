const fs = require("fs"), vm = require("vm");
const els = {};
function mkEl(){ return {innerHTML:"", textContent:"", value:"", classList:{add(){},remove(){},toggle(){}},
  querySelectorAll(){return [];}, querySelector(){return null;}, addEventListener(){}, scrollTo(){}, style:{},
  closest(){return null;}, remove(){}, insertAdjacentHTML(){}, setAttribute(){}, removeAttribute(){}}; }
const ls = (function(){ const m={}; return {
  getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
  key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
const document = {body: mkEl(), getElementById:id=>els[id]||(els[id]=mkEl()),
  querySelector:(sel)=>{const id=String(sel).replace("#","");return els[id]||(els[id]=mkEl());},
  createElement:()=>mkEl()};
const DATA = {index:[{run_id:"r1",novel:"红楼梦",characters:["贾宝玉","林黛玉","薛宝钗"],n_chunks:10}],
  runs:{r1:{run_id:"r1", novel:"红楼梦", worldbook:[], relations:[], profiles:[]}}, rp_cards:{}};
const window = {__DATA__: DATA};
const ctx = {localStorage: ls, document, console, alert(){}, confirm(){return true;}, prompt(){return null;},
  setTimeout:(fn)=>0, clearTimeout(){}, fetch:()=>Promise.reject(new Error("no net"))};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of ["icons.js","rp/prompt.js","rp/persona.js","rp/memory.js","rp/tasks.js","rp/cardwriter.js",
                "rp/ooc.js","rp/chat.js","rp/group.js","rp/cardexport.js","app.js"]){
  vm.runInContext(fs.readFileSync("assets/www/"+f,"utf8"), ctx, {filename:f});
}
// 群聊场景
vm.runInContext(`
CHAT = {mode:"group", runId:"r1", name:null, members:["贾宝玉","林黛玉","薛宝钗"], forcedSpeaker:null, pov:"player", person:"second"};
RUN = {run_id:"r1", novel:"红楼梦"};
localStorage.setItem("nd_talk_r1_林黛玉","80");
RP_GROUP.setOrder("r1","${["贾宝玉","林黛玉","薛宝钗"].sort().join("_")}","natural");
showGroupChat({key:"k"});
`, ctx);

const viewHTML = els["view"].innerHTML;
const css = fs.readFileSync("assets/www/style.css","utf8");
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body class="chatmode"><div id="app"><div id="view">${viewHTML}</div></div>
<script>document.querySelector(".scrim").style.display="block";document.querySelector(".drawer").classList.add("open");</script>
</div></body></html>`;
fs.writeFileSync("/tmp/group_mock.html", html);
// 断言关键元素存在
const checks = ["发言顺序","自然发言","按序轮流","发言欲",'type="range"',"80","群聊成员","下一个说"];
let ok = true;
for(const c of checks){ if(!viewHTML.includes(c)){ console.log("MISS:", c); ok = false; } }
console.log("drawer checks:", ok ? "all present" : "MISSING");
// 抽屉强制打开态再存一份
const html2 = html.replace("</body>", "<style>.drawer{transform:none!important;}.scrim{display:block!important;}</style></body>");
fs.writeFileSync("/tmp/group_mock_open.html", html2);
console.log("written /tmp/group_mock_open.html");
