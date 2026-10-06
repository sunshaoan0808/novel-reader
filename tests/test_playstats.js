const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 游玩统计回归测试 (www/rp/playstats.js)
// 1) estTokens: 空串/纯ASCII/纯中文/混合的估算值
// 2) recordSession: 开局次数累加, first/last 时间戳
// 3) recordTurn: 轮数累加, token 累加; swipe=true 只记 token 不记轮数
// 4) toggleFav/toggleLike: 开关切换
// 5) avgTurns/fmt: 平均轮数, 万级缩写
// 6) 不同卡片数据隔离
function mkCtx(){
  const store = {};
  const ctx = {
    console,
    localStorage: {
      getItem(k){ return (k in store) ? store[k] : null; },
      setItem(k, v){ store[k] = String(v); },
      removeItem(k){ delete store[k]; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(WWW + "/rp/playstats.js", "utf8"), ctx);
  ctx.RP_STATS = vm.runInContext("RP_STATS", ctx);
  return ctx;
}
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const S = mkCtx().RP_STATS;

/* 1) estTokens */
t("空串 0", S.estTokens("") === 0);
t("null 0", S.estTokens(null) === 0);
t("纯ASCII 11字≈3", S.estTokens("hello world") === 3);       // 11/4=2.75→3
t("纯中文 4字≈3", S.estTokens("你好世界") === 3);              // 4/1.5=2.67→3
t("混合≈3", S.estTokens("你好hello") === 3);                   // 2/1.5+5/4=2.58→3
t("单字至少1", S.estTokens("x") === 1);

/* 2) recordSession */
S.recordSession("r1", "林黛玉");
let st = S.get("r1", "林黛玉");
t("开局记1次", st.s === 1);
t("first/last 落盘", st.first > 0 && st.last >= st.first);
S.recordSession("r1", "林黛玉");
t("开局累加", S.get("r1", "林黛玉").s === 2);

/* 3) recordTurn */
S.recordTurn("r1", "林黛玉", "你好", "你好呀", false);
st = S.get("r1", "林黛玉");
t("轮数+1", st.t === 1);
t("输入token>0", st.pi > 0);
t("输出token>0", st.po > 0);
const tBefore = st.t, piBefore = st.pi;
S.recordTurn("r1", "林黛玉", "重抽prompt", "重抽回复", true);
st = S.get("r1", "林黛玉");
t("swipe不记轮数", st.t === tBefore);
t("swipe照记token", st.pi > piBefore);

/* 4) 收藏/点赞 */
t("收藏开", S.toggleFav("r1", "林黛玉") === 1 && S.get("r1", "林黛玉").fav === 1);
t("收藏关", S.toggleFav("r1", "林黛玉") === 0 && S.get("r1", "林黛玉").fav === 0);
t("点赞开", S.toggleLike("r1", "林黛玉") === 1);
t("点赞关", S.toggleLike("r1", "林黛玉") === 0);

/* 5) avgTurns / fmt */
t("平均轮数", S.avgTurns({s:2, t:9}) === 4.5);
t("零开局平均0", S.avgTurns({s:0, t:0}) === 0);
t("fmt万", S.fmt(34189000) === "3418.9万");
t("fmt整万", S.fmt(20000) === "2万");
t("fmt千", S.fmt(981) === "981");
t("fmt零", S.fmt(0) === "0");

/* 6) 隔离 */
S.recordSession("r1", "贾宝玉");
t("不同卡隔离", S.get("r1", "贾宝玉").s === 1 && S.get("r1", "林黛玉").s === 2);
S.recordSession("r2", "林黛玉");
t("不同run隔离", S.get("r2", "林黛玉").s === 1);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
