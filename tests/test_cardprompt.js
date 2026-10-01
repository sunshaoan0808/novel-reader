const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 卡片 prompt 质量回归: first_mes 污染典型台词 / {{char}}/{{user}} 宏未替换
// 修: normalizeTavern 不再把 first_mes 塞进 typical_lines;
// buildExamples 跳过与 greeting 相同/超长的行(兼容已导入旧卡);
// buildMessages 对 system prompt 做 ST 宏替换; 导出 first_mes 优先取 greeting
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false,
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
}
function mkCtx(){
const els = {}; const store = {};
const ls = {getItem: k => (k in store? store[k]: null),
setItem: (k, v) => { store[k] = String(v);},
removeItem: k => { delete store[k];},
key: i => Object.keys(store)[i] || null,
get length(){ return Object.keys(store).length;}};
const document = {body: mkEl(),
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => { const m = String(sel).match(/^#([\w-]+)$/); return m? (els[m[1]] || (els[m[1]] = mkEl())): null;},
querySelectorAll: () => [], createElement: () => mkEl()};
const ctx = {localStorage: ls, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){},
fetch: () => Promise.reject(new Error("no net")),
btoa: (s)=>Buffer.from(s, "binary").toString("base64"),
atob: (s)=>Buffer.from(s, "base64").toString("binary"),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js", "rp/memory.js",
"rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js", "rp/aifill.js",
"rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "rp/traverse2.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__ = {index:[], runs:{}, rp_cards:{}};", ctx);
return ctx;
}
let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n));};
const run = (ctx, code) => vm.runInContext(code, ctx);
const sysOf = (ctx, card, cx) => run(ctx,
"RP_PROMPT.buildMessages(" + JSON.stringify(card) + "," + JSON.stringify(cx || {}) + ",{maxContext:8192})" +
".messages.filter(function(m){return m.role==='system';}).map(function(m){return m.content;}).join('\\n')");

(async () => {
const ctx = mkCtx();

/* 1) subMacros */
t("宏{{char}}替换", run(ctx, "RP_PROMPT.subMacros('你是{{char}}', '阿茶', '阿哲')") === "你是阿茶");
t("宏{{user}}替换", run(ctx, "RP_PROMPT.subMacros('{{user}}你好', '阿茶', '阿哲')") === "阿哲你好");
t("宏大小写空格容忍", run(ctx, "RP_PROMPT.subMacros('{{ Char}}和{{USER}}', '阿茶', '阿哲')") === "阿茶和阿哲");
  t("宏{{char 1}}数字后缀", run(ctx, "RP_PROMPT.subMacros('{{char 1}}登场', '阿茶', '阿哲')") === "阿茶登场");
t("无玩家名时{{user}}->你", run(ctx, "RP_PROMPT.subMacros('{{user}}看', '阿茶', '')") === "你看");
t("无宏原文不动", run(ctx, "RP_PROMPT.subMacros('纯文本', '阿茶', '阿哲')") === "纯文本");

/* 2) 归一化: first_mes 不进 typical_lines, greeting 独立 */
run(ctx, "var __c = RP_CARDIMPORT.normalizeTavern({name:'阿茶', description:'{{char}}是店小二, 招呼{{user}}', " +
"first_mes:'锣鼓喧天...', mes_example:'<START>\\n{{user}}: 来碗茶\\n{{char}}: 好嘞!', tags:['茶馆']});");
t("greeting独立保留", run(ctx, "__c.greeting") === "锣鼓喧天...");
t("typical_lines无开场白", run(ctx, "(__c.fields.typical_lines||[]).indexOf('锣鼓喧天...')") === -1);
t("typical_lines有mes_example台词", run(ctx, "(__c.fields.typical_lines||[]).indexOf('好嘞!')")!== -1);

/* 3) buildMessages: 宏被替换, 开场白不进典型台词/对话示例 */
const sys = sysOf(ctx, run(ctx, "__c"), {novel: "茶馆", history: [], persona: "", personaName: "阿哲"});
t("system无字面{{char}}", sys.indexOf("{{char}}") === -1 && sys.indexOf("{{Char}}") === -1);
t("system无字面{{user}}", sys.indexOf("{{user}}") === -1);
t("{{char}}被换成卡名", sys.indexOf("阿茶是店小二")!== -1);
t("{{user}}被换成玩家名", sys.indexOf("招呼阿哲")!== -1);
t("开场白不进", sys.indexOf("锣鼓喧天") === -1);
t("对话示例不用开场白", sys.indexOf("在园子里迎面碰见你") === -1 || sys.indexOf("锣鼓喧天") === -1);
  run(ctx, "__c.scenario = '茶馆开在城西';");
  var sys2 = sysOf(ctx, run(ctx, "__c"), {novel: "茶馆", history: [], persona: "", personaName: "阿哲"});
  t("卡片scenario进背景段", sys2.indexOf("茶馆开在城西") !== -1);

/* 4) 旧卡兼容: typical_lines[0] 是开场白原文时, buildExamples 跳过 */
const legacy = {name: "旧卡", greeting: "很久很久以前……",
fields: {typical_lines: ["很久很久以前……", "短台词"], core_identity: "说书人"}};
const ex = run(ctx, "RP_PROMPT.buildExamples(" + JSON.stringify(legacy) + ", '旧卡', 600)");
t("旧卡开场白不进few-shot", ex.indexOf("很久很久以前") === -1);
t("旧卡短台词仍进few-shot", ex.indexOf("短台词")!== -1);
const longLine = {name: "长卡", greeting: "g",
fields: {typical_lines: [new Array(500).join("x")], core_identity: "y"}};
t("超长行不进few-shot", run(ctx, "RP_PROMPT.buildExamples(" + JSON.stringify(longLine) + ", '长卡', 600)") === "");

/* 5) 导出: first_mes 优先取 greeting, 无 greeting 回退 typical_lines[0] */
const exp1 = run(ctx, "RP_CARDEXPORT.buildTavernCard({name:'阿茶', novel:'茶馆', greeting:'开场白', fields:{typical_lines:['台词一']}})");
t("导出first_mes取greeting", exp1.data.first_mes === "开场白");
const exp2 = run(ctx, "RP_CARDEXPORT.buildTavernCard({name:'旧', novel:'x', fields:{typical_lines:['旧开场']}})");
t("无greeting回退typical_lines首行", exp2.data.first_mes === "旧开场");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail? 1: 0);
})().catch(e => { console.error("ERR", e); process.exit(1);});
