// 借鉴清单 Tier2 (S) 项 5/6/9/10/11/12/13/14/15/16/17/18/19/20 的测试
// 纯 JS 逻辑走 vm + localStorage shim; app.js/index.html/style.css 走静态字符串断言
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const store = {};
const localStorage = {
getItem: (k)=> (k in store ? store[k] : null),
setItem: (k, v)=>{ store[k] = String(v); },
removeItem: (k)=>{ delete store[k]; },
};
const ctx = {console, localStorage};
vm.createContext(ctx);
["rp/memory.js", "rp/prompt.js", "rp/persona.js", "rp/cardwriter.js", "rp/modeltags.js"]
.forEach(f=>vm.runInContext(fs.readFileSync(WWW+"/"+f, "utf8"), ctx));
const RP_MEM = vm.runInContext("RP_MEM", ctx);
const RP_PROMPT = vm.runInContext("RP_PROMPT", ctx);
const RP_PERSONA = vm.runInContext("RP_PERSONA", ctx);
const RP_WRITER = vm.runInContext("RP_WRITER", ctx);
const RP_MODELTAGS = vm.runInContext("RP_MODELTAGS", ctx);
const E = (code)=>vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const appSrc = fs.readFileSync(WWW+"/app.js", "utf8");
const htmlSrc = fs.readFileSync(WWW+"/index.html", "utf8");
const cssSrc = fs.readFileSync(WWW+"/style.css", "utf8");

/* ---------- #5 聊天消息 Pin 上限 5 条 + 教育文案 ---------- */
RP_MEM.save("r5", "n5", {short: [1,2,3,4,5].map(i=>({id:i, fact:"f"+i, pin:true}))});
t("pin: 5 pinned -> count 5", RP_MEM.chatPinCount("r5","n5") === 5);
t("pin: 5 pinned -> cannot pin more", RP_MEM.canPinChatMsg("r5","n5") === false);
t("pin: limit msg is C.AI original", RP_MEM.msgPinLimitMsg() === "Pin up to 5 messages");
t("pin: edu text names the char", RP_MEM.pinEduText("黛玉").indexOf("黛玉") >= 0
&& RP_MEM.pinEduText("黛玉").indexOf("长按") >= 0
&& RP_MEM.pinEduText("黛玉").indexOf("永远记住") >= 0);
t("pin: edu seen/mark roundtrip", !RP_MEM.pinEduSeen()
&& (RP_MEM.pinEduMark(), RP_MEM.pinEduSeen()));
t("pin: app wires limit + edu", appSrc.indexOf("canPinChatMsg") >= 0
&& appSrc.indexOf("pinEduSeen") >= 0 && appSrc.indexOf("pinedu") >= 0);

/* ---------- #6 记忆褪色说明 ---------- */
t("fade: ctxbar warns over 90%", appSrc.indexOf("ctxwarn") >= 0
&& appSrc.indexOf("旧消息会逐渐从记忆中褪色") >= 0
&& appSrc.indexOf("置顶 / 存入事件簿的记忆会一直保留") >= 0);
t("fade: settings FAQ card", appSrc.indexOf("记忆说明") >= 0
&& appSrc.indexOf("最大对话容量的限制") >= 0);

/* ---------- #9 开新聊天 / 存档带走记忆 ---------- */
t("carry: drawer item + fn", appSrc.indexOf("newChatSameRole") >= 0
&& appSrc.indexOf("开新聊天") >= 0);
t("carry: checkbox modal + label", appSrc.indexOf("confirmCheck") >= 0
&& appSrc.indexOf("带走 Pin 与记忆") >= 0);
t("carry: newSaveSlot asks", appSrc.indexOf("cfcheck") >= 0
&& cssSrc.indexOf(".cfcheck") >= 0);

/* ---------- #10 永久记忆 ---------- */
RP_MEM.save("r10", "n10", {event3: [{id:1, topic:"初见", state:"很好", updatedAt:1}]});
t("perm: set roundtrip", RP_MEM.setEventPerm("r10","n10",1,true) === true
&& RP_MEM.get("r10","n10").event3[0].perm === true
&& RP_MEM.eventPermCount("r10","n10") === 1);
t("perm: limit msg is Talkie original",
RP_MEM.permLimitMsg() === "The selected events have reached the upper limit");
(function(){ // 塞满 20 个永久，再设第 21 个应返回 "limit"
const evs = [];
for(let i=1;i<=21;i++) evs.push({id:i, topic:"t"+i, state:"s", updatedAt:i, perm:i<=20});
RP_MEM.save("r10b","n10",{event3:evs});
t("perm: over cap returns limit", RP_MEM.setEventPerm("r10b","n10",21,true) === "limit");
const pruned = RP_MEM.pruneEvents(evs, 20);
t("perm: prune keeps all perm over cap",
pruned.length === 20 && pruned.filter(e=>e.perm).length === 20);
})();
t("perm: album toggle wires limit toast", appSrc.indexOf("toggleEventPerm") >= 0
&& appSrc.indexOf("设为永久") >= 0);

/* ---------- #11 本聊摘要 ---------- */
t("chatsum: save/get roundtrip", (function(){
const r = RP_MEM.saveChatSummary("r11","n11","我们是青梅竹马");
return r.saved === "我们是青梅竹马" && RP_MEM.getChatSummary("r11","n11") === "我们是青梅竹马";
})());
t("chatsum: truncates at 1000", (function(){
const big = new Array(1202).join("x");
const r = RP_MEM.saveChatSummary("r11","n11",big);
return r.truncated === true && r.saved.length === 1000;
})());
t("chatsum: renders before iron law", (function(){
RP_MEM.saveIronLaw("r11","n11",null,"绝不提穿越");
RP_MEM.saveChatSummary("r11","n11","摘要内容");
const txt = RP_MEM.renderBudgeted("r11","n11",30000).text;
const si = txt.indexOf("本聊摘要"), ii = txt.indexOf("铁律记忆");
return si >= 0 && ii >= 0 && si < ii;
})());
t("chatsum: UI box in memory tab", appSrc.indexOf("chatsum_box") >= 0
&& appSrc.indexOf("saveChatSumUI") >= 0);

/* ---------- #12 新聊天记忆窗口 ---------- */
t("memwin: default 60 without getRpCfg", RP_MEM.memWindowN() === 60);
t("memwin: trims similar-first, keeps important", (function(){
E("function getRpCfg(){ return {memWindowN: 8, leanmem: false}; }");
RP_MEM.save("r12","n12",{mood:{state:"开心",filter:""},
short:[{id:1,fact:"p1",pin:true},{id:2,fact:"p2",pin:true},
{id:3,fact:"a"},{id:4,fact:"b"},{id:5,fact:"c"},{id:6,fact:"d"}],
long:"很久以前的印象"});
RP_MEM.saveIronLaw("r12","n12",null,"铁律一");
const res = RP_MEM.renderBudgeted("r12","n12",30000);
E("getRpCfg = undefined;");
const ok = res.pools.windowN === 8
&& res.pools.windowDropped > 0
&& res.pools.similar.windowDropped === 1   // 长远印象先被裁
&& res.text.indexOf("长远印象") < 0          // 整段裁掉
&& res.text.indexOf("铁律记忆") >= 0;        // important 永不整段丢
return ok;
})());
t("memwin: settings field wired", appSrc.indexOf("r_memwin") >= 0
&& appSrc.indexOf("memWindowN") >= 0);

/* ---------- #13 删消息连带记忆 ---------- */
t("delask: msg in summary detected", (function(){
RP_MEM.save("r13","n13",{up_to:1, up_to_msg_id:"m2"});
const h = [{mid:"m1",role:"user",content:"a"},{mid:"m2",role:"assistant",content:"b"},
{mid:"m3",role:"user",content:"c"}];
const a = RP_MEM.msgInMemory("r13","n13",h[0],h);
const b = RP_MEM.msgInMemory("r13","n13",h[2],h);
return a.inMemory === true && a.inSummary === true && b.inMemory === false;
})());
t("delask: ask text mentions memory", RP_MEM.delAskText().indexOf("记忆") >= 0
&& appSrc.indexOf("delMsgAsk") >= 0
&& appSrc.indexOf("删除消息和记忆") >= 0
&& appSrc.indexOf("只删消息") >= 0);

/* ---------- #14 事件分型标签 ---------- */
t("kind: normKind", RP_MEM.normKind("心情") === "心情"
&& RP_MEM.normKind("初见") === "初见"
&& RP_MEM.normKind("junk") === ""
&& RP_MEM.normKind("") === "");
t("kind: kindLabel defaults to 事件", RP_MEM.kindLabel({}) === "事件"
&& RP_MEM.kindLabel({kind:"关系"}) === "关系");
t("kind: parseState3 stores kind", (function(){
const st = {up_to:0};
const raw = JSON.stringify({mood:{state:"好",filter:""},pin:[],short:[],
profile:[],event:[{topic:"买奶茶",t_anchor:"今晚",state:"很开心",kind:"心情"}],
record:[],long:""});
const next = RP_MEM.parseState3(raw, st, null);
return next && next.event3 && next.event3[0] && next.event3[0].kind === "心情";
})());
t("kind: album chips + badge", appSrc.indexOf("kindchip") >= 0
&& appSrc.indexOf("albumKindFilter") >= 0
&& cssSrc.indexOf(".kindchip") >= 0);

/* ---------- #15 简洁回复 ---------- */
t("concise: instruction exported", RP_PROMPT.CONCISE_INSTR.indexOf("简洁回复") >= 0
&& RP_PROMPT.CONCISE_INSTR.indexOf("简短精炼") >= 0);
t("concise: buildMessages injects when ctx.concise", (function(){
const card = {name:"黛玉", fields:{}};
const b = RP_PROMPT.buildMessages(card, {history:[], persona:"", concise:true}, {maxContext:8192});
return b.messages[0].content.indexOf("简洁回复") >= 0 && b.stats.concise === true;
})());
t("concise: off by default", (function(){
const card = {name:"黛玉", fields:{}};
const b = RP_PROMPT.buildMessages(card, {history:[], persona:""}, {maxContext:8192});
return b.messages[0].content.indexOf("简洁回复") < 0 && !b.stats.concise;
})());
t("concise: UI switch + maxTokens clamp", appSrc.indexOf("concise_sw") >= 0
&& appSrc.indexOf("saveConciseUI") >= 0
&& appSrc.indexOf("Math.min(rcfg.respTokens, 300)") >= 0);

/* ---------- #16 清空后果说明 ---------- */
t("wipe: clearChat warns", appSrc.indexOf("会清空记忆和关系，从头来过") >= 0);

/* ---------- #17 角色卡模板 ---------- */
t("templates: 4 shipped", RP_WRITER.CARD_TEMPLATES.length === 4
&& ["tsundere","gentle","villain","yandere"].every(id=>
RP_WRITER.CARD_TEMPLATES.some(x=>x.id===id)));
t("templates: fields keys valid", RP_WRITER.CARD_TEMPLATES.every(x=>
x.fields && Object.keys(x.fields).every(k=>RP_WRITER.CARD_FIELDS.indexOf(k) >= 0)));
t("templates: fill UI wired", appSrc.indexOf("fillCardTemplate") >= 0
&& appSrc.indexOf("CARD_TEMPLATES") >= 0);

/* ---------- #18 模型能力标签 ---------- */
t("modeltags: table prefix fallback", (function(){
const tags = RP_MODELTAGS.tableFor("gpt-4o-2024-05-13");
return tags.indexOf("推理") >= 0 && tags.indexOf("视觉") >= 0;
})());
t("modeltags: save/get roundtrip + custom tag", (function(){
RP_MODELTAGS.save("my-model-x", ["联网搜索"]);
const got = RP_MODELTAGS.get("my-model-x");
const all = RP_MODELTAGS.allTagsFor("my-model-x");
return got.indexOf("联网搜索") >= 0 && all.indexOf("推理") >= 0
&& all.indexOf("联网搜索") >= 0;
})());
t("modeltags: script + settings UI wired", htmlSrc.indexOf("rp/modeltags.js") >= 0
&& appSrc.indexOf("renderModelTags") >= 0
&& appSrc.indexOf("modelTagAdd") >= 0
&& cssSrc.indexOf(".tagchip") >= 0);

/* ---------- #19 记忆快照状态 ---------- */
t("memstatus: set/get roundtrip", (function(){
RP_MEM.setMemStatus("r19","n19","fail");
return RP_MEM.getMemStatus("r19","n19").state === "fail";
})());
t("memstatus: line texts", (function(){
const f = RP_MEM.memStatusLine("r19","n19");
RP_MEM.setMemStatus("r19","n19","done");
const d = RP_MEM.memStatusLine("r19","n19");
RP_MEM.setMemStatus("r19","n19","running");
const r = RP_MEM.memStatusLine("r19","n19");
return f.text === "记忆生成失败，点我重试"
&& /^记忆已更新 \d\d:\d\d$/.test(d.text)
&& r.text === "记忆生成中…";
})());
t("memstatus: album line + retry wired", appSrc.indexOf("memstatus") >= 0
&& appSrc.indexOf("retryMemAnalyze") >= 0
&& cssSrc.indexOf(".memstatus") >= 0);

/* ---------- #20 TA 怎么称呼我 ---------- */
t("called: renderText injects", RP_PERSONA.renderText({name:"阿绫", called:"主人"}).indexOf("你称呼用户为「主人」") >= 0);
t("called: saveGlobal persists", (function(){
RP_PERSONA.saveGlobal({name:"阿绫", called:"小可爱"});
return RP_PERSONA.getGlobal().called === "小可爱";
})());
t("called: editor field wired", appSrc.indexOf("p_called") >= 0
&& appSrc.indexOf("TA 怎么称呼我") >= 0);

console.log(`\nborrow_c: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
