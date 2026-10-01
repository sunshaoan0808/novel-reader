const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// v38: ST 正则脚本真实制品回归测试
// stRegexToRule(stRegexToRules): placement=2(AI输出)门控 / 数组导入 / 字段保留 / 非法正则跳过
// applyRegex: markdownOnly/promptOnly 门控 / minDepth/maxDepth 过滤 / 顺序执行
// 真实 fixture: tests/fixtures/regex-ny-options.json / regex-ny-cleanup.json (用户 Ny 两份真实脚本)
const els = {};
function mkEl(){ return {innerHTML:"", textContent:"", value:"", classList:{add(){},remove(){},toggle(){}},
  querySelectorAll(){return [];}, addEventListener(){}, scrollTo(){}, style:{}}; }
const ls = (function(){ const m={}; return {
  getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
  key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
const document = {body: mkEl(), getElementById:id=>els[id]||(els[id]=mkEl()),
  querySelector:(sel)=>{const id=String(sel).replace("#","");return els[id]||(els[id]=mkEl());}, createElement:()=>mkEl()};
const DATA = {index:[], runs:{}, rp_cards:{}};
const window = {__DATA__: DATA};
const ctx = {localStorage: ls, document, console,
  alert(){}, confirm(){return true;}, prompt(){return null;},
  setTimeout, clearTimeout};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.__DATA__ = DATA;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW+"/icons.js","utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW+"/app.js","utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/chat.js","utf8"), ctx);
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const run = (code)=> vm.runInContext(code, ctx);

const ny1 = JSON.parse(fs.readFileSync("tests/fixtures/regex-ny-options.json","utf8"));
const ny2 = JSON.parse(fs.readFileSync("tests/fixtures/regex-ny-cleanup.json","utf8"));

// ---- 1) 真实脚本 1: Ny-4个选项沉浸式互动 ----
// 通过 globalThis 传对象(避免 JSON 序列化转义问题)
ctx.__ny1 = ny1; ctx.__ny2 = ny2;
const rule1 = run(`stRegexToRule(__ny1)`);
t("ny1 被接受(placement [1,2] 含 AI输出)", !!rule1);
t("ny1 名称保留", rule1 && rule1.name === "Ny-4个选项沉浸式互动（需要小白x)");
t("ny1 /i 标志解析(含 i+g)", rule1 && rule1.flags.indexOf("i")>=0 && rule1.flags.indexOf("g")>=0);
t("ny1 find 含 small 模式", rule1 && rule1.find.indexOf("<small>") === 0);
t("ny1 replace 保留 HTML", rule1 && rule1.replace.indexOf("<!DOCTYPE html>") >= 0);
t("ny1 enabled(未禁用)", rule1 && rule1.enabled === true);
t("ny1 markdownOnly 保留", rule1 && rule1.markdownOnly === true);
t("ny1 promptOnly=false 保留", rule1 && rule1.promptOnly === false);
t("ny1 minDepth null 保留", rule1 && rule1.minDepth === null);

// ---- 2) 真实脚本 2: Ny-去除之前的四个选项 ----
const rule2 = run(`stRegexToRule(__ny2)`);
t("ny2 被接受", !!rule2);
t("ny2 名称保留", rule2 && rule2.name === "Ny-去除之前的四个选项");
t("ny2 无斜杠 find 原样保留", rule2 && rule2.find === "<small>[\\s\\S]*?</small>");
t("ny2 replace 为空字符串", rule2 && rule2.replace === "");
t("ny2 promptOnly 保留", rule2 && rule2.promptOnly === true);
t("ny2 markdownOnly 保留", rule2 && rule2.markdownOnly === true);
t("ny2 minDepth=2 保留", rule2 && rule2.minDepth === 2);

// ---- 3) 数组导入 ----
const both = run(`stRegexToRules([__ny1, __ny2])`);
t("数组导入得 2 条", Array.isArray(both) && both.length === 2);
const withBad = run(`stRegexToRules([__ny1, {scriptName:"坏", findRegex:"/([a/"}, __ny2])`);
t("非法正则只跳过本条", Array.isArray(withBad) && withBad.length === 2);

// ---- 4) placement 门控(核心 bug 回归: 旧代码要求含 1, 实际 AI输出=2) ----
t("placement=[2] 接受", !!run(`stRegexToRule({findRegex:"a", placement:[2]})`));
t("placement=[1] 拒绝(仅用户输入)", !run(`stRegexToRule({findRegex:"a", placement:[1]})`));
t("placement=[3] 拒绝(斜杠命令)", !run(`stRegexToRule({findRegex:"a", placement:[3]})`));
t("placement 缺省视为 [2]", !!run(`stRegexToRule({findRegex:"a"})`));
t("无 findRegex 拒绝", !run(`stRegexToRule({scriptName:"x"})`));

// ---- 5) applyRegex 真实替换: ny1 把选项块变成 HTML 卡片 ----
ctx.__rule1 = rule1; ctx.__rule2 = rule2;
const sample = '剧情正文……\n<small>接下来你会？\n1️⃣ 追上去问清楚\n2️⃣ 假装没看见\n3️⃣ 躲进茶馆\n4️⃣ 大声喊住他\ntips:"每个选项都会改变好感度"\n</small>\n尾声。';
const hist = '旧消息 <small>1️⃣ a 2️⃣ b 3️⃣ c 4️⃣ d tips:"x"</small> 结束';
ctx.__sample = sample; ctx.__hist = hist;
const out1 = run(`applyRegex(__sample, [__rule1])`);
t("ny1 真实替换生效", out1.indexOf("<small>") < 0 && out1.indexOf("glass-card") >= 0);
t("ny1 正文保留", out1.indexOf("剧情正文") >= 0 && out1.indexOf("尾声") >= 0);

// ---- 6) depth 过滤: ny2 minDepth=2, 新回复 depth=0 不执行, depth=2 执行 ----
t("ny2 depth=0 跳过", run(`applyRegex(__hist, [__rule2])`).indexOf("<small>") >= 0);
t("ny2 depth=2 执行", run(`applyRegex(__hist, [__rule2], 2)`).indexOf("<small>") < 0);

// ---- 7) promptOnly 门控 ----
const purePrompt = run(`stRegexToRule({findRegex:"abc", replaceString:"XYZ", placement:[2], promptOnly:true})`);
ctx.__pp = purePrompt;
t("纯 promptOnly 导入保留", !!purePrompt && purePrompt.promptOnly === true);
t("纯 promptOnly 运行时跳过", run(`applyRegex("abc", [__pp])`) === "abc");
const mdPrompt = run(`stRegexToRule({findRegex:"abc", replaceString:"XYZ", placement:[2], promptOnly:true, markdownOnly:true})`);
ctx.__mp = mdPrompt;
t("markdownOnly+promptOnly 显示路径执行", run(`applyRegex("abc", [__mp])`) === "XYZ");

// ---- 8) 顺序执行 + enabled=false 跳过 + 非法正则不抛 ----
ctx.__seq = [
  run(`stRegexToRule({findRegex:"a", replaceString:"b", placement:[2]})`),
  run(`stRegexToRule({findRegex:"b", replaceString:"c", placement:[2]})`),
  {find:"c", replace:"d", flags:"g", enabled:false},
];
t("按顺序链式替换", run(`applyRegex("a", __seq)`) === "c");
t("enabled=false 跳过", run(`applyRegex("c", __seq)`) === "c");
t("空输入/空规则", run(`applyRegex("", __seq)`) === "" && run(`applyRegex("x", [])`) === "x");

// ---- 9) 导出: stRuleToScript (stRegexToRule 的逆操作), 真实 NY 脚本往返 ----
ctx.__rr = run(`stRegexToRules([__ny1, __ny2])`);
t("NY 两脚本导入 2 条", ctx.__rr.length === 2);
const __scripts = run(`__rr.map(stRuleToScript)`);
t("导出为数组", Array.isArray(__scripts) && __scripts.length === 2);
t("导出脚本含 ST 字段", __scripts.every(s=>
  typeof s.scriptName === "string" && typeof s.findRegex === "string"
  && typeof s.replaceString === "string" && Array.isArray(s.placement)));
t("导出 findRegex 为 /re/flags 写法",
  __scripts.every(s=> s.findRegex.indexOf("/") === 0));
t("导出 placement 含 2", __scripts.every(s=> s.placement.indexOf(2) >= 0));
ctx.__scripts = __scripts;
const __back = run(`stRegexToRules(__scripts)`);
t("往返规则一致", JSON.stringify(ctx.__rr) === JSON.stringify(__back));
// 单条往返: 纯 promptOnly 规则字段保留
const __po = run(`stRegexToRules(stRuleToScript({find:"x", replace:"y", flags:"g",
  enabled:true, markdownOnly:false, promptOnly:true, minDepth:1, maxDepth:3,
  trimStrings:["a"], runOnEdit:true, name:"n"}))`);
t("promptOnly/深度/trim/runOnEdit 往返保留",
  __po.length === 1 && __po[0].promptOnly === true && __po[0].minDepth === 1
  && __po[0].maxDepth === 3 && __po[0].trimStrings[0] === "a"
  && __po[0].runOnEdit === true && __po[0].name === "n");

// ---- 10) 静态: 导出 UI 入口 ----
const __asrc = fs.readFileSync(WWW+"/app.js", "utf8");
t("导出 ST 脚本 button", __asrc.indexOf("exportStRegex()") >= 0);
t("window.exportStRegex", __asrc.indexOf("window.exportStRegex") >= 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
