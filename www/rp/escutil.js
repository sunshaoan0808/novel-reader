/* 全局转义工具：jq(s) —— 用于插进双重上下文的动态值：
 *   HTML 层： "..." 定界的属性（onclick="..." / onchange="..." 等）；
 *   JS 层：属性值里的 '...' 单引号 JS 字符串。
 * 转义规则（顺序重要）：
 *   & < > 先做 HTML 实体转义；\ 和 ' 做 JS 反斜杠转义；
 *   " 必须做 HTML 实体转义（&quot;）——HTML 解析器不认反斜杠，
 *   \" 里的 " 字节仍会截断 "..." 属性（2026-10-13 实测：onmouseover 可被干净注入），
 *   故 " 绝不能只转成 \"。
 * 经此处理的值可安全放入 onclick="f('${jq(x)}')" 这类模板。
 * 纯 JS 字符串上下文（如 <script> 内拼串）请用 jqJ()（" 转 \"）。 */
function jq(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
/* 纯 JS 字符串上下文版（不在 HTML 属性里时用）：" 转 \" */
function jqJ(s){
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
/* HTML 文本/属性通用转义（P2-11 收敛：替代各文件自复制的 esc/escHtml）：
 * 只做 HTML 层实体转义（& < > " '），保留 \n \r 原样——正文/textarea 里的换行
 * 必须保持真实换行，故不能用 jq()（jq 是"HTML属性+JS字符串"双上下文，
 * 会把 \n 变成字面 \\\n、\ 变成 \\\\，只适用于 onclick 模板）。 */
function escH(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
if(typeof window !== "undefined"){ window.jq = jq; window.jqJ = jqJ; window.escH = escH; }
