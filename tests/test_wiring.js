// test_wiring.js: P2 / 穿越 P1-P3 接线静态回归测试
// 保证脚本加载顺序、UI 接线字符串、样式类不被后续修改误删
const fs = require("fs");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const read = p=>fs.readFileSync(WWW+"/"+p, "utf8");
const html = read("index.html"), app = read("app.js"), css = read("style.css"), store = read("rp/store.js");

let pass = 0, fail = 0;
const t = (n, c)=>{ c? pass++: (fail++, console.log("FAIL:", n)); };

// --- 脚本加载顺序 ---
const order = ["rp/typewriter.js","rp/store.js","rp/appearance.js","rp/traverse.js","rp/traverse2.js"];
const idx = order.map(s=>html.indexOf(`src="${s}"`));
const appIdx = html.indexOf('src="app.js"');
t("脚本全部加载", idx.every(i=>i >= 0));
t("traverse2在traverse之后", idx[3] >= 0 && idx[4] > idx[3]);
t("新脚本都在app.js之前", idx.every(i=>i >= 0 && i < appIdx));
/* P0-1: jq() 转义工具必须在 app.js 之前加载 */
const escIdx = html.indexOf('src="rp/escutil.js"');
t("escutil在app.js之前", escIdx >= 0 && escIdx < appIdx);

// --- P2 接线 ---
t("设置页接typewriter", app.indexOf("RP_TYPEWRITER") >= 0);
t("设置页接appearance", app.indexOf("RP_APPEAR") >= 0);
t("设置页接store", app.indexOf("RP_STORE") >= 0);
t("打字机选择器正确", app.indexOf('$("#chatlog")') >= 0);
t("聊天记录双写", app.indexOf("syncBig") >= 0 && app.indexOf("cacheGet") >= 0);
t("小说风格prompt", app.indexOf("novelStylePrompt") >= 0);
t("清理入口", app.indexOf("storeCleanup") >= 0);
t("壁纸样式", ["xuanmo","daiqing","zhejin","zitan"].every(w=>css.indexOf(`data-wallpaper="${w}"`) >= 0));
t("打字机光标样式", css.indexOf(".twcur") >= 0);

// --- 穿越 P1 接线 ---
t("身份重随", app.indexOf("bodyReroll") >= 0);
t("携带物使用", app.indexOf("travUseItem") >= 0);
t("出戏值检测", app.indexOf("travOocCheck") >= 0);
t("出戏值展示", app.indexOf("出戏值") >= 0);
t("世界补完", app.indexOf("travWorldComplete") >= 0);
// --- 穿越 P2 接线 ---
t("异世界入口", app.indexOf("isekaiPickSrc") >= 0 && app.indexOf("isekaiStart") >= 0);
t("水浒待接入提示", app.indexOf("数据待接入") >= 0);
// --- 穿越 P3 接线 ---
t("组团入口", app.indexOf("partySetup") >= 0 && app.indexOf("partyStart") >= 0);
t("队伍页", app.indexOf("travPartyView") >= 0);
t("组团prompt", app.indexOf("travExtraPrompt") >= 0);
// --- traverse2 模块 ---
t("traverse2注册表", read("rp/traverse2.js").indexOf("WORLD_REGISTRY") >= 0);
// --- store 新语义 ---
t("复制模式标记", store.indexOf("nd_idbcopied_") >= 0);
t("清理API", store.indexOf("cleanupCopied") >= 0);
t("样式类", [".linkbtn",".charcard.sel",".ooc"].every(c=>css.indexOf(c) >= 0));

console.log(`wiring: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
