const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 借鉴清单第 2/7/8 项: VibeCreate 一句话建卡 / 伏笔面板 / 记忆转小说(分章改写)
const store = {};
const localStorage = {
getItem: k => (k in store ? store[k] : null),
setItem: (k, v) => { store[k] = String(v); },
removeItem: k => { delete store[k]; },
};
// 伏笔 fixture: 精简 schema {t:埋设, te:回收, ch:回目, c:人物, s:文本, k:类型, sub}
const CAL = [
{t:1, te:214, ch:120, c:["贾宝玉","林黛玉"], s:"绛珠还泪之约, 是全书情缘总根", k:"foreshadowing", sub:"贾宝玉"},
{t:5, te:null, ch:5, c:["王熙凤"], s:"凤姐初见黛玉时的伏笔, 待回收", k:"foreshadowing", sub:"王熙凤"},
{t:9, te:"", ch:9, c:["贾母"], s:"贾母某句谶语", k:"foreshadowing", sub:"贾母"},
{t:1, te:1, ch:1, c:["贾宝玉"], s:"顽石入世", k:"event", sub:"贾宝玉"},
{t:2, te:2, ch:1, c:["林黛玉"], s:"黛玉进贾府", k:"event", sub:"林黛玉"},
];
const ctx = {localStorage, console, __CAL__: CAL};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/foreshadow.js", "utf8"), ctx, {filename: "foreshadow.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/vibecreate.js", "utf8"), ctx, {filename: "vibecreate.js"});
vm.runInContext(fs.readFileSync(WWW + "/rp/novel.js", "utf8"), ctx, {filename: "novel.js"});
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

/* ================= 第 2 项: VibeCreate ================= */
const vp = vm.runInContext("RP_VIBE.vibePrompt('落魄书生, 嘴硬心软', 0)", ctx);
t("vibePrompt含描述", vp.indexOf("落魄书生") >= 0);
t("vibePrompt只输出JSON", /只输出一个 JSON/.test(vp));
t("vibePrompt五键齐全", ["name","personality","greeting","exampleDialogue","background"].every(k=>vp.indexOf(k)>=0));
const vp1 = vm.runInContext("RP_VIBE.vibePrompt('x', 1)", ctx);
t("换一批prompt不同", vp1 !== vp && vp1.indexOf("重新构思") >= 0);

const vibeRaw = '```json\n{"name":"沈清辞","personality":"嘴硬心软的落魄书生","greeting":"在下沈清辞","exampleDialogue":"<START>\\n{{user}}: 你好\\n{{char}}: 姑娘好","background":"家道中落, 寄居远亲"}```';
const vc = vm.runInContext("RP_VIBE.parseVibeJson(" + JSON.stringify(vibeRaw) + ")", ctx);
t("vibe解析名字", vc.name === "沈清辞");
t("vibe解析性格", vc.personality.indexOf("嘴硬心软") >= 0);
t("vibe解析开场白", vc.greeting === "在下沈清辞");
t("vibe解析示例对话", vc.exampleDialogue.indexOf("姑娘好") >= 0);
t("vibe解析背景", vc.background.indexOf("家道中落") >= 0);
const noName = vm.runInContext("(function(){ try{ RP_VIBE.parseVibeJson('{\"personality\":\"x\"}'); return 'no-throw'; }catch(e){ return e.message; } })()", ctx);
t("缺名字抛错(失败回退)", noName === "vibe-parse-failed");
const garbage = vm.runInContext("(function(){ try{ RP_VIBE.parseVibeJson('这不是json'); return 'no-throw'; }catch(e){ return e.message; } })()", ctx);
t("垃圾输入抛错(失败回退)", garbage === "vibe-parse-failed");
const fields = vm.runInContext("RP_VIBE.toCardFields(" + JSON.stringify(vc) + ")", ctx);
t("映射进写卡字段", fields.core_identity === vc.personality && fields.life_timeline === vc.background);

(async ()=>{
// generate 一次调用
vm.runInContext("var __vCalls=0; var __vStub=async function(cfg,ms,temp){ __vCalls++; return " + JSON.stringify(vibeRaw) + "; };", ctx);
const g1 = await vm.runInContext("RP_VIBE.generate('落魄书生',{base:'b',key:'k',model:'m'}, __vStub, 0)", ctx);
t("generate一次调用", vm.runInContext("__vCalls", ctx) === 1);
t("generate返回卡", g1.name === "沈清辞");
// 换一批: 第二次调用 attempt=1, prompt 不同
vm.runInContext("var __vStub2=async function(cfg,ms,temp){ return " + JSON.stringify(vibeRaw).replace("沈清辞", "顾长安") + "; };", ctx);
const g2 = await vm.runInContext("RP_VIBE.generate('落魄书生',{base:'b',key:'k',model:'m'}, __vStub2, 1)", ctx);
t("换一批换卡", g2.name === "顾长安");
// 网络失败 -> 抛错由UI转toast, 不崩
vm.runInContext("var __vFail=async function(){ throw new Error('network down'); };", ctx);
const err = await vm.runInContext("(async function(){ try{ await RP_VIBE.generate('x',{base:'b',key:'k',model:'m'}, __vFail, 0); return 'no-throw'; }catch(e){ return e.message; } })()", ctx);
t("网络失败抛错不崩", err === "network down");
// 解析失败 -> 抛错由UI转toast
vm.runInContext("var __vBad=async function(){ return 'not json at all'; };", ctx);
const perr = await vm.runInContext("(async function(){ try{ await RP_VIBE.generate('x',{base:'b',key:'k',model:'m'}, __vBad, 0); return 'no-throw'; }catch(e){ return e.message; } })()", ctx);
t("解析失败抛错不崩", perr === "vibe-parse-failed");

/* ================= 第 7 项: 伏笔面板 ================= */
const grp = vm.runInContext("RP_FORE.group()", ctx);
t("伏笔总数3", grp.resolved.length + grp.unresolved.length === 3);
t("已回收1(te有值)", grp.resolved.length === 1);
t("未回收2(te空)", grp.unresolved.length === 2);
t("空字符串te算未回收", vm.runInContext("RP_FORE.isResolved({te:''})", ctx) === false);
t("null te算未回收", vm.runInContext("RP_FORE.isResolved({te:null})", ctx) === false);
t("有te算已回收", vm.runInContext("RP_FORE.isResolved({te:214})", ctx) === true);
const st1 = vm.runInContext("RP_FORE.statusText({te:214, ch:120})", ctx);
t("已回收状态文案", st1.indexOf("已回收") >= 0 && st1.indexOf("120") >= 0);
const st2 = vm.runInContext("RP_FORE.statusText({te:null, ch:5})", ctx);
t("未回收状态文案", st2 === "未回收");
t("人物文案", vm.runInContext("RP_FORE.peopleText({c:['贾宝玉','林黛玉']})", ctx) === "贾宝玉、林黛玉");
const ch1 = vm.runInContext("RP_FORE.chapterOf(1)", ctx);
t("回目映射存在", ch1.length === 2);
t("回目内按t排序", ch1[0].e.t <= ch1[1].e.t);
const chX = vm.runInContext("RP_FORE.chapterOf(999)", ctx);
t("空回目返回空数组", Array.isArray(chX) && chX.length === 0);
t("伏笔文本可读", grp.resolved[0].e.s.indexOf("绛珠") >= 0);

/* ================= 第 8 项: 记忆转小说 ================= */
const pp = vm.runInContext("RP_NOVEL.planPrompt('聊天记录...', '林黛玉')", ctx);
t("planPrompt含角色名", pp.indexOf("林黛玉") >= 0);
t("planPrompt只输出JSON", /只输出一个 JSON/.test(pp));
const planRaw = '```json\n{"chapters":[{"title":"潇湘初见","overview":"黛玉进贾府, 宝玉初见"},{"title":"共读西厢","overview":"二人共读, 情愫暗生"}]}```';
const chapters = vm.runInContext("RP_NOVEL.parsePlan(" + JSON.stringify(planRaw) + ")", ctx);
t("章节数2", chapters.length === 2);
t("章节标题", chapters[0].title === "潇湘初见");
t("章节梗概", chapters[1].overview.indexOf("情愫") >= 0);
t("章节初始状态概要已出", chapters[0].status === "planned");
t("章节id稳定", chapters[0].id === "ch1" && chapters[1].id === "ch2");
const planBad = vm.runInContext("(function(){ try{ RP_NOVEL.parsePlan('瞎写'); return 'no-throw'; }catch(e){ return e.message; } })()", ctx);
t("规划解析失败抛错", planBad === "novel-plan-failed");
// planChapters 一次调用
vm.runInContext("var __nCalls=0; var __nStub=async function(cfg,ms,temp){ __nCalls++; return " + JSON.stringify(planRaw) + "; };", ctx);
const pc = await vm.runInContext("RP_NOVEL.planChapters('材料','林黛玉',{base:'b',key:'k',model:'m'}, __nStub)", ctx);
t("planChapters一次调用", vm.runInContext("__nCalls", ctx) === 1 && pc.length === 2);
// 改写 prompt 含章节名+概要+指令 (对标猫箱 chapter_rewrite)
const cp = vm.runInContext("RP_NOVEL.chapterPrompt({title:'潇湘初见', overview:'黛玉进府'}, '写得更悬疑')", ctx);
t("改写prompt含章节名", cp.indexOf("潇湘初见") >= 0);
t("改写prompt含概要", cp.indexOf("黛玉进府") >= 0);
t("改写prompt含用户指令", cp.indexOf("写得更悬疑") >= 0);
// rewriteChapter: 生成正文 -> done
const novel = vm.runInContext("RP_NOVEL.newNovelDoc('林黛玉'," + JSON.stringify(chapters) + ")", ctx);
vm.runInContext("var __wStub=async function(cfg,ms,temp){ return '正文第一段。\\n\\n正文第二段。'; };", ctx);
await vm.runInContext("RP_NOVEL.rewriteChapter(" + JSON.stringify(novel).replace(/\//g, "\\/") + ", 0, '', {base:'b',key:'k',model:'m'}, __wStub).then(function(ch){ globalThis.__rch = ch; })", ctx)
  .catch(()=>{});
const rch = vm.runInContext("globalThis.__rch", ctx);
t("改写后状态done", rch && rch.status === "done");
t("改写后有正文", rch && rch.content.indexOf("正文第一段") >= 0);
// 再次改写 (章节正文可再次改写)
vm.runInContext("var __wStub2=async function(cfg,ms,temp){ return '改写后的正文。'; };", ctx);
const rch2 = await vm.runInContext("(async function(){ var n = " + JSON.stringify({chapters:[{id:'ch1',index:0,title:'t',overview:'o',content:'旧正文',status:'done'}]}) + "; return await RP_NOVEL.rewriteChapter(n, 0, '更悬疑', {base:'b',key:'k',model:'m'}, __wStub2); })()", ctx);
t("再次改写覆盖正文", rch2.content === "改写后的正文。" && rch2.status === "done");
// 改写失败抛错 (UI转toast, 不崩)
vm.runInContext("var __wFail=async function(){ throw new Error('llm down'); };", ctx);
const werr = await vm.runInContext("(async function(){ try{ await RP_NOVEL.rewriteChapter({chapters:[{id:'ch1',index:0,title:'t',overview:'o',content:'',status:'planned'}]}, 0, '', {base:'b',key:'k',model:'m'}, __wFail); return 'no-throw'; }catch(e){ return e.message; } })()", ctx);
t("改写失败抛错不崩", werr === "llm down");
// 存储 nd_novel_<chatId>
vm.runInContext("RP_NOVEL.saveNovel('nd_chat_r1_林黛玉'," + JSON.stringify(novel) + ")", ctx);
t("存储键格式", vm.runInContext("RP_NOVEL.novelKey('nd_chat_r1_林黛玉')", ctx) === "nd_novel_nd_chat_r1_林黛玉");
const loaded = vm.runInContext("RP_NOVEL.getNovel('nd_chat_r1_林黛玉')", ctx);
t("存储往返", loaded && loaded.charName === "林黛玉" && loaded.chapters.length === 2);
t("无小说返回null", vm.runInContext("RP_NOVEL.getNovel('nd_chat_nonexist_x')", ctx) === null);
vm.runInContext("RP_NOVEL.delNovel('nd_chat_r1_林黛玉')", ctx);
t("删除后null", vm.runInContext("RP_NOVEL.getNovel('nd_chat_r1_林黛玉')", ctx) === null);
// 导出 TXT
const txt = vm.runInContext("RP_NOVEL.exportTxt({title:'林黛玉的小说', chapters:[{title:'潇湘初见', overview:'黛玉进府', content:'正文内容', status:'done'}]})", ctx);
t("TXT含标题", txt.indexOf("林黛玉的小说") >= 0);
t("TXT含章节号", txt.indexOf("第1章 潇湘初见") >= 0);
t("TXT含梗概", txt.indexOf("黛玉进府") >= 0);
t("TXT含正文", txt.indexOf("正文内容") >= 0);
// buildMaterial 截断
const big = vm.runInContext("RP_NOVEL.buildMaterial('a'.repeat(5000), 'b'.repeat(5000), 'c'.repeat(5000))", ctx);
t("材料截断9000", big.length <= 9000);
const mat = vm.runInContext("RP_NOVEL.buildMaterial('记忆1', '聊天1', '')", ctx);
t("材料含记忆与聊天", mat.indexOf("记忆1") >= 0 && mat.indexOf("聊天1") >= 0);

console.log(`borrow_b: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e=>{ console.log("FATAL:", e); process.exit(1); });
