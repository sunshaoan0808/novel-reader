const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 竞品深挖第三轮 S 级回归
// 穿越四件套补全(角色卡全字段/正则/预设/温度) + ST 任意组合(新增/排序/开关/聊天深度注入)
function mkCtx(){
const store = {};
const ls = {getItem: k => (k in store? store[k]: null),
setItem: (k, v) => { store[k] = String(v);},
removeItem: k => { delete store[k];},
key: i => Object.keys(store)[i] || null, get length(){ return Object.keys(store).length;}};
const ctx = {localStorage: ls, console};
ctx.window = ctx; ctx.globalThis = ctx;
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

/* ---------- 预设: 聊天深度注入 ---------- */
{
const {ctx} = mkCtx();
vm.runInContext(fs.readFileSync(WWW + "/rp/preset.js", "utf8"), ctx, {filename: "preset.js"});
const RP_PRESET = ctx.window.RP_PRESET;
const hist = [{role:"user",content:"u1"},{role:"assistant",content:"a1"},
{role:"user",content:"u2"},{role:"assistant",content:"a2"}];
function mkPreset(extra){
return {name:"t", prompts: [
{ name:"sys1", role:"system", content:"主提示A", marker:false, enabled:true, injection_position:"", pos:0},
{ name:"人物", marker:true, identifier:"charDescription", enabled:true, pos:1},
{ name:"历史", marker:true, identifier:"chatHistory", enabled:true, pos:2},
{ name:"注入0", role:"system", content:"深度0注入", marker:false, enabled:true, injection_position:"chat", injection_depth:0, pos:3},
{ name:"注入2", role:"system", content:"深度2注入", marker:false, enabled:true, injection_position:"chat", injection_depth:2, pos:4},
{ name:"停用", role:"system", content:"不应出现", marker:false, enabled:false, injection_position:"chat", injection_depth:0, pos:5},
].concat(extra || [])};
}
const parts = {charDesc:"角色描述", history: hist, charName:"X", userName:"你"};
const msgs = RP_PRESET.assemble(mkPreset(), parts);
const seq = msgs.map(m => m.content).join("|");
t("深度注入顺序", seq === "主提示A|角色描述|u1|a1|深度2注入|u2|a2|深度0注入");
t("停用条目被跳过", seq.indexOf("不应出现") < 0);
/* 无 history marker 时追加到末尾 */
const p2 = {name:"t2", prompts: [
{ name:"sys", role:"system", content:"S", marker:false, enabled:true, pos:0},
{ name:"注入", role:"system", content:"尾注入", marker:false, enabled:true, injection_position:"chat", injection_depth:0, pos:1},
]};
const m2 = RP_PRESET.assemble(p2, parts);
t("无历史标记追加末尾", m2[m2.length-1].content === "尾注入");
/* 深度超限钳制到历史开头 */
const p3 = {name:"t3", prompts: [
{ name:"历史", marker:true, identifier:"chatHistory", enabled:true, pos:0},
{ name:"深注", role:"system", content:"深", marker:false, enabled:true, injection_position:"chat", injection_depth:99, pos:1},
]};
const m3 = RP_PRESET.assemble(p3, parts);
t("深度超限钳制", m3[0].content === "深" && m3[1].content === "u1");
/* 宏在注入条目里求值 */
const p4 = {name:"t4", prompts: [
{ name:"历史", marker:true, identifier:"chatHistory", enabled:true, pos:0},
{ name:"宏", role:"system", content:"你是{{char}}", marker:false, enabled:true, injection_position:"chat", injection_depth:0, pos:1},
]};
const m4 = RP_PRESET.assemble(p4, {history: hist, charName:"美琴", userName:"你"});
t("注入条目宏求值", m4[m4.length-1].content === "你是美琴");
/* sysTokens 计入注入条目 */
const p5 = {name:"t5", prompts: [
{ name:"注入", role:"system", content:"1234567890", marker:false, enabled:true, injection_position:"chat", injection_depth:0, pos:0},
]};
t("sysTokens计入注入条目", RP_PRESET.sysTokens(p5, {charName:"x", userName:"y"}) > 0);
}

/* ---------- 预设: 条目增删改排 ---------- */
{
const {ctx} = mkCtx();
vm.runInContext(fs.readFileSync(WWW + "/rp/preset.js", "utf8"), ctx, {filename: "preset.js"});
const RP_PRESET = ctx.window.RP_PRESET;
RP_PRESET.save({id:"crud1", name:"crud", at:1, prompts:[
{ name:"A", role:"system", content:"a", marker:false, enabled:true, pos:0},
{ name:"B", role:"system", content:"b", marker:false, enabled:true, pos:1},
]});
let p = RP_PRESET.addEntry("crud1", {name:"C", role:"user", content:"c", injection_position:"chat", injection_depth:3});
t("新增条目", p.prompts.length === 3 && p.prompts[2].name === "C" && p.prompts[2].injection_depth === 3);
t("新增条目pos连续", p.prompts[2].pos === 2);
p = RP_PRESET.moveEntry("crud1", 2, -1);
t("上移排序", p.prompts[1].name === "C" && p.prompts[2].name === "B");
t("排序后pos重排", p.prompts[0].pos === 0 && p.prompts[1].pos === 1 && p.prompts[2].pos === 2);
p = RP_PRESET.moveEntry("crud1", 0, -1);
t("顶端上移不变", p.prompts[0].name === "A");
const e = RP_PRESET.updateEntry("crud1", 1, {name:"C2", role:"assistant", content:"cc", injection_position:"", injection_depth:9});
t("编辑条目", e.name === "C2" && e.role === "assistant" && e.content === "cc" && e.injection_position === "" && e.injection_depth === null);
p = RP_PRESET.deleteEntry("crud1", 1);
t("删除条目", p.prompts.length === 2 && p.prompts[0].name === "A" && p.prompts[1].name === "B");
t("删除后pos连续", p.prompts[1].pos === 1);
/* 持久化: 重新 get 能读回 */
const p2 = RP_PRESET.get("crud1");
t("CRUD持久化", p2.prompts.length === 2 && p2.prompts[1].name === "B");
}

/* ---------- 穿越: 角色卡全字段 + 预设 + travCard ---------- */
{
const {ctx} = mkCtx();
vm.runInContext(fs.readFileSync(WWW + "/rp/preset.js", "utf8"), ctx, {filename: "preset.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/prompt.js", "utf8"), ctx, {filename: "prompt.js"});
const card = {
name: "美琴", scenario: "学园都市",
greeting: "呦，好巧。",
systemPrompt: "你是御坂美琴，傲娇。",
creatorNotes: "作者注：别写崩。",
postHistoryInstructions: "结尾保持傲娇。",
tags: ["傲娇", "中二"],
flair: "roleplay",
temperature: 1.2,
worldbook: [],
fields: {
core_identity: "常盘台的王牌",
gender: "女", age_stage: "14岁",
core_traits: "傲娇、正义感强",
speech_style: "口是心非",
signature_phrases: "哼，才不是呢",
life_timeline: "幼年被研究",
},
exampleBlocks: [{turns: [{who: "user", text: "在吗"}, {who: "char", text: "干嘛啦！"}]}],
};
ctx.RP_CARDIMPORT = {findById: id => (id === "c1"? card: null)};
vm.runInContext(fs.readFileSync(WWW + "/rp/traverse.js", "utf8"), ctx, {filename: "traverse.js"});
/* traverse.js 用顶层 const 导出, 不挂 window, 从词法环境取 */
const RP_TRAVERSE = vm.runInContext("RP_TRAVERSE", ctx);
const trav = {id:"t1", mode:"soul", worldKind:"card", worldId:"c1",
charName:"美琴", worldName:"某科学", anchorTitle:"开学典礼"};
t("travCard取到卡", RP_TRAVERSE.travCard(trav) === card);
t("travCard无卡返回null", RP_TRAVERSE.travCard({mode:"body", worldKind:"book", worldId:"x"}) === null);
const b = RP_TRAVERSE.buildMessages(trav, {history:[{role:"user",content:"你好"}], memory:"", worldbook:[]}, {maxContext:8192});
const pv = b.preview;
t("穿越注入system_prompt", pv.indexOf("你是御坂美琴，傲娇。") >= 0);
t("穿越注入作者注", pv.indexOf("作者注：别写崩。") >= 0);
t("穿越注入核心人设", pv.indexOf("常盘台的王牌") >= 0);
t("穿越注入行为标签", pv.indexOf("傲娇、中二") >= 0);
/* P1-13: 删恒真断言("穿越注入文风"查空串)。注：traverse 全字段注入里文风即【说话方式】段，已被"说话方式"条覆盖。 */
t("穿越注入说话方式", pv.indexOf("口是心非") >= 0);
t("穿越注入对话示例", pv.indexOf("干嘛啦！") >= 0);
t("穿越注入人物背景", pv.indexOf("幼年被研究") >= 0);
t("穿越post带postHistoryInstructions", pv.indexOf("结尾保持傲娇。") >= 0);
t("穿越post带穿越规则", pv.indexOf("「穿越规则」") >= 0);
t("魂穿身份块无重复人设", RP_TRAVERSE.identityBlock(trav).indexOf("人设参考") < 0);
/* ST 预设路径 */
const stp = {name:"穿越预设", prompts: [
{ name:"sys", role:"system", content:"预设头", marker:false, enabled:true, pos:0},
{ name:"人物", marker:true, identifier:"charDescription", enabled:true, pos:1},
{ name:"历史", marker:true, identifier:"chatHistory", enabled:true, pos:2},
{ name:"尾注", role:"system", content:"贴{{char}}", marker:false, enabled:true, injection_position:"chat", injection_depth:0, pos:3},
]};
const b2 = RP_TRAVERSE.buildMessages(trav, {history:[{role:"user",content:"嗨"}], memory:"", worldbook:[]},
{maxContext:8192, stPreset: stp});
t("穿越stPreset标记", b2.stats.stPreset === "穿越预设");
const seq2 = b2.messages.map(m => m.content).join("‖");
t("穿越预设组装顺序", b2.messages[0].content === "预设头" && seq2.indexOf("常盘台的王牌") > 0);
t("穿越预设注入条目宏", seq2.indexOf("贴美琴") > 0);
t("穿越预设历史展开", seq2.indexOf("嗨") > 0);
t("穿越预设末尾是post", b2.messages[b2.messages.length-1].content.indexOf("「穿越规则」") >= 0);
/* 肉身模式无卡不崩 */
const travB = {id:"t2", mode:"body", worldKind:"book", worldId:"r1", worldName:"红楼梦", identityId:"i1"};
RP_TRAVERSE.saveIdentity({id:"i1", name:"林探花", gender:"男", age:"20", origin:"现代", traits:"机灵", talent:"嘴炮", modern:true});
const b3 = RP_TRAVERSE.buildMessages(travB, {history:[], memory:"", worldbook:[]}, {maxContext:8192});
t("肉身模式组装不崩", b3.messages.length >= 2 && b3.preview.indexOf("林探花") >= 0);
}

/* ---------- chat.js: travRegexName + 接线 ---------- */
{
const src = fs.readFileSync(WWW + "/rp/chat.js", "utf8");
const fn = new Function("return (" + extractFn(src, "travRegexName") + ")")();
t("魂穿正则键=角色名", fn({mode:"soul", charName:"美琴"}) === "美琴");
t("肉身正则键=世界名", fn({mode:"body", worldName:"红楼梦"}) === "红楼梦");
t("空trav默认", fn(null) === "穿越");
t("sendTraverse调applyRegex", src.indexOf('applyRegex(reply, getRegex("trav", travRegexName(trav)))') >= 0);
t("sendTraverse用卡温度", src.indexOf("RP_TRAVERSE.travCard(trav)") >= 0);
t("sendTraverse传stPreset", src.indexOf("budget.stPreset = resolveStPreset()") >= 0);
}

console.log("pass=" + pass + " fail=" + fail);
process.exit(fail? 1: 0);
