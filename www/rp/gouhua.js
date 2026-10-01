/* RP_GOUHUA: 构画(ST-SevenDaysCal / schedule-planner)数据兼容
* 真实格式依据: 扩展源码 runtime/portable-chat-data.js (v3.7.14)
* - 便携包: {format:"st-sevendayscal-portable", version:1, exportedAt, selectedModules, modules}
* 六模块: points(点·日程) / lines(线·事件线+虚线) / outline(面·大纲+面讨论)
* space(间·局外聊天) / calendar(历·历法/日期锚点) / theater(棱·小剧场)
* 条目键白名单(与扩展 KEY_MATCHERS 一致):
* points: schedule-user, schedule-char-<enc>, charnames-recent, char-pins
* lines: lines-user, dashed-user
* outline: outline-user, outline-char-<enc>, creative-chat-user, creative-chat-char-<enc>
* space: space-chat-user
* calendar: almanac-user, caldesc-user, caldesc-fallback-user, date-anchor-user
* theater: {saved:[...]} (条目为自由对象, 仅保证有 id)
* - 聊天级扩展数据(走 ST JSONL 透传, 见 app.js): 首行 chat_metadata
* (sp-store/sp-memory/sp-theater/sp-ledger) + 消息行 extra(如 gouhua_snapshot)
* 本机映射: 日程/事件线/大纲/历法/小剧场 -> 世界书条目; 局外聊天/面讨论 -> 聊天消息。
* 纯函数模块, 无 DOM 依赖, 可在 node 下单测。
*/
var RP_GOUHUA = (function(){
"use strict";

var PORTABLE_FORMAT = "st-sevendayscal-portable";
var PORTABLE_VERSION = 1;
var MAX_BYTES = 8 * 1024 * 1024;

var MODULES = [
{id: "points", label: "点（日程）"},
{id: "lines", label: "线（事件线/虚线）"},
{id: "outline", label: "面（大纲/面讨论）"},
{id: "space", label: "间（局外聊天）"},
{id: "calendar", label: "历（历法/日期锚点）"},
{id: "theater", label: "棱（小剧场）"}
];
var MODULE_IDS = {};
MODULES.forEach(function(m){ MODULE_IDS[m.id] = true;});

/* 条目键白名单: 与扩展 KEY_MATCHERS 语义一致 */
function keyOk(id, key){
key = String(key || "");
if(id === "points")
return key === "schedule-user" || key.indexOf("schedule-char-") === 0 ||
key === "charnames-recent" || key === "char-pins";
if(id === "lines")
return key === "lines-user" || key === "dashed-user";
if(id === "outline")
return key === "outline-user" || key.indexOf("outline-char-") === 0 ||
key === "creative-chat-user" || key.indexOf("creative-chat-char-") === 0;
if(id === "space") return key === "space-chat-user";
if(id === "calendar")
return key === "almanac-user" || key === "caldesc-user" ||
key === "caldesc-fallback-user" || key === "date-anchor-user";
return false;
}
/* 数组型条目(与扩展 ARRAY_ENTRY_KEYS 一致) */
function keyIsArray(id, key){
key = String(key || "");
if(id === "points") return key === "charnames-recent" || key === "char-pins";
if(id === "outline")
return key === "creative-chat-user" || key.indexOf("creative-chat-char-") === 0;
if(id === "space") return key === "space-chat-user";
return false;
}

function fail(reason, message){ return {ok: false, reason: reason, message: message};}
function isObj(v){ return!!v && typeof v === "object" &&!Array.isArray(v);}
function clone(v){ return v === undefined? undefined: JSON.parse(JSON.stringify(v));}
function str(v){ return v == null? "": String(v);}
function trim(s){ return str(s).trim();}

/* 便携包解析: 镜像扩展 parsePortableChatPackage 的校验口径 */
function parsePortable(text){
var source = str(text);
if(source.length > MAX_BYTES) return fail("file-too-large", "文件超过 8 MB 限制");
if(!source.trim()) return fail("empty-file", "文件是空的");
var raw;
try{ raw = JSON.parse(source);}
catch(e){ return fail("invalid-json", "文件不是有效的 JSON");}
if(!isObj(raw) || raw.format!== PORTABLE_FORMAT)
return fail("invalid-format", "这不是构画按模块导出的数据包");
if(raw.version!== PORTABLE_VERSION)
return fail("unsupported-version", "暂不支持此数据包版本: " + str(raw.version == null? "未知": raw.version));
if(!Array.isArray(raw.selectedModules) ||!raw.selectedModules.length ||!isObj(raw.modules))
return fail("invalid-header", "数据包头缺少模块清单");
var selected = [];
raw.selectedModules.map(String).forEach(function(id){ if(selected.indexOf(id) < 0) selected.push(id);});
if(selected.some(function(id){ return!MODULE_IDS[id];}))
return fail("unknown-module", "数据包声明了不支持的模块");
var moduleKeys = Object.keys(raw.modules);
var mismatch = moduleKeys.some(function(id){ return!MODULE_IDS[id];}) ||
moduleKeys.length!== selected.length ||
selected.some(function(id){ return!Object.prototype.hasOwnProperty.call(raw.modules, id);});
if(mismatch) return fail("module-list-mismatch", "数据包模块清单与实际内容不一致");
var modules = {};
for(var i = 0; i < selected.length; i++){
var id = selected[i];
var checked = validateModule(id, raw.modules[id]);
if(!checked.ok) return checked;
modules[id] = checked.value;
}
return {ok: true, pkg: {
format: raw.format, version: raw.version,
exportedAt: str(raw.exportedAt || ""), selectedModules: selected, modules: modules
}};
}

function validateModule(id, value){
if(!isObj(value)) return fail("invalid-module", "模块 " + id + " 的结构不正确");
if(id === "theater"){
if(!Array.isArray(value.saved)) return fail("invalid-theater", "已保存小剧场不是列表");
return {ok: true, value: {saved: clone(value.saved)}};
}
if(!isObj(value.entries)) return fail("invalid-entries", "模块 " + id + " 缺少数据条目");
var entries = {};
var keys = Object.keys(value.entries);
for(var i = 0; i < keys.length; i++){
var k = keys[i], item = value.entries[k];
if(!keyOk(id, k)) return fail("illegal-module-key", "模块 " + id + " 包含不允许的条目: " + k);
var expectArr = keyIsArray(id, k);
if(expectArr?!Array.isArray(item):!isObj(item))
return fail("invalid-entry", "模块 " + id + " 的条目 " + k + " 顶层结构不正确");
entries[k] = clone(item);
}
return {ok: true, value: {entries: entries}};
}

/* ---- 映射到本机 ---- */

function charNameOf(key, prefix){
var enc = str(key).slice(prefix.length);
try{ return decodeURIComponent(enc).trim();}catch(e){ return enc.trim();}
}
/* lines-user 可能只有 history 版本而无 raw: 取最后一条有 raw 的版本 */
function linesRaw(item){
var raw = trim(item && item.raw);
if(raw) return raw;
var hist = item && item.history;
if(Array.isArray(hist)){
for(var i = hist.length - 1; i >= 0; i--){
var r = trim(hist[i] && hist[i].raw);
if(r) return r;
}
}
return "";
}
function loreEntry(name, keys, content, comment){
return {name: name, key: keys, content: str(content), comment: str(comment || ""),
enabled: true, probability: 100, constant: false};
}
var ALM_TYPE_LABEL = {festival: "节日", birthday: "生日", anniversary: "纪念日", custom: "自定义"};
function almDateLabel(it){
if(trim(it.displayDate)) return trim(it.displayDate);
return str(it.month || "") + "月" + str(it.day || "") + "日";
}

/* 便携包 -> 世界书条目(未归一化, 调用方按既有 lorebook 路径存入即可) */
function toLoreEntries(pkg){
var out = [];
if(!pkg ||!pkg.modules) return out;
var mods = pkg.modules, entries, keys, i, k, item;
/* 点: 日程 -> 世界书; charnames-recent/char-pins 是设备级便利数据, 跳过 */
if(mods.points){
entries = mods.points.entries; keys = Object.keys(entries);
for(i = 0; i < keys.length; i++){
k = keys[i]; item = entries[k];
var raw = trim(item.raw);
if(!raw) continue;
if(k === "schedule-user")
out.push(loreEntry("【构画·点】日程", ["日程", "构画"], raw,
trim(item.userName)? "玩家: " + trim(item.userName): ""));
else if(k.indexOf("schedule-char-") === 0){
var cn = charNameOf(k, "schedule-char-") || "TA";
out.push(loreEntry("【构画·点】" + cn + "的日程", [cn, "日程"], raw));
}
}
}
/* 线: 事件线 + 虚线冷知识 */
if(mods.lines){
entries = mods.lines.entries; keys = Object.keys(entries);
for(i = 0; i < keys.length; i++){
k = keys[i]; item = entries[k];
if(k === "lines-user"){
var lr = linesRaw(item);
if(lr) out.push(loreEntry("【构画·线】事件线", ["事件线", "构画"], lr));
}else if(k === "dashed-user" && Array.isArray(item.items)){
item.items.forEach(function(d){
var t = trim(d && d.text);
if(t) out.push(loreEntry("【构画·虚线】" + t.slice(0, 14), ["虚线", "冷知识"], t));
});
}
}
}
/* 面: 大纲 -> 世界书; 面讨论(creative-chat) -> 聊天, 不在这里 */
if(mods.outline){
entries = mods.outline.entries; keys = Object.keys(entries);
for(i = 0; i < keys.length; i++){
k = keys[i]; item = entries[k];
var oraw = trim(item.raw);
if(!oraw) continue;
if(k === "outline-user")
out.push(loreEntry("【构画·面】大纲", ["大纲", "构画"], oraw));
else if(k.indexOf("outline-char-") === 0){
var on = charNameOf(k, "outline-char-") || "TA";
out.push(loreEntry("【构画·面】" + on + "的大纲", [on, "大纲"], oraw));
}
}
}
/* 历: 历条目 + 历法设定 + 日期锚点 */
if(mods.calendar){
entries = mods.calendar.entries; keys = Object.keys(entries);
var caldescRaw = "";
for(i = 0; i < keys.length; i++){
k = keys[i]; item = entries[k];
if(k === "almanac-user" && Array.isArray(item.items)){
item.items.forEach(function(a){
if(!a ||!trim(a.name)) return;
var label = ALM_TYPE_LABEL[a.type] || "自定义";
var body = "【" + label + "】" + almDateLabel(a);
if(trim(a.note)) body += "\n" + trim(a.note);
out.push(loreEntry("【构画·历】" + trim(a.name), [trim(a.name), "历法"], body));
});
}else if(k === "caldesc-user"){
caldescRaw = trim(item.raw);
if(caldescRaw) out.push(loreEntry("【构画·历】历法设定", ["历法", "构画"], caldescRaw));
}else if(k === "date-anchor-user"){
var araw = trim(item.raw);
if(araw) out.push(loreEntry("【构画·历】当前日期锚点", ["日期", "构画"], araw));
}
}
/* 备用历法设定: 与主设定不同才收 */
if(entries["caldesc-fallback-user"]){
var fb = trim(entries["caldesc-fallback-user"].raw);
if(fb && fb!== caldescRaw)
out.push(loreEntry("【构画·历】历法设定(备用)", ["历法", "构画"], fb));
}
}
/* 棱: 小剧场 -> 世界书 */
if(mods.theater && Array.isArray(mods.theater.saved)){
mods.theater.saved.forEach(function(p){
if(!p || typeof p!== "object") return;
var title = trim(p.title) || trim(p.name) || str(p.id || "未命名");
var body = trim(p.script) || trim(p.content) || trim(p.text) || trim(p.body);
if(!body) body = JSON.stringify(p);
out.push(loreEntry("【构画·棱】小剧场: " + title, ["小剧场", "构画"], body));
});
}
return out;
}

/* 便携包 -> 聊天消息条目 [{role, content, ts}]: 间(局外聊天) + 面讨论 */
function toChatEntries(pkg){
var out = [];
if(!pkg ||!pkg.modules) return out;
function pushMsgs(arr){
(Array.isArray(arr)? arr: []).forEach(function(m){
var c = trim(m && m.content);
if(!c) return;
var r = (m && m.role) === "assistant"? "assistant": "user";
out.push({role: r, content: c, ts: Date.now()});
});
}
var mods = pkg.modules, entries, keys, i;
if(mods.space){
entries = mods.space.entries; keys = Object.keys(entries);
for(i = 0; i < keys.length; i++) pushMsgs(entries[keys[i]]);
}
if(mods.outline){
entries = mods.outline.entries; keys = Object.keys(entries);
for(i = 0; i < keys.length; i++){
var k = keys[i];
if(k === "creative-chat-user" || k.indexOf("creative-chat-char-") === 0) pushMsgs(entries[k]);
}
}
return out;
}

function moduleLabel(id){
for(var i = 0; i < MODULES.length; i++) if(MODULES[i].id === id) return MODULES[i].label;
return String(id || "");
}

/* 确认页用: 每模块的映射预览 */
function summarize(pkg){
var mods = (pkg && pkg.modules) || {};
var rows = [];
Object.keys(mods).forEach(function(id){
var one = {format: pkg.format, version: pkg.version, selectedModules: [id], modules: {}};
one.modules[id] = mods[id];
var nl = toLoreEntries(one).length, nc = toChatEntries(one).length;
var target = nl && nc? "世界书 " + nl + " 条 + 聊天 " + nc + " 条"
: nl? "世界书 " + nl + " 条": nc? "聊天 " + nc + " 条": "无可导入内容";
rows.push({id: id, label: moduleLabel(id), lore: nl, chat: nc, target: target});
});
return rows;
}

return {
PORTABLE_FORMAT: PORTABLE_FORMAT, PORTABLE_VERSION: PORTABLE_VERSION,
MODULES: MODULES,
parsePortable: parsePortable,
toLoreEntries: toLoreEntries,
toChatEntries: toChatEntries,
summarize: summarize,
moduleLabel: moduleLabel
};
})();
if(typeof module!== "undefined" && module.exports) module.exports = RP_GOUHUA;
