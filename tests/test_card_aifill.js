const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 功能: 角色卡导入 AI 补完缺失层 + 看图写卡 + 截断自动续写 + 玩家行动铁律
function mkCtx(fetchMock){
const store = {};
const ls = {getItem: k => (k in store? store[k]: null),
setItem: (k, v) => { store[k] = String(v);},
removeItem: k => { delete store[k];},
key: i => Object.keys(store)[i] || null, get length(){ return Object.keys(store).length;}};
const ctx = {localStorage: ls, console};
ctx.window = ctx; ctx.globalThis = ctx;
/* stream() 用 TextDecoder；vm 上下文默认没有，从 util 注入 */
try{ const u = require("util"); ctx.TextDecoder = u.TextDecoder; ctx.TextEncoder = u.TextEncoder; }catch(e){}
if(fetchMock) ctx.fetch = fetchMock;
vm.createContext(ctx);
return {ctx, store};
}
let pass = 0, fail = 0;
function t(name, cond){ if(cond){ pass++;} else { fail++; console.log("FAIL:", name);}}
function extractFn(src, fname){
const m = src.match(new RegExp("function " + fname + "\\([\\s\\S]*?\\n\\}"));
if(!m) throw new Error("not found: " + fname);
return m[0];
}

/* ---------- 功能一: AI 补完缺失层 ---------- */
{
const {ctx} = mkCtx();
vm.runInContext(fs.readFileSync(WWW + "/rp/cardimport.js", "utf8"), ctx, {filename: "cardimport.js"});
const CI = vm.runInContext("RP_CARDIMPORT", ctx);
/* B17: GAPFILL_KEYS 从 4 个(核心层)扩到 8 个(加弧光四键), 断言跟着走真实契约而不是写死 4 */
const GK = CI.GAPFILL_KEYS;
const full = {fields: {ooc_redline: "a", soul_goal: "b", hidden_desire: "c", inner_need: "d",
  arc_type: "rise", arc_start: "e", arc_mid: "f", arc_end: "g"}};
const empty = {fields: {}};
const half = {fields: {ooc_redline: "不杀人", soul_goal: "复仇"}};
t("补完键共8个且含弧光四键", GK.length === 8 &&
  ["arc_type","arc_start","arc_mid","arc_end"].every(k => GK.indexOf(k) >= 0));
t("全缺返回全部补完键", CI.missingGapfillKeys(empty).length === GK.length);
t("全有返回空", CI.missingGapfillKeys(full).length === 0);
/* half 只有核心层两个 -> 缺失项 = 剩下两个核心层 + 全部弧光键, 顺序跟 GAPFILL_KEYS 一致 */
t("缺核心层2个时返回剩余核心层+全部弧光键",
  JSON.stringify(CI.missingGapfillKeys(half)) === JSON.stringify(GK.filter(k => k !== "ooc_redline" && k !== "soul_goal")));
t("null卡返回全部补完键", CI.missingGapfillKeys(null).length === GK.length);
t("空白字符串算缺失", CI.missingGapfillKeys({fields:{ooc_redline:"  "}}).indexOf("ooc_redline") >= 0);
const card = {name: "美琴", scenario: "学园都市", systemPrompt: "你是御坂美琴",
  fields: {core_identity: "常盘台王牌", core_traits: "傲娇"}};
const p = CI.gapfillPrompt(card, ["ooc_redline","soul_goal"]);
t("补完prompt只列缺失键", p.indexOf("ooc_redline") >= 0 && p.indexOf("soul_goal") >= 0 && p.indexOf("hidden_desire") < 0);
t("补完prompt带原卡内容", p.indexOf("常盘台王牌") >= 0 && p.indexOf("学园都市") >= 0);
t("补完prompt要求JSON", p.indexOf("JSON") >= 0);
t("补完prompt禁矛盾", p.indexOf("矛盾") >= 0);
const j1 = CI.parseGapfillJson('{"ooc_redline":" 绝不欺负弱小 ","soul_goal":"守护朋友","extra":"忽略我"}', ["ooc_redline","soul_goal"]);
t("解析只保留请求键", j1 && j1.ooc_redline === "绝不欺负弱小" && j1.soul_goal === "守护朋友" && !("extra" in j1));
const j2 = CI.parseGapfillJson('```json\n{"ooc_redline":"x"}\n```', ["ooc_redline"]);
t("去fence解析", j2 && j2.ooc_redline === "x");
t("非法JSON返回null", CI.parseGapfillJson("不是json", ["ooc_redline"]) === null);
t("空值被丢弃", CI.parseGapfillJson('{"ooc_redline":"  "}', ["ooc_redline"]).ooc_redline === undefined);
t("超长截断", CI.parseGapfillJson('{"ooc_redline":"' + "x".repeat(500) + '"}', ["ooc_redline"]).ooc_redline.length === 300);
}

/* ---------- 功能二-1/2: 看图写卡 ---------- */
{
const {ctx} = mkCtx();
vm.runInContext(fs.readFileSync(WWW + "/rp/cardimport.js", "utf8"), ctx, {filename: "cardimport.js"});
const CI = vm.runInContext("RP_CARDIMPORT", ctx);
const vp = CI.visionCardPrompt();
t("vision prompt要JSON", vp.indexOf("JSON") >= 0 && vp.indexOf("characters") >= 0);
const vj = '{"characters":[' +
  '{"name":"美琴","appearance":"茶色短发","description":"国中生","personality":"傲娇","scenario":"学园都市","first_mes":"呦。","mes_example":"...","worldbook":[{"title":"学园都市","content":"能力者之城"}]},' +
  '{"name":"黑子","appearance":"双马尾","description":"风纪委员","personality":"变态","scenario":"学园都市","first_mes":"姐姐大人！"}]}';
const chars = CI.parseVisionCards(vj);
t("解析出2个人物", chars && chars.length === 2 && chars[0].name === "美琴" && chars[1].name === "黑子");
t("非法vision JSON返回null", CI.parseVisionCards("xxx") === null);
t("空characters返回null", CI.parseVisionCards('{"characters":[]}') === null);
const card = CI.fromVisionChar(chars[0]);
t("vision卡有名字", card.name === "美琴");
t("vision卡字段映射", card.fields.core_identity === "国中生" && card.fields.core_traits === "傲娇" && card.fields.appearance_feature === "茶色短发");
t("vision卡场景/开场白", card.scenario === "学园都市" && card.greeting === "呦。");
t("vision卡世界书", Array.isArray(card.worldbook) && card.worldbook.length === 1 && card.worldbook[0].title === "学园都市");
t("vision卡有id", typeof card.id === "string" && card.id.length > 0);
}

/* ---------- 功能二-3: 截断自动续写 ---------- */
{
const chatSrc = fs.readFileSync(WWW + "/rp/chat.js", "utf8");
const looksTruncated = new Function("return (" + extractFn(chatSrc, "looksTruncated") + ")")();
t("length算截断", looksTruncated("还有很多话", "length") === true);
t("stop不算截断", looksTruncated("还有很多话", "stop") === false);
t("无finish长文本无句号算截断", looksTruncated("x".repeat(300) + "还有", null) === true);
t("无finish短文本不算", looksTruncated("好的", null) === false);
t("无finish句号结尾不算", looksTruncated("x".repeat(300) + "。", null) === false);
t("content_filter不续写", looksTruncated("x".repeat(300), "content_filter") === false);
const stitch = new Function("return (" + extractFn(chatSrc, "stitchOverlap") + ")")();
t("重叠拼接去重", stitch("他说你好你好", "你好世界") === "他说你好你好世界");
t("无重叠直接拼", stitch("abc", "def") === "abcdef");
/* complete() 集成: mock fetch */
const calls = [];
const fetchMock = async (url, opt)=>{
  calls.push(JSON.parse(opt.body));
  const last = calls[calls.length-1];
  const isContinue = last.messages.some(m => m.content && m.content.indexOf("截断") >= 0);
  const body = isContinue
    ? {choices: [{message: {content: "继续的内容。"}, finish_reason: "stop"}]}
    : {choices: [{message: {content: "这是很长很长" + "x".repeat(300)}, finish_reason: "length"}]};
  return {ok: true, json: async ()=>body};
};
const {ctx} = mkCtx(fetchMock);
vm.runInContext(chatSrc, ctx, {filename: "chat.js"});
const RP_NET = vm.runInContext("RP_NET", ctx);
(async ()=>{
  const out = await RP_NET.complete({base: "http://x", key: "k", model: "m"}, [{role:"user",content:"hi"}], 0.9);
  t("complete截断自动续写", out.indexOf("继续的内容。") >= 0 && calls.length === 2);
  calls.length = 0;
  const fetchMock2 = async ()=>({ok: true, json: async ()=>({choices:[{message:{content:"好的。"},finish_reason:"stop"}]})});
  const {ctx: ctx2} = mkCtx(fetchMock2);
  vm.runInContext(chatSrc, ctx2, {filename: "chat.js"});
  const RP_NET2 = vm.runInContext("RP_NET", ctx2);
  const out2 = await RP_NET2.complete({base:"http://x",key:"k",model:"m"}, [{role:"user",content:"hi"}], 0.9);
  t("complete正常不续写", out2 === "好的。");
  /* stream(): mock SSE */
  const sseChunks = [
    'data: {"choices":[{"delta":{"content":"第一段"},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const sseBody = sseChunks.join("");
  let n = 0;
  const fetchMock3 = async (url, opt)=>{
    n++;
    const b = JSON.parse(opt.body);
    if(b.stream){
      const enc = new TextEncoder();
      const data = enc.encode(sseBody);
      return {ok: true, body: {getReader: ()=>({
        _done: false,
        read(){
          if(this._done) return Promise.resolve({done: true});
          this._done = true;
          return Promise.resolve({done: false, value: data});
        },
      })}};
    }
    return {ok: true, json: async ()=>({choices:[{message:{content:"流式续写。"},finish_reason:"stop"}]})};
  };
  const {ctx: ctx3} = mkCtx(fetchMock3);
  vm.runInContext(chatSrc, ctx3, {filename: "chat.js"});
  const RP_NET3 = vm.runInContext("RP_NET", ctx3);
  const toks = [];
  const out3 = await RP_NET3.stream({base:"http://x",key:"k",model:"m"}, [{role:"user",content:"hi"}], {temperature: 0.9}, (tk)=>toks.push(tk));
  t("stream截断自动续写", out3.indexOf("第一段") >= 0 && out3.indexOf("流式续写。") >= 0);
  t("stream续写走onToken", toks.join("").indexOf("流式续写。") >= 0);
  console.log("pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})();
}

/* ---------- 功能一: 导出保留补完字段 ---------- */
{
const {ctx} = mkCtx();
vm.runInContext(fs.readFileSync(WWW + "/rp/cardexport.js", "utf8"), ctx, {filename: "cardexport.js"});
const CE = vm.runInContext("RP_CARDEXPORT", ctx);
const card = {name: "测试卡",
  fields: {core_identity: "国中生", core_traits: "傲娇",
    soul_goal: "守护朋友", hidden_desire: "被需要", ooc_redline: "绝不欺负弱小"},
  scenario: "学园都市", greeting: "呦", systemPrompt: "", postHistoryInstructions: "",
  creatorNotes: "", altGreetings: [], exampleDialogue: "", exampleBlocks: [],
  depthPrompt: null, tags: []};
const out = CE.buildTavernCard(card);
t("导出personality保留soul_goal", out.data.personality.indexOf("守护朋友") >= 0);
t("导出personality保留hidden_desire", out.data.personality.indexOf("被需要") >= 0);
t("导出system_prompt保留ooc_redline", out.data.system_prompt.indexOf("绝不欺负弱小") >= 0);
}

/* ---------- 功能二-4: 玩家行动铁律 ---------- */
{
const promptSrc = fs.readFileSync(WWW + "/rp/prompt.js", "utf8");
const {ctx} = mkCtx();
vm.runInContext(promptSrc, ctx, {filename: "prompt.js"});
const RP_PROMPT = vm.runInContext("RP_PROMPT", ctx);
const pi = RP_PROMPT.postInstructions("美琴", "player", "second");
t("单聊禁令点名身体动作", pi.indexOf("身体动作") >= 0);
t("单聊禁令点名心理活动", pi.indexOf("心理活动") >= 0);
t("单聊禁令点名替玩家做决定", pi.indexOf("替玩家做决定") >= 0);
const travSrc = fs.readFileSync(WWW + "/rp/traverse.js", "utf8");
const {ctx: ctx2} = mkCtx();
vm.runInContext(travSrc, ctx2, {filename: "traverse.js"});
const RP_TRAVERSE = vm.runInContext("RP_TRAVERSE", ctx2);
const tpi = RP_TRAVERSE.postInstructions({mode: "soul", charName: "美琴"});
t("穿越禁令点名身体动作", tpi.indexOf("身体动作") >= 0);
t("穿越禁令点名心理活动", tpi.indexOf("心理活动") >= 0);
}
