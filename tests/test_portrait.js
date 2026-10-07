const fs = require("fs"), vm = require("vm"), assert = require("assert");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 画像动态检索回归：情境判定 / 预算截断 / 硬禁令 / 容错 / 确定性（纯规则，零 LLM）
const ctx = {console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/portrait.js", "utf8"), ctx);
const P = ctx.RP_PORTRAIT;
let n = 0;
const t = (name, fn)=>{ fn(); n++; console.log("ok -", name); };

function mkCard(over){
  var fields = {
    ooc_redline: "绝不贪恋封赏；绝不背弃师命；绝不做寡情薄意之事",
    decision_rules: "凡事先问是否合于师嘱，合则行，不合则止。遇到逼迫时不争不辩。",
    stress_response: "不争不辩，只把前言摆出。",
    restraint_threshold: "金帛不能动其心。",
    taboo_topics: "",
    emotion_model: "外冷内深，离别时不动声色。",
    fear_triggers: "落个寡情薄意的名声。",
    inner_need: "被当作自己人又随时能抽身。",
    shadow_side: "",
    grievance_style: "",
    joy_style: "",
    social_mode: "礼数周到而距离恒定。",
    speech_style: "道门谦称，措辞婉转而立场坚硬。",
    signature_phrases: "贫道就今拜别仁兄",
    typical_lines: "向日本师嘱咐小道。",
    carry_style: "超然于功过之争。",
    life_timeline: "早年学艺；后归山。",
    key_bonds: "罗真人——本师；宋江——仁兄。",
    trauma_scar: "",
    background_imprint: "蓟州道门出身。"
  };
  if(over) for(var k in over) fields[k] = over[k];
  return {name: "测试卡", fields: fields};
}

/* ---------- 情境判定 ---------- */
t("detect 冲突", ()=>{
  assert.deepStrictEqual([...P.detect("你再逼我，我就跟你打一架！", [])], ["conflict"]);
});
t("detect 情感", ()=>{
  assert.deepStrictEqual([...P.detect("我好想你，别哭，抱抱", [])], ["emotion"]);
});
t("detect 社交", ()=>{
  assert.deepStrictEqual([...P.detect("你好，请问怎么称呼？", [])], ["social"]);
});
t("detect 回忆", ()=>{
  assert.deepStrictEqual([...P.detect("还记得当年我们一起上山吗", [])], ["memory"]);
});
t("detect 混合命中", ()=>{
  assert.deepStrictEqual([...P.detect("别逼我！想起当年你背叛我", [])], ["conflict", "memory"]);
});
t("detect 读历史上下文", ()=>{
  assert.deepStrictEqual([...P.detect("嗯", [{role:"user", content:"我们打一架吧"}])], ["conflict"]);
  assert.deepStrictEqual([...P.detect("嗯", [])], []);
});
t("detect 无命中回退为空数组", ()=>{
  assert.deepStrictEqual([...P.detect("今天天气不错", [])], []);
  assert.deepStrictEqual([...P.detect("", null)], []);
});

/* ---------- 预算与截断 ---------- */
t("enrich 默认预算 800 内", ()=>{
  var r = P.enrich(mkCard(), "你再逼我也没用！", []);
  assert.ok(r.text.length <= 800, "text=" + r.text.length);
  assert.ok(r.hits.length > 0);
});
t("enrich 超预算整字段丢弃", ()=>{
  var r = P.enrich(mkCard(), "你再逼我也没用！", [], 120);
  assert.ok(r.text.length <= 120, "text=" + r.text.length);
  // 每个命中的字段行必须完整出现在 text 里（不切半句）
  r.hits.forEach(function(h){
    assert.ok(r.text.indexOf(h.snippet) >= 0, "snippet 完整: " + h.field);
  });
});
t("enrich 单字段 120 字截断按句边界", ()=>{
  var long = "第一句。第二句很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长。第三句。";
  var r = P.enrich(mkCard({decision_rules: long}), "别逼我", [], 2000);
  var hit = r.hits.filter(function(h){ return h.field === "decision_rules"; })[0];
  assert.ok(hit, "decision_rules 被命中");
  assert.ok(hit.snippet.length <= 121, "snippet=" + hit.snippet.length);
  assert.ok(/。$/.test(hit.snippet) || hit.snippet.length <= 120, "句边界: " + hit.snippet.slice(-4));
});
t("enrich 硬截（无句读超长字段）", ()=>{
  var r = P.enrich(mkCard({decision_rules: new Array(201).join("a")}), "别逼我", [], 2000);
  var hit = r.hits.filter(function(h){ return h.field === "decision_rules"; })[0];
  assert.strictEqual(hit.snippet.length, 120);
});

/* ---------- 硬禁令 ---------- */
t("ooc_redline 进硬禁令段且排最前", ()=>{
  var r = P.enrich(mkCard(), "你再逼我也没用！", []);
  assert.ok(r.banned.length === 3, "banned=" + JSON.stringify(r.banned));
  assert.ok(r.banned.every(function(b){ return /^(绝不|不许|不得|禁止|切勿|不可)/.test(b); }));
  var iBan = r.text.indexOf("【硬禁令】");
  var iField = r.text.indexOf("决策准则");
  assert.ok(iBan >= 0 && iBan < iField, "硬禁令在前");
});
t("非冲突情境不触发硬禁令", ()=>{
  var r = P.enrich(mkCard(), "还记得当年吗", []);
  assert.strictEqual(r.banned.length, 0);
  assert.ok(r.text.indexOf("【硬禁令】") < 0);
});
t("硬禁令缺 绝不 前缀自动补", ()=>{
  var r = P.enrich(mkCard({ooc_redline: "喜欢吃苹果；绝不说谎"}), "别逼我", []);
  assert.ok(r.banned[0] === "绝不喜欢吃苹果", JSON.stringify(r.banned));
});

/* ---------- 相关度排序 ---------- */
t("关键词命中多的字段排前面", ()=>{
  var r = P.enrich(mkCard(), "逼我也没用，我 stress 很大", [], 2000);
  // decision_rules 含"逼迫"命中"逼"；stress_response 不含关键词 -> decision 排前
  var order = r.hits.map(function(h){ return h.field; });
  assert.ok(order.indexOf("decision_rules") < order.indexOf("stress_response"),
    JSON.stringify(order));
});
t("多情境命中字段去重", ()=>{
  var r = P.enrich(mkCard(), "别逼我，想起当年，抱抱我别哭", [], 5000);
  var fields = r.hits.map(function(h){ return h.field; });
  assert.strictEqual(fields.length, new Set(fields).size, "无重复字段");
});

/* ---------- 容错 ---------- */
t("空字段静默跳过", ()=>{
  var r = P.enrich({name: "空卡", fields: {}}, "你再逼我", []);
  assert.strictEqual(r.text, "");
  assert.strictEqual(r.hits.length, 0);
});
t("缺 fields / null 卡不崩", ()=>{
  assert.doesNotThrow(()=>P.enrich(null, "你再逼我", []));
  assert.doesNotThrow(()=>P.enrich({name: "x"}, "你再逼我", null));
  assert.doesNotThrow(()=>P.enrich(undefined, null, undefined));
  assert.strictEqual(P.enrich(null, "x", []).text, "");
});
t("非字符串字段值不崩", ()=>{
  assert.doesNotThrow(()=>P.enrich(mkCard({decision_rules: 12345}), "别逼我", []));
});
t("极小预算不崩", ()=>{
  var r = P.enrich(mkCard(), "你再逼我", [], 3);
  assert.strictEqual(r.text, "");
});

/* ---------- 确定性 ---------- */
t("同输入同输出", ()=>{
  var c = mkCard();
  var a = P.enrich(c, "别逼我，想起当年", [{content: "抱抱"}], 500);
  var b = P.enrich(c, "别逼我，想起当年", [{content: "抱抱"}], 500);
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual([...P.detect("别逼我", [])], [...P.detect("别逼我", [])]);
});

/* ---------- 常量与 debug ---------- */
t("PROMPT_BUDGET 暴露为 800", ()=>{
  assert.strictEqual(P.PROMPT_BUDGET, 800);
});
t("SITUATION_PACKS 四情境齐全", ()=>{
  assert.deepStrictEqual(Object.keys(P.SITUATION_PACKS).sort(),
    ["conflict", "emotion", "memory", "social"]);
});
t("renderDebug 输出字段名与 snippet", ()=>{
  var r = P.enrich(mkCard(), "你再逼我", []);
  var html = P.renderDebug(r.hits, r.banned);
  assert.ok(html.indexOf("决策准则") >= 0);
  assert.ok(html.indexOf("硬禁令") >= 0);
  assert.ok(html.indexOf("<") >= 0);
});
t("renderDebug 空命中", ()=>{
  var html = P.renderDebug([], []);
  assert.ok(html.indexOf("未命中") >= 0);
});
t("renderDebug 转义 HTML", ()=>{
  var html = P.renderDebug([{pack: "conflict", field: "decision_rules", snippet: "<script>alert(1)</script>"}], []);
  assert.ok(html.indexOf("<script>") < 0);
  assert.ok(html.indexOf("&lt;script&gt;") >= 0);
});

console.log("\n" + n + " pass, 0 fail");
