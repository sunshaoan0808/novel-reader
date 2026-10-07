/* 命名主题（P2）：中式意象命名色板，纯本地，默认墨夜（当前视觉，不擅自改全局）
 * - CSS 侧用 [data-theme="..."] 覆盖 :root 变量；JS 只负责切换 + 持久化。
 * - 硬编码色值较多的地方已抽成 --topbar-bg / --glow 变量跟随主题。
 */
var RP_THEME = (function(){
"use strict";
var KEY = "nd_theme_v1";
var THEMES = [
  {id:"moye", name:"墨夜", desc:"默认 · 暗夜底 + 琥珀金，沉浸的原点",
   vars:{
    "--bg":"#12100d","--bg2":"#171411","--card":"#1d1915","--card2":"#23201b",
    "--line":"#2d2720","--line-soft":"#242019",
    "--ink":"#ece4d3","--ink-dim":"#b3a88f","--ink-faint":"#9a917e",
    "--gold":"#d4a24e","--gold-deep":"#a97c2e","--gold-soft":"#f2ddab",
    "--red":"#d07864","--green":"#8fb573",
    "--topbar-bg":"#12100d","--glow":"#1e1913","--nav-bg":"rgba(23,20,17,.92)",
    "--shadow":"0 6px 24px rgba(0,0,0,.45)","--shadow-s":"0 2px 10px rgba(0,0,0,.28)"
   }},
  {id:"songyan", name:"松烟", desc:"松烟入墨 · 青黑底 + 石青，冷峻书卷气",
   vars:{
    "--bg":"#0e1418","--bg2":"#121a20","--card":"#162026","--card2":"#1b2830",
    "--line":"#28363f","--line-soft":"#202b33",
    "--ink":"#e3e9ea","--ink-dim":"#a7b5b9","--ink-faint":"#87959a",
    "--gold":"#7fb0a5","--gold-deep":"#5b8a80","--gold-soft":"#c2ded5",
    "--red":"#c98a7e","--green":"#93b586",
    "--topbar-bg":"#0e1418","--glow":"#14202a","--nav-bg":"rgba(18,26,32,.92)",
    "--shadow":"0 6px 24px rgba(0,0,0,.5)","--shadow-s":"0 2px 10px rgba(0,0,0,.32)"
   }},
  {id:"jiangxia", name:"绛霞", desc:"暮色绛紫 · 黛紫底 + 绛红，浓烈戏剧感",
   vars:{
    "--bg":"#161114","--bg2":"#1b1418","--card":"#211920","--card2":"#271e26",
    "--line":"#392b33","--line-soft":"#2e232b",
    "--ink":"#f0e6e2","--ink-dim":"#bda7a2","--ink-faint":"#99817e",
    "--gold":"#d08a7e","--gold-deep":"#a26357","--gold-soft":"#f2c6b8",
    "--red":"#d07864","--green":"#9db383",
    "--topbar-bg":"#161114","--glow":"#241a20","--nav-bg":"rgba(27,20,24,.92)",
    "--shadow":"0 6px 24px rgba(0,0,0,.5)","--shadow-s":"0 2px 10px rgba(0,0,0,.32)"
   }},
];
function get(){
  try{
    var id = localStorage.getItem(KEY);
    if(id && THEMES.some(function(t){ return t.id === id; })) return id;
  }catch(e){}
  return "moye";
}
function def(id){
  for(var i = 0; i < THEMES.length; i++) if(THEMES[i].id === id) return THEMES[i];
  return THEMES[0];
}
function apply(id){
  id = def(id).id;
  var root = document.documentElement;
  root.setAttribute("data-theme", id);
  var vars = def(id).vars, k;
  for(k in vars){ if(Object.prototype.hasOwnProperty.call(vars, k)) root.style.setProperty(k, vars[k]); }
  try{ localStorage.setItem(KEY, id); }catch(e){}
  return id;
}
function init(){
  /* 尽早执行，避免主题闪烁：脚本在 head 引入 */
  try{ apply(get()); }catch(e){}
}
return {THEMES: THEMES, get: get, def: def, apply: apply, init: init};
})();
