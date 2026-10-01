/* ST 聊天记录扩展数据透传测试(构画兼容 A)。
 * 断言: 导入时保留 message.extra(-> stExtra) 与首行 chat_metadata;
 * 导出时原样写回; 导入->导出->再导入往返深度一致; 无扩展数据时不污染输出。
 */
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
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
  setTimeout, clearTimeout,
  chatHistKey:()=>"nd_chat_test_gougua"}; /* 透传 meta 存储键桩 */
ctx.window = ctx; ctx.globalThis = ctx;
ctx.__DATA__ = DATA;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW+"/icons.js","utf8"), ctx);
const src = fs.readFileSync(WWW+"/app.js","utf8");
const i = src.indexOf("/* ST 聊天记录(JSONL)");
const j = src.indexOf("window.importStChat");
vm.runInContext(src.slice(i, j), ctx);
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const run = (code)=> vm.runInContext(code, ctx);
const eq = (a,b)=> JSON.stringify(a) === JSON.stringify(b);

/* 1) 含扩展数据的合成 JSONL: 首行 chat_metadata + 消息 extra */
ctx.__raw = [
JSON.stringify({user_name:"u", character_name:"c",
  chat_metadata:{"sp-store":{version:1,data:{"schedule-user":{raw:"周一晨练"}}},
                 "sp-theater":{version:1,saved:[{id:"t1"}]}}}),
JSON.stringify({name:"c", is_user:false, is_system:false, send_date:"January 27, 2026 2:32am",
  mes:"hi", extra:{gouhua_snapshot:{floor:3,sp:"x"}, swipe_info:{"1":{extra:{gouhua_snapshot:{floor:2}}}}}}),
JSON.stringify({name:"u", is_user:true, send_date:"January 27, 2026 2:33am", mes:"hello"}),
JSON.stringify({name:"c", is_user:false, is_system:false, send_date:"January 27, 2026 2:34am",
  mes:"empty extra", extra:{}})
].join("\n");
const parsed = run(`stChatParse(__raw)`);
t("首行 chat_metadata 解析", parsed && parsed.meta.chat_metadata &&
  parsed.meta.chat_metadata["sp-store"].data["schedule-user"].raw === "周一晨练");
ctx.__parsed = parsed;
const entries = run(`stChatToEntries(__parsed)`);
t("3 条消息", entries.length === 3);
t("extra 保留进 stExtra", entries[0].stExtra && entries[0].stExtra.gouhua_snapshot.floor === 3);
t("swipe 内 extra 一并保留", entries[0].stExtra.swipe_info["1"].extra.gouhua_snapshot.floor === 2);
t("无 extra 的消息不带 stExtra", entries[1].stExtra === undefined);
t("空 extra 对象不保留", entries[2].stExtra === undefined);

/* 2) 导出写回 */
ctx.__entries = entries;
ctx.__chatMeta = parsed.meta.chat_metadata;
const out = run(`stEntriesToJsonl(__entries, {userName:"u", charName:"c", chatMeta:__chatMeta})`);
const outLines = out.split("\n").filter(Boolean).map(l=>JSON.parse(l));
t("导出 4 行(首行+3 消息)", outLines.length === 4);
t("首行写回 chat_metadata", eq(outLines[0].chat_metadata, parsed.meta.chat_metadata));
t("消息行写回 extra", eq(outLines[1].extra, entries[0].stExtra));
t("无 extra 消息行无 extra 键", !("extra" in outLines[2]));

/* 3) 往返: 导出 -> 再导入, 扩展数据深度一致 */
ctx.__out = out;
const p2 = run(`stChatParse(__out)`);
t("往返: 首行仍是元数据", p2 && p2.meta && !!p2.meta.chat_metadata);
ctx.__p2 = p2;
const e2 = run(`stChatToEntries(__p2)`);
t("往返: 消息数一致", e2.length === entries.length);
t("往返: chat_metadata 深度一致", eq(p2.meta.chat_metadata, parsed.meta.chat_metadata));
t("往返: stExtra 深度一致", eq(e2[0].stExtra, entries[0].stExtra));

/* 4) chat_metadata 按聊天存取 */
run(`setStChatMeta(__chatMeta)`);
const got = run(`getStChatMeta()`);
t("set/get 往返一致", eq(got, parsed.meta.chat_metadata));
run(`setStChatMeta(null)`);
t("清空后为 null", run(`getStChatMeta()`) === null);

/* 5) 真实聊天(RUBY 37 行, 自带 extra/token 计数与 chat_metadata):
 * 扩展数据应被保留, 导出写回, 往返一致 */
const ruby = fs.readFileSync("tests/fixtures/chat-ruby.jsonl","utf8");
ctx.__ruby = ruby;
const rp = run(`stChatParse(__ruby)`);
t("RUBY 首行 chat_metadata 解析", rp && rp.meta && rp.meta.chat_metadata &&
  rp.meta.chat_metadata.integrity === "2e54dd7a-120c-4c74-94f3-165ce6d44e93");
ctx.__rp = rp;
const re = run(`stChatToEntries(__rp)`);
t("RUBY 消息 extra 被保留(36 条非空,1 条空 extra 跳过)",
  re.filter(e=>e.stExtra !== undefined).length === 36);
t("RUBY extra 含 token_count", re.some(e=>e.stExtra && typeof e.stExtra.token_count === "number"));
ctx.__re = re;
ctx.__rcm = rp.meta.chat_metadata;
const rout = run(`stEntriesToJsonl(__re, {userName:"u", charName:"c", chatMeta:__rcm})`);
const routLines = rout.split("\n").filter(Boolean).map(l=>JSON.parse(l));
t("RUBY 导出首行写回 chat_metadata", eq(routLines[0].chat_metadata, rp.meta.chat_metadata));
t("RUBY 导出消息行写回 extra",
  routLines.slice(1).every((l,i)=>eq(l.extra || null, re[i].stExtra || null)));
ctx.__rout = rout;
const rp2 = run(`stChatParse(__rout)`);
ctx.__rp2 = rp2;
const re2 = run(`stChatToEntries(__rp2)`);
t("RUBY 往返消息数一致", re2.length === re.length);
t("RUBY 往返 extra 一致", re2.every((e,i)=>eq(e.stExtra || null, re[i].stExtra || null)));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
