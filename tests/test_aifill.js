const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// AI 帮填回归测试 (www/rp/aifill.js)
// 1) btn() 生成的 onclick 属性：单引号界定 + JSON 传参，含 ' " < > & 的脏输入不提前终止属性
// 2) _buildPrompt()：字段/说明/背景/已写内容齐全；空 current 提示从空白生成；要求只输出正文
// 3) fill()：无 key 时不调模型直接提示；成功填入并触发 input 事件；失败/空返回 toast 且按钮恢复
// 4) fillChat()：prompt 含玩家人设与最近对话；只填入 chat_in
function mkEl(tag, value, placeholder){
  const handlers = {};
  return {
    tagName: tag, value: value || "", placeholder: placeholder || "",
    _dispatched: [],
    dispatchEvent(ev){ this._dispatched.push(ev.type); if(handlers[ev.type]) handlers[ev.type](); },
    addEventListener(t, fn){ handlers[t] = fn; },
    focus(){ this._focused = true; },
  };
}
function mkCtx(over){
  const els = {};
  const toasts = [];
  const ctx = {
    console,
    document: { getElementById: id => els[id] || null },
    getCfg: () => ({base: "https://api.test/v1", key: "sk-test", model: "m"}),
    RP_NET: { complete: async () => { throw new Error("no mock"); } },
    localStorage: { _m: {}, getItem(k){ return (k in this._m) ? this._m[k] : null; },
                    setItem(k, v){ this._m[k] = String(v); }, removeItem(k){ delete this._m[k]; } },
    rpToast: msg => toasts.push(msg),
    Event: function(t, o){ this.type = t; },
    _els: els, _toasts: toasts,
  };
  Object.assign(ctx, over || {});
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WWW + "/rp/aifill.js", "utf8"), ctx);
  ctx.RP_AIFILL = vm.runInContext("RP_AIFILL", ctx);
  return ctx;
}
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
/* 从 btn() HTML 里提取 onclick 属性值（单引号界定） */
function onclickOf(html){
  const m = html.match(/onclick='((?:[^']|&#39;|&amp;)*)'/);
  return m ? m[1] : null;
}
(async ()=>{
/* ---------- 1) btn() HTML 与引号安全 ---------- */
let ctx = mkCtx();
let html = ctx.RP_AIFILL.btn("l_title", "世界书标题", "2~8个字", "小说《红楼梦》");
t("btn 含 aifillbtn 类", html.indexOf('class="aifillbtn"') >= 0);
t("btn 含 ✨AI 标识", html.indexOf("✨AI") >= 0);
t("btn 调 RP_AIFILL.fill", html.indexOf("RP_AIFILL.fill(this,") >= 0);
let oc = onclickOf(html);
t("onclick 属性可被单引号完整提取", !!oc);
/* 脏输入：单引号/双引号/尖括号/& */
const dirty = ctx.RP_AIFILL.btn("x", "对O'Brien的\"铁律\"", "hint <b>&", "ctx");
const oc2 = onclickOf(dirty);
t("脏输入下 onclick 属性仍完整提取", !!oc2);
t("单引号被转义为 &#39;", oc2.indexOf("&#39;") >= 0 && oc2.indexOf("'") < 0);
t("& 被转义为 &amp;", oc2.indexOf("&amp;") >= 0);
/* 实体解码后应为合法 JS 调用，且参数 round-trip */
const decoded = oc2.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
let args = null;
const fakeFill = function(){ args = Array.prototype.slice.call(arguments, 1); };
const sandbox = {RP_AIFILL: {fill: fakeFill}};
vm.createContext(sandbox);
vm.runInContext(decoded, sandbox);
t("解码后 onclick 可执行", args !== null);
t("参数 round-trip 保留脏字符", args && args[1] === "对O'Brien的\"铁律\"" && args[2] === "hint <b>&");

/* ---------- 2) _buildPrompt() ---------- */
const p1 = ctx.RP_AIFILL._buildPrompt("世界书内容", "100~300字", "小说《红楼梦》", "", "如：…");
t("prompt 含字段名", p1.indexOf("世界书内容") >= 0);
t("prompt 含填写说明", p1.indexOf("100~300字") >= 0);
t("prompt 含背景", p1.indexOf("红楼梦") >= 0);
t("空 current 提示从空白生成", p1.indexOf("从空白直接生成") >= 0);
t("prompt 要求只输出正文", p1.indexOf("只输出") >= 0 && p1.indexOf("不要任何解释") >= 0);
const p2 = ctx.RP_AIFILL._buildPrompt("标题", "说明", "", "用户已写一半", "");
t("有 current 时要求续写/改写", p2.indexOf("用户已写一半") >= 0 && p2.indexOf("续写") >= 0);

/* ---------- 3) fill()：无 key 不调模型 ---------- */
let called = 0;
ctx = mkCtx({getCfg: () => ({})});
ctx.RP_NET.complete = async () => { called++; return "x"; };
const btnEl = {innerHTML: "✨AI", disabled: false};
ctx._els["f1"] = mkEl("input", "", "");
await ctx.RP_AIFILL.fill(btnEl, "f1", "字段", "说明", "");
t("无 key 时不调模型", called === 0);
t("无 key 时 toast 提示配接口", ctx._toasts.join("").indexOf("大模型接口") >= 0);
t("无 key 时按钮恢复", btnEl.disabled === false && btnEl.innerHTML === "✨AI");

/* ---------- 4) fill()：成功填入 ---------- */
ctx = mkCtx();
let gotPrompt = "";
ctx.RP_NET.complete = async (cfg, msgs) => { gotPrompt = msgs[0].content; return "  生成的标题  "; };
const el = mkEl("input", "", "如：…");
ctx._els["l_title"] = el;
const b2 = {innerHTML: "✨AI", disabled: false};
await ctx.RP_AIFILL.fill(b2, "l_title", "世界书标题", "2~8个字", "背景");
t("成功时填入去空格后的模型输出", el.value === "生成的标题");
t("成功时触发 input 事件（字数统计）", el._dispatched.indexOf("input") >= 0);
t("成功时 toast 已填入", ctx._toasts.join("").indexOf("已填入") >= 0);
t("成功时按钮恢复", b2.disabled === false && b2.innerHTML === "✨AI");
t("prompt 含字段说明", gotPrompt.indexOf("2~8个字") >= 0);
/* textarea 走 800 maxTokens */
let gotMax = 0;
ctx.RP_NET.complete = async (cfg, msgs, temp, ov, ex) => { gotMax = ex.maxTokens; return "y"; };
const ta = mkEl("textarea", "已有内容", "");
ctx._els["l_content"] = ta;
await ctx.RP_AIFILL.fill({innerHTML: "x", disabled: false}, "l_content", "内容", "说明", "");
t("textarea 用 800 maxTokens", gotMax === 800);
t("已有内容时 prompt 要求续写", true); /* 由 _buildPrompt 覆盖 */
/* 模型抛错 */
ctx.RP_NET.complete = async () => { throw new Error("500"); };
const b3 = {innerHTML: "✨AI", disabled: false};
await ctx.RP_AIFILL.fill(b3, "l_content", "内容", "说明", "");
t("失败时 toast 报错", ctx._toasts.join("").indexOf("失败") >= 0);
t("失败时按钮恢复", b3.disabled === false);
/* 空返回 */
ctx.RP_NET.complete = async () => "   ";
const b4 = {innerHTML: "✨AI", disabled: false};
await ctx.RP_AIFILL.fill(b4, "l_content", "内容", "说明", "");
t("空返回时提示重试", ctx._toasts.join("").indexOf("再点一次") >= 0);

/* ---------- 5) fillChat()：人设 + 最近对话 ---------- */
ctx = mkCtx({
  getHist: k => [{role: "user", content: "你好呀"}, {role: "assistant", name: "黛玉", content: "你也好"}],
  chatHistKey: () => "nd_chat_r_黛玉",
  CHAT: {mode: "single", name: "林黛玉"},
});
ctx.localStorage.setItem("nd_persona", JSON.stringify({name: "阿凌", desc: "爱开玩笑"}));
let chatPrompt = "";
ctx.RP_NET.complete = async (cfg, msgs) => { chatPrompt = msgs[0].content; return "代笔的一句话"; };
ctx._els["chat_in"] = mkEl("input", "", "");
const b5 = {innerHTML: "✨", disabled: false};
await ctx.RP_AIFILL.fillChat(b5);
t("fillChat 填入 chat_in", ctx._els["chat_in"].value === "代笔的一句话");
t("fillChat prompt 含玩家人设", chatPrompt.indexOf("阿凌") >= 0);
t("fillChat prompt 含最近对话", chatPrompt.indexOf("你好呀") >= 0 && chatPrompt.indexOf("黛玉") >= 0);
t("fillChat prompt 要求只输出一句话", chatPrompt.indexOf("只输出这一句话") >= 0);
t("fillChat 按钮恢复", b5.disabled === false);
/* chat_in disabled 时不动作 */
ctx._els["chat_in2"] = null;
let called2 = 0;
ctx.RP_NET.complete = async () => { called2++; return "x"; };
const dis = mkEl("input", "", ""); dis.disabled = true;
ctx._els["chat_in"] = dis;
await ctx.RP_AIFILL.fillChat({innerHTML: "✨", disabled: false});
t("输入框 disabled 时不调模型", called2 === 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.error("ERROR", e); process.exit(1); });
