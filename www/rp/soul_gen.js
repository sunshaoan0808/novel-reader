/* Soul 生成器 - 用 LLM 从角色卡生成完整 soul 包
 *
 * 输入: 角色卡 (name, description, personality, scenario, fields...)
 * 输出: 完整 soul 包 (soul_md, persona, background, rules)
 * 注意: 生成是初始创建, 可写不可变区; 生成后走 RP_SOUL.write 则受写保护
 */

var RP_SOUL_GEN = (function(){
"use strict";

/* 生成 prompt */
function buildGenPrompt(card){
  var name = card.name || "未命名";
  var desc = String(card.description || "").slice(0, 1000);
  var pers = String(card.personality || "").slice(0, 1000);
  var scen = String(card.scenario || "").slice(0, 800);
  var fields = card.fields || {};
  var extra = [];
  ["speech_style", "core_traits", "background"].forEach(function(k){
    if(fields[k]) extra.push(k + ": " + String(fields[k]).slice(0, 500));
  });

  return "为角色「" + name + "」生成灵魂包 (soul pack), 用于多智能体角色扮演。\n\n" +
    "已知信息:\n" +
    (desc ? "描述: " + desc + "\n" : "") +
    (pers ? "性格: " + pers + "\n" : "") +
    (scen ? "场景: " + scen + "\n" : "") +
    (extra.length ? extra.join("\n") + "\n" : "") +
    "\n只输出 JSON, 格式:\n" +
    "{\n" +
    '  "soul_md": "散文宪章: 声口、价值观、压力下的反应模式 (200字内)",\n' +
    '  "persona": {\n' +
    '    "core_traits": [{"trait": "特质名", "intensity": 0-100, "description": "一句话"}] (3-6条),\n' +
    '    "motivations": ["动机1", "动机2"] (2-4条),\n' +
    '    "values": ["价值1", "价值2"] (按重要性排序, 3-5条),\n' +
    '    "relationships": {"人名": "关系描述"}\n' +
    "  },\n" +
    '  "background": {\n' +
    '    "origin": "来历 (100字内)",\n' +
    '    "history": "简史 (200字内)",\n' +
    '    "secrets": "秘密 (绝不主动透露的, 50字内, 可空)"\n' +
    "  },\n" +
    '  "rules": {\n' +
    '    "decision": "决策原则 (100字内)",\n' +
    '    "interaction": "社交原则 (100字内)",\n' +
    '    "action": "行动原则 (100字内)"\n' +
    "  }\n" +
    "}\n\n" +
    "要求: 贴合已知信息, 不编造矛盾设定; 秘密要有戏剧张力; 只输出 JSON, 不要解释。";
}

/* 解析生成结果 */
function parseGenResult(raw){
  var text = String(raw || "");
  var m = text.match(/\{[\s\S]*\}/);
  if(!m) return {ok: false, reason: "no_json"};
  try{
    var d = JSON.parse(m[0]);
    /* 基础校验 */
    if(!d.persona || !d.background || !d.rules){
      return {ok: false, reason: "missing_sections"};
    }
    return {ok: true, data: d};
  }catch(e){
    return {ok: false, reason: "json_parse: " + (e.message || e)};
  }
}

/* 生成 soul 包并写入 card
 * callFn: function(cfg, messages, temp) -> Promise<string>
 * 返回 {ok, reason} */
async function generate(card, cfg, callFn){
  if(typeof RP_SOUL === "undefined") return {ok: false, reason: "no_soul"};
  var prompt = buildGenPrompt(card);
  var raw;
  try{
    raw = await callFn(cfg, [{role: "user", content: prompt}], 0.7);
  }catch(e){
    return {ok: false, reason: "llm: " + (e.message || e)};
  }
  var parsed = parseGenResult(raw);
  if(!parsed.ok) return parsed;

  var d = parsed.data;
  var soul = RP_SOUL.ensureSoul(card);
  /* 初始创建: 直接写 (绕过写保护, 因是首次生成) */
  soul.soul_md = String(d.soul_md || "").slice(0, 1000);
  soul.persona = {
    core_traits: Array.isArray(d.persona.core_traits) ? d.persona.core_traits.slice(0, 8) : [],
    motivations: Array.isArray(d.persona.motivations) ? d.persona.motivations.slice(0, 6) : [],
    values: Array.isArray(d.persona.values) ? d.persona.values.slice(0, 8) : [],
    relationships: (d.persona.relationships && typeof d.persona.relationships === "object") ? d.persona.relationships : {}
  };
  soul.background = {
    origin: String((d.background || {}).origin || "").slice(0, 500),
    history: String((d.background || {}).history || "").slice(0, 1000),
    secrets: String((d.background || {}).secrets || "").slice(0, 500)
  };
  soul.rules = {
    decision: String((d.rules || {}).decision || "").slice(0, 500),
    interaction: String((d.rules || {}).interaction || "").slice(0, 500),
    action: String((d.rules || {}).action || "").slice(0, 500)
  };
  soul.schema_version = RP_SOUL.SCHEMA_V;

  return {ok: true};
}

/* 批量生成 (多个卡, 串行避免并发超限) */
async function generateBatch(cards, cfg, callFn, onProgress){
  var results = [];
  for(var i = 0; i < cards.length; i++){
    if(onProgress) onProgress(cards[i].name, i, cards.length);
    var r = await generate(cards[i], cfg, callFn);
    results.push({name: cards[i].name, ok: r.ok, reason: r.reason});
    /* 间隔避免限流 */
    if(i < cards.length - 1){
      await new Promise(function(res){ setTimeout(res, 1000); });
    }
  }
  return results;
}

return {
  buildGenPrompt: buildGenPrompt,
  parseGenResult: parseGenResult,
  generate: generate,
  generateBatch: generateBatch
};

})();
if(typeof window !== "undefined") window.RP_SOUL_GEN = RP_SOUL_GEN;
if(typeof module !== "undefined") module.exports = RP_SOUL_GEN;
