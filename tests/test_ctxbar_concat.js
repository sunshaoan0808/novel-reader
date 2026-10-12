const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// UI-01 回归: renderCtxBar 的 innerHTML 拼接里, 注释行行首不能再带一个多余的 `+`。
// 之前写法:
//   + (hits.length ? ... : "")
//   + /* 注释 */
//   + (pct > 90 ? ... : "");
// 会被解析成 `... + +( ... )`——第二个 `+` 是一元正号，`+""` 得 0，
// 导致顶栏莫名多出一个 "0" 文本节点；pct>90 时 `+"<div>..."` 得 NaN，
// 警告条直接被吞掉。修法：注释行行首不带 `+`。
const src = fs.readFileSync(WWW + "/app.js", "utf8");
const start = src.indexOf("function renderCtxBar(){");
if(start < 0) throw new Error("renderCtxBar not found");
const end = src.indexOf("/* ============ 世界模拟 HUD", start);
const funcSrc = src.slice(start, end);

let pass = 0, fail = 0;
function ok(name, cond){
  if(cond){ pass++; }
  else { fail++; console.log("FAIL:", name); }
}

// 1) 静态检查：注释行行首不再有 `+`
const lines = funcSrc.split("\n");
ok("no leading-plus comment line", !lines.some(l => /^\s*\+\s*\/\*/.test(l)));

// 2) 动态检查：跑真实函数，innerHTML 尾部干净
const sandbox = {
  console,
  __assigned: null,
  document: { getElementById: () => ({
    style: {},
    set innerHTML(v){ sandbox.__assigned = v; },
    get innerHTML(){ return sandbox.__assigned; },
  })},
  LAST_STATS: null,
  icon: () => "",
  esc: (x) => String(x),
  /* P1-12: 源码段如今用 setTimeout 做 lore 徽标防抖，沙箱补桩 */
  setTimeout: () => 0,
  clearTimeout: () => {},
};
sandbox.global = sandbox;
/* P1-12: renderCtxBar 源码段尾部如今包含 window.toggleCtxLore 赋值，沙箱需提供 window */
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(funcSrc + "\nthis.renderCtxBar = renderCtxBar;", sandbox);
const run = vm.runInContext(`(function(stats){
  LAST_STATS = stats;
  __assigned = null;
  renderCtxBar();
  return __assigned;
})`, sandbox);

const normal = run({sysTokens:500,histTokens:350,histKept:3,maxCtx:12800,loreHits:[],loreHitDetails:[]});
ok("normal: no trailing 0", typeof normal === "string" && normal.endsWith("</div>") && !/\d$/.test(normal));
ok("normal: shows stats", normal.includes("850/12800") && normal.includes("历史3条"));

const hot = run({sysTokens:12000,histTokens:500,histKept:40,maxCtx:12800,loreHits:[],loreHitDetails:[]});
ok("hot: warn div rendered", hot.includes("ctxwarn") && hot.includes("旧消息会逐渐从记忆中褪色"));
ok("hot: no NaN leak", !hot.includes("NaN"));

const lore = run({sysTokens:500,histTokens:350,histKept:3,maxCtx:12800,
  loreHits:["大观园"], loreHitDetails:[{title:"大观园",probability:90,priority:1}]});
ok("lore: trigger line rendered", lore.includes("ctxlore") && lore.includes("大观园") && lore.includes("90%·P1"));
ok("lore: no trailing junk", lore.endsWith("</div>"));

console.log(`test_ctxbar_concat: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
