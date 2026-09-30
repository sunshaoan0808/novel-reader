const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// memory.js 的 pin / 删除 / parseState 保留 pin / renderPrompt 置顶区
const memSrc = fs.readFileSync(WWW+"/rp/memory.js", "utf8");
function extract(src, name){
const re = new RegExp("(?:function\\s+" + name + "|(?:let|const|var)\\s+" + name + "\\s*=\\s*function)\\s*\\(");
const m = src.match(re);
if(!m) throw new Error("not found: " + name);
let j = src.indexOf("{", m.index), depth = 0;
for(let k = j; k < src.length; k++){
if(src[k] === "{") depth++;
else if(src[k] === "}"){ depth--; if(!depth) return src.slice(m.index, k+1);}
}
throw new Error("unbalanced: " + name);
}
const store = {};
const localStorage = {
getItem: (k)=> (k in store? store[k]: null),
setItem: (k, v)=>{ store[k] = String(v);},
removeItem: (k)=>{ delete store[k];},
};
const ctx = {console, localStorage};
vm.createContext(ctx);
vm.runInContext(memSrc, ctx);
vm.runInContext("var SHORT_MAX = 30;", ctx);
vm.runInContext(extract(memSrc, "parseState"), ctx);
const RP_MEM = vm.runInContext("RP_MEM", ctx);
const E = (code)=>vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c? pass++: (fail++, console.log("FAIL:", n));};

const seed = {mood: {state:"甜蜜", filter:""}, short: [
{id:1, time:"昨天", fact:"一起逛街", view:""},
{id:2, time:"今早", fact:"吵了一架", view:"其实是害羞"},
{id:3, time:"刚才", fact:"和好了", view:""},
], long:""};
RP_MEM.save("r1", "阿绫", seed);

t("togglePin on", RP_MEM.togglePin("r1", "阿绫", 2) === true);
let st = RP_MEM.get("r1", "阿绫");
t("pin persisted", st.short.find(m=>m.id===2).pin === true);

const prompt = RP_MEM.renderPrompt(st);
const pinIdx = prompt.indexOf("\u3010\u7f6e\u9876\u8bb0\u5fc6\u3011");
const recIdx = prompt.indexOf("\u3010\u8fd1\u671f\u8bb0\u5fc6\u3011");
t("pinned section first", pinIdx >= 0 && recIdx >= 0 && pinIdx < recIdx);
t("pinned fact in pin section",
prompt.slice(pinIdx, recIdx).indexOf("吵了一架") >= 0);
t("unpinned not in pin section",
prompt.slice(pinIdx, recIdx).indexOf("一起逛街") < 0);

t("togglePin off", RP_MEM.togglePin("r1", "阿绫", 2) === false);
t("unpin persisted", RP_MEM.get("r1", "阿绫").short.find(m=>m.id===2).pin!== true);

t("delItem ok", RP_MEM.delItem("r1", "阿绫", 1) === true);
t("delItem removed", RP_MEM.get("r1", "阿绫").short.length === 2);
t("delItem missing", RP_MEM.delItem("r1", "阿绫", 999) === false);

// parseState: 上一轮 pin 按 id 回填 (LLM 输出不带 pin 字段)
RP_MEM.save("r2", "小红", {mood:null, short:[{id:1, fact:"a", pin:true},{id:2, fact:"b"}], long:""});
const prev = RP_MEM.get("r2", "小红");
const raw = JSON.stringify({mood:{state:"平静", filter:""},
short:[{id:1, time:"t1", fact:"a2", view:""},{id:2, time:"t2", fact:"b2", view:""}],
long:""});
const next = E(`parseState(${JSON.stringify(raw)}, ${JSON.stringify(prev)})`);
t("parseState keeps pin by id",
next && next.short.find(m=>m.id===1).pin === true &&!next.short.find(m=>m.id===2).pin);
t("parseState updates facts", next.short.find(m=>m.id===1).fact === "a2");

console.log(`\nmemory pin: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
