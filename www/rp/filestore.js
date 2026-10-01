/* NDFILE：大文件本地存储前端封装。
 * 真机（Android WebView）走原生桥接 Android.ndFile*，数据落在 App 私有目录
 * files/ndblob/，只受磁盘空间限制，本模块与原生侧共同执行 2GB 配额。
 * 桌面浏览器 / Node 测试环境无桥接时 SUPPORTED() 为 false，调用方回退 IndexedDB。
 * 桥接方法同步返回（跑在 JavaBridge 线程），这里包一层 Promise 统一异步接口。
 */
var NDFILE = (function(){
"use strict";

var QUOTA = 2 * 1024 * 1024 * 1024; /* 2GB：与 MainActivity.ND_BLOB_QUOTA 一致 */

function bridge(){
  try{
    if(typeof Android !== "undefined" && Android &&
       typeof Android.ndFileWrite === "function") return Android;
  }catch(e){}
  return null;
}
function SUPPORTED(){ return !!bridge(); }

function setItem(key, value){
  var br = bridge();
  if(!br) return Promise.reject(new Error("no-bridge"));
  var k = String(key), v = String(value == null ? "" : value);
  return new Promise(function(resolve, reject){
    var r;
    try{ r = br.ndFileWrite(k, v); }
    catch(e){ reject(new Error("io")); return; }
    if(r === "ok") resolve("ok");
    else if(r === "err:quota") reject(new Error("quota"));
    else reject(new Error("io"));
  });
}
function getItem(key){
  var br = bridge();
  if(!br) return Promise.resolve(null);
  return new Promise(function(resolve){
    var r = null;
    try{ r = br.ndFileRead(String(key)); }catch(e){ r = null; }
    resolve(r == null ? null : String(r));
  });
}
function removeItem(key){
  var br = bridge();
  if(!br) return Promise.resolve(false);
  return new Promise(function(resolve){
    var r = false;
    try{ r = !!br.ndFileDelete(String(key)); }catch(e){ r = false; }
    resolve(r);
  });
}
/* 同步读：桥接本身是同步返回（JavaBridge 线程），仅供冷启动关键路径
 * （如 getSync）在内存镜像未预热时一次性补读，避免异步竞态。 */
function getItemSync(key){
  var br = bridge();
  if(!br) return null;
  try{
    var r = br.ndFileRead(String(key));
    return (r == null) ? null : String(r);
  }catch(e){ return null; }
}
/* 清空整个文件区：不依赖 localStorage 标记（wipe 时标记可能已被删），直接删目录下所有文件 */
function clearAll(){
  var br = bridge();
  if(!br) return Promise.resolve(false);
  return new Promise(function(resolve){
    try{
      if(typeof br.ndFileClear === "function"){ resolve(!!br.ndFileClear()); return; }
      /* 老版本桥接无 ndFileClear：退化为逐个删除 */
      var s = br.ndFileList(), a = [];
      try{ a = JSON.parse(s) || []; }catch(e){ a = []; }
      var ok = true;
      for(var i = 0; i < a.length; i++){ try{ if(!br.ndFileDelete(a[i])) ok = false; }catch(e){ ok = false; } }
      resolve(ok);
    }catch(e){ resolve(false); }
  });
}
/* 文件区总字节数；无桥接返回 -1 */
function totalBytes(){
  var br = bridge();
  if(!br) return -1;
  try{
    var n = br.ndFileTotal();
    return (typeof n === "number" && n >= 0) ? n : -1;
  }catch(e){ return -1; }
}
function listKeys(){
  var br = bridge();
  if(!br) return [];
  try{
    var s = br.ndFileList();
    var a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  }catch(e){ return []; }
}

return {
  QUOTA: QUOTA,
  SUPPORTED: SUPPORTED,
  setItem: setItem,
  getItem: getItem,
  getItemSync: getItemSync,
  removeItem: removeItem,
  clearAll: clearAll,
  totalBytes: totalBytes,
  listKeys: listKeys
};
})();
