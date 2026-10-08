const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// v38: ST 预设(全条目保留+逐条开关+变量宏顺序求值)回归测试
// parseFile(全保留/enabled/group) / evalMacros(变量宏单遍顺序求值) /
// assemble(disabled跳过+跨条目变量+marker+history) / buildMessages 预设分支 /
// 真实 MoM 2.4 fixture(146条/67原始启用→prompt_order覆盖后66启用/8marker, 宏零泄漏)
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
{name: "变量设置", content: "{{setvar::流派::悬疑}}", enabled: true, role: "system"},
{name: "变量读取", content: "写{{getvar::流派}}小说。", enabled: true, role: "system"},
{name: "关", content: "不应出现", enabled: false, role: "system"},
{name: "charDesc", content: "", enabled: true, role: "system", marker: true, identifier: "charDescription"},
{name: "Chat History", content: "", enabled: true, role: "system", marker: true, identifier: "chatHistory"},
{name: "分组条目", content: "分组内容", enabled: true, role: "system", extension: {entryGrouping: "世界观"}},
{name: "jailbreak", content: "必须遵守{{char}}的人设。", enabled: true, role: "system"},
{name: "prefill", content: "好的，我记住了。", enabled: true, role: "assistant"},
{name: "空条目", content: "   ", enabled: true, role: "system"},
]
});

(function(){
const ctx = mkCtx();

/* 1) parseFile: 全保留 */
const r = run(ctx, "RP_PRESET.parseFile(" + JSON.stringify(PRESET_JSON) + ")");
t("parse ok", r.ok === true);
t("parse 名称", r.preset.name === "测试预设");
t("parse 保留全部10条", r.preset.prompts.length === 10);
t("parse disabled保留且enabled=false", r.preset.prompts.some(p=>p.name==="关" && p.enabled===false));
t("parse 空条目保留", r.preset.prompts.some(p=>p.name==="空条目" && p.enabled!==false));
t("parse 分组提取", r.preset.prompts.some(p=>p.name==="分组条目" && p.group==="世界观"));
t("parse marker保留", r.preset.prompts.some(p=>p.marker && p.identifier==="charDescription"));
t("parse 参数", r.preset.params.temperature === 1.1 && r.preset.params.top_p === 0.85);
t("parse 无prompts", run(ctx, "RP_PRESET.parseFile('{}').err") === "noprompts");
t("parse 坏json", run(ctx, "RP_PRESET.parseFile('{bad').err") === "json");
const rEmpty = run(ctx, "RP_PRESET.parseFile(JSON.stringify({name:'e',prompts:[]}))");
t("parse 空数组empty", rEmpty.ok === false && rEmpty.err === "empty");

/* 2) 存取 */
run(ctx, "RP_PRESET.save(" + JSON.stringify(r.preset) + ")");
t("list 有1个", run(ctx, "RP_PRESET.list().length") === 1);
t("get 命中", run(ctx, "RP_PRESET.get(" + JSON.stringify(r.preset.id) + ").name") === "测试预设");
run(ctx, "RP_PRESET.remove(" + JSON.stringify(r.preset.id) + ")");
t("remove 后空", run(ctx, "RP_PRESET.list().length") === 0);

/* 3) evalMacros: 变量宏单遍顺序求值 */
const E = (code)=> run(ctx, code);
t("宏char/user", E("RP_PRESET.evalMacros('{{char}}对{{user}}笑',{charName:'阿茶',userName:'阿哲',scope:RP_PRESET.newScope()})") === "阿茶对阿哲笑");
t("setvar输出空", E("RP_PRESET.evalMacros('a{{setvar::x::1}}b',{scope:RP_PRESET.newScope()})") === "ab");
const sc = "var s=RP_PRESET.newScope();";
t("setvar后getvar", E(sc + "RP_PRESET.evalMacros('{{setvar::a::hello}}',{scope:s});RP_PRESET.evalMacros('X{{getvar::a}}Y',{scope:s})") === "XhelloY");
t("先读后写为空", E(sc + "var o=RP_PRESET.evalMacros('{{getvar::a}}|{{setvar::a::w}}{{getvar::a}}',{scope:s});o") === "|w");
t("addvar数字相加", E(sc + "RP_PRESET.evalMacros('{{setvar::n::5}}{{addvar::n::3}}',{scope:s});RP_PRESET.evalMacros('{{getvar::n}}',{scope:s})") === "8");
t("addvar字符串拼接", E(sc + "RP_PRESET.evalMacros('{{setvar::t::ab}}{{addvar::t::cd}}',{scope:s});RP_PRESET.evalMacros('{{getvar::t}}',{scope:s})") === "abcd");
t("incvar/decvar", E(sc + "RP_PRESET.evalMacros('{{setvar::n::5}}{{incvar::n}}{{decvar::n}}{{decvar::n}}',{scope:s});RP_PRESET.evalMacros('{{getvar::n}}',{scope:s})") === "4");
t("incvar未定义从0起", E(sc + "RP_PRESET.evalMacros('{{incvar::k}}',{scope:s});RP_PRESET.evalMacros('{{getvar::k}}',{scope:s})") === "1");
t("全局变量跨scope", E("RP_PRESET.evalMacros('{{setglobalvar::g::G}}',{scope:RP_PRESET.newScope()});RP_PRESET.evalMacros('{{getglobalvar::g}}',{scope:RP_PRESET.newScope()})") === "G");
t("random多选一", ["x","y"].indexOf(E("RP_PRESET.evalMacros('{{random::x,y}}',{scope:RP_PRESET.newScope()})")) >= 0);
t("pick二选一", ["x","y"].indexOf(E("RP_PRESET.evalMacros('{{pick::x,y}}',{scope:RP_PRESET.newScope()})")) >= 0);
t("trim剥离", E("RP_PRESET.evalMacros('{{trim}}hi',{scope:RP_PRESET.newScope()})") === "hi");
t("newline换行", E("RP_PRESET.evalMacros('a{{newline}}b',{scope:RP_PRESET.newScope()})") === "a\nb");
t("注释剥离", E("RP_PRESET.evalMacros('a{{// note}}b',{scope:RP_PRESET.newScope()})") === "ab");
t("未知宏剥离", E("RP_PRESET.evalMacros('a{{weirdmacro}}b',{scope:RP_PRESET.newScope()})") === "ab");
t("time真值", /^\d\d:\d\d$/.test(E("RP_PRESET.evalMacros('{{time}}',{scope:RP_PRESET.newScope()})")));
t("lastUserMessage", E("RP_PRESET.evalMacros('复述:{{lastUserMessage}}',{lastUserMessage:'你好',scope:RP_PRESET.newScope()})") === "复述:你好");
t("setvar多行值", E(sc + "RP_PRESET.evalMacros('{{setvar::m::第一行\\n第二行}}',{scope:s});RP_PRESET.evalMacros('[{{getvar::m}}]',{scope:s})").indexOf("第一行") >= 0);

/* 4) assemble: disabled跳过 + 跨条目变量 + marker + history */
const P = r.preset;
const msgs = run(ctx, "RP_PRESET.assemble(" + JSON.stringify(P) + ", {persona:'', charDesc:'角色卡人设块', charPers:'', scenario:'', examples:'', loreBefore:'', lore:'', history:[{role:'user',content:'H1'},{role:'assistant',content:'H2'}], charName:'阿茶', userName:'阿哲'})");
t("assemble 条数", msgs.length === 8); // 身份,变量读取,charDesc,H1,H2,分组条目,jailbreak,prefill(变量设置求值为空跳过,关被跳过,空条目求值为空跳过)
t("assemble 首条是预设身份", msgs[0].role === "system" && msgs[0].content.indexOf("你是作家阿茶") === 0);
t("assemble 跨条目变量", msgs[1].content === "写悬疑小说。");
t("assemble marker被替换", msgs[2].content === "角色卡人设块");
t("assemble history定位", msgs[3].content === "H1" && msgs[4].content === "H2");
t("assemble 分组条目在", msgs[5].content === "分组内容");
t("assemble 结尾jailbreak", msgs[6].content === "必须遵守阿茶的人设。");
t("assemble assistant prefill", msgs[7].role === "assistant" && msgs[7].content === "好的，我记住了。");
t("assemble 无disabled内容", !msgs.some(m=>m.content.indexOf("不应出现")>=0));
/* 开关持久化: 关掉jailbreak后重取 */
run(ctx, "var _p=" + JSON.stringify(P) + ";_p.prompts.forEach(function(e){if(e.name==='jailbreak')e.enabled=false;});RP_PRESET.save(_p);");
const msgs2 = run(ctx, "RP_PRESET.assemble(RP_PRESET.get(" + JSON.stringify(P.id) + "), {charDesc:'D',history:[],charName:'阿茶',userName:'阿哲'})");
t("开关持久化生效", !msgs2.some(m=>m.content.indexOf("必须遵守")>=0));

/* 5) buildMessages 预设分支 */
run(ctx, "var __c = RP_CARDIMPORT.normalizeTavern({name:'阿茶', description:'店小二', first_mes:'开场白', personality:'热情'});");
const card = run(ctx, "__c");
const hist = [{role: "user", content: "来碗茶"}, {role: "assistant", content: "好嘞"}];
const b1 = run(ctx, "RP_PROMPT.buildMessages(" + JSON.stringify(card) +
", {novel:'茶馆', personaName:'阿哲', history:" + JSON.stringify(hist) + "}, " +
"{maxContext:8192, stPreset:" + JSON.stringify(P) + "})");
t("预设分支 首条是预设身份", b1.messages[0].role === "system" && b1.messages[0].content.indexOf("你是作家阿茶") === 0);
t("预设分支 stats.stPreset", b1.stats.stPreset === "测试预设");
const b0 = run(ctx, "RP_PROMPT.buildMessages(" + JSON.stringify(card) +
", {novel:'茶馆', personaName:'阿哲', history:" + JSON.stringify(hist) + "}, {maxContext:8192})");
t("经典分支不受影响", b0.messages[0].role === "system" && b0.stats.stPreset == null &&
b0.messages[b0.messages.length-1].role === "system");

/* 6) 真实 MoM 2.4 fixture */
const momRaw = fs.readFileSync("tests/fixtures/mom-2.4.json", "utf8");
const mom = run(ctx, "RP_PRESET.parseFile(" + JSON.stringify(momRaw) + ")");
t("MoM parse ok", mom.ok === true);
t("MoM 146条全保留", mom.preset.prompts.length === 146);
t("MoM prompt_order覆盖后66条启用", mom.preset.prompts.filter(p=>p.enabled!==false).length === 66);
t("MoM prompt_order置关的条目确被关闭", mom.preset.prompts.some(p=>p.identifier==="8eedba76-7382-4477-b45e-5b3f6a818c7d" && p.enabled===false));
t("MoM 8个marker", mom.preset.prompts.filter(p=>p.marker).length === 8);
run(ctx, "RP_PRESET.save(" + JSON.stringify(mom.preset) + ")");
const momMsgs = run(ctx, "RP_PRESET.assemble(RP_PRESET.get(" + JSON.stringify(mom.preset.id) + "), {persona:'P',charDesc:'D',charPers:'PP',scenario:'S',examples:'E',loreBefore:'',lore:'L',history:[{role:'user',content:'你好'}],charName:'蛾摩拉',userName:'主人'})");
const momAll = momMsgs.map(m=>m.content).join("\n");
const leaks = momAll.match(/\{\{(setvar|getvar|addvar|incvar|decvar|setglobalvar|getglobalvar|random|trim)[\s\S]*?\}\}/g);
t("MoM 宏零泄漏", !leaks);
t("MoM 变量求值(小说类别=BL)", momAll.indexOf("BL") >= 0);
t("MoM history展开", momMsgs.some(m=>m.content === "你好"));
t("MoM 有system消息", momMsgs.some(m=>m.role === "system" && m.content.length > 50));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})();
