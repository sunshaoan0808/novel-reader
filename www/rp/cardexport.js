/* 角色卡导出: Tavern chara_card_v2 PNG (tEXt chunk keyword='chara', base64 JSON),
 * 可直接导入 SillyTavern。分享走原生 JsBridge.sharePng (ACTION_SEND);
 * 无原生桥时回退为应用内预览 + 复制卡片 JSON。 */
var RP_CARDEXPORT = (function(){
function str(v){ return Array.isArray(v) ? v.join("\n") : String(v == null ? "" : v); }
function nonEmpty(s){ return String(s == null ? "" : s).trim() !== ""; }

/* 自创角色卡 -> Tavern v2 JSON */
function buildTavernCard(c){
  var f = (c && c.fields) || {};
  var desc = [f.core_identity, f.appearance_feature, f.visual_identity].filter(nonEmpty).join("\n");
  var pers = [];
  if(nonEmpty(f.core_traits)) pers.push(f.core_traits);
  if(nonEmpty(f.temperament_type)) pers.push("气质类型: " + f.temperament_type);
  if(nonEmpty(f.fatal_flaw)) pers.push("致命缺陷: " + f.fatal_flaw);
  if(nonEmpty(f.shadow_side)) pers.push("阴影面: " + f.shadow_side);
  if(nonEmpty(f.soul_goal)) pers.push("灵魂目标: " + f.soul_goal);
  if(nonEmpty(f.hidden_desire)) pers.push("隐藏欲望: " + f.hidden_desire);
  var sys = [];
  if(nonEmpty(f.speech_style)) sys.push("说话风格: " + f.speech_style);
  if(nonEmpty(f.signature_phrases)) sys.push("口癖: " + str(f.signature_phrases));
  if(nonEmpty(f.ooc_redline)) sys.push("OOC 红线: " + f.ooc_redline);
  if(nonEmpty(f.moral_bottom_line)) sys.push("道德底线: " + f.moral_bottom_line);
  if(nonEmpty(f.action_pattern)) sys.push("行动模式: " + f.action_pattern);
  var lines = f.typical_lines || [];
  /* P1-2: 多开场白与示例对话写回(之前写死空值, roundtrip 会丢) */
  var ext = {};
  try{
    /* Soul Phase1 契约: 应用内 card.extensions 优先, 导入残留 c.raw.extensions 兜底
     * (2026-10-09 修: 之前只读 c.raw.extensions, 自建卡的 extensions.soul
     *  在 PNG 导出中被静默丢掉; 优先级与 RP_SOUL.getSoul 一致) */
    ext = Object.assign({},
      ((c && c.raw && c.raw.extensions) || {}),
      ((c && c.extensions) || {}));
  }catch(e){}
  if(c && c.exampleDialogue) ext.example_dialogue = c.exampleDialogue;
  else delete ext.example_dialogue;
  /* P0 卡兼容: 导入卡再导出时, 原卡字段 roundtrip 不丢。
   * 由 exampleBlocks 的有序 turns 按原序重建——旧版固定拼成 user 在前, 导出即二次重排,
   * "角色先开口"的块来回导出会被永久改写成错位问答。 */
  var mesEx;
  if(c && Array.isArray(c.exampleBlocks) && c.exampleBlocks.length){
    mesEx = c.exampleBlocks.map(function(b){
      var turns = (b && b.turns) || [];
      return "<START>\n" + turns.map(function(t){
        return "{{" + (t.who === "char" ? "char" : "user") + "}}: " + String(t.text == null ? "" : t.text);
      }).join("\n");
    }).join("\n");
  }else{
    mesEx = lines.slice(1).map(function(q){
      return "<START>\n{{user}}: ...\n{{char}}: " + q;
    }).join("\n");
  }
  var sysOut = (c && c.systemPrompt) ? c.systemPrompt : sys.join("\n");
  var creatorNotesOut = (c && c.creatorNotes) ? c.creatorNotes
    : (nonEmpty(f.taboo_topics) ? ("taboos: " + str(f.taboo_topics)) : "");
  var dp = (c && c.depthPrompt && c.depthPrompt.prompt) ? {
    prompt: c.depthPrompt.prompt, role: c.depthPrompt.role || "system", depth: c.depthPrompt.depth || 0
  } : undefined;
  var out = {
    spec: "chara_card_v2", spec_version: "2.0",
    data: {
      name: (c && c.name) || "未命名",
      description: desc,
      personality: pers.join("\n"),
      scenario: (c && c.scenario) || "",
      first_mes: ((c && c.greeting) || lines[0] || ""),
      mes_example: mesEx,
      creator_notes: creatorNotesOut,
      system_prompt: sysOut,
      post_history_instructions: (c && c.postHistoryInstructions) || "",
      alternate_greetings: (c && c.altGreetings) || [],
      tags: [((c && c.novel) || "自定义")],
      creator: (c && c.creator) || "novel-reader",
      character_version: (c && c.characterVersion) || "1.0",
      extensions: ext
    }
  };
  /* v3 字段 roundtrip (ST v2 导入器会忽略未知字段, v3 可读回) */
  if(dp) out.data.depth_prompt = dp;
  if(c && c.groupOnlyGreetings && c.groupOnlyGreetings.length) out.data.group_only_greetings = c.groupOnlyGreetings;
  return out;
}

/* unicode 安全的 base64 */
function b64encodeUnicode(s){
  return btoa(unescape(encodeURIComponent(s)));
}
function bytesToB64(bytes){
  var s = "", i, CH = 0x8000;
  for(i = 0; i < bytes.length; i += CH)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

/* CRC32 (PNG chunk 校验用) */
var CRC_T = (function(){
  var t = new Array(256), c, k, n;
  for(n = 0; n < 256; n++){
    c = n;
    for(k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes){
  var c = 0xFFFFFFFF, i;
  for(i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* 在 PNG 末尾 IEND 之前插入 tEXt/chara chunk, 返回新的 ArrayBuffer */
function embedChara(pngBuf, b64json){
  var png = new Uint8Array(pngBuf);
  var sig = [137, 80, 78, 71, 13, 10, 26, 10], i;
  if(png.length < 20) throw new Error("not a png");
  for(i = 0; i < 8; i++) if(png[i] !== sig[i]) throw new Error("not a png");
  var textBytes = [];
  for(i = 0; i < b64json.length; i++) textBytes.push(b64json.charCodeAt(i) & 0xFF);
  var data = [99, 104, 97, 114, 97, 0].concat(textBytes); // "chara\0" + base64
  var chunk = [];
  chunk.push((data.length >>> 24) & 255, (data.length >>> 16) & 255,
             (data.length >>> 8) & 255, data.length & 255);
  var typePos = chunk.length;
  chunk.push(116, 69, 88, 116); // "tEXt"
  chunk = chunk.concat(data);
  var crc = crc32(chunk.slice(typePos));
  chunk.push((crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255);
  // IEND 恒为最后 12 字节 (len=0 + "IEND" + crc)
  var iendPos = png.length - 12;
  var out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iendPos), 0);
  out.set(chunk, iendPos);
  out.set(png.subarray(iendPos), iendPos + chunk.length);
  return out.buffer;
}

/* 画 512x768 封面 (浏览器环境) */
function renderCover(card){
  return new Promise(function(resolve, reject){
    try{
      var W = 512, H = 768;
      var cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var x = cv.getContext("2d");
      var g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#241d14"); g.addColorStop(1, "#12100c");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.strokeStyle = "#d4a24e"; x.lineWidth = 3;
      x.strokeRect(18, 18, W - 36, H - 36);
      x.strokeStyle = "#5a4a28"; x.lineWidth = 1;
      x.strokeRect(28, 28, W - 56, H - 56);
      var d = card.data || {};
      x.fillStyle = "#f0e6d2"; x.textAlign = "center";
      x.font = "bold 54px serif";
      var nm = d.name || "?";
      x.fillText(nm.length > 8 ? nm.slice(0, 8) : nm, W / 2, 200);
      x.fillStyle = "#a08c5b"; x.font = "24px serif";
      x.fillText((d.tags && d.tags[0]) || "", W / 2, 250);
      x.fillStyle = "#8a7a55"; x.font = "20px serif";
      var first = String(d.first_mes || "").slice(0, 60);
      if(first){
        x.fillText("\u201c" + first + "\u201d", W / 2, 420);
      }
      x.fillStyle = "#57503f"; x.font = "18px sans-serif";
      x.fillText("novel-reader chara_card_v2", W / 2, H - 60);
      x.fillText("scan with SillyTavern to import", W / 2, H - 34);
      cv.toBlob(function(b){ b ? resolve(b) : reject(new Error("canvas failed")); }, "image/png");
    }catch(e){ reject(e); }
  });
}

/* 主流程: 生成带卡数据的 PNG; 有原生桥则调分享, 否则返回 dataUrl 供预览 */
async function exportAndShare(c){
  var card = buildTavernCard(c);
  var json = JSON.stringify(card);
  var b64 = b64encodeUnicode(json);
  var blob = await renderCover(card);
  var buf = await blob.arrayBuffer();
  var outBuf = embedChara(buf, b64);
  var outB64 = bytesToB64(new Uint8Array(outBuf));
  var fname = "card_" + String((c && c.name) || "char").replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "_") + ".png";
  if(typeof window !== "undefined" && window.Android &&
     typeof window.Android.sharePng === "function"){
    window.Android.sharePng(outB64, fname);
    return {shared: true};
  }
  return {shared: false, dataUrl: "data:image/png;base64," + outB64, json: json, fileName: fname};
}

return {buildTavernCard: buildTavernCard, b64encodeUnicode: b64encodeUnicode,
        bytesToB64: bytesToB64, crc32: crc32, embedChara: embedChara,
        renderCover: renderCover, exportAndShare: exportAndShare};
})();
