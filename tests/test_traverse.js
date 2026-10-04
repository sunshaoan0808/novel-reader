const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// rp/traverse.js: 会话/世界状态/锚点/prompt/开场/身份向导
const ctx = {console, TextDecoder};
const ls = (function(){ const m={}; return {
getItem:k=>m[k]??null, setItem:(k,v)=>{m[k]=String(v);}, removeItem:k=>{delete m[k];},
key:i=>Object.keys(m)[i]||null, get length(){return Object.keys(m).length;}};})();
ctx.localStorage = ls;
ctx.window = {__DATA__: {runs:{r1:{run_id:"r1", novel:"红楼梦", worldbook:[
{title:"常驻", trigger_keywords:[], rules:"大观园规矩", priority:60, constant:true},
]}}, rp_cards:{r1:[{name:"林黛玉", fields:{core_identity:"林如海之女", core_traits:"敏感"}},
{name:"贾宝玉", fields:{core_identity:"贾府公子", core_traits:"顽劣"}}]}}};
ctx.__DATA__ = ctx.window.__DATA__;
ctx.RP = {findCard:(runId, name)=>({name, fields:{core_identity:"测试人设", speech_style:"直率"}})};
ctx.RP_GROUP = {memberBrief:(c)=>c.name + "：" + ((c.fields||{}).core_identity||"")};
ctx.RP_CARDIMPORT = {findById:(id)=>id==="c1"? {id:"c1", name:"浪人",
fields:{core_identity:"前特工", core_traits:"冷酷"}, scenario:"夜之城",
worldbook:[{title:"夜之城", trigger_keywords:["夜之城"], content:"不夜城", priority:55}]}: null};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/prompt.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(WWW+"/rp/traverse.js", "utf8"), ctx);
const T = vm.runInContext("RP_TRAVERSE", ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c? pass++: (fail++, console.log("FAIL:", n));};

// --- 会话 ---
const s1 = T.newSession({mode:"soul", worldKind:"book", worldId:"r1",
worldName:"《红楼梦》", charName:"林黛玉", anchorTitle:"黛玉进贾府", oocRemind:true});
t("newSession字段", s1.mode === "soul" && s1.charName === "林黛玉" && s1.id);
t("get", T.get(s1.id).anchorTitle === "黛玉进贾府");
t("recent含", T.recent().some(x=>x.id === s1.id));
t("oocRemind默认开", T.newSession({mode:"body", worldKind:"book", worldId:"r1"}).oocRemind === true);
T.del(s1.id);
t("del", T.get(s1.id) === null &&!T.recent().some(x=>x.id === s1.id));

// --- 世界状态 ---
const st0 = T.defaultState();
t("defaultState", st0.items.length === 0 && Object.keys(st0.favor).length === 0);
const p1 = T.parseWsBlock("正文\n<ws>{\"date\":\"某日\",\"loc\":\"潇湘馆\",\"favor\":{\"贾宝玉\":5},\"addItems\":[\"帕子\"]}</ws>");
t("parse抽取", p1.patch && p1.patch.loc === "潇湘馆");
t("parse去块", p1.clean === "正文");
const st1 = T.mergeState(T.defaultState(), p1.patch);
t("merge日期地点", st1.date === "某日" && st1.loc === "潇湘馆");
t("merge好感", st1.favor["贾宝玉"] === 5);
t("merge物品", st1.items.join() === "帕子");
const p2 = T.parseWsBlock("第一块<ws>{\"loc\":\"A\"}</ws>第二块<ws>{\"loc\":\"B\"}</ws>");
t("多块取最后", p2.patch.loc === "B" && p2.clean.indexOf("<ws>") < 0);
t("无块patch空", T.parseWsBlock("纯正文").patch === null);
t("坏JSON不崩", T.parseWsBlock("x<ws>not json</ws>").patch === null);
const st2 = T.mergeState(st1, {favor:{"贾宝玉":8}, removeItems:["帕子"], addItems:["帕子","扇子"], flags:{met:true}});
t("merge覆盖好感去重物品", st2.favor["贾宝玉"] === 8 && st2.items.join() === "扇子" && st2.flags.met === true);
t("stateLine", T.stateLine({date:"某日", loc:"潇湘馆"}).indexOf("潇湘馆") >= 0);
T.saveState("tx", st2);
t("getState持久", T.getState("tx").favor["贾宝玉"] === 8);

// --- 锚点 ---
const outline = "\n读者可自行编辑。\n· 黛玉进贾府：初见宝玉，宝玉摔玉；众人怜爱\n· 潇湘馆日常：葬花吟；与宝钗夜话\n· 焚稿断痴情：病重焚稿";
const anchors = T.anchorsFor(outline);
t("锚点含从头开始", anchors[0].id === "start");
t("锚点解析3个", anchors.length === 4);
t("锚点标题", anchors[1].title === "黛玉进贾府");
t("空大纲只有从头", T.anchorsFor("").length === 1);

// --- 世界卡 ---
const bible = T.buildWorldBible("book", "r1");
t("book世界名", bible.name === "《红楼梦》");
t("book常驻lore", bible.loreEntries.length === 1);
const cbible = T.buildWorldBible("card", "c1");
t("card世界bg含scenario", cbible.bg.indexOf("夜之城") >= 0);
t("card世界lore", cbible.loreEntries.length === 1);
t("worldDisplayName未知", T.worldDisplayName("book", "nope") === "未知世界");

// --- prompt ---
const sess = T.newSession({mode:"soul", worldKind:"book", worldId:"r1",
worldName:"《红楼梦》", charName:"林黛玉", anchorTitle:"黛玉进贾府", oocRemind:true});
const b = T.buildMessages(sess, {history:[{role:"user", content:"宝玉来了"}], memory:"记得葬花",
worldbook:[]}, {maxContext:8192});
const sys = b.messages[0].content, post = b.messages[b.messages.length-1].content;
t("含世界", sys.indexOf("《红楼梦》") >= 0);
t("含身份", sys.indexOf("你是林黛玉") >= 0);
t("含在场人物", sys.indexOf("贾宝玉") >= 0);
t("魂穿不含玩家角色", sys.indexOf("「在场人物」") < 0 || sys.split("「在场人物」")[1].indexOf("林黛玉：") < 0);
t("含记忆", sys.indexOf("记得葬花") >= 0);
t("post玩家行动铁律", post.indexOf("玩家行动铁律") >= 0 && post.indexOf("身体动作") >= 0 && post.indexOf("心理活动") >= 0);
t("post有ws指令", post.indexOf("<ws>") >= 0);
t("post有OOC提醒", post.indexOf("「OOC提醒」") >= 0);
t("历史保留", b.messages.some(m=>m.role === "user" && m.content === "宝玉来了"));
t("stats", b.stats.histKept === 1 && b.stats.preset === "穿越");
const sess2 = T.newSession({mode:"soul", worldKind:"book", worldId:"r1",
worldName:"《红楼梦》", charName:"林黛玉", anchorTitle:"x", oocRemind:false});
const post2 = T.postInstructions(sess2);
t("ooc关闭无提醒指令", post2.indexOf("「OOC提醒」") < 0);
// 肉身
const idt = T.saveIdentity({name:"沈书生", origin:"落魄书生", traits:"迂腐热心", situation:"刚进贾府"});
const bsess = T.newSession({mode:"body", worldKind:"book", worldId:"r1",
worldName:"《红楼梦》", identityId:idt.id, anchorTitle:"初入", oocRemind:true});
const ib = T.identityBlock(bsess);
t("肉身身份块", ib.indexOf("沈书生") >= 0 && ib.indexOf("落魄书生") >= 0);
t("identityOneLiner", T.identityOneLiner(bsess).indexOf("沈书生") >= 0);
// 卡片世界 prompt
const csess = T.newSession({mode:"body", worldKind:"card", worldId:"c1",
worldName:"《浪人》的世界", identityId:idt.id, anchorTitle:"初入"});
const cb = T.buildMessages(csess, {history:[], memory:"", worldbook:[]}, {});
t("卡片世界prompt", cb.messages[0].content.indexOf("夜之城") >= 0);
// 世界书去重: 调用方把 run.worldbook 又传一遍也不得重复注入
const dupWb = [{title:"常驻", trigger_keywords:[], rules:"大观园规矩", priority:60, constant:true}];
const db = T.buildMessages(sess, {history:[], memory:"", worldbook:dupWb}, {maxContext:8192});
const dsys = db.messages[0].content;
t("世界书不重复", dsys.indexOf("大观园规矩") >= 0 &&
dsys.indexOf("大观园规矩") === dsys.lastIndexOf("大观园规矩"));

// --- 开场回退 ---
const off = T.offlineOpening(sess);
t("offline开场", off.indexOf("林黛玉") >= 0 && off.indexOf("《红楼梦》") >= 0);

// --- AI 身份向导 ---
(async()=>{
const fake = async ()=>`{"name":"沈墨","gender":"男","age":"十八","origin":"落魄书生","traits":"迂腐","talent":"作诗","situation":"投亲贾府"}`;
const g = await T.genIdentity("当书生", "《红楼梦》", {base:"b", key:"k", model:"m"}, fake);
t("genIdentity解析", g.name === "沈墨" && g.situation === "投亲贾府");
let threw = false;
try{ await T.genIdentity("x", "y", {base:"b",key:"k",model:"m"}, async()=>"胡言乱语");}
catch(e){ threw = true;}
t("genIdentity坏JSON抛错", threw);
const op = await T.genOpening(sess, {base:"b", key:"k", model:"m"}, async()=>"开场正文\n<ws>{\"loc\":\"潇湘馆\"}</ws>");
t("genOpening用AI", op.indexOf("开场正文") >= 0);
console.log(`traverse: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
})();
