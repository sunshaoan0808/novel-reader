const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// PPA 二遍对齐回归测试 (arXiv:2506.11857)
// 标记一律用 unicode 转义书写: 写入管线会剥离成对字面量, 写字面量会导致假绿/假红
const store = {};
const localStorage = {
getItem: (k)=> (k in store? store[k]: null),
setItem: (k, v)=>{ store[k] = String(v);},
removeItem: (k)=>{ delete store[k];},
};
// 浏览器环境自带定时器: harness 必须补上, 否则 withTimeout 的 Promise.race 恒走超时分支
const ctx = {console:console, window:{}, localStorage:localStorage,
setTimeout:setTimeout, clearTimeout:clearTimeout};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/ppa.js", "utf8"), ctx);
const P = vm.runInContext("window.RP_PPA", ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ if(c) pass++; else { fail++; console.log("FAIL:", n);}};
const pending = [];
const ta = (n, p)=>{ pending.push(p.then(
v=>t(n,!!v),
e=>{ fail++; console.log("FAIL:", n, "-", e && e.message);}));};

const cfg = {base:"http://x", key:"k", model:"main"};
const basis = {iron:"铁律一", arc:"弧光", profile:["画像a"], storyLine:"第3回"};
const mkCalls = ()=>{
const calls = [];
const fn = async (c, ms, tp, m)=>{ calls.push({c:c, ms:ms, tp:tp, m:m}); return fn.ret;};
fn.calls = calls; fn.ret = "";
return fn;
};
// "" 的转义写法
const DIR_EVENT = "\u3010\u5bfc\u6f14\u00b7\u4e8b\u4ef6\u3011";

/* ---------- 触发判定 ---------- */
t("off 模式不触发", P.shouldTrigger({mode:"off"}, "我们分手吧", true, true) === false);
t("always 模式触发", P.shouldTrigger({mode:"always"}, "你好", false, true) === true);
t("key 关键词触发", P.shouldTrigger({mode:"key"}, "我们分手吧", false, true) === true);
t("key 非关键词不触发", P.shouldTrigger({mode:"key"}, "今天天气不错", false, true) === false);
t("keyRound 触发", P.shouldTrigger({mode:"key"}, "你好", true, true) === true);
t("无对齐依据不触发", P.shouldTrigger({mode:"always"}, "你好", false, false) === false);
t("默认档位 key", P.shouldTrigger({}, "我们求婚吧", false, true) === true);
t("非法 mode 回退 key", P.shouldTrigger({mode:"xyz"}, "诀别", false, true) === true);
t("关键词表含分手", P.KEYWORDS.indexOf("分手") >= 0);
t("启发式如实注释", fs.readFileSync(WWW + "/rp/ppa.js", "utf8").indexOf("启发式") >= 0);
t("isKeyRound 导演事件", P.isKeyRound(DIR_EVENT + "引爆") === true);
t("isKeyRound 情节点", P.isKeyRound("本轮情节点") === true);
t("isKeyRound 普通不触发", P.isKeyRound("\u3010\u5bfc\u6f14\u3011节奏保持") === false);

/* ---------- 对齐 prompt ---------- */
const pr = P.buildAlignPrompt("黛玉", "初稿", basis);
t("prompt 含铁律标记", /\u3010\u94c1\u5f8b\u3011/.test(pr));
t("prompt 含初稿标记", /\u3010\u521d\u7a3f\u3011/.test(pr));
t("prompt 含弧光/画像/进度", pr.indexOf("人物弧光") >= 0 && pr.indexOf("画像库") >= 0 &&
pr.indexOf("故事进度") >= 0);
t("prompt 要求无违反原样返回", pr.indexOf("原样返回初稿") >= 0);
t("prompt 要求不改剧情", pr.indexOf("不改剧情走向") >= 0);

/* ---------- alignText ---------- */
ta("修正版被采用", (async()=>{
const f = mkCalls(); f.ret = "修正版";
const r = await P.alignText(f, {mode:"always"}, cfg, "黛玉", "初稿", basis);
return r.text === "修正版" && r.changed === true && f.calls.length === 1;
})());
ta("原样返回则不变", (async()=>{
const f = mkCalls(); f.ret = "初稿";
const r = await P.alignText(f, {mode:"always"}, cfg, "黛玉", "初稿", basis);
return r.text === "初稿" && r.changed === false;
})());
ta("空白差异视为无修改", (async()=>{
const f = mkCalls(); f.ret = "初稿 ";
const r = await P.alignText(f, {mode:"always"}, cfg, "黛玉", "初稿", basis);
return r.changed === false;
})());
ta("抛异常回退初稿", (async()=>{
const f = async ()=>{ throw new Error("boom");};
const r = await P.alignText(f, {mode:"always"}, cfg, "黛玉", "初稿", basis);
return r.text === "初稿" && r.changed === false;
})());
ta("空返回回退初稿", (async()=>{
const f = mkCalls(); f.ret = " ";
const r = await P.alignText(f, {mode:"always"}, cfg, "黛玉", "初稿", basis);
return r.text === "初稿" && r.changed === false;
})());
ta("空初稿不调用", (async()=>{
const f = mkCalls();
const r = await P.alignText(f, {mode:"always"}, cfg, "黛玉", " ", basis);
return r.text === " " && r.changed === false && f.calls.length === 0;
})());
ta("超时回退初稿", (async()=>{
const f = ()=> new Promise(()=>{});
const t0 = Date.now();
const r = await P.alignText(f, {mode:"always"}, cfg, "黛玉", "初稿", basis, 60);
return r.text === "初稿" && r.changed === false && (Date.now() - t0) < 5000;
})());
ta("模型选择 ppaModel 优先", (async()=>{
const f = mkCalls(); f.ret = "x";
await P.alignText(f, {mode:"always", model:"cheap", summaryModel:"sum"}, cfg, "黛", "稿", basis);
return f.calls[0].m === "cheap";
})());
ta("模型选择 summaryModel 次之", (async()=>{
const f = mkCalls(); f.ret = "x";
await P.alignText(f, {mode:"always", summaryModel:"sum"}, cfg, "黛", "稿", basis);
return f.calls[0].m === "sum";
})());
ta("模型选择缺省为 null", (async()=>{
const f = mkCalls(); f.ret = "x";
await P.alignText(f, {mode:"always"}, cfg, "黛", "稿", basis);
return f.calls[0].m == null;
})());

/* ---------- maybeAlign 编排 ---------- */
ta("maybeAlign off 返回 null", (async()=>{
const f = mkCalls();
const r = await P.maybeAlign({ppa:{mode:"off"}, userText:"分手", keyRound:true,
callChat:f, cfg:cfg, name:"黛", draft:"稿", basis:basis});
return r === null && f.calls.length === 0;
})());
ta("maybeAlign 触发并修正", (async()=>{
const f = mkCalls(); f.ret = "修正稿";
const seq = [];
const r = await P.maybeAlign({ppa:{mode:"key"}, userText:"我们分手吧", keyRound:false,
callChat:f, cfg:cfg, name:"黛", draft:"稿", basis:basis,
onAligning:(on, txt)=>seq.push([on, txt])});
return r && r.text === "修正稿" && r.changed === true && r.mode === "key" &&
seq.length === 2 && seq[0][0] === true && seq[1][0] === false && seq[1][1] === "修正稿";
})());
ta("maybeAlign 无依据跳过", (async()=>{
const f = mkCalls();
const r = await P.maybeAlign({ppa:{mode:"always"}, userText:"hi", keyRound:false,
callChat:f, cfg:cfg, name:"黛", draft:"稿", basis:{}});
return r === null && f.calls.length === 0;
})());
ta("maybeAlign 异常回退初稿", (async()=>{
const f = async ()=>{ throw new Error("x");};
const r = await P.maybeAlign({ppa:{mode:"always"}, userText:"hi", keyRound:false,
callChat:f, cfg:cfg, name:"黛", draft:"稿", basis:basis});
return r && r.text === "稿" && r.changed === false;
})());

/* ---------- 对齐记录 ---------- */
P.recordAlign("ck1", 42, true);
const la = P.lastAlign("ck1");
t("record/last 往返", la && la.len === 42 && la.changed === true);
t("last 缺省 null", P.lastAlign("nope") === null);

Promise.all(pending).then(()=>{
console.log("ppa: " + pass + " pass, " + fail + " fail");
process.exit(fail? 1: 0);
});
