/* RP_SCOPE (2026-10-15): runId 命名空间。
 *
 * 蒸馏 run 的 runId 就是一部书(如 honglou_full / shuihu_full), 每个 runId 天然
 * 隔离, 后缀恒为空串, 存储键保持 "前缀 + runId" 原样。
 *
 * 导入卡全部共用 runId === "imported": 用户世界书(nd_lore_*)和动态关系
 * (nd_rel_dyn_*)如果只按 runId 建键, 所有导入卡会共用一个池子 —— 在 A 卡里写的
 * 条目会泄漏进 B 卡的 prompt。所以 imported 必须再挂一个卡 id 段。
 *
 * 老版本(2026-10-15 之前)所有导入卡共用 nd_lore_imported / nd_rel_dyn_imported。
 * 为不丢用户数据: 新键读不到时回落旧共享键; 写入只写新键。新键一旦存在就是权威
 * (哪怕是空数组), 否则用户在卡 A 里删干净的条目会被旧池复活。
 */
var RP_SCOPE = (function(){
"use strict";

/* 命名空间后缀: 蒸馏 run 恒为 ""; imported 挂 "_<卡id>"。
   卡查不到(卡被删/名字对不上)时退化用角色名, 仍能按卡隔离;
   连名字都没有时返回 "", 键退回旧共享池, 老数据不丢。 */
function suffix(runId, name){
  if(runId !== "imported") return "";
  var id = "";
  try{
    var c = (typeof RP_CARDIMPORT !== "undefined") && RP_CARDIMPORT.find(name);
    if(c) id = String(c.id == null ? "" : c.id);
  }catch(e){}
  if(!id && name != null) id = String(name);
  return id ? "_" + id : "";
}

/* 存储键: prefix + runId + 后缀 */
function key(prefix, runId, name){ return prefix + runId + suffix(runId, name); }

/* 该 runId 的旧共享键(只有 imported 有); 非 imported 返回 null */
function legacyKey(prefix, runId){ return runId === "imported" ? prefix + runId : null; }

/* 读: 新键优先, 新键不存在才回落旧共享键 */
function read(cur, legacy){
  var raw = null;
  try{ raw = localStorage.getItem(cur); }catch(e){}
  if(raw == null && legacy && legacy !== cur){ try{ raw = localStorage.getItem(legacy); }catch(e){} }
  try{ return JSON.parse(raw || "[]") || []; }catch(e){ return []; }
}

/* 写: 只写新键 */
function write(cur, arr){ localStorage.setItem(cur, JSON.stringify(arr)); }

/* 读+回落一步到位 */
function readKeyed(prefix, runId, name){ return read(key(prefix, runId, name), legacyKey(prefix, runId)); }
function writeKeyed(prefix, runId, name, arr){ write(key(prefix, runId, name), arr); }

return {suffix: suffix, key: key, legacyKey: legacyKey,
        read: read, write: write, readKeyed: readKeyed, writeKeyed: writeKeyed};
})();