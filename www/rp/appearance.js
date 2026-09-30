/* P2: 外观（聊天壁纸 / 字体）+ 记忆转小说风格模板
 * 纯逻辑层：定义表 + 读写配置 + 小说风格 prompt 生成。DOM 接线在 app.js。
 */
const RP_APPEAR = (function(){
"use strict";

var APPEAR_KEY = "nd_appear_v1";
var NOVEL_STYLE_KEY = "nd_novel_style";

function lsGet(k){
  try{ if(typeof localStorage === "undefined") return null; return localStorage.getItem(k); }catch(e){ return null; }
}
function lsSet(k, v){
  try{ if(typeof localStorage === "undefined") return; localStorage.setItem(k, v); }catch(e){}
}

/* ---- 聊天壁纸：深色友好的古风渐变（CSS 在 style.css 用 body[data-wallpaper] 挂载） ---- */
var WALLPAPERS = [
  {id: "none",    name: "无（默认）"},
  {id: "xuanmo",  name: "玄墨"},
  {id: "daiqing", name: "黛青"},
  {id: "zhejin",  name: "赭金"},
  {id: "zitan",   name: "紫檀"}
];
function validWallpaper(id){
  return WALLPAPERS.some(function(w){ return w.id === id; }) ? id : "none";
}

/* ---- 字体：系统默认 + 本地 serif/kai fallback 栈（不捆绑字体文件） ---- */
var FONTS = [
  {id: "system", name: "系统默认"},
  {id: "song",   name: "宋体（书卷气）"},
  {id: "kai",    name: "楷体（手写感）"}
];
function validFont(id){
  return FONTS.some(function(f){ return f.id === id; }) ? id : "system";
}

function getAppear(){
  var o = {};
  try{ o = JSON.parse(lsGet(APPEAR_KEY)) || {}; }catch(e){ o = {}; }
  return {wallpaper: validWallpaper(o.wallpaper), font: validFont(o.font)};
}
function setAppear(patch){
  var cur = getAppear();
  if(patch && typeof patch.wallpaper !== "undefined") cur.wallpaper = validWallpaper(patch.wallpaper);
  if(patch && typeof patch.font !== "undefined") cur.font = validFont(patch.font);
  lsSet(APPEAR_KEY, JSON.stringify(cur));
  return cur;
}

/* ---- 记忆转小说风格模板：选择后写入 AI 润色 prompt ---- */
var MEMNOVEL_STYLES = {
  plain: {
    name: "白话直叙",
    desc: "现代白话，平实记录发生的事",
    prompt: "请把下面的记忆素材改写成一篇现代白话短篇小说。要求：语言平实直白，按时间顺序叙述；" +
      "保留原文中的关键事实、对话与情绪，不得虚构重大情节；分章节，每章有小标题。"
  },
  gufeng: {
    name: "古风雅致",
    desc: "文言雅致，章回体",
    prompt: "请把下面的记忆素材改写成一篇古风章回体小说。要求：语言雅致，略带文言韵味，" +
      "用「第某回」分回，每回有回目；保留原文中的关键事实、对话与情绪，不得虚构重大情节；" +
      "人物称谓与时代背景保持一致。"
  },
  drama: {
    name: "戏剧化",
    desc: "强冲突，快节奏",
    prompt: "请把下面的记忆素材改写成一篇戏剧化短篇小说。要求：强化冲突与悬念，开头即入戏，节奏明快；" +
      "用场景切换推进，每场有小标题；保留原文中的关键事实与人物关系，不得虚构重大情节；" +
      "情绪张力拉满，但不煽情过度。"
  }
};
function novelStyleKeys(){ return Object.keys(MEMNOVEL_STYLES); }
function getNovelStyle(){
  var k = lsGet(NOVEL_STYLE_KEY);
  return MEMNOVEL_STYLES[k] ? k : "plain";
}
function setNovelStyle(k){
  if(!MEMNOVEL_STYLES[k]) k = "plain";
  lsSet(NOVEL_STYLE_KEY, k);
  return k;
}
/* 风格写入导出 prompt：素材 + 风格指令 */
function novelStylePrompt(styleKey, material){
  var st = MEMNOVEL_STYLES[styleKey] || MEMNOVEL_STYLES.plain;
  return st.prompt + "\n\n记忆素材如下：\n" + String(material || "");
}

return {
  WALLPAPERS: WALLPAPERS, FONTS: FONTS, MEMNOVEL_STYLES: MEMNOVEL_STYLES,
  validWallpaper: validWallpaper, validFont: validFont,
  getAppear: getAppear, setAppear: setAppear,
  novelStyleKeys: novelStyleKeys, getNovelStyle: getNovelStyle,
  setNovelStyle: setNovelStyle, novelStylePrompt: novelStylePrompt
};
})();
