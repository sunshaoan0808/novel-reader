/* 构画(ST-SevenDaysCal)便携包兼容测试。
* 真实格式依据: 扩展源码 runtime/portable-chat-data.js (v3.7.14)。
* fixture tests/fixtures/gouhua-portable-real.json 由扩展自带的
* buildPortableChatPackage 真实生成(六模块全选), 并经其 parsePortableChatPackage
* 回检通过, 不是手编形状。
*/
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const WWW = path.join(ROOT, "www");
eval(fs.readFileSync(path.join(WWW, "rp/gouhua.js"), "utf8"));

let pass = 0, fail = 0;
function t(name, cond){
if(cond){ pass++;}
else{ fail++; console.error("FAIL:", name);}
}
function eq(a, b){ return JSON.stringify(a) === JSON.stringify(b);}

const realText = fs.readFileSync(path.join(__dirname, "fixtures/gouhua-portable-real.json"), "utf8");

/* 1) 真实包解析 */
const r = RP_GOUHUA.parsePortable(realText);
t("真实包解析成功", r.ok === true);
t("六模块全选", r.ok && r.pkg.selectedModules.length === 6);
t("format/version", r.ok && r.pkg.format === "st-sevendayscal-portable" && r.pkg.version === 1);

/* 2) 非法输入拒绝 */
t("拒: 非 JSON", RP_GOUHUA.parsePortable("not json").ok === false);
t("拒: 格式不对", RP_GOUHUA.parsePortable(JSON.stringify({format:"xxx",version:1})).ok === false);
t("拒: 版本不对", RP_GOUHUA.parsePortable(JSON.stringify(
{format:"st-sevendayscal-portable",version:2,selectedModules:["points"],modules:{points:{entries:{}}}})).reason === "unsupported-version");
t("拒: 模块清单不一致", RP_GOUHUA.parsePortable(JSON.stringify(
{format:"st-sevendayscal-portable",version:1,selectedModules:["points","lines"],modules:{points:{entries:{}}}})).reason === "module-list-mismatch");
t("拒: 非法条目键", RP_GOUHUA.parsePortable(JSON.stringify(
{format:"st-sevendayscal-portable",version:1,selectedModules:["points"],
modules:{points:{entries:{"evil-key":{raw:"x"}}}}})).reason === "illegal-module-key");
t("拒: 未知模块", RP_GOUHUA.parsePortable(JSON.stringify(
{format:"st-sevendayscal-portable",version:1,selectedModules:["nope"],modules:{nope:{entries:{}}}})).reason === "unknown-module");

/* 3) 世界书映射(真实包): 点2(日程×2, recent/pins 跳过) + 线2(事件线+虚线1)
* + 面1(大纲, 面讨论走聊天) + 历4(历条目2+历法设定+日期锚点) + 棱2 = 11 */
const lore = RP_GOUHUA.toLoreEntries(r.pkg);
t("世界书 11 条", lore.length === 11);
t("点: 玩家日程", lore.some(e=>e.name === "【构画·点】日程" && e.content.indexOf("晨练") >= 0));
t("点: 角色日程", lore.some(e=>e.name === "【构画·点】林黛玉的日程" && e.key.indexOf("林黛玉") >= 0));
t("线: 事件线", lore.some(e=>e.name === "【构画·线】事件线" && e.content.indexOf("甄士隐") >= 0));
t("线: 虚线冷知识", lore.some(e=>e.name.indexOf("【构画·虚线】") === 0 && e.content.indexOf("通灵宝玉") >= 0));
t("面: 大纲", lore.some(e=>e.name === "【构画·面】大纲" && e.content.indexOf("宝黛初会") >= 0));
t("历: 历条目", lore.some(e=>e.name === "【构画·历】元宵" && e.content.indexOf("【节日】") >= 0 && e.content.indexOf("吃元宵") >= 0));
t("历: 历法设定", lore.some(e=>e.name === "【构画·历】历法设定" && e.content.indexOf("十二月") >= 0));
t("历: 日期锚点", lore.some(e=>e.name === "【构画·历】当前日期锚点" && e.content.indexOf("三月初三") >= 0));
t("棱: 小剧场", lore.filter(e=>e.name.indexOf("【构画·棱】") === 0).length === 2
&& lore.some(e=>e.name.indexOf("葬花") >= 0));
t("条目都有触发词", lore.every(e=>Array.isArray(e.key) && e.key.length > 0));

/* 4) 聊天映射(真实包): 面讨论2 + 间2 = 4 */
const chat = RP_GOUHUA.toChatEntries(r.pkg);
t("聊天 4 条", chat.length === 4);
t("角色保留", chat.filter(e=>e.role === "user").length === 2 && chat.filter(e=>e.role === "assistant").length === 2);
t("面讨论内容", chat.some(e=>e.content.indexOf("节奏") >= 0));
t("间内容", chat.some(e=>e.content.indexOf("出戏") >= 0));
t("ts 合法", chat.every(e=>typeof e.ts === "number" && e.ts > 0));

/* 5) 确认页摘要 */
const rows = RP_GOUHUA.summarize(r.pkg);
t("摘要 6 行", rows.length === 6);
const points = rows.filter(x=>x.id === "points")[0];
t("点摘要", points && points.lore === 2 && points.chat === 0);
const space = rows.filter(x=>x.id === "space")[0];
t("间摘要走聊天", space && space.lore === 0 && space.chat === 2);
const outline = rows.filter(x=>x.id === "outline")[0];
t("面摘要双通道", outline && outline.lore === 1 && outline.chat === 2);

/* 6) 空条目不进世界书 */
const emptyPkg = {format:"st-sevendayscal-portable",version:1,selectedModules:["points"],
modules:{points:{entries:{"schedule-user":{raw:" "},"charnames-recent":["a"]}}}};
t("空白日程被跳过", RP_GOUHUA.toLoreEntries(emptyPkg).length === 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail? 1: 0);
