const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1-6: 轻量本地成就
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
};
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- 纯逻辑: 只加载 achieve.js ----
{
const ctx = {localStorage, console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/achieve.js", "utf8"), ctx, {filename: "achieve.js"});
const E = (c)=>vm.runInContext(c, ctx);
t("成就8个以上", E("RP_ACHV.DEFS.length") >= 8);
t("有循线者成就", E("RP_ACHV.list()").some(a=>a.id==="plotline_1" && a.name==="循线者"));
t("首次unlock返回true", E("RP_ACHV.unlock('first_chat')") === true);
t("重复unlock幂等false", E("RP_ACHV.unlock('first_chat')") === false);
t("未知id返回false", E("RP_ACHV.unlock('nope')") === false);
t("has", E("RP_ACHV.has('first_chat')") === true && E("RP_ACHV.has('tts_1')") === false);
t("count=1", E("RP_ACHV.count()") === 1);
t("存localStorage.nd_achv", !!store["nd_achv"] && JSON.parse(store["nd_achv"])["first_chat"] > 0);
const list = E("RP_ACHV.list()");
t("list长度", list.length === E("RP_ACHV.DEFS.length"));
t("list带解锁态", list[0].unlocked === true && list[1].unlocked === false);
t("list字段齐", list.every(a=>a.id && a.name && a.desc && a.icon));
}

// ---- app.js 接线: achvUnlock 弹 toast, showAchv 渲染 ----
function mkEl(){
const cls = new Set();
return {innerHTML: "", textContent: "", value: "", checked: false, tagName: "",
classList: {add(c){cls.add(c);}, remove(c){cls.delete(c);}, toggle(){}, contains(c){ return cls.has(c); }},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
}
const els = {};
const created = [];
const document = {
body: mkEl(),
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => {
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: () => [],
createElement: tag => {
const e = mkEl(); e.tagName = tag; created.push(e);
let _id = "";
Object.defineProperty(e, "id", {get: ()=>_id, set: v=>{ _id = v; els[v] = e; }});
Object.defineProperty(e, "className", {get: ()=>e._cn||"", set: v=>{ e._cn = v; }});
return e;
},
};
const DATA = {
index: [{run_id: "r1", novel: "红楼梦", characters: ["林黛玉"], n_chunks: 1}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "林黛玉", fields: {}}]},
};
const ctx = {localStorage, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/traverse.js", "rp/achieve.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);

// 清掉纯逻辑部分留下的解锁态, 测 toast 路径
delete store["nd_achv"];
vm.runInContext("achvUnlock('tts_1')", ctx);
const toastEl = els["achvToast"];
t("首次解锁建toast", !!toastEl);
t("toast内容有成就名", toastEl && toastEl.innerHTML.indexOf("聆听者") >= 0);
t("toast显示态", toastEl && toastEl.classList.contains("show"));
const htmlBefore = toastEl.innerHTML;
vm.runInContext("achvUnlock('tts_1')", ctx);
t("重复解锁不重复弹toast", els["achvToast"].innerHTML === htmlBefore);
// 成就页
const E2 = (c)=>vm.runInContext(c, ctx);
const defsLen = E2("RP_ACHV.DEFS.length");
vm.runInContext("showAchv()", ctx);
const html = els["view"].innerHTML;
t("成就页有标题", els["title"].textContent === "成就");
t("成就页有计数", els["sub"].textContent.indexOf("1/"+defsLen) >= 0);
t("成就页列出全部", (html.match(/class="card/g) || []).length === defsLen);
t("未解锁标未解锁", html.indexOf("未解锁") >= 0);

console.log(`achv: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
