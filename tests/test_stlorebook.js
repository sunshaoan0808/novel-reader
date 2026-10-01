const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// v38: ST 世界书真实制品回归测试
// 真实 fixture: tests/fixtures/lorebook-jiangxueying.json
// (迟归人 v1.2.0 PNG 内嵌 character_book 44 条中抽 4 条, content 截断, 其余字段逐字保留)
// 变体字段: keys/secondary_keys/selective/enabled/insertion_order/position("before_char"字符串)
// 经典字段藏 extensions: selectiveLogic/group/depth/probability/useProbability/...
function mkCtx(){
const store = {};
const localStorage = {
getItem: (k)=> (k in store ? store[k] : null),
setItem: (k, v)=>{ store[k] = String(v); },
removeItem: (k)=>{ delete store[k]; },
};
const ctx = {console, localStorage};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/lorebook.js", "utf8"), ctx, {filename: "lorebook.js"});
return ctx;
}
let pass = 0, fail = 0;
const t = (n, c)=>{ c ? pass++ : (fail++, console.log("FAIL:", n)); };
const ctx = mkCtx();
const run = (code)=> vm.runInContext(code, ctx);

const fix = JSON.parse(fs.readFileSync("tests/fixtures/lorebook-jiangxueying.json", "utf8"));
t("fixture 4 条", fix.entries.length === 4);
ctx.__fix = fix;
const out = run(`RP_LOREBOOK.importST(__fix)`);
t("导入 4 条", out && out.length === 4);
ctx.__out = out;

// 按 insertion_order 排序: id3(order 1) < id0/id1(order 2, 稳定) < id11(order 999)
const comments = out.map(e=>e.comment);
t("按 insertion_order 排序", comments[0] === "活动区域" && comments[3] === "</Main_Character>");
t("同 order 保持原序(稳定)", comments[1] === "<user>" && comments[2] === "姜雨莹_Stage-1");

// 字段映射(逐字核对真实值)
const byComment = {}; out.forEach(e=>{ byComment[e.comment] = e; });
const a = byComment["活动区域"];   // id3: enabled/constant/after_char
const b = byComment["姜雨莹_Stage-1"]; // id1: disabled/before_char
t("enabled=true 保留", a.enabled === true);
t("enabled=false 保留(禁用条目不丢)", b.enabled === false);
t("constant=true 保留", a.constant === true);
t("constant=false 保留", b.constant === false);
t("after_char -> placement personality/after", a.placement === "personality" && a.placementPosition === "after");
t("before_char -> placement personality/before", b.placement === "personality" && b.placementPosition === "before");
t("content 保留", a.content.indexOf("fixture 截断") > 0 && a.content.length > 50);
t("comment 保留", a.comment === "活动区域");

// extensions 回退: selectiveLogic/group/depth/probability
t("extensions.selectiveLogic 回退", a.selectiveLogic === 0);
t("extensions.group_weight 回退", a.groupWeight === 100);
t("extensions.depth 保留", a.depth === 4);
t("extensions.probability 回退", a.probability === 100);
t("extensions 原样保留", a.extensions && a.extensions.position === 1 && a.extensions.exclude_recursion === true);
t("use_regex 记入 extensions", a.extensions && a.extensions.use_regex === true);

// 空 keys 的条目: constant 条照常注入, 非 constant 空 key 不误触发
const matched = run(`RP_LOREBOOK.match(__out, "活动区域", 10)`);
t("match 可用", Array.isArray(matched));
const constHits = run(`RP_LOREBOOK.match(__out.filter(e=>e.constant), "完全无关的文本", 10)`);
t("constant 条无视关键词注入", constHits.length === 3);
const disHits = run(`RP_LOREBOOK.match(__out, "完全无关的文本", 10)`);
t("禁用条目不注入", disHits.length === 3);

// 经典 ST 数字 position 映射
ctx.__num = {entries: [
  {content: "c0", position: 0},
  {content: "c2", position: 2},
  {content: "c4", position: 4, depth: 3},
]};
const nout = run(`RP_LOREBOOK.importST(__num)`);
t("position 0 -> personality/before", nout[0].placement === "personality" && nout[0].placementPosition === "before");
t("position 2 -> default/before", nout[1].placement === "default" && nout[1].placementPosition === "before");
t("position 4 保留 depth", nout[2].depth === 3);

// 非法输入
t("非法输入 null", run(`RP_LOREBOOK.importST({foo:1})`) === null && run(`RP_LOREBOOK.importST(null)`) === null);
t("空 entries null", run(`RP_LOREBOOK.importST({entries:{}})`) === null);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
