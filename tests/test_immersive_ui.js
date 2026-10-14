const fs = require("fs");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 沉浸式聊天 UI 回归: M3 回到底部按钮 / M4 长文本折叠 / M6 改写 / S5 去时间戳 / S6 姓名行条件显示
const src = fs.readFileSync(WWW + "/app.js", "utf8");
const css = fs.readFileSync(WWW + "/style.css", "utf8");

let pass = 0, fail = 0;
function ok(name, cond){
if(cond){ pass++;}
else { fail++; console.log("FAIL:", name);}
}

// 从 app.js 抽取函数体(括号配平)
function extract(startMark){
const s = src.indexOf(startMark);
if(s < 0) throw new Error("not found: " + startMark);
let d = 0, i = s + startMark.length - 1;
for(; i < src.length; i++){
if(src[i] === "{") d++;
else if(src[i] === "}"){
d--;
if(d === 0) break;
}
}
return src.slice(s, i + 1) + ";";
}

/* ---------- M4: foldToggle ---------- */
const foldSrc = extract("window.foldToggle = (btn)=>{");
function makeBtn(){
const cls = new Set(["bubble", "foldable", "collapsed"]);
return {
cls,
btn: {
closest: () => ({ classList: {
toggle: (c)=>{ const had = cls.has(c); if(had) cls.delete(c); else cls.add(c); return !had; }
}}),
textContent: "展开全文"
}
};
}
const foldFn = new Function("window", foldSrc + "\nreturn window.foldToggle;")({});
{
const t = makeBtn();
foldFn(t.btn);
ok("M4 折叠->展开: 去掉 collapsed, 按钮变收起", !t.cls.has("collapsed") && t.btn.textContent === "收起");
foldFn(t.btn);
ok("M4 展开->折叠: 加回 collapsed, 按钮变展开全文", t.cls.has("collapsed") && t.btn.textContent === "展开全文");
}
// 模板里长消息走折叠结构
ok("M4 模板: needFold 阈值 + foldable collapsed + foldbody",
src.indexOf("needFold") >= 0 && src.indexOf("foldable collapsed") >= 0 && src.indexOf("foldbody") >= 0);
ok("M4 CSS: collapsed 时 max-height + 底部渐隐",
css.indexOf(".bubble.foldable.collapsed .foldbody") >= 0 && css.indexOf("max-height:210px") >= 0);

/* ---------- M3: 回到底部按钮 ---------- */
const toBottomSrc = extract("function ensureToBottom(){");
{
let appended = null;
const fakeBtn = { id: "", setAttribute(){}, onclick: null };
const fakeWrap = { appendChild: (b)=>{ appended = b; } };
const fakeDoc = {
querySelector: (sel)=> sel === ".chatwrap" ? fakeWrap : null,
getElementById: (id)=> id === "tobottom" ? appended : null,
createElement: ()=>Object.assign({}, fakeBtn)
};
const fn = new Function("document", toBottomSrc + "\nreturn ensureToBottom;")(fakeDoc);
fn();
ok("M3 ensureToBottom 在 .chatwrap 内创建 #tobottom", appended && appended.id === "tobottom");
let scrolled = 0;
const fakeLog = { set scrollTop(v){ scrolled = v; }, get scrollTop(){ return 0; }, scrollHeight: 999 };
fakeDoc.getElementById = (id)=> id === "tobottom" ? appended : (id === "chatlog" ? fakeLog : null);
appended.onclick();
ok("M3 点击回到底部: chatlog 滚到底", scrolled === 999);
}
ok("M3 onScroll: 离底>200 显示按钮", src.indexOf('tb.classList.toggle("show", dist > 200)') >= 0);
ok("M3 CSS: #tobottom 44px 圆形 + .show 浮现", css.indexOf("#tobottom") >= 0 && css.indexOf("#tobottom.show") >= 0);

/* ---------- M8: AI 水印（顶栏名字旁） ---------- */
ok("M8 顶栏 AI 水印: 单聊/群聊/穿越 cname 均带 .aimark",
(src.match(/<span class="aimark">AI<\/span>/g) || []).length >= 3
&& css.indexOf(".aimark") >= 0);

/* ---------- M6: 改写 ---------- */
const rewriteSrc = extract("window.rewriteMsg = async (idx)=>{");
function makeRewriteHarness(completeImpl){
const msgs = [{ role: "assistant", content: "原文内容" }];
const calls = { saved: 0, rendered: 0 };
const h = {
chatHistKey: () => "k",
getHist: () => msgs,
saveHist: () => { calls.saved++; },
renderChat: () => { calls.rendered++; },
getCfg: () => ({ key: "k", base: "b", model: "m" }),
RP_NET: { complete: completeImpl },
msgSheet: () => {},
alert: () => {},
document: { getElementById: () => null },
window: {},
};
/* P2-2: rewriteMsg 现在与在飞流互斥（STREAMING/REWRITING/rpToast），harness 补注入 */
const fn = new Function(
"chatHistKey", "getHist", "saveHist", "renderChat", "getCfg", "RP_NET", "msgSheet", "alert", "document", "window",
"STREAMING", "REWRITING", "rpToast",
rewriteSrc + "\nreturn window.rewriteMsg;");
h.rewriteMsg = fn(h.chatHistKey, h.getHist, h.saveHist, h.renderChat, h.getCfg,
h.RP_NET, h.msgSheet, h.alert, h.document, h.window,
false, false, ()=>{});
return { h, msgs, calls };
}
(async ()=>{
// 成功路径
{
const { h, msgs, calls } = makeRewriteHarness(async ()=>"改写后的内容");
await h.rewriteMsg(0);
ok("M6 改写成功: 内容被替换", msgs[0].content === "改写后的内容");
ok("M6 改写成功: 原文进 candidates, ci 指向新文",
Array.isArray(msgs[0].candidates) && msgs[0].candidates[0] === "原文内容"
&& msgs[0].candidates[msgs[0].ci] === "改写后的内容");
ok("M6 改写成功: 落盘 + 重渲染", calls.saved === 1 && calls.rendered === 1);
}
// 失败路径: LLM 抛错, 原文不动, 仍重渲染恢复
{
const { h, msgs, calls } = makeRewriteHarness(async ()=>{ throw new Error("net"); });
await h.rewriteMsg(0);
ok("M6 改写失败: 原文保留", msgs[0].content === "原文内容");
ok("M6 改写失败: 不落盘但重渲染", calls.saved === 0 && calls.rendered === 1);
}
// 警告消息不可改写
{
const { h, msgs } = makeRewriteHarness(async ()=>"x");
msgs[0].content = "⚠️ 警告内容";
await h.rewriteMsg(0);
ok("M6 警告消息跳过改写", msgs[0].content === "⚠️ 警告内容");
}
// 长按菜单有改写入口(仅可改写消息)
ok("M6 长按菜单: rewritable  gating + 改写项",
src.indexOf("rewritable") >= 0 && src.indexOf("rewriteMsg(${jq(idx)})") >= 0 /* P0-1: 已改 jq() 转义 */
&& src.indexOf('m.content.indexOf("⚠️")!==0') >= 0);

/* ---------- S5/S6: 模板 ---------- */
ok("S5 去时间戳: 模板无 .ts 渲染", src.indexOf('<div class="ts">') < 0);
ok("S6 姓名行: 只在群聊渲染 (showWho gating)",
src.indexOf("showWho") >= 0 && src.indexOf('showWho?`<div class="who">') >= 0
&& src.indexOf('const showWho = CHAT.mode==="group"') >= 0);

/* ---------- S1/S2/S3/S7/S8: 气泡 CSS ---------- */
/* P0-28：字号改写成 calc(Npx * var(--fs))，断言跟着改成"16px 基准 × 倍率" */
ok("S1 字号行高: 16px 基准/24px 行高", /font-size:calc\(16px \* var\(--fs\)\); line-height:24px/.test(css));
ok("S2 圆角12px 无阴影", css.indexOf("border-radius:12px") >= 0 && /\.bubble\{[^}]*box-shadow:none/.test(css));
ok("S3 内边距 10px 16px", css.indexOf("padding:10px 16px") >= 0);
ok("S7/S8 纸感化: AI 白5% / 用户金13%", css.indexOf("rgba(255,255,255,.05)") >= 0 && css.indexOf("rgba(212,162,78,.13)") >= 0);
ok("S9 流式渐隐: #live mask", css.indexOf("#live{") >= 0 && css.indexOf("mask-image:linear-gradient(to bottom,#000 55%,transparent 100%)") >= 0);

/* ---------- L1: 打字机点按快进 ---------- */
const twStopSrc = extract("function twStop(){");
const twFinishSrc = extract("window.twFinish = ()=>{");
{
let cleared = 0, rendered = 0;
const sandbox = {
TW: { timer: 123, key: "k", idx: 0 },
clearInterval: (t)=>{ cleared++; },
renderChat: ()=>{ rendered++; },
window: {}
};
const run = new Function("TW", "clearInterval", "renderChat", "window",
twStopSrc + "\n" + twFinishSrc + "\nreturn window.twFinish;");
const twFinish = run(sandbox.TW, sandbox.clearInterval, sandbox.renderChat, sandbox.window);
twFinish();
ok("L1 twFinish: 停定时器 + 整页重渲染出全文", cleared === 1 && rendered === 1 && sandbox.TW.timer === null);
cleared = 0; rendered = 0;
twFinish();
ok("L1 twFinish: 无定时器时不重渲染", cleared === 0 && rendered === 0);
}
ok("L1 点按气泡打断: toggleTools 在打字机进行中调 twFinish",
src.indexOf("TW.timer && TW.idx===idx){ twFinish(); return; }") >= 0);

/* ---------- L2: 背景压暗状态机 ---------- */
const dimSrc = extract("const DimState = {");
{
const body = { dataset: {} };
const sandbox = { document: { body }, window: {} };
const DimState = new Function("document", "window", dimSrc + "\nreturn DimState;")(sandbox.document, sandbox.window);
ok("L2 初始状态 chat", DimState.cur === "chat");
DimState.set("sheet");
ok("L2 set(sheet): 状态切换 + body data-dimstate", DimState.cur === "sheet" && body.dataset.dimstate === "sheet");
DimState.set("sheet");
ok("L2 重复 set 不重复写 DOM", body.dataset.dimstate === "sheet");
DimState.set("chat");
ok("L2 set(chat): 恢复", DimState.cur === "chat" && body.dataset.dimstate === "chat");
}
ok("L2 msgSheet 联动状态机", src.indexOf('DimState.set(on ? "sheet" : "chat")') >= 0);
ok("L2 切页重置压暗", src.indexOf("msgSheet(false); }catch(e){} /* L2") >= 0);
ok("L2 CSS: .bgdim 压暗层 + sheet 态加深", css.indexOf(".chatbg .bgdim") >= 0
&& css.indexOf('body[data-dimstate="sheet"] .chatbg .bgdim') >= 0);
ok("L2 模板含 bgdim 层", src.indexOf('<div class="bgdim"></div>') >= 0);

/* ---------- L3: markdown 白名单 ---------- */
const mdSrc = extract("function md(src){");
{
const escFn = (s)=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const md = new Function("esc", mdSrc + "\nreturn md;")(escFn);
ok("L3 加粗", md("**粗**").indexOf("<b>粗</b>") >= 0);
ok("L3 行内代码", md("`c`").indexOf("<code>c</code>") >= 0);
ok("L3 标题只到 h3", md("#### x").indexOf("<h4>") < 0 && md("### x").indexOf("<h3>") >= 0);
ok("L3 引用", md("> q").indexOf("<blockquote>") >= 0);
ok("L3 列表", md("- a").indexOf("<li>a</li>") >= 0);
ok("L3 XSS: 原始 HTML 被转义", md("<script>alert(1)</script>").indexOf("<script>") < 0
&& md("<script>alert(1)</script>").indexOf("&lt;script&gt;") >= 0);
ok("L3 无链接/图片标签", md("[a](http://x)").indexOf("<a") < 0 && md("![a](x)").indexOf("<img") < 0);
}
ok("L3 CSS: 气泡内 h1-h3/blockquote 收敛排版",
css.indexOf(".bubble h1,.bubble h2,.bubble h3") >= 0 && css.indexOf(".bubble blockquote") >= 0);

console.log(`\nimmersive-ui: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})();
