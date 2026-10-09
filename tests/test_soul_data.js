const fs = require("fs"), vm = require("vm");
const ctx = {console};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("www/rp/soul.js", "utf8"), ctx, {filename: "rp/soul.js"});
vm.runInContext(fs.readFileSync("www/rp/soul_data.js", "utf8"), ctx, {filename: "rp/soul_data.js"});
const RP_SOUL = ctx.RP_SOUL, D = ctx.RP_SOUL_DATA;
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

function mkCard(name){
  var c = {name: name || "测试", extensions: {}};
  c.extensions.soul = RP_SOUL.fromCard(c);
  return c;
}

/* 1. 迁移 */
var c1 = mkCard();
delete c1.extensions.soul.character_book;
var mr = D.migrate(c1);
t("1. 迁移补字段", mr.ok && Array.isArray(c1.extensions.soul.character_book));

/* 2. 快照 */
var sr = D.snapshot(c1, "测试快照");
t("2. 快照", sr.ok && sr.count === 1);

/* 3. 回滚 */
c1.extensions.soul.soul_md = "改过";
var rr = D.rollback(c1, 0);
t("3. 回滚", rr.ok && c1.extensions.soul.soul_md !== "改过");

/* 4. diff */
D.snapshot(c1, "v2");
var d = D.diffSnapshots(c1, 0, 1);
t("4. diff", Array.isArray(d));

/* 5. 批量导出 */
var c2 = mkCard("二号");
var all = D.exportAll([c1, c2]);
t("5. 批量导出", Object.keys(all).length === 2);

/* 6. 搜索 */
c1.extensions.soul.soul_md = "敏感的诗魂";
var hits = D.search(c1, "诗魂");
t("6. 搜索", hits.length > 0 && hits[0].loc === "宪章");

/* 7. 标签 */
t("7. 标签加", D.addTag(c1, "主角"));
t("7. 标签删", D.removeTag(c1, "主角") && (c1.extensions.soul.tags || []).length === 0);

/* 8. 评分 */
D.rate(c1, 5); D.rate(c1, 3);
t("8. 评分", D.avgRating(c1) === 4);

/* 9. 统计 */
D.bumpStat(c1, 100);
var st = D.stat(c1);
t("9. 统计", st.calls === 1 && st.tokens === 100);

/* 10. 置顶 */
D.setPinned(c1, true);
t("10. 置顶", D.isPinned(c1));

/* 11. 克隆 */
var cl = D.clone(c1);
t("11. 克隆", cl && cl.cloned_from && cl.snapshots.length === 0);

/* 12. 合并 */
var c3 = mkCard("三号");
RP_SOUL.addFact(c3, null, "独特记忆");
var mg = D.merge(c1, c3);
t("12. 合并", mg.ok && mg.added > 0);

/* 13. 重置 */
D.resetMemory(c1);
t("13. 重置", ((((c1.extensions.soul.memory || {}).long_term || {}).facts) || []).length === 0);

/* 14. 锁定 */
D.setLocked(c1, true);
t("14. 锁定", D.isLocked(c1));
D.setLocked(c1, false);

/* 15. 审计 */
D.audit(c1, "test", "detail");
var au = D.getAudit(c1, 5);
t("15. 审计", au.length > 0 && au[0].action === "test");

console.log("\nPASS: " + pass + " FAIL: " + fail);
process.exit(fail ? 1 : 0);
