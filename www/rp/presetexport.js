/* RP_PRESETEXPORT: 本机预设 -> SillyTavern 预设 JSON (RP_PRESET.parseFile 的逆操作)。
 * 只写 ST 能识别的字段: {name, temperature, top_p, prompts:[{name,role,content,
 * marker,identifier,enabled,injection_position,injection_depth,extension:{entryGrouping}}]}。
 * 纯函数模块, 无 DOM 依赖, 可在 node vm 里单测。 */
var RP_PRESETEXPORT = (function(){
"use strict";

function str(v){ return v == null ? "" : String(v); }

/* 单条目 -> ST prompt 对象 */
function exportPrompt(e){
  e = e || {};
  var o = {
    name: str(e.name),
    role: (e.role === "user" || e.role === "assistant") ? e.role : "system",
    content: str(e.content),
    marker: !!e.marker,
    identifier: str(e.identifier),
    enabled: e.enabled !== false,
    /* injection_position 保留原类型(数字/字符串), parseFile 侧用 || "" 语义读回 */
    injection_position: (e.injection_position || ""),
    injection_depth: (e.injection_depth == null || e.injection_depth === "" ? null : +e.injection_depth)
  };
  if(e.group) o.extension = {entryGrouping: str(e.group)};
  return o;
}

/* 整份预设 -> ST 预设 JSON 对象 */
function exportPreset(p){
  p = p || {};
  var d = {
    name: str(p.name || "未命名预设"),
    prompts: (p.prompts || []).map(exportPrompt)
  };
  var params = p.params || {};
  if(params.temperature != null && isFinite(+params.temperature)) d.temperature = +params.temperature;
  if(params.top_p != null && isFinite(+params.top_p)) d.top_p = +params.top_p;
  return d;
}

return {
  exportPrompt: exportPrompt,
  exportPreset: exportPreset
};
})();
