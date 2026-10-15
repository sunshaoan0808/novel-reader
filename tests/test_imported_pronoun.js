/* 导入卡聊天"我/你"指代翻转的回归测试。
 *
 * 三处根因, 都在本文件里被钉住(改坏了必红):
 *   1. www/rp/cardimport.js exampleBlocks 按说话人分桶成 {user, char} 且 user 恒在前,
 *      "角色先开口"的 <START> 块被重排成"角色在回答自己还没听到的话";
 *   2. www/rp/prompt.js buildExamples 把整块角色台词 join 成一串只挂一个标签, 轮次一多
 *      标签落在错的句子上; 卡片自带 exampleDialogue 更是把 {{user}} 标签原样丢进 prompt,
 *      subMacros 展开成"你", 与开头"你是<角色名>"抢指代;
 *   3. www/rp/prompt.js NARRATOR_INSTR 一段之内"你"既指模型又指玩家, 没有约定。
 */
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const ctx = {console, btoa: (s)=>Buffer.from(s, "binary").toString("base64"),
             atob: (s)=>Buffer.from(s, "base64").toString("binary"), TextDecoder};
const store = {};
ctx.localStorage = {getItem: (k)=>(k in store ? store[k] : null), setItem: (k, v)=>{store[k] = String(v);},
                    removeItem: (k)=>{delete store[k];},
                    key: (i)=>Object.keys(store)[i] || null, get length(){return Object.keys(store).length;}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/prompt.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/cardexport.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/cardimport.js", "utf8"), ctx);
const PM = vm.runInContext("RP_PROMPT", ctx);
const CI = vm.runInContext("RP_CARDIMPORT", ctx);
const CE = vm.runInContext("RP_CARDEXPORT", ctx);

let pass = 0, fail = 0;
const t = (n, c, d)=>{ c ? pass++ : (fail++, console.log("FAIL:", n, d === undefined ? "" : d)); };

/* ---- 夹具: 一张贴近真实 ST 卡的导入卡。块 2 是关键: 角色抢话先开口(极常见的写法) ---- */
const MES_EXAMPLE =
  "<START>\n{{user}}: 我听说你这当铺收旧物？\n{{char}}: 收。但我只收干净的东西。\n" +
  "<START>\n{{char}}: 还在？\n{{user}}: 我在想，这盏灯值多少。\n{{char}}: 你想听的不是价钱。\n" +
  "<START>\n{{user}}: 沈砚。\n{{char}}: ……这个名字，别再叫第二遍。";
const RAW = {
  name: "沈砚", tags: ["夜行录"],
  description: "沈砚是当铺的年轻掌柜，说话简短。",
  personality: "冷淡、警觉",
  scenario: "深夜的当铺，雨声敲窗。",
  first_mes: "门没栓。当东西，还是当别的？",
  mes_example: MES_EXAMPLE,
  extensions: {example_dialogue: MES_EXAMPLE},   /* 与 mes_example 同文: 不该渲染两遍 */
};
const card = CI.normalizeTavern(JSON.parse(JSON.stringify(RAW)));

/* ---- 1. exampleBlocks: 保留原始发言顺序 ---- */
/* turns 取值统一兜底: 旧代码里块是 {user, char}, 没有 turns —— 断言要红得可读, 不能先崩掉 */
const blocks = (card.exampleBlocks || []).map(b => (b && b.turns) || []);
t("三个 <START> 块都在", blocks.length === 3, JSON.stringify(blocks.map(x => x.length)));
t("块形状是有序 turns", blocks.every(x => x.length));
t("块2 角色先开口的顺序被保留",
  JSON.stringify(blocks[1].map(x => x.who)) === JSON.stringify(["char", "user", "char"]),
  JSON.stringify(blocks[1]));
t("块2 台词没被挪位",
  blocks[1][0] && blocks[1][0].text === "还在？" &&
  blocks[1][1] && blocks[1][1].text === "我在想，这盏灯值多少。" &&
  blocks[1][2] && blocks[1][2].text === "你想听的不是价钱。",
  JSON.stringify(blocks[1]));
t("块1 常规 user->char 也不受影响",
  JSON.stringify(blocks[0].map(x => x.who)) === JSON.stringify(["user", "char"]),
  JSON.stringify(blocks[0]));
t("块3 用户只叫名字的行归 user",
  !!blocks[2][0] && blocks[2][0].who === "user" && blocks[2][0].text === "沈砚。",
  JSON.stringify(blocks[2]));

/* ---- 2. buildExamples: 逐轮标注 + 不倒置 ---- */
const ex = PM.buildExamples(card, "沈砚", 800);
const lines = ex.split("\n");
const iStill = lines.indexOf("沈砚：还在？");
const iThink = lines.indexOf("用户：我在想，这盏灯值多少。");
const iPrice = lines.indexOf("沈砚：你想听的不是价钱。");
t("块2 三句都在 few-shot 里", iStill >= 0 && iThink >= 0 && iPrice >= 0, ex);
t("块2 顺序 == 卡片原文顺序", iStill >= 0 && iStill < iThink && iThink < iPrice, ex);
t("每句台词各带一个说话人标签(不是 join 成一串)",
  iPrice >= 0 && lines[iPrice - 1] === "用户：我在想，这盏灯值多少。", JSON.stringify(lines));
t("段头钉死说话人图例", ex.indexOf("「用户：」是玩家说的话") >= 0 && ex.indexOf("「沈砚：」是沈砚说的话") >= 0);

/* ---- 3. exampleDialogue 的 {{user}} 标签不得漏进 prompt(否则被展开成"你") ---- */
t("few-shot 里没有 {{user}}/{{char}} 字面宏", ex.indexOf("{{user}}") < 0 && ex.indexOf("{{char}}") < 0, ex);
t("没有把用户台词标成「你：」", !/^[ \t]*你[：:]/.test(ex), ex);
t("与 mes_example 同文不渲染两遍", ex.split("用户：我听说你这当铺收旧物？").length === 2, ex);

const sys = PM.buildMessages(card, {novel: "夜行录", history: [], persona: "", personaName: ""}, {})
              .messages.filter(m => m.role === "system").map(m => m.content).join("\n");
t("system 里没有字面 {{user}}", sys.indexOf("{{user}}") < 0, sys);
t("system 里没有「你：」这种说话人标签", !/(^|\n)[ \t]*你[：:]/.test(sys), sys);
t("system 里用户一侧仍写作「用户：」", /(^|\n)用户：我在想，这盏灯值多少。/.test(sys), sys);

/* ---- 4. 叙事者人称约定: 你=玩家 / 我=角色, 且不与示例抢指代 ---- */
const narrSys = PM.buildMessages(card, {novel: "夜行录", history: [], persona: "", personaName: ""},
                                 {preset: "narr"}).messages[0].content;
t("叙事者段声明了人称约定", narrSys.indexOf("人称约定") >= 0, narrSys);
t("约定里点明两处「你」含义不同", /本指令里凡是直接称呼叙事者的“.{0,3}你/.test(narrSys) &&
                                 /指玩家本人/.test(narrSys), narrSys);
t("约定把「我」钉给角色", /角色永远用“我”或自己的名字自称/.test(narrSys), narrSys);
t("叙事里禁止玩家第一人称", /叙事里绝不出现玩家的第一人称“我”/.test(narrSys), narrSys);
t("叙事者段与示例不冲突: 示例段用「用户：」", narrSys.indexOf("用户：我在想，这盏灯值多少。") >= 0, narrSys);
t("叙事者段与示例不冲突: 全段无「你：」说话人标签", !/(^|\n)[ \t]*你[：:]/.test(narrSys), narrSys);

/* ---- 5. 已入库旧卡(只有 {user,char} 分桶)读时按 raw.mes_example 恢复真序 ---- */
const legacy = {
  id: "legacy1", name: "沈砚", novel: "夜行录", fields: {core_identity: "当铺掌柜"},
  greeting: RAW.first_mes, altGreetings: [], exampleDialogue: "",
  /* 2026-10-15 之前入库的形状: 分桶后 user 恒在前, 顺序已丢 */
  exampleBlocks: [{user: "我在想，这盏灯值多少。", char: "还在？\n你想听的不是价钱。"}],
  scenario: "", systemPrompt: "", postHistoryInstructions: "", creatorNotes: "",
  worldbook: [], raw: JSON.parse(JSON.stringify(RAW)), createdAt: 1,
};
CI.add(legacy);
const back = CI.find("沈砚");
t("旧卡读时迁到有序 turns", Array.isArray(back.exampleBlocks) &&
  back.exampleBlocks.every(b => b && Array.isArray(b.turns) && b.turns.length));
const legacyTurns = (((back.exampleBlocks || [])[1]) || {}).turns || [];
t("旧卡按 raw.mes_example 恢复「角色先开口」的真序",
  JSON.stringify(legacyTurns.map(x => x.who)) === JSON.stringify(["char", "user", "char"]),
  JSON.stringify(legacyTurns));
const legacyEx = PM.buildExamples(back, "沈砚", 800);
t("旧卡的 few-shot 不再倒置",
  legacyEx.indexOf("沈砚：还在？") < legacyEx.indexOf("用户：我在想，这盏灯值多少。"), legacyEx);

/* ---- 6. 导出 roundtrip: 来回导出不把真序改写掉 ---- */
const re = CI.normalizeTavern(CE.buildTavernCard(card).data);
const reTurns = ((re.exampleBlocks || [])[1] || {}).turns || [];
t("导出再导入仍是 char 先开口",
  JSON.stringify(reTurns.map(x => x.who)) === JSON.stringify(["char", "user", "char"]),
  JSON.stringify(reTurns));
t("导出的 mes_example 保留原序",
  CE.buildTavernCard(card).data.mes_example.indexOf("{{char}}: 还在？") <
  CE.buildTavernCard(card).data.mes_example.indexOf("{{user}}: 我在想，这盏灯值多少。"));

/* ---- 7. 端到端: RP.findCard("imported", ...) 必须把 exampleBlocks 透传给 prompt 组装 ----
 * chat.js 的 imported 分支曾经只回传 exampleDialogue, 不回传 exampleBlocks, 于是导入卡的
 * few-shot 唯一来源是那段带 {{user}} 标签的原文, 宏一展开就变成"你:" —— 人称翻转的主因。
 * 这里用与 test_greeting.js 同款的 DOM 桩把 chat.js 真加载起来验证。 */
function mkEl(){
  return {innerHTML: "", textContent: "", value: "", checked: false,
    classList: {add(){}, remove(){}, toggle(){}, contains(){ return false; }},
    style: {}, dataset: {},
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    closest(){ return null; }, scrollTo(){}, focus(){}, click(){},
    getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0}; }};
}
const c2store = {};
const c2ls = {getItem: k => (k in c2store ? c2store[k] : null),
  setItem: (k, v) => { c2store[k] = String(v); }, removeItem: k => { delete c2store[k]; },
  key: i => Object.keys(c2store)[i] || null, get length(){return Object.keys(c2store).length; }};
const c2els = {};
const c2doc = {body: mkEl(),
  getElementById: id => c2els[id] || (c2els[id] = mkEl()),
  querySelector: sel => { const m = String(sel).match(/^#([\w-]+)$/); return m ? (c2els[m[1]] || (c2els[m[1]] = mkEl())) : null; },
  querySelectorAll: () => [], createElement: () => mkEl()};
const c2 = {localStorage: c2ls, document: c2doc, console,
  alert(){}, confirm(){ return true; }, prompt(){ return null; },
  setTimeout: () => 0, clearTimeout(){}, fetch: () => Promise.reject(new Error("no net")),
  scrollTo(){}, devicePixelRatio: 2};
c2.window = c2; c2.globalThis = c2;
vm.createContext(c2);
for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js", "rp/memory.js",
    "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js", "rp/aifill.js",
    "rp/group.js", "rp/cardexport.js", "rp/cardimport.js"]){
  vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), c2, {filename: f});
}
vm.runInContext("window.__DATA__ = {index:[], runs:{}, rp_cards:{}};", c2);
vm.runInContext("RP_CARDIMPORT.add(RP_CARDIMPORT.normalizeTavern(" + JSON.stringify(RAW) + "));", c2);
const live = vm.runInContext("RP.findCard('imported','沈砚')", c2);
t("findCard(imported) 透传 exampleBlocks", !!(live && Array.isArray(live.exampleBlocks) && live.exampleBlocks.length),
  JSON.stringify(live && live.exampleBlocks));
t("findCard(imported) 的轮次顺序没被倒置",
  live && JSON.stringify(((live.exampleBlocks || [])[1] || {}).turns || []).indexOf('"who":"char"') >= 0,
  JSON.stringify(live && live.exampleBlocks));
const liveEx = live ? vm.runInContext("RP_PROMPT.buildExamples", c2)(live, "沈砚", 800) : "";
t("findCard(imported) 的 few-shot 不倒置且不出现「你：」",
  liveEx.indexOf("沈砚：还在？") < liveEx.indexOf("用户：我在想，这盏灯值多少。") &&
  !/^[ \t]*你[：:]/m.test(liveEx), liveEx);

console.log(`imported_pronoun: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);