/* 画像动态检索：按情境从角色卡字段中动态取用，替代静态全量注入。
 * 纯规则、零 LLM、不读 localStorage 之外的任何存储。
 * 卡字段缺失/为空时静默跳过，绝不抛错（线上卡字段不全是常态）。
 *
 * 用法（集成方负责调用，本模块不碰 prompt.js）：
 *   var r = RP_PORTRAIT.enrich(card, text, history); // history: [{content}...]
 *   // r.text 拼进 system prompt；r.hits / r.banned 供 debug 抽屉审计
 *   RP_PORTRAIT.renderDebug(r.hits, r.banned);
 */
var RP_PORTRAIT = (function(){
"use strict";

var PROMPT_BUDGET = 800; /* prompt 注入预算（字符数，中文按字算） */
var FIELD_CUT = 120;     /* 单字段截断长度（按句边界，不切半句） */

/* ---------- 情境包：情境 -> 卡字段列表 ---------- */
var SITUATION_PACKS = {
conflict: ["ooc_redline","decision_rules","stress_response","restraint_threshold","taboo_topics"],
emotion: ["emotion_model","fear_triggers","inner_need","shadow_side","grievance_style","joy_style"],
social: ["social_mode","speech_style","signature_phrases","typical_lines","carry_style"],
memory: ["life_timeline","key_bonds","trauma_scar","background_imprint"],
};

var PACK_CN = {conflict:"冲突", emotion:"情感", social:"社交", memory:"回忆"};

var FIELD_CN = {
ooc_redline:"行为红线", decision_rules:"决策准则", stress_response:"压力反应",
restraint_threshold:"克制阈值", taboo_topics:"禁忌话题",
emotion_model:"情感模式", fear_triggers:"恐惧触发", inner_need:"深层需求",
shadow_side:"阴影面", grievance_style:"委屈表达", joy_style:"喜悦表达",
social_mode:"社交模式", speech_style:"说话风格", signature_phrases:"口头禅",
typical_lines:"典型台词", carry_style:"处事风格",
life_timeline:"人生轨迹", key_bonds:"关键羁绊", trauma_scar:"创伤",
background_imprint:"背景烙印",
};

/* ---------- 情境关键词：手写、可解释；命中任一即算该情境 ----------
 * 说明：单字关键词（打/亲/爱）会有误伤（如"打算"/"母亲"），代价只是多注入
 * 同一角色的自洽字段，不会导致 OOC；刻意保持简单可解释。 */
var KEYWORDS = {
conflict: ["吵架","争吵","打架","打人","动手","杀","威胁","逼","滚","决斗",
"报仇","复仇","对峙","宣战","背叛","挑衅","侮辱","打"],
emotion: ["哭","爱","喜欢","抱","亲","心疼","思念","想念","孤独","委屈",
"感动","温柔","害怕","心痛"],
social: ["你好","请问","聊聊","告诉","问你","请教","商量","打招呼",
"初次","久仰","自我介绍"],
memory: ["记得","当年","曾经","回忆","往事","小时候","过去","那年",
"旧事","以前"],
};

function fieldLabel(f){ return FIELD_CN[f] || f; }

/* 按句边界截断：优先在 。；！？ 处断开，找不到则硬截（字段级，不抛错） */
function cutSentence(s, max){
  s = String(s);
  if(s.length <= max) return s;
  var cut = s.slice(0, max);
  var marks = ["。","；","！","？","\n",".",";","!","?"];
  var best = -1;
  for(var i=0;i<marks.length;i++){
    var idx = cut.lastIndexOf(marks[i]);
    if(idx > best) best = idx;
  }
  if(best > 0) return cut.slice(0, best+1);
  return cut;
}

/* 情境判定：返回命中的情境数组（固定顺序，可多命中）；无命中返回 [] */
function detect(text, history){
  var corpus = String(text == null ? "" : text);
  try{
    var h = history || [];
    var from = Math.max(0, h.length - 4);
    for(var i=from;i<h.length;i++){
      var m = h[i];
      if(m && m.content) corpus += "\n" + String(m.content);
    }
  }catch(e){}
  var hits = [];
  for(var k in KEYWORDS){
    var kws = KEYWORDS[k];
    for(var j=0;j<kws.length;j++){
      if(kws[j] && corpus.indexOf(kws[j]) >= 0){ hits.push(k); break; }
    }
  }
  return hits;
}

/* 主入口：按情境取字段 -> 相关度排序 -> 预算截断（整字段丢弃）
 * 返回 {text, hits:[{pack,field,snippet}], banned:[...]} */
function enrich(card, text, history, budget){
  var out = {text:"", hits:[], banned:[]};
  try{
    if(!(budget > 0)) budget = PROMPT_BUDGET;
    var fields = (card && card.fields) || {};
    var packs = detect(text, history);
    if(!packs.length) return out;
    /* 相关度关键词 = 命中情境的关键词并集 */
    var kw = [], ki, kj;
    for(ki=0;ki<packs.length;ki++){
      var ks = KEYWORDS[packs[ki]] || [];
      for(kj=0;kj<ks.length;kj++) if(kw.indexOf(ks[kj]) < 0) kw.push(ks[kj]);
    }
    /* 候选字段：按情境包顺序收集，去重；ooc_redline 走硬禁令通道 */
    var seen = {}, cands = [], pi, fi;
    for(pi=0;pi<packs.length;pi++){
      var fl = SITUATION_PACKS[packs[pi]] || [];
      for(fi=0;fi<fl.length;fi++){
        var fn = fl[fi];
        if(seen[fn]) continue; seen[fn] = 1;
        if(fn === "ooc_redline") continue;
        var v = fields[fn];
        if(v == null) continue;
        v = String(v).replace(/\s+/g, " ").trim();
        if(!v) continue;
        var score = 0;
        for(var q=0;q<kw.length;q++) if(v.indexOf(kw[q]) >= 0) score++;
        cands.push({pack:packs[pi], field:fn, value:v, score:score, pi:pi, fi:fi});
      }
    }
    /* 相关度排序：关键词命中数多者先；并列按情境/字段顺序（确定性） */
    cands.sort(function(a,b){
      if(b.score !== a.score) return b.score - a.score;
      if(a.pi !== b.pi) return a.pi - b.pi;
      return a.fi - b.fi;
    });
    /* 硬禁令：ooc_redline 按分号拆条（仅当冲突情境命中时） */
    var bans = [];
    if(packs.indexOf("conflict") >= 0){
      var rl = fields["ooc_redline"];
      if(rl != null){
        var parts = String(rl).split(/[；;]/);
        for(var b=0;b<parts.length;b++){
          var item = parts[b].replace(/\s+/g, " ").trim();
          if(!item) continue;
          if(!/(绝不|不许|不得|禁止|切勿|不可)/.test(item)) item = "绝不" + item;
          bans.push(item);
        }
      }
    }
    /* 组装：预算内逐行 emit，超预算整字段丢弃；无内容则静默返回空 */
    if(!cands.length){
      var _rl = fields["ooc_redline"];
      var _hasBan = packs.indexOf("conflict") >= 0 && _rl != null &&
        String(_rl).split(/[；;]/).some(function(x){ return String(x).trim(); });
      if(!_hasBan) return out;
    }
    var lines = [], used = 0;
    function emit(s){
      var need = s.length + (lines.length ? 1 : 0);
      if(used + need > budget) return false;
      lines.push(s); used += need; return true;
    }
    if(!emit("【画像·动态】")) return out;
    if(bans.length){
      var bl = ["【硬禁令】"];
      for(var bi=0;bi<bans.length;bi++) bl.push("- " + bans[bi]);
      while(bl.length > 1 && used + 1 + bl.join("\n").length > budget) bl.pop();
      if(bl.length > 1 && emit(bl.join("\n"))) out.banned = bans.slice(0, bl.length - 1);
    }
    for(var ci=0;ci<cands.length;ci++){
      var c = cands[ci];
      var snippet = cutSentence(c.value, FIELD_CUT);
      var line = "- " + fieldLabel(c.field) + "：" + snippet;
      if(emit(line)) out.hits.push({pack:c.pack, field:c.field, snippet:snippet});
    }
    out.text = lines.join("\n");
  }catch(e){
    return {text:"", hits:[], banned:[]};
  }
  return out;
}

/* P2-11: 收敛到 escutil.js 的 escH()；独立加载（测试 vm）无 escH 时回退同款实现 */
var esc = (typeof escH === "function") ? escH : function(s){ return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };

/* debug 抽屉：字段名 + snippet，默认折叠由调用方控制 */
function renderDebug(hits, banned){
  var h = "";
  if(banned && banned.length){
    h += '<div class="pdebug-sec">【硬禁令】</div>' + banned.map(function(b){
      return '<div class="pdebug-item"><span class="badge">硬禁令</span><div class="st">' +
        esc(b) + '</div></div>';
    }).join("");
  }
  h += (hits || []).map(function(x){
    return '<div class="pdebug-item"><span class="badge">' +
      esc(PACK_CN[x.pack] || x.pack) + '·' + esc(fieldLabel(x.field)) +
      '</span><div class="st">' + esc(x.snippet) + '</div></div>';
  }).join("");
  if(!h) return '<div class="empty">本轮未命中画像字段</div>';
  return '<div class="pdebug">' + h + '</div>';
}

var api = {
PROMPT_BUDGET: PROMPT_BUDGET, FIELD_CUT: FIELD_CUT,
SITUATION_PACKS: SITUATION_PACKS, KEYWORDS: KEYWORDS,
detect: detect, enrich: enrich, renderDebug: renderDebug,
cutSentence: cutSentence,
};
return api;
})();
