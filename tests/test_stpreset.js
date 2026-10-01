const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// v37: ST 预设导入/组装回归测试
// parseFile(校验/过滤) / expandMacros(ST宏展开剥离) / assemble(marker替换与顺序) /
// buildMessages 预设分支(顺序组装+history定位+stats)
function mkCtx(){
const store = {};
const localStorage = {
getItem: (k)=> (k in store ? store[k] : null),
setItem: (k, v)=>{ store[k] = String(v); },
removeItem: (k)=>{ delete store[k]; },
};
const ctx = {console, localStorage};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["rp/prompt.js", "rp/preset.js", "rp/cardimport.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
return ctx;
}
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const run = (ctx, code)=> vm.runInContext(code, ctx);

const PRESET_JSON = JSON.stringify({
name: "测试预设",
temperature: 1.1, top_p: 0.85,
prompts: [
{name: "身份定义", content: "你是作家{{char}}，搭档是{{user}}。", enabled: true, role: "system"},
{name: "set-不要关", content: "{{setvar::a::1}}\n{{trim}}", enabled: true, role: "system"},
{name: "关", content: "不应出现", enabled: false, role: "system"},
{name: "charDesc", content: "", enabled: true, role: "system", marker: true, identifier: "charDescription"},
{name: "Chat History", content: "", enabled: true, role: "system", marker: true, identifier: "chatHistory"},
{name: "jailbreak", content: "必须遵守{{char}}的人设。", enabled: true, role: "system"},
{name: "prefill", content: "好的，我记住了。", enabled: true, role: "assistant"},
{name: "空条目", content: "   ", enabled: true, role: "system"},
]
});

(function(){
const ctx = mkCtx();

/* 1) parseFile */
const r = run(ctx, "RP_PRESET.parseFile(" + JSON.stringify(PRESET_JSON) + ")");
t("parse ok", r.ok === true);
t("parse 名称", r.preset.name === "测试预设");
t("parse 只保留enabled非空", r.preset.prompts.length === 6); // 身份/set(宏剥离后空但原文非空,组装时再丢)/charDesc/ChatHistory/jailbreak/prefill；"关"(disabled)与"空条目"被丢
t("parse marker保留", r.preset.prompts.some(p=>p.marker && p.identifier==="charDescription"));
t("parse 参数", r.preset.params.temperature === 1.1 && r.preset.params.top_p === 0.85);
t("parse 无prompts", run(ctx, "RP_PRESET.parseFile('{}').err") === "noprompts");
t("parse 坏json", run(ctx, "RP_PRESET.parseFile('{bad').err") === "json");
const rEmpty = run(ctx, "RP_PRESET.parseFile(JSON.stringify({name:'e',prompts:[{name:'x',content:'y',enabled:false}]}))");
t("parse 全关empty", rEmpty.ok === false && rEmpty.err === "empty");

/* 2) 存取 */
run(ctx, "RP_PRESET.save(" + JSON.stringify(r.preset) + ")");
t("list 有1个", run(ctx, "RP_PRESET.list().length") === 1);
t("get 命中", run(ctx, "RP_PRESET.get(" + JSON.stringify(r.preset.id) + ").name") === "测试预设");
run(ctx, "RP_PRESET.remove(" + JSON.stringify(r.preset.id) + ")");
t("remove 后空", run(ctx, "RP_PRESET.list().length") === 0);

/* 3) expandMacros */
t("宏char/user", run(ctx, "RP_PRESET.expandMacros('{{char}}对{{user}}笑','阿茶','阿哲')") === "阿茶对阿哲笑");
t("setvar剥离", run(ctx, "RP_PRESET.expandMacros('a{{setvar::x::1}}b','c','u')") === "ab");
t("trim剥离", run(ctx, "RP_PRESET.expandMacros('{{trim}}hi','c','u')") === "hi");
t("注释剥离", run(ctx, "RP_PRESET.expandMacros('a{{// note}}b','c','u')") === "ab");
t("未知宏剥离", run(ctx, "RP_PRESET.expandMacros('a{{weirdmacro}}b','c','u')") === "ab");
t("pick二选一", ["x", "y"].indexOf(run(ctx, "RP_PRESET.expandMacros('{{pick::x,y}}','c','u')")) >= 0);
t("time真值", /^\d\d:\d\d$/.test(run(ctx, "RP_PRESET.expandMacros('{{time}}','c','u')")));

/* 4) assemble: 顺序 + marker 替换 + history 定位 */
const P = r.preset;
const msgs = run(ctx, "RP_PRESET.assemble(" + JSON.stringify(P) + ", {persona:'', charDesc:'角色卡人设块', charPers:'', scenario:'', examples:'', loreBefore:'', lore:'', history:[{role:'user',content:'H1'},{role:'assistant',content:'H2'}], charName:'阿茶', userName:'阿哲'})");
t("assemble 条数", msgs.length === 6); // 身份, charDesc, H1, H2, jailbreak, prefill
t("assemble 首条是预设身份", msgs[0].role === "system" && msgs[0].content.indexOf("你是作家阿茶") === 0);
t("assemble marker被替换", msgs[1].content === "角色卡人设块");
t("assemble history定位", msgs[2].content === "H1" && msgs[3].content === "H2");
t("assemble 结尾jailbreak", msgs[4].content === "必须遵守阿茶的人设。");
t("assemble assistant prefill", msgs[5].role === "assistant" && msgs[5].content === "好的，我记住了。");

/* 5) buildMessages 预设分支 */
run(ctx, "var __c = RP_CARDIMPORT.normalizeTavern({name:'阿茶', description:'店小二', first_mes:'开场白', personality:'热情'});");
const card = run(ctx, "__c");
const hist = [{role: "user", content: "来碗茶"}, {role: "assistant", content: "好嘞"}];
const b1 = run(ctx, "RP_PROMPT.buildMessages(" + JSON.stringify(card) +
", {novel:'茶馆', personaName:'阿哲', history:" + JSON.stringify(hist) + "}, " +
"{maxContext:8192, stPreset:" + JSON.stringify(P) + "})");
t("预设分支 首条是预设身份", b1.messages[0].role === "system" && b1.messages[0].content.indexOf("你是作家阿茶") === 0);
const contents = b1.messages.map(m=>m.content);
const iDesc = contents.findIndex(c=>c.indexOf("核心人设")>=0);
t("预设分支 history在marker处", iDesc >= 0 && contents[iDesc+1] === "来碗茶" && contents[iDesc+2] === "好嘞");
t("预设分支 stats.stPreset", b1.stats.stPreset === "测试预设");
t("预设分支 无经典post", !contents.some(c=>c.indexOf("postInstructions")>=0));
const b0 = run(ctx, "RP_PROMPT.buildMessages(" + JSON.stringify(card) +
", {novel:'茶馆', personaName:'阿哲', history:" + JSON.stringify(hist) + "}, {maxContext:8192})");
t("经典分支不受影响", b0.messages[0].role === "system" && b0.stats.stPreset == null &&
b0.messages[b0.messages.length-1].role === "system");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})();
