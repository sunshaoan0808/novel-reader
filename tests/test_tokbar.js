const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// P0-1: 编辑器 token 计数条 (tokCount -> 可视化条 + 80%/100% 两档告警)
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false,
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
}
const els = {};
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
};
const document = {
body: mkEl(),
getElementById: id => els[id] || (els[id] = mkEl()),
querySelector: sel => {
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: () => [],
createElement: () => mkEl(),
};
const ctx = {console, localStorage, document, alert(){}, confirm(){ return true; },
setTimeout: () => 0, clearTimeout(){}};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["rp/prompt.js", "rp/persona.js", "rp/escutil.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// 估算函数基本行为 (vm 顶层 const 需经 runInContext 取)
const E = vm.runInContext("RP_PROMPT.estTokens", ctx);
t("estTokens中文", E("你好世界") > 0);
t("estTokens空", E("") === 0);
t("estTokens长文本更大", E("红楼梦".repeat(100)) > E("红楼梦"));

// 默认 maxContext=8192: 少量文本 -> 无告警类
els["ta"] = mkEl(); els["ta"].value = "你好";
els["out"] = mkEl();
vm.runInContext("tokCount('ta','out')", ctx);
t("tokCount渲染条", els["out"].innerHTML.indexOf("tokbar-fg") >= 0);
t("tokCount低用量无告警", els["out"].innerHTML.indexOf("warn") < 0 && els["out"].innerHTML.indexOf("over") < 0);

// 数组输入: 三个字段合并计数
els["a"] = mkEl(); els["a"].value = "甲";
els["b"] = mkEl(); els["b"].value = "乙";
els["c"] = mkEl(); els["c"].value = "丙";
vm.runInContext("tokCount(['a','b','c'],'out')", ctx);
const n3 = parseInt((els["out"].innerHTML.match(/约 (\d+) \//)||[])[1] || "0", 10);
t("tokCount数组合并", n3 === E("甲\n乙\n丙\n"));

// 80% 告警: 构造足够长的文本 (8192*0.8=6553 tokens; 中文1字~1.6tok -> 4100字)
els["big"] = mkEl(); els["big"].value = "红".repeat(4200);
vm.runInContext("tokCount('big','out')", ctx);
t("tokCount 80%告警类", els["out"].innerHTML.indexOf("warn") >= 0);

// 100% 超限
els["huge"] = mkEl(); els["huge"].value = "红".repeat(6000);
vm.runInContext("tokCount('huge','out')", ctx);
t("tokCount 100%超限类", els["out"].innerHTML.indexOf("over") >= 0);
t("tokCount超限提示文案", els["out"].innerHTML.indexOf("已超上下文") >= 0);

// 缺失元素不抛错
vm.runInContext("tokCount('nope','alsono')", ctx);
t("tokCount缺失元素不崩", true);

// 剧情线/Persona 编辑器模板里挂了 tokCount
const src = fs.readFileSync(WWW + "/app.js", "utf8");
t("plotEditor挂tokCount", src.indexOf("tokCount('p_outline','p_tok')") >= 0);
t("personaEditor挂tokCount", src.indexOf("tokCount(['p_name','p_called','p_desc','p_extra'],'p_tok')") >= 0); /* #20: 新增 p_called */
t("loreForm保留", src.indexOf("tokCount('l_content','l_tok')") >= 0);
t("regexForm保留", src.indexOf("tokCount('x_rep','x_tok')") >= 0);

console.log(`tokbar: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
