const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// prompt.js: matchLore 命中 + buildMessages stats.loreHits (世界书触发可视化数据源)
const src = fs.readFileSync(WWW+"/rp/prompt.js", "utf8");
const ctx = {console};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const RP_PROMPT = vm.runInContext("RP_PROMPT", ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

const wb = [
  {title:"大观园", trigger_keywords:["大观园","潇湘馆"], content:"贾府的园子", priority:60, enabled:true},
  {title:"宁国府", trigger_keywords:["宁国府"], content:"贾珍府上", priority:50, enabled:true},
  {title:"常驻条目", trigger_keywords:[], content:"永远在", priority:40, constant:true, enabled:true},
];

const hits = RP_PROMPT.matchLore(wb, "昨天去了大观园散步");
t("matchLore hits", hits.length === 2); // 大观园 + 常驻
t("matchLore titles", hits.some(e=>e.title==="大观园") && hits.some(e=>e.title==="常驻条目"));
t("matchLore priority order", hits[0].title === "大观园");
t("matchLore no false positive",
  RP_PROMPT.matchLore(wb, "今天天气不错").every(e=>e.constant));

const card = {name:"林黛玉", fields:{core_traits:"敏感", speech_style:"爱用反问"}};
const b = RP_PROMPT.buildMessages(card, {
  novel:"红楼梦", worldbook:wb, relations:[],
  memory:"", history:[{role:"user", content:"我们去大观园走走"}],
}, {maxContext:8192, response:512});
t("stats has loreHits", Array.isArray(b.stats.loreHits));
t("stats loreHits content",
  b.stats.loreHits.includes("大观园") && b.stats.loreHits.includes("常驻条目"));
t("stats has ctx fields",
  typeof b.stats.sysTokens === "number" && typeof b.stats.histTokens === "number"
  && typeof b.stats.maxCtx === "number" && typeof b.stats.histKept === "number");
t("estTokens sane", RP_PROMPT.estTokens("你好世界") > 0);


// (旧断言结束, 新上限断言见下)

// 世界书触发上限: 30 条全命中时只注入前 8 (按 priority), 且 loreHits 与实际注入一致
const wbBig = [];
for(let i = 0; i < 30; i++){
  wbBig.push({title: "条目" + i, trigger_keywords: ["贾府"],
    content: "规则内容" + i + "。" + "x".repeat(20),
    priority: 100 - i, enabled: true});
}
const bigHits = RP_PROMPT.matchLore(wbBig, "贾府来人了");
t("matchLore 全命中 30", bigHits.length === 30);
const bl = RP_PROMPT.buildLore(wbBig, "贾府来人了", 900);
t("buildLore 上限 8", bl.hits.length === 8);
t("buildLore 按 priority 取前 8",
  bl.hits[0] === "条目0" && bl.hits[7] === "条目7");
t("buildLore 返回 text", typeof bl.text === "string" && bl.text.includes("条目0"));
const b2 = RP_PROMPT.buildMessages(card, {
  novel: "红楼梦", worldbook: wbBig, relations: [],
  memory: "", history: [{role: "user", content: "贾府来人了"}],
}, {maxContext: 8192, response: 512});
t("loreHits 与实际注入一致",
  JSON.stringify(b2.stats.loreHits) === JSON.stringify(bl.hits));
t("loreHits 不超过 8", b2.stats.loreHits.length <= 8);
// 预算内小量命中不受影响
const bl2 = RP_PROMPT.buildLore(wb, "昨天去了大观园散步", 900);
t("小量命中不受上限影响", bl2.hits.length === 2);

console.log(`prompt lore (cap): ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
