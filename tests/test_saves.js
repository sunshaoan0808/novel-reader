const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// app.js: 平行存档（新建/加载/改名/删除），localStorage + 函数桩
const src = fs.readFileSync(WWW+"/app.js", "utf8");
function extract(src, name){
  const pats = [
    "function\\s+"+name+"\\s*\\(",
    "(?:let|const|var)\\s+"+name+"\\s*=\\s*function\\s*\\(",
    name+"\\s*=\\s*\\([^)]*\\)\\s*=>",
    "window\\."+name+"\\s*=\\s*\\([^)]*\\)\\s*=>",
    /* #9: newSaveSlot 改为 async 箭头函数 */
    name+"\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>",
    "window\\."+name+"\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>",
  ];
  for(const p of pats){
    const m = src.match(new RegExp(p));
    if(!m) continue;
    let j = src.indexOf("{", m.index), depth = 0;
    for(let k = j; k < src.length; k++){
      if(src[k] === "{") depth++;
      else if(src[k] === "}"){ depth--; if(!depth) return src.slice(m.index, k+1); }
    }
  }
  throw new Error("not found: " + name);
}
const store = {};
const localStorage = {
  getItem: (k)=> (k in store ? store[k] : null),
  setItem: (k, v)=>{ store[k] = String(v); },
  removeItem: (k)=>{ delete store[k]; },
};
const histDB = {};
let savedPlot = "unset";
const ctx = {
  console, localStorage,
  CHAT: {mode:"single", runId:"r1", name:"阿绫", members:[]},
  chatHistKey: ()=>"nd_chat_r1_阿绫",
  getHist: (k)=> histDB[k] ? JSON.parse(JSON.stringify(histDB[k])) : [],
  saveHist: (k, h)=>{ histDB[k] = JSON.parse(JSON.stringify(h)); },
  RP_MEM: {get: ()=>"MEMSTATE", save: ()=>{}},
  getPlot: ()=>null,
  savePlot: (p)=>{ savedPlot = p; },
  prompt: (msg, def)=>"测试存档",
  confirm: ()=>true,
  confirmCheck: async ()=>true, /* #9: 存档确认弹窗在测试里自动勾选 */
  alert: ()=>{},
  renderSaves: ()=>{}, showChat: ()=>{},
  titleEl: {}, subEl: {}, view: {},
  BRANCH_KEY: "nd_branchsrc",
  achvUnlock: ()=>{},
};
vm.createContext(ctx);
for(const f of ["savesKey","getSaves","getBranchSrc","setBranchSrc","newSaveSlot","loadSaveSlot","delSaveSlot","renameSaveSlot"])
  vm.runInContext(extract(src, f), ctx);
// window.X 赋值需要挂到 ctx.window
ctx.window = ctx;
vm.runInContext("window.newSaveSlot = newSaveSlot; window.loadSaveSlot = loadSaveSlot; window.delSaveSlot = delSaveSlot; window.renameSaveSlot = renameSaveSlot;", ctx);
const E = (code)=>vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

/* #9: newSaveSlot 改为 async（含 confirmCheck 弹窗），测试体包进 async main */
async function main(){
t("empty at first", E("getSaves()").length === 0);

E(`saveHist("nd_chat_r1_阿绫", [{role:"user",content:"hi"},{role:"assistant",content:"你好"}])`);
await E("newSaveSlot()");
let ss = E("getSaves()");
t("new slot saved", ss.length === 1 && ss[0].name === "测试存档");
t("slot captures history", ss[0].history.length === 2);
t("slot captures mem", ss[0].mem === "MEMSTATE");
t("slot has ts", typeof ss[0].ts === "number");

// 改历史后再加载，应恢复
E(`saveHist("nd_chat_r1_阿绫", [{role:"user",content:"changed"}])`);
t("history changed", E(`getHist("nd_chat_r1_阿绫")`).length === 1);
E(`loadSaveSlot(${ss[0].id})`);
const restored = E(`getHist("nd_chat_r1_阿绫")`);
t("load restores history", restored.length === 2 && restored[1].content === "你好");
t("load clears plot", savedPlot === null || JSON.stringify(savedPlot) === "{}");

// 改名
ctx.prompt = ()=>"新名字";
E(`renameSaveSlot(${ss[0].id})`);
t("rename works", E("getSaves()")[0].name === "新名字");

// 删除
E(`delSaveSlot(${ss[0].id})`);
t("delete works", E("getSaves()").length === 0);

// prompt 取消不建档
ctx.prompt = ()=>null;
await E("newSaveSlot()");
t("prompt cancel no slot", E("getSaves()").length === 0);

// savesKey 按聊天隔离
t("savesKey scoped", E("savesKey()") === "nd_saves_nd_chat_r1_阿绫");

// P1-5: parentId 分支链
ctx.prompt = ()=>"分支存档";
await E("newSaveSlot()");
await E("newSaveSlot()");
const chain = E("getSaves()");
t("首存档parentId null", chain[0].parentId === null);
t("次存档parentId指向上一个", chain[1].parentId === chain[0].id);
// 删除分支源 -> 分支源记录被清理
E(`delSaveSlot(${chain[1].id})`);
t("删分支源后清理记录", E("getBranchSrc()['nd_chat_r1_阿绫']") === undefined);

console.log(`\nsaves: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
}
main().catch(e=>{ console.error(e); process.exit(1); });
