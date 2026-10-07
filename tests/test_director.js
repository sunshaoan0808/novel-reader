const fs = require("fs"), vm = require("vm"), assert = require("assert");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 导演系统回归：JSON 解析/剥离、轮次触发、停滞升级、延迟事件卡、主权规则、关闭零注入
const ls = (function(){ const m = {}; return {
getItem: k => (k in m? m[k]: null),
setItem: (k, v) => { m[k] = String(v);},
removeItem: k => { delete m[k];},
clear: () => { for(const k in m) delete m[k];},
};})();
const RP_NET_CALLS = [];
const ctx = { localStorage: ls, console, Math, Date, JSON,
RP_NET: { complete: async (cfg, msgs, t, model, extra)=>{ RP_NET_CALLS.push({cfg, msgs, t, model, extra}); return ctx.__nextReply || "{}";}},
RP_WORLDSIM: { get: ()=>null,
ensure: (id, hint)=>({mode:"ancient", era:"乾隆", y:15, m:3, d:12, min:540, wx:0, places:[{id:"dgy",name:"大观园",desc:"",mood:""}]}),
fmtTime: ()=> "乾隆十五年三月十二日 巳时初", weatherName: ()=>"晴",
curPlace: (ws)=>({name:"大观园"})},
getRpCfg: ()=> ctx.__cfg || {},
icon: (n, s)=> "[icon:" + n + "]",
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/director.js", "utf8"), ctx);
const D = ctx.RP_WORLDSIM && ctx.RP_DIRECTOR;
let n = 0;
const t = (name, fn)=>{ ls.clear(); RP_NET_CALLS.length = 0; ctx.__nextReply = null; ctx.__cfg = null; const r = fn(); n++; return Promise.resolve(r).then(()=> console.log("ok -", name));};

const CFG = {base: "https://api.example/v1", key: "k", model: "main-model"};
const O = (over)=> Object.assign({cfg: CFG, history: [
{role:"user", content:"宝玉可好些了？"},
{role:"assistant", content:"（黛玉掩口一笑）你倒是惦记他。"}],
hint: {novel:"红楼梦"}, cardBrief: "林黛玉，林如海之女，敏感多思"}, over||{});

(async ()=>{
await t("JSON 解析：纯 JSON", ()=>{
const d = D.parseOutput('{"pacing":"escalate","beat":"远处传来喧哗","delayed":null,"ban":[]}');
assert.strictEqual(d.pacing, "escalate"); assert.strictEqual(d.beat, "远处传来喧哗");
});
await t("JSON 解析：带 fence 与前后废话", ()=>{
const d = D.parseOutput('好的导演：\n```json\n{"pacing":"breathe","beat":"雨声渐密"}\n```\n完毕');
assert.strictEqual(d.pacing, "breathe"); assert.strictEqual(d.beat, "雨声渐密");
});
await t("JSON 解析：非法 pacing 归一化为 continue", ()=>{
const d = D.parseOutput('{"pacing":"explode","beat":"x"}');
assert.strictEqual(d.pacing, "continue");
});
await t("JSON 解析：坏 JSON 返回 null", ()=>{
assert.strictEqual(D.parseOutput("今天天气不错"), null);
assert.strictEqual(D.parseOutput('{"pacing":}'), null);
assert.strictEqual(D.parseOutput(""), null);
});
await t("JSON 解析：延迟事件卡字段", ()=>{
const d = D.parseOutput('{"pacing":"continue","beat":"保持","delayed":{"after":3,"beat":"三日后贾母寿宴"},"ban":["不许剧透"]}');
assert.strictEqual(d.delayed.after, 3); assert.strictEqual(d.delayed.beat, "三日后贾母寿宴");
assert.deepStrictEqual(d.ban, ["不许剧透"]);
});
await t("主权规则：替玩家做决定的 beat 被过滤", ()=>{
assert.strictEqual(D.sovereignOk("你决定跟他走"), false);
assert.strictEqual(D.sovereignOk("玩家选择留下"), false);
assert.strictEqual(D.sovereignOk("你说出那句藏了很久的话"), false);
assert.strictEqual(D.sovereignOk("远处传来一阵喧哗，打破了园中的宁静"), true);
assert.strictEqual(D.sovereignOk("你身后的门被轻轻推开"), true);
assert.strictEqual(D.sovereignOk("宝玉匆匆走来，神色慌张"), true);
});
await t("轮次触发：sentinel 每 5 轮才调一次导演", async ()=>{
ctx.__nextReply = '{"pacing":"continue","beat":"保持日常"}';
for(let i = 1; i <= 4; i++){ const r = await D.onUserMessage("c1", O()); assert.strictEqual(r, "");}
assert.strictEqual(RP_NET_CALLS.length, 0);
const r5 = await D.onUserMessage("c1", O());
assert.strictEqual(RP_NET_CALLS.length, 1);
assert.ok(r5.indexOf("【导演】") >= 0 && r5.indexOf("保持日常") >= 0);
});
await t("全导演档：每轮都介入", async ()=>{
ctx.__cfg = {directorTier: "full"};
ctx.__nextReply = '{"pacing":"escalate","beat":"风声渐起"}';
await D.onUserMessage("c2", O()); await D.onUserMessage("c2", O());
assert.strictEqual(RP_NET_CALLS.length, 2);
});
await t("导演 prompt 输入含世界模拟三要素与上次指令", async ()=>{
ctx.__nextReply = '{"pacing":"continue","beat":"x"}';
await D.onUserMessage("c3", O()); // 第1轮不触发
for(let i = 0; i < 4; i++) await D.onUserMessage("c3", O()); // 到第5轮触发
const sys = RP_NET_CALLS[0].msgs[0].content;
assert.ok(sys.indexOf("乾隆十五年三月十二日 巳时初") >= 0, "时间");
assert.ok(sys.indexOf("晴") >= 0, "天气");
assert.ok(sys.indexOf("大观园") >= 0, "地点");
assert.ok(sys.indexOf("宝玉可好些了") >= 0, "近轮历史");
for(let i = 0; i < 5; i++) await D.onUserMessage("c3", O()); // 再5轮，第10轮
const sys2 = RP_NET_CALLS[1].msgs[0].content;
assert.ok(sys2.indexOf("上次导演指令") >= 0, "上次指令连贯");
});
await t("停滞强制升级：连续无波澜达到阈值强制调用", async ()=>{
ctx.__cfg = {directorEvery: 100, directorStale: 3}; // 轮次几乎不触发，靠停滞
ctx.__nextReply = '{"pacing":"continue","beat":"闲聊"}';
await D.onUserMessage("c4", O()); // r1: +1
await D.onUserMessage("c4", O()); // r2: +1
await D.onUserMessage("c4", O()); // r3: +1 -> roundsSinceEvent=3
assert.strictEqual(RP_NET_CALLS.length, 0);
ctx.__nextReply = '{"pacing":"escalate","beat":"忽有急报"}';
const r = await D.onUserMessage("c4", O()); // 强制触发
assert.strictEqual(RP_NET_CALLS.length, 1);
assert.ok(RP_NET_CALLS[0].msgs[0].content.indexOf("停滞警告") >= 0, "带停滞警告");
assert.ok(r.indexOf("忽有急报") >= 0);
const st = D.get("c4");
assert.strictEqual(st.roundsSinceEvent, 0, "升温后停滞计数清零");
});
await t("延迟事件卡：登记后 N 轮引爆且只引爆一次", async ()=>{
ctx.__cfg = {directorEvery: 1}; // 每轮都跑导演
ctx.__nextReply = '{"pacing":"continue","beat":"保持","delayed":{"after":2,"beat":"贾母派人来请"}}';
await D.onUserMessage("c5", O()); // r1: 登记 fireAt=1+2=3
let st = D.get("c5");
assert.strictEqual(st.delayed.length, 1);
ctx.__nextReply = '{"pacing":"continue","beat":"继续"}';
const r2 = await D.onUserMessage("c5", O()); // r2: 未到
assert.ok(r2.indexOf("贾母派人来请") < 0);
const r3 = await D.onUserMessage("c5", O()); // r3: 引爆
assert.ok(r3.indexOf("【导演·事件】") >= 0 && r3.indexOf("贾母派人来请") >= 0);
st = D.get("c5");
assert.strictEqual(st.delayed.length, 0, "引爆后移除");
assert.strictEqual(st.roundsSinceEvent, 0, "事件引爆重置停滞");
const r4 = await D.onUserMessage("c5", O()); // r4: 不再出现
assert.ok(r4.indexOf("贾母派人来请") < 0);
});
await t("主权越界 beat：注入时被丢弃", async ()=>{
ctx.__cfg = {directorTier: "full"};
ctx.__nextReply = '{"pacing":"escalate","beat":"你决定跟宝玉坦白一切"}';
const r = await D.onUserMessage("c6", O());
assert.ok(r.indexOf("你决定跟宝玉坦白") < 0, "越界 beat 不得注入");
});
await t("关闭后零注入零调用", async ()=>{
ctx.__cfg = {director: false, directorTier: "full"};
ctx.__nextReply = '{"pacing":"escalate","beat":"x"}';
const r = await D.onUserMessage("c7", O());
assert.strictEqual(r, ""); assert.strictEqual(RP_NET_CALLS.length, 0);
assert.strictEqual(D.briefHTML("c7"), "");
});
await t("未配 API Key 静默跳过", async ()=>{
ctx.__cfg = {directorTier: "full"};
const r = await D.onUserMessage("c8", O({cfg: {base: "https://x", key: "", model: "m"}}));
assert.strictEqual(r, ""); assert.strictEqual(RP_NET_CALLS.length, 0);
const r2 = await D.onUserMessage("c8", O({cfg: {}}));
assert.strictEqual(r2, ""); assert.strictEqual(RP_NET_CALLS.length, 0);
});
await t("导演失败不打断：异常时返回空", async ()=>{
ctx.__cfg = {directorTier: "full"};
D._complete = async ()=>{ throw new Error("boom");};
const r = await D.onUserMessage("c9", O());
assert.strictEqual(r, "");
D._complete = null;
});
await t("导演可用独立小模型", async ()=>{
ctx.__cfg = {directorTier: "full", directorModel: "cheap-mini"};
ctx.__nextReply = '{"pacing":"continue","beat":"x"}';
await D.onUserMessage("c10", O());
assert.strictEqual(RP_NET_CALLS[0].model, "cheap-mini");
});
await t("导演模型留空则用主模型", async ()=>{
ctx.__cfg = {directorTier: "full", directorModel: ""};
ctx.__nextReply = '{"pacing":"continue","beat":"x"}';
await D.onUserMessage("c10b", O());
assert.strictEqual(RP_NET_CALLS[0].model, "main-model");
});
await t("HUD：只显示风格不剧透指令", ()=>{
ctx.__cfg = {directorStyle: "wildcard"};
const h = D.briefHTML("c11");
assert.ok(h.indexOf("导演·整活") >= 0);
assert.ok(h.indexOf("clapperboard") >= 0);
});
await t("五套风格齐全", ()=>{
assert.deepStrictEqual(Object.keys(D.STYLES).sort(), ["mystery","plotdriver","slowburn","warm","wildcard"]);
});
await t("世界卡蓝图注入：有 worldcard 时进 prompt", ()=>{
ctx.getWorldcard = ()=>({directorDefinitions:[{coreConflict:"上山之争——被逼上山",
anchors:["官逼民反","忠义难全"],
nodes:[{title:"风雪山神庙", execution:"foreground"},{title:"日常闲逛", execution:"background"}]}]});
const p = D.buildPrompt("c1", D.ensure("c1"), O({runId:"shuihu_full"}));
assert.ok(p.indexOf("【原著因果蓝图】") >= 0, "有蓝图标题");
assert.ok(p.indexOf("上山之争") >= 0, "有核心冲突");
assert.ok(p.indexOf("官逼民反") >= 0, "有锚点");
assert.ok(p.indexOf("风雪山神庙") >= 0, "转折点进事件池");
assert.ok(p.indexOf("日常闲逛") < 0, "background 不进事件池");
assert.ok(p.indexOf("绝不剧透") >= 0, "有防剧透约束");
delete ctx.getWorldcard;
});
await t("世界卡蓝图注入：无 worldcard 时静默跳过", ()=>{
const p = D.buildPrompt("c1", D.ensure("c1"), O({runId:"shuihu_full"}));
assert.ok(p.indexOf("【原著因果蓝图】") < 0, "无蓝图段");
assert.ok(p.indexOf("幕后导演") >= 0, "主体 prompt 不受影响");
});
await t("世界卡蓝图注入：o 无 runId 时不崩", ()=>{
const p = D.buildPrompt("c1", D.ensure("c1"), O());
assert.ok(p.indexOf("【原著因果蓝图】") < 0);
});
console.log("\n" + n + " pass, 0 fail");
})().catch(e=>{ console.error("FAIL:", e); process.exit(1);});
