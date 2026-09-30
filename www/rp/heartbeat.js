/* 可编辑 heartbeat 主动消息（对标星野 heartbeat.md + 频率档）
 * 配置面：检查事项可编辑（默认 3 条）、频率档 低/中/高/极高（对应检查间隔 30/15/8/4 轮）。
 * 执行面保守：只在 App 前台生效——手动点"检查一次"，或用户消息轮次到达间隔时触发一次
 * LLM 检查（用便宜模型：心跳专用模型 > 摘要模型 > 主模型）。不做后台 WorkManager，
 * 设置页如实标注"仅前台生效，后台不执行"。
 * 存储：nd_hb_cfg（localStorage，小 JSON）。
 */
var RP_HB = (function(){
"use strict";

var KEY = "nd_hb_cfg";

var FREQS = {
  low:     {name: "低",   rounds: 30},
  mid:     {name: "中",   rounds: 15},
  high:    {name: "高",   rounds: 8},
  extreme: {name: "极高", rounds: 4},
};

var DEFAULT_ITEMS = [
  "角色是否会主动开启话题",
  "角色是否有没说出口的关心或疑问",
  "当前场景是否有值得角色主动推进的变化",
];

function defaults(){
  return {
    enabled: false,
    freq: "mid",
    items: DEFAULT_ITEMS.slice(),
    model: "",
    roundsSince: 0,
    lastCheck: 0,
    log: [],
  };
}

function getCfg(){
  var c = defaults();
  try{
    var o = JSON.parse(localStorage.getItem(KEY) || "null");
    if(o && typeof o === "object"){
      if(typeof o.enabled === "boolean") c.enabled = o.enabled;
      if(o.freq && FREQS[o.freq]) c.freq = o.freq;
      if(Array.isArray(o.items) && o.items.length)
        c.items = o.items.map(function(x){ return String(x); }).filter(function(x){ return x.trim(); });
      if(typeof o.model === "string") c.model = o.model;
      if(typeof o.roundsSince === "number") c.roundsSince = Math.max(0, Math.floor(o.roundsSince));
      if(typeof o.lastCheck === "number") c.lastCheck = o.lastCheck;
      if(Array.isArray(o.log)) c.log = o.log.slice(-10);
    }
  }catch(e){}
  if(!c.items.length) c.items = DEFAULT_ITEMS.slice();
  return c;
}

function saveCfg(c){
  c = c || defaults();
  try{
    localStorage.setItem(KEY, JSON.stringify({
      enabled: !!c.enabled, freq: c.freq, items: c.items, model: c.model || "",
      roundsSince: c.roundsSince || 0, lastCheck: c.lastCheck || 0,
      log: (c.log || []).slice(-10),
    }));
  }catch(e){}
}

/* 频率档对应的检查间隔（轮） */
function intervalOf(freq){ return (FREQS[freq] || FREQS.mid).rounds; }

/* 构建检查 prompt：给最近对话 + 检查事项，要求只输出 JSON */
function renderPrompt(items, historyText, charName){
  var lines = (items || []).map(function(x, i){ return (i + 1) + ". " + x; }).join("\n");
  return "你是" + (charName || "某角色") + "的心跳检查器（只在 App 前台运行的心跳，不做后台推送）。"
    + "请根据最近的对话，逐条回答下面的检查事项，判断 TA 此刻是否想主动对玩家说点什么。\n"
    + "检查事项：\n" + lines + "\n\n"
    + "最近对话（由旧到新）：\n" + (historyText || "（暂无）") + "\n\n"
    + "只输出一个 JSON，无其他文字：\n"
    + '{"need":true/false,"message":"若 need 为 true，写出角色想主动说的一句话（符合人设、简短自然、不超过60字）；否则为空字符串"}';
}

/* 从最近聊天记录取对话文本（由旧到新，最多 10 条） */
function historyTextOf(hist){
  return (hist || []).slice(-10).map(function(m){
    var who = m.role === "user" ? "玩家" : (m.speaker || "角色");
    return who + "：" + String(m.content || "").slice(0, 200);
  }).join("\n");
}

/* 解析 LLM 输出的 JSON（容忍 ``` 包裹） */
function parseResult(raw){
  if(!raw) return null;
  var t = String(raw).replace(/```json|```/g, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if(a < 0 || b <= a) return null;
  try{
    var o = JSON.parse(t.slice(a, b + 1));
    if(!o || typeof o !== "object") return null;
    return {need: !!o.need, message: String(o.message || "").slice(0, 200)};
  }catch(e){ return null; }
}

/* 执行一次检查：opts = {charName, hist, complete, model}
 * complete(cfg, messages, temperature) -> Promise<string>，与 RP_NET.complete 同签名 */
async function runCheck(opts){
  opts = opts || {};
  var cfg = getCfg();
  var items = cfg.items && cfg.items.length ? cfg.items : DEFAULT_ITEMS.slice();
  var prompt = renderPrompt(items, historyTextOf(opts.hist), opts.charName);
  var raw = "";
  try{
    raw = await opts.complete({model: opts.model || ""},
      [{role: "user", content: prompt}], 0.5);
  }catch(e){
    return {ok: false, error: String((e && e.message) || e)};
  }
  var r = parseResult(raw);
  if(!r) return {ok: false, error: "模型输出解析失败"};
  var entry = {ts: Date.now(), need: r.need, message: r.message, items: items.slice()};
  var c2 = getCfg();
  c2.log = (c2.log || []).concat([entry]).slice(-10);
  c2.lastCheck = Date.now();
  c2.roundsSince = 0;
  saveCfg(c2);
  return {ok: true, need: r.need, message: r.message};
}

return {
  KEY: KEY,
  FREQS: FREQS,
  DEFAULT_ITEMS: DEFAULT_ITEMS,
  getCfg: getCfg,
  saveCfg: saveCfg,
  intervalOf: intervalOf,
  renderPrompt: renderPrompt,
  historyTextOf: historyTextOf,
  parseResult: parseResult,
  runCheck: runCheck,
};
})();
