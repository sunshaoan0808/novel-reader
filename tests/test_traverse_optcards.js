const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 回归: 穿越模式剧情选项卡(2026-09-30 用户抓包: 穿越聊天没有选项)
// 根因: app.js 穿越分支没把 optCards/optCount/optMood 透传给 sendTraverse,
// 且 sendTraverse 也不像 send/sendGroup 那样注入指令。
let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n));};

let lastBody = null;
const ctx = { console};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.fetch = (url, init) => {
lastBody = JSON.parse(init.body);
return Promise.resolve({ ok: true,
json: () => Promise.resolve({ choices: [{ message: { content: "正文"}}]})});
};
vm.createContext(ctx);
vm.runInContext(`
var RP_TRAVERSE = {
get: id => ({ id: id, worldName: "红楼梦", worldKind: "book", worldId: "r1",
anchorTitle: "黛玉进府", mode: "soul", charName: "林黛玉"}),
buildMessages: (trav, c, b) =>
({ messages: [{ role: "system", content: "SYS"}], preview: "SYS", stats: {}}),
parseWsBlock: r => ({ patch: null, clean: r}),
getState: id => ({}), saveState(){}, mergeState: (s, p) => s,
};
var RP_MEM = { maybeAnalyze(){ return Promise.resolve();},
renderPrompt: () => "", get: () => null};
`, ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/chat.js", "utf8"), ctx, { filename: "chat.js"});

const cfg = { base: "http://x", key: "k", model: "m" };
ctx.cfg = cfg;
(async () => {
// 1. 开关打开 -> system 首条注入选项指令
await vm.runInContext(
`RP.sendTraverse("t1", "你好", { cfg: cfg, stream: false, history: [], optCards: true, optCount: 4, optMood: "none" })`,
ctx);
const sys1 = lastBody.messages[0];
t("optCards=true 时注入选项指令", sys1.role === "system" && sys1.content.includes("【剧情选项】"));
t("选项指令含引导语格式", sys1.content.includes("请选择你的下一步行动"));

// 2. 开关关闭 -> 不注入
await vm.runInContext(
`RP.sendTraverse("t1", "你好", { cfg: cfg, stream: false, history: [], optCards: false})`,
ctx);
const sys2 = lastBody.messages[0];
t("optCards=false 时不注入", !sys2.content.includes("【剧情选项】"));

// 3. app.js 穿越分支把开关透传给 sendTraverse
const appSrc = fs.readFileSync(WWW + "/app.js", "utf8");
const m = appSrc.match(/sendTraverse\(CHAT\.travId, text, \{([\s\S]*?)\}\)/);
t("穿越分支存在",!!m);
if (m) {
t("透传 optCards", /optCards:\s*sendOpts\.optCards/.test(m[1]));
t("透传 optCount", /optCount:\s*sendOpts\.optCount/.test(m[1]));
t("透传 optMood", /optMood:\s*sendOpts\.optMood/.test(m[1]));
}

// 4. 渲染侧: 选项卡解析点不对穿越设限(单聊/群聊/穿越共用消息构建器)
const oci = appSrc.indexOf("const oc = parseOptCard(m.content);");
t("找到选项渲染点", oci > 0);
if (oci > 0) {
const around = appSrc.slice(Math.max(0, oci - 300), oci);
t("选项渲染不对穿越设限", !/traverse/.test(around));
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
})().catch(e => { console.log("ERROR", e); process.exit(1);});
