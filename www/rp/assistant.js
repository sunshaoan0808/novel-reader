/* 浮生小助手 (2026-10-07): 借鉴 Marinara-Engine Professor Mari。
 * App 内置 AI 助手：
 * - 讲解功能、回答使用问题（内置知识库 + LLM）
 * - 自然语言创建：角色草稿、世界书条目
 * - 快捷操作 chips：一键直达常用功能
 * - 改动可预览确认，不会自动乱改数据
 */
var ASSISTANT = (function(){
"use strict";

/* 内置知识库：功能问答 */
var KB = [
  {q: ["蒸馏", "distill", "小说转"], a: "「蒸馏」tab 可以上传小说 TXT，自动发现角色、配置范围深度，生成剧本包（含角色卡/关系/世界书/开场白）。蒸馏完成后会自动抽取文风卡。"},
  {q: ["文风", "style", "续写"], a: "包页点「文风库」查看已抽取的文风卡。点「用此文风续写」选定文风后，在试玩场输入续写要求，AI 会按该作家文风生成。已预置「红楼梦·曹雪芹」卡。"},
  {q: ["推剧情", "push", "卡文"], a: "聊天输入框的 🚀 按钮就是 Push Story。卡文时点一下，选顺推或加意外，下一条回复 AI 自动推进剧情，用完自动关闭。"},
  {q: ["关系", "relation", "锁定"], a: "抽屉菜单 → 「关系管理」：查看聊天中演变的关系，点锁定后 AI 不会再改那条。关系每 6 轮后台自动检测更新。"},
  {q: ["世界书", "lorebook", "lore"], a: "「更多」tab 可看世界书。Lorebook Keeper 会每 4 轮自动从聊天提炼新事实写进去，越玩越厚。也可以在世界书管理里手动加。"},
  {q: ["记忆", "memory"], a: "聊天有三层记忆：短期（最近30条）、长期印象、事件簿。抽屉菜单 → 「记忆事件簿」查看。引用记忆时 AI 只能用已列出的内容，不会编造。"},
  {q: ["角色卡", "card", "更新建议"], a: "抽屉菜单 → 「角色卡更新建议」：AI 每 10 轮审计一次，发现角色有持久变化会建议更新卡，每条都要你点接受才生效。"},
  {q: ["矛盾", "continuity", "逻辑"], a: "Continuity Checker 会自动检查每条回复的逻辑矛盾（人物分身/时间错乱/事实打架），发现自动修一次。可在设置里关。"},
  {q: ["穿越", "traverse", "魂穿"], a: "「穿越」tab 可以魂穿进小说世界或导入的角色卡世界。选书→选幕→开局，走原著线或自由发挥。"},
  {q: ["备份", "backup", "导出"], a: "包页有备份/导出功能，剧本包可导出为 JSON。换手机时导入即可恢复。"},
  {q: ["设置", "api", "key", "模型"], a: "「设置」里填 API 地址、Key、模型。蒸馏和聊天都走这里的配置。推荐用兼容 OpenAI 格式的接口。"},
];

function searchKB(text){
  text = (text || "").toLowerCase();
  for(var i = 0; i < KB.length; i++){
    for(var j = 0; j < KB[i].q.length; j++){
      if(text.indexOf(KB[i].q[j].toLowerCase()) >= 0) return KB[i].a;
    }
  }
  return null;
}

/* 系统 prompt */
function systemPrompt(){
  return "你是浮生 App 的内置小助手，名字叫「浮生小助手」。\n" +
    "你帮用户：讲解 App 功能、回答使用问题、用自然语言帮用户创建东西。\n" +
    "App 功能包括：蒸馏（小说转剧本包）、文风库（作家文风续写）、聊天（角色扮演）、穿越（魂穿小说世界）、世界书、关系管理、记忆系统、Push Story（一键推剧情）。\n" +
    "回答简洁口语化，像朋友聊天。不知道的就说不知道，不要编。\n" +
    "如果用户想创建角色/世界书条目，帮他整理成结构化草稿，用 JSON 格式返回，并问他确认。";
}

/* 快捷 chips */
function chips(){
  return [
    {label: "怎么蒸馏小说？", text: "怎么蒸馏小说？"},
    {label: "文风库怎么用？", text: "文风库怎么用？"},
    {label: "帮我创建个角色", text: "帮我创建一个武侠角色"},
    {label: "Push Story 是什么？", text: "Push Story 是什么？"},
  ];
}

/* 检测创建意图 */
function detectCreateIntent(text){
  text = text || "";
  if(/创建.*角色|新建.*角色|写.*角色卡/.test(text)) return "character";
  if(/创建.*世界书|加.*世界书|新建.*条目/.test(text)) return "lorebook";
  return null;
}

var history = [];

function getHistory(){ return history; }
function clearHistory(){ history = []; }

async function chat(text, cfg, callChat){
  var kbAnswer = searchKB(text);
  history.push({role: "user", content: text});

  // 知识库命中直接回
  if(kbAnswer && !detectCreateIntent(text)){
    history.push({role: "assistant", content: kbAnswer});
    return {text: kbAnswer, fromKB: true};
  }

  // 创建意图：引导式创建
  var intent = detectCreateIntent(text);
  if(intent === "character"){
    var draft = await guideCharacterCreate(text, cfg, callChat);
    history.push({role: "assistant", content: draft});
    return {text: draft, fromKB: false, action: "character_draft"};
  }
  if(intent === "lorebook"){
    var lore = await guideLorebookCreate(text, cfg, callChat);
    history.push({role: "assistant", content: lore});
    return {text: lore, fromKB: false, action: "lorebook_draft"};
  }

  // 走 LLM
  var msgs = [{role: "system", content: systemPrompt()}]
    .concat(history.slice(-10));
  try{
    var r = await callChat(cfg, msgs, 0.7);
    history.push({role: "assistant", content: r});
    return {text: r, fromKB: false};
  }catch(e){
    var fallback = kbAnswer || "抱歉，我现在连不上 AI。试试问我功能用法，我内置了常见问答。";
    history.push({role: "assistant", content: fallback});
    return {text: fallback, fromKB: !!kbAnswer};
  }
}

/* 引导式角色创建 */
async function guideCharacterCreate(text, cfg, callChat){
  try{
    var r = await callChat(cfg, [
      {role: "system", content:
        "用户想创建一个角色。根据他的描述，生成角色卡草稿。\n" +
        "返回 JSON: {\"name\": \"名字\", \"core_traits\": \"核心性格\", " +
        "\"speech_style\": \"说话风格\", \"background\": \"背景故事\", \"appearance\": \"外貌\"}\n" +
        "只返回 JSON。"},
      {role: "user", content: text}
    ], 0.7);
    var m = r.match(/\{[\s\S]*\}/);
    if(!m) return "我没理解清楚，能多描述一下这个角色吗？比如名字、性格、背景。";
    var card = JSON.parse(m[0]);
    return "我帮你拟了个角色草稿：\n\n" +
      "名字：" + (card.name || "未定") + "\n" +
      "性格：" + (card.core_traits || "") + "\n" +
      "说话风格：" + (card.speech_style || "") + "\n" +
      "背景：" + (card.background || "") + "\n\n" +
      "满意吗？去「写卡」tab 可以继续完善。";
  }catch(e){
    return "创建时出了点问题，换个描述试试？";
  }
}

/* 引导式世界书创建 */
async function guideLorebookCreate(text, cfg, callChat){
  try{
    var r = await callChat(cfg, [
      {role: "system", content:
        "用户想创建一条世界书。提炼成结构化条目。\n" +
        "返回 JSON: {\"title\": \"标题\", \"keys\": [\"触发词\"], \"content\": \"内容描述\"}\n" +
        "只返回 JSON。"},
      {role: "user", content: text}
    ], 0.7);
    var m = r.match(/\{[\s\S]*\}/);
    if(!m) return "能具体说说这条世界书的内容吗？";
    var entry = JSON.parse(m[0]);
    return "世界书草稿：\n\n" +
      "标题：" + (entry.title || "") + "\n" +
      "触发词：" + (entry.keys || []).join("、") + "\n" +
      "内容：" + (entry.content || "") + "\n\n" +
      "去「更多」→「管理世界书」可以手动添加。";
  }catch(e){
    return "创建时出了点问题，换个描述试试？";
  }
}

return {
  chat: chat,
  chips: chips,
  getHistory: getHistory,
  clearHistory: clearHistory,
  searchKB: searchKB,
  detectCreateIntent: detectCreateIntent
};
})();
