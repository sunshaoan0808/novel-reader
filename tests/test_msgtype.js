const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// chat.js: mapHistory（消息分型 → 模型历史映射）+ tagUserMsg（打标记）
const src = fs.readFileSync(WWW+"/rp/chat.js", "utf8");
function extract(src, name){
const pats = [
"(?:let|const|var)\\s+"+name+"\\s*=\\s*function\\s*\\(",
"function\\s+"+name+"\\s*\\(",
"(?:let|const|var)\\s+"+name+"\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>",
name+"\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>",
];
for(const p of pats){
const m = src.match(new RegExp(p));
if(!m) continue;
let j = src.indexOf("{", m.index), depth = 0;
for(let k = j; k < src.length; k++){
if(src[k] === "{") depth++;
else if(src[k] === "}"){ depth--; if(!depth) return src.slice(m.index, k+1);}
}
}
throw new Error("not found: " + name);
}
const ctx = {console};
vm.createContext(ctx);
vm.runInContext(extract(src, "mapHistory"), ctx);
vm.runInContext(extract(src, "tagUserMsg"), ctx);
const E = (code)=>vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c? pass++: (fail++, console.log("FAIL:", n));};
const hist = (arr)=> E(`mapHistory(${JSON.stringify(arr)})`);

// 普通玩家消息原样
t("player passthrough",
hist([{role:"user", content:"你好"}])[0].content === "你好");
// 旁白标
t("narr prefix",
hist([{role:"user", mtype:"narr", content:"\u591c\u6df1\u4e86"}])[0].content === "\u3010\u65c1\u767d\u3011\u591c\u6df1\u4e86");
// NPC 代发言标
t("npc prefix",
hist([{role:"user", mtype:"npc", speaker:"\u6797\u9edb\u7389", content:"\u5b9d\u7389\u5462\uff1f"}])[0].content === "\u3010\u6797\u9edb\u7389\u3011\u5b9d\u7389\u5462\uff1f");
// npc 无 speaker 不崩
t("npc no speaker safe",
hist([{role:"user", mtype:"npc", content:"hi"}])[0].content === "hi");
// 群聊 assistant 既有行为保留
t("assistant speaker kept",
hist([{role:"assistant", speaker:"贾宝玉", content:"来了"}])[0].content === "贾宝玉：来了");
// 混合序列顺序不变
const mixed = hist([
{role:"user", content:"a"},
{role:"user", mtype:"narr", content:"b"},
{role:"assistant", content:"c"},
]);
t("mixed order", mixed.length === 3 && mixed[1].content === "\u3010\u65c1\u767d\u3011b" && mixed[2].role === "assistant");

// tagUserMsg
t("tag default player", E(`tagUserMsg({}, {})`).mtype === "player");
t("tag narr", E(`tagUserMsg({}, {userMtype:"narr"})`).mtype === "narr");
t("tag npc+speaker",
(()=>{ const m = E(`tagUserMsg({}, {userMtype:"npc", userSpeaker:"薛宝钗"})`); return m.mtype==="npc" && m.speaker==="薛宝钗";})());
t("tag null opts", E(`tagUserMsg({}, null)`).mtype === "player");

console.log(`\nmsgtype: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
