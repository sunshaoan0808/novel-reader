/* 改动单 (2026-10-07): 借鉴 Cardwright。
 * 流程: 用户一句话提改动 → AI 读整卡列影响清单 → 用户确认 → 按字段应用
 * 所有改动标记为 [inference] 来源，因为是用户指导的修改而非原文实证。
 */
var DISTILL_CHANGE = (function(){
"use strict";

// 可改动的字段
var EDITABLE_FIELDS = ["core_identity", "brief_intro", "core_traits", "appearance", "speech_style",
  "background", "relationships_summary", "key_events", "arc_summary",
  "age", "gender", "height", "ethnicity", "likes", "dislikes", "interests", "fears"];

var FIELD_LABEL = {
  core_identity: "身份",
  brief_intro: "简介",
  age: "年龄", gender: "性别", height: "身高", ethnicity: "民族",
  likes: "喜好", dislikes: "厌恶", interests: "兴趣", fears: "恐惧",
  core_traits: "性格",
  appearance: "外貌",
  speech_style: "说话风格",
  background: "背景",
  relationships_summary: "关系",
  key_events: "关键事件",
  arc_summary: "人物弧光"
};

// 第一步: 分析改动请求，生成影响清单
async function proposeChange(pkgId, charName, request, onProgress){
  onProgress = onProgress || function(){};
  var card = DISTILL_PACKAGE.getCharacterCard(pkgId, charName);
  if(!card || !card._distill) throw new Error("角色卡不存在");

  onProgress("AI 分析改动影响...");
  var r = await DISTILL_LLM.chat([
    {role: "system", content:
      "你是角色卡编辑助手。用户想修改角色卡。\n" +
      "阅读当前角色卡的所有字段，分析用户的改动请求会影���哪些字段。\n" +
      "返回 JSON: {\"impacts\": [{\"field\": \"字段名\", \"reason\": \"为什么改\", \"new_value\": \"改后的完整新值\"}], \"summary\": \"一句话总结\"}\n" +
      "只列出真正需要改的字段。new_value 要写完整的新字段值，不是 diff。\n" +
      "保持原文实证部分不动，只改用户要求的部分。"},
    {role: "user", content: JSON.stringify({
      character: charName,
      current: card._distill,
      request: request
    })}
  ]);

  var m = r.content.match(/\{[\s\S]*\}/);
  if(!m) throw new Error("AI 返回格式错误");
  var obj = JSON.parse(m[0]);

  // 过滤非法字段
  var impacts = (obj.impacts || []).filter(function(im){
    return EDITABLE_FIELDS.indexOf(im.field) >= 0 && im.new_value;
  }).map(function(im){
    return {
      field: im.field,
      label: FIELD_LABEL[im.field] || im.field,
      old_value: card._distill[im.field] || "",
      new_value: im.new_value,
      reason: im.reason || ""
    };
  });

  return {impacts: impacts, summary: obj.summary || "", charName: charName};
}

// 第二步: 应用已确认的改动
function applyChange(pkgId, charName, impacts){
  var card = DISTILL_PACKAGE.getCharacterCard(pkgId, charName);
  if(!card) throw new Error("角色卡不存在");
  if(!card._distill) card._distill = {};

  impacts.forEach(function(im){
    // 标记为 inference，因为是用户指导修改
    var val = im.new_value;
    // 如果原值有来源标注，保留标注习惯：新值末尾加 [inference]
    if(val && val.indexOf("[inference") < 0 && val.indexOf("[canon") < 0){
      val += " [inference]";
    }
    card._distill[im.field] = val;
  });

  // 同步 description/personality (UI 用的顶层字段)
  if(card._distill.core_identity) card.description = card._distill.core_identity;
  if(card._distill.core_traits) card.personality = card._distill.core_traits;

  DISTILL_PACKAGE.saveCharacterCard(pkgId, charName, card);

  // 记录改动历史
  try{
    var hist = DISTILL_PACKAGE.getData(pkgId, "change_log") || [];
    hist.push({
      time: Date.now(),
      character: charName,
      impacts: impacts.map(function(im){ return {field: im.field, reason: im.reason}; })
    });
    DISTILL_PACKAGE.saveData(pkgId, "change_log", hist);
  }catch(e){}

  return card;
}

return {
  proposeChange: proposeChange,
  applyChange: applyChange,
  EDITABLE_FIELDS: EDITABLE_FIELDS,
  FIELD_LABEL: FIELD_LABEL
};
})();
