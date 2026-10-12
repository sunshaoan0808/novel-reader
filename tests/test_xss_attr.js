// test_xss_attr.js: P0-1 回归 —— jq() 必须是"双引号 HTML 属性安全"的。
// 血泪（2026-10-13）：jq() 曾把 " 转成 \"，但 HTML 解析器不认反斜杠转义，
// 原始 " 字节仍会截断 onclick="..." 属性，payload 'x" onmouseover=alert(1) y="'
// 可被干净注入为可执行的 onmouseover。修法：" 一律转 &quot;（HTML 层），
// ' 和 \ 转反斜杠（JS 层）。本测试用字符级断言锁死该行为。
const fs = require("fs"), vm = require("vm");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const ctx = {console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(WWW + "/rp/escutil.js", "utf8"), ctx);
const jq = vm.runInContext("jq", ctx);
const jqJ = vm.runInContext("jqJ", ctx);

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.log("FAIL:", n)); };

// 1) " 必须转成 &quot;，源码里不许留裸 " 字节
t("双引号转实体", jq('a"b') === "a&quot;b");
t("无裸双引号字节", !/"/.test(jq('x"y')));
t("单引号转反斜杠", jq("a'b") === "a\\'b");
t("反斜杠先转义", jq("a\\b") === "a\\\\b");
t("&先转义不双重", jq("a&b") === "a&amp;b");
t("<>转义", jq("<svg>") === "&lt;svg&gt;");
t("换行转义", jq("a\nb") === "a\\nb");

// 2) 攻击载荷：模板拼装后，属性源码里不能出现可被解析器利用的裸 "
const payloads = [
  'x" onmouseover=alert(1) y="',
  '");alert(1);//',
  '"><svg onload=alert(1)>',
  "a'b\"c\\d",
];
for (const p of payloads) {
  const attr = `onclick="chatWith('${jq(p)}')`;
  // 掐头去尾拿出属性值源码（第一个 " 到最后一个 " 之间）
  const inner = attr.slice(attr.indexOf('"') + 1, attr.lastIndexOf('"'));
  t(`载荷无裸引号 ${JSON.stringify(p)}`, !/" /.test(inner) && !inner.includes('"'));
}

// 3) 往返：HTML 实体解码 + JS 单引号字符串解析后，值必须与原文逐字节一致
function htmlDecode(s){
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
for (const p of payloads) {
  const htmlVal = htmlDecode(jq(p));           // 模拟浏览器 HTML 解析
  const restored = vm.runInContext(`'${htmlVal}'`, ctx); // 模拟 JS 解析
  t(`往返一致 ${JSON.stringify(p)}`, restored === p);
}

// 4) jqJ 保留纯 JS 上下文行为（" 转 \"）
t("jqJ双引号转反斜杠", jqJ('a"b') === 'a\\"b');

// 5) 静态：app.js 里不许出现 onclick="..." + 裸 ${}（非 jq/esc/内部常量/数字索引/硬编码徽章ID）
const app = fs.readFileSync(WWW + "/app.js", "utf8");
const bad = [];
const re = /onclick="[^"]*\$\{([^}]*)\}[^"]*"/g;
let m;
while ((m = re.exec(app))) {
  const expr = m[1].trim();
  if (/jq\(/.test(expr)) continue;                            // 含 jq() 转义（cardGapfillNext 数组拼装）
  if (/^(esc|escA)\(/.test(expr)) continue;
  if (/^(o\.oncard|fn|backFn|b\[1\]|close)$/.test(expr)) continue;
  if (/^(i|idx|ci)$/.test(expr)) continue;                    // 数字循环索引
  if (/^(idx|i)\s*,\s*(idx|i)$/.test(expr)) continue;          // pickOption(idx,i) 数字
  if (/^!locked$/.test(expr)) continue;                         // 布尔值
  if (/^b$/.test(expr) && m[0].includes("badgeTip")) continue; // 徽章ID硬编码常量
  bad.push(m[0].slice(0, 80));
}
t("app.js无裸插值onclick", bad.length === 0);
if (bad.length) console.log("  例:", bad.slice(0, 3));

console.log(`xss_attr: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
