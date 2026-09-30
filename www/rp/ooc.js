/* RP 引擎 v2: OOC 检测（正则+词表，零成本）
 * 检测面：自称 AI/模型 ｜ 替用户行动 ｜ 时代泄漏 ｜ 身份冲突
 */
const RP_OOC = (function(){
"use strict";
var MODERN_WORDS = ["手机","电话","电脑","互联网","上网","飞机","汽车","火车",
  "微信","短信","电视","电影","APP","app","游戏机","电梯","空调"];

var RULES = [
  {id: "self-ai",    re: /作为.{0,6}AI/, reason: "自称 AI"},
  {id: "self-model", re: /我是.{0,8}(大语言模型|语言模型|人工智能)/, reason: "自称模型"},
  {id: "self-model2",re: /作为一个(语言)?模型/, reason: "自称模型"},
  {id: "training",   re: /我的(训练|知识截止)/, reason: "提及训练"},
  {id: "user-action",re: /你(说道|说罢|心想|暗想|转身|起身|点点头|摇摇头|笑(道|了笑))/,
   reason: "替用户行动/说话"},
  {id: "ooc-tag",    re: /[（(].{0,12}(出戏|ooc)[)）]/i, reason: "OOC 标记"},
];

function check(text, cardName){
  var i, m;
  for(i = 0; i < RULES.length; i++){
    if(RULES[i].re.test(text)) return {id: RULES[i].id, reason: RULES[i].reason};
  }
  for(i = 0; i < MODERN_WORDS.length; i++){
    if(text.indexOf(MODERN_WORDS[i]) >= 0)
      return {id: "modern-leak", reason: "时代泄漏（" + MODERN_WORDS[i] + "）"};
  }
  if(cardName && /我是(林黛玉|贾宝玉|薛宝钗|王熙凤)/.test(text)){
    m = text.match(/我是(.{2,4})/);
    if(m && m[1] !== cardName) return {id: "identity", reason: "身份冲突（自称" + m[1] + "）"};
  }
  return null;
}

return {check: check, RULES: RULES};
})();
