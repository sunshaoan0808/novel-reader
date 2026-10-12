const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// rp/cardimport.js: PNG chara 提取 + Tavern 归一化 + 本地库
const btoa = (s)=>Buffer.from(s, "binary").toString("base64");
const atob = (s)=>Buffer.from(s, "base64").toString("binary");
const ctx = {console, btoa, atob, TextDecoder};
const ls = (function(){ const m={}; return {
  getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
  key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
ctx.localStorage = ls;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/cardexport.js", "utf8"), ctx); // embedChara 供 roundtrip
vm.runInContext(fs.readFileSync(WWW+"/rp/cardimport.js", "utf8"), ctx);
const X = vm.runInContext("RP_CARDIMPORT", ctx), E = vm.runInContext("RP_CARDEXPORT", ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

/* 最小 PNG: sig + IEND(12B)，embedChara 会把 tEXt 插到 IEND 前 */
function minPng(){
  const sig = [137,80,78,71,13,10,26,10];
  const iend = [0,0,0,0, 73,69,78,68, 0,0,0,0]; // len=0 "IEND" crc=dummy
  return new Uint8Array(sig.concat(iend)).buffer;
}
const tavernJson = JSON.stringify({spec:"chara_card_v2", spec_version:"2.0", data:{
  name:"夜之城浪人", description:"前荒坂特工", personality:"冷酷寡言",
  scenario:"2077 年的夜之城", first_mes:"有活儿就说。",
  mes_example:"<START>\n{{user}}: 你是谁\n{{char}}: 浪人。",
  system_prompt:"说话简短", creator_notes:"test",
  tags:["赛博朋克"], character_book:{entries:[
    {name:"夜之城", keys:["夜之城"], content:"不夜城"}, {name:"空", content:""}]},
}});

// --- PNG roundtrip ---
const buf = E.embedChara(minPng(), E.b64encodeUnicode(tavernJson));
const back = X.extractChara(buf);
t("roundtrip json", JSON.parse(back).data.name === "夜之城浪人");
t("非PNG抛错", (()=>{ try{ X.extractChara(new Uint8Array([1,2,3]).buffer); return false; }catch(e){ return /PNG/.test(e.message); } })());
t("无chara抛错", (()=>{ try{ X.extractChara(minPng()); return false; }catch(e){ return /没有找到角色卡/.test(e.message); } })());

// --- parseCardJson ---
t("v2取data", X.parseCardJson(tavernJson).name === "夜之城浪人");
t("v1扁平", X.parseCardJson(JSON.stringify({name:"甲", description:"乙"})).name === "甲");
t("非法抛错", (()=>{ try{ X.parseCardJson("{}"); return false; }catch(e){ return true; } })());

// --- normalizeTavern ---
const n = X.normalizeTavern(JSON.parse(tavernJson).data);
t("name", n.name === "夜之城浪人");
t("core_identity", n.fields.core_identity === "前荒坂特工");
t("core_traits", n.fields.core_traits === "冷酷寡言");
t("greeting取first_mes", n.greeting === "有活儿就说。");
t("typical_lines不再含first_mes", n.fields.typical_lines.indexOf("有活儿就说。") === -1);
t("typical_lines首句来自mes_example", n.fields.typical_lines[0] === "浪人。");
t("typical_lines解析char行", n.fields.typical_lines.some(l=>l === "浪人。"));
t("scenario", n.scenario === "2077 年的夜之城");
t("sysNote", n.sysNote.indexOf("说话简短") >= 0);
t("worldbook过滤空", n.worldbook.length === 1 && n.worldbook[0].title === "夜之城");
t("novel取tags", n.novel === "赛博朋克");
/* P1-13: 原断言恒真(length>=0)。真断言：名字里的正则元字符必须被字面量转义 */
t("exampleLines防正则注入-字面匹配", JSON.stringify(X.exampleLines("a)b: 你好", "a)b")) === JSON.stringify(["你好"]));
t("exampleLines防正则注入-不误杀", X.exampleLines("axb: 你好", "a)b").length === 0);
t("exampleLines防正则注入-点号字面", JSON.stringify(X.exampleLines("a.b: 嗨", "a.b")) === JSON.stringify(["嗨"]));

// --- 本地库 ---
X.add(n);
t("find", X.find("夜之城浪人").id === n.id);
t("list含1", X.list().length === 1);
X.del(n.id);
t("del后空", X.list().length === 0);
t("findById无", X.findById("nope") === null);

console.log(`cardimport: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
