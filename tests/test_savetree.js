const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1-5: 平行存档故事树
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false, tagName: "",
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
}
const els = {};
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
key: i => Object.keys(store)[i] || null,
get length(){ return Object.keys(store).length; },
};
const document = {
body: mkEl(),
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => {
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: () => [],
createElement: tag => { const e = mkEl(); e.tagName = tag; return e; },
};
const DATA = {
index: [{run_id: "r1", novel: "红楼梦", characters: ["林黛玉"], n_chunks: 1}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "林黛玉", fields: {}}]},
};
const promptQ = ["存档A", "存档B", "存档C"];
const ctx = {localStorage, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return promptQ.shift() || "存档"; },
setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/traverse.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);
/* #9: newSaveSlot 改为 async（含 confirmCheck 弹窗），测试里自动勾选 */
vm.runInContext("confirmCheck = async ()=>true;", ctx);

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

/* #9: newSaveSlot 为 async，测试体包进 async main */
async function main(){

vm.runInContext(`CHAT = {mode:"single", runId:"r1", name:"林黛玉", members:[], narrMode:false, asSpeaker:null}`, ctx);
vm.runInContext("var __now = 1000000; Date.now = ()=>__now += 1000;", ctx);
const SKEY = "nd_saves_nd_chat_r1_林黛玉";
const HKEY = "nd_chat_r1_林黛玉";
store[HKEY] = JSON.stringify([{role:"user", content:"hi", ts:1}]);
// 屏蔽 showChat(只测分支逻辑)
vm.runInContext("showChat = ()=>{ window.__showChatCalled = true; };", ctx);

// ---- 旧存档(无 parentId)按平铺显示 ----
store[SKEY] = JSON.stringify([
{id: 1, name: "旧1", ts: 100, history: [], mem: null},
{id: 2, name: "旧2", ts: 200, history: [], mem: null},
]);
const tree0 = vm.runInContext("saveTree()", ctx);
t("旧存档全是根", tree0.roots.length === 2 && Object.keys(tree0.children).length === 0);

// ---- 新建存档: 无分支源 -> parentId null, 并成为分支源 ----
await vm.runInContext("newSaveSlot()", ctx);
let saves = JSON.parse(store[SKEY]);
const A = saves[saves.length-1];
t("首存档parentId null", A.parentId === null);
t("首存档成名分支源", vm.runInContext("getBranchSrc()['" + HKEY + "']", ctx) === A.id);
// ---- 再存: parentId 指向上一个 ----
await vm.runInContext("newSaveSlot()", ctx);
saves = JSON.parse(store[SKEY]);
const B = saves[saves.length-1];
t("连续存档形成父子链", B.parentId === A.id);
const tree1 = vm.runInContext("saveTree()", ctx);
t("树: A是B的父", (tree1.children[A.id]||[]).length === 1 && tree1.children[A.id][0].id === B.id);
t("树: 根剩3个(旧1旧2A)", tree1.roots.length === 3);
// ---- 加载 A 后再存 -> 从 A 分叉 ----
vm.runInContext("loadSaveSlot(" + A.id + ")", ctx);
t("加载后分支源=A", vm.runInContext("getBranchSrc()['" + HKEY + "']", ctx) === A.id);
await vm.runInContext("newSaveSlot()", ctx);
saves = JSON.parse(store[SKEY]);
const C = saves[saves.length-1];
t("加载后存档从A分叉", C.parentId === A.id);
const tree2 = vm.runInContext("saveTree()", ctx);
t("A有两个子分支", (tree2.children[A.id]||[]).length === 2);
// ---- 悬空 parentId 按根处理 ----
saves.push({id: 999, name: "孤儿", ts: 50, parentId: "ghost", history: [], mem: null});
store[SKEY] = JSON.stringify(saves);
const tree3 = vm.runInContext("saveTree()", ctx);
t("悬空parentId按根平铺", tree3.roots.some(s=>s.id===999));
// ---- 渲染: 树形连线 + 分支徽标 ----
vm.runInContext("renderSaves()", ctx);
const html = els["view"].innerHTML;
t("渲染有连线", html.indexOf("├─") >= 0 || html.indexOf("└─") >= 0);
t("渲染有分支徽标", html.indexOf(">分支<") >= 0);
t("渲染有缩进", html.indexOf("margin-left:20px") >= 0 || html.indexOf("margin-left:40px") >= 0);

console.log(`savetree: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
}
main().catch(e=>{ console.error(e); process.exit(1); });
