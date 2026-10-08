const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// ST 预设导出回归测试: RP_PRESETEXPORT.exportPreset (parseFile 的逆操作)
// 真实 fixture: tests/fixtures/mom-2.4.json (MoM 2.4, 146 条 prompts)
// 往返: 真实预设 -> parseFile -> exportPreset -> parseFile, 条目字段一致
function mkCtx(){
const store = {};
const localStorage = {
getItem: (k)=> (k in store ? store[k] : null),
setItem: (k, v)=>{ store[k] = String(v); },
removeItem: (k)=>{ delete store[k]; },
};
const ctx = {console, localStorage};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for(const f of ["rp/preset.js", "rp/presetexport.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
return ctx;
}
const ctx = mkCtx();
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const run = (code)=> vm.runInContext(code, ctx);

const mom = JSON.parse(fs.readFileSync("tests/fixtures/mom-2.4.json", "utf8"));
ctx.__mom = mom;
const r1 = run(`RP_PRESET.parseFile(__mom)`);
t("真实 MoM 解析成功", r1.ok && r1.preset.prompts.length === 146);

// ---- 导出形状 ----
ctx.__p1 = r1.preset;
const ex2 = run(`RP_PRESETEXPORT.exportPreset(__p1)`);
t("导出 prompts 数量一致", ex2.prompts.length === 146);
t("导出 name 保留", ex2.name === r1.preset.name);
t("导出 temperature/top_p 保留",
  ex2.temperature === mom.temperature && ex2.top_p === mom.top_p);
t("导出条目有 ST 字段",
  ex2.prompts.every(p=> Array.isArray(Object.keys(p)) && "name" in p && "role" in p
    && "content" in p && "marker" in p && "identifier" in p && "enabled" in p));
t("marker 条目保留", ex2.prompts.filter(p=>p.marker).length === 8);
t("disabled 条目保留(enabled=false, prompt_order覆盖后66启用)",
  ex2.prompts.filter(p=>!p.enabled).length === 146 - 66);

// ---- 往返: 导出 -> 再解析, 与第一次解析结果一致 ----
ctx.__ex2 = ex2;
const r2 = run(`RP_PRESET.parseFile(JSON.stringify(__ex2))`);
t("导出可被 parseFile 读回", r2.ok);
const f1 = r1.preset.prompts, f2 = r2.preset.prompts;
const fields = ["name","role","content","marker","identifier","enabled","group","injection_position","injection_depth"];
let same = f1.length === f2.length;
if(same) for(let i = 0; i < f1.length; i++)
  for(const k of fields)
    if(JSON.stringify(f1[i][k]) !== JSON.stringify(f2[i][k])){ same = false; break; }
t("往返条目字段一致", same);
t("往返 params 一致",
  JSON.stringify(r1.preset.params) === JSON.stringify(r2.preset.params));

// ---- 边界 ----
const empty = run(`RP_PRESETEXPORT.exportPreset(null)`);
t("空输入不抛错", empty && Array.isArray(empty.prompts));
const noParams = run(`RP_PRESETEXPORT.exportPreset({name:"x",prompts:[{name:"a",content:"b"}]})`);
t("缺 params 不写 temperature", !("temperature" in noParams) && noParams.prompts[0].role === "system");

// ---- 静态: UI 入口 ----
const html = fs.readFileSync(WWW+"/index.html", "utf8");
t("presetexport.js in index.html", html.indexOf("rp/presetexport.js") >= 0);
const asrc = fs.readFileSync(WWW+"/app.js", "utf8");
t("导出所选预设 button", asrc.indexOf("exportStPreset()") >= 0);
t("window.exportStPreset", asrc.indexOf("window.exportStPreset") >= 0);
t("downloadJson helper", asrc.indexOf("function downloadJson") >= 0);

console.log(`\nstpreset_export: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
