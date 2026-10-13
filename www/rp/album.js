/* 专辑（P2）：玩家自建卡片合集（歌单模式），纯本地。
 * 数据只存本机 localStorage["nd_albums_v1"] = [{id,name,cards:[{runId,name}],createdAt,updatedAt}]。
 * 导出为 JSON（含导入/自创卡的完整卡片数据，内置卡只存引用）；可导入。
 */
var RP_ALBUM = (function(){
"use strict";
var KEY = "nd_albums_v1";
function load(){
  try{ var d = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(d) ? d : []; }
  catch(e){ return []; }
}
function save(a){ try{ localStorage.setItem(KEY, JSON.stringify(a)); }
catch(e){ typeof RP_WARN!=="undefined"&&RP_WARN.saveFail("记忆事件簿保存失败", e); } }
function uid(){ return "alb" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function list(){ return load(); }
function get(id){
  var a = load();
  for(var i = 0; i < a.length; i++) if(a[i].id === id) return a[i];
  return null;
}
function create(name){
  var a = load();
  var alb = {id: uid(), name: String(name == null ? "" : name).trim().slice(0, 24) || "未命名专辑",
    cards: [], createdAt: Date.now(), updatedAt: Date.now()};
  a.push(alb); save(a);
  return alb;
}
function rename(id, name){
  var a = load(), ok = false;
  a.forEach(function(alb){
    if(alb.id === id){ alb.name = String(name == null ? "" : name).trim().slice(0, 24) || alb.name; alb.updatedAt = Date.now(); ok = true; }
  });
  if(ok) save(a);
  return ok;
}
function remove(id){ save(load().filter(function(a){ return a.id !== id; })); }
function addCard(albumId, runId, name){
  var a = load(), added = false;
  a.forEach(function(alb){
    if(alb.id !== albumId) return;
    var dup = alb.cards.some(function(c){ return c.runId === runId && c.name === name; });
    if(!dup){ alb.cards.push({runId: runId, name: name}); alb.updatedAt = Date.now(); added = true; }
  });
  if(added) save(a);
  return added;
}
function removeCard(albumId, runId, name){
  var a = load(), changed = false;
  a.forEach(function(alb){
    if(alb.id !== albumId) return;
    var n = alb.cards.length;
    alb.cards = alb.cards.filter(function(c){ return !(c.runId === runId && c.name === name); });
    if(alb.cards.length !== n){ alb.updatedAt = Date.now(); changed = true; }
  });
  if(changed) save(a);
  return changed;
}
/* 取卡片完整数据（导出用）：导入/自创卡带全量，内置卡只存引用 */
function fullCard(runId, name){
  try{
    if(runId === "imported" && typeof RP_CARDIMPORT !== "undefined"){
      var ic = RP_CARDIMPORT.find(name);
      if(ic) return {runId: "imported", card: ic};
    }
    if(runId === "custom" && typeof RP_WRITER !== "undefined"){
      var cc = RP_WRITER.findCustom(name);
      if(cc) return {runId: "custom", card: cc};
    }
  }catch(e){}
  return {runId: runId, ref: {runId: runId, name: name}};
}
function exportData(id){
  var alb = get(id);
  if(!alb) return null;
  return {app: "浮生", kind: "album", version: 1,
    album: {name: alb.name, createdAt: alb.createdAt},
    cards: alb.cards.map(function(c){ return fullCard(c.runId, c.name); })};
}
/* 导入：建专辑 + 落卡（导入卡去重按名，自创卡同理，内置引用直接收录） */
function importData(obj){
  if(!obj || obj.kind !== "album" || !obj.album) throw new Error("不是有效的专辑文件");
  var alb = create(obj.album.name || "导入的专辑");
  var added = 0, skipped = 0;
  (obj.cards || []).forEach(function(entry){
    if(!entry) return;
    try{
      if(entry.card && entry.runId === "imported" && typeof RP_CARDIMPORT !== "undefined"){
        var nm = entry.card.name;
        if(!RP_CARDIMPORT.find(nm)){ RP_CARDIMPORT.add(entry.card); }
        if(addCard(alb.id, "imported", nm)) added++; else skipped++;
      }else if(entry.card && entry.runId === "custom" && typeof RP_WRITER !== "undefined"){
        var cn = entry.card.name;
        var list = RP_WRITER.getCustomChars();
        if(!list.some(function(c){ return c.name === cn; })){ list.push(entry.card); RP_WRITER.saveCustomChars(list); }
        if(addCard(alb.id, "custom", cn)) added++; else skipped++;
      }else if(entry.ref && entry.ref.name){
        if(addCard(alb.id, entry.ref.runId, entry.ref.name)) added++; else skipped++;
      }else skipped++;
    }catch(e){ skipped++; }
  });
  return {albumId: alb.id, added: added, skipped: skipped};
}
return {
  list: list, get: get, create: create, rename: rename, remove: remove,
  addCard: addCard, removeCard: removeCard, exportData: exportData, importData: importData
};
})();
