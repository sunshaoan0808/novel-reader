/* Persona: 全局用户人设 + 按聊天覆盖 (对标 C.AI / Janitor Persona)。
 * 存储: nd_persona_global 全局; nd_persona_<runId> 单聊覆盖 (群聊只用全局)。
 * 解析优先级: 本次覆盖 > 全局 > 无。prompt 注入见 rp/prompt.js 的 persona 段。 */
var RP_PERSONA = (function(){
var GKEY = "nd_persona_global";
function okey(runId){ return "nd_persona_" + runId; }
function read(k){
  try{ var v = JSON.parse(localStorage.getItem(k) || "null"); return (v && typeof v === "object") ? v : null; }
  catch(e){ return null; }
}
function getGlobal(){ return read(GKEY); }
function saveGlobal(p){
  if(p && (p.name || p.desc || p.extra || p.called)) localStorage.setItem(GKEY, JSON.stringify({name: p.name||"", desc: p.desc||"", extra: p.extra||"", called: p.called||""}));
  else localStorage.removeItem(GKEY);
}
function getOverride(runId){ return read(okey(runId)); }
function saveOverride(runId, p){
  if(p && (p.name || p.desc || p.extra || p.called)) localStorage.setItem(okey(runId), JSON.stringify({name: p.name||"", desc: p.desc||"", extra: p.extra||"", called: p.called||""}));
  else localStorage.removeItem(okey(runId));
}
function resolve(runId){ return getOverride(runId) || getGlobal(); }
/* 渲染成 prompt 文本; 空返回 ""。#20: "TA怎么称呼我" 注入成"你称呼用户为XX" */
function renderText(p){
  if(!p) return "";
  var parts = [];
  if(p.name) parts.push("你的聊天对象自称「" + p.name + "」。");
  if(p.called) parts.push("你称呼用户为「" + p.called + "」。");
  if(p.desc) parts.push(p.desc);
  if(p.extra) parts.push(p.extra);
  return parts.join("\n");
}
return {getGlobal: getGlobal, saveGlobal: saveGlobal,
        getOverride: getOverride, saveOverride: saveOverride,
        resolve: resolve, renderText: renderText,
        stPersonaParse: stPersonaParse, stPersonaExport: stPersonaExport};
})();
/* ============ ST 人设互转 ============
 * ST 单个人设 JSON (第三方生成器/ST 导入接受的格式):
 *   {name, description, avatar}
 * ST 原生批量 (settings.json 的 power_user.personas / persona_descriptions,
 *   backup-manager 等备份工具导出的 personas.json):
 *   {personas: {头像文件名: 显示名}, persona_descriptions: {头像文件名: {description, title}}}
 * 本机字段: name(自称) / called(AI 对玩家的称呼) / desc(自我描述) / extra(补充)。
 * ST 的 title 是编辑器备注(不注入 prompt), 映射到 extra; called/avatar 本机无对应,
 * 导出时原样带回以保证本机往返不丢, ST 导入时忽略未知字段。
 */
function stPersonaParse(obj){
if(!obj || typeof obj !== "object") throw new Error("不是有效的 JSON 对象");
var out = [];
/* 批量形状 */
if(obj.personas && typeof obj.personas === "object"){
var descs = (obj.persona_descriptions && typeof obj.persona_descriptions === "object") ? obj.persona_descriptions : {};
Object.keys(obj.personas).forEach(function(file){
var d = descs[file] || {};
var stem = String(file).replace(/\.[^.]+$/, "");
out.push({name: String(obj.personas[file] || stem || ""),
          desc: String(d.description || ""),
          extra: String(d.title || ""),
          called: ""});
});
if(!out.length) throw new Error("personas 为空");
return out;
}
/* 单个形状 (含本机导出形状) */
if(typeof obj.name === "string" || typeof obj.description === "string"){
return [{name: String(obj.name || ""),
         desc: String(obj.description || ""),
         extra: String(obj.title || obj.extra || ""),
         called: String(obj.called || "")}];
}
throw new Error("无法识别的人设格式");
}
function stPersonaExport(p){
p = p || {};
return {name: String(p.name || ""),
        description: String(p.desc || ""),
        title: String(p.extra || ""),
        called: String(p.called || ""),
        avatar: ""};
}
