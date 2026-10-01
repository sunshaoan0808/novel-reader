/* 穿越 P0: 酒馆角色卡导入器
 * 支持 SillyTavern 角色卡 PNG（tEXt/iTXt chunk，keyword='chara'，base64 JSON）
 * 与纯 JSON（chara_card_v2 / v1 扁平格式）。
 * 解析后归一化为内部卡片 {name, fields, scenario, worldbook, raw}，
 * 存入 nd_imported_cards，可作为魂穿目标与卡片世界来源。
 */
const RP_CARDIMPORT = (function(){
"use strict";
var STORE = "nd_imported_cards";

function ascii(bytes){
  var s = "";
  for(var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function b64ToUtf8(b64){
  var bin = atob(String(b64).replace(/\s+/g, ""));
  var bytes = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* 从 PNG ArrayBuffer 里提取 chara JSON 字符串；失败抛错 */
function extractChara(pngBuf){
  var png = new Uint8Array(pngBuf);
  var sig = [137, 80, 78, 71, 13, 10, 26, 10], i;
  if(png.length < 20) throw new Error("不是 PNG 文件");
  for(i = 0; i < 8; i++) if(png[i] !== sig[i]) throw new Error("不是 PNG 文件");
  var pos = 8;
  while(pos + 12 <= png.length){
    var len = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
    if(len < 0 || pos + 12 + len > png.length) break;
    var type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    var data = png.subarray(pos + 8, pos + 8 + len);
    if(type === "tEXt"){
      var z = data.indexOf(0);
      if(z > 0 && ascii(data.subarray(0, z)) === "chara"){
        return b64ToUtf8(ascii(data.subarray(z + 1)));
      }
    } else if(type === "iTXt"){
      var p = data.indexOf(0);
      if(p > 0 && ascii(data.subarray(0, p)) === "chara"){
        var compFlag = data[p + 1], compMethod = data[p + 2];
        if(compFlag === 0 && compMethod === 0){
          var q = p + 3, lz = data.indexOf(0, q);
          if(lz < 0){ pos += 12 + len; continue; }
          q = lz + 1;
          var tz = data.indexOf(0, q);
          if(tz < 0){ pos += 12 + len; continue; }
          q = tz + 1;
          // iTXt 文本段为 UTF-8；酒馆卡此处仍常放 base64 JSON
          var txt = new TextDecoder().decode(data.subarray(q));
          try { return b64ToUtf8(txt); } catch(e){ return txt; }
        }
        // 压缩过的 iTXt 罕见，跳过
      }
    } else if(type === "IEND"){
      break;
    }
    pos += 12 + len;
  }
  throw new Error("这张 PNG 里没有找到角色卡数据（需要酒馆导出的卡片图）");
}

function parseCardJson(text){
  var t = String(text || "").trim().replace(/^\uFEFF/, "");
  var o = JSON.parse(t);
  if(o && o.data) return o.data;      // chara_card_v2
  if(o && (o.name || o.description)) return o;  // v1 扁平
  throw new Error("JSON 里没有角色卡字段");
}

/* 从 mes_example 提取 {{char}}: 台词行 */
function exampleLines(mesExample, charName){
  var out = [];
  String(mesExample || "").split(/<START>/i).forEach(function(blk){
    blk.split("\n").forEach(function(line){
      var m = line.match(/^\s*\{\{\s*char\s*\}\}\s*:\s*(.+)$/i) ||
              (charName && line.match(new RegExp("^\\s*" + charName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:：]\\s*(.+)$")));
      if(m && m[1].trim()) out.push(m[1].trim());
    });
  });
  return out;
}

/* Tavern 卡 -> 内部卡片 */
function normalizeTavern(d){
  d = d || {};
  var name = String(d.name || "未命名").trim() || "未命名";
  var fields = {};
  if(d.description) fields.core_identity = String(d.description).trim();
  if(d.personality) fields.core_traits = String(d.personality).trim();
  var lines = [];
  /* first_mes 不再塞进 typical_lines: 它是开场场景原文(常数千字), 不是"典型台词",
     进了 typical_lines 会污染【说话方式】并被 buildExamples 配上假 opener 生成误导性 few-shot。
     开场白走独立 greeting 字段。 */
  exampleLines(d.mes_example, name).forEach(function(l){
    if(l && lines.indexOf(l) < 0) lines.push(l);
  });
  if(lines.length) fields.typical_lines = lines.slice(0, 5);
  var sysNote = [];
  if(d.system_prompt) sysNote.push(String(d.system_prompt).trim());
  if(d.creator_notes) sysNote.push("作者注：" + String(d.creator_notes).trim());
  var worldbook = [];
  var book = d.character_book || {};
  (book.entries || []).forEach(function(e, i){
    if(!e || !e.content) return;
    worldbook.push({
      title: e.name || ("卡片世界书 " + (i + 1)),
      trigger_keywords: e.keys || e.keywords || [],
      content: String(e.content),
      priority: 55, enabled: e.enabled !== false,
    });
  });
  var tags = d.tags || [];
  /* 开场白 first_mes 单独保留: 聊天/穿越开场优先用卡片原开场白, 不再只塞进 typical_lines */
  var greeting = String(d.first_mes == null ? "" : d.first_mes).trim();
  /* P1-2: 保留多开场白与示例对话(之前归一化会丢, 导出也写空) */
  var altGreetings = Array.isArray(d.alternate_greetings) ? d.alternate_greetings
    .map(function(g){ return String(g == null ? "" : g).trim(); })
    .filter(function(g){ return g; }).slice(0, 8) : [];
  var ext = (d.extensions && typeof d.extensions === "object") ? d.extensions : {};
  var exampleDialogue = String(ext.example_dialogue == null ? "" : ext.example_dialogue).trim();
  return {
    id: "imp" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    name: name,
    novel: tags[0] || "导入角色卡",
    fields: fields,
    greeting: greeting,
    altGreetings: altGreetings,
    exampleDialogue: exampleDialogue,
    scenario: String(d.scenario || "").trim(),
    sysNote: sysNote.join("\n"),
    worldbook: worldbook,
    raw: d,
    createdAt: Date.now(),
  };
}

/* ---- 本地库 ---- */
function list(){
  try {
    var s = localStorage.getItem(STORE);
    /* P2: localStorage 副本被清理后，回退 IDB 内存镜像；v36: getSync 在文件层同步补读，冷启动也安全 */
    if(s == null && typeof RP_STORE!=="undefined") s = (RP_STORE.getSync || RP_STORE.cacheGet).call(RP_STORE, STORE);
    return JSON.parse(s) || [];
  } catch(e){ return []; }
}
function save(list){
  var s = JSON.stringify(list);
  try { localStorage.setItem(STORE, s); } catch(e){}
  /* P2: 大体积角色卡 IDB 双写（复制模式） */
  try{ if(typeof RP_STORE!=="undefined"){ RP_STORE.cacheSet(STORE, s); RP_STORE.syncBig(STORE, s); } }catch(e){}
}
function find(name){
  var l = list();
  for(var i = 0; i < l.length; i++) if(l[i].name === name){ ensureGreeting(l[i]); return l[i]; }
  return null;
}
function findById(id){
  var l = list();
  for(var i = 0; i < l.length; i++) if(l[i].id === id){ ensureGreeting(l[i]); return l[i]; }
  return null;
}
/* 旧卡兼容(v36): 56797f7 之前导入的卡没有独立 greeting 字段, first_mes 只进了
   typical_lines 纯数组(或只留在 raw 里)。读时回填, 不写回存储, 避免存储抖动。
   回退链: greeting -> raw.first_mes -> typical_lines 首个超长条目 */
function greetingOf(card){
  if(!card) return "";
  var g = String(card.greeting == null ? "" : card.greeting).trim();
  if(g) return g;
  var raw = (card.raw && typeof card.raw === "object") ? card.raw : {};
  var fm = String(raw.first_mes == null ? "" : raw.first_mes).trim();
  if(fm) return fm;
  var tl = card.fields && card.fields.typical_lines;
  if(Array.isArray(tl) && tl.length){
    var t0 = String(tl[0] == null ? "" : tl[0]).trim();
    /* 新卡 typical_lines 是 mes_example 短句; 超长首条基本可判定为旧卡的 first_mes */
    if(t0.length > 200) return t0;
  }
  return "";
}
function ensureGreeting(card){
  if(card && !String(card.greeting == null ? "" : card.greeting).trim()){
    var g = greetingOf(card);
    if(g) card.greeting = g;
  }
  return card;
}
function add(card){
  var l = list();
  l.unshift(card);
  save(l);
  return card;
}
function del(id){
  save(list().filter(function(c){ return c.id !== id; }));
}
/* P1-2: 原位更新(保留顺序), 供卡片编辑页使用 */
function update(card){
  save(list().map(function(c){ return c.id === card.id ? card : c; }));
  return card;
}

/* 文件 -> 归一化卡片（不入库，供预览确认） */
async function fromFile(file){
  var buf = await file.arrayBuffer();
  var name = (file.name || "").toLowerCase();
  var jsonText;
  if(name.slice(-4) === ".png"){
    jsonText = extractChara(buf);
  } else {
    jsonText = new TextDecoder().decode(new Uint8Array(buf));
  }
  return normalizeTavern(parseCardJson(jsonText));
}

return {
  extractChara: extractChara, parseCardJson: parseCardJson,
  normalizeTavern: normalizeTavern, exampleLines: exampleLines, greetingOf: greetingOf,
  list: list, find: find, findById: findById, add: add, del: del, update: update,
  fromFile: fromFile,
};
})();
