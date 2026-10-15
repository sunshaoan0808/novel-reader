// 触控目标 ≥44px 回归（审计清单 8 个选择器）：
//   .charbody.ops button / .kindchip / .tagchip / .aifillbtn / .gochat / .swipe button / .sbtn / .povchip
// 做法：解析 style.css 的规则表，对每个选择器取出所有命中它的规则，
// 按源码顺序取每个尺寸属性的最后一次声明（= 层叠结果），断言命中尺寸 ≥44px。
// 命中高度的两种写法都算：min-height/height 直接撑盒；或 .x::after 上的透明命中扩展
// （.aifillbtn 用后者：外观 23px 的小徽标不能变成压住输入框的 44px 药丸）。
const fs = require("fs");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
const cssText = fs.readFileSync(WWW + "/style.css", "utf8");
let pass = 0, fail = 0;
const t = (n, c, msg) => { c ? pass++ : (fail++, console.log("FAIL:", n, msg || "")); };

/* 去注释；再整块丢掉 @keyframes/@font-face（内层是 from/to 与字面量），
   最后把 @media/@supports 的内层规则提上来 —— 它们在 360x800 下本来就生效，
   按源码顺序参与层叠才是对的。 */
function flatten(src){
  const src2 = src.replace(/\/\*[\s\S]*?\*\//g, "");
  let out = "";
  let buf = "";
  for(let i = 0; i < src2.length; i++){
    const ch = src2[i];
    if(ch === "{"){
      const sel = buf.trim(); buf = "";
      let depth = 1, j = i + 1;
      while(j < src2.length){
        if(src2[j] === "{") depth++;
        else if(src2[j] === "}"){ depth--; if(!depth) break; }
        j++;
      }
      const body = src2.slice(i + 1, j);
      if(sel.startsWith("@")){
        if(!/^@(keyframes|font-face)/.test(sel)) out += flatten(body);
      } else {
        out += sel + "{" + body + "}";
      }
      i = j;
      continue;
    }
    buf += ch;
  }
  return out;
}

const RULES = [];
(function collect(src){
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while((m = re.exec(src)) !== null){
    for(const sel of m[1].split(",")){
      const s = sel.trim();
      if(s) RULES.push({sel: s, decls: m[2]});
    }
  }
})(flatten(cssText));

function lastPart(sel){ const c = sel.trim().split(/\s+/); return c[c.length - 1]; }
function stripPseudo(c){ return c.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, ""); }
function classesOf(c){ return (c.match(/\.[A-Za-z0-9_-]+/g) || []).map(x => x.slice(1)); }
function typeOf(c){
  const m = c.replace(/[.#][^\s]+/g, "");
  const t = m.match(/^[a-zA-Z][A-Za-z0-9-]*/);
  return t ? t[0].toLowerCase() : "";
}
/* 命中判定：最后一段复合选择器要带上目标的类（类型若指定也要一致），
   祖先段按顺序包含目标写的那些（子序列，允许多一层中间层 ——
   审计里的 `.charbody.ops button` 对应样式表里的 `.charbody .ops button`）。 */
function hit(sel, tgt){
  const comps = sel.trim().split(/\s+/);
  const last = stripPseudo(lastPart(sel));
  const cls = new Set(classesOf(last));
  for(const c of (tgt.classes || [])) if(!cls.has(c)) return false;
  if(tgt.type && typeOf(last) !== tgt.type) return false;
  const need = tgt.anc || [];
  let k = 0;
  for(const c of comps.slice(0, -1)) if(k < need.length && stripPseudo(c) === need[k]) k++;
  return k === need.length;
}
/* 层叠：按源码顺序取最后一次声明 */
function cascade(tgt, prop, pseudo){
  let val = null;
  for(const r of RULES){
    if(!!pseudo !== /::after$/.test(lastPart(r.sel))) continue;
    if(!hit(r.sel, tgt)) continue;
    for(const d of r.decls.split(";")){
      const m = d.trim().match(/^([a-z-]+)\s*:\s*(.+)$/);
      if(m && m[1] === prop) val = m[2].trim();
    }
  }
  return val;
}
const px = (v) => (v === null ? null : parseFloat(v));

const TARGETS = [
  {name: ".charbody.ops button", anc: [".charbody"], type: "button"},
  {name: ".kindchip", classes: ["kindchip"]},
  {name: ".tagchip", classes: ["tagchip"]},
  {name: ".aifillbtn", classes: ["aifillbtn"]},
  {name: ".gochat", classes: ["gochat"]},
  {name: ".swipe button", anc: [".swipe"], type: "button"},
  {name: ".sbtn", classes: ["sbtn"]},
  {name: ".povchip", classes: ["povchip"]},
];

for(const tgt of TARGETS){
  // 宽度：min-width 优先，否则固定 width
  const w = [px(cascade(tgt, "min-width", false)), px(cascade(tgt, "width", false))]
    .find(v => v !== null);
  // 高度：min-height / height / ::after 命中扩展，取能撑到的最大值
  const h = [px(cascade(tgt, "min-height", false)), px(cascade(tgt, "height", false)),
             px(cascade(tgt, "height", true))]
    .filter(v => v !== null)
    .reduce((a, b) => Math.max(a, b), 0);
  const okW = w !== null && w >= 44;
  const okH = h >= 44;
  t(`${tgt.name} 命中宽度≥44`, okW, `min-width=${cascade(tgt, "min-width", false)} width=${cascade(tgt, "width", false)}`);
  t(`${tgt.name} 命中高度≥44`, okH, `min-height=${cascade(tgt, "min-height", false)} height=${cascade(tgt, "height", false)} ::after高=${cascade(tgt, "height", true)}`);
  if(okW && okH) console.log(`  PASS  ${tgt.name}  命中 ${w}×${h}px`);
}

console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);