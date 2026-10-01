const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// v38: ST 聊天记录(JSONL)导入回归测试
// 真实 fixture: tests/fixtures/chat-ruby.jsonl (用户 RUBY 真实聊天记录, 37 行)
// stChatParse(首行元数据/消息行) / stChatToEntries(角色映射/时间解析/空消息跳过)
const els = {};
function mkEl(){ return {innerHTML:"", textContent:"", value:"", classList:{add(){},remove(){},toggle(){}},
  querySelectorAll(){return [];}, addEventListener(){}, scrollTo(){}, style:{}}; }
const ls = (function(){ const m={}; return {
  getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
  key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
const document = {body: mkEl(), getElementById:id=>els[id]||(els[id]=mkEl()),
  querySelector:(sel)=>{const id=String(sel).replace("#","");return els[id]||(els[id]=mkEl());}, createElement:()=>mkEl()};
const DATA = {index:[], runs:{}, rp_cards:{}};
const window = {__DATA__: DATA};
const ctx = {localStorage: ls, document, console,
  alert(){}, confirm(){return true;}, prompt(){return null;},
  setTimeout, clearTimeout};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.__DATA__ = DATA;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW+"/icons.js","utf8"), ctx);
// 只取 stChatParse/stChatToEntries(避免全量 app.js 的 DOM 依赖)
const src = fs.readFileSync(WWW+"/app.js","utf8");
const i = src.indexOf("/* ST 聊天记录(JSONL)");
const j = src.indexOf("window.importStChat");
vm.runInContext(src.slice(i, j), ctx);
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const run = (code)=> vm.runInContext(code, ctx);

const raw = fs.readFileSync("tests/fixtures/chat-ruby.jsonl","utf8");
ctx.__raw = raw;
const parsed = run(`stChatParse(__raw)`);
t("解析成功", !!parsed);
t("首行识别为元数据", parsed && parsed.meta && parsed.meta.character_name === "RUBY 动态提示词写卡器");
t("元数据含 user_name", parsed && parsed.meta.user_name === "{{user}}");
t("消息行 37 条(38 行 - 1 元数据)", parsed && parsed.msgs.length === 37);
ctx.__parsed = parsed;
const entries = run(`stChatToEntries(__parsed)`);
t("空 mes 被跳过, 条目数<=37", entries.length > 0 && entries.length <= 37);
const roles = {};
entries.forEach(e=>{ roles[e.role] = (roles[e.role]||0)+1; });
t("有 user 消息", (roles.user||0) > 0);
t("有 assistant 消息", (roles.assistant||0) > 0);
t("assistant 保留 speaker", entries.filter(e=>e.role==="assistant").every(e=>!!e.speaker));
t("user 无 speaker", entries.filter(e=>e.role==="user").every(e=>!e.speaker));
t("ts 都是合法时间戳", entries.every(e=>typeof e.ts === "number" && !isNaN(e.ts) && e.ts > 0));
// 真实 send_date 如 "January 27, 2026 2:32am" 应解析为 2026-01
const jan2026 = entries.filter(e=>{ const d = new Date(e.ts); return d.getFullYear() === 2026 && d.getMonth() === 0; });
t("真实 send_date 解析为 2026-01", jan2026.length > entries.length / 2);
t("顺序与原文一致", entries[0].ts <= entries[entries.length-1].ts);

// 合成边界
ctx.__syn = `{"user_name":"u","character_name":"c"}\n{"name":"c","is_user":false,"is_system":false,"send_date":"not a date","mes":"hi"}\n{"name":"u","is_user":true,"send_date":"2026-01-01","mes":"  "}\n{"name":"c","is_user":false,"is_system":true,"mes":"sys note"}\n`;
const sp = run(`stChatParse(__syn)`);
t("合成: 元数据识别", sp && sp.meta && sp.meta.character_name === "c" && sp.msgs.length === 3);
ctx.__sp = sp;
const se = run(`stChatToEntries(__sp)`);
t("合成: 非法日期回退 Date.now", se[0].ts > 0);
t("合成: 空白 mes 跳过", se.length === 2);
t("合成: is_system -> system", se[1].role === "system");

// 非法输入
t("空文本 null", run(`stChatParse("")`) === null);
t("坏 JSON 行 null", run(`stChatParse('{"a":1}\\nnot json')`) === null);
t("无消息空数组", run(`stChatToEntries({meta:null, msgs:[]})`).length === 0);

// ---- 导出: stEntriesToJsonl (stChatParse/stChatToEntries 的逆操作), 真实 37 条往返 ----
const __text = fs.readFileSync("tests/fixtures/chat-ruby.jsonl", "utf8");
ctx.__text = __text;
const __parsed = run(`stChatParse(__text)`);
t("真实聊天 37 条", __parsed && __parsed.msgs.length === 37);
ctx.__parsed = __parsed;
const __entries = run(`stChatToEntries(__parsed)`);
t("转条目 37 条", __entries.length === 37);
ctx.__entries = __entries;
const __jsonl = run(`stEntriesToJsonl(__entries,
  {userName: __parsed.meta && __parsed.meta.user_name,
   charName: __parsed.meta && __parsed.meta.character_name})`);
t("导出为字符串", typeof __jsonl === "string");
const __lines = __jsonl.split("\n");
t("导出 38 行(首行元数据+37 消息)", __lines.length === 38);
const __meta0 = JSON.parse(__lines[0]);
t("首行是会话元数据", __meta0.user_name === __parsed.meta.user_name
  && __meta0.character_name === __parsed.meta.character_name);
t("消息行含 ST 字段", __lines.slice(1).every(l=>{
  const o = JSON.parse(l);
  return typeof o.mes === "string" && typeof o.is_user === "boolean"
    && typeof o.send_date === "string" && typeof o.name === "string";
}));
t("send_date 形如 January 27, 2026 2:32am",
  /^[A-Z][a-z]+ \d{1,2}, \d{4} \d{1,2}:\d{2}(am|pm)$/.test(JSON.parse(__lines[1]).send_date));
ctx.__jsonl = __jsonl;
const __backE = run(`stChatToEntries(stChatParse(__jsonl))`);
// ts 精度到分钟, 比较时截断
const __trunc = (e)=>({role:e.role, content:e.content, speaker:e.speaker||"",
  ts:Math.floor(e.ts/60000)});
t("往返 37 条一致",
  JSON.stringify(__entries.map(__trunc)) === JSON.stringify(__backE.map(__trunc)));
// 空 mes 不导出
t("空白 content 跳过", run(`stEntriesToJsonl([{role:"user", content:"  ", ts:1}])`).split("\n").length === 1);

// ---- 导出 UI 入口(静态) ----
const __asrc2 = fs.readFileSync(WWW+"/app.js", "utf8");
t("导出 ST JSONL button x2(单聊+群聊抽屉)",
  __asrc2.split("exportChatJsonl()").length - 1 >= 2);
t("window.exportChatJsonl", __asrc2.indexOf("window.exportChatJsonl") >= 0);
t("downloadRaw helper", __asrc2.indexOf("function downloadRaw") >= 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
