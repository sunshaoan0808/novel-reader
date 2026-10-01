/* ST 人设导入导出测试。
 * 真实格式依据:
 *  - 单个人设 JSON {name, description, avatar}: sillytavern-persona-generator README
 *    (ST Persona Management 的 Create->Import 接受此格式)
 *  - 批量 {personas:{头像文件名:显示名}, persona_descriptions:{头像文件名:{description,title}}}:
 *    ST settings.json power_user.personas / persona_descriptions (backup-manager 等备份工具导出的 personas.json)
 *  fixture 为按文档格式构造的合成样本, 无真实用户数据。
 */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const WWW = path.join(ROOT, "www");
eval(fs.readFileSync(path.join(WWW, "rp/persona.js"), "utf8"));

let pass = 0, fail = 0;
function t(name, cond){
if(cond){ pass++; }
else{ fail++; console.error("FAIL:", name); }
}
function eq(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
function throws(fn){ try{ fn(); return false; }catch(e){ return true; } }

/* 1) 单个人设 JSON 解析 */
const single = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/persona-st-single.json"), "utf8"));
const s1 = RP_PERSONA.stPersonaParse(single);
t("single: 解析出 1 个人设", s1.length === 1);
t("single: name", s1[0].name === "阿宅");
t("single: description -> desc", s1[0].desc.indexOf("程序员") >= 0);
t("single: 无 title/called 时为空", s1[0].extra === "" && s1[0].called === "");

/* 2) ST 原生批量解析 */
const bulk = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/persona-st-bulk.json"), "utf8"));
const b1 = RP_PERSONA.stPersonaParse(bulk);
t("bulk: 解析出 3 个人设", b1.length === 3);
const night = b1.find(p=>p.name === "夜行者");
t("bulk: 显示名映射", !!night);
t("bulk: description -> desc", night && night.desc.indexOf("深夜活动") >= 0);
t("bulk: title -> extra", night && night.extra === "常用人设");
const mystery = b1.find(p=>p.name === "mystery");
t("bulk: 空显示名回退到文件名 stem", !!mystery);
t("bulk: 无 description 时 desc 为空", mystery && mystery.desc === "");

/* 3) 本机 -> ST -> 本机 往返 */
const mine = {name: "阿宅", desc: "程序员，夜猫子", extra: "喜欢老电影", called: "宅宅"};
const exp = RP_PERSONA.stPersonaExport(mine);
t("export: 键齐全", eq(Object.keys(exp).sort(), ["avatar","called","description","name","title"]));
t("export: name/description", exp.name === "阿宅" && exp.description === "程序员，夜猫子");
t("export: extra -> title", exp.title === "喜欢老电影");
t("export: called 保留", exp.called === "宅宅");
t("export: avatar 为空串", exp.avatar === "");
const back = RP_PERSONA.stPersonaParse(JSON.parse(JSON.stringify(exp)))[0];
t("往返: 四字段一致", eq(back, mine));

/* 4) 异常输入 */
t("null 抛错", throws(()=>RP_PERSONA.stPersonaParse(null)));
t("空对象抛错", throws(()=>RP_PERSONA.stPersonaParse({})));
t("personas 为空抛错", throws(()=>RP_PERSONA.stPersonaParse({personas: {}})));
t("字符串抛错", throws(()=>RP_PERSONA.stPersonaParse("oops")));

/* 5) 静态: UI 入口 */
const asrc = fs.readFileSync(path.join(WWW, "app.js"), "utf8");
t("导入 ST 人设 button", asrc.indexOf("importStPersona()") >= 0);
t("导出 ST 人设 button", asrc.indexOf("exportStPersonaUI()") >= 0);
t("window.importStPersona", asrc.indexOf("window.importStPersona") >= 0);
t("window.exportStPersonaUI", asrc.indexOf("window.exportStPersonaUI") >= 0);
const psrc = fs.readFileSync(path.join(WWW, "rp/persona.js"), "utf8");
t("persona.js 有 stPersonaParse", psrc.indexOf("function stPersonaParse") >= 0);
t("persona.js 有 stPersonaExport", psrc.indexOf("function stPersonaExport") >= 0);
t("persona.js 导出到 RP_PERSONA", psrc.indexOf("stPersonaParse: stPersonaParse") >= 0);

console.log(`\nstpersona: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
