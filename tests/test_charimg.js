const fs = require("fs");
const WWW = fs.existsSync("assets/www") ? "assets/www" : "www";
// 角色卡画像回归: CHARIMG 覆盖 data.js 全部人物, 文件真实存在,
// charCardHTML 支持 o.img, 详情页挂 charhero, index.html 引入映射表。
const appJs = fs.readFileSync(WWW + "/app.js", "utf8");
const css = fs.readFileSync(WWW + "/style.css", "utf8");
const html = fs.readFileSync(WWW + "/index.html", "utf8");

let pass = 0, fail = 0;
function ok(name, cond){
  if(cond){ pass++; }
  else { fail++; console.log("FAIL:", name); }
}

// 1) 映射表可解析
const window = {};
eval(fs.readFileSync(WWW + "/data/charimg.js", "utf8"));
ok("CHARIMG 已定义", window.CHARIMG && typeof window.CHARIMG === "object");
const keys = Object.keys(window.CHARIMG);
ok("20 个人物全覆盖", keys.length === 20);

// 2) data.js 里每个 run 的每个人物都有图
const dataJs = fs.readFileSync(WWW + "/data.js", "utf8");
const w2 = {};
eval(dataJs.replace("window.__DATA__", "w2.__DATA__"));
const runs = w2.__DATA__.runs;
let missing = [];
for(const rid of Object.keys(runs)){
  const r = runs[rid];
  for(const nm of (r.characters || [])){
    if(!window.CHARIMG[(r.novel || "") + "|" + nm]) missing.push(r.novel + "|" + nm);
  }
}
ok("data.js 人物无缺图" + (missing.length ? " 缺:" + missing.join(",") : ""), missing.length === 0);

// 3) 映射指向的文件真实存在
let nofile = [];
for(const k of keys){
  const p = WWW + "/" + window.CHARIMG[k];
  if(!fs.existsSync(p)) nofile.push(window.CHARIMG[k]);
}
ok("画像文件全部存在" + (nofile.length ? " 缺:" + nofile.join(",") : ""), nofile.length === 0);

// 4) 模板与样式
ok("charCardHTML 渲染 o.img", appJs.includes('(o.img?`<img class="charimg"'));
ok("charImg helper 存在", appJs.includes("function charImg(novel, name)"));
ok("人物列表传入 img", appJs.includes("img:charImg(RUN.novel, p.name)"));
ok("选人页传入 img", appJs.includes("img:charImg(c.novel, c.name)"));
ok("详情页挂 charhero", appJs.includes('class="charhero"'));
ok("CSS 有 .charimg 规则", css.includes(".charcover .charimg"));
ok("CSS 有 .charhero 规则", css.includes(".charhero"));
ok("index.html 引入 charimg.js", html.includes('src="data/charimg.js"'));

console.log(`\ntest_charimg: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
