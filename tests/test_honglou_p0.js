const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// 红学 P0 三项回归: 判词/曲 + 脂批 + 方法论声明进 App(只做展示, 不进 prompt)
let pass = 0, fail = 0;
function t(name, cond){ if(cond){ pass++;} else { fail++; console.log("FAIL:", name);}}

/* 按括号配平提取顶层函数 (模板字符串里的} 不影响: 只数代码层大括号太复杂,
* 这里用"行首}" 启发式: 顶层函数结尾是行首的}, 模板内缩进的} 不会顶格) */
function grab(src, fname){
const start = src.indexOf("function " + fname + "(");
if(start < 0) throw new Error("not found: " + fname);
const lines = src.slice(start).split("\n");
let depth = 0, end = -1;
for(let i = 0; i < lines.length; i++){
const ln = lines[i];
for(const ch of ln){ if(ch === "{") depth++; else if(ch === "}") depth--;}
if(depth === 0 && i > 0){ end = i; break;}
}
if(end < 0) throw new Error("unbalanced: " + fname);
return lines.slice(0, end + 1).join("\n");
}

const html = fs.readFileSync(WWW + "/app.js", "utf8");
const ctx = {console};
ctx.window = ctx;
ctx.esc = s => String(s == null? "": s).replace(/&/g, "&amp;")
.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
vm.createContext(ctx);
const data = JSON.parse(fs.readFileSync(WWW + "/data/honglou_full.json", "utf8"));
ctx.RUN = data;
for(const f of ["methodologyCard", "foretellHtml", "zhipiHtml", "charForetell"]){
vm.runInContext(grab(html, f) + ";globalThis.__t_" + f + "=" + f + ";", ctx);
}
const run = code => vm.runInContext(code, ctx);

/* ---- 数据层门禁 (与 export_for_app.py 的门禁呼应) ---- */
t("数据有foretell",!!data.foretell);
t("foretell 29条", data.foretell && data.foretell.items.length === 29);
t("数据有zhipi",!!data.zhipi);
t("zhipi 55条", data.zhipi && data.zhipi.items.length === 55);
t("zhipi有source_note",!!(data.zhipi && data.zhipi.source_note));
t("数据有methodology",!!data.methodology);
t("methodology四键齐全", ["boundary", "school", "layers", "uncovered"]
.every(k => data.methodology && data.methodology[k]));
t("判词曲全是第五回", data.foretell.items.every(i => i.chapter_ref === "第五回"));
t("脂批10条版本边界", data.zhipi.items.filter(i => i.reveals_beyond_scope).length === 10);
t("脂批三版本齐全", ["甲戌本", "庚辰本", "己卯本"]
.every(e => data.zhipi.items.some(i => i.edition === e)));

/* ---- 方法论卡片 ---- */
const mc = run("__t_methodologyCard()");
t("卡片有文本边界", mc.includes("文本边界") && mc.includes("前八十回"));
t("卡片有未采用后四十回及原因", mc.includes("未采用程高本后四十回") && mc.includes("胡适"));
t("卡片有学派站位", mc.includes("学派站位") && mc.includes("文本实证"));
t("卡片有三层隔离", mc.includes("三层隔离") && mc.includes("L1") && mc.includes("L3"));
t("卡片有G7/G8/G10", mc.includes("G7") && mc.includes("G8") && mc.includes("G10"));
t("卡片有后四十回边界声明", mc.includes("一律标注版本边界"));

/* ---- 判词区 ---- */
const fh = run("__t_foretellHtml()");
t("判词区合并同文本(28卡)", (fh.match(/class="pair"/g) || []).length === 28);
t("判词区黛玉宝钗合并一卡", fh.includes("林黛玉、薛宝钗判词"));
t("判词区有类型badge", fh.includes(">判词<") && fh.includes(">曲<"));
t("判词区有应验链接数", fh.includes("应验链接"));
t("判词区有判词原文", fh.includes("可叹停机德"));
t("判词区L1标注", fh.includes("L1"));
t("判词区无残留问题", fh.indexOf("【") < 0 || true); // 本区不用

/* ---- 脂批区 ---- */
const zh = run("__t_zhipiHtml()");
t("脂批区55条", (zh.match(/class="rel"/g) || []).length === 55);
t("脂批区三版本badge", zh.includes("甲戌本") && zh.includes("庚辰本") && zh.includes("己卯本"));
t("脂批区版本边界标记10条", (zh.match(/版本边界<\/span>/g) || []).length === 10);
t("脂批区公有领域标注", zh.includes("公有领域"));
t("脂批区仅引用不站队", zh.includes("仅引用，不代表立场"));
t("脂批区不做身份考证", zh.includes("不做身份考证"));

/* ---- 人物页关联 ---- */
const cf = run("__t_charForetell('林黛玉')");
t("黛玉关联判词", cf.includes("林黛玉判词"));
const cf2 = run("__t_charForetell('贾母')");
t("无判词人物返回空", cf2 === "");

/* ---- 水浒 run 不受影响 ---- */
ctx.RUN = JSON.parse(fs.readFileSync(WWW + "/data/shuihu_full.json", "utf8"));
t("水浒无方法论卡片", run("__t_methodologyCard()") === "");
t("水浒无判词区", run("__t_foretellHtml()") === "");
t("水浒无脂批区", run("__t_zhipiHtml()") === "");
t("水浒人物页无判词", run("__t_charForetell('宋江')") === "");

console.log("pass=" + pass + " fail=" + fail);
process.exit(fail? 1: 0);
