/* RP 引擎: VibeCreate 式"一句话生成角色" (对标 Character.AI VibeCreate)
 * 抄: 输入一句话描述 -> 一次 LLM 调用输出整张角色卡 JSON ->
 *     "换一批"(Shuffle personalities) 重新生成 -> "手动微调"(create-manually) 转入现有写卡表单
 * 包内文案逐字: "Describe your character..." / "Shuffle personalities" /
 *     "Create a character manually" / "Failed to generate character (vibe-create)" / "Tap to retry"
 * 不抄: 额度/paywall (无后端)
 * 纯逻辑, 无 DOM, 可被 node vm 测试。UI 在 app.js (写卡页)。
 */
var RP_VIBE = (function(){
"use strict";

/* VibeCreate 输出卡字段 (白名单) */
var VIBE_FIELDS = ["name", "personality", "greeting", "exampleDialogue", "background"];

function vibePrompt(desc, attempt){
  var salt = (attempt > 0)
    ? "\n注意: 这是第 " + (attempt + 1) + " 次生成, 请换一种完全不同的风格和名字重新构思, 不要重复之前的方案。"
    : "";
  return "你是角色卡设计师。用户只用一句话描述想要的角色, 你直接生成一整张角色卡。\n" +
    "只输出一个 JSON 对象, 不要输出任何解释、前言或 markdown 代码块标记。\n" +
    "JSON 键固定为以下 5 个, 缺的就省略, 不要编造多余的键:\n" +
    "{\n" +
    "  \"name\": \"角色名字(2-4 个字, 有味道)\",\n" +
    "  \"personality\": \"性格(3-5 句, 具体、有细节, 禁止八股词如\"非常/极其/深深地\")\",\n" +
    "  \"greeting\": \"开场白(1 段, 带角色口吻, 聊天第一句话用)\",\n" +
    "  \"exampleDialogue\": \"示例对话(2-3 轮, 用 <START> 分隔, 含 {{user}} / {{char}} 标记)\",\n" +
    "  \"background\": \"背景(3-5 句: 身世、处境、与世界的关系)\"\n" +
    "}" + salt + "\n\n一句话描述: " + desc;
}

/* 解析模型输出的 JSON; 失败抛错, 由调用方转 toast, 不中断流程 */
function parseVibeJson(raw){
  var t = String(raw == null ? "" : raw).replace(/```json|```/g, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) throw new Error("vibe-parse-failed");
  var o;
  try { o = JSON.parse(t.slice(a, b + 1)); }
  catch(e){ throw new Error("vibe-parse-failed"); }
  var card = {};
  VIBE_FIELDS.forEach(function(k){
    var v = o[k];
    if(v == null) return;
    v = String(v).trim();
    if(v) card[k] = v;
  });
  if(!card.name) throw new Error("vibe-parse-failed");
  return card;
}

/* 一次 LLM 调用生成角色卡; 失败(网络/解析)直接抛错, UI 层 toast */
async function generate(desc, cfg, callChat, attempt){
  var scfg = {base: cfg.base, key: cfg.key, model: cfg.model};
  var raw = await callChat(scfg, [{role: "user", content: vibePrompt(desc, attempt || 0)}], 0.8);
  return parseVibeJson(raw);
}

/* 把 Vibe 卡映射进现有写卡表单字段 (手动微调入口用) */
function toCardFields(card){
  var fields = {};
  if(card.personality) fields.core_identity = card.personality;
  if(card.background) fields.life_timeline = card.background;
  if(card.personality) fields.core_traits = card.personality;
  return fields;
}

return {VIBE_FIELDS: VIBE_FIELDS, vibePrompt: vibePrompt,
  parseVibeJson: parseVibeJson, generate: generate, toCardFields: toCardFields};
})();
if(typeof module !== "undefined" && module.exports) module.exports = RP_VIBE;
