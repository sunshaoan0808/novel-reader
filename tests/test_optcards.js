const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 从 app.js / chat.js 抽取纯函数做单元测试 (不依赖 DOM)
const appSrc = fs.readFileSync(WWW+"/app.js", "utf8");
const chatSrc = fs.readFileSync(WWW+"/rp/chat.js", "utf8");
function extract(src, name){
  // 提取 function name(...) {...} (顶层函数, 大括号配对)
  const re = new RegExp("(?:function\\s+" + name + "|(?:let|const|var)\\s+" + name + "\\s*=\\s*function)\\s*\\(");
  const m = src.match(re);
  if(!m) throw new Error("not found: " + name);
  let i = m.index + m[0].length, depth = 1;
  // 回到 { 处
  let j = src.indexOf("{", m.index); depth = 0;
  for(let k = j; k < src.length; k++){
    if(src[k] === "{") depth++;
    else if(src[k] === "}"){ depth--; if(!depth){ return src.slice(m.index, k+1); } }
  }
  throw new Error("unbalanced: " + name);
}
const ctx = {console, esc: (x)=>String(x)};
vm.createContext(ctx);
vm.runInContext(extract(appSrc, "parseOptCard"), ctx);
vm.runInContext(extract(appSrc, "optCardHTML"), ctx);
vm.runInContext(extract(appSrc, "stRegexToRule"), ctx);
vm.runInContext(extract(chatSrc, "applyRegex"), ctx);
// 剧情选项指令 v21: 函数化 (数量 2-6 + 氛围), 顺带抽取依赖的常量
const em = chatSrc.match(/var OPT_NUM_EMOJI = ([^;]+);/);
const cnm = chatSrc.match(/var OPT_NUM_CN = ([^;]+);/);
const mm = chatSrc.match(/var OPT_MOODS = (\{[\s\S]*?\n\});/);
vm.runInContext("var OPT_NUM_EMOJI = " + em[1] + ";", ctx);
vm.runInContext("var OPT_NUM_CN = " + cnm[1] + ";", ctx);
vm.runInContext("var OPT_MOODS = " + mm[1] + ";", ctx);
vm.runInContext(extract(chatSrc, "optCardsInstr"), ctx);
vm.runInContext(`var OPTCARDS_INSTR = optCardsInstr(4, "none");`, ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const E = (code)=>vm.runInContext(code, ctx);

const good = `剧情推进到这里。<small>
请选择你的下一步行动：
1️⃣ 拔刀相向
2️⃣ 转身就走
3️⃣ 假装没看见
4️⃣ 坐下来谈谈
tips: "怂也是一种智慧"
</small>尾巴`;
const oc = E(`parseOptCard(${JSON.stringify(good)})`);
t("parse ok", oc && oc.options.length === 4 && oc.options[0] === "拔刀相向");
t("parse intro", oc.intro === "请选择你的下一步行动：");
t("parse tips", oc.tips === "怂也是一种智慧");
t("parse strips block from body", good.replace(oc.full, "").indexOf("<small>") < 0);

t("parse null without small", E(`parseOptCard("普通回复")`) === null);
t("parse null with 1 option", E(`parseOptCard("<small>选 1️⃣ a</small>")`) === null);
t("parse 3 options ok (v21: 2-6)", E(`parseOptCard("<small>a 1️⃣ x 2️⃣ y 3️⃣ z</small>")`).options.length === 3);
const notips = E(`parseOptCard("<small>选 1️⃣ a 2️⃣ b 3️⃣ c 4️⃣ d</small>")`);
t("parse ok without tips", notips && notips.tips === "" && notips.options[3] === "d");

const html = E(`optCardHTML(${JSON.stringify(oc)}, true, 5)`);
t("card active buttons", html.indexOf("pickOption(5,0)") >= 0 && html.indexOf("opttips") >= 0);
const htmlOff = E(`optCardHTML(${JSON.stringify(oc)}, false, 5)`);
t("card inactive", htmlOff.indexOf("pickOption") < 0 && htmlOff.indexOf("optbtn off") >= 0);

const st1 = {scriptName:"Ny-测试", findRegex:"/<small>[\\s\\S]*?<\\/small>/i",
  replaceString:"", trimStrings:[], placement:[1,2], disabled:false};
const r1 = E(`stRegexToRule(${JSON.stringify(st1)})`);
t("st import", r1 && r1.find === "<small>[\\s\\S]*?<\\/small>" && r1.flags === "ig" && r1.enabled === true && r1.name === "Ny-测试");
const st2 = Object.assign({}, st1, {disabled:true, placement:[2]});
t("st placement 2 (AI输出) accepted", E(`stRegexToRule(${JSON.stringify(st2)})`) !== null);
const st2b = Object.assign({}, st1, {placement:[1]});
t("st placement 1 (仅用户输入) rejected", E(`stRegexToRule(${JSON.stringify(st2b)})`) === null);
const st3 = Object.assign({}, st1, {disabled:true, placement:[1,2]});
t("st disabled -> enabled false", E(`stRegexToRule(${JSON.stringify(st3)})`).enabled === false);
t("st non-script rejected", E(`stRegexToRule({a:1})`) === null);
const stBad = Object.assign({}, st1, {findRegex:"/([/i"});
t("st bad regex rejected", E(`stRegexToRule(${JSON.stringify(stBad)})`) === null);

t("applyRegex flags gi", E(`applyRegex("ABC abc", [{find:"abc", flags:"gi", replace:"X"}])`) === "X X");
t("applyRegex default g", E(`applyRegex("a a", [{find:"a", replace:"b"}])`) === "b b");
t("applyRegex disabled skip", E(`applyRegex("a", [{find:"a", replace:"b", enabled:false}])`) === "a");

t("instr has small format", ctx.OPTCARDS_INSTR.indexOf("<small>") >= 0 && ctx.OPTCARDS_INSTR.indexOf("1️⃣") >= 0);

// v21: 可配置数量 (2-6) + 氛围
const i2 = E(`optCardsInstr(2, "none")`);
t("instr count 2", i2.indexOf("2 个行动选项") >= 0 && i2.indexOf("3️⃣") < 0 && i2.indexOf("2️⃣") >= 0);
const i6 = E(`optCardsInstr(6, "tense")`);
t("instr count 6", i6.indexOf("6 个行动选项") >= 0 && i6.indexOf("6️⃣") >= 0);
t("instr mood tense", i6.indexOf("紧张感") >= 0);
const iw = E(`optCardsInstr(4, "warm")`);
t("instr mood warm", iw.indexOf("温情治愈") >= 0);
t("instr count clamp high", E(`optCardsInstr(99, "none")`).indexOf("6 个行动选项") >= 0);
t("instr count clamp low", E(`optCardsInstr(1, "none")`).indexOf("2 个行动选项") >= 0);
t("instr mood none no extra", E(`optCardsInstr(4, "none")`).indexOf("氛围要求") < 0);
const oc2 = E(`parseOptCard("<small>选 1️⃣ a 2️⃣ b</small>")`);
t("parse 2 options", oc2 && oc2.options.length === 2 && oc2.options[1] === "b");
const oc6 = E(`parseOptCard("<small>选 1️⃣ a 2️⃣ b 3️⃣ c 4️⃣ d 5️⃣ e 6️⃣ f</small>")`);
t("parse 6 options", oc6 && oc6.options.length === 6 && oc6.options[5] === "f");

console.log(`\noptcards: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
