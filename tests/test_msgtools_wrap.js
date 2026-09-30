const fs = require("fs");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// UI-02 回归: 点按消息浮现工具条(msgtools)时, 文字块变宽并向右越界。
// 根因: .msgtools 是不换行的 flex 行, 7 个按钮的固有宽度(~390px)远超消息列宽;
//   消息列 div 又是 .msg(display:flex) 的子项, min-width:auto 顶住不让压缩,
//   列被撑宽 -> 气泡跟着变宽, 超出 .msg{max-width:85%} 后工具条/气泡直接向右溢出
//   (360px 真机实测: 工具条溢出右边界 44~84px)。
// 修法: 1) .msgtools 加 flex-wrap:wrap, 按钮换行, 固有宽度只剩最宽的一颗按钮;
//   2) 消息列加 class="msgcol" + min-width:0, 允许在 .msg 里被压缩, 永不撑破 max-width。
const js = fs.readFileSync(WWW + "/app.js", "utf8");
const css = fs.readFileSync(WWW + "/style.css", "utf8");

let pass = 0, fail = 0;
function ok(name, cond){
  if(cond){ pass++; }
  else { fail++; console.log("FAIL:", name); }
}

// 1) 渲染模板里消息列带 msgcol 类
ok("renderChat wraps who/bubble/tools in .msgcol",
  js.includes('<div class="msgcol"><div class="who">'));

// 2) .msgtools 允许换行
const toolsRule = (css.match(/\.msgtools\s*\{[^}]*\}/) || [""])[0];
ok(".msgtools has flex-wrap:wrap", /flex-wrap\s*:\s*wrap/.test(toolsRule));

// 3) .msgcol 允许被 flex 压缩
const colRule = (css.match(/\.msgcol\s*\{[^}]*\}/) || [""])[0];
ok(".msgcol has min-width:0", /min-width\s*:\s*0/.test(colRule));

// 4) 工具条仍是点按浮现(默认隐藏), 修法没把常显写死
ok(".msgtools default display:none kept", /display\s*:\s*none/.test(toolsRule));
ok(".msg.show-tools .msgtools display:flex kept",
  /\.msg\.show-tools\s+\.msgtools\s*\{[^}]*display\s*:\s*flex/.test(css));

// 5) 工具条(${extra})仍在 msgcol 内部: 顺序 who -> bubble -> ${extra} -> ts -> 闭合
const tpl = js.slice(js.indexOf('<div class="msgcol">'), js.indexOf('<div class="msgcol">') + 600);
const iB = tpl.indexOf('class="bubble"'), iE = tpl.indexOf('${extra}'), iT = tpl.indexOf('${ts}');
ok("msgtools(${extra}) stays inside .msgcol", iB > 0 && iE > iB && iT > iE);

console.log(`test_msgtools_wrap: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
