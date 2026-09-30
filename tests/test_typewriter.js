const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P2: 打字机效果逻辑（纯逻辑，无 DOM）
function makeLS(){
  const store = {};
  const ls = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _store: store,
  };
  return ls;
}
const localStorage = makeLS();
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

const ctx = {localStorage, console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/typewriter.js", "utf8"), ctx, {filename: "typewriter.js"});
const E = (c)=>vm.runInContext(c, ctx);

// ---- enabled / setEnabled ----
t("默认enabled为true", E("RP_TYPEWRITER.enabled()") === true);
E("RP_TYPEWRITER.setEnabled(false)");
t("setEnabled(false)生效", E("RP_TYPEWRITER.enabled()") === false);
t("配置落盘", localStorage._store["nd_rp_cfg_v1"] === JSON.stringify({typewriter:false}));
E('localStorage.setItem("nd_rp_cfg_v1", JSON.stringify({other:1}))');
E("RP_TYPEWRITER.setEnabled(true)");
t("保留其他配置字段", JSON.parse(localStorage._store["nd_rp_cfg_v1"]).other === 1
  && E("RP_TYPEWRITER.enabled()") === true);
localStorage.setItem("nd_rp_cfg_v1", "{");
t("损坏JSON默认true", E("RP_TYPEWRITER.enabled()") === true);
localStorage.removeItem("nd_rp_cfg_v1");

// ---- reducedMotion / shouldAnimate ----
t("Node下reducedMotion为false", E("RP_TYPEWRITER.reducedMotion()") === false);
t("shouldAnimate默认true", E("RP_TYPEWRITER.shouldAnimate()") === true);
t("shouldAnimate注入cfg全开", E("RP_TYPEWRITER.shouldAnimate({enabled:true, reducedMotion:false})") === true);
t("shouldAnimate注入cfg关闭", E("RP_TYPEWRITER.shouldAnimate({enabled:false, reducedMotion:false})") === false);
t("shouldAnimate注入cfg减弱动效", E("RP_TYPEWRITER.shouldAnimate({enabled:true, reducedMotion:true})") === false);
E("RP_TYPEWRITER.setEnabled(false)");
t("shouldAnimate跟随enabled()", E("RP_TYPEWRITER.shouldAnimate()") === false);
E("RP_TYPEWRITER.setEnabled(true)");

// ---- chunkText ----
function chunksOf(s){ return E("RP_TYPEWRITER.chunkText(" + JSON.stringify(s) + ")"); }
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
t("中文分段拼接还原", chunksOf("你好世界测试一下").join("") === "你好世界测试一下");
t("中文每段不超过4字", chunksOf("你好世界测试一下").every(c => Array.from(c).length <= 4));
t("英文分段拼接还原", chunksOf("hello world foo bar").join("") === "hello world foo bar");
t("英文每段不超过4字", chunksOf("hello world foo bar").every(c => Array.from(c).length <= 4));
const em = chunksOf("a\u{1F600}b中文测试");
t("emoji不被切断", em.join("") === "a\u{1F600}b中文测试"
  && em.every(c => !LONE_SURROGATE.test(c))
  && em.some(c => c.indexOf("\u{1F600}") >= 0));
t("空串返回空数组", chunksOf("").length === 0);
t("混合标点", chunksOf("你好，world！").join("") === "你好，world！");

// ---- progressFrames ----
function framesOf(s){ return E("RP_TYPEWRITER.progressFrames(" + JSON.stringify(s) + ")"); }
t("空串一帧", JSON.stringify(framesOf("")) === JSON.stringify([""]));
const sf = framesOf("你好");
t("短文逐字", sf.length === 2 && sf[0] === "你" && sf[1] === "你好");
const long2000 = "中".repeat(2000);
const lf = framesOf(long2000);
t("2000字帧数<=120", lf.length <= 120);
t("2000字末帧为全文", lf[lf.length - 1] === long2000);
t("2000字帧单调递增", lf.every((f, i) => i === 0 ? f.length > 0 : f.length > lf[i-1].length));
const mid = framesOf("ab".repeat(100)); // 200 code points
t("中等长度帧数合理", mid.length <= 60 && mid[mid.length-1] === "ab".repeat(100));
const emf = framesOf("a\u{1F600}b");
t("progressFrames代码点安全", emf.join("|").indexOf("\u{1F600}") >= 0
  && emf.every(f => !LONE_SURROGATE.test(f)));

console.log(`${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
