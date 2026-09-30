/* ============ P1-7: 纯前端 PIN 应用锁 ============
 * sha256(pin+salt) 存 localStorage.nd_pin。错 5 次锁定 1 分钟。
 * 忘记 PIN 只能清除全部数据, 无找回途径。 */
const RP_PIN = (function(){
"use strict";
var STORE = "nd_pin";     /* {salt, hash, alg} */
var LOCK = "nd_pinlock";  /* {fails, lockUntil} */
var MAX_FAIL = 5, LOCK_MS = 60000;

function hex(u8){ var s = ""; for(var i = 0; i < u8.length; i++) s += ("0" + u8[i].toString(16)).slice(-2); return s; }
function randHex(n){
  var a = new Uint8Array(n);
  if(typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(a);
  else for(var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
  return hex(a);
}
/* 无 subtle 时的兜底(cyrb53), 优先用 SHA-256 */
function cyrb53(str, seed){
  var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for(var i = 0; i < str.length; i++){
    var ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
async function digest(pin, salt){
  var msg = pin + ":" + salt;
  try{
    if(typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest){
      var d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
      return {hash: hex(new Uint8Array(d)), alg: "sha256"};
    }
  }catch(e){}
  return {hash: cyrb53(msg, 0x9e37) + cyrb53(msg, 0x7f4a), alg: "cyrb53"};
}
function load(){ try{ return JSON.parse(localStorage.getItem(STORE)) || null; }catch(e){ return null; } }
function lockState(){ try{ return JSON.parse(localStorage.getItem(LOCK)) || {fails: 0, lockUntil: 0}; }catch(e){ return {fails: 0, lockUntil: 0}; } }
function saveLock(s){ try{ localStorage.setItem(LOCK, JSON.stringify(s)); }catch(e){} }

return {
  STORE: STORE,
  MAX_FAIL: MAX_FAIL, LOCK_MS: LOCK_MS,
  has: function(){ return !!load(); },
  alg: function(){ var r = load(); return r ? r.alg : null; },
  validPin: function(pin){ return /^\d{4}$/.test(String(pin || "")); },
  set: async function(pin){
    if(!this.validPin(pin)) throw new Error("PIN 必须是 4 位数字");
    var salt = randHex(16);
    var r = await digest(String(pin), salt);
    try{ localStorage.setItem(STORE, JSON.stringify({salt: salt, hash: r.hash, alg: r.alg})); }
    catch(e){ throw new Error("存储失败"); }
    saveLock({fails: 0, lockUntil: 0});
  },
  clear: function(){
    try{ localStorage.removeItem(STORE); }catch(e){}
    saveLock({fails: 0, lockUntil: 0});
  },
  verify: async function(pin){
    var rec = load(); if(!rec) return false;
    var r = await digest(String(pin), rec.salt);
    return r.hash === rec.hash;
  },
  /* 锁定剩余毫秒, 0 表示未锁定 */
  lockRemain: function(){ var s = lockState(); return Math.max(0, (s.lockUntil || 0) - Date.now()); },
  failsLeft: function(){ var s = lockState(); return Math.max(0, MAX_FAIL - (s.fails || 0)); },
  /* 记录一次失败; 返回 {locked, left} */
  fail: function(){
    var s = lockState(); s.fails = (s.fails || 0) + 1;
    if(s.fails >= MAX_FAIL){ s.lockUntil = Date.now() + LOCK_MS; s.fails = 0; }
    saveLock(s);
    return {locked: s.lockUntil > Date.now(), left: Math.max(0, MAX_FAIL - s.fails)};
  },
  resetFails: function(){ saveLock({fails: 0, lockUntil: 0}); }
};
})();
