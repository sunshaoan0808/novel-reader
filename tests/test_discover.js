const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1 发现页/开场选择器/徽章体系/分类chips 回归测试
const APP_SRC = fs.readFileSync(WWW + "/app.js", "utf8");
function pick(names){
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
const CARDS = {
  "r1|林黛玉": {name:"林黛玉", novel:"红楼梦", fields:{role_tags:"诗社才女；寄居孤女"}},
  "imported|白月光": {name:"白月光", novel:"导入角色卡", greeting:"你来了。",
    altGreetings:["好久不见。"], fields:{role_tags:"校园；纯爱"}, raw:{tags:["校园"]}},
  "custom|阿强": {name:"阿强", novel:"自创", fields:{role_tags:"都市；悬疑"}},
};
const STATS = {
  "r1|林黛玉": {s:3, t:30, pi:1, po:1, fav:0, like:0, first:1, last:300},
  "imported|白月光": {s:7, t:85, pi:1, po:1, fav:1, like:0, first:1, last:100},
  "custom|阿强": {s:0, t:0, pi:0, po:0, fav:0, like:0, first:0, last:0},
};
function mkCtx(){
  const ctx = {
    console,
    RP: { findCard: (r, n)=> CARDS[r + "|" + n] || null },
    RP_STATS: {
      get: (r, n)=> STATS[r + "|" + n] || {s:0,t:0,pi:0,po:0,fav:0,like:0,first:0,last:0},
      avgTurns: st=>st.s ? st.t / st.s : 0,
    },
    esc: s=>String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;"),
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(WWW + "/rp/escutil.js", "utf8") /* P0-1: 提取的函数用 jq() */
    + pickConst("BADGE_DEFS")
    + pick(["badgeLabel","cardBadges","cardOpenings","cardTags","isChipTag","charTagsOf",
            "tagCountsOf","recentPlayed","shuffle","railHTML","chipsHTML"]),
    ctx);
  return ctx;
}
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const ctx = mkCtx();
const C = (n)=>vm.runInContext(n, ctx);

/* shuffle */
const arr = [1,2,3,4,5,6,7,8];
const sh = C("shuffle([1,2,3,4,5,6,7,8])");
t("shuffle不丢元素", sh.length === 8 && sh.slice().sort((a,b)=>a-b).join() === "1,2,3,4,5,6,7,8");

/* recentPlayed */
const cs = [{runId:"r1",name:"林黛玉",novel:"红楼梦"},{runId:"imported",name:"白月光",novel:"导入角色卡"},{runId:"custom",name:"阿强",novel:"自创"}];
vm.runInContext("var CS = " + JSON.stringify(cs), ctx);
const rec = C("recentPlayed(CS, 8)");
t("最近玩过按last倒序", rec.length === 2 && rec[0].name === "林黛玉" && rec[1].name === "白月光");
t("没开过局的不进轨道", rec.every(x=>x.name !== "阿强"));

/* charTagsOf / tagCountsOf */
t("charTagsOf内置卡", JSON.stringify(C("charTagsOf('r1','林黛玉')")) === JSON.stringify(["红楼梦","诗社才女","寄居孤女"]));
t("charTagsOf导入卡", C("charTagsOf('imported','白月光')").indexOf("校园") >= 0);
t("charTagsOf未知卡空", C("charTagsOf('x','y')").length === 0);
const counts = C("tagCountsOf(CS)");
t("tagCountsOf计数", counts.find(x=>x.tag === "校园").n === 1);
t("tagCountsOf按数量倒序", counts.every((x,i)=> i === 0 || counts[i-1].n >= x.n));
t("tagCountsOf上限12", counts.length <= 12);

/* railHTML */
const rail = C("railHTML('最近玩过', CS.slice(0,2))");
t("轨道含角色名", rail.includes("林黛玉") && rail.includes("白月光"));
t("轨道点击开聊", rail.includes("chatWith('r1','林黛玉')"));
t("轨道横滑容器", rail.includes('class="rail"'));

/* chipsHTML */
const chips = C("chipsHTML(" + JSON.stringify(counts) + ", '', 3)");
t("chips有全部N", chips.includes("全部 3"));
t("chips带数量", chips.includes("校园") && chips.includes('<span class="n">1</span>'));
t("chips默认选中全部", chips.includes('class="pickchip on"'));
const chips2 = C("chipsHTML(" + JSON.stringify(counts) + ", '校园', 3)");
t("chips选中态", (chips2.match(/pickchip on/g) || []).length === 1 && chips2.includes("校园"));

/* 徽章体系一致性：cardBadges 产出的 id 必须在 BADGE_DEFS 里有 label+desc */
const ids = C("cardBadges('imported',{},{},9999,{s:9})")
  .concat(C("cardBadges('builtin',{},{},10,{s:0})"))
  .concat(C("cardBadges('custom',{},{},10,{s:0})"));
const defs = C("Object.keys(BADGE_DEFS)");
t("徽章id都有定义", ids.every(id=>defs.includes(id)));
t("徽章定义有label+desc", defs.every(id=>{ const d=C("BADGE_DEFS['"+id+"']"); return d.label && d.desc; }));
t("badgeLabel回退", C("badgeLabel('不存在')") === "不存在");

/* 开场选择器触发条件：多开场才弹（逻辑在 chatWith，测 cardOpenings 计数） */
t("多开场触发", C("cardOpenings('imported','白月光')").length === 2);
t("单开场不触发", C("cardOpenings('r1','林黛玉')").length <= 1);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
