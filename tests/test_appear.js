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

/* ---- UI视觉检查回归：次级文字对比度 WCAG 4.5:1 底线 ---- */
(function(){
  const css = fs.readFileSync(WWW + "/style.css", "utf8");
  const lum = (h)=>{ const v=[0,2,4].map(i=>parseInt(h.slice(1+i,3+i),16)/255)
    .map(c=>c>0.03928?Math.pow((c+0.055)/1.055,2.4):c/12.92);
    return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]; };
  const cr = (a,b)=>{ const x=lum(a),y=lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
  const faint = (css.match(/--ink-faint:(#[0-9a-f]{6})/)||[])[1];
  t("--ink-faint存在", !!faint);
  if(faint){
    t("faint在#12100d上≥4.5:1", cr(faint,"#12100d") >= 4.5);
    t("faint在#1d1915上≥4.5:1", cr(faint,"#1d1915") >= 4.5);
    t("faint在#23201b上≥4.5:1", cr(faint,"#23201b") >= 4.5);
  }
  t("有::placeholder显式色", /::placeholder\s*\{[^}]*color:/.test(css));
  t("气泡行高≥1.4", /\.bubble\{[^}]*line-height:([0-9.]+)/.test(css) && parseFloat(css.match(/\.bubble\{[^}]*line-height:([0-9.]+)/)[1]) >= 1.4);
})();

console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
