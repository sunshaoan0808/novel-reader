const fs = require("fs"), vm = require("vm"), path = require("path");
// 回归测试: 卡片落地页开场列表渲染 [object Object] (www/app.js cardLandingHTML)
// 背景: cardOpenings() 返回 [{text,label}] 对象(P1 起加了情境标签),
//       cardLandingHTML 曾经把元素当字符串用 g.length / g.slice / esc(prev),
//       于是整列表渲染成 "[object Object]"。
// 这里断言: 列表里是真实开场文本, 且点击下标与 cardOpenings 下标严格对齐
// (chatWithOpening 按下标取开场, 错位会把别的开场送进首条消息)。
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const APP_SRC = fs.readFileSync(path.join(WWW, "app.js"), "utf8");

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
/* window.chatWithOpening = (runId, name, idx)=>{...}  取箭头函数那段 */
function pickArrowAssign(name){
  const i = APP_SRC.indexOf("window." + name + " =");
  if(i < 0) throw new Error("not found: window." + name);
  let d = APP_SRC.indexOf("{", i), lvl = 0, j = d;
  for(; j < APP_SRC.length; j++){
    if(APP_SRC[j] === "{") lvl++;
    else if(APP_SRC[j] === "}"){ lvl--; if(!lvl) break; }
  }
  return APP_SRC.slice(i, j + 1) + ";\n";
}

const LONG = "长".repeat(100);
const CARDS = {
  "白月光": {
    name:"白月光", novel:"导入角色卡", greeting:"你来了。",
    altGreetings:["好久不见。", "你来了。", "  ", "今晚月色真美。", LONG],
    fields:{core_identity:"温柔学姐", role_tags:"校园；纯爱"},
  },
};
/* 管线 openings.json: 带情境标签的对象条目 */
const OPENINGS_JSON = {imported:{"白月光":[
  {text:"雨夜你敲响了门", situation:"雨夜"},
  {text:"校园祭的早晨", situation:"祭典"},
]}};
const LONG_TXT = LONG.slice(0,72) + "…";

function mkCtx(){
  const store = {};
  const started = [];
  const ctx = {
    console,
    RP: { findCard: (r, n)=> CARDS[n] || null },
    RP_STATS: { get: ()=>({s:7, t:85, pi:128400, po:96200, fav:1, like:0}),
                avgTurns: st=> st.s ? st.t/st.s : 0, fmt: n=>String(n) },
    RP_MEM: { get: ()=>({short:[1,2,3]}) },
    RP_PROMPT: { renderFields: ()=>"- 身份：测试", LAYERS:{identity:1,core:1,speech:1,background:1} },
    esc: s=>String(s == null ? "" : s),
    localStorage: { getItem: k=>(k in store ? store[k] : null),
                    setItem: (k,v)=>{ store[k] = String(v); }, removeItem: k=>{ delete store[k]; } },
    DETAIL:{runId:"imported", name:"白月光"},
    renderDetail: ()=>{}, chatWith: ()=>{},
    toggleFavUI: ()=>{}, toggleLikeUI: ()=>{},
    /* chatWithOpening 的三个依赖 */
    startChat: (r,n)=> started.push([r,n]),
    openSheet: ()=>{},
    __started: started,
  };
  /* 让 window === globalThis，使得 window.xxx 赋值成为全局（供 picked 源码使用） */
  ctx.window = ctx;
  ctx.window.__DATA__ = {runs:{imported:{novel:"导入角色卡", openings: OPENINGS_JSON.imported}}};
  ctx.chatKey = (r,n)=> r+"|"+n;
  ctx.saveHist = (k,h)=> { ctx.__savedHist = [k,h]; };
  vm.createContext(ctx);
  vm.runInContext(
      fs.readFileSync(path.join(WWW, "rp/escutil.js"), "utf8")
    + pickConst("BADGE_DEFS")
    + pick(["cardOpenings","cardSettingChars","cardBadges","cardTags","isChipTag","cardLandingHTML","badgeLabel"])
    + pickArrowAssign("chatWithOpening")
    + pickArrowAssign("pickOpening")
    , ctx);
  return ctx;
}
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

const ctx = mkCtx();
const C = (s)=> vm.runInContext(s, ctx);

/* ---- 前提: cardOpenings 返回对象数组 ---- */
const ops = C("cardOpenings('imported','白月光')");
// greeting + 去重后 2 条短 alt + 1 条长 alt + 2 条管线开场
t("开场数", ops.length === 6);
t("开场是对象", typeof ops[0] === "object" && typeof ops[0].text === "string");

const html = C("cardLandingHTML('imported','白月光',RP.findCard('imported','白月光'),{novel:'导入角色卡'})");
/* 只取第 5 段"开场列表"(到"玩法说明"为止), 避免把别处的文案算进来 */
const seg = html.slice(html.indexOf("开场 ·"), html.indexOf("玩法说明"));
t("落地页渲染了开场列表", seg.startsWith("开场 · 6 个"));

/* ---- 本 bug 的核心断言 ---- */
t("开场列表不含 [object Object]", seg.indexOf("[object Object]") === -1);
t("开场列表含 greeting 原文", seg.includes("你来了。"));
t("开场列表含 altGreetings 原文", seg.includes("好久不见。") && seg.includes("今晚月色真美。"));
t("开场列表含管线开场原文", seg.includes("雨夜你敲响了门") && seg.includes("校园祭的早晨"));
t("超长开场截断 72 字加省略号", seg.includes(LONG_TXT) && seg.indexOf("长".repeat(73)) === -1);

const rendered = (seg.match(/<div class="opn-text">([\s\S]*?)<\/div>/g) || [])
  .map(x=> x.replace(/^<div class="opn-text">/, "").replace(/<\/div>$/, ""));
t("渲染条数与开场数一致", rendered.length === ops.length);
t("渲染顺序与 cardOpenings 下标对齐",
  rendered.length === ops.length && rendered.every((s,i)=> s === (ops[i].text.length > 72 ? LONG_TXT : ops[i].text)));

/* ---- 点击下标必须与 cardOpenings 下标一致(chatWithOpening 按下标取开场) ---- */
const idxs = (seg.match(/chatWithOpening\('imported','白月光',(\d+)\)/g) || [])
  .map(x=> +/(\d+)\)$/.exec(x)[1]);
t("点击下标连续且与开场同序",
  idxs.length === ops.length && idxs.every((v,i)=> v === i));

/* ---- chatWithOpening 本身: 下标原样传给首条开场, 不被本次改动影响 ---- */
for(let i = 0; i < ops.length; i++){
  ctx.__started.length = 0;
  ctx.window.chatWithOpening("imported", "白月光", i);
  t("chatWithOpening 记住下标 " + i, ctx.window.__pendingOpening === i);
  t("chatWithOpening 用原 runId/name 起聊 " + i,
    ctx.__started.length === 1 && ctx.__started[0][0] === "imported" && ctx.__started[0][1] === "白月光");
  /* 复刻 showChat 消费 pendingOpening 的那一步(app.js: _ops[_po].text) */
  const pending = ctx.window.__pendingOpening;
  const ops2 = C("cardOpenings('imported','白月光')");
  t("下标取回的开场与落地页第 " + i + " 条一致", !!ops2[pending] && ops2[pending].text === ops[i].text);
}

/* pickOpening 传具体下标时原样透传(随机分支不在本 bug 范围) */
ctx.__started.length = 0;
ctx.window.pickOpening("imported", "白月光", 3);
t("pickOpening 透传下标", ctx.window.__pendingOpening === 3);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
