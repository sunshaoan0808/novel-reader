const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P2: 外观（壁纸/字体）+ 记忆转小说风格模板
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

const ctx = {localStorage, console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/appearance.js", "utf8"), ctx, {filename: "appearance.js"});
const E = (c)=>vm.runInContext(c, ctx);

t("壁纸5个含none", E("RP_APPEAR.WALLPAPERS.length") === 5 && E("RP_APPEAR.WALLPAPERS[0].id") === "none");
t("字体3个", E("RP_APPEAR.FONTS.length") === 3);
t("默认外观", JSON.stringify(E("RP_APPEAR.getAppear()")) === JSON.stringify({wallpaper:"none",font:"system"}));
t("setAppear", JSON.stringify(E("RP_APPEAR.setAppear({wallpaper:'zhejin',font:'kai'})")) === JSON.stringify({wallpaper:"zhejin",font:"kai"}));
t("非法值回退", E("RP_APPEAR.validWallpaper('nope')") === "none" && E("RP_APPEAR.validFont('nope')") === "system");
t("setAppear非法回退", E("RP_APPEAR.setAppear({wallpaper:'xx'}).wallpaper") === "none");
t("持久化", store["nd_appear_v1"] && JSON.parse(store["nd_appear_v1"]).font === "kai");

t("小说风格3种", E("RP_APPEAR.novelStyleKeys().length") === 3);
t("默认plain", E("RP_APPEAR.getNovelStyle()") === "plain");
t("setNovelStyle", E("RP_APPEAR.setNovelStyle('gufeng')") === "gufeng" && E("RP_APPEAR.getNovelStyle()") === "gufeng");
t("非法风格回退plain", E("RP_APPEAR.setNovelStyle('xx')") === "plain");
t("风格名", E("RP_APPEAR.MEMNOVEL_STYLES.drama.name") === "戏剧化");
t("prompt含风格指令+素材", (()=>{ const p = E("RP_APPEAR.novelStylePrompt('gufeng','素材ABC')"); return p.indexOf("素材ABC") >= 0 && p.indexOf("章回") >= 0; })());
t("prompt非法key回退", E("RP_APPEAR.novelStylePrompt('xx','M').indexOf('M')") >= 0);

console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
