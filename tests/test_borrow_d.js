const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www")? "assets/www": "www";
// Tier3 21-25: Rewind 回溯 / 群关系+@ / 记忆日记 / 召回通知 / 心跳
function mkEl(){
return {innerHTML: "", textContent: "", value: "", checked: false, tagName: "",
classList: {add(){}, remove(){}, toggle(){}, contains(){ return false;}},
style: {}, dataset: {},
querySelector(){ return null;}, querySelectorAll(){ return [];},
addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
setAttribute(){}, getAttribute(){ return null;}, removeAttribute(){},
closest(){ return null;}, scrollTo(){}, focus(){}, click(){},
getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:0,height:0};}};
}
const els = {};
const created = [];
const idReg = {};
const store = {};
const localStorage = {
getItem: k => (k in store? store[k]: null),
setItem: (k, v) => { store[k] = String(v);},
removeItem: k => { delete store[k];},
key: i => Object.keys(store)[i] || null,
get length(){ return Object.keys(store).length;},
};
const document = {
body: mkEl(),
getElementById: id => {
if(id === "msgsheet" || id === "msgscrim") return idReg[id] || null;
return els[id] || (els[id] = mkEl());
},
querySelector: sel => {
const mm = String(sel).match(/^#([\w-]+)$/);
if(!mm) return null;
return els[mm[1]] || (els[mm[1]] = mkEl());
},
querySelectorAll: () => [],
createElement: tag => {
const e = mkEl(); e.tagName = tag; created.push(e);
let _id = "";
Object.defineProperty(e, "id", {get: ()=>_id, set: v=>{ _id = v; idReg[v] = e;}});
return e;
},
};
const DATA = {
index: [{run_id: "r1", novel: "红楼梦", characters: ["林黛玉"], n_chunks: 1}],
runs: {r1: {run_id: "r1", novel: "红楼梦", worldbook: [], relations: [], profiles: []}},
rp_cards: {r1: [{name: "林黛玉", fields: {}}]},
};
const notifyCalls = [];
const ctx = {localStorage, document, console,
alert(){}, confirm(){ return true;}, prompt(){ return null;},
setTimeout: () => 0, clearTimeout(){}, fetch: () => Promise.reject(new Error("no net")),
scrollTo(){}, devicePixelRatio: 2};
ctx.window = ctx; ctx.globalThis = ctx; ctx.__DATA__ = DATA;
vm.createContext(ctx);
for(const f of ["data.js", "icons.js", "rp/escutil.js", "rp/prompt.js", "rp/persona.js",
"rp/memory.js", "rp/tasks.js", "rp/cardwriter.js", "rp/ooc.js", "rp/chat.js",
"rp/group.js", "rp/traverse.js", "rp/heartbeat.js", "app.js"]){
vm.runInContext(fs.readFileSync(WWW + "/" + f, "utf8"), ctx, {filename: f});
}
vm.runInContext("window.__DATA__=" + JSON.stringify(DATA), ctx);

let pass = 0, fail = 0;
const t = (n, c) => { c? pass++: (fail++, console.log("FAIL:", n));};
const mk = (role, content, extra) => Object.assign({role, content, ts: Date.now()}, extra||{});
const DAY = 86400e3, NOW = Date.now();

/* ================= 21. 长按 Rewind 回溯分支 ================= */
vm.runInContext(`CHAT = {mode:"single", runId:"r1", name:"林黛玉", members:[], narrMode:false, asSpeaker:null}`, ctx);
const HKEY = "nd_chat_r1_林黛玉";
// 双上限：单次最多 20 条
const h30 = []; for(let i=0;i<30;i++) h30.push(mk("user","m"+i));
let r = vm.runInContext("rewindCheck(" + JSON.stringify(h30).replace(/</g,"\\u003c") + ", 5)", ctx);
t("21 回溯超20条被拦", r && r.ok===false && r.code==="count" && r.max===20);
// 双上限：仅支持近 7 天消息
const hold = [mk("user","old",{ts: NOW-8*DAY}), mk("assistant","new")];
r = vm.runInContext("rewindCheck(" + JSON.stringify(hold) + ", 0)", ctx);
t("21 回溯8天前消息被拦", r && r.ok===false && r.code==="age" && r.days===7);
// 正常：10 条回溯到第 0 条
const h10 = []; for(let i=0;i<10;i++) h10.push(mk("user","m"+i));
r = vm.runInContext("rewindCheck(" + JSON.stringify(h10) + ", 0)", ctx);
t("21 正常回溯通过", r && r.ok===true);
// 无 ts 的旧消息：不因时间被拦（向后兼容）
const hnots = [{role:"user",content:"a"},{role:"user",content:"b"}];
r = vm.runInContext("rewindCheck(" + JSON.stringify(hnots) + ", 0)", ctx);
t("21 无ts旧消息不拦", r && r.ok===true);
// 完整流程：回溯到 idx=2，之后 3 条移入新分支
store[HKEY] = JSON.stringify([mk("user","u1"),mk("assistant","a1"),mk("user","u2"),mk("assistant","a2"),mk("assistant","a3")]);
vm.runInContext("rewindMsg(2)", ctx);
const cur = JSON.parse(store[HKEY]);
t("21 回溯后当前只保留到idx", cur.length===3 && cur[2].content==="u2");
const saves = JSON.parse(store["nd_saves_"+HKEY]||"[]");
t("21 新分支存档被创建", saves.length===1 && saves[0].name.indexOf("回溯分支")===0);
t("21 分支存档装的是被移走的尾巴", saves[0].history.length===2 && saves[0].history[0].content==="a2");
t("21 分支存档链向原分支源(parentId null 兼容)", saves[0].parentId==null || typeof saves[0].parentId==="number");
const bsrc = JSON.parse(store["nd_branchsrc"]||"{}");
t("21 分支源指向新分支", bsrc[HKEY]===saves[0].id);
// 消息菜单里有"回溯到这里"
const sheetOf = () => created.find(e => e.className === "msgsheet");
store[HKEY] = JSON.stringify([mk("user","u1"),mk("assistant","a1")]);
vm.runInContext("msgSheet(true, 0)", ctx);
t("21 菜单有回溯项", sheetOf().innerHTML.indexOf("rewindMsg(0)")>=0);
// 图标
t("21 history图标存在", fs.readFileSync(WWW+"/icons.js","utf8").indexOf('"history"')>=0);

/* ================= 22. 群聊角色关系 + @ ================= */
const G = vm.runInContext("RP_GROUP", ctx);
const gkey = "林黛玉_贾宝玉";
vm.runInContext(`RP_GROUP.addRel("r1","${gkey}","林黛玉","贾宝玉","表妹")`, ctx);
vm.runInContext(`RP_GROUP.addRel("r1","${gkey}","薛宝钗","林黛玉","情敌")`, ctx);
t("22 关系存取", G.getRels("r1",gkey).length===2);
t("22 渲染X是Y的句式", G.renderRels("r1",gkey).indexOf("林黛玉是贾宝玉的表妹")>=0);
t("22 空关系渲染为空", G.renderRels("r1"," nobody ")==="");
vm.runInContext(`RP_GROUP.delRel("r1","${gkey}",0)`, ctx);
t("22 删除关系", G.getRels("r1",gkey).length===1 && G.renderRels("r1",gkey).indexOf("表妹")<0);
const pr = G.parseRelLines("林黛玉是贾宝玉的表妹\n这行不对\n薛宝钗是林黛玉的情敌", ["林黛玉","贾宝玉","薛宝钗"]);
t("22 建群文本解析2对1错", pr.ok.length===2 && pr.bad===1);
const pr2 = G.parseRelLines("张三是李四的徒弟", ["林黛玉","贾宝玉"]);
t("22 非成员名字被拒", pr2.ok.length===0 && pr2.bad===1);
// @ 点名：本轮点名该角色先回
const sp = G.planSpeakers("@贾宝玉 你好呀", ["林黛玉","贾宝玉"], {林黛玉:50,贾宝玉:50}, null, {maxSpeakers:3});
t("22 @点名者排第一", sp[0]==="贾宝玉");
const appsrc = fs.readFileSync(WWW+"/app.js","utf8");
t("22 输入区有@按钮", appsrc.indexOf('id="atbtn"')>=0);
t("22 atMention/at菜单函数存在", appsrc.indexOf("window.atMention")>=0 && appsrc.indexOf("window.toggleAtMenu")>=0);
t("22 建群页有关系输入框", appsrc.indexOf('id="grel_in"')>=0);
t("22 抽屉有关系编辑区", appsrc.indexOf('id="grelbox"')>=0 && appsrc.indexOf("renderGRelBox")>=0);
const chatsrc = fs.readFileSync(WWW+"/rp/chat.js","utf8");
t("22 群聊prompt注入", chatsrc.indexOf("角色关系设定") >= 0); /* P1-13: 原断言恒真，现查真实注入点 */

/* ================= 23. Memory Diary 时间线 ================= */
t("23 今天标签", vm.runInContext("diaryDayLabel("+NOW+")", ctx).indexOf("今天")===0);
t("23 昨天标签", vm.runInContext("diaryDayLabel("+(NOW-DAY)+")", ctx).indexOf("昨天")===0);
t("23 未知时间", vm.runInContext("diaryDayLabel(0)", ctx)==="未知时间");
t("23 diaryTs优先ts", vm.runInContext("diaryTs({ts:123,time:'2020-01-01'})", ctx)===123);
t("23 diaryTs解析time文本", vm.runInContext("diaryTs({time:'2020-01-01'})", ctx)===Date.parse("2020-01-01"));
// 日记渲染：两节 + 日期分组头 + 倒序
store["nd_mem2_r1_林黛玉"] = JSON.stringify({short:[
{id:1, time:"手动置顶", ts: NOW-DAY, fact:"置顶记忆A", view:"", pin:true},
{id:2, time:"往事", ts: NOW-2*DAY, fact:"自动记忆B", view:""},
{id:3, time:"往事", ts: NOW-3600e3, fact:"自动记忆C", view:""},
], long:""});
store[HKEY] = JSON.stringify([]);
vm.runInContext(`openAlbum("r1","林黛玉")`, ctx);
const albumHTML = els.view.innerHTML;
t("23 有pinned-memories节", albumHTML.indexOf("pinned-memories")>=0);
t("23 有auto-memories节", albumHTML.indexOf("auto-memories")>=0);
t("23 置顶节在自动节之前", albumHTML.indexOf("pinned-memories")<albumHTML.indexOf("auto-memories"));
t("23 有日期分组头", albumHTML.indexOf("diary-day")>=0);
t("23 置顶记忆A在节内", albumHTML.indexOf("置顶记忆A")>=0 && albumHTML.indexOf("自动记忆C")>=0);
t("23 自动节内按时间倒序(C在B前)", albumHTML.indexOf("自动记忆C")<albumHTML.indexOf("自动记忆B"));

/* ================= 24. 本地召回通知 ================= */
t("24 模板渲染", vm.runInContext(
`renderNotifyText("{{npc_name}}：你回来了，{{username}}！","林黛玉","阿ling")`, ctx)
=== "林黛玉：你回来了，阿ling！");
t("24 缺username容错", vm.runInContext(
`renderNotifyText("{{npc_name}}：你回来了，{{username}}！","林黛玉","")`, ctx)
=== "林黛玉：你回来了，！");
// 关闭时不发
store["nd_notify_cfg"] = JSON.stringify({on:false, hours:6});
notifyCalls.length = 0;
t("24 关闭不触发", vm.runInContext("maybeRecallNotify()", ctx)===false);
// 无桥接不真发
store["nd_notify_cfg"] = JSON.stringify({on:true, hours:6});
store[HKEY] = JSON.stringify([mk("user","hi",{ts:NOW-8*DAY})]);
t("24 无原生桥接不真发", vm.runInContext("maybeRecallNotify()", ctx)===false && notifyCalls.length===0);
// 有桥接 + 超过6h → 发
ctx.Android = { notifyLocal(title, text){ notifyCalls.push({title, text});}};
t("24 超时触发通知", vm.runInContext("maybeRecallNotify()", ctx)===true);
t("24 通知标题是角色名", notifyCalls.length===1 && notifyCalls[0].title==="林黛玉");
t("24 通知正文套模板", notifyCalls[0].text.indexOf("林黛玉")>=0 && notifyCalls[0].text.indexOf("你回来了")>=0);
// 同一窗口不重复发
t("24 防重复(窗口内只发一次)", vm.runInContext("maybeRecallNotify()", ctx)===false && notifyCalls.length===1);
// 最近聊过不发
store[HKEY] = JSON.stringify([mk("user","hi",{ts:NOW-3600e3})]);
const cfg24 = JSON.parse(store["nd_notify_cfg"]); cfg24.lastFired = 0; store["nd_notify_cfg"] = JSON.stringify(cfg24);
t("24 1小时前聊过不发", vm.runInContext("maybeRecallNotify()", ctx)===false && notifyCalls.length===1);
// lastChatInfo 取最新
store["nd_group_r1_林黛玉_贾宝玉"] = JSON.stringify([mk("assistant","群",{speaker:"贾宝玉",ts:NOW-2*3600e3})]);
const li = vm.runInContext("lastChatInfo()", ctx);
t("24 lastChatInfo取最新聊天", li && li.name==="林黛玉" && li.key===HKEY);
// Java 代码审查级验证
const javaSrc = fs.readFileSync("android/src/com/ling/novelreader/MainActivity.java","utf8");
t("24 Java有notifyLocal桥", javaSrc.indexOf("public void notifyLocal")>=0);
t("24 Java建recall通知渠道", javaSrc.indexOf('"recall"')>=0 && javaSrc.indexOf("NotificationChannel")>=0);
t("24 Java onResume调__onAppResumed", javaSrc.indexOf("__onAppResumed")>=0);
t("24 manifest有POST_NOTIFICATIONS", fs.readFileSync("android/AndroidManifest.xml","utf8").indexOf("POST_NOTIFICATIONS")>=0);
t("24 设置页有召回开关", appsrc.indexOf('id="r_notify_on"')>=0 && appsrc.indexOf("saveNotifyUI")>=0);

/* ================= 25. 可编辑 heartbeat ================= */
const HB = vm.runInContext("RP_HB", ctx);
const hbc = HB.getCfg();
t("25 默认关闭", hbc.enabled===false);
t("25 默认频率中", hbc.freq==="mid");
t("25 默认3条检查事项", Array.isArray(hbc.items) && hbc.items.length===3);
t("25 频率档映射30/15/8/4", HB.intervalOf("low")===30 && HB.intervalOf("mid")===15
&& HB.intervalOf("high")===8 && HB.intervalOf("extreme")===4);
t("25 频率中文名", HB.FREQS.low.name==="低" && HB.FREQS.extreme.name==="极高");
// 存取
HB.saveCfg(Object.assign(HB.getCfg(), {enabled:true, freq:"high", items:["a","b"], model:"cheap-x"}));
const hbc2 = HB.getCfg();
t("25 配置存取", hbc2.enabled===true && hbc2.freq==="high" && hbc2.items.join()=="a,b" && hbc2.model==="cheap-x");
// 非法频率回退
HB.saveCfg(Object.assign(HB.getCfg(), {freq:"nope"}));
t("25 非法频率回退mid", HB.getCfg().freq==="mid");
// prompt 与解析
const hp = HB.renderPrompt(["角色是否会主动开启话题"], "玩家：你好", "林黛玉");
t("25 prompt含检查事项", hp.indexOf("角色是否会主动开启话题")>=0);
t("25 prompt要求JSON", hp.indexOf("只输出一个 JSON")>=0);
const prs = HB.parseResult('```json\n{"need":true,"message":"嗨，好久不见"}\n```');
t("25 解析检查结果", prs && prs.need===true && prs.message==="嗨，好久不见");
// runCheck：stub 模型
HB.saveCfg(Object.assign(HB.getCfg(), {roundsSince: 7}));
vm.runInContext(`
globalThis.__hbResult = null;
RP_HB.runCheck({charName:"林黛玉", hist:[{role:"user",content:"你好",ts:1}],
model:"cheap", complete: async ()=> '{"need":true,"message":"想你了"}'})
.then(r=>{ globalThis.__hbResult = r;});`, ctx);
setTimeout(()=>{
const r = ctx.__hbResult;
t("25 runCheck返回need",!!(r && r.ok && r.need===true && r.message==="想你了"));
const c3 = HB.getCfg();
t("25 runCheck写日志", c3.log.length>=1 && c3.log[c3.log.length-1].need===true);
t("25 runCheck清零轮次", c3.roundsSince===0);
// UI 面
t("25 设置页有心跳卡", appsrc.indexOf('id="r_hb_freq"')>=0 && appsrc.indexOf('id="r_hb_items"')>=0);
t("25 有检查一次按钮", appsrc.indexOf("hbCheckOnce")>=0);
t("25 标注仅前台生效", appsrc.indexOf("仅前台生效")>=0);
t("25 sendChatText挂轮次钩子", appsrc.indexOf("hbAfterSend()")>=0);
t("25 不做WorkManager", appsrc.indexOf("WorkManager")===-1 || appsrc.indexOf("不做后台WorkManager")>=0);

console.log(`borrow_d: ${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
}, 300);
