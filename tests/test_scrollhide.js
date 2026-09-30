const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 回归: 滚动体验三件套
// 1) 上滑看历史时, 流式/打字机/重渲染不得强制拽回底部(持续抖动根因)
// 2) 下滑时底栏(输入条)跟随顶栏一起隐藏, 上滑/回顶恢复
// 3) 显隐切换加迟滞, 阈值附近不反复横跳
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false,
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
insertAdjacentHTML(pos, html){ /* 测试里按需覆写 */ },
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
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
};
const ctx = {localStorage: ls, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){},
setInterval: (fn)=>{ capturedInterval = fn; return 1; }, clearInterval(){},
fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js",
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

// ---------- attachHeadHide: 顶栏+底栏+场景条联动, 只有滑到底才退出沉浸式 ----------
(function(){
const toggles = [];
const head = mkEl(); head.offsetHeight = 65;
head.classList = {add(){}, remove(){}, toggle(c, on){ toggles.push(["head", c, !!on]); }, contains(){ return false; }};
const bar = mkEl(); bar.offsetHeight = 69;
bar.classList = {add(){}, remove(){}, toggle(c, on){ toggles.push(["bar", c, !!on]); }, contains(){ return false; }};
const log = mkEl();
Object.assign(log, {scrollHeight: 3000, scrollTop: 2400, clientHeight: 600}); /* 初始钉在底部 */
els["chathead"] = head; els["chatlog"] = log; els["__chatbar"] = bar;
const bodyToggles = [];
document.body = {classList: {add(){}, remove(){}, toggle(c, on){ bodyToggles.push([c, !!on]); }, contains(){ return false; }}};
document.activeElement = null;
run("attachHeadHide()");
const scrollTo = (st)=>{ log.scrollTop = st; log.onscroll(); };

t("init: 底部默认显示", !head.style.marginTop && !bar.style.position);

scrollTo(2000); // 上滑看历史: dist 0->400, 拉开超140 -> 进入沉浸式
t("hide: 上滑看历史顶栏收起", head.style.marginTop === "-65px");
t("hide: 顶栏hide类(视觉兜底)", toggles.some(x=>x[0]==="head"&&x[1]==="hide"&&x[2]));
t("hide: 底栏fixed脱离文档流", bar.style.position === "fixed" && bar.style.bottom === "0" && bar.style.left === "0" && bar.style.right === "0");
t("hide: 底栏transform移出", bar.style.transform === "translateY(110%)");
t("hide: 底栏hidebar类", toggles.some(x=>x[0]==="bar"&&x[1]==="hidebar"&&x[2]));
t("hide: body挂immersive", bodyToggles.some(x=>x[0]==="immersive"&&x[1]));

scrollTo(1900); // 小幅下滑但没到底(dist=500): 保持隐藏，不到滑到底不退出
t("hysteresis: 未滑到底保持隐藏", head.style.marginTop === "-65px" && bar.style.position === "fixed");

scrollTo(2100); // 小幅上滑(dist=300): 保持隐藏（旧逻辑这里会上滑64就误显示）
t("hysteresis: 历史区内上滑不退出", head.style.marginTop === "-65px");

scrollTo(2380); // 滑到底: dist=20<24 -> 退出沉浸式
t("show: 滑到底恢复顶栏", head.style.marginTop === "");
t("show: 滑到底恢复底栏", bar.style.position === "" && bar.style.transform === "");
t("show: 滑到底摘immersive", bodyToggles.filter(x=>x[0]==="immersive").pop()[1] === false);

// 输入聚焦时不藏底栏（顶栏照藏）
document.activeElement = {tagName: "INPUT"};
scrollTo(2000);
t("typing: 输入时顶栏仍可藏", head.style.marginTop === "-65px");
t("typing: 输入时底栏不藏", bar.style.position === "" && bar.style.transform === "");
document.activeElement = null;
scrollTo(2380); // 回到底部恢复，供后续用例干净状态

/* 深层回归: 隐藏后浏览器因布局变化钳制 scrollTop(绝对值变小但离底距离不变),
   状态机不得把它当成用户操作而误显示 (v33 视觉回归抓到的根因) */
scrollTo(2000);                      /* 隐藏, dist=400 */
log.scrollHeight = 2900;             /* 模拟: chatlog 变高, maxST 2400->2300 */
scrollTo(1900);                      /* 钳制: 绝对值掉了100, 但离底距离仍是400 */
t("clamp: 布局钳制不误显示", head.style.marginTop === "-65px" && bar.style.position === "fixed");
scrollTo(2280);                      /* 滑到底附近: dist=20<24 -> 显示 */
t("clamp: 滑到底恢复", head.style.marginTop === "" && bar.style.position === "");
log.scrollHeight = 3000;

/* 新回归: 打开聊天页后约1s内字体/布局沉降让 scrollTop 原地抖动
   (实测 ±84px), 但离底距离不变; 不得误判成用户滚动而隐藏 */
(function(){
const head2 = mkEl(); head2.offsetHeight = 65;
head2.classList = {add(){}, remove(){}, toggle(c, on){ if(on) head2["_h_"+c]=1; else delete head2["_h_"+c]; }, contains(c){ return !!head2["_h_"+c]; }};
const bar2 = mkEl();
bar2.classList = {add(){}, remove(){}, toggle(c, on){ if(on) bar2["_h_"+c]=1; else delete bar2["_h_"+c]; }, contains(c){ return !!bar2["_h_"+c]; }};
const log2 = mkEl();
/* 用户钉在底部: scrollHeight 3970, clientHeight 632, scrollTop 3338, dist=0 */
Object.assign(log2, {scrollHeight: 3970, scrollTop: 3338, clientHeight: 632});
els["chathead"] = head2; els["chatlog"] = log2; els["__chatbar"] = bar2;
run("attachHeadHide()");
/* 浏览器行为：scrollHeight 抖动时把用户钉在底部，scrollTop 被钳制到 maxST，
   离底距离恒为 0。用 [st, sh] 对模拟（sh 跟着 st 变，保证 dist=0） */
const jit = (st, sh)=>{ log2.scrollHeight = sh;
  log2.scrollTop = Math.min(st, sh - log2.clientHeight); log2.onscroll(); };
[[3338,3970],[3364,3996],[3280,3912],[3270,3902],[3287,3919],
 [3277,3909],[3268,3900],[3261,3893],[3255,3887]].forEach(([st,sh])=>jit(st,sh));
t("settle: 布局抖动不误隐藏顶栏", !head2.classList.contains("hide"));
t("settle: 布局抖动不误隐藏底栏", !bar2.classList.contains("hidebar"));
els["chathead"] = head; els["chatlog"] = log; els["__chatbar"] = bar;
})();
})();

// ---------- streamToken: 上滑时不拽回底部 ----------
(function(){
const log = mkEl();
Object.assign(log, {scrollHeight: 3000, scrollTop: 100, clientHeight: 600,
insertAdjacentHTML(pos, html){ els["live"] = mkEl(); }});
els["chatlog"] = log;
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
