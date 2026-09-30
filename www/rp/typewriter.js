/* RP 打字机效果逻辑（纯逻辑层，不做 DOM 操作）
 * AI 回复逐字流式渲染：App 目前是非流式续写（一次拿到全文），
 * 打字机视为「逐字揭示动画」，渲染驱动由集成者实现。
 * 浏览器 / Node 双环境兼容。
 */
var RP_TYPEWRITER = (function(){
"use strict";

var CFG_KEY = "nd_rp_cfg_v1";

/* 中日韩字符判定（用于分段策略） */
var CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯　-〿]/;

function _readCfg(){
  try{
    var raw = localStorage.getItem(CFG_KEY);
    if(!raw) return {};
    var o = JSON.parse(raw);
    return (o && typeof o === "object") ? o : {};
  }catch(e){ return {}; }
}

/* 设置：打字机开关，缺省 true（默认开） */
function enabled(){
  return _readCfg().typewriter !== false;
}

function setEnabled(v){
  var c = _readCfg();
  c.typewriter = !!v;
  try{ localStorage.setItem(CFG_KEY, JSON.stringify(c)); }catch(e){}
  return !!v;
}

/* reduce motion 偏好；Node 等无 matchMedia 环境返回 false */
function reducedMotion(){
  try{
    return typeof matchMedia !== "undefined" &&
      !!matchMedia("(prefers-reduced-motion: reduce)").matches;
  }catch(e){ return false; }
}

/* 是否做打字机动画。可注入 cfg={enabled, reducedMotion} 做纯逻辑测试 */
function shouldAnimate(cfg){
  if(cfg && typeof cfg === "object"){
    var en = (cfg.enabled === undefined) ? enabled() : !!cfg.enabled;
    var rm = (cfg.reducedMotion === undefined) ? reducedMotion() : !!cfg.reducedMotion;
    return en && !rm;
  }
  return enabled() && !reducedMotion();
}

/* 把文本切成动画帧用的片段数组（纯函数）。
 * 中文按 3 字一段、英文按词切分（长词再按 4 切开）、空白独立成段；
 * 全程 Array.from 按代码点切分，emoji / 代理对不会被切断；
 * 每段不超过 4 个「字」（代码点）。 */
function chunkText(text){
  var s = String(text == null ? "" : text);
  var out = [];
  var parts = s.split(/(\s+)/);
  for(var p = 0; p < parts.length; p++){
    var seg = parts[p];
    if(!seg) continue;
    if(/^\s+$/.test(seg)){ out.push(seg); continue; }
    var cps = Array.from(seg);
    var size = 3;
    for(var i = 0; i < cps.length; i++){
      if(!CJK_RE.test(cps[i])){ size = 4; break; }
    }
    for(var j = 0; j < cps.length; j += size){
      out.push(cps.slice(j, j + size).join(""));
    }
  }
  return out;
}

/* 返回每一帧的累计文本数组（驱动渲染用，纯函数）。
 * 短文（<=60 字）逐字一帧；长文按目标 ~110 帧摊开，
 * 2000 字约 106 帧（每帧约 19 字），保证帧数合理。 */
function progressFrames(text){
  var s = String(text == null ? "" : text);
  var cps = Array.from(s);
  var n = cps.length;
  if(n === 0) return [""];
  var per = n <= 60 ? 1 : Math.max(4, Math.ceil(n / 110));
  var frames = [];
  for(var i = per; i < n; i += per){
    frames.push(cps.slice(0, i).join(""));
  }
  frames.push(s);
  return frames;
}

return {
  CFG_KEY: CFG_KEY,
  enabled: enabled,
  setEnabled: setEnabled,
  reducedMotion: reducedMotion,
  shouldAnimate: shouldAnimate,
  chunkText: chunkText,
  progressFrames: progressFrames
};
})();
