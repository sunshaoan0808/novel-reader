const {execSync} = require("child_process");
const fs = require("fs");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const src = fs.readFileSync(WWW+"/rp/cardwriter.js", "utf8");
const sandbox = {localStorage: null};
const Module = require("module");
const ls = (function(){
  const m = {};
  return {getItem:k=>m[k]||null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
    key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};
})();
sandbox.localStorage = ls;
sandbox.window = {};
const ctx = new (require("vm").Script)(
  src + "\n;module.exports = RP_WRITER;", {filename: "cardwriter.js"});
const mod = {exports: {}};
new (require("vm").Script)(
  "const localStorage = __ls; const window = __win;\n" + src + "\nmodule.exports = RP_WRITER;"
).runInNewContext({__ls: ls, __win: {}, module: mod, console});
const W = mod.exports;
let pass = 0, fail = 0;
function t(name, cond){ if(cond){pass++;} else {fail++; console.log("FAIL:", name);} }

t("steps=5", W.STEPS.length === 5 && W.STEPS[0].id === "step0" && W.STEPS[4].id === "step4");

const s = W.newSession("honglou_full");
t("newSession", s.step === 0 && s.worldRunId === "honglou_full" && W.getSession(s.id).id === s.id);
t("listSessions", W.listSessions().length === 1);

const p0 = W.interviewPrompt(0, s);
t("interview step0", p0.indexOf("美学思考") >= 0 && p0.indexOf("200 字以内") >= 0);
const p1 = W.interviewPrompt(1, {summaries: {step0: "基调: 背德"}});
t("interview carries prev summary", p1.indexOf("基调: 背德") >= 0);
const p3 = W.interviewPrompt(3, s);
t("interview step3 goal", p3.indexOf("生成人设卡") >= 0);

W.delSession(s.id);
t("delSession", W.getSession(s.id) === null && W.listSessions().length === 0);

(async function(){
  // summarize 用桩
  const stub = async (cfg, ms, t2) => "【灵魂定稿】\n- 关键转折: 家道中落";
  const sum = await W.summarize("step1", [{role:"user",content:"家道中落"}], {base:"b",key:"k",model:"m"}, stub);
  t("summarize", sum.indexOf("家道中落") >= 0);

  // genCard 用桩 (带 ```json 包裹)
  const cardStub = async () => '```json\n{"core_identity":"落魄书生","core_traits":"清高","typical_lines":["你懂什么","呵"]}```';
  const s2 = W.newSession("");
  s2.summaries = {step0:"a", step1:"b", step2:"c"};
  const fields = await W.genCard(s2, {base:"b",key:"k",model:"m"}, cardStub);
  t("genCard parses", fields.core_identity === "落魄书生" && Array.isArray(fields.typical_lines));

  // genCard 坏 JSON 抛错
  let threw = false;
  try { await W.genCard(s2, {}, async () => "不是json"); } catch(e){ threw = true; }
  t("genCard throws on bad json", threw);

  // selfCheck 坏 JSON 回退原卡
  const same = await W.selfCheck({core_traits:"x"}, {}, async () => "oops");
  t("selfCheck fallback", same.core_traits === "x");

  // finish -> custom chars
  s2.card = fields;
  W.saveSession(s2);
  W.finish(s2.id, "测试生", "测试世界");
  const found = W.findCustom("测试生");
  t("finish saves custom", found && found.novel === "测试世界" && found.fields.core_traits === "清高");
  t("finish clears session", W.getSession(s2.id) === null);
  t("findCustom miss", W.findCustom("不存在") === null);
  W.delCustom(found.id);
  t("delCustom", W.getCustomChars().length === 0);

  console.log(`\ncardwriter: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("ERR", e); process.exit(1); });
