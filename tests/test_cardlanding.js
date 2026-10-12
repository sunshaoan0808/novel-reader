const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 卡片详情落地页回归测试 (app.js: cardOpenings/cardBadges/cardTags/cardLandingHTML)
// 只测纯函数与 HTML 生成，不依赖真实卡片数据
const APP_SRC = fs.readFileSync(WWW + "/app.js", "utf8");
function pick(names){
  // 从 app.js 源码里截取指定函数定义，拼成可独立运行的模块
  let out = "";
  for(const n of names){
    const i = APP_SRC.indexOf("function " + n + "(");
    if(i < 0) throw new Error("not found: " + n);
    let d = APP_SRC.indexOf("{", i), lvl = 0, j = d;
    for(; j < APP_SRC.length; j++){
      if(APP_SRC[j] === "{") lvl++;
      else if(APP_SRC[j] === "}"){ lvl--; if(!lvl) break; }
    }
    out += APP_SRC.slice(i, j + 1) + "\n";
  }
  return out;
}
function pickConst(n){
  const i = APP_SRC.indexOf("const " + n + " =");
  if(i < 0) throw new Error("const not found: " + n);
  let d = APP_SRC.indexOf("{", i), lvl = 0, j = d;
  for(; j < APP_SRC.length; j++){
    if(APP_SRC[j] === "{") lvl++;
    else if(APP_SRC[j] === "}"){ lvl--; if(!lvl) break; }
  }
  return APP_SRC.slice(i, j + 1) + ";\n";
}
function mkCtx(over){
  const store = {};
  const cards = {
    imp1: {name:"白月光", novel:"导入角色卡", greeting:"你来了。",
           altGreetings:["好久不见。", "你来了。", "  ", "今晚月色真美。"],
           fields:{core_identity:"温柔学姐", role_tags:"校园；纯爱；学姐"},
           raw:{tags:["校园","纯爱"]}},
    builtin: {name:"林黛玉", novel:"红楼梦",
           fields:{core_identity:"巡盐御史之女", role_tags:"诗社才女；寄居孤女"}},
  };
  const ctx = {
    console,
    RP: { findCard: (r, n)=> cards[n === "白月光" ? "imp1" : "builtin"] || null },
    RP_STATS: {
      get: ()=>({s:7, t:85, pi:128400, po:96200, fav:1, like:0, first:1, last:2}),
      avgTurns: st=>st.s ? st.t / st.s : 0,
      fmt: n=>String(n),
    },
    RP_MEM: { get: ()=>({short:[1,2,3]}) },
    RP_PROMPT: { renderFields: ()=>"- 身份：测试", LAYERS:{identity:1, core:1, speech:1, background:1} },
    window: { __DATA__: {runs:{builtin:{novel:"红楼梦"}}} },
    esc: s=>String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;"),
    localStorage: { getItem: k=>(k in store ? store[k] : null),
                    setItem: (k,v)=>{ store[k] = String(v); }, removeItem: k=>{ delete store[k]; } },
    DETAIL: {runId:"builtin", name:"林黛玉"},
    renderDetail: ()=>{},
    chatWith: ()=>{},
    chatWithOpening: ()=>{},
    toggleFavUI: ()=>{},
    toggleLikeUI: ()=>{},
    saveHist: ()=>{},
    chatKey: (r,n)=>r+"|"+n,
  };
  Object.assign(ctx, over || {});
  // window 引用自身
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  const src = fs.readFileSync(WWW + "/rp/escutil.js", "utf8") /* P0-1: 提取的函数用 jq() */
    + pickConst("BADGE_DEFS")
    + pick(["cardOpenings","cardSettingChars","cardBadges","cardTags","isChipTag","cardLandingHTML","badgeLabel"]);
  vm.runInContext(src, ctx);
  return ctx;
}
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const ctx = mkCtx();
const C = (n)=>vm.runInContext(n, ctx);

/* cardOpenings */
let ops = C("cardOpenings('imported','白月光')");
t("开场去重", ops.length === 3);                       // greeting + 2 条不重复 alt（"你来了。"去重，空白丢弃）
t("开场首条是greeting", ops[0].text === "你来了。");  // 2026-10-07: cardOpenings 改返回 {text,label}
t("内置卡无开场", C("cardOpenings('builtin','林黛玉')").length === 0);
t("找不到卡返回空", C("cardOpenings('x','不存在')").length === 0);

/* cardSettingChars */
t("设定字数累加", C("cardSettingChars({fields:{a:'12345',b:['ab','cde']}})") === 10);
t("空卡0字", C("cardSettingChars({})") === 0);

/* cardBadges */
let b1 = C("cardBadges('builtin',{},{},5000,{s:6})");
t("官方徽章", b1.includes("official"));
t("长篇设定徽章", b1.includes("longset"));
t("常玩徽章", b1.includes("regular"));
t("自创徽章", C("cardBadges('custom',{},{},10,{s:0})").includes("custom"));
t("导入徽章", C("cardBadges('imported',{},{},10,{s:0})").includes("imported"));
t("多开场徽章", C("cardBadges('imported',{},['a','b'],10,{s:0})").includes("multiop"));
t("badgeLabel映射", C("badgeLabel('official')")==="官方" && C("badgeLabel('multiop')")==="多开场");
t("徽章上限4", C("cardBadges('builtin',{},{},9999,{s:99})").length <= 4);

/* cardTags */
let tg = C("cardTags({novel:'红楼梦',fields:{role_tags:'诗社才女；寄居孤女'},raw:{tags:['红楼梦','古风']}})");
t("标签去重", tg.length === 4 && tg.includes("诗社才女") && tg.includes("古风"));

/* cardLandingHTML：导入卡（含开场） */
let html = C("cardLandingHTML('imported','白月光',RP.findCard('imported','白月光'),{novel:'导入角色卡'})");
t("落地页有CTA", html.includes("立即开始游玩"));
t("落地页有徽章", html.includes("导入") && html.includes("多开场") && html.includes("badgeTip"));
t("落地页有开场列表", html.includes("开场 · 3 个") && html.includes("chatWithOpening"));
t("落地页有玩法说明", html.includes("玩法说明"));
t("落地页有标签", html.includes("校园"));
t("落地页有规格网格", html.includes("specgrid"));
t("落地页有数据条", html.includes("开局 7 次"));
t("落地页有档案", html.includes("档案"));
t("开场点击带序号", html.includes("chatWithOpening('imported','白月光',0)"));

/* cardLandingHTML：内置卡（无开场） */
let html2 = C("cardLandingHTML('builtin','林黛玉',RP.findCard('builtin','林黛玉'),{novel:'红楼梦'})");
t("无开场显示提示", html2.includes("没有固定开场白"));
t("内置卡官方徽章", html2.includes("官方"));
t("底部CTA", (html2.match(/<button class="btn landcta"/g) || []).length === 2);

/* RP_STATS 缺失不崩 */
const ctx2 = mkCtx({RP_STATS: undefined});
const C2 = (n)=>vm.runInContext(n, ctx2);
let html3 = "";
try{ html3 = C2("cardLandingHTML('builtin','林黛玉',RP.findCard('builtin','林黛玉'),{novel:'红楼梦'})"); }catch(e){ html3 = "THREW:" + e.message; }
t("无RP_STATS不崩", html3.indexOf("THREW") !== 0 && html3.includes("立即开始游玩"));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
