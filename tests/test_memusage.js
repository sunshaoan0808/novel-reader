const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1-8: 长期记忆库用量条 (memStats + 相册顶部用量条 + Pin 30 软提示)
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
clear: () => { for(const k in store) delete store[k]; },
};
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

(async () => {
// ---- 纯逻辑: memStats ----
const ctx = {localStorage, console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/memory.js", "utf8"), ctx, {filename: "memory.js"});
const E = (c)=>vm.runInContext(c, ctx);
let s = E("RP_MEM.memStats('r1','n1')");
t("空库全0", s.events === 0 && s.pinned === 0 && s.shortN === 0 && s.longN === 0);
t("shortMax=30", s.shortMax === 30);
t("pinMax=30", s.pinMax === 30);
E(`RP_MEM.save('r1','n1',{short:[
{id:1,time:'t',fact:'a',pin:true},{id:2,time:'t',fact:'b',pin:true},{id:3,time:'t',fact:'c'}
], long:'久远印象'})`);
s = E("RP_MEM.memStats('r1','n1')");
t("事件数3", s.events === 3);
t("Pin数2", s.pinned === 2);
t("short条数3", s.shortN === 3);
t("long条数1", s.longN === 1);

// ---- app.js: 相册用量条渲染 ----
function mkEl(){
const cls = new Set();
const e = {innerHTML: "", textContent: "", value: "", checked: false, tagName: "",
classList: {add(c){cls.add(c);}, remove(c){cls.delete(c);}, toggle(){}, contains(c){ return cls.has(c); }},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
let _ih = "";
Object.defineProperty(e, "innerHTML", {get: ()=>_ih, set: v=>{ _ih = String(v); }});
return e;
}
const els = {};
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
index: [{run_id: "r1", novel: "红楼梦", characters: ["n1"], n_chunks: 1}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "n1", fields: {}}]},
};
const alerts = [];
const ctx2 = {localStorage, document, console,
alert(m){ alerts.push(String(m)); }, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2, location: {reload(){}}};
ctx2.window = ctx2; ctx2.globalThis = ctx2; ctx2.__DATA__ = DATA;
vm.createContext(ctx2);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/traverse.js", "rp/achieve.js", "rp/pinlock.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx2, {filename: f});
}
vm.runInContext("openAlbum('r1','n1')", ctx2);
let html = els["view"].innerHTML;
t("相册有用量条", html.indexOf("mu-bar") >= 0);
t("用量条数字 3/30", html.indexOf("长期记忆 3/30") >= 0);
t("用量条置顶 2/30", html.indexOf("置顶 2/30") >= 0);
t("用量条长远印象 1/1", html.indexOf("长远印象 1/1") >= 0);
t("用量条宽度10%", html.indexOf("width:10%") >= 0);
t("未达30无软提示", html.indexOf("建议整理") < 0);
// 造 30 条置顶
const many = [];
for(let i = 0; i < 30; i++) many.push({id: 100+i, time: "t", fact: "f"+i, pin: true});
vm.runInContext("RP_MEM.save('r1','n1',{short:" + JSON.stringify(many) + "})", ctx2);
vm.runInContext("openAlbum('r1','n1')", ctx2);
html = els["view"].innerHTML;
t("30置顶显示软提示", html.indexOf("置顶已达 30 条") >= 0);
t("软提示说不禁止", html.indexOf("不会禁止继续置顶") >= 0);
t("置顶徽标图标已渲染(无字面量)", html.indexOf('${icon(') < 0);
t("置顶徽标有badge", html.indexOf('badge warn') >= 0);
// memPin 达到30时弹一次提醒
vm.runInContext("RP_MEM.save('r1','n1',{short:" + JSON.stringify(
Array.from({length:29},(_,i)=>({id:200+i,time:"t",fact:"f"+i,pin:true}))
.concat([{id:999,time:"t",fact:"new"}])) + "})", ctx2);
vm.runInContext("openAlbum('r1','n1')", ctx2);
alerts.length = 0;
vm.runInContext("memPin(999)", ctx2);
t("第30个置顶弹提醒", alerts.some(a=>a.indexOf("已达 30 条") >= 0 && a.indexOf("只是提醒") >= 0));
t("提醒后仍可置顶(不禁止)", vm.runInContext("RP_MEM.memStats('r1','n1').pinned", ctx2) === 30);

console.log(`memusage: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
