const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// rp/persona.js: 全局人设 + 按聊天覆盖
const src = fs.readFileSync(WWW+"/rp/persona.js", "utf8");
const store = {};
const localStorage = {
  getItem: (k)=> (k in store ? store[k] : null),
  setItem: (k, v)=>{ store[k] = String(v); },
  removeItem: (k)=>{ delete store[k]; },
};
const ctx = {console, localStorage};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const P = ctx.RP_PERSONA;

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

t("empty resolve null", P.resolve("r1") === null);
t("renderText empty", P.renderText(null) === "" && P.renderText({}) === "");

P.saveGlobal({name: "阿绫", desc: "INFJ，熬夜冠军", extra: "喜欢红楼梦"});
t("global roundtrip", P.getGlobal().name === "阿绫");
t("resolve falls back to global", P.resolve("r1").desc === "INFJ，熬夜冠军");
t("renderText has name+desc",
  P.renderText(P.getGlobal()).indexOf("阿绫") >= 0 &&
  P.renderText(P.getGlobal()).indexOf("INFJ") >= 0);

P.saveOverride("r1", {name: "凌", desc: "ESTP"});
t("override wins", P.resolve("r1").name === "凌" && P.resolve("r1").desc === "ESTP");
t("other run still global", P.resolve("r2").name === "阿绫");

P.saveOverride("r1", null);
t("clear override falls back", P.resolve("r1").name === "阿绫");

P.saveGlobal({name: "", desc: "", extra: ""});
t("empty global clears", P.getGlobal() === null && P.resolve("r9") === null);

// prompt.js persona 段存在且四处 preset 都有
const psrc = fs.readFileSync(WWW+"/rp/prompt.js", "utf8");
t("persona in all presets", (psrc.match(/persona: 6/g) || []).length === 4);
t("persona add call", psrc.indexOf('add("persona"') >= 0);

// chat.js 四处注入
const csrc = fs.readFileSync(WWW+"/rp/chat.js", "utf8");
t("chat.js injects persona x4",
  (csrc.match(/RP_PERSONA\.renderText\(RP_PERSONA\.resolve\(runId\)\)/g) || []).length === 4);

// index.html 注册
const html = fs.readFileSync(WWW+"/index.html", "utf8");
t("persona.js in index.html", html.indexOf('rp/persona.js') >= 0);

// app.js UI 入口
const asrc = fs.readFileSync(WWW+"/app.js", "utf8");
t("personaEditor exists", asrc.indexOf("window.personaEditor") >= 0);
t("drawer entries", (asrc.match(/personaEditor\(/g) || []).length >= 3);

console.log(`\npersona: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
