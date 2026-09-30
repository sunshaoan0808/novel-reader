const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1-3: AI 一键生成角色卡
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
};
const ctx = {localStorage, console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/cardwriter.js", "utf8"), ctx, {filename: "cardwriter.js"});
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- quickPrompt ----
const qp = vm.runInContext("RP_WRITER.quickPrompt('沈清辞','落魄书生')", ctx);
t("prompt含名字", qp.indexOf("沈清辞") >= 0);
t("prompt含设定", qp.indexOf("落魄书生") >= 0);
t("prompt含字段列表", qp.indexOf("core_identity") >= 0 && qp.indexOf("typical_lines") >= 0);
t("prompt要开场白", qp.indexOf("altGreetings") >= 0);
t("prompt要示例对话", qp.indexOf("exampleDialogue") >= 0);

// ---- parseCardJson ----
const rawJson = '```json\n{"core_identity":"落魄书生","typical_lines":["呵","你懂什么"],"altGreetings":["在下沈清辞","有何贵干"],"exampleDialogue":"<START>\\n{{user}}: 你好\\n{{char}}: 姑娘好"}```';
const parsed = vm.runInContext("RP_WRITER.parseCardJson(" + JSON.stringify(rawJson) + ")", ctx);
t("解析字段", parsed.fields.core_identity === "落魄书生");
t("解析台词数组", parsed.fields.typical_lines.length === 2);
t("解析开场白", parsed.altGreetings.length === 2 && parsed.altGreetings[0] === "在下沈清辞");
t("解析示例对话", parsed.exampleDialogue.indexOf("姑娘好") >= 0);
t("解析失败抛错", vm.runInContext("(function(){ try{ RP_WRITER.parseCardJson('不是json'); return false; }catch(e){ return e.message==='卡片解析失败'; } })()", ctx) === true);
// 未知键被过滤
const parsed2 = vm.runInContext("RP_WRITER.parseCardJson('{\"core_identity\":\"x\",\"瞎编键\":\"y\"}')", ctx);
t("未知键过滤", parsed2.fields["瞎编键"] === undefined && parsed2.fields.core_identity === "x");

(async ()=>{
// ---- quickGen 一次调用(桩在 vm 内定义) ----
vm.runInContext("var __qgCalls = 0; var __qgStub = async function(cfg, ms, temp){ __qgCalls++; return " + JSON.stringify(rawJson) + "; };", ctx);
vm.runInContext("var __abortStub = async function(){ throw new Error('不应被调用'); };", ctx);
const p = await vm.runInContext("RP_WRITER.quickGen('沈清辞','落魄书生',{base:'b',key:'k',model:'m'}, __qgStub)", ctx);
t("quickGen一次调用", vm.runInContext("__qgCalls", ctx) === 1);
t("quickGen返回字段", p.fields.core_identity === "落魄书生");
t("quickGen返回开场白", p.altGreetings.length === 2);
// ---- 中断 ----
const aborted = await vm.runInContext("(async function(){ try{ await RP_WRITER.quickGen('x','y',{base:'b',key:'k',model:'m'}, __abortStub, {aborted:true}); return 'no-throw'; }catch(e){ return e.message; } })()", ctx);
t("预中断抛已取消", aborted === "已取消");
// ---- quickFinish 落库 ----
vm.runInContext("RP_WRITER.quickFinish('沈清辞'," + JSON.stringify(parsed) + ")", ctx);
const found = vm.runInContext("RP_WRITER.findCustom('沈清辞')", ctx);
t("quickFinish入库", !!found && found.name === "沈清辞");
t("入库带开场白", found.altGreetings.length === 2);
t("入库带示例对话", found.exampleDialogue.indexOf("姑娘好") >= 0);
t("入库带novel", found.novel === "自定义");
console.log(`quickgen: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})();
