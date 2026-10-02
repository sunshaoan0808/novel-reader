const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 开场白回归测试: 导入 ST 卡的 first_mes 必须作为开场白出现, 不能被吞掉或被模型重写
// 覆盖: cardimport 归一化保留 greeting / chat.greeting 优先用卡片原开场白(有无 key 都一样)
//       prompt val()/itemsOf() 支持纯数组字段(典型台词不再被吞)
//       traverse 卡片世界圣经带出 greeting, 离线开场带上卡片设定
function mkEl(){
  return {innerHTML: "", textContent: "", value: "", checked: false,
    classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
    style: {}, dataset: {},
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    closest(){ return null; }, scrollTo(){}, focus(){}, click(){},
    getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0}; }};
}
function mkCtx(){
  const els = {};
  const store = {};
  const ls = {getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] || null,
    get length(){ return Object.keys(store).length; }};
  const document = {body: mkEl(),
    getElementById: id => els[id] || (els[id] = mkEl()),
    querySelector: sel => { const m = String(sel).match(/^#([\w-]+)$/); return m ? (els[m[1]] || (els[m[1]] = mkEl())) : null; },
    querySelectorAll: () => [], createElement: () => mkEl()};
  const ctx = {localStorage: ls, document, console,
    alert(){}, confirm(){ return true; }, prompt(){ return null; },
    setTimeout: () => 0, clearTimeout(){},
    fetch: () => Promise.reject(new Error("no net")),
    scrollTo(){}, devicePixelRatio: 2};
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for(const f of ["data.js", "icons.js", "rp/prompt.js", "rp/persona.js", "rp/memory.js",
      "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js", "rp/aifill.js",
      "rp/group.js", "rp/cardexport.js", "rp/cardimport.js", "rp/traverse.js", "rp/traverse2.js"]){
    vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
  }
  // data.js 会覆盖 __DATA__, 重新注入空数据
  vm.runInContext("window.__DATA__ = {index:[], runs:{}, rp_cards:{}};", ctx);
  return ctx;
}
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };
const run = (ctx, code) => vm.runInContext(code, ctx);

(async () => {
  const ctx = mkCtx();

  /* 1) 归一化保留 first_mes 为独立 greeting */
  const tavern = {name: "小红", description: "活泼少女", personality: "开朗",
    first_mes: "嗨！我是小红，今天想聊点什么？",
    alternate_greetings: ["备选开场B"],
    mes_example: "<START>\n{{user}}: 你好\n{{char}}: 你好呀！",
    tags: ["测试世界"]};
  run(ctx, "var __c = RP_CARDIMPORT.normalizeTavern(" + JSON.stringify(tavern) + "); RP_CARDIMPORT.add(__c);");
  t("归一化保留 greeting", run(ctx, "__c.greeting") === "嗨！我是小红，今天想聊点什么？");
  t("first_mes 不再塞进 typical_lines(开场场景≠典型台词)", run(ctx, "(__c.fields.typical_lines||[]).indexOf('嗨！我是小红，今天想聊点什么？')") === -1);
  t("mes_example 台词仍进 typical_lines", run(ctx, "(__c.fields.typical_lines||[]).indexOf('你好呀！')") !== -1);

  /* 2) 聊天开场白: 无 key 也用卡片原开场白, 不再是"打量着你" */
  let g = await run(ctx, "RP.greeting('imported','小红',{},'测试世界')");
  t("无 key 聊天开场白=卡片原 first_mes(固定)", g === "嗨！我是小红，今天想聊点什么？");

  /* 3) 聊天开场白: 有 key 也不调模型重写, 固定 first_mes */
  run(ctx, "RP_NET.complete = async () => { globalThis.__called = (globalThis.__called||0)+1; return '[MODEL]'; };");
  g = await run(ctx, "RP.greeting('imported','小红',{key:'k',base:'b',model:'m'},'测试世界')");
  t("有 key 聊天开场白仍=卡片原 first_mes(不调模型)", g === "嗨！我是小红，今天想聊点什么？");
  t("有 key 时没调用模型生成开场白", run(ctx, "globalThis.__called||0") === 0);

  /* 4) ST 语义: first_mes 固定, 40 次抽取全是同一条, 备选只在手动选择时用 */
  const seen = {};
  for(let i = 0; i < 40; i++){
    const gg = await run(ctx, "RP.greeting('imported','小红',{key:'k',base:'b',model:'m'},'测试世界')");
    seen[gg] = (seen[gg] || 0) + 1;
  }
  t("开场白固定=first_mes", seen["嗨！我是小红，今天想聊点什么？"] === 40);
  t("备选开场白不自动混入", !seen["备选开场B"]);
  t("候选池不含模型现编", !seen["[MODEL]"]);

  /* 5) 无 first_mes 的卡: alternate_greetings 随机, 行为不变 */
  run(ctx, "var __c2 = RP_CARDIMPORT.normalizeTavern({name:'阿茶',alternate_greetings:['B1','B2']}); RP_CARDIMPORT.add(__c2);");
  g = await run(ctx, "RP.greeting('imported','阿茶',{key:'k',base:'b',model:'m'},'x')");
  t("无 first_mes 时用 alternate_greetings", g === "B1" || g === "B2");

  /* 6) prompt val()/itemsOf() 支持纯数组: 典型台词进 prompt, 不再被吞 */
  const sys = run(ctx, "RP_PROMPT.buildMessages({name:'小红',fields:{typical_lines:['台词一','台词二']}},{novel:'测试',history:[],persona:''},{maxContext:4096}).messages.filter(m=>m.role==='system').map(m=>m.content).join('\\n')");
  t("典型台词渲染进 system prompt", sys.indexOf("台词一") >= 0);
  t("对话示例 few-shot 生效", sys.indexOf("台词二") >= 0);

  /* 7) 蒸馏卡(无 greeting): 离线回退取典型台词首行, 有 key 走模型(行为不变) */
  run(ctx, "window.__DATA__.rp_cards={r1:[{name:'林黛玉',fields:{typical_lines:['花谢花飞花满天']}}]};");
  g = await run(ctx, "RP.greeting('r1','林黛玉',{},'红楼梦')");
  t("蒸馏卡离线开场白取典型台词", g === "花谢花飞花满天");
  g = await run(ctx, "RP.greeting('r1','林黛玉',{key:'k',base:'b',model:'m'},'红楼梦')");
  t("蒸馏卡有 key 仍走模型生成", g === "[MODEL]");

  /* 8) 穿越: 卡片世界圣经带出 greeting, 离线开场含卡片设定 */
  const cardId = run(ctx, "__c.id");
  const bibleG = run(ctx, "RP_TRAVERSE.buildWorldBible('card'," + JSON.stringify(cardId) + ").greeting");
  t("卡片世界圣经带出 greeting", bibleG === "嗨！我是小红，今天想聊点什么？");
  const trav = run(ctx, "RP_TRAVERSE.newSession({mode:'soul',worldKind:'card',worldId:" + JSON.stringify(cardId) + ",worldName:'测试世界',charName:'小红',anchorTitle:'故事开端',oocRemind:true})");
  const op2 = await vm.runInContext("(async()=>{var tr=RP_TRAVERSE.get('" + trav.id + "');return RP_TRAVERSE.genOpening(tr,{},async()=>'');})()", ctx);
  t("穿越离线开场含卡片设定", op2.indexOf("活泼少女") >= 0);

  /* 9) v36 旧卡兼容: 56797f7 之前导入的卡无独立 greeting, 读时从 raw.first_mes 回填 */
  const oldFm = "旧卡开场白。" + "x".repeat(300);
  run(ctx, "RP_CARDIMPORT.add({id:'impOld1',name:'旧卡人',fields:{typical_lines:[" + JSON.stringify(oldFm) + "]},raw:{first_mes:" + JSON.stringify(oldFm) + "},altGreetings:[],scenario:''});");
  const oldG = run(ctx, "RP_CARDIMPORT.find('旧卡人').greeting");
  t("旧卡 find() 回填 greeting=raw.first_mes", oldG === oldFm);
  t("旧卡 greetingOf 直调一致", run(ctx, "RP_CARDIMPORT.greetingOf({fields:{},raw:{first_mes:" + JSON.stringify(oldFm) + "}})") === oldFm);
  const oldTlOnly = "纯旧卡开场。" + "y".repeat(300);
  t("无 raw 时从 typical_lines 超长首条回填", run(ctx, "RP_CARDIMPORT.greetingOf({fields:{typical_lines:[" + JSON.stringify(oldTlOnly) + "]}})") === oldTlOnly);
  t("新卡短 typical_lines 不误判为开场白", run(ctx, "RP_CARDIMPORT.greetingOf({fields:{typical_lines:['你好呀！']}})") === "");
  const oldCard = run(ctx, "RP_CARDIMPORT.find('旧卡人')");
  const oldEx = run(ctx, "RP_PROMPT.buildExamples(RP_CARDIMPORT.find('旧卡人'),'旧卡人',600)");
  t("旧卡开场白不污染 few-shot", oldEx.indexOf("旧卡开场白") === -1);
  const fcGreet = run(ctx, "RP.findCard('imported','旧卡人').greeting");
  t("chat.findCard 旧卡开场白可用", fcGreet === oldFm);

  console.log(`greeting: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
