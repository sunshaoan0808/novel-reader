const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P2 回归测试：命名主题 / 每日签到 / 专辑
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

/* ---------- 命名主题 ---------- */
(function(){
  const store = {};
  const rootStyle = {};
  const ctx = {console,
    localStorage: {getItem: k=>store[k] ?? null, setItem: (k,v)=>{ store[k] = String(v); }},
    document: {documentElement: {setAttribute(){}, style: {setProperty(k,v){ rootStyle[k] = v; }}}},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WWW + "/rp/theme.js", "utf8"), ctx);
  const T = (s)=>vm.runInContext(s, ctx);
  t("主题3套", T("RP_THEME.THEMES.length") === 3);
  t("默认墨夜", T("RP_THEME.get()") === "moye");
  t("切换松烟写变量", T("RP_THEME.apply('songyan')") === "songyan" && rootStyle["--bg"] === "#0e1418");
  t("切换持久化", store["nd_theme_v1"] === "songyan" && T("RP_THEME.get()") === "songyan");
  t("非法id回退默认", T("RP_THEME.apply('nope')") === "moye");
  t("三套都有name+desc", T("RP_THEME.THEMES.every(x=>x.name&&x.desc)"));
  t("主题含关键变量", T("Object.keys(RP_THEME.def('jiangxia').vars)").includes("--gold"));
})();

/* ---------- 每日签到 ---------- */
(function(){
  const store = {};
  const ctx = {console,
    localStorage: {getItem: k=>store[k] ?? null, setItem: (k,v)=>{ store[k] = String(v); }},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WWW + "/rp/checkin.js", "utf8"), ctx);
  const C = (s)=>vm.runInContext(s, ctx);
  const today = C("RP_CHECKIN.todayStr()");
  t("日期格式", /^\d{4}-\d{2}-\d{2}$/.test(today));
  t("签到前未签", C("RP_CHECKIN.hasToday()") === false);
  const r1 = C("RP_CHECKIN.checkin()");
  t("首次签到isNew", r1.isNew === true && r1.streak === 1 && r1.total === 1);
  t("重复签到不算", C("RP_CHECKIN.checkin()").isNew === false);
  t("签到后hasToday", C("RP_CHECKIN.hasToday()") === true);
  // 造连续3天
  const d = new Date(); d.setDate(d.getDate() - 1);
  const p = (x)=>String(x).padStart(2,"0");
  const y = d.getFullYear(), m = d.getMonth()+1;
  const dd = {}; dd[today] = 1;
  dd[`${y}-${p(m)}-${p(d.getDate())}`] = 1;
  d.setDate(d.getDate() - 1); dd[`${y}-${p(m)}-${p(d.getDate())}`] = 1;
  store["nd_checkin_v1"] = JSON.stringify(dd);
  t("连击3天", C("RP_CHECKIN.streak()") === 3);
  // 断签：只留今天和3天前
  const dd2 = {}; dd2[today] = 1;
  const d3 = new Date(); d3.setDate(d3.getDate() - 3);
  dd2[`${d3.getFullYear()}-${p(d3.getMonth()+1)}-${p(d3.getDate())}`] = 1;
  store["nd_checkin_v1"] = JSON.stringify(dd2);
  t("断签连击重置为1", C("RP_CHECKIN.streak()") === 1);
  // 月历
  const cells = C("RP_CHECKIN.monthCells(2026, 9)"); // 2026-10
  t("月历7的倍数", cells.length % 7 === 0);
  t("月历含31天", cells.filter(x=>x != null).length === 31);
  t("月历周一起", cells[0] === null || cells[0] === 1); // 2026-10-01 是周四，前面3个null
  t("2026-10-01周四", cells[3] === 1);
  const ss = C("RP_CHECKIN.signedSet(2026, 9)");
  t("signedSet", typeof ss === "object");
})();

/* ---------- 专辑 ---------- */
(function(){
  const store = {};
  const imported = [];
  const custom = [];
  const ctx = {console,
    localStorage: {getItem: k=>store[k] ?? null, setItem: (k,v)=>{ store[k] = String(v); }},
    RP_CARDIMPORT: {
      find: (n)=>imported.find(c=>c.name === n) || null,
      add: (c)=>{ imported.push(c); return c; },
    },
    RP_WRITER: {
      findCustom: (n)=>custom.find(c=>c.name === n) || null,
      getCustomChars: ()=>custom,
      saveCustomChars: (l)=>{ custom.length = 0; l.forEach(x=>custom.push(x)); },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WWW + "/rp/album.js", "utf8"), ctx);
  const A = (s)=>vm.runInContext(s, ctx);
  t("初始空", A("RP_ALBUM.list()").length === 0);
  const alb = A("RP_ALBUM.create('后宫团')");
  vm.runInContext("var albId = " + JSON.stringify(alb.id), ctx);
  const AA = (x)=>A(x.replace(/alb\.id/g, "albId"));
  t("创建专辑", alb.name === "后宫团" && alb.id && AA("RP_ALBUM.list()").length === 1);
  t("超长名截断", A("RP_ALBUM.create('123456789012345678901234567890')").name.length === 24);
  t("加卡", AA("RP_ALBUM.addCard(alb.id,'r1','林黛玉')") === true);
  t("加卡去重", AA("RP_ALBUM.addCard(alb.id,'r1','林黛玉')") === false);
  t("加第二张", AA("RP_ALBUM.addCard(alb.id,'imported','白月光')") === true);
  t("专辑2张卡", AA("RP_ALBUM.get(alb.id)").cards.length === 2);
  t("移除卡", AA("RP_ALBUM.removeCard(alb.id,'r1','林黛玉')") === true);
  t("移除后1张", AA("RP_ALBUM.get(alb.id)").cards.length === 1);
  t("改名", AA("RP_ALBUM.rename(alb.id,'克苏鲁小队')") === true && AA("RP_ALBUM.get(alb.id)").name === "克苏鲁小队");
  // 导出
  vm.runInContext(`RP_CARDIMPORT.add({name:"白月光", fields:{a:"1"}, greeting:"hi"})`, ctx);
  const exp = AA("RP_ALBUM.exportData(alb.id)");
  t("导出结构", exp.kind === "album" && exp.version === 1 && exp.album.name === "克苏鲁小队");
  t("导出带导入卡全量", exp.cards[0].card && exp.cards[0].card.name === "白月光");
  // 内置卡只存引用
  AA("RP_ALBUM.addCard(alb.id,'honglou_full','贾宝玉')");
  const exp2 = AA("RP_ALBUM.exportData(alb.id)");
  t("内置卡存引用", exp2.cards.some(c=>c.ref && c.ref.name === "贾宝玉"));
  // 导入
  imported.length = 0;
  const r2 = vm.runInContext(`RP_ALBUM.importData(${JSON.stringify(exp2)})`, ctx);
  t("导入建专辑", r2.added === 2 && typeof r2.albumId === "string");
  t("导入落卡去重", vm.runInContext("RP_CARDIMPORT.find('白月光')", ctx) !== null);
  t("导入非法抛错", (()=>{ try{ A("RP_ALBUM.importData({kind:'nope'})"); return false; }catch(e){ return true; } })());
  // 删除专辑
  A(`RP_ALBUM.remove('${alb.id}')`);
  t("删除专辑", AA("RP_ALBUM.list()").every(x=>x.id !== alb.id));
})();

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
