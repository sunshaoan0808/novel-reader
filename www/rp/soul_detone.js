/* Soul 去AI味模块 (2026-10-14)
 * 接入上游 lieflat-less-ai-tone (MIT) 的精简规则集。
 * 上游是基于 283 万字语料对照的中文"去 AI 味" skill (11 条改写规则)，
 * 这里只提炼适用于 RP 对话/叙事/独白的子集，不复制全文。
 *
 * 两层：
 * 1. prompt 注入 (主)：buildSoulPrompt 追加精简版去 AI 味指令，零额外 LLM 调用。
 *    风格优先级：角色卡/文风卡对语言风格有明确要求且冲突时，以角色卡/文风卡为准
 *    (上游 SKILL.md 原文原则)。
 * 2. 后处理 (兜底)：对解析后的 dialogue/action/inner 做确定性清洗，
 *    只处理最机械、误伤率最低的三类 (R1 翻案腔 / R5a 提示语冒号 / R9 起手式)。
 *    上游是白名单式改写——没命中的原文逐字保留，这里同样：cleanText 只改命中处。
 *
 * 11 条规则适用性：
 * 对话+叙事+独白：R1 翻案腔，R9 起手式，R5a 提示语冒号，R10 翻译腔5种 (prompt 层)
 * 叙事/独白：R3 句式同款，R4 破折号，R7 拟人喻体 (prompt 层)
 * 不适用：R6 小标题编号 (聊天无标题)，R8 数据概括 (RP 无数据)
 *          R2 顿号罗列 (prompt 层轻量提及)，R11 段首零主语 (单消息极少分段)
 */
var RP_DETONE = (function(){
"use strict";

var LS_KEY = "nd_detone_off";  /* =1 时关闭；默认开启 (opt-out，同 nd_soulmode_off_ 惯例) */

function isEnabled(){
  try{ return localStorage.getItem(LS_KEY) !== "1"; }catch(e){ return true; }
}
function setEnabled(on){
  try{
    if(on) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, "1");
  }catch(e){}
}

/* 精简版 prompt 指令 (~130 字)。关闭时返回 ""。 */
function promptBlock(){
  if(!isEnabled()) return "";
  return "【去AI味】像真人说话，不像 AI 写稿：不用“不是……而是……”翻案腔，有判断直接下判断；" +
    "不用“说白了/说穿了/先说结论”起手；不用“一句话总结：”“核心是：”这类提示语加冒号；" +
    "少用破折号做“揭晓”，不用“这意味着”另起一句复述上句；不用“对于……来说”“当……时”这类翻译腔壳子；" +
    "相邻几句别用同一句式。(角色卡/文风卡对语言风格有明确要求且冲突时，以角色卡/文风卡为准)";
}

/* 确定性清洗：只处理 R1/R5a/R9 三类机械模式。未命中则原文返回。
 * R1 的正则限定单分句 (分句标点外的字符类)，不会跨句误改。 */
function cleanText(s){
  s = String(s == null ? "" : s);
  if(!s || !isEnabled()) return s;
  // R9: 起手式 (句首或分句首)
  s = s.replace(/(^|[。！？])(说白了|说穿了|先说结论)[，,：:\s]*/g, "$1");
  // R5a: 提示语冒号 (句首)
  s = s.replace(/^(一句话总结|核心是|关键在于|原因如下|本质上|换句话说)[：:]/, "");
  // R1: 翻案腔 (X不是Y，而是Z → X是Z；Z 不在匹配内，自动保留)
  var P = "[^，。！？；：“”「」『』]";
  var re1 = new RegExp("(" + P + "*)不是(" + P + "*)，?而是", "g");
  var re2 = new RegExp("(" + P + "*)并非(" + P + "*)，?而是", "g");
  var re3 = new RegExp("(" + P + "*)不在于(" + P + "*)，?而在于", "g");
  var re4 = new RegExp("与其说(" + P + "*)[，,]不如说", "g");
  s = s.replace(re1, "$1是");
  s = s.replace(re2, "$1是");
  s = s.replace(re3, "$1在于");
  s = s.replace(re4, "");
  return s;
}

/* 对 soul 回包三字段清洗。开关关闭时返回原对象 (零影响)。 */
function cleanReply(reply){
  if(!reply || !isEnabled()) return reply;
  var out = {}, k;
  for(k in reply){
    if(Object.prototype.hasOwnProperty.call(reply, k)) out[k] = reply[k];
  }
  ["dialogue", "action", "inner"].forEach(function(f){
    if(typeof out[f] === "string" && out[f]) out[f] = cleanText(out[f]);
  });
  return out;
}

return {
  isEnabled: isEnabled,
  setEnabled: setEnabled,
  promptBlock: promptBlock,
  cleanText: cleanText,
  cleanReply: cleanReply,
  LS_KEY: LS_KEY
};
})();
if(typeof window !== "undefined") window.RP_DETONE = RP_DETONE;
if(typeof module !== "undefined") module.exports = RP_DETONE;
