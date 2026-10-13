/* 统一"写入失败"用户可见提示 (P1-8)。
 * 此前各模块 localStorage.setItem 失败被 catch(e){} 静默吞掉 → 配额满即永久丢数据无提示。
 * 本工具优先 rpToast 轻提示，降级 console.warn，绝不抛错（提示本身不能打断业务）。 */
var RP_WARN = (function(){
  function isQuota(e){
    if(!e) return false;
    var n = e.name || "", c = e.code;
    return n === "QuotaExceededError" || n === "NS_ERROR_DOM_QUOTA_REACHED" ||
           c === 22 || c === 1014;
  }
  /* msg 可选：给业务专属文案；缺省用通用文案 */
  function saveFail(msg, e){
    var text = msg || (isQuota(e) ? "存储空间已满，保存失败" : "保存失败");
    try{ if(typeof window !== "undefined" && typeof window.rpToast === "function"){ window.rpToast(text); return; } }catch(e1){}
    try{ if(typeof console !== "undefined" && console.warn) console.warn("[save-fail]", text, e); }catch(e2){}
  }
  return { saveFail: saveFail, isQuota: isQuota };
})();
if(typeof module !== "undefined" && module.exports) module.exports = RP_WARN;
