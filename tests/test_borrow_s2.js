const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 竞品深挖第二轮 S 级清单回归
// S-4 召回指示器 / S-5 按卡文风 / S-6 按卡温度 / S-7 高权重场景 / S-8 铁律2000 / S-9 行为标签 / S-12 按轮回溯
function mkCtx(){
const store = {};
const ls = {getItem: k => (k in store? store[k]: null),
setItem: (k, v) => { store[k] = String(v);},
removeItem: k => { delete store[k];},
key: i => Object.keys(store)[i] || null, get length(){ return Object.keys(store).length;}};
const ctx = {localStorage: ls, console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
return {ctx, store};
}
let pass = 0, fail = 0;
function t(name, cond){ if(cond){ pass++;} else { fail++; console.log("FAIL:", name);}}
/* 从源码提取顶层纯函数并 eval（防误删） */
function extractFn(src, fname){
const m = src.match(new RegExp("function " + fname + "\\([\\s\\S]*?\\n\\}"));
if(!m) throw new Error("not found: " + fname);
return m[0];
}

/* ---- S-6 按卡温度 ---- */
{
const src = fs.readFileSync(WWW + "/rp/chat.js", "utf8");
const fn = new Function("return (" + extractFn(src, "cardTempOf") + ")")();
t("卡温度覆盖全局", fn({temperature: 1.5}, 0.9) === 1.5);
t("无卡温度用全局", fn({}, 0.9) === 0.9);
t("null 用全局", fn({temperature: null}, 0.9) === 0.9);
t("超上限钳制到 2", fn({temperature: 5}, 0.9) === 2);
t("超下限钳制到 0.1", fn({temperature: 0}, 0.9) === 0.1);
}

/* ---- S-12 按轮回溯 ---- */
{
const src = fs.readFileSync(WWW + "/app.js", "utf8");
const fn = new Function("return (" + extractFn(src, "snapRewindIdx") + ")")();
const h = [{role:"user"},{role:"assistant"},{role:"user"},{role:"assistant"}];
t("点 AI 消息吸附到本轮 user", fn(h, 3) === 2);
t("点 user 消息不动", fn(h, 2) === 2);
t("点首轮 AI 吸附到首条 user", fn(h, 1) === 0);
t("全 AI 不动", fn([{role:"assistant"},{role:"assistant"}], 1) === 1);
}

/* ---- S-5/S-7/S-9 prompt 段 ---- */
{
const {ctx} = mkCtx();
vm.runInContext(fs.readFileSync(WWW + "/rp/prompt.js", "utf8") + "\n;globalThis.RP_PROMPT=RP_PROMPT;", ctx, {filename: "prompt.js"});
const PM = ctx.RP_PROMPT;
t("FLAIR 五档齐全", ["companion","roleplay","narrative","classic","minimal"].every(k => PM.FLAIR[k]));
t("flairInstr 未知档返回空", PM.flairInstr("xxx") === "");
const card = {name: "阿茶", fields: {core_identity: "茶馆老板"}, flair: "roleplay", tags: ["傲娇", "毒舌"]};
const sys = PM.buildMessages(card, {novel: "测试", history: [], sceneText: "雨夜，屋顶，两个人"}, {}).messages
.filter(m => m.role === "system").map(m => m.content).join("\n");
t("文风段进 system", sys.includes(""));
t("行为标签进 system", sys.includes("傲娇、毒舌"));
t("高权重场景进 system", sys.includes(""));
const iId = sys.indexOf("你是阿茶"), iScene = sys.indexOf("【当前场景");
t("场景段在 identity 之后", iId >= 0 && iScene > iId);
const sys2 = PM.buildMessages({name: "阿茶", fields: {}}, {novel: "t", history: []}, {}).messages
.filter(m => m.role === "system").map(m => m.content).join("\n");
t("无文风/标签/场景时不注入",!sys2.includes("【文风") &&!sys2.includes("行为标签") &&!sys2.includes("当前场景"));
}

/* ---- S-4 召回标签 + S-8 铁律 2000 ---- */
{
const {ctx, store} = mkCtx();
vm.runInContext(fs.readFileSync(WWW + "/rp/memory.js", "utf8") + "\n;globalThis.RP_MEM=RP_MEM;", ctx, {filename: "memory.js"});
const MEM = ctx.RP_MEM;
t("IRONLAW_MAX=2000", MEM.IRONLAW_MAX === 2000);
const r = MEM.saveIronLaw("r1", "阿茶", "c1", "x".repeat(2500));
t("铁律超长截断到 2000", r.saved.length === 2000 && r.truncated === true);
const st = MEM.renderBudgeted("r1", "阿茶", 1000, {cardId: "c1"});
t("renderBudgeted 返回 hits", Array.isArray(st.hits));
t("铁律命中标签", st.hits.some(x => x.label === "铁律记忆"));
t("命中标签带 pool", st.hits.every(x => x.pool && x.label));
}

console.log(`borrow_s2: ${pass} 通过, ${fail} 失败`);
process.exit(fail? 1: 0);
