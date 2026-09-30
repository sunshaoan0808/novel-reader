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
const DATA = {index:[{run_id:"r1",novel:"红楼梦",characters:["林黛玉","贾宝玉","薛宝钗","王熙凤","贾母","晴雯"],n_chunks:10}],
  runs:{r1:{run_id:"r1", novel:"红楼梦", worldbook:[], relations:[], profiles:[]}}, rp_cards:{}};
const window = {__DATA__: DATA};
const ctx = {localStorage: ls, document, console, alert(){}, confirm(){return true;}, prompt(){return null;},
  setTimeout:()=>0, clearTimeout(){}, fetch:()=>Promise.reject(new Error("no net"))};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of ["icons.js","rp/prompt.js","rp/persona.js","rp/memory.js","rp/tasks.js","rp/cardwriter.js",
                "rp/ooc.js","rp/chat.js","rp/group.js","rp/cardexport.js","app.js"]){
  vm.runInContext(fs.readFileSync("assets/www/"+f,"utf8"), ctx, {filename:f});
}
const css = fs.readFileSync("assets/www/style.css","utf8");
const wrap = (body)=>`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="chatmode">${body}</body></html>`;

// ---- 1. 聊天页: 渲染真实 renderChat 需要历史, 这里直接拼模板片段 ----
vm.runInContext(`
CHAT = {mode:"single", runId:"r1", name:"林黛玉", narrMode:false, asSpeaker:null, scenario:null};
RUN = {run_id:"r1", novel:"红楼梦"};
localStorage.setItem("nd_api_cfg_v1", JSON.stringify({key:"k",base:"b",model:"m"}));
showChat({key:"k"});
`, ctx);
let viewHTML = els["view"].innerHTML;
// 注入几条消息(含工具条展开态)到 chatlog
const I = vm.runInContext("icon", ctx);
const msgs = [
 ["", "林黛玉", "宝玉，你可曾去过潇湘馆？那里的竹子长得正好。", ""],
 ["me", "我", "去过的，满院子的竹子，风一吹沙沙作响。", ""],
 ["", "林黛玉", "我就喜欢那份清净。只是近来身子不大爽利，咳了几回。", "show-tools"],
].map(m=>`<div class="msg ${m[0]} ${m[3]}"><div class="avatar sm">${m[0]==="me"?"我":"黛"}</div><div><div class="who">${m[1]}</div><div class="bubble">${m[2]}</div>`
 + (m[3]?`<div class="msgtools"><button class="on">${I("thumb-up",15)}</button><button>${I("thumb-down",15)}</button><button>${I("volume",15)}</button><button>复制</button><button>↻ 重生</button><button>删除</button></div>`:"")
 + `</div></div>`).join("");
viewHTML = viewHTML.replace('<div id="chatlog"></div>', `<div id="chatlog">${msgs}<div class="ctxlore">${I("book-open",14)} 触发：潇湘馆异象、大观园居住规矩</div></div>`);
fs.writeFileSync("/tmp/icon_chat.html", wrap(`<div id="app"><div id="view">${viewHTML}</div></div>`));

// ---- 2. 角色网格页 ----
const grid = vm.runInContext(`
["林黛玉","贾宝玉","薛宝钗","王熙凤","贾母","晴雯"].map(n=>charCardHTML({name:n, novel:"红楼梦", desc:"红楼梦主要人物，性格鲜明，才情出众。", oncard:"void 0"})).join("")
`, ctx);
fs.writeFileSync("/tmp/icon_grid.html", wrap(`<div id="app"><div id="view"><div class="chargrid">${grid}</div></div></div>`));

// ---- 3. 群聊抽屉打开态 ----
vm.runInContext(`
CHAT = {mode:"group", runId:"r1", name:null, members:["贾宝玉","林黛玉","薛宝钗"], forcedSpeaker:"林黛玉", pov:"player", person:"second"};
showGroupChat({key:"k"});
`, ctx);
const gview = els["view"].innerHTML.replace('class="drawer"', 'class="drawer on"').replace('class="scrim"', 'class="scrim on"');
fs.writeFileSync("/tmp/icon_drawer.html", wrap(`<div id="app"><div id="view">${gview}</div></div>`));

console.log("mock pages written");
