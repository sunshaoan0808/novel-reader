const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const JDIR = fs.existsSync("src/com/ling/novelreader/MainActivity.java") ? "src" : (fs.existsSync("app/src") ? "app/src" : "android/src");
const MF = fs.existsSync("AndroidManifest.xml") ? "AndroidManifest.xml" : (fs.existsSync("app/AndroidManifest.xml") ? "app/AndroidManifest.xml" : "android/AndroidManifest.xml");
// rp/cardexport.js: Tavern v2 卡构建 + chara tEXt 嵌入 (纯函数部分)
const src = fs.readFileSync(WWW+"/rp/cardexport.js", "utf8");
const ctx = {console, btoa: (s)=>Buffer.from(s, "binary").toString("base64"), atob: (s)=>Buffer.from(s, "base64").toString("binary")};
vm.createContext(ctx);
vm.runInContext(src, ctx); // 加载时不碰 document/window, 安全
const X = ctx.RP_CARDEXPORT;

let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };

// --- buildTavernCard ---
const c = {name: "林黛玉", novel: "红楼梦", fields: {
  core_identity: "林如海之女",
  appearance_feature: "两弯似蹙非蹙烟眉",
  core_traits: "敏感细腻",
  speech_style: "言辞锋利",
  typical_lines: ["你这话说得好没意思", "我不过是多说几句罢了", "第三句"],
  taboo_topics: "宝玉娶亲",
}};
const card = X.buildTavernCard(c);
t("spec v2", card.spec === "chara_card_v2" && card.spec_version === "2.0");
t("name", card.data.name === "林黛玉");
t("description has identity", card.data.description.indexOf("林如海之女") >= 0);
t("personality", card.data.personality.indexOf("敏感细腻") >= 0);
t("first_mes", card.data.first_mes === "你这话说得好没意思");
t("mes_example has rest", card.data.mes_example.indexOf("我不过是多说几句罢了") >= 0
  && card.data.mes_example.indexOf("{{char}}") >= 0);
t("system_prompt", card.data.system_prompt.indexOf("言辞锋利") >= 0);
t("tags", card.data.tags[0] === "红楼梦");
t("empty card safe",
  X.buildTavernCard({}).data.name === "未命名" && X.buildTavernCard(null).spec === "chara_card_v2");

// --- b64 unicode roundtrip (CJK) ---
const jb64 = X.b64encodeUnicode(JSON.stringify(card));
const back = JSON.parse(Buffer.from(jb64, "base64").toString("utf8"));
t("b64 cjk roundtrip", back.data.name === "林黛玉");

// --- crc32 已知值 ---
t("crc32 known", X.crc32(Buffer.from("123456789")) === 0xCBF43926);

// --- embedChara: 1x1 PNG 嵌入后结构校验 ---
const tinyPngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const _b0 = Buffer.from(tinyPngB64, "base64");
const pngBuf = _b0.buffer.slice(_b0.byteOffset, _b0.byteOffset + _b0.byteLength);
const outBuf = X.embedChara(pngBuf, jb64);
const out = Buffer.from(outBuf);
// 解析 chunks
function parseChunks(buf){
  const chunks = [];
  let p = 8;
  while(p + 8 <= buf.length){
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    chunks.push({type, len, dataPos: p + 8, crcPos: p + 8 + len});
    p += 12 + len;
    if(type === "IEND") break;
  }
  return chunks;
}
const chunks = parseChunks(out);
t("png sig kept", out[0] === 137 && out[1] === 80 && out[2] === 78 && out[3] === 71);
t("IEND last", chunks[chunks.length - 1].type === "IEND");
const txt = chunks.find((k)=> k.type === "tEXt");
t("tEXt present", !!txt);
let kwOk = false, payloadOk = false, crcOk = false;
if(txt){
  const raw = out.subarray(txt.dataPos, txt.dataPos + txt.len);
  const nul = raw.indexOf(0);
  kwOk = raw.toString("ascii", 0, nul) === "chara";
  const payload = raw.subarray(nul + 1).toString("ascii");
  payloadOk = JSON.parse(Buffer.from(payload, "base64").toString("utf8")).data.name === "林黛玉";
  const stored = out.readUInt32BE(txt.crcPos);
  const computed = X.crc32(out.subarray(txt.dataPos - 4, txt.crcPos));
  crcOk = stored === computed;
}
t("chara keyword", kwOk);
t("payload roundtrip", payloadOk);
t("chunk crc valid", crcOk);
t("tEXt before IEND", chunks.indexOf(txt) === chunks.length - 2);

// embedChara 非法输入抛错
let threw = false;
try{ X.embedChara(new ArrayBuffer(8), "e30="); }catch(e){ threw = true; }
t("rejects non-png", threw);

// --- 静态: 原生层与 UI 入口 ---
const java = fs.readFileSync(JDIR+"/com/ling/novelreader/MainActivity.java", "utf8");
t("JsBridge sharePng", java.indexOf("sharePng") >= 0 && java.indexOf("@JavascriptInterface") >= 0);
t("addJavascriptInterface", java.indexOf('addJavascriptInterface(new JsBridge(), "Android")') >= 0);
t("provider file exists", fs.existsSync(JDIR+"/com/ling/novelreader/SharedFileProvider.java"));
const mf = fs.readFileSync(MF, "utf8");
t("manifest provider", mf.indexOf("SharedFileProvider") >= 0 && mf.indexOf("com.ling.novelreader.shared") >= 0);
const html = fs.readFileSync(WWW+"/index.html", "utf8");
t("cardexport.js in index.html", html.indexOf("rp/cardexport.js") >= 0);
const asrc = fs.readFileSync(WWW+"/app.js", "utf8");
t("exportCard exists", asrc.indexOf("window.exportCard") >= 0);
t("export button on card", asrc.indexOf("exportCard('${jq(c.id)}')") >= 0); /* P0-1: 已改 jq() 转义 */

// --- 导出->导入往返: buildTavernCard -> normalizeTavern, 关键字段不丢 ---
const csrc = fs.readFileSync(WWW+"/rp/cardimport.js", "utf8");
const cctx = {console};
vm.createContext(cctx);
vm.runInContext(csrc + "\n;globalThis.RP_CARDIMPORT = RP_CARDIMPORT;", cctx);
const c2 = {name: "武松", novel: "水浒传", greeting: "洒家行不更名",
  altGreetings: ["这厮好生无礼", "且吃洒家一拳"],
  fields: {core_identity: "行者", appearance_feature: "身长八尺",
    core_traits: "豪爽", speech_style: "直来直去",
    typical_lines: ["第一句", "第二句"]}};
const back2 = cctx.RP_CARDIMPORT.normalizeTavern(X.buildTavernCard(c2).data);
t("rt name", back2.name === "武松");
t("rt greeting", back2.greeting === "洒家行不更名");
t("rt altGreetings", back2.altGreetings.join("|") === "这厮好生无礼|且吃洒家一拳");
t("rt core_identity", (back2.fields.core_identity||"").indexOf("行者") >= 0
  && (back2.fields.core_identity||"").indexOf("身长八尺") >= 0);
t("rt core_traits", (back2.fields.core_traits||"").indexOf("豪爽") >= 0);

// --- Soul Phase1 契约: 自建卡 card.extensions.soul 导出不丢 ---
// 回归: buildTavernCard 曾只读 c.raw.extensions, 应用内写入的 extensions.soul
// 在 PNG 导出中被静默丢掉 (export 会静默丢 soul)
const cs = {name: "林黛玉", novel: "红楼梦",
  fields: {core_identity: "林如海之女", typical_lines: ["你这话说得好没意思"]},
  extensions: {soul: {schema_version: 3, soul_md: "# 黛玉宪章",
    persona: {core_traits: ["敏感"]}, memory: {long_term: {facts: []}},
    character_book: [{k: "葬花", content: "花谢花飞飞满天"}], updated_at: "2026-10-09T10:00:00Z"}}};
const bcs = X.buildTavernCard(cs);
var bcsSoul = bcs.data.extensions && bcs.data.extensions.soul;
t("soul pkg survives export",
  !!(bcsSoul && bcsSoul.soul_md === "# 黛玉宪章"));
t("soul character_book survives",
  !!(bcsSoul && bcsSoul.character_book && bcsSoul.character_book.length === 1 &&
  bcsSoul.character_book[0].content.indexOf("花谢花飞") >= 0));
// 优先级: 应用内 extensions 优先于导入残留 raw.extensions (与 getSoul 契约一致)
const cs2 = {name: "薛宝钗", fields: {},
  extensions: {soul: {soul_md: "new-md"}},
  raw: {extensions: {soul: {soul_md: "old-md"}, legacy_flag: 1}}};
const bcs2 = X.buildTavernCard(cs2);
t("app extensions win over raw",
  bcs2.data.extensions.soul.soul_md === "new-md");
t("raw extensions preserved as fallback",
  bcs2.data.extensions.legacy_flag === 1);
// 无 soul 时 extensions 仍为空对象, 不炸
const cs3 = {name: "无魂", fields: {}};
t("no-soul card safe", typeof X.buildTavernCard(cs3).data.extensions === "object");

console.log(`\ncardexport: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
