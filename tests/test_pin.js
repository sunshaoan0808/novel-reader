const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1-7: 纯前端 PIN 应用锁
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
// ---- 纯逻辑: 只加载 pinlock.js ----
const ctx = {localStorage, console, crypto: require("crypto").webcrypto, TextEncoder};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/pinlock.js", "utf8"), ctx, {filename: "pinlock.js"});
const E = (c)=>vm.runInContext(c, ctx);
t("初始无PIN", E("RP_PIN.has()") === false);
t("validPin 4位数字", E("RP_PIN.validPin('1234')") === true);
t("validPin 拒绝3位", E("RP_PIN.validPin('123')") === false);
t("validPin 拒绝字母", E("RP_PIN.validPin('abcd')") === false);
t("validPin 拒绝5位", E("RP_PIN.validPin('12345')") === false);
let threw = await E("(async()=>{ try{ await RP_PIN.set('12'); return false; }catch(e){ return true; } })()");
t("非法PIN set抛错", threw === true);
await E("RP_PIN.set('1234')");
t("set后has", E("RP_PIN.has()") === true);
t("默认SHA-256", E("RP_PIN.alg()") === "sha256");
t("存nd_pin", !!store["nd_pin"]);
t("正确PIN验证", (await E("RP_PIN.verify('1234')")) === true);
t("错误PIN验证", (await E("RP_PIN.verify('0000')")) === false);
const s1 = JSON.parse(store["nd_pin"]).salt;
await E("RP_PIN.set('1234')");
t("salt随机不复用", JSON.parse(store["nd_pin"]).salt !== s1);
// 5次锁定
t("初始剩余5次", E("RP_PIN.failsLeft()") === 5);
for(let i = 0; i < 4; i++) E("RP_PIN.fail()");
t("4次后剩1次", E("RP_PIN.failsLeft()") === 1);
t("未锁定", E("RP_PIN.lockRemain()") === 0);
const r5 = E("RP_PIN.fail()");
t("第5次触发锁定", r5.locked === true);
t("锁定剩余约1分钟", E("RP_PIN.lockRemain()") > 50000 && E("RP_PIN.lockRemain()") <= 60000);
t("锁定后失败计数清零", E("RP_PIN.failsLeft()") === 5);
E("RP_PIN.resetFails()");
t("reset解除锁定", E("RP_PIN.lockRemain()") === 0);
E("RP_PIN.clear()");
t("clear后无PIN", E("RP_PIN.has()") === false);

// ---- app.js 接线 ----
function mkEl(){
const cls = new Set();
const e = {innerHTML: "", textContent: "", value: "", checked: false, tagName: "",
classList: {add(c){cls.add(c);}, remove(c){cls.delete(c);}, toggle(){}, contains(c){ return cls.has(c); }},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(a, v){ e["attr_"+a] = v; }, getAttribute(a){ return e["attr_"+a]; }, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
let _id = "";
Object.defineProperty(e, "id", {get: ()=>_id, set: v=>{ _id = v; }});
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
index: [{run_id: "r1", novel: "红楼梦", characters: ["林黛玉"], n_chunks: 1}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "林黛玉", fields: {}}]},
};
const ctx2 = {localStorage, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
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
// 无PIN: 直接通过
t("无PIN直接resolve true", (await vm.runInContext("pinUnlockScreen()", ctx2)) === true);
// 设置PIN后: 出现锁屏遮罩
await vm.runInContext("RP_PIN.set('5678')", ctx2);
const p = vm.runInContext("pinUnlockScreen()", ctx2);
await new Promise(r => setTimeout(r, 50));
t("锁屏加pinlocked类", document.body.classList.contains("pinlocked"));
// renderPinSettings
vm.runInContext("document.getElementById('view').innerHTML='<div id=\"pinset\"></div>'; renderPinSettings();", ctx2);
t("设置页显示已开启", els["pinset"].innerHTML.indexOf("已开启") >= 0);
await vm.runInContext("RP_PIN.clear()", ctx2);
vm.runInContext("renderPinSettings()", ctx2);
t("未设PIN显示设置入口", els["pinset"].innerHTML.indexOf("pin_new1") >= 0);

console.log(`pin: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
