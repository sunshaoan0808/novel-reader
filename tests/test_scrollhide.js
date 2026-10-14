const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 回归: 滚动体验三件套
// 1) 上滑看历史时, 流式/打字机/重渲染不得强制拽回底部(持续抖动根因)
// 2) 下滑时底栏(输入条)跟随顶栏一起隐藏, 上滑/回顶恢复
// 3) 显隐切换加迟滞, 阈值附近不反复横跳
function mkEl(){
/* P1-12: 记录 addEventListener 绑定，测试用 __fire(type) 触发（app 已改 addEventListener，不再用 onscroll 属性） */
const _listeners = {};
const el = {innerHTML: "", textContent: "", value: "", checked: false,
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(type, fn){ (_listeners[type] = _listeners[type] || []).push(fn); },
removeEventListener(type, fn){ const a = _listeners[type]; if(a){ const i = a.indexOf(fn); if(i >= 0) a.splice(i, 1); } },
__fire(type){ const a = _listeners[type] || []; const ev = {target: el, touches: [{clientX: 180, clientY: 400}], changedTouches: [{clientX: 180, clientY: 400}], clientX: 180, clientY: 400, stopPropagation(){}, preventDefault(){} }; a.slice().forEach(fn=>{ try{ fn(ev); }catch(e){} }); },
appendChild(){}, remove(){},
insertAdjacentHTML(pos, html){ /* 测试里按需覆写 */ },
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
return el;
}
const els = {};
const ls = (function(){ const m = {}; return {
getItem: k => (k in m? m[k]: null),
setItem: (k, v) => { m[k] = String(v);},
removeItem: k => { delete m[k];},
key: i => Object.keys(m)[i] || null,
get length(){ return Object.keys(m).length;}};})();
let capturedInterval = null;
const document = {
body: mkEl(),
activeElement: null,
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => {
if(sel === ".chatbar") return els["__chatbar"] || (els["__chatbar"] = mkEl());
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: () => [],
createElement: () => mkEl(),
  addEventListener(){},   /* P0-1: attachHeadHide 挂了 document 级键盘恢复钩子；本测试不覆盖，走浏览器 E2E */
};
const ctx = {localStorage: ls, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){},
setInterval: (fn)=>{ capturedInterval = fn; return 1; }, clearInterval(){},
fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/escutil.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "rp/traverse2.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW+"/" + f, "utf8"), ctx, {filename: f});
}
let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n)); };
const run = (code)=> vm.runInContext(code, ctx);

// ---------- chatNearBottom ----------
els["chatlog"] = mkEl();
Object.assign(els["chatlog"], {scrollHeight: 3000, scrollTop: 2400, clientHeight: 600});
t("nearBottom: 底部附近为true", run("chatNearBottom()") === true);
els["chatlog"].scrollTop = 100;
t("nearBottom: 上滑看历史为false", run("chatNearBottom()") === false);
delete els["chatlog"];
const _origGet = document.getElementById;
document.getElementById = ()=>null;
t("nearBottom: 无chatlog默认true", run("chatNearBottom()") === true);
document.getElementById = _origGet;

// ---------- attachHeadHide: v52 点按式沉浸 ----------
// 进页即隐藏（display:none + body.immersive）；点按呼出；滑动|Δ|>8 再藏；
// 隐藏时滚动不再反复触发；输入聚焦时不藏。
(function(){
const head = mkEl();
const bar = mkEl();
const log = mkEl();
Object.assign(log, {scrollHeight: 3000, scrollTop: 2400, clientHeight: 600}); /* 初始钉在底部 */
els["chathead"] = head; els["chatlog"] = log; els["__chatbar"] = bar;
const sim = mkEl(); els["simbar"] = sim; /* 世界模拟条 */
const bodyToggles = [];
document.body = {classList: {add(){}, remove(){}, toggle(c, on){ bodyToggles.push([c, !!on]); }, contains(){ return false; }}};
document.activeElement = null;
run("attachHeadHide()");
const scrollTo = (st)=>{ log.scrollTop = st; log.__fire("scroll"); };
const lastImmersive = ()=> bodyToggles.filter(x=>x[0]==="immersive").pop();

t("init: 进页即沉浸隐藏顶栏", head.style.display === "none");
t("init: 进页即沉浸隐藏底栏", bar.style.display === "none");
t("init: 进页即沉浸隐藏世界条", sim.style.display === "none");
t("init: body挂immersive", lastImmersive()[1] === true);

run("window.__setHeadHidden(false)"); /* 点按呼出 */
t("show: 点按呼出顶栏", head.style.display === "");
t("show: 点按呼出底栏", bar.style.display === "");
t("show: 摘immersive", lastImmersive()[1] === false);

scrollTo(2000); /* 上滑 |Δ|=400>8 -> 隐藏 */
t("hide: 滑动隐藏顶栏", head.style.display === "none");
t("hide: 滑动隐藏底栏", bar.style.display === "none");
t("hide: 世界条跟随隐藏", sim.style.display === "none");
t("hide: body挂immersive", lastImmersive()[1] === true);

scrollTo(1900); /* 已隐藏时再滑：保持隐藏，不反复触发 */
t("hidden: 隐藏中滚动保持隐藏", head.style.display === "none");

run("window.__setHeadHidden(false)"); /* 再次呼出 */
scrollTo(1905); /* 相对上次位置 |Δ|=5<=8 -> 不隐藏 */
t("thresh: 8px内抖动不隐藏", head.style.display === "");

/* 输入聚焦时不藏（键盘弹起时） */
run("window.__setHeadHidden(false)"); /* 确保先呼出 */
document.activeElement = {tagName: "INPUT"};
scrollTo(1500); /* |Δ|=405>8，但输入中 -> 不藏 */
t("typing: 输入时不藏顶栏", head.style.display === "");
t("typing: 输入时不藏底栏", bar.style.display === "");
document.activeElement = null;
})();

// ---------- v52 点按沉浸: 布局沉降抖动(±84px)的回归 ----------
// 进页即沉浸隐藏；呼出后，8px 内的抖动不隐藏、超 8px 的滑动隐藏。
(function(){
const head3 = mkEl();
const bar3 = mkEl();
const log3 = mkEl();
Object.assign(log3, {scrollHeight: 3000, scrollTop: 2400, clientHeight: 600});
els["chathead"] = head3; els["chatlog"] = log3; els["__chatbar"] = bar3;
document.body = {classList: {add(){}, remove(){}, toggle(){}, contains(){ return false; }}};
document.activeElement = null;
run("attachHeadHide()");
const scrollTo3 = (st)=>{ log3.scrollTop = st; log3.__fire("scroll"); };

t("settle: 进页抖动不误显示", head3.style.display === "none");
run("window.__setHeadHidden(false)"); /* 呼出 */
scrollTo3(2395); /* |Δ|=5<=8: 抖动不隐藏 */
t("settle: 8px内抖动不隐藏", head3.style.display === "");
scrollTo3(2380); /* |Δ|=20>8: 真滑动 -> 隐藏 */
t("settle: 超8px滑动隐藏", head3.style.display === "none");
})();

// ---------- streamToken: 上滑时不拽回底部 ----------
(function(){
const log = mkEl();
Object.assign(log, {scrollHeight: 3000, scrollTop: 100, clientHeight: 600,
insertAdjacentHTML(pos, html){ els["live"] = mkEl(); }});
els["chatlog"] = log;
/* P0-4: streamToken 只写"当前在飞轮次+当前会话"的 token；测试先登记一次合法轮次 */
run("__liveGen = __curGen; __liveKey = chatHistKey();");
run("streamToken('你')");
t("streamToken: 上滑看历史不拽回", log.scrollTop === 100);
t("streamToken: token照常追加", els["live"].textContent === "你");
log.scrollTop = 2900; // 回到底部附近
run("streamToken('好')");
t("streamToken: 在底部继续跟随", log.scrollTop === 3000);
})();

// ---------- twStart: 45ms间隔上滑时不拽回底部 ----------
(function(){
const log = mkEl();
Object.assign(log, {scrollHeight: 3000, scrollTop: 100, clientHeight: 600});
els["chatlog"] = log;
const smsg = mkEl(); smsg.querySelector = ()=>null;
els["smsg-7"] = smsg;
capturedInterval = null;
run("twStart(7, 'hello', '')");
t("twStart: 定时器装上", typeof capturedInterval === "function");
capturedInterval(); // 手动跑一帧
t("twStart: 上滑看历史不拽回", log.scrollTop === 100);
log.scrollTop = 2950;
capturedInterval();
t("twStart: 在底部继续跟随", log.scrollTop === 3000);
run("twStop()");
})();

// ---------- renderChat: forceBottom ----------
(function(){
const log = mkEl();
Object.assign(log, {scrollHeight: 3000, scrollTop: 100, clientHeight: 600});
els["chatlog"] = log;
run("renderChat()");
t("renderChat: 上滑看历史不强制回底", log.scrollTop === 100);
run("renderChat(true)");
t("renderChat(true): 发消息强制回底", log.scrollTop === log.scrollHeight);
})();

console.log(`test_scrollhide: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
