/* Soul UX 扩展 (100条挖掘 F组 76-90)
 * 头像/颜色/分组/状态/指令/语音/名片/手势/主题/字号/搜索/提醒/公告/心情/静音 */

var RP_SOUL_UX = (function(){
"use strict";

function _store(k, v){
  try{
    if(v === undefined) return localStorage.getItem(k);
    if(v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }catch(e){ return null; }
}
function _uk(name){ return "nd_soulux_" + name; }

/* 76. Soul 头像 (emoji) */
function setAvatar(name, emoji){ _store(_uk("avatar_" + name), emoji); }
function getAvatar(name){ return _store(_uk("avatar_" + name)) || "🎭"; }

/* 77. 颜色标识 */
var COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#e67e22", "#34495e"];
function setColor(name, color){ _store(_uk("color_" + name), color); }
function getColor(name){
  var c = _store(_uk("color_" + name));
  if(c) return c;
  /* 按名字 hash 分配 */
  var h = 0;
  for(var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % COLORS.length;
  return COLORS[h];
}

/* 78. 气泡分组: 按 soul 分组消息 (数据处理) */
function groupBySoul(messages){
  var groups = [], cur = null;
  (messages || []).forEach(function(m){
    var s = m.speaker || (m.role === "user" ? "user" : "ai");
    if(!cur || cur.soul !== s){
      cur = {soul: s, messages: []};
      groups.push(cur);
    }
    cur.messages.push(m);
  });
  return groups;
}

/* 79. 在线状态 */
var _status = {};
function setStatus(name, st){ _status[name] = {state: st, t: Date.now()}; }
function getStatus(name){
  var s = _status[name];
  if(!s) return "idle";
  /* 30秒前的 thinking 视为过期 */
  if(s.state === "thinking" && Date.now() - s.t > 30000) return "idle";
  return s.state;
}
function statusText(name){
  var s = getStatus(name);
  return s === "thinking" ? "思考中…" : (s === "typing" ? "输入中…" : "");
}

/* 80. 快捷指令解析 */
var COMMANDS = {
  "/总结": "summarize", "/回放": "replay", "/静音": "muteall",
  "/投票": "vote", "/分支": "branch", "/帮助": "help"
};
function parseCommand(text){
  var t = String(text || "").trim();
  for(var k in COMMANDS){
    if(t.indexOf(k) === 0) return {cmd: COMMANDS[k], arg: t.slice(k.length).trim()};
  }
  return null;
}
function helpText(){
  return "快捷指令:\n/总结 - 生成群聊摘要\n/回放 - 重播最近10轮\n/静音 - 静音所有 soul\n/投票 主题 - 发起投票\n/分支 名称 - 创建分支\n/帮助 - 显示此帮助";
}

/* 81. 语音音色映射 (per-soul) */
function setVoice(name, voiceId){ _store(_uk("voice_" + name), voiceId); }
function getVoice(name){ return _store(_uk("voice_" + name)) || ""; }

/* 82. 名片数据 */
function cardData(name, soul){
  return {
    name: name,
    avatar: getAvatar(name),
    color: getColor(name),
    status: statusText(name),
    health: (function(){
      try{
        if(typeof RP_SOUL_DATA !== "undefined" && soul && soul._card)
          return RP_SOUL_DATA.soulHealth(soul._card).score;
      }catch(e){}
      return 0;
    })()
  };
}

/* 83. 手势: 滑动方向 -> 动作 */
function gestureAction(dx, dy){
  if(Math.abs(dx) < 30 && Math.abs(dy) < 30) return null;
  if(Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "next_soul" : "prev_soul";
  return dy > 0 ? "scroll_down" : "scroll_up";
}

/* 84. 深色模式: soul 颜色在深色下的调整 */
function adaptColor(color, dark){
  if(!dark) return color;
  /* 简单提亮 */
  return color; /* 实际由 CSS 变量处理, 保留接口 */
}
function isDarkMode(){
  try{ return document.body.classList.contains("dark") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches; }
  catch(e){ return false; }
}

/* 85. 字号 per-soul */
function setFontSize(name, size){ _store(_uk("font_" + name), String(size)); }
function getFontSize(name){
  var v = parseInt(_store(_uk("font_" + name)) || "0");
  return v || 0; /* 0 = 跟随全局 */
}

/* 86. Soul 搜索: 在成员里找 */
function searchSoul(members, keyword){
  var kw = String(keyword || "").toLowerCase();
  return (members || []).filter(function(m){
    return String(m).toLowerCase().indexOf(kw) >= 0;
  });
}

/* 87. 未读提醒: soul @用户 */
var _mentions = [];
function mention(soulName, text){
  _mentions.push({soul: soulName, text: String(text).slice(0, 100), t: new Date().toISOString()});
  if(_mentions.length > 20) _mentions.shift();
}
function getMentions(){ return _mentions.slice().reverse(); }
function clearMentions(){ _mentions = []; }
function unreadCount(){ return _mentions.length; }

/* 88. 公告栏 */
function setNotice(chatId, text){
  _store("nd_soulnotice_" + chatId, String(text).slice(0, 500));
}
function getNotice(chatId){ return _store("nd_soulnotice_" + chatId) || ""; }
function clearNotice(chatId){ _store("nd_soulnotice_" + chatId, null); }

/* 89. 心情指示器 */
var MOODS = {"开心": "😊", "难过": "😢", "生气": "😠", "平静": "😐", "兴奋": "🤩", "疲惫": "😩"};
function setMoodIcon(name, mood){ _store(_uk("mood_" + name), mood); }
function getMoodIcon(name){
  var m = _store(_uk("mood_" + name)) || "平静";
  return MOODS[m] || "😐";
}
function moodList(){ return Object.keys(MOODS); }

/* 90. 一键静音所有 */
function muteAll(chatId, members){
  try{
    if(typeof RP_SOUL_GROUP !== "undefined"){
      (members || []).forEach(function(m){ RP_SOUL_GROUP.mute(chatId, m); });
      return true;
    }
  }catch(e){}
  return false;
}
function unmuteAll(chatId, members){
  try{
    if(typeof RP_SOUL_GROUP !== "undefined"){
      (members || []).forEach(function(m){ RP_SOUL_GROUP.unmute(chatId, m); });
      return true;
    }
  }catch(e){}
  return false;
}

return {
  setAvatar: setAvatar, getAvatar: getAvatar,
  setColor: setColor, getColor: getColor, COLORS: COLORS,
  groupBySoul: groupBySoul,
  setStatus: setStatus, getStatus: getStatus, statusText: statusText,
  parseCommand: parseCommand, helpText: helpText, COMMANDS: COMMANDS,
  setVoice: setVoice, getVoice: getVoice,
  cardData: cardData,
  gestureAction: gestureAction,
  adaptColor: adaptColor, isDarkMode: isDarkMode,
  setFontSize: setFontSize, getFontSize: getFontSize,
  searchSoul: searchSoul,
  mention: mention, getMentions: getMentions, clearMentions: clearMentions, unreadCount: unreadCount,
  setNotice: setNotice, getNotice: getNotice, clearNotice: clearNotice,
  setMoodIcon: setMoodIcon, getMoodIcon: getMoodIcon, moodList: moodList,
  muteAll: muteAll, unmuteAll: unmuteAll
};
})();
if(typeof window !== "undefined") window.RP_SOUL_UX = RP_SOUL_UX;
if(typeof module !== "undefined") module.exports = RP_SOUL_UX;
