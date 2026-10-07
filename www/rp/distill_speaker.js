/* App 端说话人归属 (2026-10-07): 移植自 novel-distill/novel_distill/speaker.py。
 * 规则提取对话标签 + 未解析 surface 走 LLM 归属。
 */
var DISTILL_SPEAKER = (function(){
"use strict";

var TAG_VERBS = ["附耳笑问道","拍手笑道","笑问道","笑说道","冷笑道","接口道",
  "抢着道","点头道","摇头道","低声道","笑道","问道","叹道","忙道","说道",
  "答道","回道","禀道","骂道","哭道","喊道","叫道","嚷道","悄道","接道",
  "续道","又道","复道","道","说","笑","问","叹","应"];
var VERB_ALT = TAG_VERBS.slice().sort(function(a, b){ return b.length - a.length; }).join("|");
var MID = "(?:听了|听见|见了|便|就|也|不觉|不禁|连忙|忙|赶忙|只|却|又|因|遂|乃)*";
var OPEN_Q = "[“\"「『]";
var BEFORE = new RegExp("([\u4e00-\u9fa5]{1,4}?)儿?" + MID + "(" + VERB_ALT + ")[：:，,]?\\s*" + OPEN_Q, "g");
var AFTER = new RegExp("[”\"」』]([\u4e00-\u9fa5]{1,4}?)儿?" + MID + "(" + VERB_ALT + ")", "g");

var TAIL_STRIP = "笑说道问叹应的了着过";
var CROWD = ["众人","大家","小厮","丫鬟","婆子","小丫头","丫头","仆人","下人"];
var NONAME_RE = /[之乎者也的]/;

function cleanTail(s){
  while(s.length > 2 && TAIL_STRIP.indexOf(s[s.length - 1]) >= 0)
    s = s.slice(0, -1);
  return s;
}

function grabQuote(text, openPos, limit){
  limit = limit || 300;
  var end = text.indexOf("”", openPos + 1);
  if(end < 0) end = text.indexOf("\"", openPos + 1);
  if(end < 0 || end - openPos > limit) return "";
  return text.slice(openPos + 1, end);
}

function extractTurns(text){
  var found = [], m;
  BEFORE.lastIndex = 0;
  while((m = BEFORE.exec(text))){
    var spk = cleanTail(m[1]);
    var q = grabQuote(text, m.index + m[0].length - 1);
    var tag = m[0].length > 14 ? m[0].slice(0, 14) : m[0];
    var snippet = q ? tag + "“" + q.slice(0, 60) + "”" : tag;
    found.push([m.index, m.index + m[0].length, spk, snippet]);
  }
  var beforeSpans = found.map(function(f){ return [f[0], f[1]]; });
  AFTER.lastIndex = 0;
  while((m = AFTER.exec(text))){
    var overlap = beforeSpans.some(function(s){ return s[0] < m.index + m[0].length && m.index < s[1]; });
    if(overlap) continue;
    var spk2 = cleanTail(m[1]);
    found.push([m.index, m.index + m[0].length, spk2, m[0].slice(0, 14)]);
  }
  found.sort(function(a, b){ return a[0] - b[0]; });
  return found.map(function(f){ return {pos: f[0], surface: f[2], snippet: f[3]}; });
}

function resolveSurface(surface, table, knownNames){
  if(!surface || surface.length < 2) return null;
  if(table[surface]) return table[surface];
  if(knownNames.indexOf(surface) >= 0) return surface;
  var hits = knownNames.filter(function(n){ return n.indexOf(surface) >= 0; });
  return hits.length === 1 ? hits[0] : null;
}

function collectUnknownSurfaces(chunks, table, knownNames, minCount, log){
  minCount = minCount || 2;
  log = log || function(){};
  var known = {};
  knownNames.forEach(function(n){ known[n] = true; });
  var counts = {}, contexts = {}, seen = {}, nTurns = 0;
  chunks.forEach(function(ch){
    extractTurns(ch.text).forEach(function(t){
      var key = t.surface + "|" + t.snippet;
      if(seen[key]) return;
      seen[key] = true;
      nTurns++;
      if(CROWD.indexOf(t.surface) >= 0 || t.surface.length < 2 || NONAME_RE.test(t.surface)) return;
      if(resolveSurface(t.surface, table, knownNames) !== null) return;
      counts[t.surface] = (counts[t.surface] || 0) + 1;
      if(!(t.surface in contexts)) contexts[t.surface] = [];
      if(contexts[t.surface].length < 3){
        var s = Math.max(0, t.pos - 400);
        var ctx = ch.text.slice(s, t.pos + 400).replace(/\n/g, "");
        contexts[t.surface].push("[" + ch.id + "] …" + ctx.slice(-800) + "…");
      }
    });
  });
  var out = {};
  Object.keys(counts).forEach(function(spk){
    if(counts[spk] >= minCount) out[spk] = {count: counts[spk], contexts: contexts[spk]};
  });
  if(nTurns) log("[speaker] 提取 " + nTurns + " 轮, 未解析 " + Object.keys(out).length + " 个");
  return out;
}

async function attributeSpeakers(unknowns, knownNames, onProgress){
  // LLM 归属未解析 surface
  var results = {};
  var keys = Object.keys(unknowns);
  for(var i = 0; i < keys.length; i++){
    var spk = keys[i];
    if(onProgress) onProgress(i + 1, keys.length, "归属说话人 " + spk);
    try{
      var r = await DISTILL_LLM.chat([
        {role: "system", content: "你是说话人归属器。根据上下文判断说话人是谁。返回 JSON: {\"canonical\": \"正名\", \"conf\": 0-10}。无法判断时 canonical 为 null。"},
        {role: "user", content: JSON.stringify({surface: spk, known: knownNames, contexts: unknowns[spk].contexts})}
      ]);
      var m = r.content.match(/\{[^}]+\}/);
      if(m){
        var d = JSON.parse(m[0]);
        if(d.conf >= 8 && d.canonical) results[spk] = d.canonical;
      }
    }catch(e){}
  }
  return results;
}

return {
  extractTurns: extractTurns,
  resolveSurface: resolveSurface,
  collectUnknownSurfaces: collectUnknownSurfaces,
  attributeSpeakers: attributeSpeakers
};
})();
