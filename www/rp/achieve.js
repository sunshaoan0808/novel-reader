/* ============ P1-6: 轻量本地成就 ============
 * 无数值、无排行。unlock(id) 幂等, 存 localStorage.nd_achv。
 * 首次解锁返回 true(调用方弹 toast), 已解锁返回 false。 */
const RP_ACHV = (function(){
"use strict";
var STORE = "nd_achv";
var DEFS = [
{id:"first_chat", name:"初次相遇", desc:"完成第一次 AI 对话", icon:"chat"},
{id:"tts_1",      name:"聆听者",   desc:"播放一条 AI 语音", icon:"volume"},
{id:"pin_1",      name:"记忆收藏家", desc:"Pin 一条消息为长期记忆", icon:"pin"},
{id:"save_1",     name:"时间旅人", desc:"创建第一个平行存档", icon:"save"},
{id:"branch_1",   name:"平行世界", desc:"从存档分出一条新分支", icon:"repeat"},
{id:"card_1",     name:"造物主",   desc:"生成或导入第一张角色卡", icon:"user"},
{id:"lore_1",     name:"世界建筑师", desc:"创建一条世界书", icon:"book-open"},
{id:"traverse_1", name:"穿越者",   desc:"完成一次穿越开局", icon:"scroll"},
{id:"plotline_1", name:"循线者",   desc:"走完一幕原著剧情线", icon:"clapperboard"},
{id:"edit_1",     name:"精雕细琢", desc:"编辑一条聊天消息", icon:"edit"},
{id:"swipe_1",    name:"再来一次", desc:"使用重生/换一条回答", icon:"dice"},
];
function load(){
  try{ var m = JSON.parse(localStorage.getItem(STORE)); return (m && typeof m === "object") ? m : {}; }
  catch(e){ return {}; }
}
function save(m){ try{ localStorage.setItem(STORE, JSON.stringify(m)); }catch(e){} }
function defOf(id){
  for(var i = 0; i < DEFS.length; i++) if(DEFS[i].id === id) return DEFS[i];
  return null;
}
function unlock(id){
  if(!defOf(id)) return false;
  var m = load();
  if(m[id]) return false;
  m[id] = Date.now();
  save(m);
  return true;
}
function has(id){ return !!load()[id]; }
function list(){
  var m = load();
  return DEFS.map(function(d){
    return {id:d.id, name:d.name, desc:d.desc, icon:d.icon, unlocked:!!m[d.id], ts:m[d.id]||0};
  });
}
function count(){
  var m = load(), n = 0;
  DEFS.forEach(function(d){ if(m[d.id]) n++; });
  return n;
}
return {DEFS: DEFS, unlock: unlock, has: has, list: list, count: count, STORE: STORE};
})();
