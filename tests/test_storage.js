const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P0-5: 本地存储用量可视化
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
createElement: tag => mkEl(),
};
const DATA = {index: [], runs: {}, rp_cards: {}};
const ctx = {localStorage, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){}, fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/traverse.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);
vm.runInContext("INDEX = window.__DATA__.index", ctx);

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- 播种已知数据 ----
const seed = {
"nd_chat_r1_林黛玉": "x".repeat(1000),
"nd_group_r1_a_b": "y".repeat(500),
"nd_travchat_t1": "z".repeat(200),
"nd_mem2_r1_林黛玉": "m".repeat(300),
"nd_lore_r1": "l".repeat(400),
"nd_custom_chars": "c".repeat(100),
"nd_persona_global": "p".repeat(50),
"nd_api_cfg_v1": "k".repeat(20),
};
Object.keys(seed).forEach(k => { store[k] = seed[k]; });

const su = vm.runInContext("storageUsage()", ctx);
// 实际字节量 (UTF-16)
let expect = 0;
Object.keys(seed).forEach(k => { expect += (k.length + seed[k].length) * 2; });
const err = Math.abs(su.total - expect) / expect;
t("统计总量误差<5%", err < 0.05);
t("总量精确", su.total === expect);

const g = {};
su.groups.forEach(x => { g[x.label] = x; });
const gb = (label, keys) => {
let e = 0;
keys.forEach(k => { e += (k.length + seed[k].length) * 2; });
return g[label] && g[label].bytes === e;
};
t("单聊历史分组", gb("单聊历史", ["nd_chat_r1_林黛玉"]));
t("群聊历史分组", gb("群聊历史", ["nd_group_r1_a_b"]));
t("穿越数据分组", gb("穿越数据", ["nd_travchat_t1"]));
t("记忆事件簿分组", gb("记忆事件簿", ["nd_mem2_r1_林黛玉"]));
t("世界书分组", gb("世界书", ["nd_lore_r1"]));
t("角色卡分组", gb("角色卡", ["nd_custom_chars"]));
t("人设与正则分组", gb("人设与正则", ["nd_persona_global"]));
t("配置与其他分组", gb("配置与其他", ["nd_api_cfg_v1"]));
t("空分组被过滤", su.groups.every(x => x.keys > 0));

// ---- 渲染卡片 ----
const card = vm.runInContext("renderStorageCard()", ctx);
t("卡片有标题", card.indexOf("本地存储用量") >= 0);
t("卡片显示2GB配额", card.indexOf("2 GB") >= 0);
t("卡片有大文件存储行", card.indexOf("fileline") >= 0 && card.indexOf("上限 2GB") >= 0);
t("卡片有分组行", card.indexOf("单聊历史") >= 0 && card.indexOf("记忆事件簿") >= 0);
t("卡片复用clearChat", card.indexOf("clearChat()") >= 0);
t("卡片复用wipeAll", card.indexOf("wipeAll()") >= 0);
t("未超80%无告警", card.indexOf("空间告急") < 0);

// ---- fmtBytes ----
t("fmtBytes B", vm.runInContext("fmtBytes(500)", ctx) === "500 B");
t("fmtBytes KB", vm.runInContext("fmtBytes(2048)", ctx) === "2.0 KB");
t("fmtBytes MB", vm.runInContext("fmtBytes(5*1024*1024)", ctx) === "5.00 MB");
t("fmtBytes GB", vm.runInContext("fmtBytes(2*1024*1024*1024)", ctx) === "2.00 GB");
t("配额常量2GB", vm.runInContext("ND_QUOTA_BYTES", ctx) === 2*1024*1024*1024);

// ---- 80% 告警（临时调小 localStorage 配额，确定性触发；5MB 下小用量不该告警） ----
const cardNoWarn = vm.runInContext("renderStorageCard()", ctx);
t("5MB配额下小用量无告警", cardNoWarn.indexOf("空间告急") < 0);
t("卡片有5MB本地存储行", cardNoWarn.indexOf("上限 5MB") >= 0);
vm.runInContext("ND_LS_QUOTA_BYTES = 1024", ctx); // 1KB 配额，种子约 5KB，必超 80%
const card2 = vm.runInContext("renderStorageCard()", ctx);
t("超80%显示告警", card2.indexOf("空间告急") >= 0);
t("超80%进度条warn", card2.indexOf("storbar-fg warn") >= 0);
vm.runInContext("ND_LS_QUOTA_BYTES = 5*1024*1024", ctx); // 还原

// ---- 设置页顶部挂载 ----
vm.runInContext("showSettings()", ctx);
t("设置页顶部是存储卡", els["view"].innerHTML.indexOf("本地存储用量") >= 0 &&
els["view"].innerHTML.indexOf("本地存储用量") < els["view"].innerHTML.indexOf("大模型接口"));

console.log(`storage: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
