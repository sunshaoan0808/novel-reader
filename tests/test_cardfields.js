const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P1-2: 角色卡字段补齐 (alternate_greetings / extensions.example_dialogue)
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
key: i => Object.keys(store)[i] || null,
get length(){ return Object.keys(store).length; },
};
const ctx = {localStorage, console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["rp/prompt.js", "rp/cardwriter.js", "rp/cardimport.js", "rp/cardexport.js", "rp/chat.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- normalizeTavern 保留两字段 ----
const raw = {name: "测试姬", tags: ["测试"], description: "desc", personality: "pers",
first_mes: "hi", mes_example: "", alternate_greetings: ["开场1", "", "开场2"],
extensions: {example_dialogue: "<START>\n{{user}}: 你好\n{{char}}: 姑娘好"}};
const norm = vm.runInContext("RP_CARDIMPORT.normalizeTavern(" + JSON.stringify(raw) + ")", ctx);
t("归一化保留altGreetings", norm.altGreetings.length === 2 && norm.altGreetings[0] === "开场1");
t("归一化过滤空开场", norm.altGreetings.indexOf("") < 0);
t("归一化保留exampleDialogue", norm.exampleDialogue.indexOf("姑娘好") >= 0);
const norm2 = vm.runInContext("RP_CARDIMPORT.normalizeTavern({name:'x'})", ctx);
t("缺字段时给空默认", Array.isArray(norm2.altGreetings) && norm2.exampleDialogue === "");
// 上限 8 条
const many = vm.runInContext("RP_CARDIMPORT.normalizeTavern({name:'x',alternate_greetings:['a','b','c','d','e','f','g','h','i','j']})", ctx);
t("开场白上限8条", many.altGreetings.length === 8);

// ---- buildTavernCard 写回 ----
const tav = vm.runInContext("RP_CARDEXPORT.buildTavernCard(" + JSON.stringify(norm) + ")", ctx);
t("导出写回alternate_greetings", tav.data.alternate_greetings.length === 2);
t("导出写回example_dialogue", (tav.data.extensions.example_dialogue || "").indexOf("姑娘好") >= 0);
// ---- roundtrip: 导出 data 再归一化, 两字段不丢 ----
const normRT2 = vm.runInContext("(function(){ var d = " + JSON.stringify(tav.data) + "; return RP_CARDIMPORT.normalizeTavern(d); })()", ctx);
t("roundtrip保留开场白", normRT2.altGreetings.length === 2 && normRT2.altGreetings[1] === "开场2");
t("roundtrip保留示例对话", normRT2.exampleDialogue.indexOf("姑娘好") >= 0);

// ---- RP_CARDIMPORT.update 原位更新 ----
vm.runInContext("RP_CARDIMPORT.add(" + JSON.stringify(norm) + ")", ctx);
const cardId = norm.id;
vm.runInContext("(function(){ var c = RP_CARDIMPORT.findById('" + cardId + "'); c.exampleDialogue='新对话'; RP_CARDIMPORT.update(c); })()", ctx);
const upd = vm.runInContext("RP_CARDIMPORT.findById('" + cardId + "')", ctx);
t("update写回字段", upd.exampleDialogue === "新对话");
t("update保留顺序", vm.runInContext("RP_CARDIMPORT.list()[0].id", ctx) === cardId);

// ---- findCard 透传 ----
vm.runInContext("(function(){ var W = RP_WRITER; var list = W.getCustomChars(); list.push({id:'c1', name:'自创姬', fields:{core_identity:'剑客'}, altGreetings:['拔剑吧'], exampleDialogue:'示例对白'}); W.saveCustomChars(list); })()", ctx);
const fc = vm.runInContext("RP.findCard('custom','自创姬')", ctx);
t("findCard自创卡透传altGreetings", fc.altGreetings.length === 1 && fc.altGreetings[0] === "拔剑吧");
t("findCard自创卡透传exampleDialogue", fc.exampleDialogue === "示例对白");
const fi = vm.runInContext("RP.findCard('imported','" + norm.name + "')", ctx);
t("findCard导入卡透传", fi.altGreetings.length === 2 && fi.exampleDialogue === "新对话");

// ---- greeting 优先用多开场白(无 key 也能回) ----
(async ()=>{
const g = await vm.runInContext("RP.greeting('custom','自创姬',{},'测试')", ctx);
t("greeting用altGreetings", g === "拔剑吧");
// ---- buildExamples 拼入 example_dialogue ----
const ex = vm.runInContext("RP_PROMPT.buildExamples({fields:{}, exampleDialogue:'自带示例对话文本'}, '测试姬', 500)", ctx);
t("buildExamples含卡片示例", ex.indexOf("自带示例对话文本") >= 0);
const ex2 = vm.runInContext("RP_PROMPT.buildExamples({fields:{}}, '测试姬', 500)", ctx);
t("无示例时返回空", ex2 === "");
console.log(`cardfields: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})();
