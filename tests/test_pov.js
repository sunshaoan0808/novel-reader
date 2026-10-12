const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 视角/人称切换: postInstructions / groupPostInstructions / 抽屉 chips / 持久化
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

// ---- rp/prompt.js ----
{
const src = fs.readFileSync(WWW+"/rp/prompt.js", "utf8");
const ctx = {console};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const RP_PROMPT = vm.runInContext("RP_PROMPT", ctx);

const dflt = RP_PROMPT.postInstructions("林黛玉");
t("default is player POV", dflt.includes("以玩家为中心"));
t("default is second person", dflt.includes("第二人称"));
t("default drops first-person-character POV", !dflt.includes("用第一人称"));
t("default warns against 我 flooding", dflt.includes("避免“我”泛滥出戏") || dflt.includes("不必反复自报家门"));

const cf = RP_PROMPT.postInstructions("林黛玉", "char", "first");
t("char+first mentions first person", cf.includes("第一人称"));
t("char POV centers character", cf.includes("以林黛玉为中心"));
t("char+first keeps 你 for player", cf.includes("“你”指代玩家"));

const th = RP_PROMPT.postInstructions("林黛玉", "player", "third");
t("third person", th.includes("第三人称"));
t("third uses name for char", th.includes("“林黛玉”"));

const card = {name:"林黛玉", fields:{core_traits:"敏感", speech_style:"爱用反问"}};
const b1 = RP_PROMPT.buildMessages(card, {novel:"红楼梦", worldbook:[], relations:[], memory:"",
  history:[{role:"user", content:"你好"}]}, {maxContext:8192, response:512});
t("buildMessages default pov in preview", b1.preview.includes("以玩家为中心") && b1.preview.includes("第二人称"));
const b2 = RP_PROMPT.buildMessages(card, {novel:"红楼梦", worldbook:[], relations:[], memory:"",
  history:[{role:"user", content:"你好"}], pov:"char", person:"first"}, {maxContext:8192, response:512});
t("buildMessages ctx pov/person pass-through",
  b2.preview.includes("以林黛玉为中心") && b2.preview.includes("第一人称"));
// 最后一条 system 消息就是 post 指令
const lastSys = b2.messages[b2.messages.length-1];
t("post instruction is last system msg", lastSys.role === "system" && lastSys.content.includes("第一人称"));
}

// ---- rp/group.js ----
{
const src = fs.readFileSync(WWW+"/rp/group.js", "utf8");
const ctx = {console};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const RP_GROUP = vm.runInContext("RP_GROUP", ctx);
const g1 = RP_GROUP.groupPostInstructions("贾宝玉", ["林黛玉"]);
t("group default player POV", g1.includes("以玩家为中心"));
t("group default second person", g1.includes("第二人称"));
t("group default not 你就是本人", !g1.includes("你就是贾宝玉本人"));
t("group keeps others rule", g1.includes("林黛玉"));
const g2 = RP_GROUP.groupPostInstructions("贾宝玉", ["林黛玉"], "char", "third");
t("group char+third", g2.includes("以贾宝玉为中心") && g2.includes("第三人称"));
}

// ---- app.js: POVS/PERSONS + povChipsHTML + setPov/setPerson + 持久化 ----
{
const src = fs.readFileSync(WWW+"/app.js", "utf8");
function extract(name){
const pats = [
"(?:let|const|var)\\s+"+name+"\\s*=\\s*function\\s*\\(",
"function\\s+"+name+"\\s*\\(",
"(?:let|const|var)\\s+"+name+"\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>",
name+"\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>",
"(?:let|const|var)\\s+"+name+"\\s*=\\s*\\[",
];
for(const p of pats){
const m = src.match(new RegExp(p));
if(!m) continue;
const rest = src.slice(m.index + m[0].length);
if(/^\s*`/.test(rest)){
// 单表达式箭头函数 (模板字面量): 取到行尾分号
const semi = src.indexOf(";", m.index);
return src.slice(m.index, semi + 1);
}
let j = src.indexOf(m[0].endsWith("[") ? "[" : "{", m.index), depth = 0;
for(let k = j; k < src.length; k++){
if(src[k] === "{" || src[k] === "[") depth++;
else if(src[k] === "}" || src[k] === "]"){ depth--; if(!depth) return src.slice(m.index, k+1);}
}
}
throw new Error("not found: " + name);
}
const store = {};
const ctx = {console, window:{},
  localStorage:{getItem:k=>store[k]||null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];}},
  CHAT:{mode:"single", runId:"r1", name:"林黛玉"},
  toggleDrawer:()=>{}, showChat:()=>{}};
vm.createContext(ctx);
ctx.window = ctx;
vm.runInContext(fs.readFileSync(WWW+"/icons.js","utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/escutil.js","utf8"), ctx); /* P0-1: povChipsHTML 用 jq() */
vm.runInContext(extract("POVS"), ctx);
vm.runInContext(extract("PERSONS"), ctx);
vm.runInContext(extract("povStoreKey"), ctx);
vm.runInContext(extract("loadPov"), ctx);
vm.runInContext(extract("savePov"), ctx);
vm.runInContext(extract("povChipsHTML"), ctx);
vm.runInContext(extract("setPov"), ctx);
vm.runInContext(extract("setPerson"), ctx);
const E = (code)=>vm.runInContext(code, ctx);

t("POVS has 2 options", E("POVS.length") === 2);
t("PERSONS has 3 options", E("PERSONS.length") === 3);
t("default pov ids", E("POVS[0].id")==="player" && E("PERSONS[0].id")==="second");

E("loadPov()");
t("loadPov defaults", E("CHAT.pov")==="player" && E("CHAT.person")==="second");
const html = E("povChipsHTML()");
t("chips render 5 buttons", (html.match(/povchip/g)||[]).length === 5);
t("chips default active", html.includes("以我为主") && (html.match(/povchip on/g)||[]).length === 2);
t("chips have labels", html.includes("视角") && html.includes("人称"));

E("setPov('char')");
t("setPov updates CHAT", E("CHAT.pov")==="char");
t("setPov persists", JSON.parse(store["nd_pov_r1_林黛玉"]).pov === "char");
E("setPerson('third')");
t("setPerson updates CHAT", E("CHAT.person")==="third");
t("setPerson persists", JSON.parse(store["nd_pov_r1_林黛玉"]).person === "third");
// 重新加载能读回
E("CHAT.pov='player'; CHAT.person='second'; loadPov();");
t("loadPov reads back", E("CHAT.pov")==="char" && E("CHAT.person")==="third");
// 群聊 key 隔离
E("CHAT.mode='group'; CHAT.name=null; loadPov();");
t("group chat default", E("CHAT.pov")==="player" && E("CHAT.person")==="second");
E("setPov('char')");
t("group key isolated", !!store["nd_pov_r1___group"] && JSON.parse(store["nd_pov_r1_林黛玉"]).pov==="char");
const html2 = E("povChipsHTML()");
t("chips reflect char active", html2.includes("🎭以角色为主") && /povchip on[^>]*>🎭/.test(html2));
}

// ---- sendChatText sendOpts 含 pov/person/onUserMsg; chat.js 调用 onUserMsg ----
{
const src = fs.readFileSync(WWW+"/app.js", "utf8");
t("sendOpts has pov", /pov:\s*CHAT\.pov\s*\|\|\s*"player"/.test(src));
t("sendOpts has person", /person:\s*CHAT\.person\s*\|\|\s*"second"/.test(src));
t("sendOpts has onUserMsg", /onUserMsg:\s*\(\)=>\{\s*renderChat\(true\);\s*\}/.test(src));
const cs = fs.readFileSync(WWW+"/rp/chat.js", "utf8");
t("chat.js fires onUserMsg after push", /if\(opts\.onPush\) opts\.onPush\(\);\n  if\(opts\.onUserMsg\) opts\.onUserMsg\(\);/.test(cs));
t("chat.js ctx gets pov/person", (cs.match(/pov: opts\.pov, person: opts\.person,/g)||[]).length === 3);
t("group post gets pov/person", cs.includes("groupPostInstructions(speaker, others, opts.pov, opts.person)"));
const gs = fs.readFileSync(WWW+"/rp/group.js", "utf8");
t("group.js signature updated", /function groupPostInstructions\(active, others, pov, person\)/.test(gs));
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
