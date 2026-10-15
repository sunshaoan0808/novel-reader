/* 浮生 v3: 产物浏览器 + 任务管理 + RP 聊天 (纯手机端, 数据内联) */
const $ = (s) => document.querySelector(s);
const view = $("#view"), titleEl = $("#title"), subEl = $("#sub"),
tabs = $("#tabs"), mainnav = $("#mainnav");
let INDEX = [], RUN = null, TAB = "chars", NAV = "product";

/* ---------- 系统返回键 ---------- */
/* 每个页面登记自己的"返回"动作; 顶层页面为 null(此时按返回键直接退出 App)。
   原生层 onBackPressed 会先调 window.__onBackPressed(), 返回 true 表示已消费。 */
let __backAction = null;
window.__onBackPressed = ()=>{
  try{
    const dr = document.getElementById("drawer");
    if(dr && dr.classList.contains("on")){ toggleDrawer(false); return true; }
    if(typeof __backAction === "function"){ __backAction(); return true; }
  }catch(e){}
  return false;
};

/* P2-11: 转义收敛到 rp/escutil.js 的 escH()（index.html 最先加载 escutil；测试 vm 里同样先加载）。
   独立加载场景无 escH 时回退同款实现。不用 jq()：那是"HTML属性+JS字符串"双上下文，
   会把正文换行变成字面 \n、反斜杠加倍，只适用于 onclick 模板。 */
const esc = (typeof escH !== "undefined") ? escH : function(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));};

/* ---------- 极简 markdown ---------- */
function md(src){
const lines = String(src||"").split("\n");
let html = "", inList = false;
const inline = (t)=> esc(t)
.replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")
.replace(/`(.+?)`/g,"<code>$1</code>");
for(const ln of lines){
const s = ln.trimEnd();
if(/^#{1,3}\s/.test(s)){
if(inList){html+="</ul>";inList=false;}
const lv = s.match(/^#+/)[0].length;
html += `<h${lv}>${inline(s.replace(/^#+\s*/,""))}</h${lv}>`;
}else if(/^>\s?/.test(s)){
if(inList){html+="</ul>";inList=false;}
html += `<blockquote>${inline(s.replace(/^>\s?/,""))}</blockquote>`;
}else if(/^[-*]\s/.test(s)){
if(!inList){html+="<ul>";inList=true;}
html += `<li>${inline(s.replace(/^[-*]\s/,""))}</li>`;
}else if(/^\d+[.)]\s/.test(s)){
if(!inList){html+="<ul>";inList=true;}
html += `<li>${inline(s.replace(/^\d+[.)]\s/,""))}</li>`;
}else if(s.trim()===""){
if(inList){html+="</ul>";inList=false;}
}else{
if(inList){html+="</ul>";inList=false;}
html += `<p>${inline(s)}</p>`;
}
}
if(inList) html+="</ul>";
return html;
}

/* ---------- 顶层导航 ---------- */
function setNav(n){
NAV = n;
try{ msgSheet(false); }catch(e){} /* L2: 切页时关消息菜单，背景压暗回 chat */
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
mainnav.querySelectorAll("button").forEach(b=>
b.classList.toggle("active", b.dataset.nav===n));
window.scrollTo(0,0);
if(n==="product"){ tabs.classList.toggle("hidden",!RUN); RUN? setTab(TAB,true): showRuns();}
else if(n==="tasks"){ setNav("distill"); }
else if(n==="chat"){ tabs.classList.add("hidden"); (CHAT.name||CHAT.mode==="traverse"||CHAT.mode==="group") ? showChat() : showChatPicker(); }
else if(n==="traverse"){ tabs.classList.add("hidden"); showTraverse(); }
else if(n==="settings"){ tabs.classList.add("hidden"); showSettings();}
else if(n==="writer"){ tabs.classList.add("hidden"); showWriter();}
else if(n==="distill"){ tabs.classList.add("hidden"); titleEl.textContent="蒸馏"; subEl.textContent="手机端独立蒸馏"; DISTILL_UI.show(); }
}
mainnav.querySelectorAll("button").forEach(b=>
b.addEventListener("click", ()=>setNav(b.dataset.nav)));

async function boot(){
const D = window.__DATA__;
if(!D ||!D.index){
view.innerHTML = `<div class="empty">数据未生成<br><span style="font-size:calc(12px * var(--fs))">请先运行 snapshot.py</span></div>`;
return;
}
INDEX = D.index;
showRuns();
}

/* ================= 产物浏览 (原有) ================= */
function showRuns(){
__backAction = null;
titleEl.textContent = "浮生";
subEl.textContent = `${INDEX.length} 个蒸馏任务 · 离线浏览`;
if(!INDEX.length){ view.innerHTML = `<div class="empty">暂无任务</div>`; return; }
view.innerHTML = `<div class="bookwall">` + INDEX.map(r=>{
const cover = (window.BOOKCOVER||{})[r.novel];
const coverHtml = cover
  ? `<img class="bw-cover" src="${esc(cover)}" alt="${esc(r.novel)}封面" loading="lazy" onerror="this.src='bg/book_cover_default.jpg'">`
  : `<div class="bw-cover-default"><img src="bg/book_cover_default.jpg" alt=""><span>${esc(r.novel)}</span></div>`;
return `
<div class="bw-card" onclick="openRun('${jq(r.run_id)}')">
${coverHtml}
<div class="bw-info">
<div class="bw-name">${esc(r.novel)}</div>
<div class="bw-meta">${r.characters.length} 角色${r.has_plot?" · 剧情":""}${r.has_worldcard?" · 世界卡":""}</div>
</div>
</div>`;}).join("") + `</div>`;
}

function openRun(runId){
/* P2-4: data.js 截断/损坏时给可读提示（与 boot 一致），不许 TypeError 白屏 */
const D = window.__DATA__;
if(!D || !D.runs){ view.innerHTML = `<div class="empty">数据未生成<br><span style="font-size:calc(12px * var(--fs))">请先运行 snapshot.py</span></div>`; return; }
RUN = D.runs[runId];
if(!RUN){ view.innerHTML = `<div class="empty">该任务数据缺失</div>`; return;}
tabs.classList.remove("hidden");
setTab("chars");
}

function setTab(t, keep){
__backAction = null;
TAB = t;
tabs.querySelectorAll("button").forEach(b=>
b.classList.toggle("active", b.dataset.tab===t));
titleEl.textContent = RUN.novel;
subEl.textContent = `${RUN.run_id} · ${RUN.n_chunks} 块`;
if(t==="chars") showChars();
else if(t==="outline") showOutline();
else if(t==="relations") showRelations();
else if(t==="storyline") showStoryline();
else if(t==="world") showWorldcard();
else showMore();
prependRunBanner();
}
/* 书封面横幅：run 详情各 tab 顶部统一展示（无封面则不展示） */
function prependRunBanner(){
try{
const cover = (window.BOOKCOVER||{})[RUN.novel];
if(!cover || !view) return;
if(view.firstElementChild && view.firstElementChild.classList.contains("runbanner")) return;
view.insertAdjacentHTML("afterbegin",
`<div class="runbanner"><img src="${esc(cover)}" alt="${esc(RUN.novel)}封面" loading="lazy" onerror="this.closest('.runbanner').remove()"></div>`);
}catch(e){}
}
tabs.querySelectorAll("button").forEach(b=>
b.addEventListener("click", ()=>setTab(b.dataset.tab)));

/* 横滑轨道两端渐隐（P0-12 顶部标签行 / P1-23 chips 轨道）。
   纯 CSS 不知道轨道还有没有内容，所以用一个轻量 scroll/resize 监听维护
   .xedge-l / .xedge-r 两个类，由 CSS 变量把 mask 的渐隐长度在 0↔28px 之间切。
   scroll-snap 让一格一格停，触屏不再"滑到一半不知道停哪"。 */
function bindEdgeFade(el, snap){
  if(!el || el.__edgeFadeBound) return;
  el.__edgeFadeBound = true;
  if(snap) el.classList.add("xsnap");
  const upd = ()=>{
    const over = el.scrollWidth - el.clientWidth;
    el.classList.toggle("xedge-l", over > 2 && el.scrollLeft > 2);
    el.classList.toggle("xedge-r", over > 2 && el.scrollLeft < over - 2);
  };
  el.addEventListener("scroll", upd, {passive:true});
  if(typeof ResizeObserver === "function") new ResizeObserver(upd).observe(el);
  setTimeout(upd, 0);
  el.__edgeFadeUpdate = upd;
}
window.bindEdgeFade = bindEdgeFade;
window.refreshEdgeFades = (root)=>{
  (root||document).querySelectorAll("[data-xfade]").forEach(el=>{
    if(el.__edgeFadeUpdate) el.__edgeFadeUpdate();
  });
};
bindEdgeFade(tabs, true);   /* #tabs：6 个标签在 360px 下放不下，"更多"被硬切 */

function tagline(p){
/* 兼容两种档案格式: 红楼 `- **core_identity**: ...` / 水浒 `- core_identity: ...` */
const m = p.md.match(/(?:\*\*)?core_identity(?:\*\*)?:\s*([^\n]+)/)
|| p.md.match(/(?:\*\*)?core_traits(?:\*\*)?:\s*([^\n]+)/);
if(!m) return "";
const s = m[1].trim();
if(s.length <= 46) return s;
/* 按标点截断，避免"门户的…"这种半截词；CSS line-clamp 负责补 … */
const cut = s.slice(0, 46);
const pm = cut.match(/.*[，。；、！？]/);
return pm ? pm[0] : cut;
}
/* Janitor 式角色卡片网格 (v24) */
function charCoverCls(name){ let h=0; const s2=String(name||"?"); for(let i=0;i<s2.length;i++) h=(h*31+s2.charCodeAt(i))>>>0; return "cc"+(h%4); }
/* P2-26：alt 原本一律空串，读屏只会念一串"图片"。有真画像就给名字；
   默认剪影（avatar_default.jpg）是纯装饰 —— 名字就在下方正文里，标 aria-hidden 不重复朗读。
   注：这段注释不能塞进下面 return 的 `+` 链中间 —— 注释两侧的 `+` 会被解析成一元正号。 */
function charCardHTML(o){
return `<div class="charcard">`
+ (o.oncard?`<button type="button" class="charcard-hit" aria-label="${esc(o.name)}" onclick="${o.oncard}"></button>`:"")
+ `<div class="charcover ${charCoverCls(o.name)}">`
+ (o.tag?`<div class="tag">${esc(o.tag)}</div>`:"")
 + (o.img?`<img class="charimg" src="${esc(o.img)}" alt="${esc(o.name)}的画像" loading="lazy" onerror="this.src='bg/avatar_default.jpg'">`
        :`<img class="charimg" src="bg/avatar_default.jpg" alt="" aria-hidden="true">`)
+ `</div>`
+ `<div class="charbody"><div class="n">${esc(o.name)}</div>`
+ (o.stat?`<div class="statline">${esc(o.stat)}</div>`:"")
+ `<div class="s"${o.sum ? ` title="${esc(o.sum)}"` : ""}>${esc(o.sum||"")}</div>`
+ (o.ops?`<div class="ops">${o.ops}</div>`:"")
+ `</div></div>`;
}
// 角色卡画像: 查 window.CHARIMG (www/data/charimg.js), 无图返回 ""
function charImg(novel, name){
const m = window.CHARIMG||{};
return m[(novel||"")+"|"+(name||"")]||"";
}
function charSumFor(runId, name){
try{
if(runId==="custom"){
const c=(RP_WRITER.getCustomChars()||[]).find(x=>x.name===name);
if(c&&c.fields&&c.fields.core_identity) return String(c.fields.core_identity).slice(0,46);
}
const cards=((window.__DATA__&&window.__DATA__.rp_cards)||{})[runId]||[];
const cd=cards.find(x=>x.name===name);
if(cd){ const d=cd.description||cd.personality||""; if(d) return String(d).slice(0,46); }
const run=((window.__DATA__||{}).runs||{})[runId]||{};
const p=(run.profiles||[]).find(x=>x.name===name);
if(p) return tagline(p);
}catch(e){}
return "";
}
function showChars(){
const q = `<div class="searchwrap"><input id="q" placeholder="搜索人物…" oninput="filterChars(this.value)"></div>`;
view.innerHTML = `<div class="btnrow" style="margin-bottom:10px"><button class="btn ghost" onclick="groupPicker()">${icon("users")} 发起群聊</button></div>`
+ q + `<div id="clist">` + charList(RUN.profiles) + `</div>`;
}
/* B8 群聊成员来源。蒸馏 run 走 RUN.profiles; 导入卡组队走 allChars() 里的 imported 卡。
 * 两个入口共用 GROUP_CTX + startGroupChat, 所以 CHAT.runId 不再硬取 RUN.run_id ——
 * 导入卡群聊压根没有 run, CHAT.runId 恒为 "imported", 而 RP.findCard("imported", name)
 * 有专门分支(rp/chat.js), 群聊 prompt / soul / 世界书都能照常解析到卡, 不需要真 run。
 * allChars() 里的其它 runId(蒸馏 runId / custom)不混进来: 群聊只有一个 CHAT.runId,
 * 混编会让 findCard 用错源去查名字。 */
let GROUP_CTX = {runId:null, members:[], label:"", back:null};
/* 群聊可选成员卡片(两个入口共用渲染): pool 已是 {name, novel} 列表 */
function groupPickCards(pool){
  return pool.map(p=>`<label class="pickcard"><input type="checkbox" value="${esc(p.name)}">
<div class="avatar sm">${esc(p.name[0])}</div><div class="name">${esc(p.name)}</div>
${p.novel?`<div class="meta">${esc(p.novel)}</div>`:""}</label>`).join("");
}
window.groupPicker = ()=>{
__backAction = ()=>setTab("chars");
GROUP_CTX = {runId: RUN.run_id, members: RUN.profiles.map(p=>p.name), label: RUN.novel, back: ()=>setTab("chars")};
titleEl.textContent = "选择群聊成员"; subEl.textContent = RUN.novel + " · 至少选 2 人";
view.innerHTML = `<button class="back" onclick="setTab('chars')">${icon("back")} 返回人物</button>
<div id="gpick">` + groupPickCards(RUN.profiles.map(p=>({name:p.name, novel:""}))) + `</div>
<div class="field"><label>角色关系（可选，每行一条，格式：A是B的C）${RP_AIFILL.btn("grel_in","群聊角色关系","每行一条，格式：A是B的C，3~6条","群聊成员："+RUN.profiles.map(p=>p.name).join("、")+"；小说《"+RUN.novel+"》")}</label>
<textarea id="grel_in" rows="2" placeholder="林黛玉是贾宝玉的表妹"></textarea></div>
<div class="hint" style="margin:0 0 6px">关系会注入每轮群聊 prompt；建群后也可在群聊抽屉 → 角色关系里增删。</div>
<div class="actionbar"><button class="btn" style="flex:1" onclick="startGroupChat()">开始群聊</button></div>
<div style="height:76px"></div>`;
window.scrollTo(0,0);
};
/* 与其它导入卡组队 (B8): 成员来自 allChars() 里的导入卡, 不依赖任何蒸馏 run。
 * 导入卡之间没有共用的原著产物(静态关系/章节/世界卡), 这里直说 —— 不编造, 也不假装是故障。 */
window.importedGroupPicker = ()=>{
const pool = (allChars() || []).filter(c => c.runId === "imported");
if(pool.length < 2){
__backAction = ()=>showChatPicker();
titleEl.textContent = "与其它导入卡组队"; subEl.textContent = "";
view.innerHTML = `<button class="back" onclick="showChatPicker()">${icon("back")} 返回</button>
<div class="empty">导入卡还不足 2 张<br>
<span style="font-size:calc(12px * var(--fs))">群聊至少需要 2 个角色。去「写卡 / 导入」再加一张。</span>
<br><button class="btn" style="margin-top:10px" onclick="setNav('writer')">去写卡</button></div>`;
window.scrollTo(0,0);
return;
}
__backAction = ()=>showChatPicker();
GROUP_CTX = {runId: "imported", members: pool.map(c=>c.name), label: "导入卡", back: ()=>showChatPicker()};
titleEl.textContent = "与其它导入卡组队"; subEl.textContent = "导入卡 · 至少选 2 张";
view.innerHTML = `<button class="back" onclick="showChatPicker()">${icon("back")} 返回</button>
<div id="gpick">` + groupPickCards(pool) + `</div>
<div class="field"><label>角色关系（可选，每行一条，格式：A是B的C）${RP_AIFILL.btn("grel_in","群聊角色关系","每行一条，格式：A是B的C，3~6条","群聊成员："+pool.map(c=>c.name).join("、")+"；均为导入卡，没有共同原著")}</label>
<textarea id="grel_in" rows="2" placeholder="A是B的师兄"></textarea></div>
<div class="hint" style="margin:0 0 6px">关系会注入每轮群聊 prompt；建群后也可在群聊抽屉 → 角色关系里增删。导入卡之间没有共用的静态人物关系，这里写什么就是什么，AI 不会替你补。</div>
<div class="actionbar"><button class="btn" style="flex:1" onclick="startGroupChat()">开始群聊</button></div>
<div style="height:76px"></div>`;
window.scrollTo(0,0);
};
window.startGroupChat = ()=>{
const sel = Array.from(document.querySelectorAll("#gpick input:checked")).map(i=>i.value);
/* 只认 GROUP_CTX.members 里有的名字: 页面上的复选框就是这些, 但仍做一次交集,
   避免 GROUP_CTX 与 DOM 不同步时把陌生名字写进群成员。 */
const ok = sel.filter(n => GROUP_CTX.members.indexOf(n) >= 0);
if(sel.length < 2){ alert("至少选 2 个人才能群聊"); return; }
if(ok.length !== sel.length){ alert("选中的成员已失效，请重新进入选择"); return; }
if(!GROUP_CTX.runId){ alert("群聊成员来源已失效，请重新进入"); return; }
/* runId 取自 GROUP_CTX（蒸馏 run 的 RUN.run_id, 或导入卡组的 "imported"），不再硬置 */
CHAT = {mode:"group", runId: GROUP_CTX.runId, name:null, members: ok, forcedSpeaker:null};
/* Tier3-22: 建群时可选设定角色关系（"A是B的C" 每行一条），注入群聊 prompt */
try{
const gkey = ok.slice().sort().join("_");
const relText = ((document.getElementById("grel_in")||{}).value || "").trim();
if(relText && typeof RP_GROUP!=="undefined"){
const pr = RP_GROUP.parseRelLines(relText, ok);
pr.ok.forEach(r=>RP_GROUP.addRel(CHAT.runId, gkey, r.a, r.b, r.rel));
if(pr.bad) alert("已设定 " + pr.ok.length + " 条角色关系，" + pr.bad + " 行格式不对被跳过（正确格式：A是B的C）。");
}
}catch(e){}
loadPov();
setNav("chat");
};
function charList(ps){
if(!ps.length) return `<div class="empty"><span class="big">${icon("masks",44)}</span>暂无人物卡</div>`;
return `<div class="chargrid">` + ps.map(p=>{let _st2="";
try{
if(typeof RP_STATS !== "undefined"){
const _s2 = RP_STATS.get(RUN.run_id, p.name);
if(_s2.s > 0) _st2 = "开局" + _s2.s + "次 · 平均" + RP_STATS.avgTurns(_s2).toFixed(0) + "轮/局";
}
}catch(e){}
return charCardHTML({
name:p.name, tag:RUN.novel, img:charImg(RUN.novel, p.name), sum:tagline(p)||"人物档案", stat:_st2,
oncard:`openChar('${jq(p.name)}')`,
ops:`<button class="go" onclick="event.stopPropagation();chatWith('${jq(RUN.run_id)}','${jq(p.name)}')">开聊</button>`
+`<button onclick="event.stopPropagation();openChar('${jq(p.name)}')">详情</button>`
});}).join("") + `</div>`;
}
window.filterChars = (kw)=>{
const items = RUN.profiles.filter(p=>p.name.includes(kw));
$("#clist").innerHTML = charList(items);
};
window.openChar = (name)=>{
__backAction = ()=>setTab("chars");
const p = RUN.profiles.find(x=>x.name===name);
titleEl.textContent = p.name; subEl.textContent = RUN.novel;
const cimg = charImg(RUN.novel, p.name);
view.innerHTML = `<button class="back" onclick="setTab('chars')">${icon("back")} 返回人物</button>
${cimg?`<img class="charhero" src="${esc(cimg)}" alt="${esc(p.name)}画像" onerror="this.remove()">`:""}
<div class="btnrow" style="margin-bottom:10px"><button class="btn ghost" onclick="genPortrait('${jq(RUN.run_id)}','${jq(p.name)}')">${icon("palette")} 生成立绘</button></div>
<div class="card md">${md(p.md)}</div>
${charForetell(p.name)}
<div style="height:76px"></div>
<div class="actionbar"><button class="btn" style="flex:1" onclick="chatWith('${jq(RUN.run_id)}','${jq(p.name)}')">和 ${esc(p.name)} 聊天</button></div>`;
window.scrollTo(0,0);
};

function showOutline(){
const secs = RUN.sections.map((s,i)=>`
<div class="sec-card"><div class="sec-num">${i+1}</div>
<div><div class="t">${esc(s.title)}</div>
<div class="r2">${esc(s.chunk_range||"")}</div></div></div>`).join("");
view.innerHTML = `
${RUN.outline_md?`<div class="card md">${md(RUN.outline_md)}</div>`:""}
<h2 class="sec">分段大纲 · ${RUN.sections.length} 段</h2>
${secs || `<div class="empty">暂无分段大纲</div>`}`;
}

function showRelations(){
view.innerHTML = RUN.relations.map(r=>{
const m = r.metrics||{};
const bar = (label,v)=> v==null?"":`
<div class="kv"><span>${label}</span><span>${Math.round(v*100)}%</span></div>
<div class="meter"><i style="width:${Math.round(v*100)}%"></i></div>`;
const badges = [
r.co_occurrence_count?`<span class="badge">同现 ${r.co_occurrence_count} 次</span>`:"",
(r.valid_chapters&&r.valid_chapters.length)?`<span class="badge">${esc(String(r.valid_chapters[0]))}–${esc(String(r.valid_chapters[r.valid_chapters.length-1]))} 回</span>`:""
].join("");
return `<div class="rel">
<div class="rel-top">
<div class="avatar">${esc((r.source_character||"")[0]||"人")}</div>
<div style="flex:1"><div class="pair">${esc(r.source_character)} ↔ ${esc(r.target_character)}</div></div>
<div class="avatar">${esc((r.target_character||"")[0]||"人")}</div>
</div>
<div class="sum">${esc(r.relationship_summary||"")}</div>
${bar("信任",m.trust_level)}${bar("好感",m.affection_level)}${bar("冲突",m.conflict_potential)}
${badges?`<div class="rel-badges">${badges}</div>`:""}
</div>`;
}).join("") || `<div class="empty">暂无关系数据</div>`;
}

/* ============ P0 红学三项展示 (run 侧已蒸馏, App 只做展示, 不进 prompt) ============ */
function methodologyCard(){
if((RUN||{}).run_id !== "honglou_full") return ""; /* P0 红学三项红楼专属 */
const mo = RUN.methodology;
if(!mo) return "";
const layers = (mo.layers||[]).map(l=>`<div class="st">· ${esc(l)}</div>`).join("");
const unc = (mo.uncovered||[]).map(u=>`<span class="badge">${esc(u)}</span>`).join("");
const moFull = `<div class="kv"><span>文本边界</span></div><div class="st">${esc(mo.boundary||"")}</div>
<div class="kv"><span>学派站位</span></div><div class="st">${esc(mo.school||"")}</div>
<div class="kv"><span>三层隔离</span></div>${layers}
<div class="kv"><span>有意不做</span></div><div class="wb-keys">${unc}</div>
<div class="meta">后四十回相关内容一律标注版本边界，不采信情节。</div>`;
return `<div class="card"><div class="name">版本与方法论</div>
<div class="st">前八十回通行本为界，不采程高后四十回；只做人物与情节蒸馏；L1 实证 / L2 引用 / L3 推测三层隔离。</div>
<button class="foldtoggle" onclick="var d=this.nextElementSibling;var h=d.classList.toggle('hidden');this.textContent=h?'展开全文':'收起';return false;">展开全文</button>
<div class="hidden">${moFull}</div></div>`;
}
function foretellHtml(){
if((RUN||{}).run_id !== "honglou_full") return ""; /* P0 红学三项红楼专属 */
const ft = RUN.foretell;
if(!ft || !ft.items || !ft.items.length) return "";
/* 同文本合并展示（如黛玉/宝钗合用一首判词）：只做展示层合并，数据不动 */
const merged = []; const seen = {};
ft.items.forEach(it=>{
const k = (it.text||"").replace(/\s+/g,"");
if(seen[k]){
const m = seen[k];
(it.characters||[]).forEach(c=>{ if(m.characters.indexOf(c)<0) m.characters.push(c); });
m.merged = true;
}else{
const c = Object.assign({}, it, {characters:(it.characters||[]).slice(), merged:false});
seen[k] = c; merged.push(c);
}
});
const items = merged.map(it=>{
const links = (it.foreshadowing_links||[]).length;
const title = it.merged ? it.characters.join("、") + "判词" : (it.title||"");
const note = it.merged ? "" : it.note;
return `<div class="rel"><div class="pair">${esc(title)}</div>
<div class="wb-keys"><span class="badge">${esc(it.type||"")}</span><span class="badge">${esc(it.collection||"")}</span>${links?`<span class="badge">应验链接 ${links}</span>`:""}</div>
<div class="st">${esc(it.text||"").replace(/\n/g,"<br>")}</div>
${note?`<div class="meta">${esc(note)}</div>`:""}</div>`;
}).join("");
return `<h2 class="sec">判词·红楼梦曲 · ${ft.items.length}</h2>`
+ `<div class="meta">曹雪芹原文内置预告（L1 文本实证），判词原文以第五回为准；应验链接指向伏笔条目。</div>` + items;
}
function zhipiHtml(){
if((RUN||{}).run_id !== "honglou_full") return ""; /* P0 红学三项红楼专属 */
const zp = RUN.zhipi;
if(!zp || !zp.items || !zp.items.length) return "";
const items = zp.items.map(it=>{
const beyond = !!it.reveals_beyond_scope;
return `<div class="rel"><div class="st">“${esc(it.text||"")}”</div>
<div class="wb-keys"><span class="badge">${esc(it.edition||"")}</span><span class="badge">${esc(it.chapter_ref||"")}</span>${beyond?`<span class="badge">版本边界</span>`:""}</div>
${(!beyond && it.relates_to)?`<div class="meta">关联：${esc(it.relates_to)}</div>`:""}
${beyond?`<div class="meta">透露八十回后情节，仅收录批语原文，不采信情节。</div>`:""}
${it.note?`<div class="meta">${esc(it.note)}</div>`:""}</div>`;
}).join("");
return `<h2 class="sec">脂批 · ${zp.items.length}</h2>`
+ `<div class="meta">清代脂批原文（公有领域），仅引用，不代表立场；不做身份考证。</div>` + items;
}
/* 人物详情页关联判词 */
function charForetell(name){
if((RUN||{}).run_id !== "honglou_full") return ""; /* P0 红学三项红楼专属 */
const ft = RUN.foretell;
if(!ft || !ft.items) return "";
const mine = ft.items.filter(it=>(it.characters||[]).indexOf(name)>=0);
if(!mine.length) return "";
return `<h2 class="sec">判词·红楼梦曲</h2>` + mine.map(it=>
`<div class="card"><div class="name">${esc(it.title||"")}</div>`
+ `<div class="wb-keys"><span class="badge">${esc(it.type||"")}</span><span class="badge">${esc(it.collection||"")}</span></div>`
+ `<div class="st">${esc(it.text||"").replace(/\n/g,"<br>")}</div></div>`).join("");
}

/* 2026-10-07: 因果事件 DAG 剧情线 (蒸馏管线 event_dag.json, 启发式)。
 * 懒加载 www/data/event_dag_<run_id>.js, 主干路径渲染为时间线。 */
let _dagCache = {};
function showStoryline(){
  const runId = RUN.run_id;
  view.innerHTML = skeletonHTML(3);
  const render = (dag, failed)=>{
    if(!dag || !dag.nodes || !dag.nodes.length){
      /* P2-5: 加载失败 ≠ 确实没有数据，分开文案并给重试 */
      view.innerHTML = failed
        ? `<div class="empty">剧情线数据加载失败<br><span style="font-size:calc(12px * var(--fs))">文件缺失或读取出错</span><br><button class="btn ghost" style="margin-top:10px" onclick="showStoryline()">重试</button></div>`
        : `<div class="empty">暂无剧情线数据</div>`;
      return;
    }
    const byId = {};
    dag.nodes.forEach(n=>{ byId[n.id] = n; });
    const paths = (dag.main_paths || []).slice(0, 3);
    const head = `<div class="card"><div class="kvline"><b>事件节点</b>：${dag.nodes.length} 个</div>`
      + `<div class="kvline"><b>因果边</b>：${(dag.edges || []).length} 条</div>`
      + `<div class="kvline"><b>主干剧情线</b>：${paths.length} 条</div>`
      + `<div style="color:var(--muted,#888);font-size:calc(12px * var(--fs));margin-top:6px">启发式因果图（关键词重叠+转折点加成），非人工定稿</div></div>`;
    const body = paths.map((p, pi)=>{
      const items = p.node_ids.map((nid)=>{
        const n = byId[nid] || {};
        const tp = n.kind === "turning_point";
        return `<div class="tl-item${tp ? " tp" : ""}">`
          + `<div class="tl-dot">${tp ? "◆" : "●"}</div>`
          + `<div class="tl-body"><div class="tl-text">${esc(n.text || "")}</div>`
          + `<div class="tl-meta">${esc(n.chunk_id || "")}${tp ? ' <span class="badge">转折点</span>' : ""}</div>`
          + `</div></div>`;
      }).join("");
      return `<h2 class="sec">主干 ${["一","二","三"][pi] || (pi+1)} · ${p.length} 个事件</h2>`
        + `<div class="tl">${items}</div>`;
    }).join("");
    view.innerHTML = head + body;
    window.scrollTo(0, 0);
  };
  if(_dagCache[runId]){ render(_dagCache[runId]); return; }
  /* file:// 下 fetch 不可用, 用 script 标签动态加载 (export 写 window.__DAG_<run_id>) */
  var gk = "__DAG_" + runId;
  if(window[gk]){ _dagCache[runId] = window[gk]; render(window[gk]); return; }
  var s = document.createElement("script");
  s.src = "data/event_dag_" + encodeURIComponent(runId) + ".js";
  s.onload = function(){ var dag = window[gk] || null; _dagCache[runId] = dag; if(TAB === "storyline") render(dag); };
  s.onerror = function(){ if(TAB === "storyline") render(null, true); };
  document.head.appendChild(s);
}

/* 事件日历懒加载（file:// 下用 script 标签），穿越事件选择器用 */
let _calCache = {};
let _calFailed = {}; /* P2-5: 加载失败标记——区分"加载失败"与"确实没有日历" */
function loadEventCal(runId){
  if(!runId) return Promise.resolve(null);
  if(_calCache[runId]) return Promise.resolve(_calCache[runId]);
  var gk = "__EVENTCAL_" + runId;
  if(window[gk]){ _calCache[runId] = window[gk]; return Promise.resolve(window[gk]); }
  return new Promise(function(resolve){
    var s = document.createElement("script");
    s.src = "data/event_calendar_" + encodeURIComponent(runId) + ".js";
    s.onload = function(){ var cal = window[gk] || null; _calCache[runId] = cal; _calFailed[runId] = false; resolve(cal); };
    s.onerror = function(){ _calFailed[runId] = true; resolve(null); };
    document.head.appendChild(s);
  });
}
/* 2026-10-07: 世界卡 (蒸馏管线 worldcard.json)。
 * 懒加载 www/data/worldcard_<run_id>.js, 渲染世界概览/导演蓝图/世界书检索/次要人物/道具。 */
let _wcCache = {};
let _wcData = null;
let _wcFailed = {}; /* P2-5: 加载失败标记——区分"加载失败"与"确实没有世界卡" */
/* 世界卡懒加载（file:// 下用 script 标签），世界 tab 与导演系统共用 */
function loadWorldcard(runId){
  if(!runId) return Promise.resolve(null);
  /* 导入卡共用 runId="imported", 蒸馏管线只给 __DATA__.runs 里的 run 出 worldcard_*.js,
     这里发请求必然 404。导演与世界 tab 已经走"无蓝图"分支(rp/director.js worldcardBrief),
     短路掉这一次注定失败的 script 加载; 调用点(聊天预热/世界 tab/魂穿开局)一并覆盖。 */
  if(runId === "imported") return Promise.resolve(null);
  var gk = "__WORLDCARD_" + runId;
  if(window[gk]){ _wcCache[runId] = window[gk]; return Promise.resolve(window[gk]); }
  return new Promise(function(res){
    var s = document.createElement("script");
    s.src = "data/worldcard_" + encodeURIComponent(runId) + ".js";
    s.onload = function(){ var wc = window[gk] || null; _wcCache[runId] = wc; res(wc); };
    s.onerror = function(){ _wcFailed[runId] = true; res(null); };
    document.head.appendChild(s);
  });
}
/* P2-5: 世界卡加载失败后的重试——清失败标记与缓存，重新拉一遍 */
window.retryWorldcard = ()=>{
  const runId = RUN && RUN.run_id;
  delete _wcFailed[runId]; delete _wcCache[runId];
  try{ delete window["__WORLDCARD_" + runId]; }catch(e){}
  showWorldcard();
};
function getWorldcard(runId){
  if(!runId) return null;
  return _wcCache[runId] || window["__WORLDCARD_" + runId] || null;
}
/* 导演"无蓝图"提示 (B14): 原著因果蓝图(worldcard)只随蒸馏剧本自带, 导入卡/自创卡没有。
   rp/director.js 的 worldcardBrief 此时返回空串, 导演照常按通用模式编排 —— 这不是故障,
   界面上说清楚, 免得用户以为导演坏了。 */
function noBlueprintNote(runId){
  try{
    if(runId && getWorldcard(runId) &&
       ((getWorldcard(runId).directorDefinitions||[]).length)) return "";
    const idx = (((window.__DATA__||{}).index)||[]).find(r=>r && r.run_id===runId);
    if(idx && idx.has_worldcard) return "";
  }catch(e){}
  return "当前无原著因果蓝图（仅蒸馏剧本自带）：导演按通用模式编排剧情节奏，不引用原著事件。";
}
/* 骨架屏占位：n 个 shimmer 条，替换纯文字"加载中…" */
function skeletonHTML(n){
  n = Math.max(1, Math.min(6, n || 3));
  const ws = [94, 82, 88, 76];
  let h = `<div class="skelwrap" aria-hidden="true">`;
  for(let i=0;i<n;i++) h += `<div class="skel" style="width:${ws[i%ws.length]}%"></div>`;
  return h + `</div>`;
}
/* 世界卡 coverage.gaps 管线黑话 → 用户可读文案 */
function humanizeGap(g){
  let s = String(g == null ? "" : g);
  const m = s.match(/主题层未命中(.+?)关键词/);
  if(m){
    const kinds = m[1].replace(/economy\/culture/g, "经济/文化").replace(/\//g, "、");
    return kinds + "相关描写较少，世界书暂未收录";
  }
  s = s.replace(/(\d+)\s*个?\s*chunk/gi, "$1 段文本");
  return s;
}
function showWorldcard(){
  const runId = RUN.run_id;
  _wcData = null;
  view.innerHTML = skeletonHTML(4);
  const typeName = {setting:"世界概览",lore:"世界暗线",npcs:"次要人物",factions:"阵营",items:"道具",rules:"世界规则",economy:"经济",culture:"文化"};
  const render = (wc)=>{
    if(!wc || !wc.worldBookEntries){
      /* P2-5: 加载失败 ≠ 确实没有数据，分开文案并给重试 */
      view.innerHTML = _wcFailed[runId]
        ? `<div class="empty">世界卡数据加载失败<br><span style="font-size:calc(12px * var(--fs));color:var(--muted,#888)">文件缺失或读取出错</span><br><button class="btn ghost" style="margin-top:10px" onclick="retryWorldcard()">重试</button></div>`
        : `<div class="empty">暂无世界卡数据<br><span style="font-size:calc(12px * var(--fs));color:var(--muted,#888)">管线执行 worldcard 阶段后自动出现</span></div>`;
      prependRunBanner();
      return;
    }
    _wcData = wc;
    const entries = wc.worldBookEntries;
    const dd = (wc.directorDefinitions||[])[0] || {};
    const stages = dd.stages||[], nodes = dd.nodes||[], actors = dd.characters||[];
    const gaps = (dd.coverage||{}).gaps||[];
    const types = {};
    entries.forEach(e=>{ (types[e.entryType]=types[e.entryType]||[]).push(e); });
    const head = `<div class="card"><div class="kvline"><b>${esc(wc.name||"世界卡")}</b> `
      + `<span class="badge" title="世界卡对原著内容的覆盖情况">${wc.novelMaterialStatus==="complete"?"完整":"部分覆盖"}</span></div>`
      + `<div class="statgrid">`
      + `<div class="stat"><div class="v">${entries.length}</div><div class="k">世界书</div></div>`
      + `<div class="stat"><div class="v">${stages.length}</div><div class="k">导演分幕</div></div>`
      + `<div class="stat"><div class="v">${nodes.length}</div><div class="k">剧情节点</div></div>`
      + `<div class="stat"><div class="v">${actors.length}</div><div class="k">演员</div></div>`
      + `</div>`
      + (gaps.length?`<div class="kvline" style="color:var(--muted,#888);font-size:calc(12px * var(--fs))">待补：${esc(gaps.slice(0,3).map(humanizeGap).join("；"))}${gaps.length>3?"…":""}</div>`:"")
      + `</div>`;
    const conflict = dd.coreConflict
      ? `<h2 class="sec">核心冲突</h2><div class="card"><div class="st">${esc(dd.coreConflict)}</div>`
        + ((dd.anchors||[]).length?`<div class="wb-keys">${dd.anchors.map(a=>`<span class="badge">${esc(a)}</span>`).join("")}</div>`:"") + `</div>`
      : "";
    const stageHtml = stages.length ? `<h2 class="sec">导演分幕 · ${stages.length}</h2>` + stages.slice(0,40).map(s=>{
      const ns = nodes.filter(n=>n.stageId===s.id);
      return `<details class="card"><summary><b>${esc(s.title)}</b> <span class="badge">${ns.length} 节点</span></summary>`
        + (s.description?`<div class="st" style="margin:6px 0">${esc(s.description)}</div>`:"")
        + ns.slice(0,30).map(n=>`<div class="sec-item"><div class="t">${esc(n.title||"")}${n.execution==="foreground"?' <span class="badge">前台</span>':""}</div><div class="r">${esc((n.intent||"").slice(0,60))}</div></div>`).join("")
        + (ns.length>30?`<div class="r">…还有 ${ns.length-30} 个节点</div>`:"") + `</details>`;
    }).join("") : "";
    const search = `<h2 class="sec">世界书检索</h2><div class="card">`
      + `<div class="searchwrap"><input id="wc-q" placeholder="搜世界书…（如：伏魔殿）" oninput="wcSearch()"></div>`
      + `<div class="wb-keys">` + Object.keys(types).map(k=>`<span class="badge">${esc(typeName[k]||k)} ${types[k].length}</span>`).join("") + `</div>`
      + `<div id="wc-res" style="margin-top:8px"></div></div>`;
    const npcList = types.npcs||[];
    const npcHtml = npcList.length ? `<h2 class="sec">次要人物 · ${npcList.length}</h2>`
      + npcList.slice(0,60).map(e=>`<div class="rel"><div class="pair">${esc((e.key||[])[0]||"")}</div><div class="st">${esc(e.content||"").replace(/\n/g,"<br>")}</div></div>`).join("")
      + (npcList.length>60?`<div class="empty">…还有 ${npcList.length-60} 人，用上方检索查找</div>`:"") : "";
    const itemList = types.items||[];
    const itemHtml = itemList.length ? `<h2 class="sec">道具 · ${itemList.length}</h2>`
      + itemList.map(e=>`<div class="sec-item"><div class="t">${esc(e.content||"")}</div></div>`).join("") : "";
    view.innerHTML = head + conflict + stageHtml + search + npcHtml + itemHtml;
    prependRunBanner();
    window.scrollTo(0,0);
  };
  loadWorldcard(runId).then(function(wc){ if(TAB === "world") render(wc); });
}
function wcSearch(){
  const qEl = document.getElementById("wc-q"), box = document.getElementById("wc-res");
  if(!box || !_wcData) return;
  const kw = ((qEl&&qEl.value)||"").trim();
  if(!kw){ box.innerHTML = ""; return; }
  const hits = _wcData.worldBookEntries.filter(e=>
    (e.content||"").indexOf(kw)>=0 || (e.comment||"").indexOf(kw)>=0 ||
    (e.key||[]).join(" ").indexOf(kw)>=0).slice(0,50);
  box.innerHTML = hits.map(e=>`<div class="rel"><div class="pair">${esc(e.comment||"")} <span class="badge">${esc(e.entryType||"")}</span></div><div class="st">${esc((e.content||"").slice(0,200))}</div></div>`).join("")
    || `<div class="empty">无匹配<br><button class="btn ghost sm" style="margin-top:8px" onclick="wcClearSearch()">清空搜索</button></div>`;
}
window.wcClearSearch = ()=>{
  const qEl = document.getElementById("wc-q");
  if(qEl) qEl.value = "";
  wcSearch();
};

function showMore(){
const wb = RUN.worldbook;
let wbHtml = "";
if(wb && wb.length){
const cats = {};
wb.forEach(e=>{ (cats[e.category||"其他"] = cats[e.category||"其他"]||[]).push(e); });
wbHtml = `<h2 class="sec">世界观 · ${wb.length} 条</h2>
<div class="btnrow" style="margin-bottom:10px"><button class="btn ghost" onclick="loreEditor(RUN.run_id,'more')">${icon("edit")} 管理世界书</button></div>` + Object.keys(cats).map(c=>
`<div class="wb-cat">${esc(c)}</div>` + cats[c].map(e=>{ const n = normLore(e, 0); return `
<div class="rel"><div class="pair">${esc(n.name||"")}</div>
<div class="st">${esc(n.content||"")}</div>
${(n.key||[]).length?`<div class="wb-keys">${n.key.map(k=>`<span class="badge">${esc(k)}</span>`).join("")}</div>`:""}
${n.probability<100?`<div class="wb-keys"><span class="badge">概率 ${n.probability}%</span></div>`:""}
</div>`;}).join("")).join("");
}
const arcHtml = `<h2 class="sec">人物弧光 · ${RUN.arcs.length}</h2>` +
(RUN.arcs.map(a=>`<div class="card"><div class="name">${esc(a.character||a.name||"")}</div>
<div class="meta">${esc(a.arc_type||"")}</div>
<div class="md">${md(a.summary||a.description||"")}</div></div>`).join("") || `<div class="empty">暂无弧光</div>`);
const fsHtml = `<h2 class="sec">伏笔 · ${RUN.foreshadowing.length}</h2>` +
(RUN.foreshadowing.slice(0,50).map(f=>`
<div class="sec-item"><div class="t">${esc(f.hook||"")}</div>
<div class="r">${esc(f.status||"")} ${esc(f.payoff_chunk||"")}</div></div>`).join("") ||
`<div class="empty">暂无伏笔</div>`);
const cfHtml = `<h2 class="sec">冲突点 · ${RUN.conflicts.length}</h2>` +
(RUN.conflicts.slice(0,50).map(c=>`
<div class="sec-item"><div class="t">${esc(c.title||c.desc||"")}</div>
<div class="r">${esc(c.chunk_range||c.evidence||"")}</div></div>`).join("") ||
`<div class="empty">暂无冲突点</div>`);
/* P0 红学三项: 方法论声明置顶, 判词曲紧随伏笔(应验链接), 脂批殿后 */
view.innerHTML = methodologyCard() + wbHtml + arcHtml + fsHtml + foretellHtml() + cfHtml + zhipiHtml();
}
/* 立绘取卡 (B11): 蒸馏 run 从 __DATA__.rp_cards[runId] 取; 导入卡在 rp_cards 里没有这个键,
   恒 f={} —— 回落卡片库(判 RP_CARDIMPORT 在场)。外貌相关字段名取自 rp/prompt.js 的 LABELS:
   appearance_feature(外貌) / visual_identity(视觉识别) / physical_marks(身体印记) /
   voice_dressing(声音着装)。ST 卡导入不写这些字段, 此时该段留空, 绝不编造。 */
function portraitCardFor(runId, name){
  try{
    const cards = ((window.__DATA__||{}).rp_cards||{})[runId]||[];
    const c = cards.find(x=>x.name===(name||"")) || null;
    /* 蒸馏 run 已有真 run 时, rp_cards 里查不到就是真没有, 不拿同名导入卡串味 */
    if(c || (((window.__DATA__||{}).runs||{})[runId])) return c;
  }catch(e){}
  try{
    if(typeof RP_CARDIMPORT!=="undefined") return RP_CARDIMPORT.find(name||"") || null;
  }catch(e){}
  return null;
}
/* 卡片里到底有没有外貌可用文本 (genPortrait 的提示门禁) */
function hasAppearanceFor(runId, name){
  const f = ((portraitCardFor(runId, name)||{}).fields)||{};
  return [f.appearance_feature, f.visual_identity, f.physical_marks]
    .some(v=>String(v==null?"":v).trim()!=="");
}
/* 卡上没有外貌文本时, 生图浮层里的一行引导 (B11)。prompt 那一段留空, 不编造长相。 */
function portraitNoAppHint(runId, name){
  if(hasAppearanceFor(runId, name)) return "";
  return `<div class="hint" style="margin:6px 0">这张卡没有外貌描述，prompt 的「外貌」一栏留空（不编造长相）。
    可到「穿越 › 我的卡」点该卡的「编辑」，在角色字段的「外貌（appearance_feature）」补一句再生成。</div>`;
}
function portraitPrompt(runId, name){
const c = portraitCardFor(runId, name);
const f = (c&&c.fields)||{};
const novel = ((window.__DATA__||{}).runs||{})[runId];
const nv = (novel&&novel.novel)||((c&&c.novel)||"");
return `中国古典小说人物立绘，${name}，《${nv}》中的人物。外貌：${f.appearance_feature||f.visual_identity||""}。气质服饰：${f.voice_dressing||""}。工笔国风插画风格，半身像，纯色背景，高质量。`;
}
window.genPortrait = (runId, name)=>{
const cfg = getCfg();
if(!cfg.key||!cfg.base||!cfg.imgModel){ alert("先去「设置」填 API 地址/Key 和生图模型"); return; }
const prompt = portraitPrompt(runId, name);
const ov = document.createElement("div");
ov.className = "viewer";
ov.innerHTML = `<div class="vbox">
<div class="vhead"><span>${esc(name)} · 立绘</span><button onclick="this.closest('.viewer').remove()">✕</button></div>
<textarea id="v_prompt">${esc(prompt)}</textarea>
${portraitNoAppHint(runId, name)}
<div class="vimg" id="v_img"><div class="empty">点「生成」开始画</div></div>
<div class="btnrow">
<button class="btn" id="v_gen">${icon("palette")} 生成</button>
<button class="btn ghost" id="v_save" style="display:none">保存</button>
</div></div>`;
document.body.appendChild(ov);
ov.querySelector("#v_gen").onclick = async ()=>{
const box = ov.querySelector("#v_img");
box.innerHTML = `<div class="empty">画画中…（约十几秒）</div>`;
try{
const url = await RP_NET.generateImage(cfg, ov.querySelector("#v_prompt").value, cfg.imgModel);
box.innerHTML = `<img src="${url}">`;
const sv = ov.querySelector("#v_save");
sv.style.display = "";
sv.onclick = ()=>{
const a = document.createElement("a");
a.href = url; a.download = name + "-立绘.png";
document.body.appendChild(a); a.click(); a.remove();
};
}catch(e){ box.innerHTML = `<div class="empty">失败：${esc(e.message)}</div>`; }
};
};

/* ============ TTS 朗读 + 语音气泡 (对标商业 App: 可播放的气泡, 含时长/进度; 默认不存音频进历史) ============ */
const ttsCache = {};
let TTS_PLAY = null; // {key, idx, audio, local, startTs, estDur, prog, timer}
window.ttsEstDur = (text)=>{ // 中文约 4 字/秒, 保底 2 秒
const n = String(text||"").replace(/\s/g,"").length;
return Math.max(2, Math.ceil(n/4));
};
window.fmtDur = (s)=>{ s = Math.max(0, Math.round(s)); return Math.floor(s/60) + ":" + String(s%60).padStart(2,"0"); };
window.ttsKey = (idx)=> chatHistKey() + "#" + idx;
function ttsClean(m){ return String((m&&m.content)||"").replace(/[*#`>\-\[\]()]/g,"").slice(0,800); }
function ttsPaint(){ // 只更新气泡 DOM, 不整页重绘(避免滚动跳动)
if(!TTS_PLAY) return;
const fg = document.getElementById("vbfg-"+TTS_PLAY.idx);
if(fg) fg.style.width = Math.round((TTS_PLAY.prog||0)*100) + "%";
const ic = document.getElementById("vbico-"+TTS_PLAY.idx);
if(ic) ic.innerHTML = icon("pause",13);
const b = document.getElementById("vb-"+TTS_PLAY.idx);
if(b) b.classList.add("playing");
}
function ttsPaintStopped(idx){
const fg = document.getElementById("vbfg-"+idx);
if(fg) fg.style.width = "0%";
const ic = document.getElementById("vbico-"+idx);
if(ic) ic.innerHTML = icon("play",13);
const b = document.getElementById("vb-"+idx);
if(b) b.classList.remove("playing");
}
function ttsTickStart(){ // 本地语音用计时器推进进度; 远端走 audio.timeupdate
if(TTS_PLAY && TTS_PLAY.timer) clearInterval(TTS_PLAY.timer);
if(!TTS_PLAY) return;
TTS_PLAY.timer = setInterval(()=>{
if(!TTS_PLAY) return;
if(TTS_PLAY.local){
const el = (Date.now()-TTS_PLAY.startTs)/1000/TTS_PLAY.estDur;
TTS_PLAY.prog = Math.min(0.99, el);
if(el >= 1){ const i = TTS_PLAY.idx; ttsStop(); ttsPaintStopped(i); return; }
}
ttsPaint();
}, 500);
}
window.ttsMsg = async (idx)=>{
const k = window.ttsKey(idx);
if(TTS_PLAY && TTS_PLAY.key===k){ const i = TTS_PLAY.idx; ttsStop(); ttsPaintStopped(i); return; }
ttsStop();
const h = getHistSafe(chatHistKey());
const m = h[idx]; if(!m || m.role!=="assistant") return;
const cfg = getCfg();
const text = ttsClean(m);
const estDur = window.ttsEstDur(text);
if(cfg.key && cfg.base && cfg.ttsModel){
try{
let url = ttsCache[k];
if(!url){
url = await RP_NET.tts(cfg, text, cfg.ttsModel, cfg.ttsVoice||"alloy");
ttsCache[k] = url;
}
const a = new Audio(url);
TTS_PLAY = {key:k, idx:idx, audio:a, local:false, startTs:Date.now(), estDur:estDur, prog:0};
a.onended = ()=>{ const i = TTS_PLAY?TTS_PLAY.idx:idx; ttsStop(); ttsPaintStopped(i); };
a.ontimeupdate = ()=>{ if(TTS_PLAY && TTS_PLAY.key===k && a.duration) { TTS_PLAY.prog = a.currentTime/a.duration; ttsPaint(); } };
ttsPaint(); ttsTickStart();
achvUnlock("tts_1");
await a.play();
}catch(e){ TTS_PLAY = null; alert("TTS 失败：" + e.message); }
return;
}
/* 无远端 TTS 配置: 用手机自带免费语音兜底（对标猫箱端侧语音参考） */
if(!("speechSynthesis" in window)){ alert("先去「设置」填 API 地址/Key 和 TTS 模型"); return; }
try{
const u = new SpeechSynthesisUtterance(text);
u.lang = "zh-CN";
window._localTtsOn = true;
TTS_PLAY = {key:k, idx:idx, audio:null, local:true, startTs:Date.now(), estDur:estDur, prog:0};
u.onend = u.onerror = ()=>{ if(TTS_PLAY && TTS_PLAY.key===k){ const i = TTS_PLAY.idx; ttsStop(); ttsPaintStopped(i); } };
ttsPaint(); ttsTickStart();
achvUnlock("tts_1");
speechSynthesis.speak(u);
}catch(e){ TTS_PLAY = null; window._localTtsOn = false; alert("本地语音失败：" + e.message); }
};
function ttsStop(){
if(TTS_PLAY){
if(TTS_PLAY.timer){ try{clearInterval(TTS_PLAY.timer);}catch(e){} }
if(TTS_PLAY.audio){ try{TTS_PLAY.audio.pause();}catch(e){} }
TTS_PLAY = null;
}
if(window._localTtsOn && ("speechSynthesis" in window)){ try{speechSynthesis.cancel();}catch(e){} window._localTtsOn = false; }
}
/* 语音气泡: 替代原来的小喇叭按钮, 含播放/暂停、进度条、预估时长 */
window.voiceBubbleHTML = (idx, m)=>{
const k = window.ttsKey(idx);
const playing = !!(TTS_PLAY && TTS_PLAY.key===k);
const dur = window.ttsEstDur(ttsClean(m));
return `<button class="voicebub${playing?" playing":""}" id="vb-${idx}" onclick="event.stopPropagation();ttsMsg(${jq(idx)})" title="点击播放/暂停">`
+ `<span class="vb-ico" id="vbico-${idx}">${icon(playing?"pause":"play",13)}</span>`
+ `<span class="vb-bar"><span class="vb-fg" id="vbfg-${idx}" style="width:${playing?Math.round((TTS_PLAY.prog||0)*100):0}%"></span></span>`
+ `<span class="vb-dur">${window.fmtDur(dur)}</span></button>`;
};

/* ================= 世界书编辑 ================= */
/* ============ 编辑器 token 计数器 (对标 C.AI/Janitor: 实时用量条, 80%/100% 两档告警) ============ */
window.tokCount = (inputId, outId)=>{
const ids = Array.isArray(inputId) ? inputId : [inputId];
const out = document.getElementById(outId);
// 注意: RP_PROMPT 是顶层 const, 不挂 window, 用 typeof 判存在
if(!out || typeof RP_PROMPT === "undefined") return;
let txt = "";
ids.forEach(id=>{ const el = document.getElementById(id); if(el) txt += (el.value || "") + "\n"; });
const n = RP_PROMPT.estTokens(txt);
const max = (getRpCfg().maxContext || 8192);
const pct = Math.min(100, Math.round(n / max * 100));
const cls = pct >= 100 ? "over" : (pct >= 80 ? "warn" : "");
out.innerHTML = `<div class="tokbar"><div class="tokbar-fg ${cls}" style="width:${pct}%"></div></div>`
+ `<span class="toknum ${cls}">约 ${n} / ${max} tokens${pct >= 100 ? " · 已超上下文窗口！" : (pct >= 80 ? " · 接近上限" : "")}</span>`;
};
/* 世界书管理器的存储键。导入卡全部共用 runId="imported", 必须按卡隔离, 否则 A 卡
   写的条目会串进 B 卡的 prompt(键规则见 rp/scope.js)。name 省略时退回当前聊天那张卡
   (loreEditor 的调用链上, 聊天抽屉传 CHAT.runId; 产物页传的是蒸馏 RUN.run_id, 天然按书隔离)。 */
const loreNameOf = (runId, name)=> name || ((typeof CHAT !== "undefined" && CHAT && CHAT.runId === runId) ? CHAT.name : null);
const loreKey = (runId, name)=> RP_SCOPE.key("nd_lore_", runId, loreNameOf(runId, name));
const getLore = (runId, name)=>{
  try{ return RP_SCOPE.read(loreKey(runId, name), RP_SCOPE.legacyKey("nd_lore_", runId)); }
  catch(e){ return []; }
};
const saveLore = (runId, arr)=>{
  /* P1-8: 世界书增删改在 inline onclick 里调 saveLore，原先裸抛无提示且中断 renderLoreList */
  try{ RP_SCOPE.write(loreKey(runId), arr); }
  catch(e){ rpToastOnce(isQuotaErr(e) ? "存储空间已满，世界书保存失败" : "世界书保存失败"); }
};
const loreBack = {to:null};
window.loreEditor = (runId, backTo)=>{
__backAction = ()=>loreGoBack();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
loreBack.to = backTo || "more";
const run = ((window.__DATA__||{}).runs||{})[runId]||{};
titleEl.textContent = "世界书管理"; subEl.textContent = (run.novel ? run.novel + " · " : "") + "自建条目进 prompt";
renderLoreList(runId);
};
/* 世界书条目归一化展示 (Janitor schema; 老条目缺字段给默认值) */
function normLore(e, i){
if(typeof RP_LOREBOOK !== "undefined") return RP_LOREBOOK.normalize(e, i);
return {name: e.title||"", key: e.keys||e.trigger_keywords||[], content: e.content||"",
comment: "", keysecondary: [], selectiveLogic: 0, case_sensitive: false, matchWholeWords: true,
minMessages: 0, constant: !!e.constant, enabled: e.enabled!==false, probability: 100, priority: i+1,
inclusionGroup: [], groupWeight: 100, prioritizeInclusion: false, placement: "default",
placementPosition: "after", depth: null};
}
function renderLoreList(runId){
__backAction = ()=>loreGoBack();
const arr = getLore(runId);
view.innerHTML = `<button class="back" onclick="loreGoBack()">${icon("back")} 返回</button>
<div class="btnrow" style="margin-bottom:10px"><button class="btn" onclick="loreForm('${jq(runId)}')">${icon("plus")} 新增条目</button><button class="btn" onclick="importStLore('${jq(runId)}')">导入 ST 世界书</button><button class="btn ghost" onclick="exportStLore('${jq(runId)}')">导出 ST 世界书</button></div>
<div class="hint">自建条目和蒸馏产出的世界书一起参与关键词触发（常驻条目每轮必进），存在本机。列表顺序即优先级（越靠上越强），用 ↑↓ 调整。</div>
${arr.map((e,i)=>{
const n = normLore(e,i);
const grp = (n.inclusionGroup||[]).join("、");
return `<div class="card"><div class="row"><div style="flex:1">
<div class="name">${esc(n.name||"无标题")} ${n.constant?'<span class="badge warn">常驻</span>':""} ${!n.enabled?'<span class="badge">停用</span>':""}${grp?` <span class="badge">互斥组:${esc(grp)}</span>`:""}</div>
<div class="meta">触发词：${esc((n.key||[]).join("、")||"无")} · P${n.priority} · 概率 ${n.probability}%${n.minMessages?` · ${n.minMessages}条后激活`:""}${n.placement!=="default"?` · 锚定:${esc(n.placement)}`:""} · 约 ${RP_PROMPT.estTokens(n.content||"")} tok</div>
</div></div>
<div class="btnrow" style="margin-top:8px">
<button class="btn ghost" onclick="loreMove('${jq(runId)}',${jq(i)},-1)"${i===0?" disabled":""}>↑</button>
<button class="btn ghost" onclick="loreMove('${jq(runId)}',${jq(i)},1)"${i===arr.length-1?" disabled":""}>↓</button>
<button class="btn ghost" onclick="loreForm('${jq(runId)}',${jq(i)})">编辑</button>
<button class="btn ghost" onclick="loreToggle('${jq(runId)}',${jq(i)})">${!n.enabled?"启用":"停用"}</button>
<button class="btn danger" onclick="loreDel('${jq(runId)}',${jq(i)})">删除</button>
</div></div>`;}).join("") || `<div class="empty">还没有自建条目<br><button class="btn" style="margin-top:10px" onclick="loreForm('${jq(runId)}')">新增第一条</button></div>`}`;
window.scrollTo(0,0);
}
/* 上移/下移: 交换位置后重算 priority=index+1 (Janitor: priority 由排序派生, 无数字输入框) */
window.loreMove = (runId, i, dir)=>{
const a = getLore(runId);
const j = i + dir;
if(j < 0 || j >= a.length) return;
const t = a[i]; a[i] = a[j]; a[j] = t;
a.forEach((e, k)=>{ e.priority = k + 1; });
saveLore(runId, a); renderLoreList(runId);
};
window.loreGoBack = ()=>{ loreBack.to==="chat" ? showChat() : setTab("more"); };
window.loreToggle = (runId, i)=>{ const a = getLore(runId); a[i].enabled = a[i].enabled===false ? true : false; saveLore(runId, a); renderLoreList(runId); };
/* SillyTavern 世界书(JSON, entries 字典) -> 本机条目 (字段映射见 RP_LOREBOOK.importST, 规格 1.5) */
/* 老兜底: RP_LOREBOOK 未加载时用 */
function stLoreToEntries(d){
var raw = d && d.entries;
if(!raw) return null;
var list = Array.isArray(raw) ? raw : Object.keys(raw).map(function(k){ return raw[k]; });
var out = [];
list.forEach(function(e){
if(!e || !e.content) return;
var keys = (e.key||[]).concat(e.keysecondary||[]).map(function(x){ return String(x||"").trim(); }).filter(Boolean);
out.push({title: (e.comment||"").trim() || "无标题", keys: keys,
content: String(e.content), priority: 60,
constant: !!e.constant, enabled: !e.disable, id: "st"+Date.now()+Math.floor(Math.random()*1e6)});
});
return out.length ? out : null;
}
window.importStLore = (runId)=>{
const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
inp.onchange = ()=>{
const f = inp.files[0]; if(!f) return;
const rd = new FileReader();
rd.onload = ()=>{
try{
const d = JSON.parse(rd.result);
const es = (typeof RP_LOREBOOK !== "undefined") ? RP_LOREBOOK.importST(d) : stLoreToEntries(d);
if(!es){ alert("解析失败: 不是 ST 世界书格式"); return; }
let a = getLore(runId); es.forEach(function(e){ a.push(e); });
if(typeof RP_LOREBOOK !== "undefined") a = RP_LOREBOOK.normalizeAll(a);
saveLore(runId, a); renderLoreList(runId);
alert("已导入 " + es.length + " 条世界书");
}catch(e){ alert("解析失败: " + e.message); }
};
rd.readAsText(f);
};
inp.click();
};
/* ST 正则导出(JSON 数组): stRuleToScript, 与 stRegexToRules 互逆, 可导回 ST */
window.exportStRegex = ()=>{
const a = getRegexUI(RX_CTX.runId, RX_CTX.name);
if(!a.length){ rpToast("没有可导出的正则规则"); return; }
downloadJson("regex_st.json", a.map(stRuleToScript));
rpToast(`已导出 ${a.length} 条正则 (ST 格式)`);
};
window.loreDel = (runId, i)=>{ if(!confirm("删除这条世界书？")) return; const a = getLore(runId); a.splice(i,1); saveLore(runId, a); renderLoreList(runId); };
/* ST 世界书导出(JSON): RP_LOREBOOK.exportST 的逆操作, 可导回 ST */
window.exportStLore = (runId)=>{
if(typeof RP_LOREBOOK === "undefined" || !RP_LOREBOOK.exportST){ rpToast("世界书模块未加载"); return; }
const a = getLore(runId);
if(!a.length){ rpToast("没有可导出的世界书条目"); return; }
downloadJson("lorebook_st.json", RP_LOREBOOK.exportST(a));
rpToast(`已导出 ${a.length} 条世界书 (ST 格式)`);
};
window.loreForm = (runId, i)=>{
__backAction = ()=>renderLoreList(runId);
const _ll = getLore(runId);
const _isNew = (i==null || !_ll[i]);
const n = normLore(_isNew ? {} : _ll[i], (i==null ? _ll.length : i));
const grpStr = (n.inclusionGroup||[]).join("、");
const logicOpts = [[0,"AND ANY（任一次级命中即纳入）"],[1,"NOT ALL（次级全命中才排除）"],[2,"NOT ANY（任一次级命中即排除）"],[3,"AND ALL（次级全命中才纳入）"]]
.map(o=>`<option value="${o[0]}"${n.selectiveLogic===o[0]?" selected":""}>${o[1]}</option>`).join("");
const placeOpts = [["default","默认（世界书段）"],["personality","人设段"],["scenario","场景段"],["exampleDialogs","示例对话段"]]
.map(o=>`<option value="${o[0]}"${n.placement===o[0]?" selected":""}>${o[1]}</option>`).join("");
titleEl.textContent = (_isNew?"新增":"编辑") + "世界书条目"; subEl.textContent = "";
/* AI 帮填上下文：小说名 */
const _loreNovel = ((((window.__DATA__||{}).runs||{})[runId]||{}).novel)||"";
const _loreCtx = "世界书条目" + (_loreNovel?("，出自小说《"+_loreNovel+"》"):"") + "；条目内容会被注入 AI 的 prompt";
view.innerHTML = `<button class="back" onclick="renderLoreList('${jq(runId)}')">${icon("back")} 返回列表</button>
<div class="field"><label>标题${RP_AIFILL.btn("l_title","世界书条目标题","2~8个字的人物名/地点名/势力名/物品名",_loreCtx)}</label><input id="l_title" value="${esc(n.name||"")}"></div>
<div class="field"><label>触发词（逗号/顿号分隔，消息里出现即触发；可用 /正则/flags 写法）${RP_AIFILL.btn("l_keys","世界书触发词","逗号/顿号分隔；根据标题联想读者聊天时可能提到的相关词，5~12个",_loreCtx)}</label><input id="l_keys" value="${esc((n.key||[]).join("、"))}" placeholder="如：大观园、贾府"></div>
<div class="field"><label>内容（进 prompt 的正文）${RP_AIFILL.btn("l_content","世界书内容","100~300字的设定正文，客观叙述、设定向",_loreCtx)}</label><textarea id="l_content" oninput="tokCount('l_content','l_tok')" style="width:100%;min-height:120px;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:10px">${esc(n.content||"")}</textarea><div class="tokline" id="l_tok"></div></div>
<div class="field"><label>优先级：第 ${n.priority} 位（在列表用 ↑↓ 调整顺序，越靠上越强）</label></div>
<div class="field"><label><input type="checkbox" id="l_const" style="width:auto" ${n.constant?"checked":""}> 常驻条目（每轮必进 prompt）</label></div>
<div class="field"><label><input type="checkbox" id="l_en" style="width:auto" ${n.enabled?"":"checked"}> 启用</label></div>
<details class="card" style="margin-top:4px"><summary style="cursor:pointer;padding:4px">高级选项（触发概率 / 互斥组 / 次级关键词 / 插入位置…）</summary>
<div style="padding:6px 2px">
<div class="field"><label>触发概率 %（0-100，掷骰决定是否注入）</label><input id="l_prob" type="number" min="0" max="100" step="1" value="${n.probability}"></div>
<div class="field"><label>最小消息数（N 条消息后才激活，0=立即）</label><input id="l_minmsg" type="number" min="0" step="1" value="${n.minMessages||0}"></div>
<div class="field"><label><input type="checkbox" id="l_case" style="width:auto" ${n.case_sensitive?"checked":""}> 区分大小写（对正则键无效）</label></div>
<div class="field"><label><input type="checkbox" id="l_whole" style="width:auto" ${n.matchWholeWords?"checked":""}> 整词匹配（king 不匹配 liking）</label></div>
<div class="field"><label>次级关键词（逗号/顿号分隔；用于纳入或排除）${RP_AIFILL.btn("l_keys2","世界书次级关键词","逗号分隔；补充的精细控制关键词，5~10个",_loreCtx)}</label><input id="l_keys2" value="${esc((n.keysecondary||[]).join("、"))}"></div>
<div class="field"><label>次级关键词逻辑</label><select id="l_logic">${logicOpts}</select></div>
<div class="field"><label>互斥组（逗号分隔；同组每次只激活一条）</label><input id="l_group" value="${esc(grpStr)}" placeholder="如：combat、social"></div>
<div class="field"><label>组内权重（同组随机挑选时的权重）</label><input id="l_gweight" type="number" min="1" step="1" value="${n.groupWeight||100}"></div>
<div class="field"><label><input type="checkbox" id="l_prioin" style="width:auto" ${n.prioritizeInclusion?"checked":""}> 组内按插入顺序而非权重挑选</label></div>
<div class="field"><label>插入位置（锚定到对应 prompt 段）</label><select id="l_place">${placeOpts}</select>
<select id="l_placepos" style="margin-top:6px"><option value="after"${n.placementPosition!=="before"?" selected":""}>该段之后</option><option value="before"${n.placementPosition==="before"?" selected":""}>该段之前</option></select></div>
<div class="field"><label>扫描深度（检测最近 N 条消息，1-10，空=默认 4）</label><input id="l_depth" type="number" min="1" max="10" value="${n.depth||""}" placeholder="默认"></div>
<div class="field"><label>备注（不进 prompt，仅自己看）${RP_AIFILL.btn("l_comment","世界书备注","一句话说明这条条目的用途，仅自己看",_loreCtx)}</label><input id="l_comment" value="${esc(n.comment||"")}"></div>
</div></details>
<div class="btnrow"><button class="btn" onclick="loreSave('${jq(runId)}',${jq(i==null?"null":i)})">保存</button></div>`;
tokCount("l_content","l_tok");
window.scrollTo(0,0);
};
window.loreSave = (runId, i)=>{
const splitKeys = (v)=> v.split(/[，,、]/).map(x=>x.trim()).filter(Boolean);
const keys = splitKeys($("#l_keys").value);
const keys2 = splitKeys($("#l_keys2").value);
const grp = splitKeys($("#l_group").value);
let prob = parseInt($("#l_prob").value); if(!isFinite(prob)) prob = 100; prob = Math.min(100, Math.max(0, prob));
let minmsg = parseInt($("#l_minmsg").value); if(!isFinite(minmsg) || minmsg < 0) minmsg = 0;
let gw = parseInt($("#l_gweight").value); if(!isFinite(gw) || gw < 1) gw = 100;
let depth = parseInt($("#l_depth").value); if(!isFinite(depth)) depth = null; else depth = Math.min(10, Math.max(1, depth));
const a = getLore(runId);
const e = {id: ((i==null || !a[i]) ? "u"+Date.now() : (a[i].id || "u"+Date.now())),
name: $("#l_title").value.trim()||"无标题", key: keys, content: $("#l_content").value.trim(),
comment: $("#l_comment").value.trim(), enabled: $("#l_en").checked, constant: $("#l_const").checked,
probability: prob, minMessages: minmsg, case_sensitive: $("#l_case").checked,
matchWholeWords: $("#l_whole").checked, keysecondary: keys2,
selectiveLogic: parseInt($("#l_logic").value)||0, inclusionGroup: grp, groupWeight: gw,
prioritizeInclusion: $("#l_prioin").checked, placement: $("#l_place").value,
placementPosition: $("#l_placepos").value, depth: depth,
priority: (i==null ? a.length+1 : i+1)};
if(!e.content){ alert("内容不能为空"); return; }
if(i==null) a.push(e); else a[i] = e;
saveLore(runId, a); renderLoreList(runId);
if(i==null) achvUnlock("lore_1");
};

/* ================= 正则替换 ================= */
const regexKey = (runId, name)=> `nd_regex_${runId}_${name}`;
const getRegexUI = (runId, name)=>{ try{return JSON.parse(localStorage.getItem(regexKey(runId,name)))||[]}catch(e){return[]}};
const saveRegexUI = (runId, name, arr)=> localStorage.setItem(regexKey(runId,name), JSON.stringify(arr));
const regexBack = {to:null};
window.regexEditor = (runId, name, backTo)=>{
__backAction = ()=>regexGoBack();
RX_CTX.runId = runId; RX_CTX.name = name;
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
regexBack.to = backTo || "chat";
const names = name ? [name] : [];
renderRegexList(runId, names[0]||"");
};
/* S 级补全: 穿越抽屉的正则入口。魂穿按被附身角色名, 肉身/异世界按世界名存规则 */
window.travRegexEditor = ()=>{
const trav = (typeof RP_TRAVERSE !== "undefined") ? RP_TRAVERSE.get(CHAT.travId) : null;
if(!trav){ rpToast("穿越会话不存在"); return; }
const name = (typeof travRegexName === "function") ? travRegexName(trav)
  : ((trav.mode === "soul" && trav.charName) ? trav.charName : (trav.worldName || "穿越"));
regexEditor("trav", name, "trav");
};
function regexCharSel(runId, cur){
if(regexBack.to === "trav") return ""; /* 穿越: 角色固定, 不显示角色选择 */
const ms = (CHAT.mode==="group") ? CHAT.members : (CHAT.name ? [CHAT.name] : []);
if(!ms.length) return "";
return `<div class="field"><label>角色</label><select id="rx_char" onchange="renderRegexList('${jq(runId)}',this.value)">`
+ ms.map(n=>`<option value="${esc(n)}" ${n===cur?"selected":""}>${esc(n)}</option>`).join("") + `</select></div>`;
}
window.renderRegexList = (runId, name)=>{
__backAction = ()=>regexGoBack();
if(!name){ const ms=(CHAT.mode==="group")?CHAT.members:(CHAT.name?[CHAT.name]:[]); name = ms[0]||""; }
titleEl.textContent = "正则替换"; subEl.textContent = (name? name+" · ":"") + "只做查找替换，不执行代码";
const arr = name ? getRegexUI(runId, name) : [];
view.innerHTML = `<button class="back" onclick="regexGoBack()">${icon("back")} 返回</button>
${regexCharSel(runId, name)}
<div class="btnrow" style="margin-bottom:10px"><button class="btn" onclick="importStRegex()">${icon("download")} 导入 ST 脚本</button><button class="btn ghost" onclick="exportStRegex()">导出 ST 脚本</button><button class="btn" onclick="regexForm('${jq(runId)}','${jq(name)}')">${icon("plus")} 新增规则</button></div>
<div class="hint">AI 回复发出前按顺序执行：查找（正则）→ 替换为。如把"好的"替换成"好"，或统一口头禅。非法正则会被跳过。</div>
${arr.map((r,i)=>`
<div class="card">${r.name?`<div class="kv" style="color:var(--gold)">${esc(r.name)}${r.flags&&r.flags!=="g"?` <span style="color:var(--ink-faint)">/${esc(r.flags)}</span>`:""}</div>`:""}<div class="name" style="font-size:calc(13px * var(--fs))">${esc(r.find||"")} <span style="color:var(--ink-faint)">→</span> ${esc(String(r.replace||"")).slice(0,60)}</div>
<div class="meta">${r.enabled===false?"停用":"启用"}${r.markdownOnly?` · <span class="badge">markdown显示时</span>`:""}${r.promptOnly&&!r.markdownOnly?` · <span class="badge">纯prompt(不执行)</span>`:""}${r.minDepth!=null?` · 深度≥${r.minDepth}`:""}${r.maxDepth!=null?` · 深度≤${r.maxDepth}`:""}</div>
<div class="btnrow" style="margin-top:8px">
<button class="btn ghost" onclick="regexForm('${jq(runId)}','${jq(name)}',${jq(i)})">编辑</button>
<button class="btn ghost" onclick="regexToggle('${jq(runId)}','${jq(name)}',${jq(i)})">${r.enabled===false?"启用":"停用"}</button>
<button class="btn danger" onclick="regexDel('${jq(runId)}','${jq(name)}',${jq(i)})">删除</button>
</div></div>`).join("") || `<div class="empty">还没有规则</div>`}`;
window.scrollTo(0,0);
};
window.regexGoBack = ()=>{ showChat(); };
window.regexToggle = (runId, name, i)=>{ const a=getRegexUI(runId,name); a[i].enabled = a[i].enabled===false?true:false; saveRegexUI(runId,name,a); renderRegexList(runId,name); };
window.regexDel = (runId, name, i)=>{ if(!confirm("删除这条规则？")) return; const a=getRegexUI(runId,name); a.splice(i,1); saveRegexUI(runId,name,a); renderRegexList(runId,name); };
let RX_CTX = {runId:null, name:null};
/* SillyTavern 正则脚本 -> 本机规则。
 * ST 语义(源码 public/scripts/extensions/regex/engine.js 实证):
 * placement: 1=用户输入, 2=AI输出, 3=斜杠命令, 5=世界书, 6=推理块。
 * 本机只处理 AI 输出显示: 要求 placement 含 2。
 * markdownOnly: 只在 markdown 显示路径执行(本机气泡是 markdown 渲染, 视为显示路径);
 * promptOnly: 只在 prompt 构建时执行, 本机无此路径, 跳过并注明。
 * minDepth/maxDepth: 按 depth 过滤(新回复 depth=0), 字段保留。
 * 支持单个脚本对象或数组( ST 可导出多个)。 */
function stRegexToRule(d){
if(!d || typeof d.findRegex !== "string") return null;
const placement = d.placement || [2];
if(placement.indexOf(2) < 0) return null;
let find = d.findRegex, flags = "g";
const m = d.findRegex.match(/^\/(.*)\/([a-z]*)$/s);
if(m){ find = m[1]; flags = ((m[2]||"").replace(/g/g,"")) + "g"; }
try{ new RegExp(find, flags); }catch(e){ return null; }
return {name: d.scriptName || "ST 导入", find: find, flags: flags,
replace: d.replaceString != null ? d.replaceString : "", enabled: !d.disabled,
markdownOnly: !!d.markdownOnly, promptOnly: !!d.promptOnly,
minDepth: (d.minDepth == null ? null : +d.minDepth),
maxDepth: (d.maxDepth == null ? null : +d.maxDepth),
trimStrings: Array.isArray(d.trimStrings) ? d.trimStrings : [],
runOnEdit: !!d.runOnEdit};
}
function stRegexToRules(d){
const list = Array.isArray(d) ? d : [d];
const out = [];
list.forEach(function(x){ const r = stRegexToRule(x); if(r) out.push(r); });
return out;
}
/* 本机正则规则 -> ST 正则脚本 (stRegexToRule 的逆操作)。
 * findRegex 写成 /find/flags 形式(ST 经典写法); placement 固定 [2](AI 输出,
 * 本机正则只处理 AI 输出显示路径)。 */
function stRuleToScript(r){
r = r || {};
return {scriptName: r.name || "novel-reader",
findRegex: "/" + (r.find || "") + "/" + (r.flags || "g"),
replaceString: r.replace != null ? r.replace : "",
disabled: r.enabled === false,
placement: [2],
markdownOnly: !!r.markdownOnly,
promptOnly: !!r.promptOnly,
minDepth: (r.minDepth == null ? null : +r.minDepth),
maxDepth: (r.maxDepth == null ? null : +r.maxDepth),
trimStrings: Array.isArray(r.trimStrings) ? r.trimStrings : [],
runOnEdit: !!r.runOnEdit};
}
window.importStRegex = ()=>{
const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
inp.onchange = ()=>{
const f = inp.files[0]; if(!f) return;
const rd = new FileReader();
rd.onload = ()=>{
try{
const d = JSON.parse(rd.result);
const rs = stRegexToRules(d);
if(!rs.length){ alert("解析失败: 不是 ST 正则脚本, 或没有作用于 AI 输出的脚本(本机正则只处理 AI 输出显示)"); return; }
const purePrompt = rs.filter(r=>r.promptOnly && !r.markdownOnly).length;
const a = getRegexUI(RX_CTX.runId, RX_CTX.name);
rs.forEach(function(r){ a.push(r); });
saveRegexUI(RX_CTX.runId, RX_CTX.name, a); renderRegexList(RX_CTX.runId, RX_CTX.name);
alert("已导入 " + rs.length + " 条正则" + (purePrompt ? "；其中 " + purePrompt + " 条为纯 promptOnly(只在 prompt 构建时执行)，本机无此路径，已保留但不执行" : ""));
}catch(e){ alert("解析失败: " + e.message); }
};
rd.readAsText(f);
};
inp.click();
};
window.regexForm = (runId, name, i)=>{
__backAction = ()=>renderRegexList(runId, name);
const _rl = getRegexUI(runId, name);
const r = (i==null || !_rl[i]) ? {find:"", replace:"", enabled:true} : _rl[i];
titleEl.textContent = (i==null?"新增":"编辑")+"正则规则"; subEl.textContent = name;
view.innerHTML = `<button class="back" onclick="renderRegexList('${jq(runId)}','${jq(name)}')">${icon("back")} 返回列表</button>
<div class="field"><label>查找（正则表达式）${RP_AIFILL.btn("x_find","正则查找式","用自然语言描述想匹配的文本，只输出正则表达式本身，不要解释","文本替换规则")}</label><input id="x_find" value="${esc(r.find||"")}" placeholder="如：好的|嗯嗯"></div>
<div class="field"><label>替换为（可用 $1 引用分组）${RP_AIFILL.btn("x_rep","正则替换文本","写替换后的文本，可用 $1 $2 引用分组，只输出替换文本","文本替换规则；查找式："+(r.find||"（未填）"))}</label><input id="x_rep" value="${esc(r.replace||"")}" oninput="tokCount('x_rep','x_tok')"><div class="tokline" id="x_tok"></div></div>
<div class="field"><label><input type="checkbox" id="x_en" style="width:auto" ${r.enabled===false?"":"checked"}> 启用</label></div>
<div class="btnrow"><button class="btn" onclick="regexSave('${jq(runId)}','${jq(name)}',${jq(i==null?"null":i)})">保存</button></div>`;
tokCount("x_rep","x_tok");
window.scrollTo(0,0);
};
window.regexSave = (runId, name, i)=>{
const find = $("#x_find").value;
if(!find){ alert("查找不能为空"); return; }
try{ new RegExp(find); }catch(e){ alert("正则写错了："+e.message); return; }
const r = {find, replace: $("#x_rep").value, enabled: $("#x_en").checked};
const a = getRegexUI(runId, name);
if(i==null) a.push(r); else a[i] = r;
saveRegexUI(runId, name, a); renderRegexList(runId, name);
};
/* ================= 任务管理 ================= */
const TASKS_KEY = "nd_tasks_v1";
const getTasks = ()=>{ try{return JSON.parse(localStorage.getItem(TASKS_KEY))||[]}catch(e){return[]}};
const saveTasks = (t)=> localStorage.setItem(TASKS_KEY, JSON.stringify(t));

function showTasks(){
__backAction = null;
titleEl.textContent = "蒸馏任务";
subEl.textContent = "手机上排队, 发给 Muse 去跑";
const ts = getTasks();
view.innerHTML = `
<div class="btnrow"><button class="btn" onclick="taskForm()">＋ 新建任务</button></div>
<div class="hint">手机跑不了蒸馏 (要调大模型)。在这里把"想跑什么"记下来,
一键复制发给 Muse, 跑完后新版 App 会带上产物。</div>
<div id="tlist">${taskList(ts)}</div>`;
}
function taskList(ts){
return ts.map(t=>`
<div class="card task">
<div class="name">${esc(t.novel)}<span class="st">排队中</span></div>
<div class="meta">${esc(t.id)} · ${esc(t.created_at)}</div>
<div style="margin-top:6px">${(t.characters||[]).map(c=>`<span class="badge">${esc(c)}</span>`).join("")}</div>
${t.scope_chapters?`<div class="meta">章节: ${esc(t.scope_chapters)}</div>`:""}
${t.scope_scenes?`<div class="meta">场景: ${esc(t.scope_scenes)}</div>`:""}
${t.note?`<div class="meta">备注: ${esc(t.note)}</div>`:""}
<div class="btnrow">
<button class="btn ghost" onclick="copyTask('${jq(t.id)}')">复制发给 Muse</button>
<button class="btn danger" onclick="delTask('${jq(t.id)}')">删除</button>
</div>
</div>`).join("") || `<div class="empty">还没有任务, 点上面新建一个</div>`;
}
window.taskForm = ()=>{
__backAction = ()=>showTasks();
titleEl.textContent = "新建蒸馏任务"; subEl.textContent = "";
view.innerHTML = `
<div class="field"><label>小说名</label><input id="f_novel" placeholder="如: 红楼梦"></div>
<div class="field"><label>人物 (逗号分隔)</label><input id="f_chars" placeholder="如: 贾宝玉,林黛玉"></div>
<div class="field"><label>章节范围 (可选, 如 1-10)</label><input id="f_chapters" placeholder="留空=全书"></div>
<div class="field"><label>场景关键词 (可选)</label><input id="f_scenes" placeholder="如: 大观园"></div>
<div class="field"><label>备注 (可选)</label><textarea id="f_note" placeholder="其他要求…"></textarea></div>
<div class="btnrow">
<button class="btn" onclick="saveTask()">保存到队列</button>
<button class="btn ghost" onclick="showTasks()">取消</button>
</div>`;
};
window.saveTask = ()=>{
const v = (id)=> $(id).value.trim();
const novel = v("#f_novel");
if(!novel){ alert("请填小说名"); return;}
const ts = getTasks();
const t = {
id: "task-" + Date.now().toString(36),
novel,
characters: v("#f_chars").split(/[,，、]/).map(s=>s.trim()).filter(Boolean),
scope_chapters: v("#f_chapters"),
scope_scenes: v("#f_scenes"),
note: v("#f_note"),
status: "queued",
created_at: new Date().toLocaleString("zh-CN",{hour12:false}),
};
ts.unshift(t); saveTasks(ts); showTasks();
};
window.delTask = (id)=>{
if(!confirm("删除这个任务?")) return;
saveTasks(getTasks().filter(t=>t.id!==id)); showTasks();
};
window.copyTask = (id)=>{
const t = getTasks().find(x=>x.id===id);
if(!t) return;
const lines = [`帮我跑个蒸馏任务:`, `小说: ${t.novel}`];
if(t.characters.length) lines.push(`人物: ${t.characters.join(",")}`);
if(t.scope_chapters) lines.push(`章节范围: ${t.scope_chapters}`);
if(t.scope_scenes) lines.push(`场景: ${t.scope_scenes}`);
if(t.note) lines.push(`备注: ${t.note}`);
copyText(lines.join("\n"), "已复制, 去聊天里发给 Muse 吧");
};
function copyText(text, okMsg){
const done = ()=>alert(okMsg||"已复制");
if(navigator.clipboard && navigator.clipboard.writeText){
navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text, done));
}else fallbackCopy(text, done);
}
function fallbackCopy(text, done){
const ta = document.createElement("textarea");
ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
document.body.appendChild(ta); ta.select();
try{ document.execCommand("copy"); done();}catch(e){ alert("复制失败, 请手动长按复制");}
document.body.removeChild(ta);
}

/* ================= RP 聊天 (RP 引擎) ================= */
const CFG_KEY = "nd_api_cfg_v1";
const RPCFG_KEY = "nd_rp_cfg_v1";
const getCfg = ()=>{ try{return JSON.parse(localStorage.getItem(CFG_KEY))||{}}catch(e){return{}}};
const saveCfg = (c)=> localStorage.setItem(CFG_KEY, JSON.stringify(c));
const getRpCfg = ()=> Object.assign({maxContext:8192, respTokens:512, summaryModel:"",
  temperature:0.9, topP:1, ooc:true, preset:"classic", optCards:false, optCount:4, optMood:"none", ttsAuto:false, typewriter:true,
  worldsim:true, wsPerMsg:3, wsStepMin:30, wsWxAuto:true, wsWxEvery:5, temporal:true, leanmem:true,
  apex:true,
  memCycle:10, memPoolRatio:"50/30/20",
  memWindowN:60, /* Tier2 #12 新聊天记忆窗口, 默认 60 条 */
  ppaMode:"key", ppaModel:"",
  director:true, directorTier:"sentinel", directorStyle:"slowburn", directorEvery:5, directorStale:8, directorModel:""}, JSON.parse(localStorage.getItem(RPCFG_KEY)||"{}"));
const saveRpCfg = (c)=> localStorage.setItem(RPCFG_KEY, JSON.stringify(c));
/* v37: 解析当前绑定的 ST 预设对象(未绑定返回 null); 传给 prompt 构建做预设组装 */
function resolveStPreset(){
try{
if(typeof RP_PRESET === "undefined") return null;
return RP_PRESET.get(getRpCfg().stPreset) || null;
}catch(e){ return null; }
}
const chatKey = (runId, name)=> `nd_chat_${runId}_${name}`;
/* P0-2/P0-3 修复：getHist 读失败（IO 异常/JSON 损坏）时抛错，绝不折叠成 []。
 * 调用方必须区分"读失败"与"确实无数据"：
 * - 纯展示类调用点用 getHistSafe(k)（失败当空渲染，绝不写回）；
 * - 任何"读后可能写回"的调用点必须 try/catch，失败时放弃写入并提示用户。 */
const getHist = (k)=>{
  let raw = null;
  if(typeof RP_STORE!=="undefined" && typeof RP_STORE.getSyncStrict==="function"){
    raw = RP_STORE.getSyncStrict(k); /* 文件层持续读失败时抛错 */
  }else if(typeof RP_STORE!=="undefined"){
    if(typeof RP_STORE.getSync==="function"){ raw = RP_STORE.getSync(k); }
    else { raw = RP_STORE.cacheGet(k); }
  }
  if(raw == null){
    try{ raw = localStorage.getItem(k); }
    catch(e){ throw new Error("HIST_READ_FAIL"); }
  }
  let h = [];
  if(raw != null){
    try{ h = JSON.parse(raw); }
    catch(e){ throw new Error("HIST_PARSE_FAIL"); }
    if(!Array.isArray(h)) throw new Error("HIST_PARSE_FAIL");
  }
  /* 老消息补 mid（摘要水位 msg_id 制），只新增字段 */
  let dirty = false;
  for(const m of h){
    if(m && !m.mid && !m.id){
      m.mid = (typeof nextMsgId==="function") ? nextMsgId()
        : ("m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      dirty = true;
    }
  }
  if(dirty) saveHist(k, h);
  return h;
};
/* 纯展示类调用：读失败当空历史渲染，调用方保证不写回 */
const getHistSafe = (k)=>{ try{ return getHist(k); }catch(e){ return []; } };
/* 配额类错误识别（Chrome 22 / Firefox 1014 / 标准名） */
function isQuotaErr(e){ return !!e && (e.code===22 || e.code===1014 ||
  e.name==="QuotaExceededError" || e.name==="NS_ERROR_DOM_QUOTA_REACHED"); }
/* 节流 toast：同一消息 10 秒内只弹一次，避免刷屏 */
let __toastOnceAt = {};
function rpToastOnce(msg){
  const now = Date.now();
  if(__toastOnceAt[msg] && now - __toastOnceAt[msg] < 10000) return;
  __toastOnceAt[msg] = now;
  try{ rpToast(msg); }catch(e){}
}
/* 聊天记录最多保留条数（P1-10：超出丢最早的，截断必须可见）。
 * 常量放在 saveHist 内部：tests/test_gethist_fallback.js 按源码段提取执行，要求自包含；
 * 调用方需要上限时用返回值里的 max。 */
const saveHist = (k,h)=>{
  const MAX_KEEP = 80;
  const dropped = Math.max(0, h.length - MAX_KEEP);
  const kept = h.length - dropped;
  const s = JSON.stringify(dropped ? h.slice(-MAX_KEEP) : h);
  /* P0-3: localStorage 写入失败（配额满）必须让用户知道，不能静默，更不能抛到上层打断流程 */
  try{
    localStorage.setItem(k, s);
  }catch(e){
    rpToastOnce(isQuotaErr(e) ? "存储空间已满，聊天记录可能无法保存" : "聊天记录保存失败");
  }
  /* P1-10: 超上限截断不再静默丢。固定文案 + rpToastOnce 节流，长聊天不刷屏；
     导入场景的精确条数由导入方自己播报（见 doStChatImport）。 */
  if(dropped) rpToastOnce(`聊天记录最多保留 ${MAX_KEEP} 条，更早的消息已丢弃`);
  /* P2: 大键双写 IDB（异步，失败静默回退 localStorage） */
  /* v36: 值缩小到文件层阈值下但旧文件还在时，必须把旧文件+标记清掉，
     否则下次冷启动 warmCache 会把旧大文件"复活"，盖掉 localStorage 里的新值。 */
  try{ if(typeof RP_STORE!=="undefined"){
    RP_STORE.cacheSet(k, s);
    if(typeof RP_STORE.hasFileKey==="function" && RP_STORE.hasFileKey(k) &&
       s.length <= (RP_STORE.FILE_MIN_BYTES || 262144)){
      RP_STORE.evictFile(k);
    } else {
      RP_STORE.syncBig(k, s);
    }
  } }catch(e){}
  return {kept: kept, dropped: dropped, max: MAX_KEEP};
};

let CHAT = {mode:"single", runId:null, name:null, members:[], forcedSpeaker:null};
/* P1 修复(2026-10-14): 成员名下划线双写转义, 避免 ['a_b','c'] 与 ['a','b_c'] 拼出同 key。
 * 无下划线的名字转义后不变, 老 key 保持兼容。 */
const groupKey = (runId, members)=> `nd_group_${runId}_${members.slice().sort().map(function(m){ return String(m).replace(/_/g, "__"); }).join("_")}`;
const chatHistKey = ()=> CHAT.mode==="group" ? groupKey(CHAT.runId, CHAT.members)
  : CHAT.mode==="traverse" ? `nd_travchat_${CHAT.travId}`
  : chatKey(CHAT.runId, CHAT.name);
let STREAM_SPEAKER = null;
let LAST_SYSTEM = "";
let LAST_STATS = null;

function allChars(){
const cards = (window.__DATA__ && window.__DATA__.rp_cards) || {};
const out = [];
try { RP_WRITER.getCustomChars().forEach(c=>out.push({runId:"custom", novel:c.novel, name:c.name})); } catch(e){}
try { RP_CARDIMPORT.list().forEach(c=>out.push({runId:"imported", novel:c.novel, name:c.name})); } catch(e){}
for(const r of INDEX){
const list = cards[r.run_id] || [];
if(list.length){ list.forEach(c=>out.push({runId:r.run_id, novel:r.novel, name:c.name})); }
else { const run = ((window.__DATA__||{}).runs||{})[r.run_id] || {};
(run.profiles||[]).forEach(p=>out.push({runId:r.run_id, novel:r.novel, name:p.name})); }
}
return out;
}
/* ===== 沉浸式聊天背景（CreatorSkin 式场景层） ===== */
/* 背景层 HTML：bglayer 放场景图（无图时透明，露出 .chatbg 的氛围渐变兜底） */
function chatBgHTML(){
return `<div class="chatbg" id="chatbg" aria-hidden="true"><div class="bglayer" id="chatbglayer"></div><div class="bgshade"></div><div class="bgdim"></div></div>`;
}
/* L2: 背景压暗状态机（猫箱 DimBackground 的轻量版）：
   chat=正常阅读 / sheet=消息操作菜单打开（加深压暗，聚焦菜单） */
const DimState = {
cur: "chat",
set(s){
if(this.cur === s) return;
this.cur = s;
document.body.dataset.dimstate = s;
}
};
window.DimState = DimState;
/* 用户上传壁纸：按聊天存（单聊/群聊/穿越各一套），IDB 落盘 + 内存镜像保证同步读取不闪。
   dataURL 在上传时已压缩到最长边 1080px JPEG，不会撑爆存储 */
const wallStoreKey = ()=> "nd_wallpaper_" + chatHistKey();
let WALL_MEM = {}; /* k -> {url, dim(0-70), blur(0-12)} */
/* 兼容老版本存的纯字符串 */
function normWall(v){
if(!v) return null;
if(typeof v === "string") return v.indexOf("data:") === 0 ? {url:v, dim:0, blur:0} : null;
return (v && v.url) ? {url:v.url, dim:Math.min(70, +v.dim || 0), blur:Math.min(12, +v.blur || 0)} : null;
}
function getWallOpts(){ return normWall(WALL_MEM[chatHistKey()]); }
/* 滤镜 CSS：调暗 + 模糊，保证用户自选亮图上文字依然可读 */
function wallFilterCSS(o){
if(!o) return "";
const dim = Math.min(70, Math.max(0, +o.dim || 0));
const blur = Math.min(12, Math.max(0, +o.blur || 0));
const parts = [];
if(dim > 0) parts.push("brightness(" + (1 - dim/100).toFixed(2) + ")");
if(blur > 0) parts.push("blur(" + blur + "px)");
return parts.join(" ");
}
async function warmWallpaper(){
const k = chatHistKey();
if(k in WALL_MEM) return getWallOpts();
let v = "";
try{ if(typeof RP_STORE!=="undefined") v = await RP_STORE.getItemAsync(wallStoreKey()) || ""; }catch(e){}
try{ v = JSON.parse(v); }catch(e){ /* 老版本存的是纯 dataURL 字符串 */ }
WALL_MEM[k] = v || null;
return getWallOpts();
}
/* 选背景优先级：单聊上传壁纸 > 全局壁纸 > 角色卡/穿越世界自带 bg > 内置默认图；
   图片加载失败回退渐变，绝不破图。
   预留 setChatBg(url)：以后世界状态/剧情推进可按场景切换背景 */
function pickChatBgURL(){
try{
const o = getWallOpts();
if(o && o.url) return o.url;
const g = getGlobalWallOpts();
if(g && g.url) return g.url;
if(CHAT.mode === "traverse" && typeof RP_TRAVERSE !== "undefined"){
const trav = RP_TRAVERSE.get(CHAT.travId); if(trav && trav.bg) return trav.bg;
}else if(CHAT.name && typeof allChars === "function"){
const c = (allChars() || []).find(x => x.runId === CHAT.runId && x.name === CHAT.name);
if(c && c.bg) return c.bg;
}
}catch(e){}
return "bg/chat_night.jpg";
}
function paintChatBg(){
const layer = document.getElementById("chatbglayer");
if(!layer) return;
const url = pickChatBgURL();
const filter = wallFilterCSS(getWallOpts() || getGlobalWallOpts());
const probe = new Image();
probe.onload = ()=>{ layer.style.backgroundImage = `url("${url}")`; layer.style.filter = filter; sampleBarColors(probe); };
probe.onerror = ()=>{ layer.style.backgroundImage = ""; layer.style.filter = ""; clearBarColors(); };
probe.src = url;
}
/* 三栏跟随背景色：从聊天背景图采样平均色，写成 CSS 变量给顶栏/世界条/底栏用。
   用户上传纯色壁纸换"背景色"时，三栏同步变色，不再是写死的深色。
   跨域图片会污染 canvas → getImageData 抛错 → try/catch 回退默认深色。 */
function sampleBarColors(img){
try{
const c = document.createElement("canvas"); c.width = c.height = 24;
const x = c.getContext("2d", {willReadFrequently:true});
x.drawImage(img, 0, 0, 24, 24);
const d = x.getImageData(0, 0, 24, 24).data;
let r = 0, g = 0, b = 0, m = 0;
for(let i = 0; i < d.length; i += 16){ r += d[i]; g += d[i+1]; b += d[i+2]; m++; }
r = Math.round(r/m); g = Math.round(g/m); b = Math.round(b/m);
const st = document.body.style;
st.setProperty("--barbg-head", "rgba(" + r + "," + g + "," + b + ",.58)");
st.setProperty("--barbg-bar", "rgba(" + r + "," + g + "," + b + ",.78)");
st.setProperty("--barbg-solid", "rgba(" + r + "," + g + "," + b + ",.94)");
/* 浅色背景时三栏文字转深色（body.bars-light），否则浅色字看不清 */
const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
document.body.classList.toggle("bars-light", lum > 0.6);
}catch(e){ clearBarColors(); }
}
function clearBarColors(){
try{
const st = document.body.style;
st.removeProperty("--barbg-head"); st.removeProperty("--barbg-bar"); st.removeProperty("--barbg-solid");
document.body.classList.remove("bars-light");
}catch(e){}
}
window.setChatBg = (url)=>{
const layer = document.getElementById("chatbglayer");
if(layer) layer.style.backgroundImage = url ? `url("${url}")` : "";
};
/* ============ 聊天壁纸（上传 / 恢复默认） ============ */
window.wallpaperEditor = (storeId)=>{
_wallStore = (storeId === "global") ? "global" : "chat";
const S = _wallStores[_wallStore];
__backAction = ()=>S.back();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.innerHTML = S.title; subEl.textContent = S.sub;
const o = S.get(), cur = o && o.url;
const dim = o ? o.dim : 0, blur = o ? o.blur : 0;
view.innerHTML = `<button class="back" onclick="__backAction()">${icon("back")} 返回</button>
<div class="card" style="text-align:center">
${cur ? `<img id="wall_preview" src="${cur}" style="max-width:100%;border-radius:8px;filter:${wallFilterCSS(o)}" alt="当前壁纸">`
      : `<div style="padding:24px;color:var(--ink-faint)">当前使用默认壁纸<br><span style="font-size:calc(12px * var(--fs))">上传后可调暗度和模糊</span></div>`}
</div>
${cur ? `<div class="field"><label>暗度 <span id="wall_dim_v">${dim}%</span></label>
<input type="range" id="wall_dim" min="0" max="70" value="${dim}" oninput="wallOptUI()"></div>
<div class="field"><label>模糊 <span id="wall_blur_v">${blur}px</span></label>
<input type="range" id="wall_blur" min="0" max="12" value="${blur}" oninput="wallOptUI()"></div>` : ""}
<div class="btnrow">
<button class="btn" onclick="document.getElementById('wall_file').click()">上传图片</button>
${cur ? `<button class="btn ghost" onclick="clearWallpaperUI()">恢复默认</button>` : ""}
</div>
<input type="file" id="wall_file" accept="image/*" style="display:none" onchange="uploadWallpaperUI(this)">
<div class="hint">${S.hint}</div>
<div style="height:40px"></div>`;
window.scrollTo(0,0);
};
window.saveWallpaper = async (url, opts)=>{
const k = chatHistKey();
const o = Object.assign({url:url, dim:0, blur:0}, opts || {});
o.dim = Math.min(70, +o.dim || 0); o.blur = Math.min(12, +o.blur || 0);
WALL_MEM[k] = o;
try{ if(typeof RP_STORE!=="undefined") await RP_STORE.setItemAsync(wallStoreKey(), JSON.stringify(o)); }catch(e){}
};
/* 滑杆实时预览 + 防抖落盘 */
let _wallOptT = 0;
window.wallOptUI = ()=>{
const dim = +document.getElementById("wall_dim").value || 0;
const blur = +document.getElementById("wall_blur").value || 0;
document.getElementById("wall_dim_v").textContent = dim + "%";
document.getElementById("wall_blur_v").textContent = blur + "px";
const pv = document.getElementById("wall_preview");
if(pv) pv.style.filter = wallFilterCSS({dim:dim, blur:blur});
clearTimeout(_wallOptT);
_wallOptT = setTimeout(()=>{
const S = _wallStores[_wallStore] || _wallStores.chat;
const cur = S.get() || {url:""};
S.save(cur.url, {dim:dim, blur:blur});
}, 400);
};
window.uploadWallpaperUI = (input)=>{
const f = input.files && input.files[0];
input.value = "";
if(!f) return;
if(!/^image\//.test(f.type || "")){ alert("请选择图片文件"); return; }
const rd = new FileReader();
rd.onload = ()=>{
const img = new Image();
img.onload = ()=>{
try{
const MAX = 1080;
let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
if(!w || !h) throw new Error("图片尺寸异常");
const s = Math.min(1, MAX / Math.max(w, h));
w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
cv.getContext("2d").drawImage(img, 0, 0, w, h);
const url = cv.toDataURL("image/jpeg", 0.85);
const S = _wallStores[_wallStore] || _wallStores.chat;
S.save(url).then(()=>{ alert("壁纸已更换"); wallpaperEditor(_wallStore); });
}catch(e){ alert("图片处理失败：" + (e && e.message || e)); }
};
img.onerror = ()=>alert("图片读取失败，换一张试试");
img.src = rd.result;
};
rd.onerror = ()=>alert("文件读取失败");
rd.readAsDataURL(f);
};
window.clearWallpaperUI = async ()=>{
const S = _wallStores[_wallStore] || _wallStores.chat;
await S.clear();
alert("已恢复默认壁纸"); wallpaperEditor(_wallStore);
};
/* ============ 全局壁纸：所有聊天的默认背景；单聊单独设置的优先 ============ */
const GLOBAL_WALL_KEY = "nd_wallpaper_global";
let GLOBAL_WALL = null, _gwLoaded = false;
function getGlobalWallOpts(){ return normWall(GLOBAL_WALL); }
async function warmGlobalWall(){
if(_gwLoaded) return getGlobalWallOpts();
_gwLoaded = true;
let v = "";
try{ if(typeof RP_STORE!=="undefined") v = await RP_STORE.getItemAsync(GLOBAL_WALL_KEY) || ""; }catch(e){}
try{ v = JSON.parse(v); }catch(e){}
GLOBAL_WALL = v || null;
return getGlobalWallOpts();
}
window.saveGlobalWallpaper = async (url, opts)=>{
const o = Object.assign({url:url, dim:0, blur:0}, opts || {});
o.dim = Math.min(70, +o.dim || 0); o.blur = Math.min(12, +o.blur || 0);
GLOBAL_WALL = o;
try{ if(typeof RP_STORE!=="undefined") await RP_STORE.setItemAsync(GLOBAL_WALL_KEY, JSON.stringify(o)); }catch(e){}
};
window.clearGlobalWallpaper = async ()=>{
GLOBAL_WALL = null;
try{ if(typeof RP_STORE!=="undefined") await RP_STORE.removeItemAsync(GLOBAL_WALL_KEY); }catch(e){}
};
/* 壁纸编辑器：单聊 / 全局共用一套 UI，store 决定读写与返回 */
const _wallStores = {
chat:{ title:"🖼️ 聊天壁纸", sub:"只换这个聊天的背景，存在本机",
  hint:"图片会压缩到最长边 1080px 后存到本机，只影响当前聊天。单聊、群聊、穿越各用各的壁纸。图太亮看不清字时，调高暗度或加一点模糊。",
  get:()=>getWallOpts(), save:(u,o)=>saveWallpaper(u,o),
  clear:async ()=>{ const k = chatHistKey(); WALL_MEM[k] = null;
    try{ if(typeof RP_STORE!=="undefined") await RP_STORE.removeItemAsync(wallStoreKey()); }catch(e){} },
  back:()=>showChat() },
global:{ title:"🖼️ 全局壁纸", sub:"所有聊天的默认背景，存在本机",
  hint:"图片会压缩到最长边 1080px 后存到本机。所有聊天默认都用它；某个聊天单独设过壁纸的，仍用自己的那张。",
  get:()=>getGlobalWallOpts(), save:(u,o)=>saveGlobalWallpaper(u,o),
  clear:()=>clearGlobalWallpaper(), back:()=>setNav("settings") }
};
let _wallStore = "chat";
window.globalWallpaperEditor = ()=>wallpaperEditor("global");
/* 浮生暖系 (2026-10-15): soul 卡单聊时注入暖系角色头卡 + 快捷 chips */
function applySoulWarm(){
  try{
    var v = document.getElementById("view");
    var isSoul = (typeof RP_SOUL_WARM !== "undefined") &&
      CHAT && CHAT.name && RP_SOUL_WARM.hasSoul(CHAT.runId, CHAT.name);
    if(v) v.classList.toggle("soulwarm", !!isSoul);
    if(!isSoul) return;
    var run = ((window.__DATA__ || {}).runs || {})[CHAT.runId] || {};
    var head = document.getElementById("chathead");
    if(head && !document.getElementById("sw_chead")){
      var d = document.createElement("div");
      d.id = "sw_chead";
      d.innerHTML = RP_SOUL_WARM.cheadHTML(CHAT.runId, CHAT.name, run.novel);
      head.parentNode.insertBefore(d, head.nextSibling);
    }
    var bar = document.querySelector(".chatbar");
    if(bar && !document.getElementById("sw_quick")){
      var q = document.createElement("div");
      q.id = "sw_quick";
      q.innerHTML = RP_SOUL_WARM.quickChipsHTML(CHAT.runId, CHAT.name);
      bar.parentNode.insertBefore(q, bar);
    }
  }catch(e){}
}
async function showChat(){
__backAction = ()=>exitChat();
document.body.classList.add("chatmode");
const cs = allChars();
const cfg = getCfg();
if(CHAT.mode==="group") return showGroupChat(cfg);
if(CHAT.mode==="traverse") return showTraverseChat(cfg);
if(!CHAT.name && cs.length){
const last = localStorage.getItem("nd_chat_last");
const f = cs.find(c=>`${c.runId}|${c.name}`===last) || cs[0];
CHAT = {runId:f.runId, name:f.name};
}
const run = ((window.__DATA__||{}).runs||{})[CHAT.runId] || {};
try{ if(CHAT.runId) loadWorldcard(CHAT.runId); }catch(e){} /* 世界卡预热：导演编排可用原著蓝图，fire-and-forget */
let memN = 0;
try{ const mst = RP_MEM.get(CHAT.runId, CHAT.name); memN = (mst && mst.short ? mst.short.length : 0); }catch(e){}
await warmWallpaper(); await warmGlobalWall(); /* 先读用户壁纸，避免先闪默认图 */
/* 消息操作发现性：首次进聊天提示一次"点一下消息有更多操作" */
try{
  if(!localStorage.getItem("nd_msgtools_tip")){
    localStorage.setItem("nd_msgtools_tip", "1");
    setTimeout(()=>{ try{ rpToast("💡 点一下消息，可以编辑 / 复制 / 重生 / 朗读"); }catch(e){} }, 900);
  }
}catch(e){}
view.innerHTML = `
${chatBgHTML()}
<div class="chathead" id="chathead">
<button class="backbtn" onclick="exitChat()">‹</button>
<div class="avatar">${esc((CHAT.name||"?")[0])}</div>
<div class="chead-main"><div class="cname">${esc(CHAT.name)}<span class="aimark">AI</span></div>
<div class="cstat">${run.novel?`<span>${esc(run.novel)}</span>`:""}<span id="chapter_hbadge" style="display:none;font-size:calc(11px * var(--fs));color:var(--gold);border:1px solid var(--line-soft);border-radius:999px;padding:1px 8px;cursor:pointer" onclick="chapterPicker()"></span><button onclick="toggleDrawer(false);openAlbum(CHAT.runId,CHAT.name)"><span class="mement">${icon("brain",15)} ${memN}条记忆</span>›</button></div></div>
<button class="menubtn" onclick="toggleChatSearch()" title="搜索聊天记录">${icon("search")}</button>
<button class="menubtn" onclick="toggleDrawer(true)" title="菜单">${icon("menu")}</button>
</div>
<div class="chatwrap">
<div id="ctxbar"></div>
<div id="chatsearch"></div>
<div id="chatlog"></div>
<div id="scenbar" class="scenbar"></div>
<div class="chatbar">${chatbarInner(STREAMING)}</div>
</div>
<div class="scrim" id="scrim" onclick="toggleDrawer(false)"></div>
<div class="drawer" id="drawer">
<h3>切换角色</h3>
${cs.map(c=>`<button class="whoami ${c.runId===CHAT.runId&&c.name===CHAT.name?"active":""}" data-swrun="${esc(c.runId)}" data-swname="${esc(c.name)}">
<div class="avatar sm">${esc(c.name[0])}</div>
<div><div class="name">${esc(c.name)}</div><div class="kv">${esc(c.novel)}</div></div>
</button>`).join("")}
<h3>叙事视角</h3>
${povChipsHTML()}
<h3>聊天</h3>
<button class="ditem" onclick="toggleDrawer(false);openAlbum(CHAT.runId,CHAT.name)">${icon("books")} 记忆事件簿</button>
<button class="ditem" onclick="toggleDrawer(false);wallpaperEditor()">🖼️ 聊天壁纸</button>
<button class="ditem" onclick="toggleDrawer(false);openSaves()">${icon("save")} 平行存档</button>
<button class="ditem" onclick="toggleDrawer(false);newChatSameRole()">${icon("plus")} 开新聊天</button>
<button class="ditem" onclick="toggleDrawer(false);personaEditor(CHAT.runId,'chat')">${icon("user")} 我的人设（本次覆盖）</button>
<button class="ditem" onclick="toggleDrawer(false);charDetail(CHAT.runId,CHAT.name)">${icon("user")} 角色详情</button>
<button class="ditem" onclick="toggleDrawer(false);showATasks()">${icon("chart")} 分析任务</button>
<button class="ditem" onclick="toggleDrawer(false);plotEditor()">${icon("book-open")} 剧情线</button>
${chapterEntryHTML(true)}
<button class="ditem" onclick="toggleDrawer(false);loreEditor(CHAT.runId,'chat')">${icon("book-open")} 世界书管理</button>
<button class="ditem" onclick="toggleDrawer(false);regexEditor(CHAT.runId,CHAT.name,'chat')">🔤 正则替换</button>
<button class="ditem" onclick="toggleDrawer(false);showSystem()">${icon("settings")} 人设 prompt 预览</button>
<button class="ditem" onclick="toggleDrawer(false);promptDiag()">${icon("chart")} Prompt 诊断</button>
<h3>AI 助手</h3>
<button class="ditem" onclick="toggleDrawer(false);showRelManager()">🔗 关系管理</button>
<button class="ditem" onclick="toggleDrawer(false);showCardEvo()">📝 角色卡更新建议<span id="cardevo_badge"></span></button>
<h3>⚙️ 本次聊天设置</h3>
<button class="ditem" onclick="toggleDrawer(false);showChatSettings()">🎛️ 聊天设置（Agent/参数/世界）</button>
<button class="ditem" onclick="toggleDrawer(false);exportChat()">&#x1F4E4; 复制聊天记录</button>
${foreEntryHTML()}
<button class="ditem" onclick="toggleDrawer(false);exportChatTxt()">${icon("download")} 导出聊天 TXT</button>
<button class="ditem" onclick="toggleDrawer(false);exportChatJsonl()">${icon("download")} 导出 ST JSONL</button>
<button class="ditem" onclick="toggleDrawer(false);importStChat()">${icon("upload")} 导入 ST 聊天记录</button>
<button class="ditem" onclick="toggleDrawer(false);importGouhua()">${icon("upload")} 导入构画便携包</button>
<button class="ditem danger" onclick="toggleDrawer(false);clearChat()">&#x1F5D1; 清空聊天记录</button>
<h3>设置</h3>
<button class="ditem" onclick="exitChatTo('settings')">&#x1F527; 大模型与 RP 设置</button>
</div>
${!cfg.key?`<div class="hint" style="margin:10px 14px">还没配大模型接口，先去「设置」里填 API 地址/Key/模型，聊天才能用。Key 只存在你手机上。</div>`:""}`;
renderChat();
renderScenChips();
paintChatBg();
attachHeadHide();
updateChapterBadge();
applySoulWarm(); /* 浮生暖系: soul 卡时注入角色头卡 + 快捷 chips */
const k = chatKey(CHAT.runId, CHAT.name);
/* P0-2/P0-3: 读失败≠空历史。读失败时显示错误态并直接返回，绝不写打招呼语覆盖。 */
let __h0 = null, __h0ok = true;
try{ __h0 = getHist(k); }catch(e){ __h0ok = false; }
if(!__h0ok){
const _log = document.getElementById("chatlog");
if(_log) _log.innerHTML = `<div class="msg"><div class="msgcol"><div class="bubble">⚠️ 聊天记录读取失败（存储异常），未做任何写入。请稍后重进，历史数据仍在。</div></div></div>`;
return;
}
if(!__h0.length){
/* 游玩统计：空历史进聊天 = 一次开局（纯本地，RP_STATS） */
try{ if(typeof RP_STATS !== "undefined") RP_STATS.recordSession(CHAT.runId, CHAT.name); }catch(e){}
/* 指定开场开聊：详情页点某开场进来时，首条 AI 消息直接用该开场，不再随机/生成 */
const _po = window.__pendingOpening; window.__pendingOpening = null;
const _ops = (typeof cardOpenings === "function") ? cardOpenings(CHAT.runId, CHAT.name) : [];
if(_po != null && _ops[_po]){
saveHist(k, [{mid:(typeof nextMsgId==="function"?nextMsgId():"m"+Date.now().toString(36)), role:"assistant", content:_ops[_po].text, ts:Date.now()}]); renderChat();
}else{
RP.greeting(CHAT.runId, CHAT.name, cfg, run.novel).then(g=>{
/* P1-4: 写前再确认——await 窗口内用户可能已发消息；读失败则放弃写入 */
let _h2 = null;
try{ _h2 = getHist(k); }catch(e){ return; }
if(_h2.length) return;
saveHist(k, [{mid:(typeof nextMsgId==="function"?nextMsgId():"m"+Date.now().toString(36)), role:"assistant", content:g, ts:Date.now()}]); renderChat();
});
}
}
}

/* ================= 群聊 ================= */
async function showGroupChat(cfg){
__backAction = ()=>exitChat();
try{ if(CHAT.runId) loadWorldcard(CHAT.runId); }catch(e){} /* 世界卡预热，fire-and-forget */
const ms = CHAT.members;
const k = chatHistKey();
const gkey = ms.slice().sort().join("_");
const gorder = RP_GROUP.getOrder(CHAT.runId, gkey);
const stack = ms.slice(0,4).map(n=>`<div class="avatar sm stacka">${esc(n[0])}</div>`).join("");
await warmWallpaper(); await warmGlobalWall(); /* 先读用户壁纸，避免先闪默认图 */
view.innerHTML = `
${chatBgHTML()}
<div class="chathead" id="chathead">
<button class="backbtn" onclick="exitChat()">‹</button>
<div class="stack">${stack}</div>
<div class="cname">群聊 · ${ms.length} 人<span class="aimark">AI</span><small>${esc(ms.join("、"))}</small> <span id="chapter_hbadge" style="display:none;font-size:calc(11px * var(--fs));color:var(--gold);border:1px solid var(--line-soft);border-radius:999px;padding:1px 8px;cursor:pointer" onclick="chapterPicker()"></span></div>
<button class="menubtn" onclick="toggleChatSearch()" title="搜索聊天记录">${icon("search")}</button>
<button class="menubtn" onclick="toggleDrawer(true)" title="菜单">${icon("menu")}</button>
</div>
<div class="chatwrap">
<div id="ctxbar"></div>
<div id="chatsearch"></div>
<div id="chatlog"></div>
<div id="scenbar" class="scenbar"></div>
<div class="chatbar">${chatbarInner(STREAMING)}</div>
</div>
<div class="scrim" id="scrim" onclick="toggleDrawer(false)"></div>
<div class="drawer" id="drawer">
<h3>发言顺序</h3>
<div class="povrow" style="margin-bottom:6px">
<button class="povchip ${gorder==="natural"?"on":""}" onclick="setGroupOrder('natural')">${icon("dice")} 自然发言</button>
<button class="povchip ${gorder==="list"?"on":""}" onclick="setGroupOrder('list')">${icon("repeat")} 按序轮流</button>
</div>
<div class="hint" style="margin:0 0 4px">自然：被点名者优先，其余按发言欲随机加入，一轮最多 3 人依次发言</div>
<h3>群聊成员 · 点名字定下一个人说</h3>
${ms.map(n=>{const tv=RP_GROUP.getTalk(CHAT.runId,n);
return `<div class="gmember"><button class="whoami ${CHAT.forcedSpeaker===n?"active":""}" onclick="forceSpeaker('${jq(n)}')">
<div class="avatar sm">${esc(n[0])}</div>
<div><div class="name">${esc(n)}${CHAT.forcedSpeaker===n?" · 下一个说":""}</div></div>
</button><div class="talkrow"><span>发言欲</span><input type="range" min="0" max="100" step="5" value="${tv}" oninput="setTalkVal('${jq(n)}',this.value)"><b>${tv}</b></div></div>`;}).join("")}
<h3>角色关系 · 注入群聊 prompt</h3>
<div id="grelbox"></div>
<h3>叙事视角</h3>
${povChipsHTML()}
<h3>聊天</h3>
<button class="ditem" onclick="toggleDrawer(false);showSystem()">${icon("settings")} 人设 prompt 预览</button>
<button class="ditem" onclick="toggleDrawer(false);showATasks()">${icon("chart")} 分析任务</button>
<button class="ditem" onclick="toggleDrawer(false);plotEditor()">${icon("book-open")} 剧情线</button>
${chapterEntryHTML(false)}
<button class="ditem" onclick="toggleDrawer(false);openSaves()">${icon("save")} 平行存档</button>
<button class="ditem" onclick="toggleDrawer(false);wallpaperEditor()">🖼️ 聊天壁纸</button>
<button class="ditem" onclick="toggleDrawer(false);personaEditor(null,'chat')">${icon("user")} 我的人设（全局）</button>
<button class="ditem" onclick="toggleDrawer(false);loreEditor(CHAT.runId,'chat')">${icon("book-open")} 世界书管理</button>
<button class="ditem" onclick="toggleDrawer(false);regexEditor(CHAT.runId,null,'chat')">🔤 正则替换</button>
<button class="ditem" onclick="toggleDrawer(false);exportChat()">&#x1F4E4; 复制聊天记录</button>
${foreEntryHTML()}
<button class="ditem" onclick="toggleDrawer(false);exportChatTxt()">${icon("download")} 导出聊天 TXT</button>
<button class="ditem" onclick="toggleDrawer(false);exportChatJsonl()">${icon("download")} 导出 ST JSONL</button>
<button class="ditem danger" onclick="toggleDrawer(false);clearChat()">&#x1F5D1; 清空聊天记录</button>
<h3>设置</h3>
<button class="ditem" onclick="exitChatTo('settings')">&#x1F527; 大模型与 RP 设置</button>
</div>
${!cfg.key?`<div class="hint" style="margin:10px 14px">还没配大模型接口，先去「设置」里填 API 地址/Key/模型，聊天才能用。Key 只存在你手机上。</div>`:""}`;
renderChat();
renderScenChips();
renderGRelBox();
paintChatBg();
attachHeadHide();
updateChapterBadge();
/* 浮生暖系: soul 多智能体群聊时用暖系底 */
try{
  var _soulOn = (typeof RP_SOUL_ORCH !== "undefined") &&
    RP_SOUL_ORCH.shouldUseSoulMode(CHAT.runId, CHAT.members, soulChatId());
  var _v = document.getElementById("view");
  if(_v) _v.classList.toggle("soulwarm", !!_soulOn);
}catch(e){}
/* P0-2/P0-3: 读失败≠空历史，失败时直接返回，绝不写打招呼语覆盖。 */
let __gh0 = null;
try{ __gh0 = getHist(k); }catch(e){
const _glog = document.getElementById("chatlog");
if(_glog) _glog.innerHTML = `<div class="msg"><div class="msgcol"><div class="bubble">⚠️ 聊天记录读取失败（存储异常），未做任何写入。请稍后重进，历史数据仍在。</div></div></div>`;
return;
}
if(!__gh0.length){
const sp = ms[Math.floor(Math.random()*ms.length)];
const run = ((window.__DATA__||{}).runs||{})[CHAT.runId] || {};
RP.greeting(CHAT.runId, sp, cfg, run.novel).then(g=>{
let _gh2 = null;
try{ _gh2 = getHist(k); }catch(e){ return; }
if(_gh2.length) return;
saveHist(k, [{role:"assistant", speaker:sp, content:g, ts:Date.now()}]); renderChat();
});
}
}
window.forceSpeaker = (n)=>{
CHAT.forcedSpeaker = (CHAT.forcedSpeaker===n) ? null : n;
toggleDrawer(false); showChat();
};
window.setGroupOrder = (v)=>{
const gk = (CHAT.members||[]).slice().sort().join("_");
RP_GROUP.setOrder(CHAT.runId, gk, v);
toggleDrawer(false); showChat();
};
window.setTalkVal = (n, v)=>{
RP_GROUP.setTalk(CHAT.runId, n, v);
const b = event && event.target ? event.target.parentElement.querySelector("b") : null;
if(b) b.textContent = v;
};
/* ============ Tier3-22: 群聊抽屉里的角色关系编辑器 ============ */
function renderGRelBox(){
const box = document.getElementById("grelbox"); if(!box) return;
if(typeof RP_GROUP==="undefined" || CHAT.mode!=="group"){ box.innerHTML=""; return; }
const gkey = (CHAT.members||[]).slice().sort().join("_");
const rels = RP_GROUP.getRels(CHAT.runId, gkey);
const ms = CHAT.members||[];
const opt = (sel)=> ms.map(n=>`<option value="${esc(n)}"${n===sel?" selected":""}>${esc(n)}</option>`).join("");
box.innerHTML = (rels.length
? rels.map((r,i)=>`<div class="grelrow"><span>${esc(r.a)} 是 ${esc(r.b)} 的 ${esc(r.rel)}</span><button class="btn ghost" onclick="gRelDel(${i})">删</button></div>`).join("")
/* B8: 导入卡群聊没有 run, 也就不存在"蒸馏出的静态人物关系"可继承。
   这时候编辑器不假装有关系表可读, 老实说明: 关系得自己写, 写什么就是什么, AI 不补。 */
: `<div class="hint" style="margin:0 0 6px">${CHAT.runId === "imported"
? "导入卡之间没有共用的静态人物关系。这里写什么就是什么，会注入每轮群聊 prompt，AI 不会替你补。"
: '还没设定关系，如"林黛玉是贾宝玉的表妹"，会注入每轮群聊 prompt。'}</div>`)
 + `<div class="greladd"><select id="grel_a">${opt(ms[0])}</select><span>是</span><select id="grel_b">${opt(ms[1]||ms[0])}</select><span>的</span><input id="grel_r" placeholder="表妹/师徒…"><button class="btn" onclick="gRelAdd()">＋</button></div>`;
}
window.gRelAdd = ()=>{
const a = ($("#grel_a")||{}).value, b = ($("#grel_b")||{}).value, r = (($("#grel_r")||{}).value||"").trim();
if(!a || !b || !r){ alert("把 A / B / 关系都填上"); return; }
const gkey = (CHAT.members||[]).slice().sort().join("_");
RP_GROUP.addRel(CHAT.runId, gkey, a, b, r);
renderGRelBox();
};
window.gRelDel = (i)=>{
const gkey = (CHAT.members||[]).slice().sort().join("_");
RP_GROUP.delRel(CHAT.runId, gkey, i);
renderGRelBox();
};
function showChatPicker(){
__backAction = null;
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.textContent = "选个角色开聊";
subEl.textContent = "";
const cs = allChars();
/* 未配 API Key 时的瘦横幅（跳过新手引导的用户在这里被接住） */
let keyBanner = "";
try{ if(!(getCfg().key)) keyBanner = `<div class="apibanner" onclick="setNav('settings')"><span>⚠️ 还没配置 API Key，配好才能开始聊天</span><span class="ab-go">去设置 ›</span></div>`; }catch(e){}
if(!cs.length){
view.innerHTML = `<div class="empty"><span class="big">${icon("masks",44)}</span>还没有角色<br><span style="font-size:calc(12px * var(--fs))">去「写卡」创建你的第一个角色</span><br><button class="btn" style="margin-top:10px" onclick="setNav('writer')">去写卡</button></div>`;
return;
}
/* P1 多轨道发现：最近玩过 / 我的收藏 / 换一批看看（横滑轨道，本地计算） */
const recent = recentPlayed(cs, 8);
let favs = [];
try{ favs = cs.filter(c=>{ try{ return RP_STATS.get(c.runId, c.name).fav; }catch(e){ return false; } }); }catch(e){}
const shuffled = shuffle(cs.slice()).slice(0, 8);
/* P1 分类 chips 带数量：按标签过滤全部角色 */
const counts = tagCountsOf(cs);
const active = window.PICKER_TAG || "";
const list = active ? cs.filter(c=>charTagsOf(c.runId, c.name).indexOf(active) >= 0) : cs;
/* B8: 导入卡组队入口。蒸馏 run 的群聊在 run 人物页里(发起群聊按钮), 导入卡没有 run,
   入口只能落在这个选人页 —— allChars() 里 runId==="imported" 的卡 ≥2 张才显示。 */
const _impCnt = (allChars() || []).filter(c => c.runId === "imported").length;
const groupEntry = _impCnt >= 2
  ? `<div class="btnrow" style="margin-bottom:10px"><button class="btn ghost" onclick="importedGroupPicker()">${icon("users")} 与其它导入卡组队 · ${_impCnt} 张</button></div>`
  : `<div class="hint hint-tight" style="margin:0 0 10px">导入卡还不满 2 张，暂时组不了群（导入 1 张就能开）。</div>`;
view.innerHTML = keyBanner + dailyStripHTML() + groupEntry +
(recent.length ? railHTML("🕘 最近玩过", recent) : "")
+ (favs.length ? railHTML("⭐ 我的收藏", favs) : "")
+ albumRailHTML()
+ railHTML(`🎲 换一批看看 <button class="btn ghost sm" style="margin-left:4px" onclick="event.stopPropagation();showChatPicker()">↻</button>`, shuffled)
+ chipsHTML(counts, active, cs.length)
+ `<h2 class="sec">全部角色 · ${list.length}</h2>`
+ (list.length ? `<div class="chargrid">` + list.map(c=>{
/* 游玩统计：卡片上显示开局次数与平均轮数（纯本地，RP_STATS） */
let _sum = charSumFor(c.runId,c.name)||"点我直接开聊";
let _stat = "";
try{
if(typeof RP_STATS !== "undefined"){
const _st = RP_STATS.get(c.runId, c.name);
if(_st.s > 0) _stat = "开局" + _st.s + "次 · 平均" + RP_STATS.avgTurns(_st).toFixed(0) + "轮/局";
}
}catch(e){}
return charCardHTML({name:c.name, tag:c.novel, img:charImg(c.novel, c.name), sum:_sum, stat:_stat,
oncard:`chatWith('${jq(c.runId)}','${jq(c.name)}')`,
ops:`<button class="go" onclick="event.stopPropagation();chatWith('${jq(c.runId)}','${jq(c.name)}')">开聊</button>`
+`<button onclick="event.stopPropagation();charDetail('${jq(c.runId)}','${jq(c.name)}','picker')">详情</button>`});
}).join("") + `</div>` : `<div class="empty">这个标签下还没有角色<br><button class="btn ghost sm" style="margin-top:8px" onclick="pickTag('')">清除筛选</button></div>`);
try{ window.scrollTo(0,0); }catch(e){}
}
/* ---- P1 发现页 helpers ---- */
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=a[i]; a[i]=a[j]; a[j]=t; } return a; }
/* P2 专辑轨道（发现页）：专辑横滑 + 新建/导入 */
function albumRailHTML(){
let albums = [];
try{ albums = RP_ALBUM.list(); }catch(e){}
let h = `<h2 class="sec">💿 我的专辑 <button class="btn ghost sm" style="margin-left:4px" onclick="albumCreate()">＋新建</button>`
+ `<button class="btn ghost sm" style="margin-left:4px" onclick="document.getElementById('albumFile').click()">导入</button></h2>`;
h += `<input type="file" id="albumFile" accept=".json" style="display:none" onchange="albumImportFile(this)">`;
h += `<div class="rail">`;
h += albums.map(a=>{
const cover = a.cards.length ? esc((a.cards[0].name || "?")[0]) : "💿";
return `<div class="railcard" onclick="albumPage('${jq(a.id)}')">`
+ `<div class="avatar">${cover}</div><div class="rn">${esc(a.name)}</div>`
+ `<div class="rk">${a.cards.length} 张</div></div>`;
}).join("");
h += `<div class="railcard" onclick="albumCreate()"><div class="avatar">＋</div><div class="rn">新建专辑</div><div class="rk"> </div></div>`;
return h + `</div>`;
}
window.albumCreate = ()=>{
const name = prompt("给专辑起个名字", "");
if(name == null) return;
let alb = null;
try{ alb = RP_ALBUM.create(name); }catch(e){ return; }
albumPage(alb.id);
};
window.albumPage = (id)=>{
__backAction = ()=>showChatPicker();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
let alb = null;
try{ alb = RP_ALBUM.get(id); }catch(e){}
if(!alb){ showChatPicker(); return; }
titleEl.textContent = "💿 " + alb.name;
subEl.textContent = `共 ${alb.cards.length} 张卡 · 纯本地`;
let grid = "";
if(alb.cards.length){
grid = `<div class="chargrid">` + alb.cards.map(c=>{
let sum = "";
try{ sum = charSumFor(c.runId, c.name) || ""; }catch(e){}
return charCardHTML({name: c.name, tag: c.novel || "", img: charImg(c.novel, c.name), sum: sum,
oncard: `chatWith('${jq(c.runId)}','${jq(c.name)}')`,
ops: `<button class="go" onclick="event.stopPropagation();chatWith('${jq(c.runId)}','${jq(c.name)}')">开聊</button>`
+ `<button onclick="event.stopPropagation();albumRemoveCard('${jq(id)}','${jq(c.runId)}','${jq(c.name)}')">移除</button>`});
}).join("") + `</div>`;
}else{
grid = `<div class="empty">还没有卡，点「加卡」装满它</div>`;
}
view.innerHTML = `<button class="back" onclick="showChatPicker()">${icon("back")} 返回发现</button>`
+ `<div class="btnrow"><button class="btn" onclick="albumPick('${jq(id)}')">＋ 加卡</button>`
+ `<button class="btn ghost" onclick="albumExport('${jq(id)}')">导出</button>`
+ `<button class="btn ghost" onclick="albumRename('${jq(id)}')">改名</button>`
+ `<button class="btn danger" onclick="albumDel('${jq(id)}')">删除</button></div>`
+ grid + `<div style="height:40px"></div>`;
try{ window.scrollTo(0,0); }catch(e){}
};
window.albumPick = (id)=>{
__backAction = ()=>albumPage(id);
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
let alb = null;
try{ alb = RP_ALBUM.get(id); }catch(e){}
if(!alb){ showChatPicker(); return; }
titleEl.textContent = "加卡到专辑"; subEl.textContent = `「${alb.name}」· 点 ＋ 加入`;
const cs = allChars();
const inMap = {};
alb.cards.forEach(c=>{ inMap[c.runId + "|" + c.name] = 1; });
view.innerHTML = `<button class="back" onclick="albumPage('${jq(id)}')">${icon("back")} 返回专辑</button>`
+ `<div class="chargrid">` + cs.map(c=>{
const has = inMap[c.runId + "|" + c.name];
let sum = "";
try{ sum = charSumFor(c.runId, c.name) || "点我直接开聊"; }catch(e){}
return charCardHTML({name: c.name, tag: c.novel, img: charImg(c.novel, c.name),
sum: has ? "已在专辑中" : sum,
oncard: has ? "" : `albumAdd('${jq(id)}','${jq(c.runId)}','${jq(c.name)}')`,
ops: has ? `<button disabled>已加入</button>`
: `<button class="go" onclick="event.stopPropagation();albumAdd('${jq(id)}','${jq(c.runId)}','${jq(c.name)}')">＋ 加入</button>`});
}).join("") + `</div><div style="height:40px"></div>`;
try{ window.scrollTo(0,0); }catch(e){}
};
window.albumAdd = (id, runId, name)=>{
let ok = false;
try{ ok = RP_ALBUM.addCard(id, runId, name); }catch(e){}
try{ rpToast(ok ? `已加入专辑` : `已经在专辑里了`); }catch(e){}
albumPick(id);
};
window.albumRemoveCard = (id, runId, name)=>{
try{ RP_ALBUM.removeCard(id, runId, name); }catch(e){}
albumPage(id);
};
window.albumRename = (id)=>{
let alb = null;
try{ alb = RP_ALBUM.get(id); }catch(e){}
if(!alb) return;
const name = prompt("专辑新名字", alb.name);
if(name == null) return;
try{ RP_ALBUM.rename(id, name); }catch(e){}
albumPage(id);
};
window.albumDel = (id)=>{
if(!confirm("删除这个专辑？（卡片本身不受影响）")) return;
try{ RP_ALBUM.remove(id); }catch(e){}
showChatPicker();
};
window.albumExport = (id)=>{
let data = null, alb = null;
try{ alb = RP_ALBUM.get(id); data = RP_ALBUM.exportData(id); }catch(e){}
if(!data) return;
downloadJson(`专辑-${alb.name}.json`, data);
try{ rpToast("专辑已导出"); }catch(e){}
};
window.albumImportFile = (input)=>{
const f = input.files && input.files[0];
if(!f) return;
const rd = new FileReader();
rd.onload = ()=>{
try{
const obj = JSON.parse(rd.result);
const r = RP_ALBUM.importData(obj);
try{ rpToast(`已导入专辑，收录 ${r.added} 张卡${r.skipped ? `（${r.skipped} 张跳过）` : ""}`); }catch(e){}
}catch(e){ alert("导入失败：不是有效的专辑文件"); }
input.value = "";
showChatPicker();
};
rd.readAsText(f);
};
/* 最近玩过：按最后活跃时间倒序，只取开过局的 */
function recentPlayed(cs, n){
try{
return cs.map(c=>{ let st = null; try{ st = RP_STATS.get(c.runId, c.name); }catch(e){}
return {c:c, last:(st && st.last) || 0, s:(st && st.s) || 0}; })
.filter(x=>x.s > 0).sort((a,b)=>b.last - a.last).slice(0, n || 8).map(x=>x.c);
}catch(e){ return []; }
}
/* 横滑轨道 */
function railHTML(title, cs){
return `<h2 class="sec">${title}</h2><div class="rail">` + cs.map(c=>{
return `<div class="railcard" onclick="chatWith('${jq(c.runId)}','${jq(c.name)}')">`
+ `<div class="avatar">${esc((c.name || "?")[0])}</div>`
+ `<div class="rn">${esc(c.name)}</div>`
+ `<div class="rk">${esc(c.novel || "")}</div></div>`;
}).join("") + `</div>`;
}
/* 角色标签（复用落地页 cardTags）：导入卡 novel/tags + role_tags */
function charTagsOf(runId, name){
try{
const card = (typeof RP !== "undefined" && RP.findCard) ? RP.findCard(runId, name) : null;
if(card) return cardTags(card);
}catch(e){}
return [];
}
function tagCountsOf(cs){
const m = {};
cs.forEach(c=>{ charTagsOf(c.runId, c.name).forEach(t=>{ m[t] = (m[t] || 0) + 1; }); });
return Object.keys(m).map(k=>({tag:k, n:m[k]})).sort((a,b)=>b.n - a.n).slice(0, 12);
}
function chipsHTML(counts, active, total){
let h = `<div class="chiprow"><button class="pickchip${!active ? " on" : ""}" onclick="pickTag('')">全部 ${total}</button>`;
counts.forEach(x=>{
h += `<button class="pickchip${active === x.tag ? " on" : ""}" onclick="pickTag('${jq(x.tag)}')">${esc(x.tag)} <span class="n">${x.n}</span></button>`;
});
return h + `</div>`;
}
window.PICKER_TAG = "";
window.pickTag = (t)=>{ window.PICKER_TAG = (window.PICKER_TAG === t ? "" : t); showChatPicker(); };
window.exitChat = ()=>{ SEARCH.active=false; SEARCH.q=""; SEARCH.hits=[]; SEARCH.cur=-1; showChatPicker(); };
window.exitChatTo = (n)=>{ document.body.classList.remove("chatmode","immersive"); setNav(n); };
window.toggleDrawer = (on)=>{
document.getElementById("drawer").classList.toggle("on", !!on);
document.getElementById("scrim").classList.toggle("on", !!on);
};
/* 聊天是否在底部附近: 流式/打字机/重渲染只在用户本来就看底部时才跟随,
   用户上滑看历史时不强制拽回底部, 避免持续抖动 */
function chatNearBottom(px){
const l = document.getElementById("chatlog");
if(!l) return true;
return (l.scrollHeight - l.scrollTop - l.clientHeight) < (px || 140);
}
/* P2-1: 程序化滚动抑制 —— 流式 token / 打字机 / renderChat 的 scrollTop 赋值会触发
   #chatlog 的 scroll 监听，与用户滚动无法区分，刚呼出的栏会被立刻藏回去。
   程序滚动前 markProgScroll() 打标记，120ms 抑制窗口内的 scroll 不触发隐藏。 */
let __progScrollAt = 0;
function markProgScroll(){ __progScrollAt = Date.now(); }
/* M3: 回到底部悬浮按钮（Talkie chat_page_with_bg_v2: 44x44dp, 右12/下20） */
function ensureToBottom(){
const wrap = document.querySelector(".chatwrap"); if(!wrap) return;
let b = document.getElementById("tobottom");
if(!b){
b = document.createElement("button");
b.id = "tobottom"; b.setAttribute("aria-label","回到底部"); b.textContent = "↓";
b.onclick = ()=>{ const l = document.getElementById("chatlog"); if(l) l.scrollTop = l.scrollHeight; };
wrap.appendChild(b);
}
}
function attachHeadHide(){
const log = document.getElementById("chatlog");
if(!log) return;
const head = document.getElementById("chathead");
const bar = document.querySelector(".chatbar");
const sim = document.getElementById("simbar");
const scen = document.getElementById("scenbar");
const ctx = document.getElementById("ctxbar");
const ws = document.getElementById("wsbar");
/* 点按式沉浸 (2026-10-09 v52)：正文全屏，点中间 toggles 顶底栏，滑动隐藏。
   二态切换，无跟手进度，无 transform 留白，无闪烁。 */
const bars = [head, sim, ctx, ws, scen].filter(Boolean);
let barsVisible = true;
function setBars(v){
  barsVisible = !!v;
  bars.forEach(el=>{ el.style.display = barsVisible ? "" : "none"; });
  if(bar) bar.style.display = barsVisible ? "" : "none";
  if(document.body && document.body.classList)
    document.body.classList.toggle("immersive", !barsVisible);
  /* 对外发布显隐态：P0-1 的键盘恢复要跨会话读它 */
  window.__barsVisible = barsVisible;
  try{ if(window.__immState) window.__immState.visible = barsVisible; }catch(e){}
}
/* 初始：隐藏，进入全屏沉浸 */
setBars(false);
/* 兼容旧测试钩子：__setHeadHidden(true)=隐藏，(false)=显示 */
window.__setHeadHidden = (hide)=>setBars(!hide);
/* P0-1 首屏死路：进入聊天三栏全收起，输入框/顶栏都不在屏上，唯一的恢复入口
   是"点屏幕中间"——既没有任何提示，键盘用户更是完全走不通。补三条路：
   (1) window.__showBars 供键盘/外部调用；(2) document 级 Escape 与可打印键
       自动唤回（全局只挂一次，避免每次进聊天重复叠加）；(3) 一次性居中引导。*/
window.__showBars = ()=>{ if(!barsVisible) setBars(true); };
if(!window.__immKeysBound){
  window.__immKeysBound = true;
  document.addEventListener("keydown", (e)=>{
    if(!document.body.classList.contains("chatmode")) return;   /* 不在聊天页就别插手 */
    if(window.__barsVisible !== false) return;                  /* 栏本来就看得见 */
    const ae = document.activeElement;
    if(ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName||"")) return;   /* 已在输入框里打字：别抢 */
    const k = e.key || "";
    if(k !== "Escape" && k !== "Enter" && k !== " " && k.length !== 1) return;
    if(typeof window.__showBars === "function") window.__showBars();
    if(k.length === 1){ setTimeout(()=>{ const i=document.getElementById("chat_in"); if(i && !i.disabled) i.focus(); }, 0); }
  });
}
window.__immActive = true;
window.__barsVisible = barsVisible;
try{
  if(!localStorage.getItem("nd_immguide")){
    setTimeout(()=>{
      /* 用户自己先唤出来了：这次不打扰，也不写标志 —— 否则 TA 永远看不到了 */
      if(barsVisible) return;
      const g = document.createElement("div");
      g.className = "immguide"; g.setAttribute("role","status");
      g.innerHTML = "点屏幕任意空白处<br>唤回输入栏";
      document.body.appendChild(g);
      try{ localStorage.setItem("nd_immguide", "1"); }catch(_){}
      setTimeout(()=>{ if(g.parentNode) g.remove(); }, 4600);
    }, 700);
  }
}catch(e){}
/* 点按中间呼出/隐藏：栏隐藏时，点中部任意位置（包括消息气泡）只呼出栏，
   不触发消息的编辑栏（capture 拦截 + 吞掉事件）；栏显示时点空白处隐藏栏。
   轻点判定：位移<12px、时长<400ms；中部区域为屏幕 20%~80%。 */
let tsX=0, tsY=0, tsT=0;
log.addEventListener("touchstart", (e)=>{
  const t = e.touches[0];
  tsX = t.clientX; tsY = t.clientY; tsT = Date.now();
}, {passive:true});
function isTap(clientX, clientY){
  /* 移动端用 touchstart 记录的起点；桌面端直接视为 tap */
  if(tsT){
    const dx = clientX - tsX, dy = clientY - tsY;
    if(Math.hypot(dx, dy) > 12 || Date.now() - tsT > 400) return false;
  }
  const h = window.innerHeight;
  return clientY >= h*0.2 && clientY <= h*0.8;
}
/* 移动端：touchend 先行，呼出栏并立 flag 供 toggleTools 吞掉随后到来的 click */
log.addEventListener("touchend", (e)=>{
  const t = e.changedTouches[0];
  if(!isTap(t.clientX, t.clientY)) return;
  if(!barsVisible){
    setBars(true);
    window.__barsRevealTs = Date.now();
  }
}, {passive:true});
/* 桌面端 + 兜底：capture 阶段拦截，栏隐藏时吞掉消息的 click */
log.addEventListener("click", (e)=>{
  if(!isTap(e.clientX, e.clientY)) return;
  /* 避免 touchend 已处理后又触发一次 */
  if(Date.now() - tsT < 500 && tsT) return;
  if(!barsVisible){
    e.stopPropagation();
    e.preventDefault();
    setBars(true);
  }else if(e.target === log){
    setBars(false);
  }
}, true);
/* 滑动隐藏：栏显示时一旦滚动就藏（P2-1: 程序化滚动在抑制窗口内不触发隐藏） */
let lastST = log.scrollTop;
log.addEventListener("scroll", ()=>{
  const st = log.scrollTop;
  const progScroll = (Date.now() - __progScrollAt) < 120;
  if(!progScroll && Math.abs(st - lastST) > 8 && barsVisible){
    /* 输入框聚焦时不藏底栏（键盘弹起时） */
    const ae = document.activeElement;
    const typing = !!ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName || "");
    if(!typing) setBars(false);
  }
  lastST = st;
  const tb = document.getElementById("tobottom");
  if(tb){
    const dist = Math.max(0, (log.scrollHeight - log.clientHeight) - st);
    tb.classList.toggle("show", dist > 200);
  }
}, {passive:true});
ensureToBottom(); /* M3: 注入回到底部按钮（单聊/群聊/穿越共用） */
} /* attachHeadHide end */
window.exportChat = ()=>{
const h = getHistSafe(chatHistKey());
const txt = h.map(m=>`${m.role==="user"?"我":(CHAT.mode==="group"?(m.speaker||"?"):CHAT.name)}：${m.content}`).join("\n\n");
copyText(txt);
alert(`已复制 ${h.length} 条消息到剪贴板`);
};
/* ============ 伏笔面板 + 剧情导出 (对标 Talkie 剧情 "Foreshadowing Panel · EPUB Export") ============ */
/* 数据: RP_FORE (www/data/foreshadow_cal.js 蒸馏管线事件日历, 897 条伏笔) */
let FS_TAB = "unresolved";
/* B19 伏笔数据源是 www/data/foreshadow_cal.js: 纯《红楼梦》蒸馏产物, 无 runId 隔离
   (rp/foreshadow.js 直读 window.__CAL__)。非红楼聊天(导入卡/水浒/清安录…)打开面板
   看到的是别的书的伏笔 = 串味, 故按当前聊天所属小说的世界门禁。
   run 取法同 relRunFor: 蒸馏 run 走 __DATA__.runs[runId], 导入卡/custom 走
   RP.synthRunFor(runId,name) 的合成 run(带 novel)。 */
const FORE_NOVEL = "红楼梦";
function foreRunFor(runId, name){
  return relRunFor(runId, name);
}
/* B20: 门禁参数化 —— novelMaterial 按 NOV.runId/NOV.name 判定 (非 CHAT),
   与抽屉入口的 foreAvailable() 语义一致 */
function foreAvailableFor(runId, name){
  var run = foreRunFor(runId, name);
  return String((run && run.novel) || "") === FORE_NOVEL;
}
function foreAvailable(){
  return foreAvailableFor(CHAT.runId, CHAT.name);
}
/* 抽屉入口 (单聊/群聊共用): 非红楼梦世界返回空串, 按钮不渲染 */
function foreEntryHTML(){
  if(!foreAvailable()) return "";
  return `<button class="ditem" onclick="toggleDrawer(false);showForeshadow()">${icon("book-open")} 伏笔面板</button>`;
}
window.showForeshadow = ()=>{
if(!foreAvailable()){ rpToast("伏笔面板仅支持《红楼梦》蒸馏剧本"); return; }
if(typeof RP_FORE === "undefined" || !RP_FORE.items().length){ rpToast("伏笔数据未加载"); return; }
FS_TAB = "unresolved";
renderForeshadow();
};
window.fsTab = (t)=>{ FS_TAB = t; renderForeshadow(); };
function renderForeshadow(){
const run = foreRunFor(CHAT.runId, CHAT.name); /* 门禁已保证是《红楼梦》世界; 副标题按当前 run 取书名 */
__backAction = ()=>showChat();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.innerHTML = icon("book-open") + " 伏笔面板";
const g = RP_FORE.group();
subEl.textContent = (run.novel || "红楼梦") + ` · 未回收 ${g.unresolved.length} · 已回收 ${g.resolved.length}`;
const list = FS_TAB === "resolved" ? g.resolved : g.unresolved;
const CAP = 200;
const cards = list.slice(0, CAP).map(x=>{
const e = x.e;
const resolved = RP_FORE.isResolved(e);
return `<div class="card card--tap" onclick="foreshadowChapter(${jq(e.ch)})" style="cursor:pointer">
<div style="font-size:calc(13px * var(--fs));margin-bottom:6px">${esc(e.s || "")}</div>
<div class="row"><span class="badge" style="${resolved?"":"background:#f5e6c8;color:#8a6d2f"}">${esc(RP_FORE.statusText(e))}</span>
<span class="kv">第 ${e.ch} 回</span>
<span class="kv">${esc(RP_FORE.peopleText(e))}</span>
<span style="flex:1"></span><span class="kv">›</span></div></div>`;
}).join("");
view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回聊天</button>
<div class="dtabs">
<button class="dtab${FS_TAB==="unresolved"?" on":""}" onclick="fsTab('unresolved')">未回收 · ${g.unresolved.length}</button>
<button class="dtab${FS_TAB==="resolved"?" on":""}" onclick="fsTab('resolved')">已回收 · ${g.resolved.length}</button>
</div>
<div class="hint">状态按蒸馏数据推导: 有回收时间点的记为「已回收」。点任意条目跳转到对应回目的事件。</div>
${cards || `<div class="empty">暂无</div>`}
${list.length > CAP ? `<div class="hint">仅展示前 ${CAP} 条, 共 ${list.length} 条</div>` : ""}
<div style="height:40px"></div>`;
window.scrollTo(0,0);
}
/* 点击伏笔 -> 跳转对应回目 (事件日历/回目映射) */
window.foreshadowChapter = (ch)=>{
__backAction = ()=>renderForeshadow();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.innerHTML = icon("book-open") + ` 第 ${ch} 回`;
subEl.textContent = "事件日历 · 回目事件";
const evs = (typeof RP_FORE !== "undefined") ? RP_FORE.chapterOf(ch) : [];
const KN = {event: "事件", foreshadowing: "伏笔", turning_point: "转折点", arc_turning_point: "弧光转折"};
const groups = {};
evs.forEach(x=>{ const k = x.e.k || "event"; (groups[k] = groups[k] || []).push(x); });
const body = Object.keys(groups).map(k=>
`<h2 class="sec">${KN[k] || k} · ${groups[k].length}</h2>` +
groups[k].map(x=>`<div class="card"><div style="font-size:calc(13px * var(--fs))">${esc(x.e.s || "")}</div>
<div class="kv" style="margin-top:4px">${esc(RP_FORE.peopleText(x.e))}</div></div>`).join("")
).join("") || `<div class="empty">该回目暂无事件</div>`;
view.innerHTML = `<button class="back" onclick="renderForeshadow()">${icon("back")} 返回伏笔面板</button>
${body}<div style="height:40px"></div>`;
window.scrollTo(0,0);
};
/* 聊天记录导出 TXT (纯文本: 时间 + 说话人 + 内容; EPUB 不做, TXT 保底) */
function downloadTxt(name, text){
try{
const blob = new Blob(["\ufeff" + text], {type: "text/plain;charset=utf-8"});
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = name;
document.body.appendChild(a); a.click();
setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(e){} a.remove(); }, 800);
}catch(e){ copyText(text); rpToast("下载失败, 已复制到剪贴板"); }
}
/* JSON 下载 (ST 制品导出用, 无 BOM) */
function downloadJson(name, obj){
downloadRaw(name, JSON.stringify(obj, null, 2), "application/json;charset=utf-8");
}
/* 原始文本下载 (无 BOM, JSONL 等用) */
function downloadRaw(name, text, mime){
try{
const blob = new Blob([text], {type: mime || "text/plain;charset=utf-8"});
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = name;
document.body.appendChild(a); a.click();
setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(e){} a.remove(); }, 800);
}catch(e){ copyText(text); rpToast("下载失败, 已复制到剪贴板"); }
}
window.exportChatTxt = ()=>{
const h = getHistSafe(chatHistKey());
if(!h.length){ rpToast("没有可导出的聊天记录"); return; }
const who = (m)=> m.role === "user" ? "我"
  : (CHAT.mode === "group" ? (m.speaker || "?") : (CHAT.name || "?"));
const txt = h.map(m=>{
const ts = m.ts ? new Date(m.ts).toLocaleString("zh-CN") : "";
return `[${ts}] ${who(m)}: ${m.content}`;
}).join("\n\n");
const nm = CHAT.mode === "group" ? "群聊" : (CHAT.name || "聊天");
downloadTxt(`${nm}_聊天记录.txt`, txt);
rpToast(`已导出 ${h.length} 条`);
};
/* ST 聊天记录导出(JSONL): 与 stChatParse/stChatToEntries 互逆, 可导回 ST */
window.exportChatJsonl = ()=>{
const h = getHistSafe(chatHistKey());
if(!h.length){ rpToast("没有可导出的聊天记录"); return; }
const p = (typeof RP_PERSONA !== "undefined") ? RP_PERSONA.getGlobal() : null;
const meta = {userName: (p && p.name) || "User",
  charName: CHAT.mode === "group" ? "群聊" : (CHAT.name || ""),
  chatMeta: getStChatMeta()};
const nm = CHAT.mode === "group" ? "群聊" : (CHAT.name || "聊天");
downloadRaw(`${nm}_st.jsonl`, stEntriesToJsonl(h, meta), "application/jsonl");
rpToast(`已导出 ${h.length} 条 (ST JSONL)`);
};
/* ST 聊天记录(JSONL) -> 本机消息条目。
 * ST 格式: 每行一个 JSON; 首行是会话元数据 {user_name, character_name, create_date, chat_metadata};
 * 消息行 {name, is_user, is_system, send_date, mes, extra, ...}。
 * 映射: is_user->user, is_system->system(进 prompt 时仍是 system, 忠实),
 * 其它->assistant(保留 speaker=name); send_date 解析失败回退 Date.now();
 * 空 mes 跳过; extra 字段(如构画 gouhua_snapshot、swipe 变体)原样保留进条目 stExtra,
 * 导出时写回; 首行 chat_metadata 按聊天另存, 覆盖导入时替换、导出时写回。 */
function stChatParse(text){
const lines = String(text || "").split("\n");
const raw = [];
for(const ln of lines){ const s = ln.trim(); if(!s) continue;
try{ raw.push(JSON.parse(s)); }catch(e){ return null; } }
if(!raw.length) return null;
let meta = null; const msgs = [];
raw.forEach(function(o){
if(!o || typeof o !== "object") return;
if(!meta && o.mes === undefined && (o.character_name || o.user_name)){ meta = o; return; }
msgs.push(o);
});
return {meta: meta, msgs: msgs};
}
function stChatToEntries(parsed){
if(!parsed || !parsed.msgs) return [];
const out = [];
parsed.msgs.forEach(function(m){
if(!m || typeof m.mes !== "string" || !m.mes.trim()) return;
const role = m.is_user ? "user" : (m.is_system ? "system" : "assistant");
const e = {role: role, content: m.mes};
/* ST 扩展数据透传: message.extra(如构画 gouhua_snapshot、swipe 变体)原样保留,
 * 导出时写回, 经本机一进一出不丢失。 */
if(m.extra && typeof m.extra === "object"){
try{ const ex = JSON.parse(JSON.stringify(m.extra));
if(ex && Object.keys(ex).length) e.stExtra = ex; }catch(_){}
}
/* ST 的 send_date 如 "January 27, 2026 2:32am"(am 前无空格) Date.parse 吃不下，先规范化 */
let sd = String(m.send_date || "").replace(/(\d)(am|pm)\s*$/i, "$1 $2");
let ts = Date.parse(sd); e.ts = isNaN(ts) ? Date.now() : ts;
if(role === "assistant" && m.name) e.speaker = m.name;
out.push(e);
});
return out;
}
/* ST send_date 格式: "January 27, 2026 2:32am" (am 前无空格, 与 ST 一致) */
function stFormatDate(ts){
const d = new Date(+ts || Date.now());
const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
let h = d.getHours(); const ap = h >= 12 ? "pm" : "am"; h = h % 12; if(h === 0) h = 12;
const mm = (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear() + " " + h + ":" + mm + ap;
}
/* 本机消息条目 -> ST 聊天记录 JSONL (stChatParse/stChatToEntries 的逆操作)。
 * entries: [{role:'user'|'assistant'|'system', content, ts, speaker}];
 * meta: {userName, charName}。首行写会话元数据, 其后每行一条消息。 */
function stEntriesToJsonl(entries, meta){
meta = meta || {};
const userName = meta.userName || "User", charName = meta.charName || "";
const first = {user_name: userName, character_name: charName,
create_date: stFormatDate((entries && entries[0] && entries[0].ts) || Date.now())};
/* 扩展数据透传: 首行 chat_metadata(如构画 sp-store/sp-memory/sp-theater/sp-ledger)原样写回 */
if(meta.chatMeta && typeof meta.chatMeta === "object" && Object.keys(meta.chatMeta).length)
first.chat_metadata = meta.chatMeta;
const lines = [JSON.stringify(first)];
(entries || []).forEach(function(e){
if(!e || typeof e.content !== "string" || !e.content.trim()) return;
const isUser = e.role === "user", isSys = e.role === "system";
const line = {
name: isUser ? userName : (e.speaker || charName),
is_user: isUser,
is_system: isSys,
send_date: stFormatDate(e.ts),
mes: e.content
};
/* 扩展数据透传: 消息级 extra(如 gouhua_snapshot)原样写回 */
if(e.stExtra && typeof e.stExtra === "object" && Object.keys(e.stExtra).length)
line.extra = e.stExtra;
/* Soul 元数据: _soul/_speakers/_turnId/_conflicts 进 extra.soul */
if(e._soul){
  line.extra = line.extra || {};
  line.extra.soul = {
    speakers: e._speakers || [],
    turnId: e._turnId || "",
    conflicts: (e._conflicts || []).map(function(c){ return {a: c.a, b: c.b}; }),
    conflictResolved: !!e._conflictResolved
  };
}
lines.push(JSON.stringify(line));
});
return lines.join("\n");
}
/* ST 扩展数据透传(chat_metadata): 构画等扩展把点线面间数据存在首行 chat_metadata
 * (sp-store/sp-memory/sp-theater/sp-ledger)。导入时按聊天存下, 导出时原样写回。
 * 只透传不解析, 不进 prompt, 不在 UI 展示。 */
const stChatMetaKey = ()=> "nd_stmeta_" + chatHistKey();
function getStChatMeta(){ try{ return JSON.parse(localStorage.getItem(stChatMetaKey())) || null; }catch(e){ return null; } }
function setStChatMeta(o){ try{
if(o && typeof o === "object" && Object.keys(o).length) localStorage.setItem(stChatMetaKey(), JSON.stringify(o));
else localStorage.removeItem(stChatMetaKey());
}catch(e){} }
/* ST 聊天记录导入: 聊天页抽屉 -> 选 .jsonl -> 确认页(目标/追加或覆盖) -> 写入当前单人聊天 */
let STCHAT_PENDING = null;
window.importStChat = ()=>{
if(CHAT.mode !== "single" || !CHAT.name){ alert("请先打开一个单人聊天再导入"); return; }
const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".jsonl,application/json";
inp.onchange = ()=>{
const f = inp.files[0]; if(!f) return;
const rd = new FileReader();
rd.onload = ()=>{
try{
const parsed = stChatParse(rd.result);
if(!parsed){ alert("解析失败: 不是 ST 聊天记录(JSONL, 每行一个 JSON)"); return; }
const entries = stChatToEntries(parsed);
if(!entries.length){ alert("解析失败: 文件里没有可导入的消息"); return; }
STCHAT_PENDING = {parsed: parsed, entries: entries, file: f.name};
stChatConfirm();
}catch(e){ alert("解析失败: " + e.message); }
};
rd.readAsText(f);
};
inp.click();
};
function stChatConfirm(){
const p = STCHAT_PENDING; if(!p) return;
__backAction = ()=>showChat();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.innerHTML = icon("upload") + " 导入 ST 聊天记录";
const meta = p.parsed.meta || {};
const charName = meta.character_name || "";
const userName = meta.user_name || "";
const n = p.entries.length;
const tss = p.entries.map(e=>e.ts).filter(Boolean);
const range = tss.length ? (new Date(Math.min.apply(null, tss)).toLocaleString("zh-CN") + " ~ " + new Date(Math.max.apply(null, tss)).toLocaleString("zh-CN")) : "";
const nUser = p.entries.filter(e=>e.role === "user").length;
const nAsst = p.entries.filter(e=>e.role === "assistant").length;
const nSys = p.entries.filter(e=>e.role === "system").length;
const mismatch = charName && charName !== CHAT.name;
/* 扩展数据透传提示: 首行 chat_metadata(如构画点线面间)与消息 extra(如楼层快照) */
const chatMetaKeys = meta.chat_metadata && typeof meta.chat_metadata === "object"
? Object.keys(meta.chat_metadata) : [];
const hasChatMeta = chatMetaKeys.length > 0;
const nExtra = p.entries.filter(e=>e.stExtra).length;
subEl.textContent = p.file;
view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回聊天</button>
<div class="card"><div class="kv">文件角色</div><div class="name">${esc(charName || "未知")}</div>
<div class="meta">玩家: ${esc(userName || "未知")}${range ? ` · ${esc(range)}` : ""}</div>
<div class="meta">共 ${n} 条消息（我 ${nUser} / AI ${nAsst}${nSys ? ` / 系统 ${nSys}` : ""}）</div>
${hasChatMeta ? `<div class="meta">含 ST 扩展数据（chat_metadata: ${esc(chatMetaKeys.slice(0,4).join("、"))}${chatMetaKeys.length>4?"…":""}），覆盖导入时会一并保留</div>` : ""}
${nExtra ? `<div class="meta">${nExtra} 条消息含 extra 扩展数据（如楼层快照），将保留并在导出时写回</div>` : ""}</div>
<div class="card"><div class="kv">导入到</div><div class="name">${esc(CHAT.name)}</div>
<div class="meta">当前单人聊天${mismatch ? ` · <span style="color:var(--danger)">文件中角色名「${esc(charName)}」与当前角色不一致，仍可导入</span>` : ""}</div></div>
<div class="field"><label>导入方式</label>
<label style="display:block;margin:6px 0"><input type="radio" name="stchat_mode" value="append" checked style="width:auto"> 追加到现有记录后面</label>
<label style="display:block;margin:6px 0"><input type="radio" name="stchat_mode" value="replace" style="width:auto"> 覆盖（清空当前聊天记录）</label></div>
<div class="meta" style="margin-bottom:10px">聊天记录最多保留 80 条，超出部分只保留最新的 80 条；swipe 变体等多轮回复只导入当前显示的一条；消息的 extra 扩展数据会一并保留，导出时写回。</div>
<button class="btn primary" onclick="doStChatImport()">开始导入</button>`;
}
window.doStChatImport = ()=>{
const p = STCHAT_PENDING; if(!p) return;
const mode = (document.querySelector('input[name="stchat_mode"]:checked') || {}).value || "append";
if(mode === "replace" && !confirm("确定清空当前聊天记录并导入？")) return;
const k = chatHistKey();
/* P0-3: 追加导入前严格读历史，读失败则中止导入（不能拿空数组覆盖真实历史） */
let cur = [];
if(mode === "append"){
try{ cur = getHist(k); }catch(e){ rpToast("聊天记录读取失败，导入已中止"); return; }
}
const merged = cur.concat(p.entries);
const saved = saveHist(k, merged);
/* 扩展数据透传: 覆盖模式连首行 chat_metadata 一起换(构画点线面间数据跟聊天走);
 * 追加模式保留当前聊天的, 只带走消息级 extra。 */
if(mode === "replace"){
const cm = p.parsed.meta && p.parsed.meta.chat_metadata;
setStChatMeta(cm && typeof cm === "object" ? cm : null);
}
STCHAT_PENDING = null;
/* P1-10: toast 播报实际入库条数——merged 超上限被 saveHist 截断时,
 p.entries.length 是谎报；被丢弃的是"最早的 droppedTotal 条"（含被挤掉的旧记录） */
const curKept = Math.max(0, cur.length - saved.dropped);
const fileKept = saved.kept - curKept;
rpToast(`已导入 ${fileKept} 条` +
  (saved.dropped ? `（超出 ${saved.max} 条上限，最早的 ${saved.dropped} 条已丢弃）` : ""));
showChat();
};
/* 构画便携包导入: 聊天页抽屉 -> 选 .json -> 确认页(模块清单/映射预览) -> 世界书+当前聊天
 * 模块映射(见 RP_GOUHUA): 点/线/面(大纲)/历/棱 -> 世界书条目; 间/面讨论 -> 聊天消息。
 * 只做数据吸收, 不解释构画功能; 世界书条目走既有 lorebook 存储, 照常参与触发。 */
let GOUHUA_PENDING = null;
window.importGouhua = ()=>{
if(CHAT.mode !== "single" || !CHAT.name){ alert("请先打开一个单人聊天再导入"); return; }
if(typeof RP_GOUHUA === "undefined" || !RP_GOUHUA.parsePortable){ rpToast("构画模块未加载"); return; }
const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
inp.onchange = ()=>{
const f = inp.files[0]; if(!f) return;
const rd = new FileReader();
rd.onload = ()=>{
const r = RP_GOUHUA.parsePortable(rd.result);
if(!r.ok){ alert("解析失败: " + r.message); return; }
GOUHUA_PENDING = {pkg: r.pkg, file: f.name};
gouhuaConfirm();
};
rd.readAsText(f);
};
inp.click();
};
function gouhuaConfirm(){
const p = GOUHUA_PENDING; if(!p) return;
__backAction = ()=>showChat();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.innerHTML = icon("upload") + " 导入构画便携包";
subEl.textContent = p.file;
const rows = RP_GOUHUA.summarize(p.pkg);
const nLore = rows.reduce((a,r)=>a+r.lore, 0), nChat = rows.reduce((a,r)=>a+r.chat, 0);
view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回聊天</button>
<div class="card"><div class="kv">数据包</div><div class="name">${esc(p.file)}</div>
<div class="meta">构画便携包 v${p.pkg.version}${p.pkg.exportedAt ? " · " + esc(p.pkg.exportedAt.slice(0,10)) : ""}</div>
<div class="meta">共 ${rows.length} 个模块 → 世界书 ${nLore} 条${nChat ? " + 聊天 " + nChat + " 条" : ""}</div></div>
<div class="card"><div class="kv">模块映射</div>
${rows.map(r=>`<div class="meta" style="margin:4px 0">· ${esc(r.label)} → ${esc(r.target)}</div>`).join("")}
<div class="meta" style="margin-top:8px">导入到：世界书（${esc(CHAT.name)} 所在世界）${nChat ? "＋当前聊天" : ""}</div></div>
<div class="meta" style="margin-bottom:10px">点/线/面(大纲)/历/棱进入世界书参与关键词触发；间(局外聊天)与面讨论追加到当前聊天记录后面。</div>
<button class="btn primary" onclick="doGouhuaImport()">开始导入</button>`;
}
window.doGouhuaImport = ()=>{
const p = GOUHUA_PENDING; if(!p) return;
const loreEntries = RP_GOUHUA.toLoreEntries(p.pkg);
const chatEntries = RP_GOUHUA.toChatEntries(p.pkg);
if(loreEntries.length && CHAT.runId){
const a = getLore(CHAT.runId);
loreEntries.forEach(e=>a.push(e));
saveLore(CHAT.runId, a);
}
if(chatEntries.length){
const k = chatHistKey();
let _gh = null;
try{ _gh = getHist(k); }catch(e){ rpToast("聊天记录读取失败，导入已中止"); return; }
saveHist(k, _gh.concat(chatEntries));
}
GOUHUA_PENDING = null;
rpToast(`已导入构画数据：世界书 ${loreEntries.length} 条，聊天 ${chatEntries.length} 条`);
showChat();
};
function copyText(t){
if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t); return; }
const ta = document.createElement("textarea");
ta.value = t; document.body.appendChild(ta); ta.select();
try{ document.execCommand("copy"); }catch(e){}
document.body.removeChild(ta);
}
window.copyMsg = (idx)=>{
const h = getHistSafe(chatHistKey());
copyText(h[idx].content);
};
window.delMsg = (idx)=>{
const k = chatHistKey();
let h = null;
try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败"); return; }
h.splice(idx, 1);
saveHist(k, h); renderChat();
};
/* Tier2 #13: 消息已进记忆时, 删除前询问"删消息和记忆 / 只删消息" (对标 Janitor 删除对话框)。
 * 未进记忆 → 走旧 confirm 直删。 */
window.delMsgAsk = (idx)=>{
const k = chatHistKey();
const h = getHistSafe(k);
const m = h[idx]; if(!m) return;
msgSheet(false);
let inMem = false;
if(CHAT.mode === "single"){
try{ inMem = RP_MEM.msgInMemory(CHAT.runId, CHAT.name, m, h).inMemory; }catch(e){}
}
if(!inMem){
if(confirm("删除这条消息？")) window.delMsg(idx);
return;
}
const ov = document.createElement("div");
ov.className = "cfcheck";
ov.innerHTML = `<div class="cfbox"><div class="cfttl">删除这条消息？</div>`
+ `<div class="cfbody">${esc(RP_MEM.delAskText())}</div>`
+ `<div class="cfbtns"><button class="btn" id="delask_both">删除消息和记忆</button>`
+ `<button class="btn ghost" id="delask_msg">只删消息</button>`
+ `<button class="btn ghost" id="delask_cancel">取消</button></div></div>`;
document.body.appendChild(ov);
const done = ()=>ov.remove();
ov.querySelector("#delask_cancel").onclick = done;
ov.onclick = (e)=>{ if(e.target === ov) done(); };
ov.querySelector("#delask_both").onclick = ()=>{
window.delMsg(idx);
try{ RP_MEM.clear(CHAT.runId, CHAT.name); }catch(e){}
done();
};
ov.querySelector("#delask_msg").onclick = ()=>{ window.delMsg(idx); done(); };
};
/* ============ P0-2 消息编辑: 原地改文本; 改用户消息后自动重生成其后 AI 回复 ============ */
window.editMsg = (idx)=>{
if(document.getElementById("live")){ alert("等这条生成完再编辑"); return; }
const msgs = document.querySelectorAll("#chatlog .msg");
const el = msgs[idx]; if(!el) return;
const bub = el.querySelector(".bubble"); if(!bub || bub.querySelector("textarea")) return;
let h = null;
try{ h = getHist(chatHistKey()); }catch(e){ rpToast("聊天记录读取失败"); return; }
const m = h[idx]; if(!m) return;
bub.dataset.orig = bub.innerHTML;
bub.innerHTML = `<textarea id="editbox" onclick="event.stopPropagation()" style="width:100%;min-height:80px;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px;font-size:calc(14px * var(--fs))">${esc(m.content)}</textarea>`
+ `<div class="btnrow" style="margin-top:6px" onclick="event.stopPropagation()"><button class="btn" onclick="editMsgSave(${jq(idx)})">保存${m.role==="user"?"并重生成":""}</button>`
+ `<button class="btn ghost" onclick="editMsgCancel(${jq(idx)})">取消</button></div>`;
const ta = document.getElementById("editbox");
if(ta){ ta.focus(); try{ ta.setSelectionRange(ta.value.length, ta.value.length); }catch(e){} }
};
window.editMsgCancel = (idx)=>{
const msgs = document.querySelectorAll("#chatlog .msg");
const el = msgs[idx]; if(!el) return;
const bub = el.querySelector(".bubble");
if(bub && ("orig" in bub.dataset)) bub.innerHTML = bub.dataset.orig;
};
/* ============ P0-3 长按消息统一操作菜单 (对标 C.AI 长按菜单) ============ */
window.pinChatMsg = (idx)=>{
if(CHAT.mode !== "single") return;
/* Tier2 #5: Pin 上限 5 条 (C.AI "Pin up to 5 messages") */
if(!RP_MEM.canPinChatMsg(CHAT.runId, CHAT.name)){ msgSheet(false); alert(RP_MEM.msgPinLimitMsg()); return; }
const h = getHistSafe(chatHistKey());
const m = h[idx]; if(!m) return;
const who = m.role === "user" ? "我" : (CHAT.name || "TA");
const st = RP_MEM.get(CHAT.runId, CHAT.name) || {};
st.short = st.short || [];
let nid = 1;
st.short.forEach(x=>{ if(x.id >= nid) nid = x.id + 1; });
st.short.push({id: nid, time: "手动置顶", ts: Date.now(),
fact: (who + "：" + String(m.content).replace(/<[^>]*>/g, "").slice(0, 120)),
view: "", pin: true});
st.updatedAt = Date.now();
RP_MEM.save(CHAT.runId, CHAT.name, st);
msgSheet(false);
achvUnlock("pin_1");
pinNudge(CHAT.runId, CHAT.name);
alert("已 Pin 为长期记忆 📌");
};
let _pressT = null, _pressFired = false;
window.msgPressStart = (ev, idx)=>{
_pressFired = false;
if(_pressT) clearTimeout(_pressT);
_pressT = setTimeout(()=>{ _pressFired = true; msgMenu(idx); }, 550);
};
window.msgPressEnd = ()=>{ if(_pressT){ clearTimeout(_pressT); _pressT = null; } };
window.msgMenu = (idx)=>{
msgPressEnd();
msgSheet(true, idx);
/* Tier2 #5: 首次长按弹一次教育气泡 (C.AI "To pin a memory, press and hold any chat message...") */
try{
if(!RP_MEM.pinEduSeen()){
RP_MEM.pinEduMark();
const sh = document.getElementById("msgsheet");
if(sh && !sh.querySelector(".pinedu")){
const b = document.createElement("div");
b.className = "pinedu";
b.textContent = RP_MEM.pinEduText(CHAT.name);
b.onclick = ()=>b.remove();
sh.insertBefore(b, sh.firstChild);
setTimeout(()=>{ if(b.parentNode) b.remove(); }, 8000);
}
}
}catch(e){}
};
window.msgSheet = (on, idx)=>{
DimState.set(on ? "sheet" : "chat"); /* L2: 菜单打开时压暗背景 */
let sh = document.getElementById("msgsheet");
let sc = document.getElementById("msgscrim");
if(!on){
if(sh) sh.classList.remove("on");
if(sc) sc.classList.remove("on");
return;
}
const h = getHistSafe(chatHistKey());
const m = h[idx]; if(!m) return;
if(!sh){
sc = document.createElement("div");
sc.id = "msgscrim"; sc.className = "scrim msscrim";
sc.onclick = ()=>msgSheet(false);
document.body.appendChild(sc);
sh = document.createElement("div");
sh.id = "msgsheet"; sh.className = "msgsheet";
document.body.appendChild(sh);
}
const isAI = m.role === "assistant";
const canPin = CHAT.mode === "single";
const rewritable = isAI && m.content.indexOf("⚠️")!==0 && m.content.indexOf("【OOC")!==0 && m.content.indexOf("（已停止")!==0;
const prev = String(m.content).replace(/<[^>]*>/g, "").slice(0, 40);
const item = (fn, ic, label, danger)=>
`<button class="msitem${danger?" danger":""}" onclick="${fn}">${icon(ic,16)} ${label}</button>`;
const close = "msgSheet(false);";
sh.innerHTML = `<div class="mshandle"></div><div class="msprev">${esc(prev)}${m.content.length>40?"…":""}</div>`
+ (canPin ? item(close+`pinChatMsg(${jq(idx)})`, "pin", "Pin 为长期记忆") : "")
+ (isAI ? item(close+`rateMsg(${jq(idx)},1)`, "thumb-up", m.rating===1?"已赞同":"赞同")
+ item(close+`rateMsg(${jq(idx)},-1)`, "thumb-down", m.rating===-1?"已反对":"反对") : "")
+ (rewritable ? item(close+`rewriteMsg(${jq(idx)})`, "repeat", "改写") : "")
+ item(close+`editMsg(${jq(idx)})`, "edit", "编辑")
+ item(close+`copyMsg(${jq(idx)})`, "copy", "复制")
+ (isAI ? item(close+`ttsMsg(${jq(idx)})`, "volume", "TTS 朗读") : "")
+ item(close+`delMsgAsk(${jq(idx)})`, "trash", "删除", true)
+ item(close+`rewindMsg(${jq(idx)})`, "history", "回溯到这里");
document.getElementById("msgscrim").classList.add("on");
sh.classList.add("on");
};
window.editMsgSave = async (idx)=>{
/* P2-2: 与在飞流互斥——流式中保存编辑会并发改同一批消息 */
if(STREAMING || document.getElementById("live")){ rpToast("正在生成中，等这条回复完成再编辑"); return; }
const ta = document.getElementById("editbox");
const nv = ta ? ta.value : "";
if(!nv.trim()){ alert("内容不能为空"); return; }
const k = chatHistKey();
let h = null;
try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败"); return; }
const m = h[idx]; if(!m) return;
achvUnlock("edit_1");
if(m.role !== "user"){
// AI 消息: 只改文本, 不触发重生成; 保留 swipe 变体数组/评分
m.content = nv;
saveHist(k, h); renderChat();
return;
}
// 用户消息: 截掉其后所有消息, 弹出本条, 用现有发送管线重生成
const cfg0 = getCfg();
if(!cfg0.key || !cfg0.base || !cfg0.model){ alert("先去「设置」配好 API 地址/Key/模型"); return; }
const um = h[idx];
saveHist(k, h.slice(0, idx));
// 保留原消息的旁白/代发言身份
const keepNarr = CHAT.narrMode, keepSpk = CHAT.asSpeaker;
CHAT.narrMode = (um.mtype === "narr");
CHAT.asSpeaker = um.speaker || null;
try{ await sendChatText(nv); }
finally{ CHAT.narrMode = keepNarr; CHAT.asSpeaker = keepSpk; }
};
/* M4: 长文本折叠开关 */
window.foldToggle = (btn)=>{
const b = btn.closest(".bubble"); if(!b) return;
const collapsed = b.classList.toggle("collapsed");
btn.textContent = collapsed ? "展开全文" : "收起";
};
window.toggleTools = (ev, idx)=>{
/* 沉浸式呼出栏的点按：吞掉，不弹编辑栏 */
if(window.__barsRevealTs && Date.now() - window.__barsRevealTs < 600){
  window.__barsRevealTs = 0;
  return;
}
if(_pressFired){ _pressFired = false; return; }
/* P2: 打字机动画中点气泡 = 立即打断完成 */
if(typeof twFinish!=="undefined" && TW.timer && TW.idx===idx){ twFinish(); return; }
if(ev.target.closest(".msgtools") || ev.target.closest(".swipe")) return;
const msgs = document.querySelectorAll("#chatlog .msg");
const el = msgs[idx];
if(!el) return;
const was = el.classList.contains("show-tools");
msgs.forEach(m=>m.classList.remove("show-tools"));
if(!was) el.classList.add("show-tools");
};
window.switchChat = (v)=>{
/* P0-4: 切会话前先取消在飞的流，否则旧流的 token 会写进新会话（串台）且旧流不可取消 */
abortStreaming();
const [runId, name] = v.split("|");
CHAT = {mode:"single", runId, name, members:[], forcedSpeaker:null};
localStorage.setItem("nd_chat_last", v);
showChat();
};
/* P0-1: 抽屉"切换角色"按钮改事件委托 —— runId/name 经 data-* 属性传递（esc 转义引号），
 * 不再拼进 onclick 字符串；委托绑在 document 上一次，drawer 每次重建 innerHTML 不受影响。 */
if(typeof document!=="undefined" && document.addEventListener){
document.addEventListener("click", (e)=>{
const b = e.target && e.target.closest ? e.target.closest("[data-swrun]") : null;
if(!b || !b.dataset) return;
switchChat(b.dataset.swrun + "|" + b.dataset.swname);
});
}
window.chatWith = (runId, name)=>{
/* P1 开场选择器：多开场卡片且非指定开场进入时，先弹半屏选开场 */
if(window.__pendingOpening == null){
let ops = [];
try{ ops = cardOpenings(runId, name); }catch(e){}
if(ops.length > 1){ openSheet(true, runId, name); return; }
}
startChat(runId, name);
};
function startChat(runId, name){
CHAT = {mode:"single", runId, name, members:[], forcedSpeaker:null};
loadPov();
LAST_STATS = null;
localStorage.setItem("nd_chat_last", `${runId}|${name}`);
setNav("chat");
}
/* ============ P1-6: 轻量本地成就 ============ */
window.achvUnlock = (id)=>{
if(typeof RP_ACHV==="undefined") return;
if(RP_ACHV.unlock(id)) achvToast(id);
};
let ACHV_TOAST_TIMER = null;
let RP_TOAST_TIMER = null;
/* 通用轻提示: 失败/解析失败时 toast 提示, 不中断流程 */
window.rpToast = (msg)=>{
let el = document.getElementById("rpToast");
if(!el){ el = document.createElement("div"); el.id = "rpToast"; el.className = "achv-toast"; document.body.appendChild(el); }
el.textContent = msg;
el.classList.add("show");
if(RP_TOAST_TIMER) clearTimeout(RP_TOAST_TIMER);
RP_TOAST_TIMER = setTimeout(()=>el.classList.remove("show"), 2600);
};
function achvToast(id){
const def = RP_ACHV.DEFS.find(d=>d.id===id); if(!def) return;
let el = document.getElementById("achvToast");
if(!el){ el = document.createElement("div"); el.id = "achvToast"; el.className = "achv-toast"; document.body.appendChild(el); }
el.innerHTML = `${icon("check",14)} 成就解锁: <b>${esc(def.name)}</b><br><span class="dim">${esc(def.desc)}</span>`;
el.classList.add("show");
if(ACHV_TOAST_TIMER) clearTimeout(ACHV_TOAST_TIMER);
ACHV_TOAST_TIMER = setTimeout(()=>el.classList.remove("show"), 2600);
}
/* P2 命名主题切换 */
window.setThemeUI = (id)=>{
try{ if(typeof RP_THEME !== "undefined") RP_THEME.apply(id); }catch(e){}
showSettings();
};
function themeCardsHTML(){
try{
if(typeof RP_THEME === "undefined") return "";
const cur = RP_THEME.get();
return `<div class="themerow" style="margin-top:8px">` + RP_THEME.THEMES.map(t=>`
<div class="themecard${cur===t.id?" on":""}" onclick="setThemeUI('${jq(t.id)}')">
<div class="dots"><span class="dot" style="background:${t.vars["--bg"]}"></span><span class="dot" style="background:${t.vars["--gold"]}"></span><span class="dot" style="background:${t.vars["--ink"]}"></span></div>
<div class="tname">${esc(t.name)}</div><div class="tdesc">${esc(t.desc)}</div></div>`).join("") + `</div>`;
}catch(e){ return ""; }
}
/* ============ 字号缩放（P0-28：--fs 文本倍率） ============
   旧实现是 documentElement.style.zoom，zoom 会把布局视口一起等比缩小
   （360px 视口在 1.3 档下有效宽度仅 277px，底栏"蒸馏"折成两行），
   且 position:fixed / env() 各引擎行为不一致。改为只缩 font-size：
   所有字号写成 calc(Npx * var(--fs))，布局盒子（padding/高度/宽度）不动。*/
const FONT_SCALES = [1, 1.15, 1.3];
function getFontScale(){
  let v = 1;
  try{ v = parseFloat(localStorage.getItem("nd_font_scale")); }catch(e){}
  return FONT_SCALES.indexOf(v) >= 0 ? v : 1;   /* 只认设置页给的档位，脏值回落 1 */
}
function applyFontScale(){ try{ document.documentElement.style.setProperty("--fs", String(getFontScale())); }catch(e){} }
window.setFontScale = (v)=>{
  try{ localStorage.setItem("nd_font_scale", String(v)); }catch(e){}
  applyFontScale(); showSettings();
};
function fontScaleCardsHTML(){
  const fs = getFontScale();
  const opts = [[1,"标准"],[1.15,"大"],[1.3,"特大"]];   /* 与 FONT_SCALES 同档 */
  return `<div class="chiprow" data-xfade style="margin-top:8px">` + opts.map(o=>
    `<button class="pickchip${fs===o[0]?" on":""}" onclick="setFontScale(${jq(o[0])})">${o[1]}</button>`).join("") + `</div>`;
}
/* 选人页快捷条：签到 + 成就（把藏在设置里的游玩入口浮上来） */
function dailyStripHTML(){
  try{
    const hasCk = typeof RP_CHECKIN!=="undefined", hasAc = typeof RP_ACHV!=="undefined";
    if(!hasCk && !hasAc) return "";
    const done = hasCk && RP_CHECKIN.hasToday();
    const st = hasCk ? RP_CHECKIN.streak() : 0;
    const ac = hasAc ? `${RP_ACHV.count()}/${RP_ACHV.DEFS.length}` : "";
    return `<div class="dailystrip">`
      + (hasCk ? `<button class="ds${done?" done":""}" onclick="checkinQuick()">${done?"📅 今日已签到 ✓":"📅 签到"+(st?` · 连${st}天`:"")}</button>` : "")
      + (hasAc ? `<button class="ds" onclick="showAchv('picker')">🏆 成就 ${ac} ›</button>` : "")
      + `</div>`;
  }catch(e){ return ""; }
}
window.checkinQuick = ()=>{
  try{
    const r = RP_CHECKIN.checkin();
    if(r && r.isNew) rpToast(`签到成功，已连续 ${r.streak} 天`);
  }catch(e){}
  showChatPicker();
};
/* P2 每日签到 */
window.CHECKIN_M = 0;
function checkinCardHTML(){
if(typeof RP_CHECKIN === "undefined") return "";
const now = new Date();
const off = window.CHECKIN_M || 0;
const base = new Date(now.getFullYear(), now.getMonth() + off, 1);
const y = base.getFullYear(), m = base.getMonth();
const cells = RP_CHECKIN.monthCells(y, m);
const signed = RP_CHECKIN.signedSet(y, m);
const done = RP_CHECKIN.hasToday();
const st = RP_CHECKIN.streak(), tot = RP_CHECKIN.total();
let cal = `<div class="calhead"><button class="btn ghost sm" onclick="checkinMonth(-1)">‹ 上月</button>`
+ `<b>${y} 年 ${m + 1} 月</b><button class="btn ghost sm" onclick="checkinMonth(1)">下月 ›</button></div>`;
cal += `<div class="calgrid">` + ["一","二","三","四","五","六","日"].map(w=>`<div class="calcell wk">${w}</div>`).join("") + `</div>`;
cal += `<div class="calgrid">` + cells.map(d=>{
if(d == null) return `<div class="calcell pad"></div>`;
const cls = "calcell" + (signed[d] ? " signed" : "") + (off === 0 && d === now.getDate() ? " today" : "");
return `<div class="${cls}">${d}</div>`;
}).join("") + `</div>`;
return `<div class="setcard"><h3>${icon("calendar",15)} 每日签到</h3>`
+ `<div class="kv">连续签到 <b style="color:var(--gold)">${st}</b> 天 · 累计 ${tot} 天${done ? " · 今日已签到" : ""}</div>`
+ `<div class="btnrow" style="margin-top:8px"><button class="btn"${done ? " disabled" : ""} onclick="checkinUI()">${done ? "今日已签到 ✓" : "签到"}</button></div>`
+ cal + `<div class="hint">纯本地纪念，无货币无奖励。</div></div>`;
}
window.checkinUI = ()=>{
let r = null;
try{ r = RP_CHECKIN.checkin(); }catch(e){}
if(r && r.isNew){ try{ rpToast(`签到成功，已连续 ${r.streak} 天`); }catch(e){} }
showSettings();
};
window.checkinMonth = (d)=>{ window.CHECKIN_M = (window.CHECKIN_M || 0) + d; showSettings(); };
window.showAchv = (from)=>{
window._achvFrom = (from==="picker") ? "picker" : "settings";
const backFn = window._achvFrom==="picker" ? "showChatPicker()" : "showSettings()";
__backAction = ()=>{ if(window._achvFrom==="picker") showChatPicker(); else showSettings(); };
titleEl.textContent = "成就"; subEl.textContent = `已解锁 ${RP_ACHV.count()}/${RP_ACHV.DEFS.length}`;
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
view.innerHTML = `<button class="back" onclick="${backFn}">${icon("back")} 返回${window._achvFrom==="picker"?"选人":"设置"}</button>
<div class="hint">本地记录, 无数值无排行, 纯粹纪念。</div>`
+ RP_ACHV.list().map(a=>`<div class="card ${a.unlocked?"":"dimmed"}"><div class="row"><div class="avatar">${icon(a.icon,20)}</div>
<div><div class="name">${esc(a.name)} ${a.unlocked?"":`<span class="badge">未解锁</span>`}</div>
<div class="kv">${esc(a.desc)}${a.unlocked&&a.ts?` · ${new Date(a.ts).toLocaleDateString("zh-CN")}`:""}</div></div></div></div>`).join("")
+ `<div style="height:40px"></div>`;
window.scrollTo(0,0);
};

/* ============ P1-7: 纯前端 PIN 应用锁 ============ */
window.pinUnlockScreen = ()=>{
return new Promise((resolve)=>{
if(typeof RP_PIN==="undefined" || !RP_PIN.has()){ resolve(true); return; }
const ov = document.createElement("div");
ov.id = "pinlock"; ov.className = "pinlock";
let digits = "";
const dots = ()=> [0,1,2,3].map(i=>`<span class="pdot${i<digits.length?" on":""}"></span>`).join("");
const render = ()=>{
ov.innerHTML = `<div class="pin-box">
<div class="pin-title">${icon("check",18)} 应用已锁定</div>
<div class="pin-dots">${dots()}</div>
<div class="pin-pad">${[1,2,3,4,5,6,7,8,9,"",0,"del"].map(k=>
k==="" ? `<span></span>`
: k==="del" ? `<button class="pkey" data-k="del">⌫</button>`
: `<button class="pkey" data-k="${k}">${k}</button>`).join("")}</div>
<div class="pin-msg" id="pinMsg"></div>
<div class="pin-warn">忘记 PIN 只能清除全部数据, 没有找回途径</div>
<button class="pin-wipe" id="pinWipe">清除全部数据</button>
</div>`;
ov.querySelectorAll(".pkey").forEach(b=>b.addEventListener("click", ()=>press(b.getAttribute("data-k"))));
const w = ov.querySelector("#pinWipe"); if(w) w.addEventListener("click", wipe);
};
const msg = (t)=>{ const m = ov.querySelector("#pinMsg"); if(m) m.textContent = t; };
const press = async (k)=>{
if(RP_PIN.lockRemain() > 0) return;
if(k==="del"){ digits = digits.slice(0,-1); render(); return; }
if(digits.length >= 4) return;
digits += k;
if(digits.length < 4){ render(); return; }
render();
const ok = await RP_PIN.verify(digits);
if(ok){ RP_PIN.resetFails(); document.body.classList.remove("pinlocked"); ov.remove(); resolve(true); return; }
const r = RP_PIN.fail();
digits = "";
if(r.locked){ msg("连续错误 5 次, 锁定 1 分钟"); lockCount(); }
else { msg(`PIN 错误, 还剩 ${r.left} 次机会`); render(); }
};
const lockCount = ()=>{
const remain = RP_PIN.lockRemain();
if(remain <= 0){ msg(""); render(); return; }
msg(`已锁定, ${Math.ceil(remain/1000)} 秒后重试`);
setTimeout(lockCount, 1000);
};
const wipe = ()=>{
if(!confirm("确定清除全部数据吗？\n所有聊天记录、记忆、角色卡、存档都会被删除, 不可恢复！")) return;
if(!confirm("最后确认: 真的要清空一切吗？")) return;
try{ localStorage.clear(); }catch(e){}
location.reload();
};
document.body.appendChild(ov);
document.body.classList.add("pinlocked");
render();
if(RP_PIN.lockRemain() > 0) lockCount();
});
};
function renderPinSettings(){
const box = document.getElementById("pinset"); if(!box) return;
if(typeof RP_PIN==="undefined"){ box.innerHTML = `<div class="hint">PIN 模块未加载</div>`; return; }
if(!RP_PIN.has()){
box.innerHTML = `<div class="field"><label>设置 4 位数字 PIN</label>
<div class="pinrow"><input id="pin_new1" type="password" inputmode="numeric" maxlength="4" placeholder="••••">
<input id="pin_new2" type="password" inputmode="numeric" maxlength="4" placeholder="再输一次"></div></div>
<div class="btnrow"><button class="btn" onclick="pinSet()">设置 PIN 锁</button></div>
<div class="hint">忘记 PIN 只能清除全部数据, 没有找回途径。</div>`;
}else{
box.innerHTML = `<div class="kv">应用锁已开启${RP_PIN.lockRemain()>0?" · 当前锁定中":""}</div>
<div class="btnrow" style="margin-top:8px"><button class="btn ghost" onclick="pinChangeUI()">修改 PIN</button>
<button class="btn ghost" onclick="pinRemoveUI()">关闭应用锁</button></div>
<div id="pinchange" style="margin-top:8px"></div>`;
}
}
window.pinSet = async ()=>{
const a = (document.getElementById("pin_new1").value||"").trim();
const b = (document.getElementById("pin_new2").value||"").trim();
if(a !== b){ alert("两次输入不一致"); return; }
try{ await RP_PIN.set(a); alert("应用锁已开启"); renderPinSettings(); }
catch(e){ alert(e.message); }
};
window.pinChangeUI = ()=>{
const box = document.getElementById("pinchange"); if(!box) return;
box.innerHTML = `<div class="field"><label>旧 PIN</label>
<input id="pin_old" type="password" inputmode="numeric" maxlength="4" placeholder="••••" style="width:90px"></div>
<div class="field"><label>新 PIN</label>
<div class="pinrow"><input id="pin_ch1" type="password" inputmode="numeric" maxlength="4" placeholder="••••">
<input id="pin_ch2" type="password" inputmode="numeric" maxlength="4" placeholder="再输一次"></div></div>
<div class="btnrow"><button class="btn" onclick="pinChangeDo()">确认修改</button></div>`;
};
window.pinChangeDo = async ()=>{
const old = (document.getElementById("pin_old").value||"").trim();
const a = (document.getElementById("pin_ch1").value||"").trim();
const b = (document.getElementById("pin_ch2").value||"").trim();
if(!(await RP_PIN.verify(old))){ alert("旧 PIN 不正确"); return; }
if(a !== b){ alert("两次输入不一致"); return; }
try{ await RP_PIN.set(a); alert("PIN 已修改"); renderPinSettings(); }
catch(e){ alert(e.message); }
};
window.pinRemoveUI = async ()=>{
const old = prompt("输入当前 PIN 以关闭应用锁:");
if(old === null) return;
if(await RP_PIN.verify(old)){ RP_PIN.clear(); alert("应用锁已关闭"); renderPinSettings(); }
else alert("PIN 不正确");
};

/* ============ P1-4: 聊天记录搜索(单聊/群聊/穿越通用, 大小写不敏感, 关键词高亮, n/总数, 上下跳转) ============ */
let SEARCH = {active:false, q:"", hits:[], cur:-1};
window.toggleChatSearch = (force)=>{
SEARCH.active = force!=null ? !!force : !SEARCH.active;
if(!SEARCH.active){ SEARCH.q=""; SEARCH.hits=[]; SEARCH.cur=-1; }
renderChatSearch();
if(SEARCH.active){ const i = document.getElementById("cs_input"); if(i) i.focus(); }
else renderChat();
};
function searchHits(){
const h = getHistSafe(chatHistKey());
const q = SEARCH.q.trim().toLowerCase();
SEARCH.hits = [];
if(!q) return;
for(let i=0;i<h.length;i++){
const m = h[i];
const txt = ((m.speaker?m.speaker+"：":"") + String(m.content||"")).toLowerCase();
if(txt.indexOf(q)>=0) SEARCH.hits.push(i);
}
}
function hlSearchRaw(text){ // 先在原文里插占位符, md() 之后再还原成 <mark>(避免破坏 HTML 标签)
if(!SEARCH.active || !SEARCH.q.trim()) return text;
try{
const q = SEARCH.q.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
return String(text).replace(new RegExp(q,"gi"), m=>"\u0001"+m+"\u0002");
}catch(e){ return text; }
}
function hlRestore(html){
if(!SEARCH.active || !SEARCH.q.trim()) return html;
return String(html).split("\u0001").join("<mark>").split("\u0002").join("</mark>");
}
window.chatSearchInput = (v)=>{
SEARCH.q = v;
searchHits();
SEARCH.cur = SEARCH.hits.length ? 0 : -1;
renderChat();
updateSearchBar();
if(SEARCH.cur>=0) scrollToHit();
};
window.chatSearchGo = (dir)=>{
if(!SEARCH.hits.length) return;
SEARCH.cur = (SEARCH.cur + dir + SEARCH.hits.length) % SEARCH.hits.length;
renderChat();
updateSearchBar();
scrollToHit();
};
function scrollToHit(){
const idx = SEARCH.hits[SEARCH.cur];
if(idx==null) return;
const el = document.getElementById("smsg-"+idx);
if(el && el.scrollIntoView){ markProgScroll(); el.scrollIntoView({block:"center"}); }
}
function updateSearchBar(){
const n = document.getElementById("cs_num");
if(n) n.textContent = (SEARCH.cur>=0?SEARCH.cur+1:0) + "/" + SEARCH.hits.length;
}
function renderChatSearch(){
const bar = document.getElementById("chatsearch");
if(!bar) return;
if(!SEARCH.active){ bar.innerHTML = ""; return; }
if(bar.innerHTML.indexOf("cs_input")>=0) return; // 输入中不重建, 保住焦点
bar.innerHTML = `<div class="csbar">`
+ `<input id="cs_input" placeholder="搜索聊天记录" value="${esc(SEARCH.q)}" oninput="chatSearchInput(this.value)">`
+ `<span class="cs-num" id="cs_num">0/0</span>`
+ `<button onclick="chatSearchGo(-1)" title="上一个">‹</button>`
+ `<button onclick="chatSearchGo(1)" title="下一个">›</button>`
+ `<button onclick="toggleChatSearch(false)" title="关闭">${icon("x",14)}</button></div>`;
}
/* ============ P2: 打字机效果（AI 回复逐字呈现，可打断） ============ */
let TW = {timer:null, key:"", idx:-1, mid:""};
function twStop(){ if(TW.timer){ clearInterval(TW.timer); TW.timer = null; } }
/* 立即打断完成：停掉定时器并整页重渲染出全文 */
window.twFinish = ()=>{ if(!TW.timer) return; twStop(); renderChat(); };
function twStart(idx, bodyText, cardHTML, mid){
const log = $("#chatlog"); if(!log) return;
const frames = (typeof RP_TYPEWRITER!=="undefined") ? RP_TYPEWRITER.progressFrames(bodyText) : [bodyText];
let fi = 0;
TW.idx = idx;
TW.mid = mid || "";
/* 首帧立即置空+光标，避免 45ms 后才改造成的全文闪烁 */
const el0 = document.getElementById("smsg-"+idx);
if(el0){ const b0 = el0.querySelector(".bubble"); if(b0) b0.innerHTML = `<span class="twcur"></span>`; }
TW.timer = setInterval(()=>{
fi++;
const done = fi >= frames.length;
const el = document.getElementById("smsg-"+idx);
/* P2-3: idx 漂移（播放中插入/删除消息）——元素没了，或该位置已被别的消息顶替：
   停掉定时器并整页重渲染，从历史补出剩余全文，不许永久停在半截/光标帧 */
if(!el || (TW.mid && el.dataset && el.dataset.mid !== TW.mid)){ twStop(); renderChat(); return; }
const bub = el.querySelector(".bubble");
if(bub){
const partial = frames[Math.min(fi, frames.length-1)];
bub.innerHTML = hlRestore(md(hlSearchRaw(partial))) + (done?cardHTML:`<span class="twcur"></span>`);
}
if(chatNearBottom()){ markProgScroll(); log.scrollTop = log.scrollHeight; }
if(done){ twStop(); renderChat(); /* M4: 播完重渲染，长消息挂上折叠结构 */ }
}, 45);
}
function renderChat(forceBottom){
twStop(); /* 新渲染进来（发消息/切tab/新回复）先停掉旧动画 */
const h = getHistSafe(chatHistKey());
const log = $("#chatlog");
if(!log) return;
/* 用户上滑看历史时不强制回底(防抖动); 发出新消息等场景由调用方传 true */
const stick = !!forceBottom || chatNearBottom();
renderChatSearch();
if(SEARCH.active && SEARCH.q.trim()){ // 新消息进来时重算命中
searchHits();
if(SEARCH.cur>=SEARCH.hits.length) SEARCH.cur = SEARCH.hits.length-1;
updateSearchBar();
}
let lastAI = -1;
h.forEach((m, i)=>{
if(m.role==="assistant" && m.content.indexOf("⚠️")!==0
&& m.content.indexOf("【OOC")!==0 && m.content.indexOf("（已停止")!==0) lastAI = i;
});
log.innerHTML = h.map((m, idx)=>{
const mtype = m.mtype || (m.role==="user" ? "player" : "char");
const who = m.role==="user"
? (mtype==="narr" ? icon("scroll")+" 旁白" : (mtype==="npc" ? (m.speaker||"我") : travPlayerName()))
: (CHAT.mode==="group"?(m.speaker||"?"):(CHAT.mode==="traverse"?"世界":CHAT.name));
const showWho = CHAT.mode==="group"; /* S6: 姓名行只在群聊保留（说话人辨识），单聊/穿越靠顶栏 */
let extra = "";
const rateBtns = m.role==="assistant"
? `<button class="${m.rating===1?"on":""}" onclick="event.stopPropagation();rateMsg(${jq(idx)},1)">${icon("thumb-up",15)}</button>`
+ `<button class="${m.rating===-1?"on":""}" onclick="event.stopPropagation();rateMsg(${jq(idx)},-1)">${icon("thumb-down",15)}</button>` : "";
/* S-4 召回指示器：本条 AI 回复注入了记忆/世界书时，气泡工具条出现 🧠 角标 */
const memBtn = (m.role==="assistant" && ((m.memHits&&m.memHits.length)||(m.loreHits&&m.loreHits.length)))
? `<button onclick="event.stopPropagation();toggleMemHits(${jq(idx)})" title="这次想起了什么" aria-label="这次想起了什么">${icon("brain",15)}</button>` : "";
/* 🧠 命中透明度：第一次出现时解释一次含义 */
if(memBtn){ try{
  if(!localStorage.getItem("nd_memhit_tip")){
    localStorage.setItem("nd_memhit_tip", "1");
    setTimeout(()=>{ try{ rpToast("🧠 表示这条回复参考了记忆 / 世界书，点它查看明细"); }catch(e){} }, 1200);
  }
}catch(e){} }
if(m.role==="assistant" && idx===lastAI){
if(m.candidates && m.candidates.length>1){
extra += `<div class="swipe" onclick="event.stopPropagation()"><button onclick="swipeMsg(${jq(idx)},-1)">‹</button>`
+ `<span>${(m.ci||0)+1}/${m.candidates.length}</span>`
+ `<button onclick="swipeMsg(${jq(idx)},1)">›</button></div>`;
}
extra += `<div class="msgtools">` + rateBtns + memBtn
+ voiceBubbleHTML(idx, m)
+ (repickInfo() ? `<button onclick="event.stopPropagation();repickOption()" title="回到上一个决策点重新选择">↩ 重选</button>` : "")
+ `<button onclick="event.stopPropagation();editMsg(${jq(idx)})">编辑</button>`
+ `<button onclick="event.stopPropagation();copyMsg(${jq(idx)})">复制</button>`
+ `<button onclick="event.stopPropagation();regenMsg()">↻ 重生</button>`
+ `<button onclick="event.stopPropagation();delMsg(${jq(idx)})">删除</button></div>`;
} else {
extra = `<div class="msgtools">` + rateBtns + memBtn
+ (m.role==="assistant"?voiceBubbleHTML(idx,m):"")
+ `<button onclick="event.stopPropagation();editMsg(${jq(idx)})">编辑</button>`
+ `<button onclick="event.stopPropagation();copyMsg(${jq(idx)})">复制</button>`
+ `<button onclick="event.stopPropagation();delMsg(${jq(idx)})">删除</button></div>`;
}
let body = m.content, cardHTML = "";
if(m.role==="assistant"){
const oc = parseOptCard(m.content);
if(oc){ body = m.content.replace(oc.full, "").trim(); cardHTML = optCardHTML(oc, idx===lastAI, idx); }
}
const isHit = SEARCH.active && SEARCH.hits.indexOf(idx)>=0;
const isCur = isHit && SEARCH.hits[SEARCH.cur]===idx;
const rendered = hlRestore(md(hlSearchRaw(body))) + cardHTML;
/* M4: 长文本折叠（Talkie FoldTextView，阈值 600 字） */
const needFold = body.length > 600;
const bubbleInner = needFold
? `<div class="foldbody">${rendered}</div><button class="foldtoggle" onclick="event.stopPropagation();foldToggle(this)">展开全文</button>`
: rendered;
/* Soul 冲突徽章 */
const conflictBadge = (m._conflicts && m._conflicts.length && !m._conflictResolved && typeof RP_SOUL_CFG !== "undefined")
? RP_SOUL_CFG.conflictBadgeHTML(m._conflicts, idx) : "";
return `<div class="msg ${m.role==="user"?"me":""}${mtype==="narr"?" narr":""}${mtype==="npc"?" npc":""}${isCur?" curhit":""}" id="smsg-${idx}" data-mid="${esc(m.mid||m.id||"")}" onclick="toggleTools(event,${jq(idx)})" oncontextmenu="event.preventDefault();msgMenu(${jq(idx)});return false;" ontouchstart="msgPressStart(event,${jq(idx)})" ontouchend="msgPressEnd()" ontouchmove="msgPressEnd()">`
+ `<div class="msgcol">${showWho?`<div class="who">${esc(who)}</div>`:""}<div class="bubble${needFold?" foldable collapsed":""}">${bubbleInner}${conflictBadge}</div>${extra}</div>`
+ `</div>`;
}).join("") || `<div class="empty">还没有对话，打个招呼吧<br><span style="font-size:calc(12px * var(--fs))">试试：你是谁？</span></div>`;
renderCtxBar();
if(stick){ markProgScroll(); log.scrollTop = log.scrollHeight; }
renderWsBar();
renderSimBar();
/* P2 打字机：只对"最新一条 AI 消息"做逐字动画；重渲染旧消息不重复播 */
try{
if(lastAI>=0){
const key = chatHistKey()+"|"+h.length+"|"+(h[lastAI].ts||h[lastAI].content.length);
if(lastAI===h.length-1 && TW.key!==key && typeof RP_TYPEWRITER!=="undefined" && RP_TYPEWRITER.shouldAnimate()){
TW.key = key;
const m = h[lastAI];
const oc0 = parseOptCard(m.content);
const body0 = oc0 ? m.content.replace(oc0.full,"").trim() : m.content;
twStart(lastAI, body0, oc0 ? optCardHTML(oc0, true, lastAI) : "", h[lastAI].mid || h[lastAI].id || "");
}else{
TW.key = key;
}
}
}catch(e){}
}
/* S-4 召回指示器 (对标 Kindroid 紫色脑图标): 点 🧠 展开"这次想起了什么" */
window.toggleMemHits = (idx)=>{
const h = getHistSafe(chatHistKey()); const m = h[idx]; if(!m) return;
const box = document.getElementById("smsg-"+idx); if(!box) return;
const old = box.querySelector(".mmhits");
if(old){ old.remove(); return; }
const rows = [];
(m.memHits||[]).forEach(x=>rows.push(`<div>🧠 ${esc(x.label)}${x.items?` <span class="dim">×${x.items}</span>`:""} <span class="dim">· 记忆</span></div>`));
(m.loreHits||[]).forEach(t=>rows.push(`<div>📖 ${esc(t)} <span class="dim">· 世界书</span></div>`));
if(!rows.length) return;
const p = document.createElement("div"); p.className = "mmhits";
p.innerHTML = `<div class="mmhits-ttl">这次想起了</div>` + rows.join("");
box.querySelector(".msgcol").appendChild(p);
};
/* ============ 上下文用量常驻条 + 世界书触发可视化 (对标 Talkie/Janitor) ============ */
function renderCtxBar(){
const bar = document.getElementById("ctxbar");
if(!bar) return;
if(!LAST_STATS){ bar.style.display = "none"; return; }
const s = LAST_STATS;
const used = (s.sysTokens||0) + (s.histTokens||0);
const max = s.maxCtx || 8192;
const pct = Math.min(100, Math.round(used / max * 100));
const hits = (s.loreHits||[]).filter(Boolean);
/* 世界书触发标签: 有 hitDetails 时展示 probability/priority (Janitor 式), 否则退化为标题 */
const hitDet = (s.loreHitDetails||[]).filter(Boolean);
bar.style.display = "block";
bar.innerHTML = `<div class="ctxrow"><div class="ctxbar-bg"><div class="ctxbar-fg${pct>85?" hot":""}" style="width:${pct}%"></div></div>`
+ `<span class="ctxnum">上下文 ${used}/${max} · 历史${s.histKept||0}条</span>`
+ (hits.length ? `<span class="ctxfold" onclick="toggleCtxLore(event)">触发${hits.length}条 ▾</span>` : "")
+ `</div>`
+ (hits.length ? `<div class="ctxlore" id="ctxlore">${icon("book-open",14)} 触发：${hitDet.length
? hitDet.map(d=>`${esc(d.title)}<span style="opacity:.6;font-size:calc(11px * var(--fs))"> ${d.probability}%·P${d.priority}</span>`).join("、")
: hits.map(x=>esc(x)).join("、")}</div>` : "")
/* Tier2 #6: C.AI "Older messages will fade from Memory, but anything you save to Story Memory is kept safe." */
+ (pct > 90 ? `<div class="ctxwarn">旧消息会逐渐从记忆中褪色，但你置顶 / 存入事件簿的记忆会一直保留。</div>` : "");
/* 触发明细 5 秒后自动收起，点击徽标可展开/收起 */
if(hits.length){
  if(window.__ctxLoreTimer) clearTimeout(window.__ctxLoreTimer);
  window.__ctxLoreTimer = setTimeout(()=>{
    const l = document.getElementById("ctxlore");
    if(l && !l.classList.contains("folded")){
      l.classList.add("folded");
      const f = bar.querySelector(".ctxfold");
      if(f) f.textContent = `触发${hits.length}条 ▸`;
    }
  }, 5000);
}
}
window.toggleCtxLore = (ev)=>{
  if(ev && ev.stopPropagation) ev.stopPropagation();
  const l = document.getElementById("ctxlore");
  if(!l) return;
  l.classList.toggle("folded");
  const f = document.querySelector("#ctxbar .ctxfold");
  if(f){
    const n = (LAST_STATS && (LAST_STATS.loreHits||[]).filter(Boolean).length) || 0;
    f.textContent = l.classList.contains("folded") ? `触发${n}条 ▸` : `触发${n}条 ▾`;
  }
};
/* ============ 世界模拟 HUD：聊天页顶栏下常驻时间/天气/地点 ============ */
function simChatKey(){
  try{ return chatHistKey(); }catch(e){ return "misc"; }
}
/* 时序感知基准卡: 蒸馏 run 从 __DATA__.rp_cards[runId] 找; 找不到时 (imported/custom 等
   非蒸馏 runId, rp_cards 里根本没有这个键) 回落导入卡库 —— 否则导入卡的 tc 恒为 null,
   RP_TEMPORAL.defaultChapter 只能吃卡.fields.timeline_stage, 拿不到卡就永远走默认回目。 */
function temporalCardFor(runId, name){
  let tc = null;
  try{
    const rcards = ((window.__DATA__||{}).rp_cards||{})[runId]||[];
    tc = rcards.find(c=>c.name===(name||"")) || null;
  }catch(e){ tc = null; }
  if(!tc && typeof RP_CARDIMPORT!=="undefined"){
    try{ tc = RP_CARDIMPORT.find(name||"") || null; }catch(e){}
  }
  return tc;
}
function simHint(){
  var novel = "";
  try{ novel = (((window.__DATA__||{}).runs||{})[CHAT.runId]||{}).novel || ""; }catch(e){}
  if(CHAT.mode==="traverse"){
    try{ var t = (typeof RP_TRAVERSE!=="undefined") ? RP_TRAVERSE.get(CHAT.travId) : null;
      if(t && t.worldName) novel = t.worldName; }catch(e){}
  }
  return {novel: novel, worldName: novel};
}
function renderSimBar(){
  if(CHAT.mode==="traverse") return; /* 穿越用 wsbar 显示 */
  const head = document.getElementById("chathead");
  let bar = document.getElementById("simbar");
  if(typeof RP_WORLDSIM==="undefined" || !head) { if(bar) bar.style.display="none"; return; }
  if(!RP_WORLDSIM.enabled()){ if(bar) bar.style.display="none"; return; }
  if(!bar){
    bar = document.createElement("div");
    bar.id = "simbar"; bar.className = "simbar";
    bar.title = "世界模拟：点我调整时间/天气/地点";
    bar.addEventListener("click", ()=>simEditor());
    head.parentNode.insertBefore(bar, head.nextSibling);
  }
  bar.style.display = "flex";
  /* 导演标识：只显示风格，不剧透具体指令 */
  var dirChip = "";
  try{ if(typeof RP_DIRECTOR!=="undefined") dirChip = RP_DIRECTOR.briefHTML(simChatKey()); }catch(e){}
  /* 方向二：画像动态检索命中可见（点开展示本轮命中字段） */
  var portChip = "";
  try{
    const _lp = window.__lastPortrait;
    if(_lp && _lp.hits && _lp.hits.length && typeof RP_PORTRAIT!=="undefined")
      portChip = `<span class="simchip" onclick="event.stopPropagation();portraitDebug()" title="本轮画像动态检索命中字段">🎭 画像·${_lp.hits.length}</span>`;
  }catch(e){}
  bar.innerHTML = RP_WORLDSIM.briefHTML(simChatKey(), simHint()) + dirChip + portChip + `<span class="simgo">›</span>`;
}
/* 画像命中调试弹窗（renderSimBar 的 simchip 入口） */
window.portraitDebug = ()=>{
  const bar = document.getElementById("simbar"); if(!bar || typeof RP_PORTRAIT==="undefined") return;
  const old = document.getElementById("portraitdbg"); if(old){ old.remove(); return; }
  const lp = window.__lastPortrait || {hits:[], banned:[]};
  const d = document.createElement("div");
  d.id = "portraitdbg"; d.className = "pdebug-pop";
  d.innerHTML = `<div class="pdebug-head">本轮画像命中（点击关闭）</div>` + RP_PORTRAIT.renderDebug(lp.hits, lp.banned);
  d.addEventListener("click", ()=>d.remove());
  bar.parentNode.insertBefore(d, bar.nextSibling);
};
/* ============ 世界模拟编辑器（手动调整时间/天气/地点） ============ */
window.simEditor = ()=>{
  if(typeof RP_WORLDSIM==="undefined"){ alert("世界模拟模块未加载"); return; }
  const key = simChatKey(), hint = simHint();
  const st = RP_WORLDSIM.ensure(key, hint);
  __backAction = ()=>showChat();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("clock") + " 世界模拟"; subEl.textContent = "";
  const p = RP_WORLDSIM.curPlace(st);
  const wxOpts = RP_WORLDSIM.WEATHER.map(w=>
    `<option value="${w.id}" ${st.wx===w.id?"selected":""}>${w.name}</option>`).join("");
  const placeRows = st.places.map(pl=>
    `<div class="kvline">${pl.id===st.cur?"★ ":""}${esc(pl.name)}${pl.mood?" · "+esc(pl.mood):""}`+
    (pl.id!==st.cur?` <button class="btn ghost sm" onclick="wsMoveTo('${jq(pl.name)}')">前往（+${st.travelMin||30}分钟）</button>`:"")+
    `</div>`).join("") || `<div class="meta">暂无地点</div>`;
  /* 时序感知：故事进度 S（回目） */
  let storyCh = 25, storyManual = false;
  try{
    if(typeof RP_TEMPORAL !== "undefined"){
      const tc = temporalCardFor(CHAT.runId, CHAT.name);
      const gs = RP_TEMPORAL.getS(key, tc);
      storyCh = gs.chapter; storyManual = gs.manual;
    }
  }catch(e){}
  const chOpts = Array.from({length:120},(_,i)=>`<option value="${i+1}" ${i+1===storyCh?"selected":""}>第${i+1}回</option>`).join("");
  view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回</button>
  <div class="card"><h3>${icon("clock",15)} 时间</h3>
    <div class="kv" style="font-size:calc(17px * var(--fs));margin-bottom:8px">${esc(RP_WORLDSIM.fmtTime(st))}</div>
    <div class="btnrow">
      <button class="btn ghost" style="white-space:nowrap" onclick="wsAdjustTime(30)">+30分钟</button>
      <button class="btn ghost" style="white-space:nowrap" onclick="wsAdjustTime(120)">+2小时</button>
      <button class="btn ghost" style="white-space:nowrap" onclick="wsAdjustTime(1440)">+1天</button>
      <button class="btn ghost" style="white-space:nowrap" onclick="wsAdjustTime(-60)">-1小时</button>
    </div></div>
  <div class="card"><h3>${icon("ws_cloud",15)} 天气</h3>
    <div class="field"><label>当前：${esc(RP_WORLDSIM.weatherName(st.wx))}（${esc(RP_WORLDSIM.seasonName(st.m))}季）</label>
    <div class="modelrow"><select id="ws_wxsel">${wxOpts}</select>
    <button class="btn" onclick="wsSetWeather()">设为此天气</button></div></div></div>
  <div class="card"><h3>${icon("pin",15)} 地点 · 当前：${esc(p.name)}</h3>
    ${placeRows}
    <div class="field" style="margin-top:8px"><label>新增地点</label>
    <div class="modelrow"><input id="ws_newplace" placeholder="地点名，如：潇湘馆">
    <button class="btn ghost" onclick="wsAddPlace()">添加</button></div></div>
    <div class="hint">前往地点消耗 ${st.travelMin||30} 分钟（联动时间）。AI 也可在回复中用 ⟦地点=xxx⟧ 自行移动。</div></div>
  <div class="card"><h3>📖 故事进度</h3>
    <div class="kv" style="font-size:calc(15px * var(--fs));margin-bottom:8px">当前：第${storyCh}回${storyManual?"（手动设定）":"（按角色阶段默认·近似）"}</div>
    <div class="modelrow"><select id="ws_chsel">${chOpts}</select>
    <button class="btn" onclick="wsSetChapter()">设为此回</button></div>
    <div class="hint">时序感知只取此回之前的事件注入【往事】；之后的事角色一概不知，防"提前知道剧本"式穿帮。</div></div>`;
};
window.wsSetChapter = ()=>{
  const v = parseInt(document.getElementById("ws_chsel").value, 10);
  if(typeof RP_TEMPORAL!=="undefined") RP_TEMPORAL.setS(simChatKey(), v);
  simEditor();
};
window.wsAdjustTime = (min)=>{
  RP_WORLDSIM.adjustTime(simChatKey(), min, simHint()); simEditor();
};
window.wsSetWeather = ()=>{
  const v = parseInt(document.getElementById("ws_wxsel").value, 10);
  RP_WORLDSIM.setWeather(simChatKey(), v, simHint()); simEditor();
};
window.wsMoveTo = (name)=>{
  RP_WORLDSIM.moveTo(simChatKey(), name, "", simHint()); simEditor();
};
window.wsAddPlace = ()=>{
  const el = document.getElementById("ws_newplace");
  const name = (el.value||"").trim(); if(!name) return;
  RP_WORLDSIM.addPlace(simChatKey(), name, "", "", simHint()); simEditor();
};
/* ============ 单条消息评分 (对标 Talkie RatingFeedback, 本地存档) ============ */
window.rateMsg = (idx, v)=>{
const k = chatHistKey();
let h = null;
try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败"); return; }
const m = h[idx]; if(!m) return;
m.rating = (m.rating===v) ? 0 : v;
saveHist(k, h); renderChat();
/* 点踩最新一条 AI 回复: 自动重生一条(旧版保留为 swipe 候选, 可左右切换对比)。
   穿越模式没有重生管线, 仅记录评分; 生成中不重复触发。 */
if(m.rating===-1 && m.role==="assistant"
&& (CHAT.mode==="single" || CHAT.mode==="group")
&& !document.querySelector(".chatbar .stopbtn")){
let lastAI = -1;
h.forEach((mm, i)=>{
const c = mm.content || "";
if(mm.role==="assistant" && c.indexOf("⚠️")!==0 && c.indexOf("【OOC")!==0 && c.indexOf("（已停止")!==0) lastAI = i;
});
if(idx===lastAI) regenMsg();
}
};
/* ============ 沉浸式剧情选项卡 (Ny 式 <small> N 选项, 原生实现; v21 支持 2-6 个) ============ */
function parseOptCard(text){
  var m = String(text||"").match(/<small>([\s\S]*?)<\/small>/i);
  if(!m) return null;
  var body = m[1];
  var parts = body.split(/[1-6]\uFE0F\u20E3/);
  if(parts.length < 3) return null;
  var tips = "";
  var tm = body.match(/tips:\s*"([\s\S]*?)"/i);
  if(tm) tips = tm[1].trim();
  var opts = parts.slice(1).map(function(x){
    return x.replace(/tips:\s*"[\s\S]*?"/i,"").trim();
  }).filter(function(x){ return !!x; });
  if(opts.length < 2) return null;
  return {intro: parts[0].trim(), options: opts, tips: tips, full: m[0]};
}
function optCardHTML(card, active, idx){
  var nums = ["壹","贰","叁","肆","伍","陆"];
  var btns = card.options.map(function(o, i){
    return active
      ? `<button class="optbtn" onclick="event.stopPropagation();pickOption(${idx},${i})"><span class="onum">${nums[i]||""}</span><span>${esc(o)}</span></button>`
      : `<div class="optbtn off"><span class="onum">${nums[i]||""}</span><span>${esc(o)}</span></div>`;
  }).join("");
  return `<div class="optcard">`
    + (card.intro ? `<div class="optintro">${esc(card.intro)}</div>` : "")
    + btns
    + (card.tips ? `<div class="opttips">\uD83D\uDCA1 ${esc(card.tips)}</div>` : "")
    + `</div>`;
}
/* ============ 剧情线 ============ */
const plotKey = ()=> CHAT.mode==="group"
  ? `nd_plot_${CHAT.runId}_g_${(CHAT.members||[]).slice().sort().join("_")}`
  : `nd_plot_${CHAT.runId}_${CHAT.name}`;
const getPlot = ()=>{ try{ return JSON.parse(localStorage.getItem(plotKey()))||null; }catch(e){ return null; } };
const savePlot = (p)=> localStorage.setItem(plotKey(), JSON.stringify(p||{}));
/* 剧情线 v27: 原著剧情大纲(读者可编辑)。数据源自蒸馏管线(www/data/char_plots.js)。
   char_plots.js 按 runId 分层: CHAR_PLOTS[runId][角色名]。分层是必须的 —— 不同书里
   同名角色只按名字取会泄露别的书的剧情。旧版本 char_plots.js 是扁平的
   CHAR_PLOTS[角色名], 这里保留兜底以兼容旧数据。
   用户保存过则以用户版为准(含清空); 群聊拼接各成员大纲。 */
const bundledPlotFor = (runId, name)=>{
  const all = window.CHAR_PLOTS || {};
  const layer = all[runId];
  if(layer && layer[name]) return layer[name];
  return all[name] || "";
};
const bundledPlot = ()=>{
  const names = CHAT.mode==="group" ? (CHAT.members||[]) : [CHAT.name];
  const parts = [];
  for(const n of names||[]){ const o = bundledPlotFor(CHAT.runId, n); if(o) parts.push(o); }
  return parts.join("\n\n");
};
const activePlotOutline = ()=>{
  const p = getPlot();
  if(p && p.updatedAt) return p.outline || "";
  return bundledPlot();
};
let pickLock = false;
window.pickOption = async (idx, oi)=>{
  if(pickLock) return;
  const h = getHistSafe(chatHistKey());
  const m = h[idx]; if(!m || m.role!=="assistant") return;
  const oc = parseOptCard(m.content); if(!oc || !oc.options[oi]) return;
  pickLock = true;
  try{ await sendChatText(oc.options[oi]); }finally{ pickLock = false; }
};
/* 后悔药：仅当"决策→你的选择→AI回复"恰好是最后三条消息时可回退 */
function repickInfo(){
  try{
    if(!CHAT || !CHAT.travId || typeof RP_PLOTRUN==="undefined") return null;
    const h = getHistSafe(chatHistKey());
    if(h.length < 3) return null;
    const aiReply = h[h.length-1], userPick = h[h.length-2], decMsg = h[h.length-3];
    if(!aiReply || aiReply.role!=="assistant") return null;
    if(!userPick || userPick.role!=="user") return null;
    if(!decMsg || decMsg.role!=="assistant") return null;
    const oc = parseOptCard(decMsg.content); if(!oc) return null;
    const t = String(userPick.content||"").trim();
    if(!oc.options.some(o=>String(o).trim()===t)) return null;
    return { decIdx: h.length-3 };
  }catch(e){ return null; }
}
window.repickOption = ()=>{
  const info = repickInfo();
  if(!info){ rpToast("之后已有新的对话，无法回退到决策点"); return; }
  if(!confirm("回到决策点重新选择？你的选择和 AI 的回复会被删除，剧情回退一步。")) return;
  const k = chatHistKey();
  let h = null;
  try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败"); return; }
  h.splice(h.length-2, 2); /* 删掉"你的选择 + AI回复" */
  saveHist(k, h);
  try{
    const ts = (typeof RP_TRAVERSE!=="undefined") ? RP_TRAVERSE.get(CHAT.travId) : null;
    if(ts && ts.plotrunId && typeof RP_PLOTRUN!=="undefined"){
      const st = RP_PLOTRUN.load(ts.plotrunId);
      if(st) RP_PLOTRUN.revertLast(st);
    }
  }catch(e){}
  renderChat(true);
  rpToast("已回到决策点，重新选吧");
};
window.swipeMsg = (idx, dir)=>{
const k = chatKey(CHAT.runId, CHAT.name);
let h = null;
try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败"); return; }
if(RP.swipe(h[idx], dir)){ saveHist(k, h); renderChat(); achvUnlock("swipe_1"); }
};
window.regenMsg = async ()=>{
/* P2-2: 与在飞流互斥——流式中重生会并发改同一批消息 */
if(STREAMING || document.getElementById("live")){ rpToast("正在生成中，等这条回复完成再重生"); return; }
const cfg = getCfg();
const rcfg = getRpCfg();
const k = chatHistKey();
/* P0-3: 历史读失败则拒绝重生（不能拿空历史去覆盖） */
let h = null;
try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败"); return; }
let rname = CHAT.name;
if(CHAT.mode==="group"){
for(let i=h.length-1;i>=0;i--){ if(h[i].role==="assistant"&&h[i].speaker){ rname = h[i].speaker; break; } }
STREAM_SPEAKER = rname;
}
setStreaming(true);
/* P0-4: 本轮独立 signal + 登记在飞代数/会话键 */
const __rsig = streamSignal();
__liveGen = __rsig.__gen; __liveKey = k;
try{
const r = await RP.regenerate(CHAT.runId, rname, {
cfg: cfg, history: h, temperature: rcfg.temperature,
optCards: !!rcfg.optCards, optCount: rcfg.optCount, optMood: rcfg.optMood,
plotOutline: activePlotOutline(), scenario: scenarioInstr(),
pov: CHAT.pov || "player", person: CHAT.person || "second",
budget: {maxContext: rcfg.maxContext, response: rcfg.respTokens, preset: rcfg.preset, stPreset: resolveStPreset()},
onToken: streamToken,
signal: __rsig,
onSystem: (preview, stats)=>{ LAST_SYSTEM = preview + "\n\n【预算】" + JSON.stringify(stats); LAST_STATS = stats; recordLastPrompt(stats); },
});
saveHist(k, r.history);
achvUnlock("swipe_1");
}catch(e){
/* P0-3: 失败只提示，不拿空历史覆盖 */
rpToast("重新生成失败：" + (e && e.message ? e.message : e));
}finally{
STREAM_SPEAKER = null;
setStreaming(false);
renderChat();
}
};;
/* P0-4: 每轮发送独立 AbortController + 代数。旧的单全局 aborter 会被新发送覆盖，
 * 导致上一轮流永远无法取消；代数用于 streamToken 校验"这条 token 属于当前在飞的轮次"。 */
let __genSeq = 0, __curGen = 0;
const __genAborters = {};
/* 当前是否在流式中（任一轮次在飞）。页面重建输入栏时用它决定是否锁定输入。 */
let STREAMING = false;
/* streamToken 校验用：在飞轮次的代数 + 会话键。切会话/新轮次后旧 token 直接丢弃，防串台。 */
let __liveGen = 0, __liveKey = "";
function streamSignal(){
  const id = ++__genSeq; __curGen = id;
  const c = new AbortController();
  __genAborters[id] = c;
  const sig = c.signal; sig.__gen = id;
  return sig;
}
function __abortGen(id){
  const c = __genAborters[id];
  if(c){ try{ c.abort(); }catch(e){} delete __genAborters[id]; }
}
/* 停止当前在飞的轮次（停止按钮 / 切页 / 切会话时调用） */
function abortStreaming(){ __abortGen(__curGen); }
/* M6: 改写（猫箱 rewrite）：AI 润色本条回复、原意不变，原回复进候选可 swipe 切回 */
/* P2-2: 改写自身的重入锁（与 STREAMING 一起构成互斥） */
let REWRITING = false;
window.rewriteMsg = async (idx)=>{
/* P2-2: 与在飞流互斥——流式中改写同一条消息会并发覆盖；改写自身也不允许重入 */
if(STREAMING || REWRITING || document.getElementById("live")){ rpToast("正在生成中，等这条回复完成再改写"); return; }
REWRITING = true;
try{
const k = chatHistKey();
let h = null;
try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败"); return; }
const m = h[idx];
if(!m || m.role!=="assistant" || m.content.indexOf("⚠️")===0) return;
const cfg = getCfg();
if(!cfg.key){ alert("还没配大模型接口"); return; }
const el = document.getElementById("smsg-"+idx);
const bub = el ? el.querySelector(".bubble") : null;
if(bub) bub.innerHTML = `<span style="color:var(--ink-faint);font-size:calc(13px * var(--fs))">改写中…</span>`;
try{
const prompt = "你是角色扮演对话的文字润色助手。把下面这条 AI 回复改写得更生动自然、更有文采，"
+ "但严格保持原意：不增删剧情要点，不改变说话人口吻，不添加原文没有的对话或旁白。"
+ "只输出改写后的正文，不要解释，不要加引号：\n\n" + m.content;
const out = await RP_NET.complete({base:cfg.base, key:cfg.key, model:cfg.model},
[{role:"user", content:prompt}], 0.8);
if(out && out.trim()){
const orig = m.content;
m.content = out.trim();
m.candidates = m.candidates || [orig];
if(m.candidates.indexOf(m.content)<0) m.candidates.push(m.content);
m.ci = m.candidates.length-1;
saveHist(k, h);
}
}catch(e){}
renderChat();
}finally{
REWRITING = false;
}
};
/* 输入栏（含旁白按钮；群聊多发言身份选择） */
function chatbarInner(disabled){
if(disabled) return `<div class="cb-inputrow"><input id="chat_in" disabled placeholder="生成中…"><button class="stopbtn" onclick="stopGen()" title="停止">${icon("stop",16)}</button></div>`;
const ph = CHAT.mode==="group" ? "在群里说点什么…"
: CHAT.mode==="traverse" ? `以${esc(travPlayerName())}的身份行动…`
: `和${esc(CHAT.name||"TA")}说点什么`;
const spk = CHAT.mode==="group"
? `<label class="cb-tool"><span class="cb-ico">🗣️</span><select id="spksel" onchange="setAsSpeaker(this.value)" title="发言身份"><option value="">我</option>`
+ CHAT.members.map(n=>`<option value="${esc(n)}"${CHAT.asSpeaker===n?" selected":""}>${esc(n)}</option>`).join("") + `</select></label>` : "";
/* Tier3-22: 群聊输入区点头像 @ 指定角色（@ 后本轮点名该角色先回） */
const atb = CHAT.mode==="group"
? `<button id="atbtn" class="cb-tool" onclick="toggleAtMenu(event)" title="＠ 指定角色：本轮点名 TA 先回"><span class="cb-ico">＠</span><span class="cb-tx">点名</span></button>` : "";
return `<div class="cb-tools" data-xfade>`
+ `<button id="pushbtn" class="cb-tool${CHAT.pushStory?" on":""}" onclick="togglePushStory(event)" title="推剧情：下一条回复自动推进"><span class="cb-ico">${icon("clapperboard",15)}</span><span class="cb-tx">推剧情</span></button>`
+ `<button id="narrbtn" class="cb-tool${CHAT.narrMode?" on":""}" onclick="toggleNarr()" title="旁白模式：发送场景/动作描写"><span class="cb-ico">${icon("scroll",15)}</span><span class="cb-tx">旁白</span></button>`
+ `${atb}${spk}`
+ `<button class="cb-tool" onclick="RP_AIFILL.fillChat(this)" title="AI 帮我说一句（只填入，不发送）"><span class="cb-ico">${icon("sparkles",15)}</span><span class="cb-tx">帮我说</span></button>`
+ `</div>`
+ `<div class="cb-inputrow"><input id="chat_in" placeholder="${CHAT.narrMode?"写场景/动作/心理描写…":ph}" onkeydown="if(event.key==='Enter')sendChat()">`
+ `<button class="cbsend" onclick="sendChat()" title="发送">发送</button></div>`;
}
window.toggleAtMenu = (ev)=>{
if(ev && ev.stopPropagation) ev.stopPropagation();
let m = document.getElementById("atmenu");
if(m){ m.remove(); return; }
if(CHAT.mode!=="group" || !(CHAT.members||[]).length) return;
m = document.createElement("div"); m.id = "atmenu"; m.className = "atmenu";
m.innerHTML = `<div class="athint">＠ 谁先回？</div>` + CHAT.members.map(n=>{
return `<button onclick="atMention('${jq(n)}')"><div class="avatar sm">${esc(n[0])}</div><span>${esc(n)}</span></button>`;
}).join("");
const bar = document.querySelector(".chatbar");
(bar || document.body).appendChild(m);
};
window.atMention = (name)=>{
const inp = document.getElementById("chat_in");
if(inp){
inp.value = ((inp.value||"").replace(/\s+$/,"") + " @" + name + " ").replace(/^ /,"");
inp.focus();
}
const m = document.getElementById("atmenu"); if(m) m.remove();
};
/* Push Story: 一键推剧情 (Marinara Narrative Director 思路) */
window.togglePushStory = (ev)=>{
  if(ev && ev.stopPropagation) ev.stopPropagation();
  var chatId = (typeof chatKey !== "undefined" && CHAT.runId) ? chatKey(CHAT.runId, CHAT.name) : "";
  // 已武装则解除
  if(typeof AGENT_PUSHSTORY !== "undefined" && AGENT_PUSHSTORY.isArmed(chatId)){
    AGENT_PUSHSTORY.disarm(chatId);
    var b0 = document.getElementById("pushbtn"); if(b0) b0.classList.remove("on");
    return;
  }
  // 选模式
  var mode = confirm("点确定=顺推剧情，点取消=加意外转折") ? "natural" : "event";
  if(typeof AGENT_PUSHSTORY !== "undefined") AGENT_PUSHSTORY.arm(chatId, mode);
  var b = document.getElementById("pushbtn"); if(b) b.classList.add("on");
};
window.toggleNarr = ()=>{
CHAT.narrMode = !CHAT.narrMode;
const b = document.getElementById("narrbtn");
if(b) b.classList.toggle("on", !!CHAT.narrMode);
const inp = document.getElementById("chat_in");
if(inp && !inp.disabled) inp.placeholder = CHAT.narrMode ? "📜 旁白：写场景/动作/心理描写…" : (CHAT.mode==="group" ? "在群里说点什么…" : `和${CHAT.name||"TA"}说点什么`);
};
window.setAsSpeaker = (v)=>{ CHAT.asSpeaker = v || null; };
function setStreaming(on){
STREAMING = !!on;
const bar = document.querySelector(".chatbar");
if(!bar) return;
bar.innerHTML = chatbarInner(STREAMING);
}
/* 当前是否在流式生成中（供页面重建/测试查询） */
window.__isStreaming = ()=> STREAMING;
window.stopGen = ()=>{ abortStreaming(); };
const streamWho = ()=> STREAM_SPEAKER || CHAT.name || "TA";
function streamToken(tok){
/* P0-4: 只写"当前在飞轮次 + 当前会话"的 token。切会话/新轮次后旧流的 token 直接丢弃，防串台。 */
if(__liveGen !== __curGen || chatHistKey() !== __liveKey) return;
/* P2-2: 页面隐藏(切后台)时不往不可见 DOM 追加 token。流不中断，回前台后继续追加，
   完成时照常 saveHist + renderChat 落全文，不会写坏状态。 */
if(typeof document !== "undefined" && document.hidden) return;
const log = $("#chatlog");
let live = document.getElementById("live");
if(!live){
if(document.getElementById("typing")) document.getElementById("typing").remove();
log.insertAdjacentHTML("beforeend",
`<div class="msg"><div class="msgcol">${CHAT.mode==="group"?`<div class="who">${esc(streamWho())}</div>`:""}<div class="bubble" id="live"></div></div></div>`);
live = document.getElementById("live");
}
live.textContent += tok;
if(chatNearBottom()){ markProgScroll(); log.scrollTop = log.scrollHeight; }
}
window.sendChat = ()=>{
const inp = $("#chat_in");
const text = inp.value.trim();
if(!text) return;
inp.value = "";
sendChatText(text);
};
window.sendChatText = async (text)=>{
text = String(text||"").trim();
if(!text) return;
const cfg = getCfg();
if(!cfg.key ||!cfg.base ||!cfg.model){ alert("先去「设置」配好 API 地址/Key/模型"); return;}
const rcfg = getRpCfg();
const k = chatHistKey();
/* P0-3: 历史读失败则拒绝发送（不能拿空历史去覆盖） */
let h = null;
try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败，发送已取消"); return; }
setStreaming(true);
/* P0-4: 本轮独立 signal + 登记在飞代数/会话键 */
const __sig = streamSignal();
__liveGen = __sig.__gen; __liveKey = k;
const t = $("#typing"); if(t) t.remove();
const isGroup = CHAT.mode==="group";
const isTrav = CHAT.mode==="traverse";
let speakers = [];
if(isGroup){
let lastSp = null;
for(let i=h.length-1;i>=0;i--){ if(h[i].role==="assistant"&&h[i].speaker){ lastSp = h[i].speaker; break; } }
const gkey = CHAT.members.slice().sort().join("_");
if(CHAT.forcedSpeaker){ speakers = [CHAT.forcedSpeaker]; }
else if(RP_GROUP.getOrder(CHAT.runId, gkey)==="list"){
  const nx = RP_GROUP.nextInList(CHAT.members, lastSp);
  speakers = nx ? [nx] : [];
}else{
  speakers = RP_GROUP.planSpeakers(text, CHAT.members,
    RP_GROUP.talkMapFor(CHAT.runId, CHAT.members), lastSp, {maxSpeakers: RP_GROUP.MAX_SPEAKERS});
}
CHAT.forcedSpeaker = null;
STREAM_SPEAKER = speakers[0] || null;
}
if(isTrav) STREAM_SPEAKER = "世界";
try{
/* Tier2 #15: 简洁回复开关 (Janitor "Snappier, more concise replies"): 单聊且打开时,
 * system 追加简洁指令, maxTokens 压到 300 以内, 透传 concise 到 prompt 构建 */
const conciseOn = CHAT.mode==="single" && getChatOpt(CHAT.runId, CHAT.name).concise;
const sendOpts = {
cfg: Object.assign({}, cfg, {maxContext: rcfg.maxContext, summaryModel: rcfg.summaryModel}),
history: h,
temperature: rcfg.temperature, topP: rcfg.topP,
maxTokens: conciseOn ? Math.min(rcfg.respTokens, 300) : rcfg.respTokens,
concise: conciseOn,
optCards: !!rcfg.optCards, optCount: rcfg.optCount, optMood: rcfg.optMood,
plotOutline: activePlotOutline(), scenario: scenarioInstr(), oocOn: rcfg.ooc,
sceneText: getSceneText(), /* S-7 高权重场景 */
chapterIdx: getChapterIdx(), /* 章节进度：角色知识截止 */
userMtype: CHAT.narrMode ? "narr" : (CHAT.asSpeaker ? "npc" : "player"),
userSpeaker: CHAT.asSpeaker || null,
pov: CHAT.pov || "player", person: CHAT.person || "second",
onUserMsg: ()=>{ renderChat(true); },
budget: {maxContext: rcfg.maxContext, response: rcfg.respTokens, preset: rcfg.preset, stPreset: resolveStPreset()},
signal: __sig, onToken: streamToken,
onSpeaker: (sp)=>{ STREAM_SPEAKER = sp; },
onSpeakerDone: ()=>{ saveHist(k, h); renderChat(); },
onPush: ()=>{ saveHist(k, h); },
onSystem: (preview, stats)=>{ LAST_SYSTEM = preview + "\n\n【预算】" + JSON.stringify(stats); LAST_STATS = stats; recordLastPrompt(stats); },
/* PPA 二遍对齐: 档位/模型经由 opts.ppa 透传; onAligning 在气泡上提示"对齐中…" */
ppa: {mode: rcfg.ppaMode||"key", model: (rcfg.ppaModel||"").trim(), summaryModel: rcfg.summaryModel||""},
onAligning: (on, finalText)=>{
  const live = document.getElementById("live");
  if(on){ if(live && !document.getElementById("ppa-aligning")) live.insertAdjacentHTML("beforeend", `<span id="ppa-aligning" style="opacity:.55">（对齐中…）</span>`); }
  else { const a = document.getElementById("ppa-aligning"); if(a) a.remove(); if(live && finalText != null) live.textContent = finalText; }
},
};
/* 走原著线：当前节点是前台决策点时，强制开启剧情选项卡（3 选项点选） */
try{
  if(isTrav && CHAT && CHAT.travId && typeof RP_PLOTRUN!=="undefined"
    && RP_PLOTRUN.decisionNode(CHAT.travId)){
    sendOpts.optCards = true; sendOpts.optCount = 3;
  }
}catch(e){}
/* P1: 出戏值检测（穿越模式下每次玩家发言都算一次） */
if(isTrav) travOocCheck(CHAT.travId, text);
const r = isGroup
? await RP.sendGroup(CHAT.runId, CHAT.members, speakers, text, sendOpts)
: isTrav
? await RP.sendTraverse(CHAT.travId, text, {
  cfg: sendOpts.cfg, history: h, temperature: sendOpts.temperature,
  topP: sendOpts.topP, maxTokens: sendOpts.maxTokens, budget: sendOpts.budget,
  optCards: sendOpts.optCards, optCount: sendOpts.optCount, optMood: sendOpts.optMood,
  signal: sendOpts.signal, onToken: sendOpts.onToken, onPush: sendOpts.onPush,
  onUserMsg: sendOpts.onUserMsg, onSystem: sendOpts.onSystem,
  ppa: sendOpts.ppa, onAligning: sendOpts.onAligning,
  extraPrompt: travExtraPrompt(CHAT.travId, text)})
: await RP.send(CHAT.runId, CHAT.name, text, sendOpts);
saveHist(k, r.history);
/* 走原著线：本轮结束后推进剧情节点（幂等；发送失败/中断不推进） */
try{
  if(!r.aborted && !r.failed && CHAT && CHAT.travId && typeof RP_TRAVERSE!=="undefined"){
    const _ts2 = RP_TRAVERSE.get(CHAT.travId);
    if(_ts2 && _ts2.plotrunId && typeof RP_PLOTRUN!=="undefined"){
      const _st2 = RP_PLOTRUN.load(_ts2.plotrunId);
      if(_st2 && _st2.currentNodeId){
        const _wasFin = RP_PLOTRUN.isFinished(_st2);
        RP_PLOTRUN.completeNode(_st2, _st2.currentNodeId, text);
        if(!_wasFin && RP_PLOTRUN.isFinished(_st2)) achvUnlock("plotline_1");
      }
    }
  }
}catch(e){}
achvUnlock("first_chat");
try{ hbAfterSend(); }catch(e){} /* Tier3-25: 心跳轮次计数（仅前台，不阻塞） */
if(r.aborted){
/* P0-3: 读失败时只提示、不写回（不能拿空数组覆盖真实历史） */
let hh = null;
try{ hh = getHist(k); }catch(e2){ rpToast("聊天记录读取失败"); }
if(hh){ hh.push({role:"assistant", content:"（已停止生成）", ts:Date.now()}); saveHist(k, hh); }
}else if(getRpCfg().ttsAuto){
/* P1-1: 自动朗读 AI 回复 */
const li = r.history.length-1;
if(r.history[li] && r.history[li].role==="assistant"){ try{ ttsMsg(li); }catch(e){} }
}
}catch(e){
/* P0-3: 读失败时只提示、不写回 */
let hh = null;
try{ hh = getHist(k); }catch(e2){ rpToast("聊天记录读取失败"); }
if(hh){ hh.push({role:"assistant", speaker: (speakers[0]||null), content:`⚠️ 出错了：${e.message}`, ts:Date.now()}); saveHist(k, hh); }
else{ rpToast("发送失败："+e.message); }
}finally{
/* P0-3: 收尾必须执行——setStreaming(false) 进 finally，任何异常都不能让输入框永久锁死 */
STREAM_SPEAKER = null;
setStreaming(false);
renderChat();
}
};
/* 剧情线编辑器 v27: 原著剧情大纲, 读者可自行编辑 */
/* ============ 章节进度：角色只知道所选章节之前的事 ============ */
function chapterKey(){
  try{
    if(CHAT.mode==="group") return "nd_chapter_group_" + CHAT.runId + "_" + (CHAT.members||[]).slice().sort().join("_");
    if(CHAT.mode==="traverse") return "nd_chapter_trav_" + CHAT.travId;
    return "nd_chapter_" + CHAT.runId + "_" + (CHAT.name||"");
  }catch(e){ return "nd_chapter_misc"; }
}
function getChapterIdx(){
  try{
    var v = localStorage.getItem(chapterKey());
    return v === null ? -1 : parseInt(v);
  }catch(e){ return -1; }
}
function setChapterIdx(i){
  try{
    if(i < 0) localStorage.removeItem(chapterKey());
    else localStorage.setItem(chapterKey(), String(i));
  }catch(e){}
  updateChapterBadge();
}
function getSections(){
  try{
    var run = (window.__DATA__.runs || {})[CHAT.runId] || {};
    return run.sections || [];
  }catch(e){ return []; }
}
function updateChapterBadge(){
  try{
    var idx = getChapterIdx();
    var secs = getSections();
    var label = idx >= 0 && secs[idx] ? ("第" + (idx+1) + "章") : "";
    ["chapter_badge"].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.textContent = label;
    });
    /* 顶栏徽标 */
    var hb = document.getElementById("chapter_hbadge");
    if(hb){
      if(label && secs[idx]){
        hb.style.display = "";
        hb.textContent = "📖 " + label;
        hb.title = secs[idx].title || "";
      }else hb.style.display = "none";
    }
  }catch(e){}
}
 /* 章节入口 HTML (B9): 导入卡/custom 卡在 __DATA__.runs 里没有 run, getSections() 恒空 ——
    抽屉里就不该留一个必点空的入口(徽章 #chapter_badge 随按钮一起消失)。
    getSections 本体不动(无 run 就是无章节), 这里只判"这个作品有没有章节可展示"。 */
 function chapterEntryHTML(withBadge){
   if(!getSections().length) return "";
   return `<button class="ditem" onclick="toggleDrawer(false);chapterPicker()">${icon("bookmark")} 章节进度` +
     (withBadge ? `<span id="chapter_badge" style="margin-left:auto;font-size:calc(11px * var(--fs));color:var(--gold)"></span>` : "") +
     `</button>`;
 }
 window.chapterPicker = ()=>{
   var secs = getSections();
   if(!secs.length){ return; } /* 无章节: 入口已隐藏(B9), 静默返回, 不再弹误导 toast */
  var cur = getChapterIdx();
  var v = document.getElementById("view");
  var html = `<button class="back" onclick="setTab('chat');showChat()">${icon("back")} 返回聊天</button>
    <h2 class="sec">📖 章节进度</h2>
    <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:12px;line-height:1.8">
      选择后，角色只知道该章节及之前发生的事，对之后剧情一无所知。<br>
      选"全部（无限制）"则角色拥有完整原著知识。
    </div>
    <div class="card" style="padding:6px">
      <button class="ditem" onclick="setChapterIdx(-1);chapterPicker()" style="width:100%">
        ${icon("bookmark")} 全部（无限制） ${cur<0?'<span style="margin-left:auto;color:var(--gold)">✓</span>':""}
      </button>
    </div>
    <div style="display:grid;gap:8px;margin-top:8px">` +
    secs.map(function(s, i){
      var active = i === cur;
      return `<div class="card card--tap${active?"":""}" onclick="setChapterIdx(${jq(i)});chapterPicker()"
        style="cursor:pointer;${active?"border-color:var(--gold-deep);background:rgba(212,162,78,.08)":""}">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:calc(12px * var(--fs));color:var(--gold);white-space:nowrap">第${i+1}章</span>
          <span style="font-size:calc(14px * var(--fs));flex:1">${esc(s.title||("章节"+(i+1)))}</span>
          ${active?'<span style="color:var(--gold)">✓</span>':""}
        </div>
        ${s.summary?`<div style="font-size:calc(11px * var(--fs));color:var(--ink-faint);margin-top:4px;line-height:1.6">${esc(s.summary.slice(0,120))}${s.summary.length>120?"…":""}</div>`:""}
      </div>`;
    }).join("") + `</div><div style="height:40px"></div>`;
  /* 保存返回动作 */
  window.__chapterBack = window.__backAction;
  window.__backAction = ()=>{ setTab("chat"); showChat(); };
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  v.innerHTML = html;
  window.scrollTo(0,0);
};
window.plotEditor = ()=>{
__backAction = ()=>plotGoBack();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const label = CHAT.mode==="group" ? ("群聊 · " + (CHAT.members||[]).join("、")) : (CHAT.name||"");
const cur = activePlotOutline();
const bundled = bundledPlot();
const hasBundled = !!bundled;
titleEl.innerHTML = icon("book-open")+" 剧情线"; subEl.textContent = label + " · 原著剧情大纲，读者可自行编辑";
view.innerHTML = `<button class="back" onclick="plotGoBack()">${icon("back")} 返回</button>
<div class="field"><label>原著剧情大纲${hasBundled?"（来自蒸馏管线）":""}</label>
<textarea id="p_outline" oninput="tokCount('p_outline','p_tok')" style="width:100%;min-height:300px;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:10px">${esc(cur)}</textarea><div class="tokline" id="p_tok"></div></div>
${hasBundled?"":`<div class="hint">暂无该角色的原著大纲数据，可自行编写。</div>`}
<div class="btnrow"><button class="btn" onclick="plotSave()">保存大纲</button>
${hasBundled&&cur!==bundled?`<button class="btn ghost" onclick="plotRestore()">↺ 恢复原著大纲</button>`:""}
${cur?`<button class="btn danger" onclick="plotClearOutline()">清空</button>`:""}</div>`;
tokCount("p_outline","p_tok");
window.scrollTo(0,0);
};
window.plotGoBack = ()=>{ showChat(); };
window.plotSave = ()=>{
const g = $("#p_outline").value.trim();
const pg = getPlot()||{};
pg.outline = g; pg.updatedAt = Date.now();
savePlot(pg); plotGoBack();
};
window.plotRestore = ()=>{
const pg = getPlot()||{};
pg.outline = bundledPlot(); pg.updatedAt = Date.now();
savePlot(pg); plotEditor();
};
window.plotClearOutline = ()=>{
if(!confirm("清空当前剧情大纲？")) return;
savePlot({outline:"", updatedAt: Date.now()}); plotEditor();
};
/* ============ 情景预设 (对标星野: 哄睡/专属时光; 点选后成为本轮+后续的情景模式) ============ */
const SCENARIOS = [
{id:"sleep", icon:"🌙", name:"哄睡", starter:"夜深了，哄我睡觉吧。",
 instr:"【情景：哄睡】现在是深夜，用户想听你哄睡。用温柔、缓慢的语气，像讲睡前故事一样哄 TA 入睡；可以讲一小段温柔的故事、哼摇篮曲式的呓语；回复不要太长，氛围安静轻柔。"},
{id:"moment", icon:"🕯️", name:"专属时光", starter:"今晚只属于我们两个人。",
 instr:"【情景：专属时光】营造只属于你们两人的静谧时光：感官描写细腻、节奏放慢，专注彼此，不要引入第三个人或外部事件打扰。"},
{id:"tea", icon:"☕", name:"茶馆闲聊", starter:"在茶馆偶遇你，坐下来聊会儿天吧。",
 instr:"【情景：茶馆闲聊】轻松日常的闲聊氛围，像老友在茶馆偶遇：话题随意、语气松弛，可以聊见闻、打趣，不要搞宏大叙事。"},
{id:"rain", icon:"🌧️", name:"雨夜谈心", starter:"外面下着雨，陪我说说话。",
 instr:"【情景：雨夜谈心】雨夜氛围：情绪浓郁、适合谈心。多写环境和心境的呼应，引导用户说出心里话，语气真诚。"},
];
function scenarioInstr(){
if(!CHAT.scenario) return "";
const s = SCENARIOS.find(x=>x.id===CHAT.scenario);
return s ? s.instr : "";
}
function renderScenChips(){
const el = $("#scenbar");
if(!el) return;
/* 输入框聚焦时不重建, 避免打字被打断 */
const ae = document.activeElement;
if(ae && ae.id === "scenetext" && el.contains(ae)) return;
el.innerHTML = `<div class="scenrow" data-xfade>` + SCENARIOS.map(s=>
`<button class="scenchip ${CHAT.scenario===s.id?"on":""}" onclick="toggleScenario('${jq(s.id)}')">${s.icon}${s.name}</button>`).join("")
+ (CHAT.scenario ? `<button class="scenchip off" onclick="toggleScenario('')">✕</button>` : "")
+ `</div>`
+ `<input id="scenetext" class="scenetext" maxlength="160" placeholder="当前场景：地点/着装/活动（160字内）" value="${esc(getSceneText())}" oninput="setSceneText(this.value)" title="场景描述（160字内），注入权重最高">`;
}
/* S-7 高权重场景 (对标 Kindroid current_scene): 160 字符内, 按聊天存 */
function sceneKey(){ try{ return "nd_scene_" + chatHistKey(); }catch(e){ return "nd_scene_misc"; } }
function getSceneText(){ try{ return localStorage.getItem(sceneKey()) || ""; }catch(e){ return ""; } }
function setSceneText(v){ try{ localStorage.setItem(sceneKey(), String(v == null ? "" : v).slice(0, 160)); }catch(e){} }
window.toggleScenario = (id)=>{
if(!id || CHAT.scenario===id){ CHAT.scenario = null; renderScenChips(); return; }
CHAT.scenario = id;
const s = SCENARIOS.find(x=>x.id===id);
renderScenChips();
if(s && s.starter){
const inp = $("#chat_in");
if(inp){ inp.value = s.starter; sendChat(); }
}
};
window.clearChat = ()=>{
const label = CHAT.mode==="group" ? "这个群聊" : CHAT.name;
/* Tier2 #16: 星野 "设置·重启对话会清空记忆和关系，从头来过" — 明确告知后果 */
if(!confirm(`清空和${label}的聊天记录？\n会清空记忆和关系，从头来过。`)) return;
const hk = chatHistKey();
localStorage.removeItem(hk);
/* 大历史可能已搬进 IDB/文件层（MEM 镜像也要清，否则清完还显示旧记录） */
try{ if(typeof RP_STORE!=="undefined" && RP_STORE.removeItemAsync){ RP_STORE.removeItemAsync(hk).catch(()=>{}); } }catch(e){}
if(CHAT.mode==="single") RP_MEM.clear(CHAT.runId, CHAT.name);
renderChat();
};
/* ============ 叙事视角/人称 (默认: 玩家主视角+第二人称; 按会话持久化) ============ */
const POVS = [
{id:"player", icon:"👤", name:"以我为主", desc:"镜头跟随玩家"},
{id:"char", icon:"🎭", name:"以角色为主", desc:"深入角色内心"},
];
const PERSONS = [
{id:"second", icon:"你", name:"第二人称"},
{id:"first", icon:"我", name:"第一人称"},
{id:"third", icon:"他", name:"第三人称"},
];
const povStoreKey = ()=> `nd_pov_${CHAT.runId}_${CHAT.mode==="group"?"__group":CHAT.name}`;
function loadPov(){
let o = {};
try{ o = JSON.parse(localStorage.getItem(povStoreKey())) || {}; }catch(e){}
CHAT.pov = o.pov || "player";
CHAT.person = o.person || "second";
}
function savePov(){
try{ localStorage.setItem(povStoreKey(), JSON.stringify({pov: CHAT.pov||"player", person: CHAT.person||"second"})); }catch(e){}
}
function povChipsHTML(){
const pov = CHAT.pov || "player", person = CHAT.person || "second";
return `<div class="povsec"><div class="povlabel">${icon("eye",15)} 视角 · 故事围绕谁展开</div><div class="povrow">`
+ POVS.map(p=>`<button class="povchip ${pov===p.id?"on":""}" title="${p.desc}" onclick="setPov('${jq(p.id)}')">${p.id==="player"?icon("user"):p.icon}${p.name}</button>`).join("")
+ `</div><div class="povlabel">${icon("user",15)} 人称 · AI 怎么称呼你和 TA</div><div class="povrow">`
+ PERSONS.map(p=>`<button class="povchip ${person===p.id?"on":""}" onclick="setPerson('${jq(p.id)}')">${p.icon}·${p.name}</button>`).join("")
+ `</div></div>`;
}
window.setPov = (id)=>{ CHAT.pov = id; savePov(); toggleDrawer(false); showChat(); };
window.setPerson = (id)=>{ CHAT.person = id; savePov(); toggleDrawer(false); showChat(); };
/* ============ 记忆事件簿 (对标 Talkie Memory Album + C.AI 记忆 Pin) ============ */
let ALBUM = {runId:null, name:null, back:null};
let ALBUM_KIND = ""; /* Tier2 #14: 事件分型筛选，空=全部 */
window.albumKindFilter = (k)=>{ ALBUM_KIND = k || ""; renderAlbum(); };
window.openAlbum = (runId, name, back)=>{
ALBUM = {runId:runId, name:name, back:(typeof back==="function"?back:null)};
renderAlbum();
};
function albumBack(){
if(ALBUM.back) ALBUM.back();
else showChat();
}
/* ============ Tier3-23: 记忆日记（Memory Diary 形态）============
 * auto-memories（自动抽取）/ pinned-memories（Pin/永久）两节，按时间倒序，日期分组头 */
function diaryTs(m){ /* 条目时间戳：ts 优先，其次解析 time 文本，否则 0（未知时间） */
if(m && m.ts) return m.ts;
if(m && m.time){ const t = Date.parse(m.time); if(!isNaN(t)) return t; }
return 0;
}
function diaryDayLabel(ts){
if(!ts) return "未知时间";
const d = new Date(ts), now = new Date();
const day = (x)=> new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
const diff = Math.round((day(now) - day(d)) / 86400e3);
const md = (d.getMonth() + 1) + "月" + d.getDate() + "日";
if(diff === 0) return "今天 · " + md;
if(diff === 1) return "昨天 · " + md;
if(d.getFullYear() === now.getFullYear()) return md;
return d.getFullYear() + "年" + md;
}
function diarySectionHTML(title, ic, items, evCard){
if(!items.length) return "";
const sorted = items.slice().sort((a,b)=>diaryTs(b) - diaryTs(a));
let html = "", lastDay = null;
sorted.forEach(m=>{
const day = diaryDayLabel(diaryTs(m));
if(day !== lastDay){ html += `<div class="diary-day">${esc(day)}</div>`; lastDay = day; }
html += evCard(m);
});
return `<h2 class="sec">${icon(ic,14)} ${title}</h2><div class="timeline">${html}</div>`;
}
function renderAlbum(){
const runId = ALBUM.runId, nm = ALBUM.name;
__backAction = ()=>albumBack();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
let st = RP_MEM.get(runId, nm);
/* LeanMem: 事件簿打开时确保三库已迁移 (幂等), 展示分流结果 */
if(st && RP_MEM.leanmemOn && RP_MEM.leanmemOn()) st = RP_MEM.migrate3(runId, nm, st);
const short = (st && st.short) || [];
const pinned = short.filter(m=>m.pin);
const rest = short.filter(m=>!m.pin);
const h = getHistSafe(`nd_chat_${runId}_${nm}`);
let up = 0, dn = 0;
h.forEach(m=>{ if(m.role==="assistant"){ if(m.rating===1) up++; else if(m.rating===-1) dn++; } });
titleEl.innerHTML = icon("books")+" 记忆事件簿"; subEl.textContent = nm + " · 记忆日记";
/* P1-8: 长期记忆库用量条 */
const ms = RP_MEM.memStats(runId, nm);
const muPct = Math.min(100, Math.round(ms.events / Math.max(1, ms.shortMax) * 100));
const muBar = `<div class="mem-usage"><div class="mu-bar"><div class="mu-fill" style="width:${muPct}%"></div></div>
<div class="mu-label">长期记忆 ${ms.events}/${ms.shortMax} · 置顶 ${ms.pinned}/${ms.pinMax} · 长远印象 ${ms.longN}/1</div></div>`
+ (ms.pinned >= ms.pinMax ? `<div class="hint warn">置顶已达 ${ms.pinned} 条, 建议整理：取消不重要的置顶, 让最重要的记忆排在前面。（只是提醒, 不会禁止继续置顶）</div>` : "");
/* Tier2 #19: 记忆快照状态行 (对标猫箱 BotMemorySnapshot 状态机) */
const msl = RP_MEM.memStatusLine(runId, nm);
const memStatusHtml = (msl.state !== "idle")
? `<div class="memstatus ${msl.state}"${msl.state==="fail"?' onclick="retryMemAnalyze()" style="cursor:pointer"':""}>${esc(msl.text)}</div>` : "";
const evCard = (m)=>{
const id = m.id;
return `<div class="tl-item${m.pin?" gold":""}"><div class="card alb-event${m.pin?" pinned":""}">`
+ `<div class="alb-time">${esc(m.time||"往事")}${m.pin ? ' <span class="badge warn">' + icon("pin",13) + ' 置顶</span>' : ""}</div>`
+ `<div class="alb-fact">${esc(m.fact||"")}</div>`
+ (m.view?`<div class="alb-view">此刻看法：${esc(m.view)}</div>`:"")
+ `<div class="btnrow" style="margin-top:8px">`
+ `<button class="btn ghost" onclick="memPin(${jq(id)})">${m.pin?"取消置顶":icon("pin",14)+" 置顶"}</button>`
+ `<button class="btn ghost" onclick="memEditForm(${jq(id)})">✏️ 编辑</button>`
+ `<button class="btn ghost" onclick="memCopyCard(${jq(id)})">📋 复制卡片</button>`
+ `<button class="btn danger" onclick="memDel(${jq(id)})">删除</button>`
+ `</div></div></div>`;
};
const apexAlb = (typeof RP_APEX !== "undefined") && (getRpCfg().apex !== false) && !!(st && st.migrated3);
const P3alb = apexAlb ? RP_APEX.latestOf(st.profile3) : ((st && st.profile3) || []);
const E3alb = apexAlb ? RP_APEX.latestOf(st.event3) : ((st && st.event3) || []);
const R3alb = apexAlb ? RP_APEX.latestOf(st.record3) : ((st && st.record3) || []);
/* 第 3 项: profile3 relationship 段分段渲染 (stage/boundaries/type/communicationPreferences/currentLocation) */
const relSeg = (p)=>{
const r = p && p.relationship; if(!r) return "";
const parts = [["stage","阶段"],["boundaries","边界"],["type","类型"],["communicationPreferences","沟通偏好"],["currentLocation","当前位置"]]
.filter(kv=>r[kv[0]]).map(kv=>kv[1]+"："+r[kv[0]]);
return parts.length ? `<div class="alb-sub">关系 · ${esc(parts.join("；"))}</div>` : "";
};
/* 第 3 项: event3 结构化字段分段渲染 (老数据缺字段=undefined, 容错跳过) */
const evStruct = (e)=>{
const L = (typeof RP_LOREBOOK !== "undefined") ? RP_LOREBOOK.EVENT_FIELD_LABELS : null;
const keys = ["location","participants","agreements","type","status","emotionalTone","attitudeToUser","relationshipImpact"];
const fb = {location:"地点",participants:"参与者",agreements:"约定与任务",type:"类型",status:"状态",emotionalTone:"情感基调",attitudeToUser:"对用户的态度",relationshipImpact:"关系影响"};
const parts = keys.filter(k=>e && e[k]).map(k=>((L&&L[k])||fb[k])+"："+e[k]);
return parts.length ? `<div class="alb-sub">${esc(parts.join("；"))}</div>` : "";
};
/* 第 4 项: Facts 独立分区 (自动区/手动区, 带分类标签, 可编辑/手动添加) */
const factsHtml = (()=>{
if(!(st && st.migrated3)) return "";
const gf = RP_MEM.getFacts(st), fz = RP_MEM.factsChars(st), fmax = RP_MEM.FACTS_MAX_CHARS;
const factRow = (f)=>`<div class="alb-fact">· <span class="badge">${esc(f.cat||"其他")}</span> ${esc(f.text||"")}`
+ `<div class="btnrow" style="margin-top:6px"><button class="btn ghost" onclick="factForm(${jq(f.id)})">编辑</button><button class="btn danger" onclick="factDel(${jq(f.id)})">删除</button></div></div>`;
const edu = `<div class="facts-edu">角色会留意聊天中的细节——外貌、怪癖、关系等，自动记成事实并随时间更新；你也可以随时编辑或补充。`
+ `<details><summary>原文说明 (C.AI)</summary>`
+ `<div class="facts-en">"Your Characters pay attention. As you chat, they pick up on details about everyone mentioned in the conversation - appearance, quirks, relationships, and more. These facts update automatically over time."</div>`
+ `<div class="facts-en">"You can edit or add facts about Characters whenever you want."</div>`
+ `<div class="facts-en">"Changes are captured automatically, kept up to date, and always editable."</div>`
+ `</details></div>`;
return `<h2 class="sec">事实 Facts</h2><div class="card">${edu}`
+ `<div class="alb-time">自动事实 · ${gf.auto.length} 条（聊天中自动抽取更新）</div>`
+ (gf.auto.map(factRow).join("") || '<div class="empty">多聊几句，事实会自动出现在这里</div>')
+ `<div class="alb-time" style="margin-top:8px">手动事实 · ${gf.manual.length} 条（你亲手添加）</div>`
+ (gf.manual.map(factRow).join("") || '<div class="empty">暂无</div>')
+ `<div class="btnrow" style="margin-top:8px"><button class="btn" onclick="factForm()">+ 添加事实</button></div>`
+ `<div class="hint">事实总字数 ${fz}/${fmax}，超限请删除或缩短一条事实。</div></div>`;
})();
const P3stable = P3alb.filter(p=>!RP_MEM.isFactEntry(p));
const apexHist = (arr, id, fmt)=>{
  if(!apexAlb || typeof RP_APEX === "undefined") return "";
  const vers = RP_APEX.versionsOf(arr || [], id);
  if(vers.length <= 1) return "";
  const olds = vers.slice(0, -1).reverse().map(v=>`<div class="alb-fact" style="opacity:.62">v${v.v||1} · ${esc(fmt(v))}</div>`).join("");
  return `<details class="alb-hist"><summary>历史版本（${vers.length - 1}）</summary>${olds}</details>`;
};
/* Tier2 #14: 事件分型筛选 (对标星野记忆 card kind); Tier2 #10: 永久记忆按钮 */
const kindChips = `<div class="kindchips">` + ["", "事件", "心情", "关系", "初见"].map(k=>
`<button class="kindchip${ALBUM_KIND===k?" on":""}" onclick="albumKindFilter('${jq(k)}')">${k||"全部"}</button>`).join("") + `</div>`;
const E3shown = ALBUM_KIND ? E3alb.filter(e=>RP_MEM.kindLabel(e)===ALBUM_KIND) : E3alb;
const ev3Card = (e)=>{
const kind = RP_MEM.kindLabel(e);
return `<div class="alb-fact">· ${esc((e.t_anchor?e.t_anchor+" ":"")+(e.topic||""))}${e.state?" —— "+esc(e.state):""}${evStruct(e)}`
+ ` <span class="badge">${kind}</span>`
+ (e.perm?` <span class="badge warn">${icon("pin",11)} 永久</span>`:"")
+ `${(e.merged||0)>1?` <span class="badge">合并×${e.merged}</span>`:""}${(e.v||1)>1?` <span class="badge">v${e.v}</span>`:""}`
+ `<div class="btnrow" style="margin-top:6px"><button class="btn ghost" onclick="toggleEventPerm(${jq(e.id)})">${e.perm?"取消永久":"设为永久"}</button></div></div>`
+ apexHist(st.event3,e.id,x=>(x.t_anchor?x.t_anchor+" ":"")+(x.topic||"")+(x.state?" —— "+x.state:""));
};
view.innerHTML = `<button class="back" onclick="albumBack()">${icon("back")} 返回</button>
${muBar}
${memStatusHtml}
<div class="alb-stats">${icon("brain",14)} ${short.length} 条记忆 · ${icon("pin",13)} ${pinned.length} 条置顶 · ${icon("thumb-up",13)} ${up} ${icon("thumb-down",13)} ${dn}</div>`
+ (st && st.mood && st.mood.state
? `<div class="card alb-mood"><div class="alb-time">当前心境</div><div class="alb-fact">${esc(st.mood.state)}${st.mood.filter?" —— "+esc(st.mood.filter):""}</div></div>` : "")
+ ((st && st.migrated3)
? `<h2 class="sec">三库记忆（LeanMem 分流）</h2>`
+ `<div class="card"><div class="alb-time">画像库 · 稳定事实 ${P3stable.length} 条${apexAlb ? "（版本链）" : ""}</div>`
+ (P3stable.map(p=>`<div class="alb-fact">· ${esc(p.text||"")}${relSeg(p)}${(p.v||1)>1?` <span class="badge">v${p.v}</span>`:""}</div>`+apexHist(st.profile3,p.id,x=>x.text||"")).join("")||'<div class="empty">暂无</div>') + `</div>`
+ `<div class="card"><div class="alb-time">事件库 · 带时间锚 ${E3alb.length} 条（可演化合并）${apexAlb ? "（版本链）" : ""}</div>`
+ kindChips
+ (E3shown.slice().reverse().map(e=>ev3Card(e)).join("")||'<div class="empty">暂无</div>') + `</div>`
+ `<div class="card"><div class="alb-time">记录库 · 原文索引 ${R3alb.filter(r=>!r.legacy).length} 条（只追加不改写）${apexAlb ? "（版本链）" : ""}</div>`
+ (R3alb.filter(r=>!r.legacy).slice().reverse().map(r=>`<div class="alb-fact">· ${esc(r.gist||"")}${(r.msg_from||r.msg_to)?` <span style="opacity:.6">（原文 ${esc(r.msg_from||"?")}→${esc(r.msg_to||"")}）</span>`:""}${(r.v||1)>1?` <span class="badge">v${r.v}</span>`:""}</div>`+apexHist(st.record3,r.id,x=>x.gist||"")).join("")||'<div class="empty">暂无</div>') + `</div>`
+ factsHtml
: "")
+ `<div class="hint">记忆日记：聊天中自动抽取的点滴按时间倒序排列；置顶的是永久记忆，AI 永远优先记住。</div>`
+ diarySectionHTML("置顶记忆 · pinned-memories", "pin", pinned, evCard)
+ diarySectionHTML("自动记忆 · auto-memories", "clock", rest, evCard)
+ (st && st.long ? `<h2 class="sec">长远印象</h2><div class="card"><div class="alb-fact">${esc(st.long)}</div></div>` : "")
+ (!short.length && !(st && st.long) ? `<div class="empty"><span class="big">${icon("brain",44)}</span>还没有记忆<br><span style="font-size:calc(12px * var(--fs))">每 ${(getRpCfg().memCycle||10)} 条消息自动整理一次</span><br><button class="btn ghost" style="margin-top:10px" onclick="albumBack()">去聊天产生记忆</button></div>` : "")
+ `<div class="btnrow" style="margin-top:12px"><button class="btn" onclick="memoryNovel()">${icon("book-open")} 转成小说</button><button class="btn ghost" onclick="showNovel3()">${icon("scroll")} 分章小说 · 可改写</button></div>
<div style="height:40px"></div>`;
window.scrollTo(0,0);
}
/* P1-8: Pin 达 30 条时软提示, 不禁止 */
function pinNudge(runId, name){
try{
const ms = RP_MEM.memStats(runId, name);
if(ms.pinned === ms.pinMax)
alert(`置顶记忆已达 ${ms.pinMax} 条, 建议整理不重要的置顶。\n（只是提醒, 不会禁止继续置顶）`);
}catch(e){}
}
window.memPin = (id)=>{
const cur = RP_MEM.togglePin(ALBUM.runId, ALBUM.name, id);
if(cur) pinNudge(ALBUM.runId, ALBUM.name);
renderAlbum();
};
window.memDel = (id)=>{
if(!confirm("删除这条记忆？")) return;
RP_MEM.delItem(ALBUM.runId, ALBUM.name, id);
renderAlbum();
};
/* v36: 自动记忆条目编辑（P0 事件簿"查看/编辑/删除"补齐编辑入口） */
window.memEditForm = (id)=>{
const runId = ALBUM.runId, nm = ALBUM.name;
__backAction = ()=>renderAlbum();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const st = RP_MEM.get(runId, nm);
const m = ((st && st.short)||[]).find(x=>x.id==id);
if(!m){ alert("记忆不存在"); return; }
titleEl.innerHTML = icon("books")+" 编辑记忆"; subEl.textContent = nm;
view.innerHTML = `<button class="back" onclick="renderAlbum()">${icon("back")} 返回事件簿</button>
<div class="card">
<div class="field"><label>时间</label><input id="me_time" value="${esc(m.time||"")}" placeholder="如：三月初三"></div>
<div class="field"><label>事实${RP_AIFILL.btn("me_fact","关于"+nm+"的记忆事实","一句话，如：她在雨夜把伞给了你","角色"+nm+"；记忆原文：\\n"+(m.fact||""))}</label><textarea id="me_fact" rows="3" placeholder="这条记忆记录的事实">${esc(m.fact||"")}</textarea></div>
<div class="field"><label>此刻看法（可选）</label><input id="me_view" value="${esc(m.view||"")}" placeholder="她/你现在怎么看这件事"></div>
<div class="btnrow"><button class="btn" onclick="memEditSave(${jq(id)})">保存</button></div></div>`;
window.scrollTo(0,0);
};
window.memEditSave = (id)=>{
const r = RP_MEM.editItem(ALBUM.runId, ALBUM.name, id, {
  fact: $("#me_fact").value, view: $("#me_view").value, time: $("#me_time").value});
if(!r.ok){ alert(r.err==="empty" ? "事实内容不能为空。" : "保存失败，请重试。"); return; }
renderAlbum();
};
/* Tier2 #10: 永久记忆切换 (Talkie "Select the event you want Talkie to remember permanently…")。
 * 达上限时用 Talkie 原文 toast。 */
window.toggleEventPerm = (id)=>{
const st = RP_MEM.get(ALBUM.runId, ALBUM.name) || {};
const apexW = (typeof RP_APEX !== "undefined") && RP_MEM.leanmemOn() && RP_APEX.on();
const latest = apexW ? RP_APEX.latestOf(st.event3) : ((st && st.event3) || []);
const hit = latest.filter(e=>e && e.id == id)[0];
const r = RP_MEM.setEventPerm(ALBUM.runId, ALBUM.name, id, !(hit && hit.perm));
if(r === "limit") alert(RP_MEM.permLimitMsg());
renderAlbum();
};
/* Tier2 #19: 记忆快照失败 → 手动重试 (用摘要模型对最近消息跑一次分析) */
window.retryMemAnalyze = async ()=>{
const runId = ALBUM.runId, nm = ALBUM.name;
try{
const cfg = getCfg();
const h = getHistSafe(`nd_chat_${runId}_${nm}`);
if(!h.length){ alert("还没有聊天记录"); return; }
const card = RP.findCard(runId, nm) || {};
const hint = (((card.fields||{}).core_traits||"") + " " + ((card.fields||{}).speech_style||"")).trim();
await RP_MEM.maybeAnalyze(runId, nm, h, cfg,
function(c, ms, t){ return RP_NET.complete(c, ms, t); }, hint);
}catch(e){
try{ RP_MEM.setMemStatus(ALBUM.runId, ALBUM.name, "fail"); }catch(e2){}
}
renderAlbum();
};
window.memCopyCard = (id)=>{
const st = RP_MEM.get(ALBUM.runId, ALBUM.name);
const m = ((st && st.short)||[]).find(x=>x.id==id);
if(!m) return;
copyText(`📌 记忆快照 · ${ALBUM.name}\n时间：${m.time||"往事"}\n事实：${m.fact||""}${m.view?"\n此刻看法："+m.view:""}`);
alert("记忆卡片已复制");
};
/* ============ Facts 事实增改删 (第 4 项: 独立产品面, 自动区+手动区, 分类, 2000 字上限) ============ */
window.factForm = (fid)=>{
const runId = ALBUM.runId, nm = ALBUM.name;
__backAction = ()=>renderAlbum();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const st = RP_MEM.get(runId, nm);
const gf = RP_MEM.getFacts(st);
const all = gf.auto.concat(gf.manual);
const f = (fid != null) ? all.find(x=>x.id==fid) : null;
titleEl.innerHTML = icon("books")+" "+(f?"编辑事实":"添加事实"); subEl.textContent = nm;
const cats = RP_MEM.FACT_CATS.map(c=>`<option value="${c}"${f&&f.cat===c?" selected":""}>${c}</option>`).join("");
view.innerHTML = `<button class="back" onclick="renderAlbum()">${icon("back")} 返回事件簿</button>
<div class="card"><div class="alb-time">Select fact category · 选择事实分类</div>
<div class="field"><label>分类</label><select id="f_cat">${cats}</select></div>
<div class="field"><label>事实内容${RP_AIFILL.btn("f_text","关于"+nm+"的事实","一句话事实，如：她左眉有一颗小痣；可从最近聊天里提炼","角色"+nm+"；最近对话：\n"+RP_AIFILL._recentChatCtx(8,"nd_chat_"+runId+"_"+nm))}</label><input id="f_text" value="${esc(f?(f.text||""):"")}" placeholder="如：她左眉有一颗小痣"></div>
<div class="hint">事实总字数上限 ${RP_MEM.FACTS_MAX_CHARS} 字，当前 ${RP_MEM.factsChars(st)} 字。</div>
<div class="btnrow"><button class="btn" onclick="factSave(${jq(fid==null?"null":fid)})">保存</button></div></div>`;
window.scrollTo(0,0);
};
window.factSave = (fid)=>{
const runId = ALBUM.runId, nm = ALBUM.name;
const opt = {text: $("#f_text").value, cat: $("#f_cat").value};
const r = (fid==null) ? RP_MEM.addFact(runId, nm, opt) : RP_MEM.editFact(runId, nm, fid, opt);
if(!r.ok && r.err === "over"){
alert("事实总字数已达上限（"+RP_MEM.FACTS_MAX_CHARS+"字），请删除或缩短一条事实后再添加。\nYour Story and Facts exceeds allowed text limit, try removing or shortening another fact.");
return;
}
if(!r.ok){ alert("保存失败，请重试。\nFailed to save fact. Please try again."); return; }
alert("Fact saved successfully · 事实已保存");
renderAlbum();
};
window.factDel = (fid)=>{
if(!confirm("确定删除这条事实吗？此操作不可撤销。\nAre you sure you want to delete this Smart Fact? This action cannot be undone.")) return;
RP_MEM.delFact(ALBUM.runId, ALBUM.name, fid);
renderAlbum();
};
/* ============ 记忆转小说 (对标猫箱记忆转小说: 记忆事件 → 小说体阅读) ============ */
window.memoryNovel = ()=>{
const runId = ALBUM.runId, nm = ALBUM.name;
__backAction = ()=>renderAlbum();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const st = RP_MEM.get(runId, nm);
titleEl.innerHTML = icon("book-open")+" 记忆小说"; subEl.textContent = nm + " · 由记忆整理成篇";
const cnNum = ["一","二","三","四","五","六","七","八","九","十"];
const cn = (i)=> i < 10 ? cnNum[i] : String(i+1);
/* P2: 小说风格模板（白话直叙/古风/戏剧化），选择后写入 AI 润色 prompt */
const nst = (typeof RP_APPEAR!=="undefined") ? RP_APPEAR.getNovelStyle() : "plain";
const chHead = (i, time)=> nst==="gufeng" ? `第${cn(i)}回 · ${esc(time||"往事")}`
  : nst==="drama" ? `场景${cn(i)} · ${esc(time||"往事")}`
  : `第${cn(i)}章 · ${esc(time||"往事")}`;
let body = "";
const short = (st && st.short) || [];
if(short.length){
body = short.map((m,i)=>
`<div class="nov-ch"><div class="nov-chh">${chHead(i, m.time)}</div>`
+ `<div class="nov-p">${esc(m.fact||"")}</div>`
+ (m.view?`<div class="nov-p nov-view">—— ${esc(m.view)}</div>`:"")
+ `</div>`).join("");
} else {
// 无记忆时退化为聊天记录对话体
const h = getHistSafe(`nd_chat_${runId}_${nm}`).slice(-30);
body = h.length ? h.map(m=>{
const who = m.role==="user" ? "我" : nm;
return `<div class="nov-p"><b>${esc(who)}</b>：${esc(m.content)}</div>`;
}).join("") : `<div class="empty">还没有内容可写</div>`;
}
view.innerHTML = `<button class="back" onclick="renderAlbum()">${icon("back")} 返回事件簿</button>
<div class="novel">
<div class="nov-title">${esc(nm)} 的记忆</div>
${st && st.mood && st.mood.state ? `<div class="nov-mood">题记 · ${esc(st.mood.state)}${st.mood.filter?" —— "+esc(st.mood.filter):""}</div>` : ""}
${body}
${st && st.long ? `<div class="nov-ch"><div class="nov-chh">尾声</div><div class="nov-p">${esc(st.long)}</div></div>` : ""}
</div>
<div class="btnrow" style="margin-top:12px"><button class="btn ghost" onclick="exportNovel()">${icon("upload")} 复制全文</button></div>
<div class="card" style="margin-top:12px"><div class="field"><label>小说风格（AI 润色用）</label>
<select id="novelStyle" onchange="RP_APPEAR.setNovelStyle(this.value);memoryNovel()">${(typeof RP_APPEAR!=="undefined"?RP_APPEAR.novelStyleKeys():["plain"]).map(k=>`<option value="${k}"${k===nst?" selected":""}>${RP_APPEAR.MEMNOVEL_STYLES[k].name} · ${RP_APPEAR.MEMNOVEL_STYLES[k].desc}</option>`).join("")}</select></div>
<div class="btnrow"><button class="btn" onclick="novelPolish()">${icon("edit")} AI 按此风格润色成篇</button></div>
<div class="hint">润色会把当前页面文字发给已配置的大模型，按所选风格重写一遍。</div></div>
<div style="height:40px"></div>`;
window.scrollTo(0,0);
};
/* P2: AI 按风格模板润色记忆小说（风格写入 prompt） */
window.novelPolish = async ()=>{
const el = document.querySelector(".novel");
if(!el || !el.innerText.trim()){ alert("没有可润色的内容"); return; }
const cfg = getCfg();
if(!cfg.base || !cfg.key){ alert("请先去「设置」配置大模型接口"); return; }
if(!confirm("把全文发给大模型按所选风格润色一遍？")) return;
const style = (typeof RP_APPEAR!=="undefined") ? RP_APPEAR.getNovelStyle() : "plain";
const styleName = (typeof RP_APPEAR!=="undefined") ? RP_APPEAR.MEMNOVEL_STYLES[style].name : "";
const material = el.innerText || "";
el.innerHTML = `<div class="empty">AI 正在以「${esc(styleName)}」风格润色…</div>`;
try{
const prompt = RP_APPEAR.novelStylePrompt(style, material);
const out = await RP_NET.complete({base:cfg.base, key:cfg.key, model:cfg.model},
[{role:"user", content: prompt}], 0.8);
if(out && out.trim()){
const paras = out.trim().split(/\n{2,}|\n/).filter(s=>s.trim());
el.innerHTML = paras.map(p=>`<div class="nov-p">${esc(p.trim())}</div>`).join("");
}else{
alert("润色失败，保留原文"); memoryNovel();
}
}catch(e){ alert("润色失败："+e.message); memoryNovel(); }
};
window.exportNovel = ()=>{
const el = document.querySelector(".novel");
if(!el) return;
copyText(el.innerText);
alert("全文已复制");
};
/* ============ 记忆转小说 · 分章改写 (对标猫箱 novel/*: 生成->分章节->可改写) ============ */
/* 三步: 1 生成章节列表 -> 2 逐章改写正文(先概要后正文) -> 3 阅读 / 导出 TXT; 全本地存储 nd_novel_<chatId> */
let NOV = {runId: null, name: null};
window.showNovel3 = ()=>{
if(typeof RP_NOVEL === "undefined"){ rpToast("小说模块未加载"); return; }
NOV = {runId: ALBUM.runId, name: ALBUM.name};
renderNovel3();
};
function novelChatId(){ return `nd_chat_${NOV.runId}_${NOV.name}`; }
function novelMaterial(){
const runId = NOV.runId, name = NOV.name;
let facts = "";
try{
const st = RP_MEM.get(runId, name);
facts = ((st && st.short) || []).slice(-20).map(m=>`· ${m.time || "往事"}: ${m.fact || ""}`).join("\n");
}catch(e){}
const h = getHistSafe(novelChatId()).slice(-40);
const hist = h.map(m=>`${m.role === "user" ? "我" : name}: ${m.content}`).join("\n");
let cal = "";
try{
/* B20 同名导入卡串味修复: foreshadow_cal 是纯《红楼梦》蒸馏产物, 非红楼世界
   不注入"故事大事记"(空 = buildMaterial 不拼该段, 不编造) */
if(typeof RP_FORE !== "undefined" && foreAvailableFor(runId, name)){
cal = RP_FORE.all().filter(e=>e.k !== "foreshadowing" && (e.c || []).indexOf(name) >= 0)
.slice(0, 40).map(e=>`第${e.ch}回: ${e.s}`).join("\n");
}
}catch(e){}
return RP_NOVEL.buildMaterial(facts, hist, cal);
}
function novelStatusBadge(ch){
if(ch.status === RP_NOVEL.ST_DONE) return `<span class="badge">已完成</span>`;
if(ch.status === RP_NOVEL.ST_WRITING) return `<span class="badge" style="background:#e3f0ff;color:#2b6cb0">生成中…</span>`;
return `<span class="badge" style="background:#f5e6c8;color:#8a6d2f">概要已出</span>`;
}
function renderNovel3(){
__backAction = ()=>renderAlbum();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.innerHTML = icon("scroll") + " 小说工坊";
subEl.textContent = NOV.name + " · 生成→改写→导出";
const novel = RP_NOVEL.getNovel(novelChatId());
let body = "";
if(!novel){
body = `<div class="empty"><span class="big">${icon("scroll",44)}</span>还没有章节规划<br><span style="font-size:calc(12px * var(--fs))">AI 会按聊天记录与记忆事件, 先出章节列表 (标题+梗概), 再逐章扩写正文</span><br>
<button class="btn" style="margin-top:10px" onclick="novelPlan()">✨ 生成章节</button></div>`;
}else{
body = `<div class="card"><div class="name" style="font-size:calc(15px * var(--fs))">${esc(novel.title || "")}</div>
<div class="kv">${novel.chapters.length} 章 · ${novel.chapters.filter(c=>c.status===RP_NOVEL.ST_DONE).length} 章正文已完成</div></div>` +
novel.chapters.map((ch, i)=>`<div class="card">
<div class="row"><div><div class="name" style="font-size:calc(14px * var(--fs))">${/^第.{1,4}章/.test(ch.title||"") ? esc(ch.title) : `第${i + 1}章 · ${esc(ch.title)}`}</div>
<div class="kv">${esc(ch.overview || "")}</div></div>${novelStatusBadge(ch)}</div>
<div class="btnrow" style="margin-top:8px">
<button class="btn ghost" onclick="novelRewriteUI(${jq(i)})">✏️ ${ch.status===RP_NOVEL.ST_DONE?"再次改写":"生成正文"}</button>
${ch.status === RP_NOVEL.ST_DONE ? `<button class="btn ghost" onclick="novelRead()">📖 阅读</button>` : ""}
</div><div id="nrw_${i}"></div></div>`).join("") +
`<div class="btnrow" style="margin-top:12px">
<button class="btn ghost" onclick="if(confirm('重新规划会清空现有章节, 继续?'))novelPlan(true)">🔄 重新规划</button>
<button class="btn ghost" onclick="novelExportTxt()">${icon("download")} 导出 TXT</button>
<button class="btn danger ghost" onclick="if(confirm('删除这本小说?')){RP_NOVEL.delNovel(novelChatId());renderNovel3();}">删除</button>
</div>`;
}
view.innerHTML = `<button class="back" onclick="renderAlbum()">${icon("back")} 返回事件簿</button>
${body}<div style="height:40px"></div>`;
window.scrollTo(0,0);
}
/* 第一步: 生成章节列表 */
window.novelPlan = async (force)=>{
if(typeof RP_NOVEL === "undefined") return;
const cfg = getCfg();
if(!cfg.key || !cfg.base){ alert("先去「设置」填 API 地址和 Key"); return; }
const mat = novelMaterial();
if(!mat.trim()){ rpToast("没有足够的聊天记录或记忆可写"); return; }
rpToast("正在规划章节…");
try{
const chapters = await RP_NOVEL.planChapters(mat, NOV.name, cfg,
function(c, ms, t){ return RP_NET.complete(c, ms, t); });
RP_NOVEL.saveNovel(novelChatId(), RP_NOVEL.newNovelDoc(NOV.name, chapters));
rpToast(`已生成 ${chapters.length} 章`);
renderNovel3();
}catch(e){ rpToast("章节规划失败, 请重试"); }
};
/* 第二步: 单章改写 (章节名+概要+一句话指令 -> 重生成正文) */
window.novelRewriteUI = (i)=>{
const box = document.getElementById("nrw_" + i);
if(!box) return;
box.innerHTML = `<div class="field" style="margin-top:8px"><label>改写要求 (可空, 直接点生成=按概要扩写正文)</label>
<input id="nrw_in_${i}" placeholder="如: 写得更悬疑一点, 加一段雨夜对话"></div>
<div class="btnrow"><button class="btn" id="nrw_go_${i}" onclick="novelRewriteDo(${jq(i)})">🚀 生成本章正文</button></div>`;
const inp = document.getElementById("nrw_in_" + i);
if(inp) inp.focus();
};
window.novelRewriteDo = async (i)=>{
const cfg = getCfg();
if(!cfg.key || !cfg.base){ alert("先去「设置」填 API 地址和 Key"); return; }
const novel = RP_NOVEL.getNovel(novelChatId());
if(!novel || !novel.chapters[i]){ rpToast("章节不存在"); return; }
const inp = document.getElementById("nrw_in_" + i);
const instruction = inp ? inp.value.trim() : "";
novel.chapters[i].status = RP_NOVEL.ST_WRITING;
RP_NOVEL.saveNovel(novelChatId(), novel);
renderNovel3();
try{
await RP_NOVEL.rewriteChapter(novel, i, instruction, cfg,
function(c, ms, t){ return RP_NET.complete(c, ms, t); });
const nv2 = RP_NOVEL.getNovel(novelChatId()) || novel;
RP_NOVEL.saveNovel(novelChatId(), nv2);
rpToast(`第 ${i + 1} 章正文已生成`);
}catch(e){
const nv3 = RP_NOVEL.getNovel(novelChatId());
if(nv3 && nv3.chapters[i] && nv3.chapters[i].status === RP_NOVEL.ST_WRITING){
nv3.chapters[i].status = nv3.chapters[i].content ? RP_NOVEL.ST_DONE : RP_NOVEL.ST_PLANNED;
RP_NOVEL.saveNovel(novelChatId(), nv3);
}
rpToast("本章生成失败, 请重试");
}
renderNovel3();
};
/* 第三步: 阅读 */
window.novelRead = ()=>{
__backAction = ()=>renderNovel3();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const novel = RP_NOVEL.getNovel(novelChatId());
if(!novel){ renderNovel3(); return; }
titleEl.innerHTML = icon("book-open") + " " + esc(novel.title || "小说");
subEl.textContent = NOV.name;
const cnNum = ["一","二","三","四","五","六","七","八","九","十"];
view.innerHTML = `<button class="back" onclick="renderNovel3()">${icon("back")} 返回工坊</button>
<div class="novel"><div class="nov-title">${esc(novel.title || "")}</div>` +
novel.chapters.map((ch, i)=>{
const cn = i < 10 ? cnNum[i] : String(i + 1);
const paras = String(ch.content || "(本章正文尚未生成)").split(/\n{2,}|\n/).filter(s=>s.trim());
return `<div class="nov-ch"><div class="nov-chh">第${cn}章 · ${esc(ch.title)}</div>` +
paras.map(p=>`<div class="nov-p">${esc(p.trim())}</div>`).join("") + `</div>`;
}).join("") + `</div>
<div class="btnrow" style="margin-top:12px"><button class="btn ghost" onclick="novelExportTxt()">${icon("download")} 导出 TXT</button></div>
<div style="height:40px"></div>`;
window.scrollTo(0,0);
};
/* 第三步: 导出 TXT (纯文本, EPUB 不做) */
window.novelExportTxt = ()=>{
const novel = RP_NOVEL.getNovel(novelChatId());
if(!novel){ rpToast("还没有小说可导出"); return; }
downloadTxt(`${novel.title || "小说"}.txt`, RP_NOVEL.exportTxt(novel));
rpToast("已导出 TXT");
};
/* ============ 平行存档 (对标 Xclaw: 多时间线快照, 随时存档/加载/删除) ============ */
function savesKey(){ return "nd_saves_" + chatHistKey(); }
function getSaves(){
try{ const s = JSON.parse(localStorage.getItem(savesKey())||"[]"); return Array.isArray(s)?s:[]; }
catch(e){ return []; }
}
/* ============ P1-5: 平行存档故事树: 分支来源(按聊天维度记) ============ */
const BRANCH_KEY = "nd_branchsrc";
const getBranchSrc = ()=>{ try{ return JSON.parse(localStorage.getItem(BRANCH_KEY)) || {}; }catch(e){ return {}; } };
const setBranchSrc = (chatKey, saveId)=>{ const m = getBranchSrc(); m[chatKey] = saveId; try{ localStorage.setItem(BRANCH_KEY, JSON.stringify(m)); }catch(e){} };
/* 存档树: parentId 指向存在的存档才算父子, 否则按根节点平铺(兼容旧存档) */
function saveTree(){
const ss = getSaves();
const byId = {}; ss.forEach(s=>{ byId[s.id] = s; });
const children = {}, roots = [];
ss.forEach(s=>{
const pid = (s.parentId!=null && byId[s.parentId]) ? s.parentId : null;
if(pid==null) roots.push(s);
else (children[pid] = children[pid] || []).push(s);
});
roots.sort((a,b)=>b.ts-a.ts);
Object.keys(children).forEach(k=>children[k].sort((a,b)=>a.ts-b.ts));
return {roots, children};
}
window.openSaves = ()=>{ renderSaves(); };
function renderSaves(){
__backAction = ()=>showChat();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const label = CHAT.mode==="group" ? ("群聊·"+CHAT.members.length+"人") : CHAT.name;
titleEl.innerHTML = icon("save")+" 平行存档"; subEl.textContent = label + " · 多时间线快照";
const fmtT = (ts)=> new Date(ts).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
/* P1-5: 故事树渲染(树形缩进 + 连线, 旧存档无 parentId 按平铺显示) */
const tree = saveTree();
let rows = "";
const walk = (s, depth, conn)=>{
const n = (s.history||[]).length;
const last = (s.history||[]).filter(m=>m.role==="assistant").slice(-1)[0];
const prev = last ? esc(String(last.content||"").slice(0,60)) : "（空）";
const badge = s.parentId ? ` <span class="badge">分支</span>` : "";
rows += `<div class="snode" style="margin-left:${depth*20}px">`
+ (depth?`<div class="stree">${conn}</div>`:"")
+ `<div class="card save-card"><div class="save-name">${esc(s.name||"未命名存档")}${badge}</div>`
+ `<div class="meta">${fmtT(s.ts)} · ${n} 条消息</div>`
+ `<div class="save-prev">${prev}</div>`
+ `<div class="btnrow" style="margin-top:8px">`
+ `<button class="btn" onclick="loadSaveSlot(${jq(s.id)})">${icon("download")} 加载</button>`
+ `<button class="btn ghost" onclick="renameSaveSlot(${jq(s.id)})">改名</button>`
+ `<button class="btn danger" onclick="delSaveSlot(${jq(s.id)})">删除</button>`
+ `</div></div></div>`;
(tree.children[s.id]||[]).forEach((c,i,arr)=>walk(c, depth+1, i===arr.length-1?"└─":"├─"));
};
tree.roots.forEach(s=>walk(s, 0, ""));
view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回</button>
<div class="btnrow" style="margin-bottom:10px"><button class="btn" onclick="newSaveSlot()">＋ 新建存档</button></div>
<div class="hint">加载某个存档后, 新建的存档会从它分出一条分支, 形成故事树。</div>`
+ (rows ? `<div class="timeline">` + rows + `</div>` : `<div class="empty"><span class="big">${icon("save",44)}</span>还没有存档<br><span style="font-size:calc(12px * var(--fs))">在关键剧情点存个档，就能随时回到这条时间线，或从这里分出新的平行剧情</span></div>`)
+ `<div style="height:40px"></div>`;
window.scrollTo(0,0);
}
/* Tier2 #11: 本聊摘要框 (Janitor "Enter a summary for your chat. This will be included into the prompt as long-term memory.")。
 * 按聊天存, important 池最高优先级 (排在铁律之前), 1000 字。 */
window.chatsumCount = ()=>{
const ta = document.getElementById("chatsum_box"), c = document.getElementById("chatsum_cnt");
if(ta && c) c.textContent = ta.value.length + "/" + RP_MEM.CHATSUM_MAX;
};
window.saveChatSumUI = ()=>{
const ta = document.getElementById("chatsum_box");
if(!ta) return;
const r = RP_MEM.saveChatSummary(DETAIL.runId, DETAIL.name, ta.value);
chatsumCount();
alert(r.truncated ? "已保存（超 1000 字部分已截断）" : "本聊摘要已保存，每次对话会最先注入");
};
window.taCount = (taId, cntId, max)=>{
const ta = document.getElementById(taId), c = document.getElementById(cntId);
if(ta && c) c.textContent = ta.value.length + "/" + max;
};
window.ironlawCount = ()=>{
const ta = document.getElementById("ironlaw_box"), c = document.getElementById("ironlaw_cnt");
if(ta && c) c.textContent = ta.value.length + "/2000";
};
window.saveIronLawUI = ()=>{
const ta = document.getElementById("ironlaw_box");
const v = ta ? ta.value : "";
const card = RP.findCard(DETAIL.runId, DETAIL.name) || {};
const r = RP_MEM.saveIronLaw(DETAIL.runId, DETAIL.name, card.id || null, v);
ironlawCount();
alert(r.truncated ? "已保存（超 2000 字部分已截断）" : "铁律记忆已保存，对话时会永远最先注入");
};
/* Tier2 #15: 单聊选项 (concise 简洁回复开关), 按聊天存 */
const chatOptKey = (runId, name)=> `nd_chatopt_${runId}_${name}`;
const getChatOpt = (runId, name)=>{
try{ return Object.assign({concise:false}, JSON.parse(localStorage.getItem(chatOptKey(runId, name))||"{}")); }
catch(e){ return {concise:false}; }
};
const saveChatOpt = (runId, name, o)=>{
try{ localStorage.setItem(chatOptKey(runId, name), JSON.stringify(o||{})); }catch(e){}
};
window.saveConciseUI = ()=>{
const sw = document.getElementById("concise_sw");
if(!sw) return;
const o = getChatOpt(DETAIL.runId, DETAIL.name);
o.concise = !!sw.checked;
saveChatOpt(DETAIL.runId, DETAIL.name, o);
alert(sw.checked ? "简洁回复已开启" : "简洁回复已关闭");
};
/* Tier2 #9: 带复选框的确认弹窗 (C.AI "Copy facts and Story Memory to new chat" 风格)。
 * 返回 Promise: 勾选状态 true/false, 取消/点遮罩返回 null */
window.confirmCheck = (title, bodyHtml, checkLabel, okLabel)=>{
return new Promise((resolve)=>{
const ov = document.createElement("div");
ov.className = "cfcheck";
ov.innerHTML = `<div class="cfbox"><div class="cfttl">${esc(title)}</div><div class="cfbody">${bodyHtml}</div>`
+ `<label class="cfrow"><input type="checkbox" id="cfcheck_box" checked> ${esc(checkLabel)}</label>`
+ `<div class="cfbtns"><button class="btn ghost" id="cfcheck_cancel">取消</button>`
+ `<button class="btn" id="cfcheck_ok">${esc(okLabel||"确定")}</button></div></div>`;
document.body.appendChild(ov);
const done = (v)=>{ ov.remove(); resolve(v); };
ov.querySelector("#cfcheck_cancel").onclick = ()=>done(null);
ov.onclick = (e)=>{ if(e.target === ov) done(null); };
ov.querySelector("#cfcheck_ok").onclick = ()=>done(!!ov.querySelector("#cfcheck_box").checked);
});
};

/* S-11: 双复选框确认框 (开新聊天: 带走记忆 + 同时清除长期记忆) */
window.confirmCheck2 = (title, bodyHtml, labels, okLabel)=>{
return new Promise((resolve)=>{
const ov = document.createElement("div");
ov.className = "cfcheck";
ov.innerHTML = `<div class="cfbox"><div class="cfttl">${esc(title)}</div><div class="cfbody">${bodyHtml}</div>`
+ labels.map((l,i)=>`<label class="cfrow"><input type="checkbox" class="cfcheck2_box" data-i="${i}"${i===0?" checked":""}> ${esc(l)}</label>`).join("")
+ `<div class="cfbtns"><button class="btn ghost" id="cfcheck2_cancel">取消</button>`
+ `<button class="btn" id="cfcheck2_ok">${esc(okLabel||"确定")}</button></div></div>`;
document.body.appendChild(ov);
const done = (v)=>{ ov.remove(); resolve(v); };
ov.querySelector("#cfcheck2_cancel").onclick = ()=>done(null);
ov.onclick = (e)=>{ if(e.target === ov) done(null); };
ov.querySelector("#cfcheck2_ok").onclick = ()=>{
const boxes = ov.querySelectorAll(".cfcheck2_box");
done(Array.prototype.map.call(boxes, b=>!!b.checked));
};
});
};

/* P2-43：App 内统一弹窗组件。
 * 不用原生 alert()/confirm()/prompt()：系统弹窗样式不可控、和深墨鎏金语言割裂、
 * 在 Android WebView 里还会被系统主题染成浅色。这里复用已有的 .cfcheck/.cfbox
 * 遮罩弹窗（confirmCheck 同一套 DOM 与 CSS），只补三种调用形态。
 *   uiMessage(title, html)          -> Promise<void>          只读说明（长文自动滚动）
 *   uiConfirm(title, html, okLabel) -> Promise<boolean|null>  取消/遮罩/Esc = null
 *   uiPrompt(title, html, value, o) -> Promise<string|null>   取消 = null（空串是合法输入）
 * bodyHtml 走 HTML（要支持 <br> 与链接），调用方自己 esc。 */
function cfDialog(title, bodyHtml, footHtml, opts){
  opts = opts || {};
  /* 同一时刻只允许一个弹窗：并发调用（连点两个按钮、脚本批量触发）会把弹窗叠成三层，
     Esc 却只关最上面那层。屏幕上看到的是最新那个意图，所以先强制关掉旧的（按取消结算），
     再开新的 —— 保住最新意图，也保证 DOM 里永远只有一个 .cfcheck。 */
  const prev = document.querySelector(".cfcheck");
  if(prev && typeof prev.__forceClose === "function") prev.__forceClose();
  const ov = document.createElement("div");
  ov.className = "cfcheck";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.innerHTML = `<div class="cfbox"><div class="cfttl">${esc(title)}</div>`
    + `<div class="cfbody${opts.scroll ? " scroll" : ""}">${bodyHtml}</div>`
    + `<div class="cfbtns">${footHtml}</div></div>`;
  document.body.appendChild(ov);
  const done = (v)=>{
    if(ov.__closed) return;          /* 遮罩与 Esc 可能同时触发，只结算一次 */
    ov.__closed = true;
    ov.remove();
    try{ document.removeEventListener("keydown", onKey, true); }catch(e){}
    if(opts.onClose) opts.onClose(v);
  };
  ov.__forceClose = ()=>done();
  const onKey = (e)=>{ if(e.key === "Escape") done(); };
  try{ document.addEventListener("keydown", onKey, true); }catch(e){}
  ov.onclick = (e)=>{ if(e.target === ov) done(); };
  return { ov: ov, done: done };
}
window.uiMessage = (title, bodyHtml)=> new Promise((resolve)=>{
  const d = cfDialog(title, bodyHtml,
    `<button class="btn" id="cfmsg_ok">知道了</button>`,
    { scroll:true, onClose: ()=>resolve() });
  d.ov.querySelector("#cfmsg_ok").onclick = ()=>d.done();
});
window.uiConfirm = (title, bodyHtml, okLabel)=> new Promise((resolve)=>{
  const d = cfDialog(title, bodyHtml,
    `<button class="btn ghost" id="cfy_no">取消</button>`
    + `<button class="btn" id="cfy_yes">${esc(okLabel||"确定")}</button>`,
    /* 结算值一律走 done(v)：取消/Esc/遮罩/被后来的弹窗顶掉都是无参 done() → null，
       确认走 done(true)。不要在 onclick 里再补一次 resolve —— done() 内部的
       onClose 已经先结算，后面那次会被静默丢弃，确认键就变成了"取消"。 */
    { scroll:true, onClose: (v)=>resolve(v === undefined ? null : v) });
  d.ov.querySelector("#cfy_no").onclick = ()=>d.done();
  d.ov.querySelector("#cfy_yes").onclick = ()=>d.done(true);
});
window.uiPrompt = (title, bodyHtml, value, opts)=> new Promise((resolve)=>{
  opts = opts || {};
  const ph = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : "";
  const ml = !!opts.multiline;
  const d = cfDialog(title, bodyHtml
    + `<${ml ? "textarea" : "input"} class="cfinput" id="cfp_in"${ph}${ml ? ` rows="${opts.rows||5}"` : ""}>`
    + `${ml ? esc(value == null ? "" : String(value)) : ""}</${ml ? "textarea" : "input"}>`,
    `<button class="btn ghost" id="cfp_no">取消</button>`
    + `<button class="btn" id="cfp_yes">${esc(opts.okLabel||"确定")}</button>`,
    { scroll:true, onClose: (v)=>resolve(v === undefined ? null : v) });
  const inp = d.ov.querySelector("#cfp_in");
  if(!ml) inp.value = value == null ? "" : String(value);
  const ok = ()=>d.done(inp.value);      /* 空串是合法输入，照原样回传 */
  d.ov.querySelector("#cfp_no").onclick = ()=>d.done();
  d.ov.querySelector("#cfp_yes").onclick = ok;
  /* 单行输入走回车提交，多行输入留给换行 —— 和聊天输入框的直觉一致 */
  if(!ml) inp.addEventListener("keydown", (e)=>{ if(e.key === "Enter"){ e.preventDefault(); ok(); } });
  try{ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }catch(e){}
});
/* Tier2 #9: 开新聊天 — 同一角色开新会话, 可选带走 Pin 与记忆。
 * 先自动备份当前聊天为存档, 再清空历史+记忆(可选恢复记忆快照), 空历史触发开场白。 */
window.newChatSameRole = async ()=>{
if(CHAT.mode !== "single") return;
/* S-11 (对标 Kindroid chat_break wipe_cascaded): 开新聊天可选同时清除长期记忆 */
const r = await confirmCheck2("开新聊天",
`和 <b>${esc(CHAT.name)}</b> 开启一段新的聊天？<br>当前聊天会自动备份为一条存档。`,
["带走 Pin 与记忆", "同时清除长期记忆"], "开新聊天");
if(r === null) return;
const ok = r[0], wipeMem = r[1];
const k = chatHistKey();
const def = new Date().toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const ss = getSaves();
let _bkHist = null;
try{ _bkHist = getHist(k); }catch(e){ rpToast("聊天记录读取失败，备份已中止"); return; }
const slot = {id: Date.now(), name: "自动备份 " + def, ts: Date.now(),
parentId: getBranchSrc()[k] || null,
history: _bkHist,
mem: RP_MEM.get(CHAT.runId, CHAT.name),
plot: getPlot()};
ss.push(slot);
try{ localStorage.setItem(savesKey(), JSON.stringify(ss)); }
catch(e){ alert("自动备份失败，请先手动新建存档"); return; }
let memSnap = null;
if(ok && !wipeMem){
const st = RP_MEM.get(CHAT.runId, CHAT.name) || {};
memSnap = {pinned: ((st.short||[]).filter(m=>m&&m.pin)),
profile3: st.profile3, event3: st.event3, record3: st.record3, mood: st.mood, migrated3: st.migrated3};
}
saveHist(k, []);
RP_MEM.clear(CHAT.runId, CHAT.name);
if(ok && !wipeMem && memSnap){
const st2 = RP_MEM.get(CHAT.runId, CHAT.name) || {};
st2.short = (memSnap.pinned||[]).slice();
st2.profile3 = memSnap.profile3; st2.event3 = memSnap.event3; st2.record3 = memSnap.record3;
st2.mood = memSnap.mood; st2.migrated3 = memSnap.migrated3;
st2.up_to = 0; st2.up_to_msg_id = null; st2.watermark = null;
RP_MEM.save(CHAT.runId, CHAT.name, st2);
}
setBranchSrc(k, slot.id);
LAST_STATS = null;
showChat();
};

window.newSaveSlot = async ()=>{
const def = new Date().toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const name = prompt("存档名称", "存档 " + def);
if(name === null) return;
/* Tier2 #9: 存档时可选是否带走 Pin 与记忆 (C.AI "Copy facts and Story Memory to new chat") */
const carry = CHAT.mode === "single" ? await confirmCheck("新建存档",
"是否把当前的记忆快照一起存入存档？<br>加载该存档时会恢复这些记忆。",
"带走 Pin 与记忆", "保存存档") : null;
if(CHAT.mode === "single" && carry === null) return;
const k = chatHistKey();
const ss = getSaves();
const id = Date.now();
let _svHist = null;
try{ _svHist = getHist(k); }catch(e){ rpToast("聊天记录读取失败，存档已中止"); return; }
const slot = {id: id, name: (name||"").trim() || ("存档"+(ss.length+1)), ts: Date.now(),
parentId: getBranchSrc()[k] || null, /* P1-5: 记录分支来源 */
history: _svHist,
mem: (CHAT.mode==="single" && carry) ? RP_MEM.get(CHAT.runId, CHAT.name) : null,
plot: getPlot()};
ss.push(slot);
try{ localStorage.setItem(savesKey(), JSON.stringify(ss)); }
catch(e){ alert("存档失败：存储空间不足，试试删除旧存档"); return; }
setBranchSrc(k, id); /* 新存档成为当前分支位置, 下次存档继续从这里分叉 */
achvUnlock("save_1");
if(slot.parentId) achvUnlock("branch_1");
renderSaves();
};
window.loadSaveSlot = (id)=>{
const s = getSaves().find(x=>x.id==id);
if(!s) return;
if(!confirm(`加载「${s.name}」？\n当前聊天记录会被替换。建议先新建存档备份当前进度。`)) return;
const k = chatHistKey();
saveHist(k, s.history || []);
if(CHAT.mode==="single" && s.mem) RP_MEM.save(CHAT.runId, CHAT.name, s.mem);
try{ savePlot(s.plot === undefined ? null : s.plot); }catch(e){}
LAST_STATS = null;
setBranchSrc(k, s.id); /* P1-5: 加载后, 后续存档从这里分叉 */
showChat();
};
/* ============ Tier3-21: 长按 Rewind 回溯分支（对标 Talkie Rewind）============
 * 回溯到第 idx 条消息：之后的消息移入一个新分支存档（复用平行存档/分支机制，
 * parentId 链向当前分支源），当前聊天只保留到 idx。
 * 双上限（抄 Talkie 文案，中文化）：单次最多 20 条；仅支持近 7 天消息。 */
const REWIND_MAX = 20, REWIND_DAYS = 7;
function rewindCheck(h, idx){
const tail = h.length - (idx + 1);
if(tail > REWIND_MAX) return {ok:false, code:"count", max:REWIND_MAX};
const m = h[idx];
const ts = m && m.ts;
if(ts && Date.now() - ts > REWIND_DAYS * 86400 * 1000)
return {ok:false, code:"age", days:REWIND_DAYS};
return {ok:true};
}
/* S-12 回溯点吸附 (对标 Kindroid rewind_messages): 单聊按"轮"回溯, 吸附到最近一条用户消息 */
function snapRewindIdx(h, idx){
let j = idx;
while(j > 0 && h[j] && h[j].role !== "user") j--;
return (h[j] && h[j].role === "user") ? j : idx;
}
window.rewindMsg = (idx)=>{
const k = chatHistKey();
let h = null;
try{ h = getHist(k); }catch(e){ rpToast("聊天记录读取失败"); return; }
const m = h[idx]; if(!m) return;
if(CHAT.mode === "single") idx = snapRewindIdx(h, idx);
const chk = rewindCheck(h, idx);
if(!chk.ok){
if(chk.code === "count")
alert("单次最多只能回溯 " + chk.max + " 条消息。\n请选择更靠后的消息再回溯。");
else
alert("目前仅支持回溯近 " + chk.days + " 天内的消息。");
return;
}
const tail = h.slice(idx + 1);
if(!tail.length){ alert("这条已经是最后一条消息，没有可回溯的内容。"); return; }
if(!confirm("回溯到这条消息？\n之后 " + tail.length + " 条消息将移入新分支，当前聊天只保留到这里。")) return;
const ss = getSaves();
const id = Date.now();
const nm = new Date().toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const slot = {id: id, name: "回溯分支·" + nm, ts: Date.now(),
parentId: getBranchSrc()[k] || null, /* 复用平行存档分支机制：链向当前分支源 */
history: tail,
mem: CHAT.mode === "single" ? RP_MEM.get(CHAT.runId, CHAT.name) : null,
plot: getPlot()};
ss.push(slot);
try{ localStorage.setItem(savesKey(), JSON.stringify(ss)); }
catch(e){ alert("存档失败：存储空间不足，试试删除旧存档"); return; }
saveHist(k, h.slice(0, idx + 1));
setBranchSrc(k, id);
if(slot.parentId) achvUnlock("branch_1");
alert("已回溯：之后 " + tail.length + " 条消息已移入新分支「" + slot.name + "」，可在「平行存档」里查看或加载。");
try{ renderChat(); }catch(e){}
};
window.renameSaveSlot = (id)=>{
const ss = getSaves();
const s = ss.find(x=>x.id==id);
if(!s) return;
const name = prompt("存档名称", s.name||"");
if(name === null) return;
s.name = (name||"").trim() || s.name;
localStorage.setItem(savesKey(), JSON.stringify(ss));
renderSaves();
};
window.delSaveSlot = (id)=>{
const s = getSaves().find(x=>x.id==id);
if(!confirm(`删除存档「${s?s.name:""}」？`)) return;
localStorage.setItem(savesKey(), JSON.stringify(getSaves().filter(x=>x.id!=id)));
/* P1-5: 删掉的是当前分支源 -> 清掉, 避免新存档挂到悬空节点 */
const k = chatHistKey();
if(getBranchSrc()[k]==id){ const m = getBranchSrc(); delete m[k]; try{localStorage.setItem(BRANCH_KEY, JSON.stringify(m));}catch(e){} }
renderSaves();
};
/* ============ Persona: 全局用户人设 + 按聊天覆盖 ============ */
window.personaEditor = (scope, from)=>{
const isOverride = !!scope;
const p = (isOverride ? RP_PERSONA.getOverride(scope) : RP_PERSONA.getGlobal()) || {name:"", desc:"", extra:"", called:""};
__backAction = ()=>{ from==="settings" ? showSettings() : showChat(); };
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.innerHTML = icon("user")+" 我的人设";
subEl.textContent = isOverride ? "仅本次聊天生效（覆盖全局人设）" : "全局生效：以后所有聊天都会告诉 AI 你是谁";
view.innerHTML = `<button class="back" onclick="__backAction()">${icon("back")} 返回</button>
<div class="field"><label>称呼 / 名字${RP_AIFILL.btn("p_name","玩家名字","2~4个字的名字或昵称","RP 应用的玩家人设")}</label>
<input id="p_name" placeholder="希望 AI 怎么称呼你" value="${esc(p.name||"")}" oninput="tokCount(['p_name','p_called','p_desc','p_extra'],'p_tok')"></div>
<div class="field"><label>TA 怎么称呼我${RP_AIFILL.btn("p_called","AI 对玩家的专属称呼","如：主人、小可爱、林先生，2~6个字","RP 应用的玩家人设")}</label>
<input id="p_called" placeholder="如：主人、小可爱、林先生（TA 对你的专属称呼）" value="${esc(p.called||"")}" oninput="tokCount(['p_name','p_called','p_desc','p_extra'],'p_tok')"></div>
<div class="field"><label>自我描述${RP_AIFILL.btn("p_desc","玩家自我描述","年龄、职业、性格、说话习惯，2~4句话，第一人称","RP 应用的玩家人设")}</label>
<textarea id="p_desc" rows="4" placeholder="年龄、职业、性格、说话习惯……" oninput="tokCount(['p_name','p_called','p_desc','p_extra'],'p_tok')">${esc(p.desc||"")}</textarea></div>
<div class="field"><label>补充说明（可选）${RP_AIFILL.btn("p_extra","玩家补充偏好","希望 AI 记住的偏好、和角色的关系设定，2~3句话","RP 应用的玩家人设")}</label>
<textarea id="p_extra" rows="3" placeholder="希望 AI 记住的偏好、你们的关系设定……" oninput="tokCount(['p_name','p_called','p_desc','p_extra'],'p_tok')">${esc(p.extra||"")}</textarea></div>
<div class="tokline" id="p_tok"></div>
<div class="btnrow"><button class="btn" onclick="savePersonaUI(${isOverride?`'${jq(scope)}`:"null"},'${jq(from)}')">保存</button>
<button class="btn ghost" onclick="importStPersona()">导入 ST 人设</button>
<button class="btn ghost" onclick="exportStPersonaUI()">导出 ST 人设</button>
${isOverride && RP_PERSONA.getOverride(scope) ? `<button class="btn ghost" onclick="RP_PERSONA.saveOverride('${jq(scope)}',null);__backAction()">清除本次覆盖</button>` : ""}
</div>
<div class="hint">保存后，人设会以【玩家人设】段注入每轮 prompt，紧跟在角色身份说明之后。</div>
<div style="height:40px"></div>`;
tokCount(['p_name','p_called','p_desc','p_extra'],'p_tok');
window.scrollTo(0,0);
};
window.savePersonaUI = (scope, from)=>{
const p = {name: document.getElementById("p_name").value.trim(),
           called: document.getElementById("p_called").value.trim(),
           desc: document.getElementById("p_desc").value.trim(),
           extra: document.getElementById("p_extra").value.trim()};
if(scope) RP_PERSONA.saveOverride(scope, p); else RP_PERSONA.saveGlobal(p);
__backAction();
};
/* ST 人设导入: 解析后填入表单(不自动保存), 点保存生效; 批量文件取第一个并提示 */
window.importStPersona = ()=>{
const inp = document.createElement("input");
inp.type = "file"; inp.accept = ".json,application/json";
inp.onchange = ()=>{
const f = inp.files[0]; if(!f) return;
const rd = new FileReader();
rd.onload = ()=>{
try{
const arr = RP_PERSONA.stPersonaParse(JSON.parse(rd.result));
const p0 = arr[0];
document.getElementById("p_name").value = p0.name;
document.getElementById("p_called").value = p0.called;
document.getElementById("p_desc").value = p0.desc;
document.getElementById("p_extra").value = p0.extra;
tokCount(["p_name","p_called","p_desc","p_extra"], "p_tok");
rpToast(arr.length > 1 ? `共 ${arr.length} 个人设，已填入「${p0.name}」，点保存生效` : `已填入人设「${p0.name}」，点保存生效`);
}catch(e){ alert("解析失败: " + e.message); }
};
rd.readAsText(f);
};
inp.click();
};
/* ST 人设导出: 读当前表单, {name, description, title, called, avatar} */
window.exportStPersonaUI = ()=>{
const g = (id)=>{ const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const p = {name: g("p_name"), called: g("p_called"), desc: g("p_desc"), extra: g("p_extra")};
if(!p.name && !p.desc && !p.extra && !p.called){ rpToast("人设为空，先填写再导出"); return; }
downloadJson("persona_st.json", RP_PERSONA.stPersonaExport(p));
rpToast("已导出 ST 人设");
};
/* ============ 角色卡 PNG 导出 + 分享 ============ */
window.exportCard = async (id)=>{
const c = RP_WRITER.findCustom(id);
if(!c) return;
try{
const r = await RP_CARDEXPORT.exportAndShare(c);
if(r.shared){ alert("已调起系统分享"); return; }
__backAction = ()=>showWriter();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
titleEl.textContent = "角色卡 PNG"; subEl.textContent = c.name;
view.innerHTML = `<button class="back" onclick="showWriter()">${icon("back")} 返回</button>
<div class="card" style="text-align:center"><img src="${r.dataUrl}" style="max-width:100%;border-radius:8px" alt="角色卡"></div>
<div class="btnrow"><button class="btn" onclick="copyText(document.getElementById('cardjson').value);alert('卡片 JSON 已复制')">复制卡片 JSON</button></div>
<textarea id="cardjson" style="display:none">${esc(r.json)}</textarea>
<div class="hint">PNG 内已嵌入 Tavern v2 卡数据，可直接导入 SillyTavern。</div>
<div style="height:40px"></div>`;
window.scrollTo(0,0);
}catch(e){ alert("导出失败：" + (e && e.message || e)); }
};
/* ============ 角色详情多 Tab (对标 C.AI 角色详情页: 资料/记忆/最近聊天) ============ */
let DETAIL = {runId:null, name:null, tab:"info", back:null};
window.charDetail = (runId, name, back)=>{
DETAIL = {runId:runId, name:name, tab:"info", back:(back||null)};
renderDetail();
};
/* 游玩数据收藏/点赞开关（卡片详情落地页数据条用） */
window.toggleFavUI = ()=>{ try{ RP_STATS.toggleFav(DETAIL.runId, DETAIL.name); }catch(e){} renderDetail(); };
window.toggleLikeUI = ()=>{ try{ RP_STATS.toggleLike(DETAIL.runId, DETAIL.name); }catch(e){} renderDetail(); };
/* ---- 卡片详情落地页（P0）：徽章/数据条/CTA/简介/规格/开场/玩法说明/标签/档案 ----
 * 学电子姬AI 的 share 页结构，全部数据来自本地卡片 + 本地统计，不编造。 */
function cardOpenings(runId, name){
  let card = null;
  try{ card = (typeof RP !== "undefined" && RP.findCard) ? RP.findCard(runId, name) : null; }catch(e){}
  const out = [];
  const push = (t, label)=>{
    t = String(t == null ? "" : t).trim();
    if(t && !out.some(o=>o.text === t)) out.push({text: t, label: String(label || "")});
  };
  if(card){
    const g0 = (card.greeting && String(card.greeting).trim()) || "";
    if(g0) push(g0, "");
    (card.altGreetings || []).forEach(g=>push(g, ""));
  }
  /* 2026-10-07: 管线 openings.json (蒸馏产物, 带情境标签), 卡片开场之后追加 */
  try{
    var run = (window.__DATA__ && window.__DATA__.runs || {})[runId] || {};
    var pops = (run.openings || {})[name] || [];
    pops.forEach(function(p){
      push(p && (p.text || p), p && p.situation);
    });
  }catch(e){}
  return out.slice(0, 12);
}
function cardSettingChars(card){
  let n = 0;
  try{
    const f = card.fields || {};
    Object.keys(f).forEach(k=>{
      const v = f[k];
      if(typeof v === "string") n += v.length;
      else if(Array.isArray(v)) v.forEach(x=>{ n += String(x).length; });
    });
  }catch(e){}
  return n;
}
/* P1 徽章体系：id → 名称 + 说明（移动端点徽章看说明，即 tooltip） */
const BADGE_DEFS = {
  official: {label:"官方", desc:"浮生内置角色，由小说蒸馏管线从原著提炼，不是网上搬来的"},
  custom: {label:"自创", desc:"你在「写卡」页亲手创建的角色"},
  imported: {label:"导入", desc:"从 SillyTavern 标准角色卡导入，原汁原味"},
  multiop: {label:"多开场", desc:"自带多个开场白，开局前可以挑一个喜欢的进"},
  longset: {label:"长篇设定", desc:"人设档案超过 3000 字，细节丰富，不容易聊崩"},
  regular: {label:"常玩", desc:"你已经和 TA 开过 5 局以上，是老搭档了"},
};
function badgeLabel(id){ return (BADGE_DEFS[id] || {}).label || id; }
/* 通用轻提示 toast（徽章说明等） */
let TIP_TOAST_TIMER = null;
function tipToast(html){
  let el = document.getElementById("tipToast");
  if(!el){ el = document.createElement("div"); el.id = "tipToast"; el.className = "achv-toast"; document.body.appendChild(el); }
  el.innerHTML = html;
  el.classList.add("show");
  if(TIP_TOAST_TIMER) clearTimeout(TIP_TOAST_TIMER);
  TIP_TOAST_TIMER = setTimeout(()=>el.classList.remove("show"), 2600);
}
window.badgeTip = (id)=>{
  const d = BADGE_DEFS[id]; if(!d) return;
  tipToast(`<b>${esc(d.label)}</b><br><span class="dim">${esc(d.desc)}</span>`);
};
function cardBadges(runId, card, openings, settingChars, st){
  const b = [];
  const runs = (window.__DATA__ && window.__DATA__.runs) || {};
  if(runs[runId]) b.push("official");
  if(runId === "custom") b.push("custom");
  if(runId === "imported") b.push("imported");
  if(openings.length > 1) b.push("multiop");
  if(settingChars >= 3000) b.push("longset");
  if(st && st.s >= 5) b.push("regular");
  return b.slice(0, 4);
}
function cardTags(card){
  const out = [];
  const push = t=>{
    t = String(t == null ? "" : t).trim();
    if(!t || out.indexOf(t) >= 0 || out.length >= 12) return;
    if(!isChipTag(t)) return;
    out.push(t);
  };
  try{
    if(card.novel) push(card.novel);
    const rt = (card.fields && card.fields.role_tags) || "";
    String(rt).split(/[；;、,，]/).forEach(push);
    if(card.raw && Array.isArray(card.raw.tags)) card.raw.tags.forEach(push);
  }catch(e){}
  return out;
}
/* 分类 chips 只收"身份式"短标签：过滤剧情描述长句（多为原文剧透，如"被宋江赐死…"） */
function isChipTag(t){
  if(t.length > 6) return false;
  if(/[。！？]$/.test(t)) return false;
  return true;
}
/* 用指定开场白开聊：清掉当前历史，进聊天时首条 AI 消息用该开场 */
window.chatWithOpening = (runId, name, idx)=>{
  try{
    saveHist(chatKey(runId, name), []);
    window.__pendingOpening = idx;
  }catch(e){ window.__pendingOpening = idx; }
  startChat(runId, name);
};
/* P1 开场选择器半屏：列出开场 + 随机开场 */
/* P0-15：原来只能点遮罩或直接挑一个开场，取消路径等于没有。
   补三样：顶部「取消」行、把把手做成可点、Esc 关闭。
   Esc 处理器只挂一次（openSheet 会被反复调用），靠 sheet 的 .on 判活。 */
window.__opensheetEsc = (e)=>{
  if(e.key !== "Escape") return;
  const sh = document.getElementById("opensheet");
  if(sh && sh.classList.contains("on")) openSheet(false);
};
try{
  if(document && typeof document.addEventListener === "function" && !window.__opensheetEscBound){
    window.__opensheetEscBound = true;
    document.addEventListener("keydown", window.__opensheetEsc);
  }
}catch(e){}
window.openSheet = (on, runId, name)=>{
let sh = document.getElementById("opensheet");
let sc = document.getElementById("openscrim");
if(!on){ if(sh) sh.classList.remove("on"); if(sc) sc.classList.remove("on"); return; }
const ops = cardOpenings(runId, name);
if(!sh){
sc = document.createElement("div"); sc.id = "openscrim"; sc.className = "scrim msscrim";
sc.onclick = ()=>openSheet(false);
document.body.appendChild(sc);
sh = document.createElement("div"); sh.id = "opensheet"; sh.className = "msgsheet";
sh.setAttribute("role","dialog"); sh.setAttribute("aria-modal","true");
sh.setAttribute("aria-label","选择开场");
document.body.appendChild(sh);
}
/* 把手也可点：点它 = 取消（原来它只是 4px 装饰条，用户看得出能拖却拖不动） */
const hd = sh.querySelector(".mshandle");
if(hd) hd.addEventListener("click", ()=>openSheet(false));
const nums = ["一","二","三","四","五","六","七","八"];
/* P0-15：面板内容。取消行放最上面（拇指可达），Esc 处理器见 __opensheetEsc。 */
sh.innerHTML = `<button class="msitem mscancel" onclick="openSheet(false)" aria-label="关闭开场选择">取消</button>`
+ `<div class="mshandle" role="separator" aria-hidden="true"></div><div class="msprev">选个开场，和 ${esc(name)} 开聊</div>`
+ ops.map((g, i)=>{
const prev = g.text.length > 64 ? g.text.slice(0, 64) + "…" : g.text;
const lab = g.label || ("开场" + (nums[i] || (i+1)));
return `<button class="msitem opitem" onclick="pickOpening('${jq(runId)}','${jq(name)}',${jq(i)})"><span class="opn">${esc(lab)}</span><span class="opp">${esc(prev)}</span></button>`;
}).join("")
+ `<button class="msitem" onclick="pickOpening('${jq(runId)}','${jq(name)}',-1)">随机开场</button>`;
sc.classList.add("on"); sh.classList.add("on");
/* 焦点进面板，Esc / Tab 都有落点 */
setTimeout(()=>{ const c=sh.querySelector(".mscancel"); if(c) c.focus(); }, 60);
};
window.pickOpening = (runId, name, idx)=>{
openSheet(false);
if(idx < 0){
const n = cardOpenings(runId, name).length;
idx = n ? Math.floor(Math.random() * n) : 0;
}
chatWithOpening(runId, name, idx);
};
function cardLandingHTML(runId, nm, card, run){
  const openings = cardOpenings(runId, nm);
  const settingChars = cardSettingChars(card);
  let st = null;
  try{ st = (typeof RP_STATS !== "undefined") ? RP_STATS.get(runId, nm) : null; }catch(e){}
  /* RP_STATS 缺失时的展示兜底（脚本加载顺序异常也不崩） */
  const SF = (typeof RP_STATS !== "undefined" && RP_STATS.fmt) ? RP_STATS.fmt : (n=>String(Math.round(n || 0)));
  const avgOf = (s)=>{ try{ return RP_STATS.avgTurns(s); }catch(e){ return 0; } };
  const badges = cardBadges(runId, card, openings, settingChars, st);
  let memN = 0;
  try{ const mst = (typeof RP_MEM !== "undefined") ? RP_MEM.get(runId, nm) : null; memN = (mst && mst.short ? mst.short.length : 0); }catch(e){}
  const novel = run.novel || card.novel || "";
  const brief = String((card.fields || {}).core_identity || "").split("\n")[0] || "";
  const tags = cardTags(card);
  let h = "";
  /* 1. 封面头：头像 + 名字 + 出处 + 徽章 */
  const _cimg = card.img || card.avatar || "";
  h += `<div class="card char-hero">`
    + (_cimg
      ? `<img class="char-hero-avatar" src="${esc(_cimg)}" alt="${esc(nm)}的画像" loading="lazy" onerror="this.src='bg/avatar_default.jpg'">`
      : `<img class="char-hero-avatar" src="bg/avatar_default.jpg" alt="" aria-hidden="true">`)
    + `<div class="char-hero-name">${esc(nm)}</div>`
    + (novel ? `<div class="kv char-hero-novel">${esc(novel)}</div>` : "")
    + (badges.length ? `<div class="char-hero-badges">` + badges.map(b=>`<span class="tagchip clickable" onclick="badgeTip('${b}')">${esc(badgeLabel(b))}</span>`).join("") + `</div>` : "")
    + `</div>`;
  /* 2. 数据条（有数据才显示） */
  if(st && (st.s || st.t || st.fav || st.like)){
    const avg = avgOf(st), tot = st.pi + st.po;
    h += `<div class="card"><div class="kv stat-line">开局 ${st.s} 次 · 共 ${st.t} 轮 · 平均 ${avg.toFixed(1)} 轮/局</div>`
      + `<div class="kv stat-line stat-line-sub">累计消耗约 ${SF(tot)} tokens <span class="stat-faint">(输入约${SF(st.pi)} / 输出约${SF(st.po)})</span></div>`
      + `<div class="btnrow stat-acts">`
      + `<button class="btn" onclick="toggleFavUI()">${st.fav ? "⭐ 已收藏" : "☆ 收藏"}</button>`
      + `<button class="btn" onclick="toggleLikeUI()">${st.like ? "👍 已点赞" : "👍 点赞"}</button>`
      + `</div></div>`;
  }
  /* 3. 简介 */
  if(brief) h += `<h2 class="sec">简介</h2><div class="card"><div class="card-brief">${esc(brief)}</div></div>`;
  /* 4. 规格网格 */
  const avgW = (st && st.s) ? (st.t / st.s).toFixed(0) + "轮/局" : "—";
  h += `<h2 class="sec">规格</h2><div class="specgrid">`
    + `<div class="spec"><div class="v">${openings.length ? openings.length + "个" : "AI生成"}</div><div class="k">开场</div></div>`
    + `<div class="spec"><div class="v">${settingChars ? "约" + SF(settingChars) + "字" : "—"}</div><div class="k">设定</div></div>`
    + `<div class="spec"><div class="v">${memN}条</div><div class="k">记忆</div></div>`
    + `<div class="spec"><div class="v">${avgW}</div><div class="k">平均轮数</div></div>`
    + `</div>`;
  /* 5. 开场列表 */
  if(openings.length){
    h += `<h2 class="sec">开场 · ${openings.length} 个</h2>`;
    h += openings.map((g, i)=>{
      /* cardOpenings() 返回 {text,label} 对象(P1 开场标签), 不是字符串。
         原来这里当字符串用 g.length/g.slice, 结果整页渲染成 [object Object]。 */
      const txt = String((g && g.text) || "");
      const prev = txt.length > 72 ? txt.slice(0, 72) + "…" : txt;
      return `<div class="card card--tap" onclick="chatWithOpening('${jq(runId)}','${jq(nm)}',${jq(i)})">`
        + `<div class="kv">开场${["一","二","三","四","五","六","七","八"][i] || (i+1)}</div>`
        + `<div class="opn-text">${esc(prev)}</div>`
        + `<div class="opn-go">用这个开场开聊 ›</div></div>`;
    }).join("");
  } else {
    h += `<div class="hint hint-tight">这张卡没有固定开场白，开聊后 AI 会根据人设现场生成开场。</div>`;
  }
  /* 6. 玩法说明（由本地数据自动生成，不编造）。P1-19：说明性文字默认折起来，
     详情页首屏要留给「这人是谁 / 怎么开聊」，不是三段使用手册。 */
  h += `<details class="card"><summary class="t">玩法说明</summary>`
    + `<div class="kvline"><b>怎么开始</b>：点"立即开始游玩"${openings.length ? "，或挑一个开场进入" : ""}——${esc(nm)}会先和你打招呼，之后你说一句、它回一句。</div>`
    + `<div class="kvline"><b>它记得什么</b>：${memN ? "已经有 " + memN + " 条记忆，聊过的关键事不会忘" : "聊天中提到的关键信息会自动记下来，越聊越记得你们的事"}。</div>`
    + `<div class="kvline"><b>小贴士</b>：想换走向直接说；某句不满意可以重抽；重要的设定可以写进世界书长期生效。</div>`
    + `</details>`;
  /* 7. 标签 */
  if(tags.length) h += `<h2 class="sec">标签</h2><div class="tagrow">` + tags.map(t=>`<span class="tagchip">${esc(t)}</span>`).join("") + `</div>`;
  /* B7 卡片档案入口: 聚合页(worldbook/多开场/卡面字段/示例对话/标签/AI 补完标注),
     外加一份「蒸馏产物 · 导入卡天然没有」的缺席说明。蒸馏卡也能进, 只是那节会说明
     六大产物页在 run 侧、这里只看卡自带的东西。 */
  h += `<div class="btnrow" style="margin-top:8px"><button class="btn ghost" onclick="openCardArchive('${jq(runId)}','${jq(nm)}')">📁 卡片档案</button>`
    + `<button class="btn ghost srcbtn" onclick="viewCardSource('${jq(runId)}','${jq(nm)}')">📖 查看设定源码（只读学习）</button></div>`;
  /* 8. 档案（原有字段分组） */
  const groups = [["identity","身份"],["core","内核"],["speech","说话方式"],["background","背景"]];
  const arch = groups.map(g=>{
    const txt = RP_PROMPT.renderFields(card, RP_PROMPT.LAYERS[g[0]]);
    return txt ? `<h2 class="sec">${g[1]}</h2><div class="card">`
      + txt.split("\n").map(l=>`<div class="kvline">${esc(l)}</div>`).join("") + `</div>` : "";
  }).join("");
  if(arch) h += `<h2 class="sec">档案</h2>` + arch.replace(/<h2 class="sec">[^<]*<\/h2>/g, "");
  /* 9. CTA（P1-19：原先顶部、底部各渲染一次巨型胶囊，把近 1/4 屏高吃掉，
     而这一页真正能做的动作只有一个。收成 sticky 底部单条，随滚动常驻。） */
  h += `<div class="ctadock"><button class="btn landcta" onclick="chatWith('${jq(runId)}','${jq(nm)}')">▶ 立即开始游玩</button></div>`;
  return h;
}
/* ============ B7 卡片档案聚合页 ============
 * 蒸馏剧本的六大产物页(人物/大纲/关系/剧情线/世界/更多)全部挂在 openRun() 之后的 RUN 上,
 * 导入卡没有 RUN.__DATA__.runs["imported"] 恒为 undefined, 所以那一整排 tab 结构上不可达。
 * 退一步把 openRun 分流到 charDetail 只是换个入口, 产品上仍然是"导入卡看不到自己的资料"。
 *
 * 这里做的是真的聚合: 把这张卡自带的东西(worldbook 条目 / 多开场白 / 示例对话 /
 * 场景·系统提示 / 标签 / aiFilled 标注)汇进一个可浏览面板, 世界书那节复用现成的
 * loreRowsHTML(与 renderLoreList 同款渲染器), 开场白那节复用 cardOpenings。
 *
 * 铁律: 只渲染卡上真实有的字段。蒸馏产物(profiles / sections / outline_md / 静态关系 /
 * 伏笔 / 冲突 / 判词脂批)导入卡天然没有, 这里逐条给 honest 空态 —— 说清"这是什么、
 * 为什么没有、可以怎么补", 绝不拿别处的数据凑数, 也不编一条静态关系出来。
 */
const ARC_PROD = [
  ["人物档案 profiles", "导入卡只带一个角色自己的设定，没有同书其他角色的档案表。"],
  ["分段大纲 sections", "ST 卡不含分段大纲。导入时若有大纲正文，会出现在下面的「场景 · 系统提示」里。"],
  ["静态人物关系 relations", "ST 卡没有关系表。群聊时可以在「角色关系」里手写；单聊里聊天满 6 轮后，AI 抽取的动态关系会自动积累到「关系管理」。"],
  ["剧情线 event_dag", "因果事件 DAG 是蒸馏管线的产物，导入卡没有。卡片自带的 worldbook 条目已经列在下面。"],
  ["世界卡 worldcard", "世界卡只随蒸馏剧本生成，导入卡没有。卡片自带的世界书（若有）就是这里全部的世界设定。"],
  ["伏笔 / 冲突 / 修正", "伏笔、冲突点、反 OOC 纠错都是管线产物，导入卡没有。"],
  ["判词 / 脂批 / 方法论", "红楼专属的呈现层，导入卡没有。"],
];
window.archiveBack = ()=>{
  __backAction = null;
  try{ document.body.classList.remove("chatmode","immersive"); }catch(e){}
  renderDetail();
};
/* 世界书条目行: 与 renderLoreList 用同一套 normLore + 行样式, 不另写一份渲染器 */
function loreRowsHTML(arr){
  if(!arr.length) return "";
  return arr.map((e,i)=>{
    const n = normLore(e,i);
    return `<div class="card"><div class="row"><div style="flex:1">
<div class="name">${esc(n.name||"无标题")} ${n.constant?'<span class="badge warn">常驻</span>':""} ${!n.enabled?'<span class="badge">停用</span>':""}</div>
<div class="meta">触发词：${esc((n.key||[]).join("、")||"无")} · P${n.priority} · 约 ${RP_PROMPT.estTokens(n.content||"")} tok</div>
</div></div>${n.content?`<div class="kvline">${esc(String(n.content).slice(0,220))}${String(n.content).length>220?"…":""}</div>`:""}</div>`;
  }).join("");
}
window.openCardArchive = (runId, nm)=>{
  const card = fullCardOf(runId, nm);
  __backAction = ()=>archiveBack();
  try{ document.body.classList.remove("chatmode","immersive"); }catch(e){}
  titleEl.textContent = (nm || "角色") + " · 卡片档案";
  subEl.textContent = "导入卡与自创卡自带的全部资料";
  if(!card){
    view.innerHTML = `<button class="back" onclick="archiveBack()">${icon("back")} 返回</button>
<div class="empty">找不到这张卡<br><span style="font-size:calc(12px * var(--fs))">它可能已被删除。</span></div>`;
    window.scrollTo(0,0);
    return;
  }
  const f = card.fields || {};
  let h = `<button class="back" onclick="archiveBack()">${icon("back")} 返回</button>`;

  /* 1. 设定正文: 复用 RP_PROMPT.renderFields + LAYERS(与落地页「档案」同一套渲染器) */
  const groups = [["identity","身份"],["core","内核"],["speech","说话方式"],["background","背景"]];
  const arch = groups.map(g=>{
    const txt = RP_PROMPT.renderFields(card, RP_PROMPT.LAYERS[g[0]]);
    return txt ? `<h2 class="sec">${g[1]}</h2><div class="card">`
      + txt.split("\n").map(l=>`<div class="kvline">${esc(l)}</div>`).join("") + `</div>` : "";
  }).join("");
  h += arch ? `<h2 class="sec">角色字段</h2>` + arch.replace(/<h2 class="sec">[^<]*<\/h2>/g, "")
           : `<div class="empty">这张卡没有填角色字段<br><span style="font-size:calc(12px * var(--fs))">去卡片编辑器补上，prompt 立刻就能用。</span>
<br><button class="btn" style="margin-top:10px" onclick="editCard('${jq(runId === "imported" ? "imported" : "custom")}','${jq(card.id || "")}')">去编辑器</button></div>`;

  /* 2. 世界书: 卡自带条目(只读) + 本机自建条目(走现成的 loreEditor 渲染与编辑) */
  const wb = Array.isArray(card.worldbook) ? card.worldbook : [];
  h += `<h2 class="sec">世界书 · ${wb.length} 条（卡片自带）</h2>`;
  h += wb.length ? loreRowsHTML(wb)
    : `<div class="empty">这张卡没有自带世界书<br><span style="font-size:calc(12px * var(--fs))">ST 卡只有携带 character_book 才会带。想要世界设定，去聊天抽屉 → 世界书管理自己写。</span></div>`;
  const mine = getLore(runId, nm);
  h += `<h2 class="sec">我写的世界书 · ${mine.length} 条</h2>`;
  h += mine.length ? loreRowsHTML(mine)
    : `<div class="empty">还没写条目<br><span style="font-size:calc(12px * var(--fs))">自建条目和卡片自带的世界书一起参与关键词触发。</span></div>`;
  h += `<button class="btn ghost" style="margin-top:8px" onclick="loreEditor('${jq(runId)}')">打开世界书管理</button>`;

  /* 3. 开场白: 复用 cardOpenings(与落地页同一份抽取逻辑) */
  const ops = cardOpenings(runId, nm);
  h += `<h2 class="sec">开场白 · ${ops.length} 个</h2>`;
  h += ops.length ? ops.map((g,i)=>{
    const txt = String((g && g.text) || "");
    const prev = txt.length > 90 ? txt.slice(0,90)+"…" : txt;
    return `<div class="card card--tap" onclick="chatWithOpening('${jq(runId)}','${jq(nm)}',${jq(i)})">`
      + `<div class="kv">${g && g.label ? esc(g.label) : "开场"+(["一","二","三","四","五","六","七","八"][i]||(i+1))}</div>`
      + `<div class="opn-text">${esc(prev)}</div><div class="opn-go">用这个开场开聊 ›</div></div>`;
  }).join("") : `<div class="empty">这张卡没有固定开场白<br><span style="font-size:calc(12px * var(--fs))">开聊后 AI 会根据人设现场生成。</span></div>`;

  /* 4. ST 一等字段 */
  const st = [["scenario","场景设定"],["systemPrompt","系统提示词"],
              ["postHistoryInstructions","历史后指令"],["creatorNotes","作者注"],
              ["depthPrompt","深度提示"],["creator","作者"]];
  const stRows = st.filter(x=>String((card[x[0]]||"")).trim())
    .map(x=>`<div class="kvline"><b>${x[1]}</b>：${esc(String(card[x[0]]).slice(0,300))}</div>`).join("");
  h += `<h2 class="sec">卡面字段</h2>`;
  h += stRows ? `<div class="card">${stRows}</div>`
    : `<div class="empty">这张卡没有额外的卡面字段<br><span style="font-size:calc(12px * var(--fs))">都是可选的，去卡片编辑器补。</span></div>`;

  /* 5. 示例对话 */
  h += `<h2 class="sec">示例对话</h2>`;
  h += String(card.exampleDialogue||"").trim()
    ? `<div class="card md">${md(card.exampleDialogue)}</div>`
    : `<div class="empty">没有示例对话<br><span style="font-size:calc(12px * var(--fs))">补几条 few-shot，角色口吻会稳很多。</span></div>`;

  /* 6. 标签 */
  const tags = cardTags(card);
  h += `<h2 class="sec">标签</h2>`;
  h += tags.length ? `<div class="tagrow">`+tags.map(t=>`<span class="tagchip">${esc(t)}</span>`).join("")+`</div>`
    : `<div class="empty">暂无标签</div>`;

  /* 7. AI 补完标注: 告诉用户哪些字段是模型补的, 不是原卡自带 */
  const af = card.aiFilled && typeof card.aiFilled === "object" ? card.aiFilled : {};
  const afKeys = Object.keys(af).filter(k=>af[k]);
  h += `<h2 class="sec">AI 补完</h2>`;
  h += afKeys.length
    ? `<div class="card"><div class="hint" style="margin:0 0 6px">这些字段是 AI 基于卡片原文推断补上的，原卡没有，请自行核对：</div>`
      + afKeys.map(k=>`<div class="kvline">${esc(RP_PROMPT.LABELS[k]||k)} <span class="dim">${esc(k)}</span> <span class="badge">AI 补完</span></div>`).join("")
      + `</div>`
    : `<div class="empty">这张卡没有任何 AI 补完字段<br><span style="font-size:calc(12px * var(--fs))">导入时可点「AI 补完缺失层」，补完的内容会在这里列出。</span></div>`;

  /* 8. 蒸馏产物缺席清单: 逐条解释为什么没有 + 怎么补 —— 这是聚合页存在的意义 */
  h += `<h2 class="sec">蒸馏产物 · 导入卡天然没有</h2>`
    + `<div class="card"><div class="hint" style="margin:0 0 8px">下面这些是蒸馏管线产物，导入卡不带。列出来是为了说明"为什么这里看不到"，不是占位。</div>`
    + ARC_PROD.map(x=>`<div class="kvline"><b>${x[0]}</b>：${esc(x[1])}</div>`).join("")
    + `</div>`;

  h += `<div style="height:76px"></div>`;
  view.innerHTML = h;
  window.scrollTo(0,0);
};

/* 取卡片全量对象（RP.findCard 对导入/自创卡会裁剪字段，只读视图/导出用全量） */
function fullCardOf(runId, name){
try{
if(runId === "imported" && typeof RP_CARDIMPORT !== "undefined"){
const c = RP_CARDIMPORT.find(name); if(c) return c;
}
if(runId === "custom" && typeof RP_WRITER !== "undefined"){
const c = RP_WRITER.findCustom(name); if(c) return c;
}
}catch(e){}
return (typeof RP !== "undefined" && RP.findCard) ? RP.findCard(runId, name) : null;
}
/* P2 开源卡：只读设定视图（对照学习，不可编辑） */
window.viewCardSource = (runId, name)=>{
__backAction = ()=>charDetail(runId, name);
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const card = fullCardOf(runId, name);
titleEl.innerHTML = icon("books") + " 设定源码"; subEl.textContent = name + " · 只读";
if(!card){
view.innerHTML = `<button class="back" onclick="charDetail('${jq(runId)}','${jq(name)}')">${icon("back")} 返回</button><div class="empty">找不到这张卡</div>`;
return;
}
const f = card.fields || {};
const fkeys = Object.keys(f);
const wb = card.worldbook || [];
const line = (k, v)=>`<div class="kvline"><b>${esc(k)}</b>：${esc(String(v == null ? "" : v))}</div>`;
let h = `<button class="back" onclick="charDetail('${jq(runId)}','${jq(name)}')">${icon("back")} 返回</button>`
+ `<div class="hint" style="margin:2px 0 10px">开源卡：设定对所有人只读开放，可对照学习写卡思路，不可在此编辑。</div>`
+ `<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">基本信息</div>`
+ line("名字", card.name) + line("出处", card.novel || runId)
+ (card.creator ? line("作者", card.creator) : "")
+ (card.characterVersion ? line("版本", card.characterVersion) : "")
+ line("字段数", fkeys.length) + line("世界书", wb.length + " 条") + `</div>`;
const ops = cardOpenings(runId, name);
if(ops.length){
h += `<h2 class="sec">开场白 · ${ops.length}</h2><div class="card">`
+ ops.map((g, i)=>`<div class="kvline"><b>${esc(g.label || ("开场" + (["一","二","三","四","五","六","七","八"][i] || (i+1))))}</b>：${esc(g.text)}</div>`).join("") + `</div>`;
}
if(fkeys.length){
h += `<h2 class="sec">人设字段 · ${fkeys.length}</h2><div class="card">`
+ fkeys.map(k=>line(k, Array.isArray(f[k]) ? f[k].join(" / ") : f[k])).join("") + `</div>`;
}
if(wb.length){
h += `<h2 class="sec">世界书 · ${wb.length}</h2><div class="card">`
+ wb.slice(0, 20).map(w=>`<div class="kvline"><b>${esc(w.name || w.key || "条目")}</b> <span class="kv">${esc(String(w.keys || w.keywords || "").toString().slice(0, 60))}</span></div>`).join("")
+ (wb.length > 20 ? `<div class="kv">…还有 ${wb.length - 20} 条</div>` : "") + `</div>`;
}
h += `<div class="btnrow" style="margin-top:12px"><button class="btn" onclick="copyCardJson('${jq(runId)}','${jq(name)}')">复制设定 JSON</button></div><div style="height:40px"></div>`;
view.innerHTML = h;
window.scrollTo(0, 0);
};
window.copyCardJson = (runId, name)=>{
const card = fullCardOf(runId, name);
if(!card) return;
const clean = {name: card.name, novel: card.novel, fields: card.fields || {},
greeting: card.greeting || "", altGreetings: card.altGreetings || [],
scenario: card.scenario || "", tags: (card.raw && card.raw.tags) || []};
copyText(JSON.stringify(clean, null, 2), "设定 JSON 已复制");
};
function detailBack(){
if(DETAIL.back === "picker") setNav("chat");
else if(typeof DETAIL.back === "function") DETAIL.back();
else if(CHAT.name) showChat();
else setNav("chat");
}
window.charTab = (t)=>{ DETAIL.tab = t; renderDetail(); };
window.detailOpenAlbum = ()=>{ openAlbum(DETAIL.runId, DETAIL.name, ()=>renderDetail()); };
function renderDetail(){
const runId = DETAIL.runId, nm = DETAIL.name;
__backAction = ()=>detailBack();
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const card = RP.findCard(runId, nm) || {name:nm, fields:{}};
const run = ((window.__DATA__||{}).runs||{})[runId] || {};
titleEl.innerHTML = icon("user")+" "+esc(nm); subEl.textContent = run.novel || "";
const tabs = [["info","资料"],["memory","记忆"],["chat","最近聊天"],["arc","人物弧光"],["soul","灵魂包"]];
let body = "";
if(DETAIL.tab === "info"){
/* P0 卡片详情落地页：徽章/数据条/CTA/简介/规格/开场/玩法说明/标签/档案 */
body = cardLandingHTML(runId, nm, card, run) || `<div class="empty">还没有资料，多聊几句就会有了</div>`;
} else if(DETAIL.tab === "memory"){
const st = RP_MEM.get(runId, nm);
const n = (st && st.short && st.short.length) || 0;
/* P0-2: 铁律记忆框 (400 字常驻, 进 important 池最高优先级) */
const _dc = RP.findCard(runId, nm) || {};
const _iron = RP_MEM.getIronLaw(runId, nm, _dc.id || null);
/* Tier2 #11: 本聊摘要框 — 和铁律卡并列 */
const _chatsum = RP_MEM.getChatSummary(runId, nm);
/* Tier2 #15: 简洁回复开关 (Janitor "Snappier, more concise replies.") */
const _copt = getChatOpt(runId, nm);
body = `<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">铁律记忆 · 永远最先注入${RP_AIFILL.btn("ironlaw_box","对"+nm+"的铁律","3~5条硬性要求，一条一行，如：绝不在人前提起穿越者的身份；对黛玉永远温柔","角色扮演：约束 AI 扮演 "+nm+" 时必须遵守的铁律")}</div>`
+ `<div class="meta">不用等它自己学会的重要事实：对${esc(nm)}的硬性要求（如绝不做的事、必须遵守的设定），2000 字以内，每次对话必带，立即可用</div>`
+ `<div class="field" style="margin:8px 0 0"><textarea id="ironlaw_box" rows="4" maxlength="2000" placeholder="如：绝不在人前提起穿越者的身份；对黛玉永远温柔…" oninput="ironlawCount()">${esc(_iron)}</textarea></div>`
+ `<div class="btnrow"><span class="kv" id="ironlaw_cnt">${_iron.length}/2000</span><span style="flex:1"></span><button class="btn" onclick="saveIronLawUI()">保存铁律</button></div></div>`
+ `<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">本聊摘要 · 手写长期记忆${RP_AIFILL.btn("chatsum_box","和"+nm+"的聊天摘要","2~3句话概括你和这个角色的当前关系与共同经历", "角色 "+nm+"；最近对话：\n"+RP_AIFILL._recentChatCtx(8,"nd_chat_"+runId+"_"+nm))}</div>`
+ `<div class="meta">一句话概括这段聊天（1000 字以内），每次对话会最先注入，作为长期记忆</div>`
+ `<div class="field" style="margin:8px 0 0"><textarea id="chatsum_box" rows="3" maxlength="1000" placeholder="如：我们是青梅竹马，正在一起调查家族旧事…" oninput="chatsumCount()">${esc(_chatsum)}</textarea></div>`
+ `<div class="btnrow"><span class="kv" id="chatsum_cnt">${_chatsum.length}/1000</span><span style="flex:1"></span><button class="btn" onclick="saveChatSumUI()">保存摘要</button></div></div>`
+ `<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">回复风格</div>`
+ `<div class="field"><label><input id="concise_sw" type="checkbox" style="width:auto" ${_copt.concise?"checked":""}> 简洁回复（Snappier：回答简短精炼，节奏轻快；关掉则回复更长）</label></div>`
+ `<div class="btnrow"><button class="btn" onclick="saveConciseUI()">保存</button></div></div>`
+ `<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">${st&&st.mood&&st.mood.state?esc(st.mood.state):"还没有心境记录"}</div>`
+ `<div class="meta">${n} 条近期记忆${st&&st.long?" · 有长远印象":""}</div>`
+ `<div class="btnrow" style="margin-top:8px"><button class="btn" onclick="detailOpenAlbum()">${icon("books")} 打开记忆事件簿</button></div></div>`;
} else if(DETAIL.tab === "arc"){
body = renderArcBody(runId, nm, card);
} else if(DETAIL.tab === "soul"){
body = (typeof RP_SOUL_CFG !== "undefined") ? RP_SOUL_CFG.soulViewHTML(card, runId, nm) : "<div class=\"empty\">Soul 模块未加载</div>";
} else {
const h = getHistSafe(`nd_chat_${runId}_${nm}`).slice(-10);
body = (h.map(m=>{
const who = m.role==="user" ? "我" : nm;
return `<div class="card"><div class="kv">${esc(who)}</div><div style="font-size:calc(13px * var(--fs))">${esc(m.content.slice(0,120))}${m.content.length>120?"…":""}</div></div>`;
}).join("") || `<div class="empty">还没有聊天记录</div>`)
+ `<div class="btnrow" style="margin-top:12px"><button class="btn" onclick="chatWith('${jq(runId)}','${jq(nm)}')">${icon("chat")} 和${esc(nm)}开聊</button><button class="btn ghost" onclick="soulAnchors('${jq(runId)}','${jq(nm)}')">${icon("user")} 魂穿成${esc(nm)}</button></div>`;
}
view.innerHTML = `<button class="back" onclick="detailBack()">${icon("back")} 返回</button>
<div class="dtabs">` + tabs.map(t=>`<button class="dtab${DETAIL.tab===t[0]?" on":""}" onclick="charTab('${jq(t[0])}')">${t[1]}</button>`).join("") + `</div>
${body}<div style="height:40px"></div>`;
window.scrollTo(0,0);
}
/* ============ P0-3 人物弧光展示区 ============ */
function renderArcBody(runId, nm, card){
if(typeof RP_ARC === "undefined") return `<div class="empty">弧光模块未加载</div>`;
const s = RP_ARC.arcSummary(card, runId);
if(!s.type && !s.start && !s.mids.length && !s.end) return `<div class="empty">该角色暂无人物弧光资料</div>`;
const opts = [s.defaultStage].concat(RP_ARC.STAGES.filter(x=>x && x !== s.defaultStage));
const stageSel = `<div class="field" style="margin:0"><label>当前阶段（切换后按本卡记住）</label>`
+ `<select id="arcstage_sel" onchange="arcStageChange('${jq(runId)}','${jq(nm)}')">`
+ opts.map(o=>`<option value="${esc(o)}"${o===s.stage?" selected":""}>${esc(o)}</option>`).join("")
+ `</select></div>`;
const mids = s.mids.map((m,i)=>`<div class="kvline"><span class="kv">${i+1}.</span> ${esc(m)}</div>`).join("");
return `<div class="card"><div class="t">人物弧光 · ${esc(s.typeLabel || s.type || "")}${s.typeLabel ? "弧" : ""}</div>`
+ `<div class="meta">当前阶段：${esc(s.stage || "未定")}</div></div>`
+ `<div class="card">${stageSel}</div>`
+ (s.start ? `<h2 class="sec">起 · 开局</h2><div class="card"><div class="kvline">${esc(s.start)}</div></div>` : "")
+ (mids ? `<h2 class="sec">承转 · ${s.mids.length} 个转折</h2><div class="card">${mids}</div>` : "")
+ (s.end ? `<h2 class="sec">合 · 结局</h2><div class="card"><div class="kvline">${esc(s.end)}</div></div>` : "");
}
window.arcStageChange = (runId, nm)=>{
const sel = document.getElementById("arcstage_sel");
if(!sel || typeof RP_ARC === "undefined") return;
const card = (typeof RP !== "undefined" && RP.findCard(runId, nm)) || {name:nm, fields:{}};
RP_ARC.setStage(card, runId, sel.value);
renderDetail();
};
 /* 关系管理页：查看动态关系 + 锁定/解锁 */
 /* 关系静态层的 run 兜底 (B10): 导入卡/custom 没有真 run (__DATA__.runs 里没这个键),
    静态关系恒空。取不到真 run 时回落 Phase 2 的 RP.synthRunFor 合成 run (novel/worldbook/
    relations), 蒸馏 runId 一律走真 run, 原逻辑不变; RP 未加载时也保持原来的 run={}。 */
 function relRunFor(runId, name){
   var run = ((window.__DATA__||{}).runs||{})[runId] || null;
   if(run) return run;
   try{
     if(typeof RP!=="undefined" && typeof RP.synthRunFor==="function")
       return RP.synthRunFor(runId, name) || {};
   }catch(e){}
   return {};
 }
 /* 非蒸馏 run(导入卡/自创卡)又没有静态关系时的空态: 说清"为什么空"和"怎么变出来" */
 function relEmptyText(runId){
   if((((window.__DATA__||{}).runs||{})[runId])) return "暂无关系数据";
   return "本卡没有蒸馏出的静态关系：聊天中 AI 会自动抽取人物关系并积累到这里，锁定后 AI 不会再改动。";
 }
 window.showRelManager = ()=>{
   var runId = CHAT.runId, name = CHAT.name;
   var run = relRunFor(runId, name);
   var rels = (typeof AGENT_RELATIONS !== "undefined")
     ? AGENT_RELATIONS.merged(runId, run.relations, name) : (run.relations || []);
   var myRels = rels.filter(function(r){
     return r.source_character === name || r.target_character === name;
   });
   var v = document.getElementById("view");
   var html = `<h2 class="sec">🔗 关系管理</h2>
     <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:12px">聊天中关系会自动演变，锁定的关系 AI 不会再动</div>`;
   if(!myRels.length) html += `<div class="card"><div style="font-size:calc(13px * var(--fs));color:var(--ink-faint)">${esc(relEmptyText(runId))}</div></div>`;
  myRels.forEach(function(r){
    var other = r.source_character === name ? r.target_character : r.source_character;
    var locked = r._locked;
    var dyn = r._dynamic ? " <span style='font-size:calc(11px * var(--fs));color:#e8a13c'>动态</span>" : "";
    html += `<div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><b>${esc(other)}</b>${dyn}<br>
        <span style="font-size:calc(13px * var(--fs));color:var(--ink-faint)">${esc(r.relationship_summary || r.type || "")}</span></div>
        <button class="btn${locked ? " primary" : ""}" style="font-size:calc(12px * var(--fs));padding:4px 10px"
          onclick="AGENT_RELATIONS.setLock('${jq(runId)}','${jq(name)}','${jq(other)}',${!locked},'${jq(name)}');showRelManager();">
          ${locked ? "🔒 已锁定" : "🔓 锁定"}</button>
      </div></div>`;
  });
  html += `<button class="btn" onclick="showChat()">返回聊天</button>`;
  v.innerHTML = html;
};
/* 角色卡更新建议页 */
window.showCardEvo = ()=>{
  var runId = CHAT.runId, name = CHAT.name;
  var list = (typeof AGENT_CARDEVO !== "undefined") ? AGENT_CARDEVO.getSuggestions(runId, name) : [];
  var pending = list.filter(function(s){ return s.status === "pending"; });
  var v = document.getElementById("view");
  var html = `<h2 class="sec">📝 角色卡更新建议 (${pending.length} 待处理)</h2>
    <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:12px">AI 观察到角色在聊天中的持久变化，建议更新到卡上。每条都要你确认，不会自动改。</div>`;
  if(!pending.length) html += `<div class="card"><div style="font-size:calc(13px * var(--fs));color:var(--ink-faint)">暂无待处理建议。聊得久一点，AI 会发现角色的成长。</div></div>`;
  pending.forEach(function(s, i){
    var idx = list.indexOf(s);
    html += `<div class="card" style="margin-bottom:8px;padding:12px">
      <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">字段：${esc(s.field)}</div>
      <div style="font-size:calc(13px * var(--fs));margin:6px 0"><b>建议：</b>${esc(s.newVal)}</div>
      <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint)">理由：${esc(s.reason || "")}</div>
      <div class="btnrow" style="margin-top:8px">
        <button class="btn primary" style="font-size:calc(12px * var(--fs))" onclick="acceptCardEvo(${jq(idx)})">接受</button>
        <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="AGENT_CARDEVO.reject('${jq(runId)}','${jq(name)}',${idx});showCardEvo();">拒绝</button>
      </div></div>`;
  });
  html += `<button class="btn" onclick="showChat()">返回聊天</button>`;
  v.innerHTML = html;
};
window.acceptCardEvo = (idx)=>{
  var runId = CHAT.runId, name = CHAT.name;
  var s = AGENT_CARDEVO.accept(runId, name, idx);
  if(s && s.field){
    // 写入卡片 (localStorage 自定义卡或运行时)
    try{
      var ck = "nd_cardfield_" + runId + "_" + name + "_" + s.field;
      localStorage.setItem(ck, s.newVal);
    }catch(e){}
  }
  showCardEvo();
};
/* ===== 浮生小助手 UI (2026-10-07) ===== */
window.openAssistant = ()=>{
  if(document.getElementById("asst_win")) return;
  /* P0-3：抽屉原先只有自己一层，右侧 12px 亮缝直接露出底层页面，观感像错位。
     补一层遮罩压暗，抽屉才有"浮起来"的层次。 */
  var sc = document.createElement("div");
  sc.id = "asst_scrim";
  sc.onclick = function(){ closeAssistant(); };
  document.body.appendChild(sc);
  var w = document.createElement("div");
  w.id = "asst_win";
  w.setAttribute("role","dialog");
  w.setAttribute("aria-modal","true");
  w.setAttribute("aria-label","浮生小助手");
  w.innerHTML = `<div class="asst_head"><span>浮生小助手</span>
    <button class="btn ghost" style="padding:4px 10px" onclick="closeAssistant()"
      aria-label="关闭小助手">✕</button></div>
    <div class="asst_msgs" id="asst_msgs"></div>
    <div class="asst_chips" id="asst_chips"></div>
    <div class="asst_input">
      <input id="asst_in" placeholder="问我功能用法，或让我帮你创建东西…"
        onkeydown="if(event.key==='Enter')sendAssistant()">
      <button onclick="sendAssistant()">发送</button>
    </div>`;
  document.body.appendChild(w);
  renderAsstChips();
  asstSay("你好！我是浮生小助手。问我功能用法，或让我帮你创建角色/世界书。", false);
  setTimeout(function(){ var i = document.getElementById("asst_in"); if(i) i.focus(); }, 100);
};
window.closeAssistant = ()=>{
  var w = document.getElementById("asst_win"); if(w) w.remove();
  var s = document.getElementById("asst_scrim"); if(s) s.remove();
  var f = document.getElementById("asst_fab"); if(f){ f.style.pointerEvents = ""; }
};
/* Escape 关抽屉：guard 一下 document（部分内嵌环境/测试桩没有 addEventListener） */
try{
  if(document && typeof document.addEventListener === "function"){
    document.addEventListener("keydown", function(e){
      if(e.key === "Escape" && document.getElementById("asst_win")) closeAssistant();
    });
  }
}catch(e){}
function renderAsstChips(){
  var c = document.getElementById("asst_chips"); if(!c) return;
  c.innerHTML = ASSISTANT.chips().map(function(ch){
    return `<button class="asst_chip" onclick="asstChip('${jq(ch.text)}')">${esc(ch.label)}</button>`;
  }).join("");
}
window.asstChip = (text)=>{
  var i = document.getElementById("asst_in"); if(i) i.value = text;
  sendAssistant();
};
function asstSay(text, isUser){
  var box = document.getElementById("asst_msgs"); if(!box) return;
  var d = document.createElement("div");
  d.className = "asst_msg " + (isUser ? "user" : "ai");
  d.textContent = text;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}
window.sendAssistant = async ()=>{
  var inp = document.getElementById("asst_in"); if(!inp) return;
  var text = inp.value.trim(); if(!text) return;
  inp.value = "";
  asstSay(text, true);
  asstSay("想一想…", false);
  var cfg = (typeof getCfg !== "undefined") ? getCfg() : {};
  try{
    var r = await ASSISTANT.chat(text, cfg,
      function(c, ms, t){ return RP_NET.complete(c, ms, t); });
    // 移除 "想一想"
    var box = document.getElementById("asst_msgs");
    if(box && box.lastChild) box.removeChild(box.lastChild);
    asstSay(r.text, false);
  }catch(e){
    var box2 = document.getElementById("asst_msgs");
    if(box2 && box2.lastChild) box2.removeChild(box2.lastChild);
    asstSay("出错了：" + e.message, false);
  }
};
/* ===== 统一聊天设置面板 (2026-10-07, 借鉴 Marinara Chat Settings) =====
 * 单聊天的所有主要配置一处搞定：Agent 开关、生成参数、世界状态 */
window.showChatSettings = ()=>{
  var runId = CHAT.runId, name = CHAT.name;
  var chatId = (typeof chatKey !== "undefined") ? chatKey(runId, name) : (runId + "|" + name);
  var v = document.getElementById("view");

  // Agent 开关状态
  var lkOn = (typeof AGENT_LOREKEEPER !== "undefined") ? AGENT_LOREKEEPER.isEnabled() : true;
  var ctOn = (typeof AGENT_CONTINUITY !== "undefined") ? AGENT_CONTINUITY.isEnabled() : true;
  var ceOff = false;
  try{ ceOff = localStorage.getItem("nd_cardevo_off") === "1"; }catch(e){}
  var rdOff = false;
  try{ rdOff = localStorage.getItem("nd_reldyn_off") === "1"; }catch(e){}
  var pushMode = (typeof AGENT_PUSHSTORY !== "undefined") ? AGENT_PUSHSTORY.getMode(chatId) : null;

  // 生成参数 (per-chat)
  var tp = "", mt = "";
  try{
    tp = localStorage.getItem("nd_temp_" + chatId) || "";
    mt = localStorage.getItem("nd_maxtok_" + chatId) || "";
  }catch(e){}

  // 世界状态
  var wsHtml = "";
  try{
    if(typeof RP_WORLDSIM !== "undefined" && RP_WORLDSIM.enabled()){
      var st = RP_WORLDSIM.ensure(chatId, {novel: (((window.__DATA__||{}).runs||{})[runId]||{}).novel});
      var p = RP_WORLDSIM.curPlace(st);
      wsHtml = `<div class="card" style="margin-bottom:8px"><div style="font-weight:600;font-size:calc(13px * var(--fs));margin-bottom:8px">🌍 世界状态</div>
        <div style="font-size:calc(13px * var(--fs));margin-bottom:4px">时间：${esc(RP_WORLDSIM.fmtTime(st))}</div>
        <div style="font-size:calc(13px * var(--fs));margin-bottom:4px">天气：${esc(RP_WORLDSIM.weatherName(st.wx))} · 地点：${esc(p.name)}</div>
        ${(st.present && st.present.length) ? `<div style="font-size:calc(13px * var(--fs));margin-bottom:4px">在场：${esc(st.present.join("、"))}</div>` : ""}
        <div class="btnrow" style="margin-top:8px">
          <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="wsAdjustTimePrompt()">⏰ 调时间</button>
          <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="wsSetPlacePrompt()">📍 换地点</button>
        </div></div>`;
    }
  }catch(e){}

  var html = `<h2 class="sec">🎛️ 聊天设置</h2>
    <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:12px">本次聊天的专属配置，不影响其他聊天</div>

    <div class="card" style="margin-bottom:8px"><div style="font-weight:600;font-size:calc(13px * var(--fs));margin-bottom:8px">🤖 AI 助手</div>
      ${asstToggle("📚 Lorebook Keeper", "聊天自动提炼世界书", lkOn, "toggleLK")}
      ${asstToggle("🔍 Continuity Checker", "检查逻辑矛盾", ctOn, "toggleCT")}
      ${asstToggle("📝 角色卡审计", "建议角色成长更新", !ceOff, "toggleCE")}
      ${asstToggle("🔗 关系动态", "聊天中关系演变", !rdOff, "toggleRD")}
      ${typeof RP_SOUL_ORCH!=="undefined" ? asstToggle("👥 Soul 多智能体", "多角色并行独立回应", (function(){ try{ return localStorage.getItem("nd_soulmode_off_"+soulChatId())!=="1"; }catch(e){ return true; } })(), "toggleSoulMode") : ""}
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
        <div><div style="font-size:calc(13px * var(--fs))">🚀 Push Story</div>
        <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint)">${pushMode ? "已武装（" + (pushMode === "natural" ? "顺推" : "意外") + "），下条回复生效" : "一键推进剧情"}</div></div>
        <button class="btn" style="font-size:calc(12px * var(--fs));padding:4px 10px" onclick="togglePushStory(event);showChatSettings();">${pushMode ? "解除" : "武装"}</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:8px"><div style="font-weight:600;font-size:calc(13px * var(--fs));margin-bottom:8px">🎚️ 生成参数（本次聊天）</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="font-size:calc(13px * var(--fs))">温度</span>
        <input id="cs_temp" type="number" step="0.1" min="0" max="2" value="${esc(tp)}" placeholder="默认"
          style="width:80px;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:inherit">
        <span style="font-size:calc(13px * var(--fs))">最大token</span>
        <input id="cs_maxtok" type="number" step="100" min="100" value="${esc(mt)}" placeholder="默认"
          style="width:90px;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:inherit">
        <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="saveChatParams()">保存</button>
      </div>
      <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint)">留空用全局设置。温度越高越发散，0-2。</div>
    </div>

    ${typeof RP_SOUL_CFG!=="undefined" ? `<div class="card" style="margin-bottom:8px"><div style="font-weight:600;font-size:calc(13px * var(--fs));margin-bottom:8px">🔌 Soul 模型（本次聊天覆盖）</div>
      <div style="font-size:calc(12px * var(--fs));color:var(--ink-faint);margin-bottom:6px">覆盖角色卡上的绑定，仅本次聊天有效</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="cs_soul_profile" class="soulctl" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:inherit">
          <option value="">不覆盖（用角色绑定）</option>
          ${RP_SOUL_CFG.list().map(p=>`<option value="${esc(p.name)}" ${RP_SOUL_CFG.getChatOverride(chatId)===p.name?"selected":""}>${esc(p.name)} · ${esc(p.model||"")}</option>`).join("")}
        </select>
        <button class="btn soulctl" onclick="saveChatSoulProfile()">保存</button>
      </div></div>` : ""}

    ${wsHtml}

    ${typeof RP_SOUL_CFG!=="undefined" ? `<div id="soul_debug_wrap" style="margin-bottom:8px">${RP_SOUL_CFG.debugHTML()}</div>` : ""}
    ${typeof RP_SOUL_CFG!=="undefined" ? `<div id="soul_perf_wrap" style="margin-bottom:8px">${RP_SOUL_CFG.perfHTML()}${RP_SOUL_CFG.costHTML()}</div>` : ""}
    ${typeof RP_SOUL_CFG!=="undefined" ? `<div style="margin-bottom:8px">${RP_SOUL_CFG.fallbackHTML()}${RP_SOUL_CFG.promptPreviewHTML()}</div>` : ""}

    <div class="card" style="margin-bottom:8px"><div style="font-weight:600;font-size:calc(13px * var(--fs));margin-bottom:8px">🔗 快捷入口</div>
      <div class="btnrow">
        <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="showRelManager()">关系管理</button>
        <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="showCardEvo()">卡更新建议</button>
        <button class="btn" style="font-size:calc(12px * var(--fs))" onclick="loreEditor(CHAT.runId,'chat')">世界书</button>
      </div>
    </div>

    <button class="btn" onclick="showChat()">返回聊天</button>`;
  v.innerHTML = html;
};
function asstToggle(name, desc, on, fn){
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
    <div><div style="font-size:calc(13px * var(--fs))">${name}</div>
    <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint)">${desc}</div></div>
    <button class="btn${on ? " primary" : ""}" style="font-size:calc(12px * var(--fs));padding:4px 14px" onclick="${fn}();showChatSettings();">${on ? "开" : "关"}</button>
  </div>`;
}
window.toggleLK = ()=>{ AGENT_LOREKEEPER.setEnabled(!AGENT_LOREKEEPER.isEnabled()); };
window.toggleCT = ()=>{ AGENT_CONTINUITY.setEnabled(!AGENT_CONTINUITY.isEnabled()); };
window.toggleCE = ()=>{ AGENT_CARDEVO.setEnabled(localStorage.getItem("nd_cardevo_off") === "1"); };
window.toggleRD = ()=>{ AGENT_RELATIONS.setEnabled(localStorage.getItem("nd_reldyn_off") === "1"); };
/* Soul 开关的 chatId 必须与 chat.js sendGroup 里门禁用的 _sChatId 一致:
 * chatKey(runId, members.join(",")), 而不是 chatKey(runId, CHAT.name)
 * (群聊时 CHAT.name 为 null, 曾导致开关写错 key, 门禁永远读不到)。
 * 2026-10-13 修。 */
function soulChatId(){
  var nm = (CHAT.mode === "group" && CHAT.members && CHAT.members.length) ? CHAT.members.join(",") : CHAT.name;
  return (typeof chatKey !== "undefined") ? chatKey(CHAT.runId, nm) : (CHAT.runId + "|" + nm);
}
window.toggleSoulMode = ()=>{
  var chatId = soulChatId();
  try{
    var wasOff = localStorage.getItem("nd_soulmode_off_" + chatId) === "1";
    if(typeof RP_SOUL_ORCH !== "undefined") RP_SOUL_ORCH.setSoulMode(chatId, wasOff);
    if(wasOff && typeof RP_SOUL_CFG !== "undefined") RP_SOUL_CFG.maybeShowGuide(chatId);
  }catch(e){}
};
window.saveChatParams = ()=>{
  var chatId = soulChatId();
  var tp = document.getElementById("cs_temp").value, mt = document.getElementById("cs_maxtok").value;
  try{
    if(tp) localStorage.setItem("nd_temp_" + chatId, tp); else localStorage.removeItem("nd_temp_" + chatId);
    if(mt) localStorage.setItem("nd_maxtok_" + chatId, mt); else localStorage.removeItem("nd_maxtok_" + chatId);
  }catch(e){}
  alert("已保存");
};
window.saveChatSoulProfile = ()=>{
  var chatId = soulChatId();
  var v = document.getElementById("cs_soul_profile").value;
  try{
    if(typeof RP_SOUL_CFG !== "undefined") RP_SOUL_CFG.setChatOverride(chatId, v);
  }catch(e){}
  alert(v ? "已覆盖为「" + v + "」" : "已清除覆盖");
};
window.wsAdjustTimePrompt = ()=>{
  var m = prompt("推进多少分钟？（如 30）", "30");
  if(!m) return;
  var chatId = (typeof chatKey !== "undefined") ? chatKey(CHAT.runId, CHAT.name) : (CHAT.runId + "|" + CHAT.name);
  try{ RP_WORLDSIM.adjustTime(chatId, parseInt(m) || 0, {}); }catch(e){}
  showChatSettings();
};
window.wsSetPlacePrompt = ()=>{
  var p = prompt("去哪里？", "");
  if(!p) return;
  var chatId = (typeof chatKey !== "undefined") ? chatKey(CHAT.runId, CHAT.name) : (CHAT.runId + "|" + CHAT.name);
  try{ RP_WORLDSIM.moveTo(chatId, p, {}); }catch(e){}
  showChatSettings();
};
window.showSystem = ()=>{
if(!LAST_SYSTEM){ alert("先发一句话，引擎组装好人设 prompt 后这里才能预览。"); return; }
__backAction = ()=>showChat();
titleEl.textContent = "人设 prompt 预览"; subEl.textContent = CHAT.name||"";
view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回聊天</button>
<pre style="white-space:pre-wrap;font-size:calc(13px * var(--fs));background:#fff;border:1px solid #e5e0d8;border-radius:10px;padding:12px">${esc(LAST_SYSTEM)}</pre>`;
window.scrollTo(0,0);
};

/* ============ P0-5 Prompt 诊断 (简洁版: 分段条 + 列表, 非极客面板) ============ */
function recordLastPrompt(stats){
window.__LAST_PROMPT__ = {stats: stats || null,
hasWorldsim: !!(stats && stats.hasWorldsim), hasDirector: !!(stats && stats.hasDirector),
memPools: (stats && stats.memPools) || null};
}
const DIAG_SEG_LABELS = {identity:"身份", persona:"玩家人设", narrator:"叙事者模式", core:"核心人设",
memory:"长期记忆", speech:"说话方式", examples:"对话示例", background:"背景", relations:"人物关系", lore:"世界书"};
const DIAG_POOL_LABELS = {important:"重要池（铁律/置顶/画像库/心境）", recent:"近期池（事件库）", similar:"长远池（记录库/往事）"};
/* 人设保真行 (Persistent Personas? 方法论落地): 只展示机制状态, 不编造偏离度分数。
 * 铁律/弧光 = 本轮 prompt 是否真实注入了对应段; 末尾纠偏恒为 ✓ (prompt 末位 system 必有);
 * 二遍对齐 = 上次对齐距今轮数与是否改动 (localStorage 记录, 如实呈现)。 */
const ppaFidelityText = ()=>{
try{
let key = null;
if(CHAT.mode === "group") key = groupKey(CHAT.runId, CHAT.members||[]);
else if(CHAT.mode === "traverse") key = "nd_travchat_" + CHAT.travId;
else key = chatKey(CHAT.runId, CHAT.name);
const raw = (typeof RP_PPA !== "undefined") ? RP_PPA.lastAlign(key) : null;
if(!raw) return "未运行";
const cur = getHistSafe(chatHistKey()).length;
const n = Math.max(0, cur - (raw.len||0));
return (n === 0 ? "本轮" : n + " 轮前") + (raw.changed ? " · 已修正" : " · 无修改");
}catch(e){ return "未运行"; }
};
window.promptDiag = ()=>{
const lp = window.__LAST_PROMPT__;
if(!lp || !lp.stats){ alert("先发一句话，引擎组装好 prompt 后这里才能诊断。"); return; }
const s = lp.stats;
const sysPct = Math.min(100, (s.sysTokens || 0) / Math.max(1, s.avail || 1) * 100);
const histPct = Math.min(100, (s.histTokens || 0) / Math.max(1, s.avail || 1) * 100);
const segRows = Object.keys(s.segTokens || {}).map(k=>
`<div class="storow"><span>${DIAG_SEG_LABELS[k] || k}</span><span>${s.segTokens[k]} tok</span></div>`).join("");
const poolRows = Object.keys(lp.memPools || {}).filter(k=>k in DIAG_POOL_LABELS).map(k=>{
const p = lp.memPools[k];
return `<div class="storow"><span>${DIAG_POOL_LABELS[k] || k}</span><span>${p.tokens} tok · ${p.items} 条${p.dropped ? ` · 丢弃 ${p.dropped}` : ""}${p.source ? ` · ${p.source}` : ""}${p.adjudicated ? ` · 冲突已消解${p.adjudReason ? "(" + esc(p.adjudReason) + ")" : ""}` : ""}</span></div>`;
}).join("");
const dropped = (s.droppedSegs || []).map(k=>DIAG_SEG_LABELS[k] || k).join("、");
const sysPreview = String(window.LAST_SYSTEM || "");
const fidelityRows =
`<div class="storow"><span>铁律注入</span><span>${sysPreview.indexOf("【铁律记忆】")>=0?"✓ 已注入":"✗ 未注入"}</span></div>`+
`<div class="storow"><span>人物弧光注入</span><span>${sysPreview.indexOf("【人物弧光】")>=0?"✓ 已注入":"✗ 未注入"}</span></div>`+
`<div class="storow"><span>末尾纠偏指令</span><span>✓ 常驻</span></div>`+
`<div class="storow"><span>二遍对齐 PPA</span><span>${ppaFidelityText()}</span></div>`;
__backAction = ()=>showChat();
titleEl.innerHTML = icon("chart") + " Prompt 诊断"; subEl.textContent = CHAT.name || "";
view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回聊天</button>
<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">预设：${esc(s.preset || "")}</div>
<div class="meta">上下文 ${s.maxCtx ?? "—"} · 可用预算 ${s.avail ?? "—"} tokens</div>
<div class="storbar"><div class="storbar-fg" style="width:${sysPct.toFixed(1)}%"></div></div>
<div class="storow"><span>系统段（含人设/记忆/世界书）</span><span>${s.sysTokens} tok</span></div>
<div class="storow"><span>聊天历史（保留 ${s.histKept ?? "—"} 条）</span><span>${s.histTokens ?? "—"} tok${s.histDropped ? ` · 丢弃最早 ${s.histDropped} 条` : ""}</span></div></div>
<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">各段 token</div>${segRows || '<div class="empty">无</div>'}</div>
<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">记忆三池</div>${poolRows || '<div class="empty">本轮未注入记忆</div>'}
<div class="storow"><span>世界模拟注入</span><span>${lp.hasWorldsim ? "有" : "无"}</span></div>
<div class="storow"><span>导演指令注入</span><span>${lp.hasDirector ? "有" : "无"}</span></div></div>
<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">人设保真</div>${fidelityRows}</div>
<div class="card"><div class="name" style="font-size:calc(14px * var(--fs))">丢弃情况</div>
<div class="kv">${dropped ? "整段丢弃：" + esc(dropped) : "无整段丢弃"}</div>
${(s.loreHits && s.loreHits.length) ? `<div class="kv" style="margin-top:6px">世界书命中：${s.loreHits.map(esc).join("、")}</div>` : ""}</div>
<div style="height:40px"></div>`;
window.scrollTo(0,0);
};

/* ============ Tier3-24: 角色召回本地通知（对标 Talkie 角色口吻推送）============
 * 只做本地通知，不做推送。触发时机保守：App 从后台回到前台（原生 onResume 回调
 * __onAppResumed，或冷启动）且距上次聊天超过 X 小时，发一条本地通知。
 * 真发动作走原生 JsBridge.notifyLocal；浏览器预览时无桥接，不真发。 */
const NOTIFY_KEY = "nd_notify_cfg";
const getNotifyCfg = ()=> Object.assign(
{on:false, hours:6, template:"{{npc_name}}：你回来了，{{username}}！", lastFired:0},
JSON.parse(localStorage.getItem(NOTIFY_KEY)||"{}"));
const saveNotifyCfg = (c)=> localStorage.setItem(NOTIFY_KEY, JSON.stringify(c));
/* 模板渲染：{{npc_name}} / {{username}}（参考 Talkie：{{npc_name}}: You're back, {{username}}!） */
function renderNotifyText(tpl, npcName, username){
return String(tpl||"")
.replace(/\{\{\s*npc_name\s*\}\}/g, String(npcName||"TA"))
.replace(/\{\{\s*username\s*\}\}/g, String(username||""));
}
/* 最近一次聊天活动：扫 nd_chat_ 前缀与 nd_group_ 前缀，取最后一条消息的 ts 与角色名 */
function lastChatInfo(){
let best = null;
const n = localStorage.length;
for(let i=0;i<n;i++){
const k = localStorage.key(i);
if(!k) continue;
let m = k.match(/^nd_chat_([^_]+)_(.+)$/) || k.match(/^nd_group_([^_]+)_(.+)$/);
if(!m) continue;
let h = null;
try{ h = JSON.parse(localStorage.getItem(k)||"[]"); }catch(e){}
if(!Array.isArray(h) || !h.length) continue;
const last = h[h.length-1];
const ts = (last && last.ts) || 0;
if(!ts || (best && ts <= best.ts)) continue;
const isGroup = k.indexOf("nd_group_")===0;
best = {key:k, ts:ts, name: isGroup ? (last.speaker || m[2].split("_")[0]) : m[2], group:isGroup};
}
return best;
}
function usernameOf(){
try{
const p = (typeof RP_PERSONA!=="undefined") ? RP_PERSONA.getGlobal() : null;
return (p && p.name) || "";
}catch(e){ return ""; }
}
window.maybeRecallNotify = ()=>{
try{
const cfg = getNotifyCfg();
if(!cfg.on) return false;
const bridge = (typeof window!=="undefined") ? window.Android : null;
if(!bridge || typeof bridge.notifyLocal!=="function") return false; /* 浏览器预览不真发 */
const last = lastChatInfo();
if(!last) return false;
const now = Date.now(), gap = Math.max(1, cfg.hours||6) * 3600 * 1000;
if(now - last.ts < gap) return false;
if(now - (cfg.lastFired||0) < gap) return false; /* 同一窗口只发一次 */
const text = renderNotifyText(cfg.template, last.name, usernameOf());
bridge.notifyLocal(String(last.name||"TA"), text);
cfg.lastFired = now; saveNotifyCfg(cfg);
return true;
}catch(e){ return false; }
};
/* 原生 onResume 回调入口 */
window.__onAppResumed = ()=>{ maybeRecallNotify(); };
window.saveNotifyUI = ()=>{
const c = getNotifyCfg();
c.on = !!document.getElementById("r_notify_on").checked;
const hh = parseInt(((document.getElementById("r_notify_hours")||{}).value||""), 10);
c.hours = (hh>=1 && hh<=168) ? hh : 6;
const t = ((document.getElementById("r_notify_tpl")||{}).value||"").trim();
if(t) c.template = t;
saveNotifyCfg(c);
alert(c.on ? "已开启：从后台回到前台、且超过 " + c.hours + " 小时没聊天时，会收到一条角色召回本地通知。" : "角色召回通知已关闭。");
};

/* ============ Tier3-25: 可编辑 heartbeat 主动消息（执行面，保守：仅前台） ============ */
function hbCheapModel(){
try{
const hb = (typeof RP_HB!=="undefined") ? RP_HB.getCfg() : {};
const rc = (typeof getRpCfg==="function") ? getRpCfg() : {};
return ((hb.model||"").trim()) || rc.summaryModel || "";
}catch(e){ return ""; }
}
/* 心跳目标聊天：优先当前聊天，否则最近一次有记录的聊天 */
function hbTargetChat(){
try{
if(typeof CHAT!=="undefined" && CHAT && (CHAT.name || CHAT.mode==="group") && typeof chatHistKey==="function"){
const k = chatHistKey(); const h = (typeof getHist==="function") ? getHistSafe(k) : [];
if(h && h.length) return {key:k, name: CHAT.mode==="group" ? (CHAT.members||[]).join("、") : CHAT.name};
}
}catch(e){}
const last = (typeof lastChatInfo==="function") ? lastChatInfo() : null;
return last ? {key:last.key, name:last.name} : null;
}
function renderHbLog(){
const box = document.getElementById("hb_log"); if(!box || typeof RP_HB==="undefined") return;
const c = RP_HB.getCfg();
const rows = (c.log||[]).slice().reverse().map(e=>{
const t = new Date(e.ts).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
return `<div class="storow"><span>${t} · ${e.need?"想主动说话":"无需打扰"}</span><span>${esc(String(e.message||"").slice(0,24))}</span></div>`;
}).join("");
box.innerHTML = (rows ? `<div class="kv" style="margin:8px 0 4px">最近检查记录</div>` + rows
: `<div class="hint">还没有检查记录。</div>`)
+ (c.enabled ? `<div class="kv">已启用 · ${RP_HB.FREQS[c.freq].name}（每 ${RP_HB.intervalOf(c.freq)} 轮用户消息检查一次）· 距上次 ${c.roundsSince||0} 轮</div>` : "");
}
window.saveHbUI = ()=>{
if(typeof RP_HB==="undefined"){ alert("心跳模块未加载"); return; }
const c = RP_HB.getCfg();
c.enabled = !!document.getElementById("r_hb_on").checked;
c.freq = ((document.getElementById("r_hb_freq")||{}).value)||"mid";
if(!RP_HB.FREQS[c.freq]) c.freq = "mid";
c.model = (((document.getElementById("r_hb_model")||{}).value)||"").trim();
const items = (((document.getElementById("r_hb_items")||{}).value)||"").split(/\n/).map(s=>s.trim()).filter(Boolean);
if(items.length) c.items = items;
RP_HB.saveCfg(c);
renderHbLog();
alert(c.enabled ? "心跳检查已启用（仅前台生效，后台不执行）。" : "心跳检查已关闭。");
};
let HB_TOAST_TIMER = null;
function hbToast(msg){
let el = document.getElementById("hbToast");
if(!el){ el = document.createElement("div"); el.id = "hbToast"; el.className = "achv-toast"; document.body.appendChild(el); }
el.innerHTML = msg;
el.classList.add("show");
if(HB_TOAST_TIMER) clearTimeout(HB_TOAST_TIMER);
HB_TOAST_TIMER = setTimeout(()=>el.classList.remove("show"), 3200);
}
window.hbCheckOnce = async ()=>{
if(typeof RP_HB==="undefined"){ alert("心跳模块未加载"); return; }
const cfg = (typeof getCfg==="function") ? getCfg() : {};
if(!cfg.key || !cfg.base || !cfg.model){ alert("先去「设置」配好 API 地址/Key/模型"); return; }
const target = hbTargetChat();
if(!target || !target.key){ alert("还没有任何聊天记录，先去聊几句再检查。"); return; }
const model = hbCheapModel() || cfg.model;
if(!confirm("用模型「" + model + "」做一次心跳检查？（约 1 次小模型调用）")) return;
try{
const r = await RP_HB.runCheck({charName: target.name, hist: getHistSafe(target.key), model: model,
complete: (c2, ms, t)=> RP_NET.complete(Object.assign({}, cfg, {model:(c2&&c2.model)||model}), ms, t)});
try{ renderHbLog(); }catch(e){}
alert(r.ok ? (r.need ? "检查完成：角色想主动说——\n" + r.message + "\n（已记入日志，未自动发送）" : "检查完成：这次无需打扰。")
: "检查失败：" + (r.error||"未知错误"));
}catch(e){ alert("检查失败：" + e.message); }
};
/* 每轮用户消息后调用：轮次到达则在前台触发一次检查（fire-and-forget，不阻塞聊天） */
function hbAfterSend(){
try{
if(typeof RP_HB==="undefined") return;
const hb = RP_HB.getCfg();
if(!hb.enabled) return;
hb.roundsSince = (hb.roundsSince||0) + 1;
if(hb.roundsSince < RP_HB.intervalOf(hb.freq)){ RP_HB.saveCfg(hb); return; }
RP_HB.saveCfg(hb); /* runCheck 成功后会清零并写 log */
const cfg = (typeof getCfg==="function") ? getCfg() : {};
if(!cfg.key || !cfg.base || !cfg.model || typeof RP_NET==="undefined") return;
const target = hbTargetChat();
if(!target || !target.key) return;
const model = hbCheapModel() || cfg.model;
RP_HB.runCheck({charName: target.name, hist: getHistSafe(target.key), model: model,
complete: (c2, ms, t)=> RP_NET.complete(Object.assign({}, cfg, {model:(c2&&c2.model)||model}), ms, t)})
.then(r=>{ if(r && r.ok && r.need) hbToast("💓 心跳检查：" + esc(target.name) + "好像想主动和你说句话，去设置页看看"); })
.catch(()=>{});
}catch(e){}
}

/* ================= 设置 ================= */
/* ============ P0-5 本地存储用量可视化 ============ */
const STORAGE_GROUPS = [
{label: "单聊历史", prefixes: ["nd_chat_"]},
{label: "群聊历史", prefixes: ["nd_group_"]},
{label: "穿越数据", prefixes: ["nd_trav", "nd_travchat_", "nd_travws_", "nd_identity_"]},
{label: "记忆事件簿", prefixes: ["nd_mem2_"]},
{label: "世界书", prefixes: ["nd_lore_"]},
{label: "角色卡", prefixes: ["nd_custom_chars", "nd_imported_cards", "nd_cw_"]},
{label: "人设与正则", prefixes: ["nd_persona", "nd_regex_"]},
];
window.fmtBytes = (b)=>{
if(b < 1024) return b + " B";
if(b < 1024*1024) return (b/1024).toFixed(1) + " KB";
if(b < 1024*1024*1024) return (b/1024/1024).toFixed(2) + " MB";
return (b/1024/1024/1024).toFixed(2) + " GB";
};
/* 本地存储总配额 2GB：localStorage（5MB 硬上限，浏览器规定改不了）+ IndexedDB（系统按磁盘余量算）
 * + 原生文件层（App 私有目录 files/ndblob/，2GB 自设上限，真机大文件走这里）。 */
window.ND_QUOTA_BYTES = 2*1024*1024*1024;
/* P1-7: localStorage 有 5MB 硬上限（浏览器规定），必须单独计算告警；
 * 原来用 2GB 做分母，LS 部分永远只占 0.25%，告警形同虚设。 */
window.ND_LS_QUOTA_BYTES = 5*1024*1024;
window.storageUsage = ()=>{
const groups = STORAGE_GROUPS.map(g=>({label: g.label, bytes: 0, keys: 0}));
const other = {label: "配置与其他", bytes: 0, keys: 0};
let total = 0;
for(let i = 0; i < localStorage.length; i++){
const k = localStorage.key(i);
let v = "";
try{ v = localStorage.getItem(k) || ""; }catch(e){}
const b = (k.length + v.length) * 2; // localStorage 按 UTF-16 存, 每码元 2 字节
total += b;
let gi = -1;
for(let j = 0; j < STORAGE_GROUPS.length; j++){
if(STORAGE_GROUPS[j].prefixes.some(p=>k.indexOf(p) === 0)){ gi = j; break; }
}
const t = gi >= 0 ? groups[gi] : other;
t.bytes += b; t.keys += 1;
}
/* 文件层（原生 2GB）不计入 localStorage，单独加上 */
let fileBytes = 0, fileCount = 0;
try{
if(typeof RP_STORE!=="undefined"){
if(RP_STORE.fileBytes){ const fb = RP_STORE.fileBytes(); if(typeof fb==="number" && fb > 0) fileBytes = fb; }
if(RP_STORE.fileCount){ fileCount = RP_STORE.fileCount()||0; }
}
}catch(e){}
const lsTotal = total; /* P1-7: localStorage 部分单独记，用于 5MB 告警 */
total += fileBytes;
groups.push(other);
return {total: total, lsTotal: lsTotal, quota: window.ND_QUOTA_BYTES, lsQuota: window.ND_LS_QUOTA_BYTES, fileBytes: fileBytes, fileCount: fileCount, groups: groups.filter(g=>g.keys > 0)};
};
window.renderStorageCard = ()=>{
const su = storageUsage();
const pct = Math.min(100, su.total / su.quota * 100);
/* P1-7: 告警看 localStorage 占用 / 5MB（这才是会爆的瓶颈），不再看 2GB 总量 */
const lsPct = Math.min(100, (su.lsTotal||0) / (su.lsQuota||1) * 100);
const warn = lsPct >= 80;
return `<div class="setcard"><h3>本地存储用量</h3>
<div class="storbar"><div class="storbar-fg${warn?" warn":""}" style="width:${pct.toFixed(1)}%"></div></div>
<div class="stornum${warn?" warn":""}">${fmtBytes(su.total)} / 2 GB（${pct.toFixed(0)}%）${warn?" · 空间告急，建议清理":""}</div>
<div class="storow"><span>浏览器本地存储<br><small style="color:var(--ink-faint);font-size:calc(11px * var(--fs))">上限 5MB，超限聊天无法保存</small></span><span class="${warn?"warn":""}">${fmtBytes(su.lsTotal||0)} / 5 MB（${lsPct.toFixed(0)}%）</span></div>
${su.groups.map(g=>`<div class="storow"><span>${g.label}</span><span>${g.keys} 项 · ${fmtBytes(g.bytes)}</span></div>`).join("")}
<div class="storow" id="fileline"><span>大文件存储<br><small style="color:var(--ink-faint);font-size:calc(11px * var(--fs))">App 私有目录，上限 2GB</small></span><span>${su.fileCount} 个文件 · ${fmtBytes(su.fileBytes)}</span></div>
<div class="storow" id="idbline"><span>浏览器大文件存储（估算）</span><span>统计中…</span></div>
<div class="storow" id="idbcopied"><span>已备份到大文件存储</span><span>—</span></div>
<div class="btnrow"><button class="btn ghost" onclick="if(confirm('清空所有单聊/群聊/穿越聊天记录？\n会清空记忆和关系，从头来过。'))clearChat()">清空聊天记录</button>
<button class="btn ghost" onclick="storeCleanup()">释放大文件空间</button>
<button class="btn danger" onclick="wipeAll()">清空全部数据</button></div>
</div>`;
};
/* 设置页搜索：按卡片文本过滤，顺带隐藏空分组标题 */
window.filterSettings = (q)=>{
  q = (q||"").trim();
  document.querySelectorAll("#view .setcard").forEach(c=>{
    c.style.display = (!q || c.textContent.indexOf(q)>=0) ? "" : "none";
  });
  document.querySelectorAll("#view .setsec").forEach(h=>{
    let el = h.nextElementSibling, vis = false;
    while(el && !el.classList.contains("setsec")){
      if(el.classList.contains("setcard") && el.style.display!=="none"){ vis = true; break; }
      el = el.nextElementSibling;
    }
    h.style.display = vis ? "" : "none";
  });
};
function showSettings(){
__backAction = null;
titleEl.textContent = "设置";
subEl.textContent = "";
const c = getCfg();
view.innerHTML = `<div class="searchwrap"><input id="set_q" placeholder="搜索设置…" oninput="filterSettings(this.value)"></div>`
+ `<h2 class="sec setsec">本机</h2>` + renderStorageCard()
+ `<h2 class="sec setsec">外观</h2>` + `
<div class="setcard"><h3>${icon("palette",15)} 命名主题</h3>
<div class="kv">三套中式意象色板，纯本地，切换即时生效。</div>
${themeCardsHTML()}</div>` + `
<div class="setcard"><h3>${icon("type",15)} 字号</h3>
<div class="kv">整体缩放界面，聊天泡泡也会变大，即时生效。</div>
${fontScaleCardsHTML()}</div>` + `\n<div class="setcard"><h3>${icon("image",15)} 全局壁纸</h3>
<div class="kv">所有聊天的默认背景，存在本机；某个聊天单独设过壁纸的不受影响。</div>
<div class="btnrow" style="margin-top:8px"><button class="btn ghost" onclick="globalWallpaperEditor()">设置全局壁纸</button></div></div>` + `<h2 class="sec setsec">游玩</h2>` + checkinCardHTML() + `
<div class="setcard"><h3>${icon("check",15)} 成就</h3>
<div class="kv">${typeof RP_ACHV!=="undefined" ? `已解锁 ${RP_ACHV.count()}/${RP_ACHV.DEFS.length}` : ""}</div>
<div class="btnrow" style="margin-top:8px"><button class="btn ghost" onclick="showAchv()">查看成就</button></div></div>` + `<h2 class="sec setsec">安全</h2>
<div class="setcard"><h3>${icon("check",15)} 应用锁</h3>
<div class="kv">纯前端 PIN 锁。忘记 PIN 只能清除全部数据, 没有找回途径。</div>
<div id="pinset" style="margin-top:8px"></div></div>` + `<h2 class="sec setsec">连接</h2>
<div class="setcard"><h3>大模型接口 · RP 聊天用 (OpenAI 兼容)</h3>
<div class="field"><label>API 地址</label>
<input id="c_base" placeholder="https://api.openai.com/v1" value="${esc(c.base||"")}"></div>
<div class="field"><label>API Key</label>
<input id="c_key" type="password" placeholder="sk-…" value="${esc(c.key||"")}"></div>
<div class="btnrow">
<button class="btn" onclick="fetchModels()">拉取模型列表</button>
<button class="btn ghost" onclick="testConn()">测试连接</button>
</div>
<div id="conn_result"></div>
<div class="field"><label>模型</label>
<div class="modelrow">
<select id="c_model_sel" onchange="document.getElementById('c_model').value=this.value;renderModelTags()"></select>
<input id="c_model" placeholder="或手动输入模型名" value="${esc(c.model||"")}" oninput="renderModelTags()">
</div></div>
<div class="field"><label>模型能力标签（对标 Janitor 模型目录：推理 / 视觉 / 长上下文）</label>
<div id="modeltags_row"></div>
<div class="modelrow" style="margin-top:6px">
<input id="modeltag_new" placeholder="自定义标签，如：联网搜索" style="flex:1">
<button class="btn ghost" onclick="modelTagAdd()">＋ 标签</button>
</div>
<div class="hint">给当前模型打标签，选模型时一眼看清能力；自定义标签会记住。</div></div>
<div class="field"><label>生图模型（可空，如 dall-e-3）</label>
<input id="c_img" placeholder="不填则不启用生图" value="${esc(c.imgModel||"")}"></div>
<div class="field"><label>TTS 模型（可空，如 tts-1）</label>
<input id="c_tts" placeholder="不填则不启用朗读" value="${esc(c.ttsModel||"")}"></div>
<div class="field"><label>TTS 音色</label>
<input id="c_voice" placeholder="alloy" value="${esc(c.ttsVoice||"")}"></div>
<div class="btnrow"><button class="btn" onclick="saveCfgUI()">保存</button></div>
</div>`+ (typeof RP_SOUL_CFG!=="undefined" ? RP_SOUL_CFG.profilesCardHTML() : "") +`<h2 class="sec setsec">RP 引擎</h2>
<div class="setcard"><h3>基础</h3>
<div class="field"><label>${icon("user",15)} 我的人设（全局）</label>
<div class="btnrow"><button class="btn ghost" onclick="personaEditor(null,'settings')">编辑全局人设</button></div>
<div class="hint" id="persona_sum"></div></div>
<div class="field"><label>Prompt 预设（人设分段组装顺序）</label>
<select id="r_preset">${Object.keys(RP_PROMPT.PRESETS).map(k=>
`<option value="${k}" ${getRpCfg().preset===k?"selected":""}>${RP_PROMPT.PRESETS[k].name} - ${RP_PROMPT.PRESETS[k].desc}</option>`).join("")}</select></div>
<div class="field"><label>${icon("books",15)} 酒馆预设（ST 预设导入，控制整套 prompt 的组装顺序与指令）</label>
<select id="r_stpreset"></select>
<div class="hint">导入 SillyTavern 导出的预设 JSON（如 MoM 类预设）。启用后，聊天 prompt 按预设的条目顺序组装；留空则用上面的经典组装。</div>
<div class="btnrow"><button class="btn ghost" onclick="document.getElementById('stpreset_file').click()">导入完整 ST 预设</button>
<button class="btn ghost" onclick="stPresetEntries()">管理条目</button>
<button class="btn ghost" onclick="exportStPreset()">导出所选预设</button>
<button class="btn ghost" onclick="delStPromptPreset()">删除所选预设</button>
<input type="file" id="stpreset_file" accept=".json,application/json" style="display:none" onchange="importStPromptPreset(this)"></div></div>
<div class="field"><label>上下文窗口（tokens，按模型填，如 8192/32768）</label>
<input id="r_ctx" type="number" min="2048" max="200000" step="1024" value=""></div>
<div class="field"><label>预留回复长度（tokens）</label>
<input id="r_resp" type="number" min="128" max="4096" step="128" value=""></div>
<div class="field"><label>摘要子模型（可空，为空则用主模型）</label>
<input id="r_summ" placeholder="如 gpt-4o-mini / deepseek-chat" value=""></div>
<div class="field"><label>温度（0-1.5，越高越放飞）</label>
<input id="r_temp" type="number" min="0" max="1.5" step="0.1" value=""></div>
<div class="field"><label>Top P（0-1，越小越保守）</label>
<input id="r_topp" type="number" min="0" max="1" step="0.05" value=""></div>
<div class="field"><label><input id="r_optcards" type="checkbox" style="width:auto"> ${icon("dice",14)} 剧情选项卡（AI 在回复末尾输出行动选项，点选项直接继续）</label></div>
<div class="field"><label>剧情选项数量（2-6 个）</label>
<input id="r_optcount" type="number" min="2" max="6" step="1" value=""></div>
<div class="field"><label>剧情选项氛围</label>
<select id="r_optmood">
<option value="none">无（默认）</option>
<option value="tense">紧张刺激</option>
<option value="warm">温情治愈</option>
<option value="mystery">悬疑烧脑</option>
<option value="casual">轻松日常</option>
<option value="flirty">暧昧拉扯</option>
</select></div>
<div class="field"><label><input id="r_ooc" type="checkbox" style="width:auto"> OOC 自动纠正（跳出角色时重试一次）</label></div>
<div class="field"><label><input id="r_ttsauto" type="checkbox" style="width:auto"> ${icon("volume",14)} 自动朗读 AI 回复（TTS 语音气泡播放）</label></div>
<div class="field"><label><input id="r_typewriter" type="checkbox" style="width:auto"> 打字机效果（AI 回复逐字呈现，点气泡/发消息可打断）</label></div>
<div class="field"><label>聊天壁纸</label>
<select id="r_wallpaper"></select></div>
<div class="field"><label>界面字体</label>
<select id="r_font"></select></div>
<div class="field"><label>记忆整理周期（每 N 条消息跑一次三层记忆分析）</label>
<input id="r_memcycle" type="number" min="5" value=""></div>
<div class="field"><label>记忆三池预算比例（近期 / 长远 / 重要，如 50/30/20）</label>
<input id="r_mempool" placeholder="50/30/20" value=""></div>
<div class="field"><label>新聊天记忆窗口（单次 prompt 注入记忆条数；条数越低越不易出错，对标 Janitor "Set New Chat Memory window. Lower if you get errors."）</label>
<input id="r_memwin" type="number" min="10" max="500" step="10" value=""></div>
<div class="field"><label><input id="r_leanmem_on" type="checkbox" style="width:auto"> 启用三库记忆（LeanMem：画像 / 事件 / 记录分流，检索按问题类型自适应）</label></div>
<div class="field"><label><input id="r_apex_on" type="checkbox" style="width:auto"> 启用记忆版本链（APEX-MEM：只追加不覆盖，旧版本可查；检索时消解矛盾记忆）</label></div>
<div class="field"><label>二遍对齐 PPA（第一遍自由生成，第二遍对照铁律/弧光改写，只修人设与穿帮）</label>
<select id="r_ppa_mode"><option value="off">关闭</option><option value="key">关键轮触发（默认）</option><option value="always">每轮都跑</option></select></div>
<div class="field"><label>二遍对齐模型（留空=用摘要模型，再空=用主模型，建议填便宜小模型）</label>
<input id="r_ppa_model" placeholder="留空跟随" value=""></div>
<div class="btnrow"><button class="btn" onclick="saveRpCfgUI()">保存 RP 设置</button><button class="btn ghost" onclick="importStPreset()">${icon("download")} 仅导入采样参数</button></div>
<div class="hint">每 N 条消息，引擎自动整理一次记忆：LeanMem 三库分流（画像库 / 事件库 / 记录库）+ 当前心境（1 次模型调用），存在本机；关闭三库记忆则回退为三池旧行为。</div>
<div class="hint">Key 只保存在本机, 聊天时由手机直接请求你填的接口, 不经过任何中转。
免费/便宜的兼容接口 (如硅基流动、DeepSeek) 都可以直接填。</div>
<div class="setcard"><h3>🧠 记忆说明</h3>
<div class="hint">旧消息会逐渐从记忆中褪色，但你置顶 / 存入事件簿的记忆会一直保留。</div>
<div class="hint">为什么TA会忘记东西？因为 AI 记忆有最大对话容量的限制，最近没提到的内容会出现失忆。为此你可以：置顶重要消息（长按消息）、填写本聊摘要、把关键事件设为永久记忆——这样即便近期未在对话中提到，TA 也会记住它们啦。</div>
</div>
<div class="setcard"><h3>${icon("clock",15)} 世界模拟 · 时间 / 天气 / 地理</h3>
<div class="field"><label><input id="r_ws_on" type="checkbox" style="width:auto"> 启用世界模拟（每会话独立时钟，随聊天自动流逝）</label></div>
<div class="field"><label>时间推进：每 N 轮用户消息</label>
<input id="r_ws_permsg" type="number" min="1" max="20" step="1" value=""></div>
<div class="field"><label>每次推进分钟数（古代世界显示为时辰）</label>
<input id="r_ws_stepmin" type="number" min="0" max="1440" step="5" value=""></div>
<div class="field"><label><input id="r_ws_wxauto" type="checkbox" style="width:auto"> 天气自动流转（按季节随机变化）</label></div>
<div class="field"><label>每 N 轮掷一次天气变化</label>
<input id="r_ws_wxevery" type="number" min="1" max="50" step="1" value=""></div>
<div class="field"><label><input id="r_temporal_on" type="checkbox" style="width:auto"> 启用时序感知（角色只知故事进度之前的事件，防"提前知道剧本"式穿帮）</label></div>
<div class="hint">时间/天气/地点会注入 prompt，AI 叙述会自动呼应；AI 也可用 ⟦+30分钟⟧ / ⟦天气=雨⟧ / ⟦地点=宁国府⟧ 标记调整。地点切换消耗移动时间。</div>
<div class="btnrow"><button class="btn" onclick="saveRpCfgUI()">保存 RP 设置</button></div>
</div>

<div class="setcard"><h3>${icon("clapperboard",15)} 导演系统 · 剧情节奏</h3>
<div class="field"><label><input id="r_dir_on" type="checkbox" style="width:auto"> 启用导演系统（幕后规划剧情节奏、抛事件，AI 扮演不受影响）</label></div>
<div class="field"><label>介入档位</label>
<select id="r_dir_tier"><option value="sentinel">节奏哨兵（默认）</option><option value="full">全导演（每轮介入）</option></select></div>
<div class="field"><label>导演风格</label>
<select id="r_dir_style">${(typeof RP_DIRECTOR!=="undefined"?Object.keys(RP_DIRECTOR.STYLES):["slowburn"]).map(k=>`<option value="${k}" ${(getRpCfg().directorStyle||"slowburn")===k?"selected":""}>${(typeof RP_DIRECTOR!=="undefined"?RP_DIRECTOR.STYLES[k].name:k)}</option>`).join("")}</select></div>
<div class="field"><label>节奏哨兵：每 N 轮用户消息介入一次</label>
<input id="r_dir_every" type="number" min="2" max="20" step="1" value=""></div>
<div class="field"><label>停滞强制升级：连续 N 轮无波澜则强制抛事件打破循环</label>
<input id="r_dir_stale" type="number" min="3" max="30" step="1" value=""></div>
<div class="field"><label>导演用模型（留空则与主模型一致；建议填便宜小模型省 token）</label>
<input id="r_dir_model" type="text" placeholder="留空 = 与主模型一致" value=""></div>
<div class="hint">导演只规划剧情（节奏/事件/转场），永远不写正文、不替你做决定；指令注入 prompt 后从正文剥离，你看不到导演的存在。节奏哨兵约增加 1/5 token 消耗。</div>
<div class="hint">${noBlueprintNote((typeof CHAT!=="undefined" && CHAT) ? CHAT.runId : null)}</div>
<div class="btnrow"><button class="btn" onclick="saveRpCfgUI()">保存 RP 设置</button></div>
</div>

<h2 class="sec setsec">通知</h2>
<div class="setcard"><h3>${icon("bell",15)} 通知 · 角色召回</h3>
<div class="field"><label><input id="r_notify_on" type="checkbox" style="width:auto"> 角色召回通知（App 从后台回到前台、且距上次聊天超过 N 小时，发一条本地通知）</label></div>
<div class="field"><label>超过 N 小时未聊天则召回</label>
<input id="r_notify_hours" type="number" min="1" max="168" step="1" value=""></div>
<div class="field"><label>通知文案模板（可用 {{npc_name}} / {{username}}）</label>
<textarea id="r_notify_tpl" rows="2" placeholder="{{npc_name}}：你回来了，{{username}}！"></textarea></div>
<div class="hint">只做本地通知，不经过任何服务器，也没有推送通道；浏览器里预览时不会真发（需要 Android 原生端）。</div>
<div class="btnrow"><button class="btn" onclick="saveNotifyUI()">保存通知设置</button></div>
</div>

<div class="setcard"><h3>${icon("clock",15)} 主动消息 · 心跳检查（可编辑）</h3>
<div class="field"><label><input id="r_hb_on" type="checkbox" style="width:auto"> 启用心跳检查（仅前台生效，后台不执行）</label></div>
<div class="field"><label>检查频率</label>
<select id="r_hb_freq"></select></div>
<div class="field"><label>心跳用模型（留空=跟随摘要模型；建议填便宜小模型）</label>
<input id="r_hb_model" placeholder="留空跟随" value=""></div>
<div class="field"><label>检查事项（每行一条，可编辑）</label>
<textarea id="r_hb_items" rows="4"></textarea></div>
<div class="hint">仅前台生效，后台不执行。用户消息轮次到达间隔、或手动点"检查一次"时，用便宜模型做一次检查；即使判定"想主动说话"，也只记入日志、不自动发送。</div>
<div class="btnrow"><button class="btn" onclick="saveHbUI()">保存心跳设置</button><button class="btn ghost" onclick="hbCheckOnce()">检查一次</button></div>
<div id="hb_log"></div>
</div>

<h2 class="sec setsec">数据</h2>
<div class="hint">产物数据随 App 版本更新。新蒸馏任务跑完后, 我会打新版 APK, 覆盖安装即可。</div>
<div class="btnrow"><button class="btn ghost" onclick="showOnboard(1)">重新查看新手引导</button>
<button class="btn danger" onclick="wipeAll()">清空任务/聊天/配置</button></div>
</div>`;
(function(){
const rc = getRpCfg();
document.getElementById("r_ctx").value = rc.maxContext;
document.getElementById("r_resp").value = rc.respTokens;
document.getElementById("r_summ").value = rc.summaryModel||"";
document.getElementById("r_temp").value = rc.temperature;
document.getElementById("r_topp").value = rc.topP;
try{ renderStPresetSel(); }catch(e){}
document.getElementById("r_optcards").checked = !!rc.optCards;
document.getElementById("r_optcount").value = rc.optCount||4;
document.getElementById("r_optmood").value = rc.optMood||"none";
document.getElementById("r_ooc").checked = !!rc.ooc;
document.getElementById("r_ttsauto").checked = !!rc.ttsAuto;
document.getElementById("r_typewriter").checked = rc.typewriter!==false;
document.getElementById("r_ws_on").checked = rc.worldsim!==false;
document.getElementById("r_ws_permsg").value = rc.wsPerMsg||3;
document.getElementById("r_ws_stepmin").value = rc.wsStepMin||30;
document.getElementById("r_ws_wxauto").checked = rc.wsWxAuto!==false;
document.getElementById("r_ws_wxevery").value = rc.wsWxEvery||5;
document.getElementById("r_temporal_on").checked = rc.temporal!==false;
document.getElementById("r_dir_on").checked = rc.director!==false;
document.getElementById("r_dir_tier").value = rc.directorTier||"sentinel";
document.getElementById("r_dir_style").value = rc.directorStyle||"slowburn";
document.getElementById("r_dir_every").value = rc.directorEvery||5;
document.getElementById("r_dir_stale").value = rc.directorStale||8;
document.getElementById("r_dir_model").value = rc.directorModel||"";
(function(){ /* P2: 壁纸/字体选项 */
if(typeof RP_APPEAR==="undefined") return;
const ap = RP_APPEAR.getAppear();
const ws = document.getElementById("r_wallpaper"), fs = document.getElementById("r_font");
if(ws) ws.innerHTML = RP_APPEAR.WALLPAPERS.map(w=>`<option value="${w.id}"${ap.wallpaper===w.id?" selected":""}>${w.name}</option>`).join("");
if(fs) fs.innerHTML = RP_APPEAR.FONTS.map(f=>`<option value="${f.id}"${ap.font===f.id?" selected":""}>${f.name}</option>`).join("");
/* P2: IndexedDB 用量行 + 已备份计数 */
try{
  const line = document.getElementById("idbline");
  if(line && typeof RP_STORE!=="undefined"){
    const r = RP_STORE.idbBytes();
    if(r && r.then) r.then(b=>{ if(b!=null) line.children[1].textContent = fmtBytes(b); else line.children[1].textContent = "未启用"; }).catch(()=>{});
    else line.children[1].textContent = "未启用";
  }
  const cl = document.getElementById("idbcopied");
  if(cl && typeof RP_STORE!=="undefined" && RP_STORE.copiedCount){
    cl.children[1].textContent = RP_STORE.copiedCount() + " 个大文件";
  }
}catch(e){}
window.storeCleanup = async ()=>{
  if(typeof RP_STORE==="undefined" || !RP_STORE.cleanupCopied){ alert("当前环境不支持"); return; }
  if(!confirm("把已备份到大文件存储的聊天记录/角色卡从 localStorage 里删除，释放空间？聊天记录不受影响（仍可正常读取）。")) return;
  try{
    const r = await RP_STORE.cleanupCopied();
    alert(`已释放 ${fmtBytes(r.freed)}，清理 ${r.count} 个文件`);
  }catch(e){ alert("清理失败："+e.message); }
  showSettings();
};
})();
document.getElementById("r_memcycle").value = rc.memCycle||10;
document.getElementById("r_mempool").value = rc.memPoolRatio||"50/30/20";
document.getElementById("r_memwin").value = rc.memWindowN||60; /* Tier2 #12 */
document.getElementById("r_leanmem_on").checked = rc.leanmem!==false;
document.getElementById("r_apex_on").checked = rc.apex!==false;
document.getElementById("r_ppa_mode").value = rc.ppaMode||"key";
document.getElementById("r_ppa_model").value = rc.ppaModel||"";
(function(){ const gp = RP_PERSONA.getGlobal();
const el = document.getElementById("persona_sum");
if(el) el.textContent = gp ? ("当前：" + (gp.name||"") + " " + String(gp.desc||"").slice(0,40)) : "未设置（建议填一下，AI 聊天时会知道你是谁）"; })();
/* Tier3-24: 通知设置初始化 */
(function(){
const nc = getNotifyCfg();
document.getElementById("r_notify_on").checked = !!nc.on;
document.getElementById("r_notify_hours").value = nc.hours||6;
document.getElementById("r_notify_tpl").value = nc.template||"";
})();
/* Tier3-25: 心跳设置初始化 */
(function(){
if(typeof RP_HB==="undefined") return;
const hb = RP_HB.getCfg();
document.getElementById("r_hb_on").checked = !!hb.enabled;
document.getElementById("r_hb_freq").innerHTML = Object.keys(RP_HB.FREQS).map(k=>
`<option value="${k}"${hb.freq===k?" selected":""}>${RP_HB.FREQS[k].name}（每 ${RP_HB.FREQS[k].rounds} 轮）</option>`).join("");
document.getElementById("r_hb_model").value = hb.model||"";
document.getElementById("r_hb_items").value = (hb.items||[]).join("\n");
renderHbLog();
})();
renderPinSettings();
try{ if(typeof renderModelTags === "function") renderModelTags(); }catch(e){} /* Tier2 #18 */
const c = getCfg();
if(c.base && c.key){ fetchModels(true); }
else {
try{
const cached = JSON.parse(localStorage.getItem("nd_models")||"[]");
const sel = document.getElementById("c_model_sel");
if(sel && cached.length) sel.innerHTML = cached.map(id=>"<option>"+esc(id)+"</option>").join("");
}catch(e){}
}
})();
}
window.saveCfgUI = ()=>{
const m = $("#c_model").value.trim() || $("#c_model_sel").value;
saveCfg({base:$("#c_base").value.trim(), key:$("#c_key").value.trim(), model:m,
imgModel:$("#c_img").value.trim(), ttsModel:$("#c_tts").value.trim(), ttsVoice:$("#c_voice").value.trim()||"alloy"});
alert("已保存");
};
async function _api(path, cfg, method, body){
const base = (cfg.base||"").replace(/\/+$/,"");
const r = await fetch(`${base}${path}`, {
method: method||"GET",
headers:Object.assign({"Content-Type":"application/json"},
cfg.key?{"Authorization":`Bearer ${cfg.key}`}:{}),
body: body?JSON.stringify(body):undefined,
});
if(!r.ok) throw new Error(`HTTP ${r.status}`);
return r.json();
}
function _cfgFromUI(){
return {base:$("#c_base").value.trim(), key:$("#c_key").value.trim(),
model:$("#c_model").value.trim()||$("#c_model_sel").value};
}
/* Tier2 #18: 模型能力标签 (对标 Janitor 模型目录过滤器：推理 / 视觉 / 长上下文)。
 * 用户自配模型时给模型打标签，不再盲选。 */
window.renderModelTags = ()=>{
const row = document.getElementById("modeltags_row");
const mv = document.getElementById("c_model");
if(!row || !mv || typeof RP_MODELTAGS === "undefined") return;
const id = mv.value;
const tags = RP_MODELTAGS.allTagsFor(id);
const cur = RP_MODELTAGS.get(id);
row.innerHTML = tags.map(t=>
`<label class="tagchip"><input type="checkbox" data-tag="${esc(t)}" ${cur.indexOf(t)>=0?"checked":""}> ${esc(t)}</label>`).join("")
|| `<span class="dim">暂无标签</span>`;
Array.prototype.forEach.call(row.querySelectorAll("input[data-tag]"), (cb)=>{
cb.onchange = ()=>{
const on = Array.prototype.filter.call(row.querySelectorAll("input[data-tag]"), x=>x.checked).map(x=>x.getAttribute("data-tag"));
RP_MODELTAGS.save(id, on);
renderModelTags();
};
});
};
window.modelTagAdd = ()=>{
const inp = document.getElementById("modeltag_new");
const mv = document.getElementById("c_model");
if(!inp || !mv || typeof RP_MODELTAGS === "undefined") return;
const t = inp.value.trim();
if(!t) return;
const id = mv.value;
const cur = RP_MODELTAGS.get(id);
if(cur.indexOf(t) < 0){ cur.push(t); RP_MODELTAGS.save(id, cur); }
inp.value = "";
renderModelTags();
};
window.fetchModels = async (silent)=>{const cfg = _cfgFromUI();
const box = $("#conn_result");
if(!cfg.base){ if(!silent) alert("先填 API 地址"); return []; }
try{
if(box && !silent) box.innerHTML = "正在拉取模型列表…";
const d = await _api("/models", cfg);
const ids = (d.data||[]).map(x=>x.id).filter(Boolean).sort();
const sel = $("#c_model_sel");
const cur = cfg.model;
sel.innerHTML = ids.map(id=>`<option value="${esc(id)}" ${id===cur?"selected":""}>${esc(id)}</option>`).join("")
|| `<option value="">(无可用模型)</option>`;
if(cur && ids.includes(cur)) sel.value = cur;
localStorage.setItem("nd_models", JSON.stringify(ids));
if(box && !silent) box.innerHTML = `<span class="conn-ok">${icon("check",14)} 拉到 ${ids.length} 个模型</span>`;
return ids;
}catch(e){
if(box && !silent) box.innerHTML = `<span class="conn-bad">${icon("x",14)} 拉取失败：${esc(e.message)}</span>`;
return [];
}
};
window.testConn = async ()=>{
const cfg = _cfgFromUI();
const box = $("#conn_result");
const t0 = Date.now();
try{
box.innerHTML = "① 检查地址与 Key…";
await _api("/models", cfg);
box.innerHTML = "① <span class='conn-ok'>" + icon("check",14) + " 地址/Key 有效</span><br>② 测试模型对话…";
const d = await _api("/chat/completions", cfg, "POST", {
model: cfg.model, max_tokens: 8,
messages:[{role:"user", content:"回一个字：好"}],
});
const reply = d.choices && d.choices[0] && d.choices[0].message
? d.choices[0].message.content : "(空)";
box.innerHTML = `① <span class='conn-ok'>${icon("check",14)} 地址/Key 有效</span><br>`
+ `② <span class='conn-ok'>${icon("check",14)} 模型 ${esc(cfg.model)} 可用</span>（${((Date.now()-t0)/1000).toFixed(1)}s，回复：${esc(String(reply).slice(0,20))}）`;
}catch(e){
box.innerHTML = `<span class="conn-bad">${icon("x",14)} ${esc(e.message)}</span><br>`
+ `<span style="color:var(--ink-faint);font-size:calc(12px * var(--fs))">检查地址/Key/模型名，或手机网络/代理。</span>`;
}
};
window.saveRpCfgUI = ()=>{
const _stId = document.getElementById("r_stpreset") ? document.getElementById("r_stpreset").value || null : null;
/* v37: 绑定的 ST 预设自带采样参数则应用到温度/TopP */
let _stParams = null;
try{ const _p = (typeof RP_PRESET!=="undefined") ? RP_PRESET.get(_stId) : null; _stParams = _p ? _p.params : null; }catch(e){}
const _tempInput = Math.max(0,Math.min(1.5,parseFloat($("#r_temp").value)||0.9));
const _topPInput = Math.max(0,Math.min(1,parseFloat($("#r_topp").value)||1));
saveRpCfg({maxContext:Math.max(2048,parseInt($("#r_ctx").value)||8192),
respTokens:Math.max(128,parseInt($("#r_resp").value)||512),
summaryModel:$("#r_summ").value.trim(),
temperature:(_stParams&&_stParams.temperature!=null)?Math.max(0,Math.min(1.5,_stParams.temperature)):_tempInput,
topP:(_stParams&&_stParams.top_p!=null)?Math.max(0,Math.min(1,_stParams.top_p)):_topPInput,
optCards:$("#r_optcards").checked,
optCount:Math.min(6,Math.max(2,parseInt($("#r_optcount").value)||4)),
optMood:$("#r_optmood").value||"none",
ooc:$("#r_ooc").checked, preset:$("#r_preset").value,
stPreset:_stId,
ttsAuto:$("#r_ttsauto").checked, typewriter:$("#r_typewriter").checked,
memCycle:Math.max(5,parseInt($("#r_memcycle").value)||10),
memPoolRatio:(($("#r_mempool")&&$("#r_mempool").value)||"50/30/20").trim()||"50/30/20",
memWindowN:Math.min(500,Math.max(10,parseInt(($("#r_memwin")&&$("#r_memwin").value)||"60")||60)), /* Tier2 #12 */
leanmem:$("#r_leanmem_on")?$("#r_leanmem_on").checked:true,
apex:$("#r_apex_on")?$("#r_apex_on").checked:true,
ppaMode:$("#r_ppa_mode")?$("#r_ppa_mode").value:"key",
ppaModel:$("#r_ppa_model")?$("#r_ppa_model").value.trim():"",
/* 世界模拟三件套 */
worldsim:$("#r_ws_on")?$("#r_ws_on").checked:true,
wsPerMsg:Math.max(1,parseInt($("#r_ws_permsg")?$("#r_ws_permsg").value:"3")||3),
wsStepMin:Math.max(0,parseInt($("#r_ws_stepmin")?$("#r_ws_stepmin").value:"30")||0),
wsWxAuto:$("#r_ws_wxauto")?$("#r_ws_wxauto").checked:true,
wsWxEvery:Math.max(1,parseInt($("#r_ws_wxevery")?$("#r_ws_wxevery").value:"5")||5),
temporal:$("#r_temporal_on")?$("#r_temporal_on").checked:true,
/* 导演系统 */
director:$("#r_dir_on")?$("#r_dir_on").checked:true,
directorTier:$("#r_dir_tier")?$("#r_dir_tier").value:"sentinel",
directorStyle:$("#r_dir_style")?$("#r_dir_style").value:"slowburn",
directorEvery:Math.max(2,parseInt($("#r_dir_every")?$("#r_dir_every").value:"5")||5),
directorStale:Math.max(3,parseInt($("#r_dir_stale")?$("#r_dir_stale").value:"8")||8),
directorModel:(($("#r_dir_model")?$("#r_dir_model").value:"")||"").trim()});
/* P2: 壁纸/字体 */
try{
if(typeof RP_APPEAR!=="undefined"){
RP_APPEAR.setAppear({wallpaper:$("#r_wallpaper").value, font:$("#r_font").value});
applyAppearance();
}
}catch(e){}
try{ /* v37: 预设采样参数回填到输入框, 所见即所得 */
const _rc2 = getRpCfg();
if(document.getElementById("r_temp")) document.getElementById("r_temp").value = _rc2.temperature;
if(document.getElementById("r_topp")) document.getElementById("r_topp").value = _rc2.topP;
}catch(e){}
alert("RP 设置已保存");
};
/* P2: 应用壁纸 + 字体 */
window.applyAppearance = ()=>{
try{
if(typeof RP_APPEAR==="undefined") return;
const ap = RP_APPEAR.getAppear();
document.body.dataset.wallpaper = ap.wallpaper;
document.body.dataset.font = ap.font;
}catch(e){}
};
/* v37: ST 预设(prompt 组件)导入/管理/绑定。旧 importStPreset 只导采样参数，保留。 */
function renderStPresetSel(){
const sel = document.getElementById("r_stpreset");
if(!sel || typeof RP_PRESET === "undefined") return;
const cur = getRpCfg().stPreset || "";
let html = `<option value="">不使用（经典组装）</option>`;
RP_PRESET.list().forEach(p=>{
const n = (p.prompts||[]).length, on = (p.prompts||[]).filter(e=>e && e.enabled!==false).length;
html += `<option value="${p.id}" ${p.id===cur?"selected":""}>${esc(p.name)}（${on}/${n} 启用）</option>`;
});
sel.innerHTML = html;
}
window.importStPromptPreset = (input)=>{
const f = input.files && input.files[0];
input.value = "";
if(!f || typeof RP_PRESET === "undefined") return;
const rd = new FileReader();
rd.onload = ()=>{
const fname = (f.name || "").replace(/\.json$/i, "");
const r = RP_PRESET.parseFile(rd.result, fname);
if(!r.ok){
alert(r.err==="noprompts" ? "这不是 ST 预设文件（缺少 prompts 数组）。" :
      r.err==="empty" ? "预设里没有可用的条目。" : "JSON 解析失败。");
return;
}
RP_PRESET.save(r.preset);
const rc = getRpCfg(); rc.stPreset = r.preset.id; saveRpCfg(rc);
renderStPresetSel();
const all = r.preset.prompts, on = all.filter(p=>p.enabled!==false).length;
const mk = all.filter(p=>p.marker).length;
alert("已导入预设「" + r.preset.name + "」：" + all.length + " 条（" + on + " 启用），" +
  mk + " 个定位标记。" +
  (r.preset.params.temperature != null ? "采样温度 " + r.preset.params.temperature + " 将在保存设置时应用。" : "") +
  "可在「管理条目」里逐条开关。");
};
rd.readAsText(f);
};
window.delStPromptPreset = ()=>{
const sel = document.getElementById("r_stpreset");
const id = sel ? sel.value : "";
if(!id){ alert("当前没有选择已导入的预设。"); return; }
const p = RP_PRESET.get(id);
if(!confirm("删除预设「" + (p ? p.name : id) + "」？")) return;
RP_PRESET.remove(id);
const rc = getRpCfg();
if(rc.stPreset === id){ rc.stPreset = null; saveRpCfg(rc); }
renderStPresetSel();
};
/* ST 预设导出(JSON): RP_PRESETEXPORT.exportPreset, 与 RP_PRESET.parseFile 互逆, 可导回 ST */
window.exportStPreset = ()=>{
const sel = document.getElementById("r_stpreset");
const id = sel ? sel.value : "";
if(!id || typeof RP_PRESET === "undefined" || typeof RP_PRESETEXPORT === "undefined"){
  rpToast("请先在下拉框选择要导出的预设"); return; }
const p = RP_PRESET.get(id);
if(!p){ rpToast("预设不存在"); return; }
downloadJson("preset_st_" + p.name + ".json", RP_PRESETEXPORT.exportPreset(p));
rpToast(`已导出预设「${p.name}」(ST 格式)`);
};
/* v38: ST 预设逐条开关。条目列表页(分组标题+开关+点行进详情) */
window.stPresetEntries = ()=>{
if(typeof RP_PRESET === "undefined") return;
const sel = document.getElementById("r_stpreset");
const id = sel ? sel.value : "";
if(!id){ alert("请先在下拉框选择一个已导入的预设。"); return; }
renderStPresetEntries(id);
};
function stPresetEntryBadges(e){
let b = `<span class="badge">${e.marker ? "定位标记" : esc(e.role)}</span>`;
const id = String(e.identifier || "");
/* UUID 式 identifier 无信息量, 只在详情页展示 */
if(id && (e.marker || !/^[0-9a-f-]{8,}$/i.test(id))) b += `<span class="badge">${esc(id)}</span>`;
if(!e.marker && e.injection_position === "chat") b += `<span class="badge">聊天注入·深度${e.injection_depth || 0}</span>`;
if(e.enabled === false) b += `<span class="badge">停用</span>`;
return b;
}
/* v38b: ST 任意组合。条目列表页: 新增 + 上移/下移排序 + 逐条开关 */
function renderStPresetEntries(pid){
__backAction = ()=>{ setNav("settings"); };
const p = RP_PRESET.get(pid);
if(!p){ setNav("settings"); return; }
const total = p.prompts.length, on = p.prompts.filter(e=>e.enabled!==false).length;
let html = `<button class="back" onclick="setNav('settings')">${icon("back")} 返回设置</button>
<h2 style="margin:6px 0">${esc(p.name)}</h2>
<div class="hint">${total} 条目，${on} 启用 · 点行编辑，右侧开关逐条启用/停用（停用条目不参与 prompt 组装）；↑↓ 调整组装顺序</div>
<div class="btnrow"><button class="btn" onclick="stPresetAddEntry('${jq(pid)}')">${icon("plus")} 新增自定义条目</button></div>`;
let lastGroup = "\0";
p.prompts.forEach((e, i)=>{
const g = e.group || "";
if(g && g !== lastGroup){ html += `<div class="spgrp">${esc(g)}</div>`; }
lastGroup = g;
const en = e.enabled !== false;
const preview = String(e.content || "").replace(/\s+/g, " ").slice(0, 60);
html += `<div class="card card--tap" style="padding:12px 14px" onclick="stPresetEntryDetail('${jq(pid)}',${jq(i)})"><div class="row"><div style="flex:1;min-width:0">`
+ `<div class="spname">${esc(e.name)}${stPresetEntryBadges(e)}</div>`
+ (preview ? `<div class="meta">${esc(preview)}…</div>` : `<div class="meta">（空内容）</div>`)
+ `</div><div class="sbtncol">`
+ `<button class="sbtn" aria-label="上移" onclick="event.stopPropagation();stPresetMoveEntry('${jq(pid)}',${jq(i)},-1)">↑</button>`
+ `<button class="sbtn" aria-label="下移" onclick="event.stopPropagation();stPresetMoveEntry('${jq(pid)}',${jq(i)},1)">↓</button>`
+ `<button class="pswitch${en ? " on" : ""}" aria-label="启用开关" onclick="event.stopPropagation();stPresetToggleEntry('${jq(pid)}',${jq(i)})"></button>`
+ `</div></div></div>`;
});
view.innerHTML = html;
window.scrollTo(0, 0);
}
window.stPresetToggleEntry = (pid, i)=>{
const p = RP_PRESET.get(pid);
if(!p || !p.prompts[i]) return;
p.prompts[i].enabled = p.prompts[i].enabled === false ? true : false;
RP_PRESET.save(p);
renderStPresetSel();
renderStPresetEntries(pid);
};
window.stPresetMoveEntry = (pid, i, delta)=>{
if(typeof RP_PRESET.moveEntry !== "function") return;
RP_PRESET.moveEntry(pid, i, delta);
renderStPresetEntries(pid);
};
/* 新增自定义条目: 先建空条目, 直接进编辑页 */
window.stPresetAddEntry = (pid)=>{
const p = RP_PRESET.addEntry(pid, {name: "自定义条目", role: "system", content: "", group: "自定义"});
if(!p) return;
renderStPresetSel();
stPresetEntryDetail(pid, p.prompts.length - 1);
};
/* 条目详情页: 定位标记只读 + 开关; 普通条目可编辑全部字段 */
window.stPresetEntryDetail = (pid, i)=>{
const p = RP_PRESET.get(pid), e = p && p.prompts[i];
if(!e) return;
__backAction = ()=>renderStPresetEntries(pid);
const en = e.enabled !== false;
if(e.marker){
view.innerHTML = `<button class="back" onclick="renderStPresetEntries('${jq(pid)}')">${icon("back")} 返回条目</button>
<div class="card"><div class="row"><div style="flex:1;min-width:0">
<div class="spname">${esc(e.name)}</div>
<div class="meta">定位标记 · ${e.identifier ? esc(e.identifier) + " · " : ""}${e.group ? "分组:" + esc(e.group) + " · " : ""}顺序 #${(e.pos == null ? i : e.pos) + 1}</div>
<div class="hint">定位标记是预设的占位符，组装时替换为 App 侧对应内容（人设/角色/场景/示例/世界书/历史），不可编辑内容，只能开关。</div>
</div><button class="pswitch${en ? " on" : ""}" aria-label="启用开关" onclick="stPresetToggleEntryDetail('${jq(pid)}',${jq(i)})"></button></div></div>`;
window.scrollTo(0, 0);
return;
}
const isChat = e.injection_position === "chat";
view.innerHTML = `<button class="back" onclick="renderStPresetEntries('${jq(pid)}')">${icon("back")} 返回条目</button>
<div class="card">
<div class="row"><div style="flex:1;min-width:0"><div class="spname">编辑条目</div>
<div class="meta">顺序 #${(e.pos == null ? i : e.pos) + 1}${e.group ? " · 分组:" + esc(e.group) : ""}</div></div>
<button class="pswitch${en ? " on" : ""}" aria-label="启用开关" onclick="stPresetToggleEntryDetail('${jq(pid)}',${jq(i)})"></button></div>
<div class="field"><label>名称</label><input id="pe_name" value="${esc(e.name)}" maxlength="60"></div>
<div class="field"><label>角色</label><select id="pe_role">
<option value="system"${e.role==="system"?" selected":""}>system（系统指令）</option>
<option value="user"${e.role==="user"?" selected":""}>user（用户消息）</option>
<option value="assistant"${e.role==="assistant"?" selected":""}>assistant（助手消息）</option>
</select></div>
<div class="field"><label>注入位置</label><select id="pe_pos" onchange="document.getElementById('pe_depthrow').style.display=this.value==='chat'?'':'none'">
<option value=""${isChat?"":" selected"}>主提示（按顺序组装）</option>
<option value="chat"${isChat?" selected":""}>聊天中注入（插进历史消息）</option>
</select></div>
<div class="field" id="pe_depthrow" style="display:${isChat?"":"none"}"><label>注入深度（插在历史末尾 N 条消息之前，0=紧贴末尾）</label>
<input id="pe_depth" type="number" min="0" max="99" value="${e.injection_depth || 0}"></div>
<div class="field"><label>内容（支持 {{char}}/{{user}}/{{time}} 等变量宏）</label>
<textarea id="pe_content" rows="8">${esc(e.content)}</textarea></div>
<div class="btnrow"><button class="btn" onclick="stPresetSaveEntry('${jq(pid)}',${jq(i)})">保存</button>
<button class="btn danger" onclick="stPresetDelEntry('${jq(pid)}',${jq(i)})">删除条目</button></div>
</div>`;
window.scrollTo(0, 0);
};
window.stPresetToggleEntryDetail = (pid, i)=>{
const p = RP_PRESET.get(pid);
if(!p || !p.prompts[i]) return;
p.prompts[i].enabled = p.prompts[i].enabled === false ? true : false;
RP_PRESET.save(p);
renderStPresetSel();
stPresetEntryDetail(pid, i);
};
window.stPresetSaveEntry = (pid, i)=>{
const name = document.getElementById("pe_name").value.trim();
const role = document.getElementById("pe_role").value;
const pos = document.getElementById("pe_pos").value;
const depth = Math.max(0, Math.min(99, parseInt(document.getElementById("pe_depth").value) || 0));
const content = document.getElementById("pe_content").value;
RP_PRESET.updateEntry(pid, i, {name: name || undefined, role, content, injection_position: pos, injection_depth: depth});
renderStPresetSel();
renderStPresetEntries(pid);
rpToast("已保存");
};
window.stPresetDelEntry = (pid, i)=>{
const p = RP_PRESET.get(pid), e = p && p.prompts[i];
if(!e || !confirm(`删除条目「${e.name}」？`)) return;
RP_PRESET.deleteEntry(pid, i);
renderStPresetSel();
renderStPresetEntries(pid);
};
function stPresetToCfg(d, rc){
if(!d || typeof d.temperature === "undefined") return null;
rc = rc || {};
if(d.temperature != null) rc.temperature = Math.max(0, Math.min(1.5, +d.temperature || 0.9));
if(d.top_p != null) rc.topP = Math.max(0, Math.min(1, +d.top_p || 1));
if(d.openai_max_tokens != null) rc.respTokens = Math.max(128, parseInt(d.openai_max_tokens) || 512);
if(d.openai_max_context != null) rc.maxContext = Math.max(2048, parseInt(d.openai_max_context) || 8192);
return rc;
}
window.importStPreset = ()=>{
const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
inp.onchange = ()=>{
const f = inp.files[0]; if(!f) return;
const rd = new FileReader();
rd.onload = ()=>{
try{
const d = JSON.parse(rd.result);
const rc = stPresetToCfg(d, getRpCfg());
if(!rc){ alert("解析失败: 不是 ST 文本预设"); return; }
saveRpCfg(rc);
document.getElementById("r_temp").value = rc.temperature;
document.getElementById("r_topp").value = rc.topP;
document.getElementById("r_resp").value = rc.respTokens;
document.getElementById("r_ctx").value = rc.maxContext;
alert("已导入采样参数: 温度 " + rc.temperature + " / Top P " + rc.topP);
}catch(e){ alert("解析失败: " + e.message); }
};
rd.readAsText(f);
};
inp.click();
};
window.wipeAll = ()=>{
if(!confirm("清空所有任务、聊天记录和 API 配置? 产物数据不受影响。")) return;
/* v36: 先清存储层（IDB 整库 + 原生文件 + 内存镜像 + 标记），再删 localStorage 业务键。
 * 顺序不能反：RP_STORE.wipeAll 内部不再依赖标记，但旧版本桥接的逐个删除回退路径
 * 需要标记；先删标记会导致原生文件变孤儿删不掉。 */
const finish = ()=>{
  Object.keys(localStorage).filter(k=>k.startsWith("nd_")).forEach(k=>localStorage.removeItem(k));
  alert("已清空"); showSettings();
};
try{
  if(typeof RP_STORE!=="undefined" && RP_STORE.wipeAll){
    RP_STORE.wipeAll().then(finish, finish);
  } else finish();
}catch(e){ finish(); }
};


/* ================= 分析任务 (通用周期分析引擎 UI) ================= */
window.showATasks = (name)=>{
__backAction = ()=>showChat();
const nm = name || (CHAT.mode==="group" ? null : CHAT.name);
if(!nm){
const ms = CHAT.members||[]; if(!ms.length) return;
const pick = prompt("管理谁的分析任务?\n"+ms.map((n,i)=>(i+1)+". "+n).join("\n"), "1");
const idx = parseInt(pick)-1;
if(ms[idx]) showATasks(ms[idx]);
return;
}
const defs = RP_TASKS.getDefs(CHAT.runId, nm);
titleEl.textContent = "分析任务 · " + nm;
subEl.textContent = "";
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
view.innerHTML = `
<div class="hint">周期分析任务: 按消息条数或关键词自动触发, 把分析结果注入对话 (常驻/按需) 或仅存档。内置三层记忆不在此列, 每次触发约 1 次模型调用。</div>
${defs.map(d=>{const t=RP_TASKS.normDef(d); const st=RP_TASKS.getState(CHAT.runId,nm,t.id);
return `<div class="card"><div class="row"><div><div class="name">${esc(t.name)}</div>
<div class="kv">${esc(RP_TASKS.describe(t))}</div>
<div class="kv">${st?("上次运行: "+new Date(st.updatedAt).toLocaleString()+(st.reason?" · "+st.reason:"")):"尚未运行"}</div></div></div>
<div class="btnrow"><button class="btn ghost" onclick="viewAOut('${jq(nm)}','${jq(t.id)}')">查看输出</button>
<button class="btn ghost" onclick="runATaskNow('${jq(nm)}','${jq(t.id)}')">立即运行</button>
<button class="btn ghost" onclick="editATask('${jq(nm)}','${jq(t.id)}')">编辑</button>
<button class="btn danger ghost" onclick="delATask('${jq(nm)}','${jq(t.id)}')">删除</button></div></div>`;}).join("") || `<div class="empty">还没有分析任务, 点下面新建一个。</div>`}
<div class="btnrow"><button class="btn" onclick="editATask('${jq(nm)}','')">${icon("plus")} 新建任务</button>
<button class="btn ghost" onclick="showChat()">返回聊天</button></div>`;
};
window.editATask = (name, id)=>{
__backAction = ()=>showATasks(name);
const defs = RP_TASKS.getDefs(CHAT.runId, name);
const t = RP_TASKS.normDef(id ? (defs.find(d=>d.id===id)||{}) : {id: RP_TASKS.nextId(defs)});
titleEl.textContent = (id?"编辑任务 · ":"新建任务 · ") + name;
subEl.textContent = "";
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
view.innerHTML = `
<div class="setcard">
<div class="field"><label>任务名</label><input id="at_name" value="${esc(t.name)}"></div>
<div class="field"><label>分析提示词 (可用变量 {{CHAR_NAME}} {{CARD_HINT}} {{PREV_OUTPUT}} {{NEW_DIALOG}})</label>
<textarea id="at_prompt" rows="8" placeholder="从下方新对话里提取值得记住的事件, 用角色口吻写成条目">${esc(t.prompt)}</textarea></div>
<div class="field"><label>触发周期 (每 N 条新消息跑一次, 0=关闭周期触发)</label>
<input id="at_cycle" type="number" min="0" value="${t.cycle}"></div>
<div class="field"><label>关键词触发 (逗号分隔, 新消息命中任一即触发, 可空)</label>
<input id="at_kw" value="${esc(t.keywords.join(","))}" placeholder="如: 宝钗,史湘云"></div>
<div class="field"><label>输出方式</label><select id="at_mode">
<option value="constant" ${t.mode==="constant"?"selected":""}>常驻注入 (每次对话都记住)</option>
<option value="selective" ${t.mode==="selective"?"selected":""}>按需注入 (聊到关键词才想起)</option>
<option value="off" ${t.mode==="off"?"selected":""}>仅存档 (不注入对话)</option></select></div>
<div class="field"><label><input id="at_enabled" type="checkbox" style="width:auto" ${t.enabled?"checked":""}> 启用</label></div>
<div class="btnrow"><button class="btn" onclick="saveATask('${jq(name)}','${jq(t.id)}')">保存</button>
<button class="btn ghost" onclick="showATasks('${jq(name)}')">返回</button></div>
<div class="hint">{{NEW_DIALOG}} 是上次运行以来的新对话; {{PREV_OUTPUT}} 是任务上次的输出, 适合做增量更新。</div>
</div>`;
};
window.saveATask = (name, id)=>{
const defs = RP_TASKS.getDefs(CHAT.runId, name).map(RP_TASKS.normDef);
const t = RP_TASKS.normDef({id: id, name: $("#at_name").value, prompt: $("#at_prompt").value,
cycle: $("#at_cycle").value, keywords: $("#at_kw").value, mode: $("#at_mode").value,
enabled: $("#at_enabled").checked});
if(!t.prompt.trim()){ alert("提示词不能为空"); return; }
const i = defs.findIndex(d=>d.id===id);
if(i>=0) defs[i]=t; else defs.push(t);
RP_TASKS.saveDefs(CHAT.runId, name, defs);
showATasks(name);
};
window.delATask = (name, id)=>{
if(!confirm("删除这个分析任务? 已存的输出也会清除。")) return;
RP_TASKS.saveDefs(CHAT.runId, name, RP_TASKS.getDefs(CHAT.runId, name).filter(d=>d.id!==id));
RP_TASKS.clearState(CHAT.runId, name, id);
showATasks(name);
};
window.viewAOut = (name, id)=>{
__backAction = ()=>showATasks(name);
const defs = RP_TASKS.getDefs(CHAT.runId, name);
const t = defs.find(d=>d.id===id)||{};
const st = RP_TASKS.getState(CHAT.runId, name, id);
titleEl.textContent = "任务输出 · " + (t.name||"");
subEl.textContent = "";
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
view.innerHTML = `<div class="setcard">
<div class="kv">${st?("更新于 "+new Date(st.updatedAt).toLocaleString()+(st.reason?" · 触发: "+st.reason:"")):"尚未运行"}</div>
<pre style="white-space:pre-wrap;font-size:calc(13px * var(--fs))">${esc((st&&st.output)||"(空)")}</pre>
<div class="btnrow"><button class="btn ghost" onclick="showATasks('${jq(name)}')">返回</button></div></div>`;
};
window.runATaskNow = async (name, id)=>{
const cfg = getCfg();
if(!cfg.key){ alert("先去设置里配 API"); return; }
if(!confirm("用最近的聊天记录跑一次这个任务? (约 1 次模型调用)")) return;
const h = getHistSafe(chatHistKey());
const card = (RP.findCard(CHAT.runId, name)||{});
const hint = ((card.fields||{}).core_traits||"");
const ran = await RP_TASKS.maybeRun(CHAT.runId, name, h, cfg,
function(c,ms,t){ return RP_NET.complete(c,ms,t); }, hint, id);
alert(ran.length ? "已运行: "+ran.join("、") : "未能运行 (检查提示词/聊天记录/网络)");
showATasks(name);
};


/* ================= 写卡助手 ================= */
window.showWriter = ()=>{
__backAction = null;
titleEl.textContent = "写卡助手";
subEl.textContent = "分步采访, 写出能直接开聊的角色卡";
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const ss = RP_WRITER.listSessions();
const cs = RP_WRITER.getCustomChars();
view.innerHTML = `
<div class="card"><div class="secttl">✨ AI 生成角色</div>
<div class="kv">一句话描述你想要的角色, AI 一次生成整张卡: 名字、性格、开场白、示例对话、背景。不满意可换一批, 也可转手动微调。</div>
<div class="field"><label>Describe your character...（一句话描述）</label><textarea id="vibe_desc" rows="2" maxlength="200" placeholder="比如: 嘴硬心软的落魄书生, 表面清高实则渴望被需要" oninput="taCount('vibe_desc','vibe_desc_cnt',200)"></textarea><div class="kv" id="vibe_desc_cnt" style="text-align:right">0/200</div></div>
<div class="btnrow"><button class="btn" id="vibe_btn" onclick="vibeGen()">✨ 生成角色卡</button>
<button class="btn ghost" onclick="vibeToManual()">手动创建</button></div>
<div id="vibe_status" class="hint"></div>
<div id="vibe_preview"></div></div>
<div class="card"><div class="secttl">${icon("dice")} 一键生成角色卡</div>
<div class="kv">只填名字和一句话设定, 一次调用生成完整卡。可重试、可中断, 失败不影响现有流程。</div>
<div class="field"><label>名字</label><input id="qg_name" placeholder="如: 沈清辞"></div>
<div class="field"><label>一句话设定</label><textarea id="qg_premise" rows="2" maxlength="200" placeholder="如: 落魄书生, 表面清高, 说话刻薄但心软" oninput="taCount('qg_premise','qg_premise_cnt',200)"></textarea><div class="kv" id="qg_premise_cnt" style="text-align:right">0/200</div></div>
<div class="btnrow"><button class="btn" id="qg_btn" onclick="quickGenCard()">${icon("play")} 生成</button>
<button id="qg_cancel" style="display:none" onclick="quickGenAbort()">中断</button></div>
<div id="qg_status" class="hint"></div></div>
${ss.length?`<h2 class="sec">未完成的写卡 (${ss.length})</h2>`+ss.map(x=>`
<div class="card"><div class="row"><div><div class="name">${esc(RP_WRITER.STEPS[x.step].name)} · 进行中</div>
<div class="kv">${new Date(x.updatedAt).toLocaleString()} · ${x.history.length} 轮对话</div></div></div>
<div class="btnrow"><button class="btn" onclick="writerChat('${jq(x.id)}')">继续</button>
<button class="btn danger ghost" onclick="if(confirm('放弃这次写卡?')){RP_WRITER.delSession('${jq(x.id)}');showWriter();}">放弃</button></div></div>`).join(""):""}
<h2 class="sec">我的角色卡 (${cs.length})</h2>
${cs.length?`<div class="chargrid">`+cs.map(c=>charCardHTML({
name:c.name, tag:c.novel, sum:String((c.fields&&c.fields.core_identity)||"").slice(0,46)||"自创角色 · 点我直接开聊",
oncard:`chatWith('custom','${jq(c.name)}')`,
ops:`<button class="go" onclick="event.stopPropagation();chatWith('custom','${jq(c.name)}')">开聊</button>`
+`<button onclick="event.stopPropagation();editCard('custom','${jq(c.id)}')">编辑</button>`
+`<button onclick="event.stopPropagation();exportCard('${jq(c.id)}')">导出</button>`
+`<button class="danger" onclick="event.stopPropagation();if(confirm('删除这张角色卡?')){RP_WRITER.delCustom('${jq(c.id)}');showWriter();}">删</button>`
})).join("")+`</div>`:`<div class="empty"><span class="big">${icon("masks",44)}</span>还没有自创角色<br><span style="font-size:calc(12px * var(--fs))">点下面「新建写卡」，和 Ruby 一起创作</span></div>`}
<div class="btnrow"><button class="btn" onclick="newWriter()">${icon("plus")} 新建写卡</button></div>
<div class="hint">写卡全程走你在设置里配的大模型接口, 每步约 1-3 次调用。写完的角色可直接开聊, 也能配分析任务。</div>`;
};

/* ============ P1-3: 一键生成角色卡 ============ */
let QG_ABORT = null;
window.quickGenAbort = ()=>{ if(QG_ABORT){ QG_ABORT.aborted = true; } };
window.quickGenCard = async ()=>{
const cfg = getCfg();
if(!cfg.key || !cfg.base){ alert("先去「设置」填 API 地址和 Key"); return; }
const get = (i)=>document.getElementById(i);
const name = get("qg_name").value.trim(), premise = get("qg_premise").value.trim();
if(!name){ alert("填个名字"); return; }
if(!premise){ alert("填一句话设定"); return; }
const btn = get("qg_btn"), cancel = get("qg_cancel"), status = get("qg_status");
const signal = {aborted:false}; QG_ABORT = signal;
btn.disabled = true; cancel.style.display = ""; status.textContent = "生成中…(可中断)";
try{
const parsed = await RP_WRITER.quickGen(name, premise, cfg,
function(c, ms, t){ return RP_NET.complete(c, ms, t); }, signal);
RP_WRITER.quickFinish(name, parsed);
achvUnlock("card_1");
QG_ABORT = null;
showWriter();
return;
}catch(e){
status.textContent = signal.aborted ? "已中断" : "生成失败: " + e.message + " (可重试)";
}
btn.disabled = false; cancel.style.display = "none"; QG_ABORT = null;
};

/* ============ VibeCreate 式"一句话生成角色" (对标 C.AI VibeCreate) ============ */
let VIBE_STATE = {desc: "", attempt: 0, card: null, busy: false};
const VIBE_PHASES = ["正在生成角色…", "正在构思性格…", "正在写开场白…", "正在润色卡片…"];
function vibePreviewHTML(card){
return `<div class="card" style="background:#fffdf7"><div class="name" style="font-size:calc(16px * var(--fs))">🎭 ${esc(card.name || "未命名")}</div>
<div class="kv">性格</div><div style="font-size:calc(13px * var(--fs));margin-bottom:6px">${esc(card.personality || "—")}</div>
<div class="kv">背景</div><div style="font-size:calc(13px * var(--fs));margin-bottom:6px">${esc(card.background || "—")}</div>
<div class="kv">开场白</div><div class="bub" style="font-size:calc(13px * var(--fs));margin-bottom:6px">${esc(card.greeting || "—")}</div>
<div class="kv">示例对话</div><div style="font-size:calc(12px * var(--fs));white-space:pre-wrap;color:#555">${esc(card.exampleDialogue || "—")}</div>
<div class="btnrow" style="margin-top:10px">
<button class="btn ghost" onclick="vibeGen(true)">🎲 换一批</button>
<button class="btn ghost" onclick="vibeToManual()">✏️ 手动微调</button>
<button class="btn" onclick="vibeSave()">${icon("save")} 保存角色卡</button>
</div></div>`;
}
window.vibeGen = async (shuffle)=>{
if(typeof RP_VIBE === "undefined"){ rpToast("模块未加载"); return; }
if(VIBE_STATE.busy) return;
const cfg = getCfg();
if(!cfg.key || !cfg.base){ alert("先去「设置」填 API 地址和 Key"); return; }
const descEl = document.getElementById("vibe_desc");
const desc = shuffle ? VIBE_STATE.desc : (descEl ? descEl.value.trim() : "");
if(!desc){ rpToast("先用一句话描述你想要的角色"); return; }
if(shuffle) VIBE_STATE.attempt++;
else { VIBE_STATE.desc = desc; VIBE_STATE.attempt = 0; }
VIBE_STATE.busy = true;
const btn = document.getElementById("vibe_btn"), status = document.getElementById("vibe_status"),
  preview = document.getElementById("vibe_preview");
if(btn) btn.disabled = true;
let pi = 0;
if(status) status.textContent = VIBE_PHASES[0];
const timer = setInterval(()=>{ pi = Math.min(pi + 1, VIBE_PHASES.length - 1); if(status) status.textContent = VIBE_PHASES[pi]; }, 2500);
try{
const card = await RP_VIBE.generate(VIBE_STATE.desc, cfg,
  function(c, ms, t){ return RP_NET.complete(c, ms, t); }, VIBE_STATE.attempt);
clearInterval(timer);
VIBE_STATE.card = card;
if(status) status.textContent = "生成完成 ✅";
if(preview) preview.innerHTML = vibePreviewHTML(card);
}catch(e){
clearInterval(timer);
if(status) status.textContent = "";
/* 失败/解析失败: toast 提示, 不中断 (对标 "Failed to generate character (vibe-create)" + "Tap to retry") */
rpToast("生成失败, 点「生成角色卡」重试");
}
VIBE_STATE.busy = false;
if(btn) btn.disabled = false;
};
/* 手动微调: 存为草稿后转入现有写卡表单 (角色卡编辑器) */
window.vibeToManual = ()=>{
const card = VIBE_STATE.card;
if(!card){ rpToast("先生成一张卡, 或点「新建写卡」分步创作"); return; }
const id = vibeSave(true);
if(id) editCard("custom", id);
};
window.vibeSave = (silent)=>{
const card = VIBE_STATE.card;
if(!card){ rpToast("没有可保存的卡片"); return null; }
const fields = RP_VIBE.toCardFields(card);
const list = RP_WRITER.getCustomChars() || [];
const id = "c" + Date.now().toString(36);
list.unshift({id: id, name: card.name || "未命名", novel: "自定义", worldRunId: "",
  fields: fields,
  altGreetings: card.greeting ? [card.greeting] : [],
  exampleDialogue: card.exampleDialogue || "",
  createdAt: Date.now()});
RP_WRITER.saveCustomChars(list);
try{ achvUnlock("card_1"); }catch(e){}
VIBE_STATE.card = null;
if(!silent){ rpToast("已保存"); showWriter(); }
return id;
};

/* ============ P1-2: 角色卡编辑器(自创卡/导入卡通用) ============ */
window.editCard = (src, id)=>{
const card = src==="custom"
? (RP_WRITER.getCustomChars()||[]).find(c=>c.id===id)
: RP_CARDIMPORT.findById(id);
if(!card){ alert("卡片不存在"); return; }
__backAction = ()=>{ src==="custom" ? showWriter() : showTraverse(); };
titleEl.textContent = "编辑角色卡";
subEl.textContent = esc(card.name) + (src==="custom"?" · 自创卡":" · 导入卡");
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const f = card.fields || {};
const aiFilled = (card.aiFilled && typeof card.aiFilled === "object") ? card.aiFilled : {};
const rows = Object.keys(RP_PROMPT.LABELS).map(k=>{
const v = f[k]==null?"":String(f[k]);
/* 功能一: AI 补完的字段打来源标注 */
const aiBadge = aiFilled[k] ? ` <span class="badge">AI 补完</span>` : "";
return `<div class="field"><label>${esc(RP_PROMPT.LABELS[k])}${aiBadge} <span class="dim">${esc(k)}</span></label>`
+ `<textarea id="cef_${k}" rows="2" oninput="tokCount('cef_${k}','ce_tok')">${esc(v)}</textarea></div>`;
}).join("");
const alt = (card.altGreetings||[]).join("\n");
const exd = card.exampleDialogue||"";
/* P0 卡兼容: 导入卡的 ST 一等字段可视可改 (system_prompt/post_history_instructions/creator_notes/scenario) */
const sysp = card.systemPrompt||"";
const phi = card.postHistoryInstructions||"";
const cnote = card.creatorNotes||"";
const scen = card.scenario||"";
/* S-5/S-6/S-9: 文风档/温度/行为标签 */
const flairOpts = `<option value="">默认（跟全局）</option>` + Object.keys(RP_PROMPT.FLAIR).map(k=>
`<option value="${k}"${card.flair===k?" selected":""}>${esc(RP_PROMPT.FLAIR[k].name)} · ${esc(RP_PROMPT.FLAIR[k].desc)}</option>`).join("");
const temp = (card.temperature != null && isFinite(+card.temperature)) ? +card.temperature : "";
const tagsIn = (card.tags||[]).join(",");
view.innerHTML = `
<div class="hint">修改后点「保存」写回, prompt 注入、开场白、导出都用新内容。<span id="ce_tok" class="dim"></span></div>
<div class="setcard"><div class="secttl">角色模板 · 一键填充</div>
<div class="btnrow">${RP_WRITER.CARD_TEMPLATES.map(t=>`<button class="btn ghost" onclick="fillCardTemplate('${jq(t.id)}')">${esc(t.name)}<span class="dim"> · ${esc(t.desc)}</span></button>`).join("")}</div>
<div class="hint">填充会覆盖当前表单内容（清空重写），请先确认。</div></div>
<div class="setcard">
<div class="field"><label>名字</label><input id="ce_name" value="${esc(card.name)}"></div>
<div class="field"><label>多开场白 <span class="dim">alternate_greetings · 每行一条, 开聊固定用首条(first_mes)</span></label>
<textarea id="ce_alt" rows="3" oninput="tokCount('ce_alt','ce_tok')">${esc(alt)}</textarea></div>
<div class="field"><label>示例对话 <span class="dim">extensions.example_dialogue · 进 prompt 的 few-shot</span></label>
<textarea id="ce_exd" rows="4" oninput="tokCount('ce_exd','ce_tok')">${esc(exd)}</textarea></div>
<div class="field"><label>系统提示词 <span class="dim">system_prompt · 进 system 开头</span></label>
<textarea id="ce_sysp" rows="4" oninput="tokCount('ce_sysp','ce_tok')">${esc(sysp)}</textarea></div>
<div class="field"><label>历史后指令 <span class="dim">post_history_instructions · 历史之后、生成之前</span></label>
<textarea id="ce_phi" rows="3" oninput="tokCount('ce_phi','ce_tok')">${esc(phi)}</textarea></div>
<div class="field"><label>作者注 <span class="dim">creator_notes · 进 system</span></label>
<textarea id="ce_cnote" rows="2" oninput="tokCount('ce_cnote','ce_tok')">${esc(cnote)}</textarea></div>
<div class="field"><label>场景设定 <span class="dim">scenario · 进【背景】段</span></label>
<textarea id="ce_scen" rows="3" oninput="tokCount('ce_scen','ce_tok')">${esc(scen)}</textarea></div>
<div class="field"><label>文风档 <span class="dim">flair · 角色级文风，覆盖全局预设</span></label>
<select id="ce_flair">${flairOpts}</select></div>
<div class="field"><label>温度 <span class="dim">temperature · 0.6~1.8，空=用全局</span></label>
<input id="ce_temp" type="number" min="0.6" max="1.8" step="0.05" value="${esc(temp)}" placeholder="如 0.95"></div>
${typeof RP_SOUL_CFG!=="undefined" ? RP_SOUL_CFG.bindSelectHTML(card) : ""}
<div class="field"><label>行为标签 <span class="dim">tags · 逗号分隔，如 傲娇,毒舌 · 进 system</span></label>
<input id="ce_tags" value="${esc(tagsIn)}"></div>
</div>
<div class="setcard"><div class="secttl">角色字段</div>${rows}</div>
<div class="btnrow"><button class="btn" onclick="saveCardEdit('${jq(src)}','${jq(id)}')">${icon("save")} 保存</button>
<button onclick="__backAction()">取消</button></div>`;
};
/* Tier2 #17: 角色卡模板一键填充 (对标 C.AI CreateCharacter definition-template)。
 * 数组字段按行展开；覆盖前 confirm。 */
window.fillCardTemplate = (tid)=>{
const t = (RP_WRITER.CARD_TEMPLATES||[]).find(x=>x.id===tid);
if(!t) return;
if(!confirm(`用「${t.name}」模板填充？\n当前表单内容会被覆盖。`)) return;
Object.keys(RP_PROMPT.LABELS).forEach(k=>{
const ta = document.getElementById("cef_"+k);
if(!ta) return;
let v = (t.fields && t.fields[k] != null) ? t.fields[k] : "";
if(Array.isArray(v)) v = v.join("\n");
ta.value = String(v);
});
tokCount("ce_name","ce_tok");
};
window.saveCardEdit = (src, id)=>{
const get = (i)=>document.getElementById(i);
const name = get("ce_name").value.trim() || "未命名";
const f = {};
Object.keys(RP_PROMPT.LABELS).forEach(k=>{
const v = get("cef_"+k).value.trim();
if(v) f[k] = v;
});
const alt = get("ce_alt").value.split("\n").map(s=>s.trim()).filter(Boolean).slice(0,8);
const exd = get("ce_exd").value.trim();
const sysp = get("ce_sysp").value.trim();
const phi = get("ce_phi").value.trim();
const cnote = get("ce_cnote").value.trim();
const scen = get("ce_scen").value.trim();
const flair = get("ce_flair").value.trim();
const tempRaw = get("ce_temp").value.trim();
const temp = tempRaw === "" ? null : Math.max(0.6, Math.min(1.8, +tempRaw || 0.9));
const tags = get("ce_tags").value.split(/[,，、]/).map(s=>s.trim()).filter(Boolean).slice(0,12);
if(src==="custom"){
const list = RP_WRITER.getCustomChars()||[];
const i = list.findIndex(c=>c.id===id);
if(i<0){ alert("卡片不存在"); return; }
list[i] = Object.assign({}, list[i], {name, fields:f, altGreetings:alt, exampleDialogue:exd,
systemPrompt:sysp, postHistoryInstructions:phi, creatorNotes:cnote, scenario:scen,
flair:flair||"", temperature:temp, tags:tags});
/* Soul 模型绑定 */
try{
  if(typeof RP_SOUL!=="undefined" && typeof RP_SOUL_CFG!=="undefined"){
    RP_SOUL.bindProfile(list[i], RP_SOUL_CFG.readBindSelect());
  }
}catch(e){}
RP_WRITER.saveCustomChars(list);
}else{
const c = RP_CARDIMPORT.findById(id);
if(!c){ alert("卡片不存在"); return; }
/* 功能一: 保留 AI 补完来源标注(字段被清空则去掉标注) */
const keepAi = {};
Object.keys((c.aiFilled||{})).forEach(k=>{ if(f[k] && String(f[k]).trim()) keepAi[k] = true; });
RP_CARDIMPORT.update(Object.assign({}, c, {name, fields:f, altGreetings:alt, exampleDialogue:exd,
systemPrompt:sysp, postHistoryInstructions:phi, creatorNotes:cnote, scenario:scen,
flair:flair||"", temperature:temp, tags:tags, aiFilled:keepAi}));
/* Soul 模型绑定 (导入卡) */
try{
  if(typeof RP_SOUL!=="undefined" && typeof RP_SOUL_CFG!=="undefined"){
    var _uc = RP_CARDIMPORT.findById(id);
    if(_uc){ RP_SOUL.bindProfile(_uc, RP_SOUL_CFG.readBindSelect()); RP_CARDIMPORT.update(_uc); }
  }
}catch(e){}
}
alert("已保存");
if(src==="custom") showWriter(); else showTraverse();
};
window.newWriter = ()=>{
__backAction = ()=>showWriter();
const runs = (window.__DATA__.index||[]).map(r=>`<option value="${r.run_id}">${esc(r.novel)}</option>`).join("");
titleEl.textContent = "新建写卡";
subEl.textContent = "";
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
view.innerHTML = `<div class="setcard">
<div class="field"><label>世界观 (可选, 绑定后聊天时可调用该小说的世界书)</label>
<select id="w_world"><option value="">不绑定</option>${runs}</select></div>
<div class="btnrow"><button class="btn" onclick="startWriter()">开始采访</button>
<button class="btn ghost" onclick="showWriter()">返回</button></div></div>`;
};
window.startWriter = ()=>{
const s = RP_WRITER.newSession($("#w_world").value);
writerChat(s.id);
};
window.writerChat = (id)=>{
__backAction = ()=>showWriter();
const s = RP_WRITER.getSession(id);
if(!s){ showWriter(); return; }
const st = RP_WRITER.STEPS[s.step];
titleEl.textContent = "写卡 · " + st.name;
subEl.textContent = st.desc;
document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
const log = s.history.map(m=>`<div class="msg ${m.role==="user"?"me":"ai"}"><div class="bub">${esc(m.content).replace(/\n/g,"<br>")}</div></div>`).join("");
view.innerHTML = `
<div class="hint">第 ${s.step+1}/5 步 · ${esc(st.name)}: ${esc(st.desc)}</div>
<div id="wlog">${log || `<div class="empty">Ruby 正在组织语言…</div>`}</div>
<div class="chatbar"><input id="w_in" placeholder="和 Ruby 聊聊…" onkeydown="if(event.key==='Enter')sendWriterMsg('${id}')" oninput="tokCount('w_in','w_tok')">
<button onclick="sendWriterMsg('${jq(id)}')">发送</button></div>
<div class="tokline" id="w_tok" style="padding:0 14px"></div>
<div class="btnrow" style="margin-top:8px">
${s.step<3?`<button class="btn" onclick="finalizeStep('${jq(id)}')">✅ 定稿, 进入下一步</button>`:""}
${s.step===3?`<button class="btn" onclick="genCardUI('${jq(id)}')">🎴 生成人设卡</button>`:""}
${s.step===4?`<button class="btn" onclick="finishWriterUI('${jq(id)}')">${icon("save")} 保存角色卡</button>`:""}
<button class="btn ghost" onclick="showWriter()">稍后继续</button></div>
<div id="wsum"></div>`;
if(!s.history.length){
const cfg = getCfg();
if(!cfg.key){ document.getElementById("wlog").innerHTML = `<div class="empty">先去「设置」配好 API 才能采访。</div>`; return; }
RP_NET.complete(cfg, [{role:"system", content: RP_WRITER.interviewPrompt(s.step, s)},
{role:"user", content:"开始吧, 先跟我打个招呼, 然后开始这一步的采访。"}], 0.8)
.then(t=>{ const s2 = RP_WRITER.getSession(id); if(!s2||s2.history.length) return;
s2.history.push({role:"assistant", content:t}); RP_WRITER.saveSession(s2); writerChat(id); })
.catch(e=>{ document.getElementById("wlog").innerHTML = `<div class="empty">请求失败: ${esc(e.message)}</div>`; });
}
};
window.sendWriterMsg = async (id)=>{
const inp = $("#w_in"); const text = inp.value.trim(); if(!text) return;
const cfg = getCfg(); if(!cfg.key){ alert("先去设置里配 API"); return; }
const s = RP_WRITER.getSession(id); if(!s) return;
s.history.push({role:"user", content:text}); RP_WRITER.saveSession(s); writerChat(id);
try{
const t = await RP_NET.complete(cfg,
[{role:"system", content: RP_WRITER.interviewPrompt(s.step, s)}]
.concat(s.history.map(m=>({role:m.role, content:m.content}))), 0.8);
const s2 = RP_WRITER.getSession(id); s2.history.push({role:"assistant", content:t}); RP_WRITER.saveSession(s2);
writerChat(id);
}catch(e){ alert("请求失败: "+e.message); }
};
window.finalizeStep = async (id)=>{
const cfg = getCfg(); if(!cfg.key){ alert("先去设置里配 API"); return; }
const s = RP_WRITER.getSession(id); if(!s||!s.history.length){ alert("先聊几句再定稿"); return; }
if(!confirm("把本步采访定稿, 进入下一步?")) return;
try{
const sum = await RP_WRITER.summarize(RP_WRITER.STEPS[s.step].id, s.history, cfg,
function(c,ms,t){ return RP_NET.complete(c,ms,t); });
s.summaries[RP_WRITER.STEPS[s.step].id] = sum;
s.step = Math.min(s.step+1, 4); s.history = [];
RP_WRITER.saveSession(s);
alert("定稿已保存 ✅\n\n"+sum.slice(0,300));
writerChat(id);
}catch(e){ alert("定稿失败: "+e.message); }
};
window.genCardUI = async (id)=>{
const cfg = getCfg(); if(!cfg.key){ alert("先去设置里配 API"); return; }
if(!confirm("根据前三步定稿生成完整人设卡? (约 1 次调用)")) return;
try{
const s = RP_WRITER.getSession(id);
const fields = await RP_WRITER.genCard(s, cfg, function(c,ms,t){ return RP_NET.complete(c,ms,t); });
s.card = fields; s.step = 4; s.history = [];
RP_WRITER.saveSession(s);
writerChat(id);
alert("人设卡已生成, 进自检前先看一眼, 下一步可清洗。");
}catch(e){ alert("生成失败: "+e.message); }
};
window.finishWriterUI = async (id)=>{
const s = RP_WRITER.getSession(id); if(!s||!s.card){ alert("卡片还没生成"); return; }
const cfg = getCfg();
const keys = Object.keys(s.card);
const preview = keys.map(k=>"- "+k+": "+String(s.card[k]).slice(0,80)).join("\n");
if(!confirm("先自检清洗一遍? (推荐, 约 1 次调用)\n\n"+preview.slice(0,400))){
return saveWriterChar(id);
}
try{
s.card = await RP_WRITER.selfCheck(s.card, cfg, function(c,ms,t){ return RP_NET.complete(c,ms,t); });
RP_WRITER.saveSession(s);
alert("自检完成 ✅");
}catch(e){ alert("自检失败, 用原卡继续: "+e.message); }
saveWriterChar(id);
};
function saveWriterChar(id){
const s = RP_WRITER.getSession(id); if(!s) return;
const name = prompt("给这个角色起个名字:", "");
if(!name||!name.trim()) return;
const novel = prompt("故事/世界名 (显示用):", "自定义");
try{
RP_WRITER.finish(id, name.trim(), (novel||"自定义").trim());
chatWith("custom", name.trim());
}catch(e){ alert("保存失败: "+e.message); }
}

/* ============ P0-4 新手引导 (localStorage.nd_onboarded) ============ */
window.showOnboard = (step)=>{
step = Math.min(Math.max(step||1, 1), 3);
let ob = document.getElementById("onboard");
if(!ob){
ob = document.createElement("div");
ob.id = "onboard"; ob.className = "onboard";
document.body.appendChild(ob);
}
const S = [
{ t:"第 1 步 · 配置 API Key",
d:"去「设置」填入你的 LLM Key<br>(OpenAI 兼容接口均可, 如硅基流动 / DeepSeek)。",
btns:[["去设置配 Key","onboardDone();setNav('settings')"],["下一步 →","showOnboard(2)"]] },
{ t:"第 2 步 · 选一个角色",
d:"从蒸馏人物里选一位开聊,<br>或自己写一张原创角色卡。",
btns:[["去选角色","onboardDone();setNav('chat')"],["自己写卡","onboardDone();setNav('writer')"],["下一步 →","showOnboard(3)"]] },
{ t:"第 3 步 · 开始聊天",
d:"一切就绪 —— 点开一位角色,<br>开始你的第一场对话吧！",
btns:[["开始聊天","onboardDone();setNav('chat')"]] },
];
const s = S[step-1];
ob.innerHTML = `<div class="obcard">
<div class="obdots">${[1,2,3].map(i=>`<span class="${i===step?"on":""}"></span>`).join("")}</div>
<h2>${s.t}</h2><p>${s.d}</p>
<div class="btnrow">${s.btns.map(b=>`<button class="btn" onclick="${b[1]}">${b[0]}</button>`).join("")}</div>
<button class="obskip" onclick="onboardDone()">跳过引导</button>
</div>`;
ob.classList.add("on");
};
window.onboardDone = ()=>{
try{ localStorage.setItem("nd_onboarded", "1"); }catch(e){}
const ob = document.getElementById("onboard");
if(ob) ob.classList.remove("on");
};

/* ---------- 启动 ---------- */
window.setNav = setNav; window.showTasks = showTasks; window.showChat = showChat;
window.setTab = setTab; window.openRun = openRun;
(async function startApp(){
if(typeof RP_PIN!=="undefined" && RP_PIN.has()){
await pinUnlockScreen(); /* P1-7: PIN 未验证通过前不进主界面 */
}
await boot();
/* P2: 应用壁纸/字体；后台把大文件复制到 IndexedDB（复制模式：localStorage 副本保留，同步读取不受影响；失败自动回退 localStorage） */
try{ applyAppearance(); }catch(e){}
try{ if(typeof RP_STORE!=="undefined"){ RP_STORE.warmCache().catch(()=>{}); RP_STORE.migrate().catch(()=>{}); } }catch(e){}
/* 存储配额：向系统申请持久化存储，避免大文件被自动清理；超大文件走原生文件层（2GB，App 私有目录） */
try{ if(typeof navigator!=="undefined" && navigator.storage && typeof navigator.storage.persist==="function"){ navigator.storage.persist().catch(()=>{}); } }catch(e){}
/* Tier3-24: 冷启动也算一次"回到前台"，检查是否需要角色召回本地通知 */
try{ maybeRecallNotify(); }catch(e){}
if(!localStorage.getItem("nd_onboarded")) showOnboard(1);
})();

/* ================= 穿越 P0: 魂穿 / 肉身穿越 ================= */
function travPlayerName(){
  if(CHAT.mode === "traverse"){
    const trav = RP_TRAVERSE.get(CHAT.travId);
    if(trav){
      if(trav.mode === "plotline") return "旅人";
      if(trav.mode === "soul" || trav.mode === "isekai" || trav.mode === "party") return trav.charName || "我";
      const idt = RP_TRAVERSE.getIdentity(trav.identityId);
      return (idt && idt.name) || "我";
    }
  }
  return "我";
}
function travWorlds(){
  const out = [];
  (INDEX || []).forEach(r=>out.push({kind:"book", id:r.run_id,
    name:"《"+r.novel+"》", sub:"蒸馏世界 · "+r.run_id}));
  try{ RP_CARDIMPORT.list().forEach(c=>out.push({kind:"card", id:c.id,
    name:"《"+c.name+"》的世界", sub:"导入角色卡"})); }catch(e){}
  return out;
}
function showTraverse(){
  __backAction = null;
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("book-open")+" 穿越"; subEl.textContent = "进入书里活";
  const hintTimeline = `<div class="hint" style="margin:0 0 10px">🕰️ 穿越是独立的时间线：这里发生的事，不会影响「聊天」里的对话和记忆。</div>`;
  const modes = [
    {id:"plotline", ic:"clapperboard", name:"走原著线", desc:"沿导演因果蓝图推进剧情，在决策点做选择", ok:true, seal:"迹"},
    {id:"soul", ic:"user", name:"魂穿", desc:"成为TA：扮演原著角色，走进TA的人生", ok:true, seal:"魂"},
    {id:"body", ic:"users", name:"肉身穿越", desc:"成为自己：现代人直穿，或捏一个古代身份", ok:true, seal:"身"},
    {id:"isekai", ic:"repeat", name:"异世界穿越", desc:"把角色送进另一部作品（林黛玉去水浒）", ok:true, seal:"异"},
    {id:"party", ic:"chat", name:"组团穿越", desc:"和多名角色组队一起穿", ok:true, seal:"众"},
  ];
  const recents = RP_TRAVERSE.recent();
  view.innerHTML = `
  <div class="golden-hero" onclick="goldenPickBook()">
    <div><div class="gh-title">✨ 一键魂穿开局</div>
    <div class="gh-desc">选书 → 选人 → 选开场，3 步直入原著因果线</div></div>
    <div class="tm-go">›</div>
  </div>
  ${hintTimeline}
  <div class="travmodes">${modes.map(m=>`
    <div class="travmode${m.ok?"":" locked"}" ${m.ok?`onclick="travMode('${jq(m.id)}')"`:""}>
      ${m.seal?`<div class="tm-seal" aria-hidden="true">${m.seal}</div>`:""}
      <div class="tm-icon">${icon(m.ic,26)}</div>
      <div class="tm-body"><div class="tm-name">${m.name}</div>
      <div class="tm-desc">${m.desc}</div></div>
      ${m.ok?`<div class="tm-go">›</div>`:`<div class="tm-desc">即将到来</div>`}
    </div>`).join("")}</div>
  <h2 class="sec">酒馆角色卡</h2>
  <div class="card"><div class="kv">把 SillyTavern 角色卡（PNG/JSON）导进来，也能穿进 TA 的世界</div>
  <div class="btnrow" style="margin-top:8px"><button class="btn" onclick="travImport()">${icon("upload")} 导入角色卡</button>
  <button class="btn ghost" onclick="travVisionPick()">🖼️ 看图写卡</button></div>
  <div class="hint">看图写卡：选一张没有内嵌卡片数据的图片，AI 识别图中人物并写成角色卡（一图多人会自动拆成多张）。需要 vision 模型。</div>
  <div id="impList" style="margin-top:8px">${importedListHTML()}</div></div>
  <h2 class="sec">最近穿越</h2>
  <div>${recents.length ? recents.map(travRecentHTML).join("") : `<div class="empty-illust"><img src="bg/empty_state.jpg" alt=""><div>还没有穿越过，从上面选一种模式开始吧</div></div>`}</div>
  <input type="file" id="travFile" accept=".png,.json" style="display:none" onchange="travImportFile(this)">
  <input type="file" id="travVisionFile" accept="image/*" style="display:none" onchange="travVisionFile(this)">`;
  window.scrollTo(0,0);
}
function importedListHTML(){
  let list = [];
  try{ list = RP_CARDIMPORT.list(); }catch(e){}
  if(!list.length) return `<div class="meta">还没有导入过角色卡</div>`;
  return list.map(c=>`<div class="kvline" style="display:flex;align-items:center;gap:8px"><span>${esc(c.name)}</span>
  <span class="meta"> ${esc(c.novel)}</span><span style="flex:1"></span>
  <button class="btn ghost sm" onclick="event.stopPropagation();editCard('imported','${jq(c.id)}')">编辑</button>
  <button class="btn ghost sm" onclick="event.stopPropagation();travDelImport('${jq(c.id)}')">删除</button></div>`).join("");
}
function travRecentHTML(t){
  const who = t.mode==="plotline" ? "旅人" : t.mode==="soul" ? t.charName : ((RP_TRAVERSE.getIdentity(t.identityId)||{}).name || "无名氏");
  const d = new Date(t.updatedAt).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
  return `<div class="card card--tap" onclick="travResume('${jq(t.id)}')">
  <div class="row"><div class="avatar">${esc(who[0]||"穿")}</div>
  <div><div class="name">${esc(who)} <span class="badge">${RP_TRAVERSE.MODES[t.mode]||""}</span></div>
  <div class="meta">${esc(t.worldName)} · ${esc(t.anchorTitle||"")} · ${d}</div></div></div></div>`;
}
window.travMode = (m)=>{
  if(m==="soul") soulPickTarget();
  else if(m==="body") bodyPickWorld();
  else if(m==="isekai") isekaiPickSrc();
  else if(m==="party") partySetup();
  else if(m==="plotline") plotlinePickBook();
};
/* 走原著线：选书 → 选幕（断点续玩）→ 开局 */
function plotlinePickBook(){
  const idx = (window.__DATA__ && window.__DATA__.index) || [];
  const runs = idx.filter(r => r.has_worldcard);
  titleEl.innerHTML = icon("clapperboard")+" 走原著线"; subEl.textContent = "选一本书，沿原著因果线推进";
  view.innerHTML = `<button class="back" onclick="showTraverse()">‹ 返回穿越</button>`
    + (runs.length ? runs.map(r=>`<div class="card card--tap" onclick="plotlinePickStage('${jq(r.run_id)}')">
      <div class="name">${esc(r.novel)}</div><div class="meta">${esc(r.run_id)} · <span class="badge">有世界卡</span></div></div>`).join("")
      : `<div class="empty">暂无带世界卡的书<br><span style="font-size:calc(12px * var(--fs))">管线执行 worldcard 阶段后自动出现</span></div>`);
  window.scrollTo(0,0);
}
function plotlinePickStage(runId){
  titleEl.innerHTML = icon("clapperboard")+" 走原著线"; subEl.textContent = "选一幕";
  view.innerHTML = skeletonHTML(4);
  loadWorldcard(runId).then(()=>{
    const stages = (typeof RP_PLOTRUN!=="undefined") ? RP_PLOTRUN.listStages(runId) : [];
    view.innerHTML = `<button class="back" onclick="plotlinePickBook()">‹ 返回选书</button>`
      + `<h2 class="sec">选一幕 · ${stages.length} 幕</h2>`
      + (stages.length ? stages.map(s=>`<div class="card card--tap" onclick="plotlineStart('${jq(runId)}','${jq(s.id)}','${jq(s.plotrunId||"")}')">
        <div class="row"><div><div class="name">${esc(s.title)}</div>
        <div class="meta">${s.done}/${s.total} 节点（${s.pct}%）${s.finished?' · <span class="badge">已走完</span>':(s.resumable?' · <span class="badge">继续</span>':"")}</div>
        ${s.description?`<div class="st">${esc(s.description)}</div>`:""}</div><div class="tm-go">›</div></div></div>`).join("")
        : `<div class="empty">该书暂无导演分幕数据</div>`);
    window.scrollTo(0,0);
  });
}
function plotlineStart(runId, stageId, plotrunId){
  let st = plotrunId ? RP_PLOTRUN.load(plotrunId) : null;
  if(!st) st = RP_PLOTRUN.start(runId, stageId);
  const idx = (window.__DATA__ && window.__DATA__.index) || [];
  const r = idx.find(x=>x.run_id===runId) || {};
  const sess = RP_TRAVERSE.newSession({mode:"plotline", worldKind:"book", worldId:runId,
    worldName:r.novel||runId, charName:"", anchorTitle:"走原著线", plotrunId:st.id});
  CHAT = {mode:"traverse", travId:sess.id};
  setNav("chat");
}
/* ============ 方向三：黄金路径 · 一键魂穿开局 ============
 * 3 屏：选书 → 选人+导演风格 → 选开场（沉浸式），直入 plotrun 剧情运行时。 */
function goldenPickBook(){
  const idx = (window.__DATA__ && window.__DATA__.index) || [];
  const runs = idx.filter(r => r.has_worldcard);
  let resumable = {};
  try{ (RP_PLOTRUN.allStates()||[]).forEach(s=>{ resumable[s.runId] = true; }); }catch(e){}
  titleEl.innerHTML = "✨ 一键魂穿开局"; subEl.textContent = "3 步进入原著因果线";
  view.innerHTML = `<button class="back" onclick="showTraverse()">‹ 返回穿越</button>
  <div class="hint" style="margin:8px 2px">选一本书 → 选魂穿人物与导演风格 → 选开场，直入原著剧情线</div>`
    + (runs.length ? runs.map((r,i)=>{
      const cover = (window.BOOKCOVER||{})[r.novel];
      return `<div class="card card--tap" onclick="goldenPickChar(${jq(i)})">
      <div class="row">${cover?`<img class="bookcover gbk" src="${esc(cover)}" alt="${esc(r.novel)}封面" loading="lazy" onerror="this.remove()">`:""}<div><div class="name">《${esc(r.novel)}》</div>
      <div class="meta">${esc(r.run_id)}${resumable[r.run_id]?' · <span class="badge">可继续</span>':""}</div>
      </div><div class="tm-go" style="margin-left:auto">›</div></div></div>`;}).join("")
      : `<div class="empty">暂无带世界卡的书<br><span style="font-size:calc(12px * var(--fs))">管线执行 worldcard 阶段后自动出现</span></div>`);
  window._goldenRuns = runs;
  window.scrollTo(0,0);
}
window.goldenPickChar = (i)=>{
  const r = (window._goldenRuns||[])[i]; if(!r) return;
  const run = ((window.__DATA__||{}).runs||{})[r.run_id] || {};
  const chars = (run.characters && run.characters.length ? run.characters : (r.characters||[])).slice(0, 24);
  window._golden = {bookIdx:i, runId:r.run_id, novel:r.novel, chars:chars, charIdx:-1, style:"slowburn", openingIdx:0};
  const styles = (typeof RP_DIRECTOR!=="undefined" && RP_DIRECTOR.STYLES) ? RP_DIRECTOR.STYLES : {slowburn:{name:"慢热",desc:""}};
  window._goldenStyles = Object.keys(styles);
  titleEl.innerHTML = "✨ 一键魂穿开局"; subEl.textContent = "第 2 步 · 选人与风格";
  view.innerHTML = `<button class="back" onclick="goldenPickBook()">‹ 返回选书</button>
  <h2 class="sec">魂穿成谁？《${esc(r.novel)}》</h2>
  <div class="gchars">
    <div class="gchip sel" data-ci="-1" onclick="goldenSetChar(-1)">路人</div>
    ${chars.map((c,ci)=>`<div class="gchip" data-ci="${ci}" onclick="goldenSetChar(${ci})">${esc(c)}</div>`).join("")}
  </div>
  <h2 class="sec">导演风格</h2>
  <div class="gstyles">${Object.keys(styles).map((k,si)=>`
    <div class="gstyle${k==="slowburn"?" sel":""}" data-si="${si}" onclick="goldenSetStyle(${jq(si)})">
      <div class="name">${esc(styles[k].name)}</div><div class="st">${esc(styles[k].desc||"")}</div>
    </div>`).join("")}</div>
  <div class="btnrow" style="margin-top:14px"><button class="btn primary" onclick="goldenOpening()">下一步 · 选开场 ›</button></div>`;
  window.scrollTo(0,0);
};
window.goldenSetChar = (ci)=>{
  const g = window._golden; if(!g) return; g.charIdx = ci;
  document.querySelectorAll(".gchip").forEach(el=>el.classList.toggle("sel", +el.dataset.ci===ci));
};
window.goldenSetStyle = (si)=>{
  const g = window._golden; if(!g) return;
  g.style = (window._goldenStyles||[])[si] || g.style;
  document.querySelectorAll(".gstyle").forEach(el=>el.classList.toggle("sel", +el.dataset.si===si));
};
window.goldenOpening = ()=>{
  const g = window._golden; if(!g) return;
  titleEl.innerHTML = "✨ 一键魂穿开局"; subEl.textContent = "第 3 步 · 选开场";
  view.innerHTML = skeletonHTML(3);
  window.scrollTo(0,0);
  loadWorldcard(g.runId).then(()=>{
    const charName = g.charIdx >= 0 ? g.chars[g.charIdx] : "";
    let ops = [];
    try{ ops = cardOpenings(g.runId, charName) || []; }catch(e){}
    if(!ops.length && g.chars.length){ try{ ops = cardOpenings(g.runId, g.chars[0]) || []; }catch(e){} }
    g.ops = ops.slice(0, 6);
    let anchors = [], stageTitle = "", stageTotal = 0;
    try{
      const wc = getWorldcard(g.runId);
      const dd = wc && wc.directorDefinitions && wc.directorDefinitions[0];
      anchors = (dd && dd.anchors || []).slice(0, 6);
      const stages = RP_PLOTRUN.listStages(g.runId);
      if(stages.length){ stageTitle = stages[0].title; stageTotal = stages[0].total; }
    }catch(e){}
    const styleName = ((typeof RP_DIRECTOR!=="undefined" && RP_DIRECTOR.STYLES && RP_DIRECTOR.STYLES[g.style]) || {}).name || g.style;
    view.innerHTML = `<div class="gopening">
      <button class="back" onclick="goldenPickChar(${jq(g.bookIdx)})">‹ 返回</button>
      <div class="go-kicker">《${esc(g.novel)}》 · ${charName ? "魂穿"+esc(charName) : "路人开局"} · ${esc(styleName)}</div>
      ${anchors.length ? `<div class="go-anchors">${anchors.map(a=>`<span class="badge">${esc(String(a).slice(0,18))}</span>`).join("")}</div>` : ""}
      <h2 class="sec" style="color:var(--ink);border:none">选一个开场</h2>
      <div class="go-ops">${g.ops.length ? g.ops.map((o,oi)=>`
        <div class="go-op${oi===0?" sel":""}" data-oi="${oi}" onclick="goldenSetOpening(${jq(oi)})">
          ${o.label?`<span class="badge">${esc(o.label)}</span>`:""}
          <div class="go-text">${esc(String(o.text||"").slice(0,160))}${String(o.text||"").length>160?"…":""}</div>
        </div>`).join("") : `<div class="empty">暂无管线开场白，将由 AI 现场生成</div>`}</div>
      ${stageTitle?`<div class="go-stage">📜 第一幕 · ${esc(stageTitle)}（${stageTotal} 节点）</div>`:""}
      <button class="go-enter" onclick="goldenStart()">进入原著线 →</button>
    </div>`;
    window.scrollTo(0,0);
  });
};
window.goldenSetOpening = (oi)=>{
  const g = window._golden; if(!g) return; g.openingIdx = oi;
  document.querySelectorAll(".go-op").forEach(el=>el.classList.toggle("sel", +el.dataset.oi===oi));
};
window.goldenStart = ()=>{
  const g = window._golden; if(!g || !g.runId) return;
  loadWorldcard(g.runId).then(()=>{
    try{ const c = getRpCfg(); c.directorStyle = g.style || c.directorStyle; saveRpCfg(c); }catch(e){}
    let st = null;
    try{
      const stages = RP_PLOTRUN.listStages(g.runId);
      for(const s of stages){ if(s.resumable){ st = RP_PLOTRUN.load(s.plotrunId); break; } }
      if(!st && stages.length) st = RP_PLOTRUN.start(g.runId, stages[0].id);
    }catch(e){}
    const idx = (window.__DATA__ && window.__DATA__.index) || [];
    const r = idx.find(x=>x.run_id===g.runId) || {};
    const charName = g.charIdx >= 0 ? g.chars[g.charIdx] : "";
    const sess = RP_TRAVERSE.newSession({mode:"soul", worldKind:"book", worldId:g.runId,
      worldName:r.novel||g.runId, charName:charName, anchorTitle:"一键魂穿", plotrunId: st?st.id:null});
    try{
      const op = (g.ops||[])[g.openingIdx||0];
      if(op && op.text) saveHist("nd_travchat_"+sess.id, [{role:"assistant", content:op.text, ts:Date.now()}]);
    }catch(e){}
    CHAT = {mode:"traverse", travId:sess.id};
    setNav("chat");
  });
};
window.travResume = (id)=>{
  const t = RP_TRAVERSE.get(id); if(!t){ alert("会话已删除"); showTraverse(); return; }
  CHAT = {mode:"traverse", travId:id};
  setNav("chat");
};
window.travImport = ()=>{ const f=$("#travFile"); if(f){ f.value=""; f.click(); } };
window.travImportFile = async (inp)=>{
  const file = inp.files && inp.files[0]; if(!file) return;
  try{
    const card = await RP_CARDIMPORT.fromFile(file);
    if(!confirm(`导入角色卡「${card.name}」？\n${(card.scenario||card.fields.core_identity||"").slice(0,80)}`)) return;
    RP_CARDIMPORT.add(card);
    achvUnlock("card_1");
    /* 功能一: AI 补完缺失层。关键层缺 2 个以上才提示, 用户确认才调模型 */
    const miss = (typeof RP_CARDIMPORT.missingGapfillKeys === "function")
      ? RP_CARDIMPORT.missingGapfillKeys(card) : [];
    if(miss.length >= 2){ cardGapfillPrompt(card.id, miss, []); return; }
    alert(`已导入「${card.name}」：魂穿目标和卡片世界里都能选到`);
    showTraverse();
  }catch(e){ alert("导入失败："+e.message); }
};
/* ---- 功能一: 角色卡 AI 补完缺失层 ---- */
const GAPFILL_LABEL = {ooc_redline: "绝不做的事", soul_goal: "自觉目标", hidden_desire: "隐秘欲望", inner_need: "深层需求",
  /* B17: 弧光四键的中文名, 与 RP_PROMPT.LABELS / RP_CARDIMPORT.GAPFILL_KEYS 一一对应。
     缺了会退回显示裸 key 名(app.js 用的是 GAPFILL_LABEL[k]||k), 不影响功能但界面难看。 */
  arc_type: "弧光类型", arc_start: "弧光·起", arc_mid: "弧光·转", arc_end: "弧光·合"};
/* 导入成功页: 提示缺失层, 用户确认才调模型。queue: 看图写卡批量导入时的待补完队列 */
window.cardGapfillPrompt = (cardId, keys, queue)=>{
  const card = RP_CARDIMPORT.findById(cardId);
  if(!card){ cardGapfillNext(queue); return; }
  window._gapfillQueue = queue || [];
  __backAction = ()=>{ showTraverse(); };
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = "✨ AI 补完"; subEl.textContent = card.name;
  const names = keys.map(k=>GAPFILL_LABEL[k]||k).join("、");
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  <div class="card"><div class="kv">已导入「${esc(card.name)}」</div>
  <div class="hint">检测到 ${keys.length} 个关键层缺失：${esc(names)}。可让 AI 基于卡片原文推断补全，只填缺失项，原卡一字不动，补完内容会标注「AI 补完」。</div></div>
  <div class="btnrow"><button class="btn" onclick="cardGapfillGen('${jq(cardId)}')">✨ AI 补完缺失层</button>
  <button class="btn ghost" onclick="cardGapfillNext([${(queue||[]).map(x=>"'"+jq(x)+"'").join(",")}])">跳过</button></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.cardGapfillNext = (queue)=>{
  queue = queue || [];
  if(queue.length){
    const nxt = queue.shift();
    const c = RP_CARDIMPORT.findById(nxt);
    const miss = c ? RP_CARDIMPORT.missingGapfillKeys(c) : [];
    if(miss.length >= 2){ cardGapfillPrompt(nxt, miss, queue); return; }
    cardGapfillNext(queue); return;
  }
  showTraverse();
};
window.cardGapfillGen = async (cardId)=>{
  const cfg = getCfg();
  if(!cfg.key||!cfg.base||!cfg.model){ alert("先去「设置」配好 API 地址/Key/模型"); return; }
  const card = RP_CARDIMPORT.findById(cardId); if(!card) return;
  const keys = RP_CARDIMPORT.missingGapfillKeys(card);
  if(!keys.length){ alert("没有缺失层了"); return; }
  view.innerHTML = `<div class="card"><div class="kv">AI 正在补完…</div><div class="hint">基于卡片原文推断 ${esc(keys.map(k=>GAPFILL_LABEL[k]||k).join("、"))}</div></div>`;
  try{
    const raw = await RP_NET.complete({base:cfg.base,key:cfg.key,model:cfg.model},
      [{role:"user", content: RP_CARDIMPORT.gapfillPrompt(card, keys)}], 0.7);
    const out = RP_CARDIMPORT.parseGapfillJson(raw, keys);
    if(!out || !Object.keys(out).length){ alert("AI 没有返回可用补完，可稍后在编辑页手动填写"); cardGapfillPrompt(cardId, keys, window._gapfillQueue||[]); return; }
    window._gapfillDraft = {cardId, fields: out};
    cardGapfillView();
  }catch(e){ alert("补完失败："+e.message); cardGapfillPrompt(cardId, keys, window._gapfillQueue||[]); }
};
function cardGapfillView(){
  const d = window._gapfillDraft; if(!d) return;
  const card = RP_CARDIMPORT.findById(d.cardId); if(!card) return;
  __backAction = ()=>cardGapfillPrompt(d.cardId, Object.keys(d.fields), []);
  titleEl.innerHTML = "✨ AI 补完"; subEl.textContent = card.name;
  const rows = Object.keys(d.fields).map(k=>
    `<div class="field"><label>${esc(GAPFILL_LABEL[k]||k)} <span class="badge">AI 补完</span></label>`+
    `<textarea id="gf_${k}" rows="3">${esc(d.fields[k])}</textarea></div>`).join("");
  view.innerHTML = `<button class="back" onclick="cardGapfillPrompt('${jq(d.cardId)}',Object.keys(window._gapfillDraft.fields),[])">${icon("back")} 返回</button>
  <div class="card"><div class="kv">补完结果（可编辑，确认后写入卡片）</div>${rows}
  <div class="btnrow" style="margin-top:8px"><button class="btn" style="flex:1" onclick="cardGapfillSave()">确认写入</button></div></div>
  <div class="hint">来源标注：卡片原文保持原样；上方字段为 AI 推断补完，编辑页会打「AI 补完」标记，可随时修改。</div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
}
window.cardGapfillSave = ()=>{
  const d = window._gapfillDraft; if(!d) return;
  const card = RP_CARDIMPORT.findById(d.cardId); if(!card) return;
  card.fields = card.fields || {}; card.aiFilled = card.aiFilled || {};
  Object.keys(d.fields).forEach(k=>{
    const el = document.getElementById("gf_"+k);
    const v = el ? el.value.trim() : d.fields[k];
    if(v){ card.fields[k] = v; card.aiFilled[k] = true; }
  });
  RP_CARDIMPORT.update(card);
  window._gapfillDraft = null;
  rpToast("已写入卡片");
  cardGapfillNext(window._gapfillQueue || []);
};
window.travDelImport = (id)=>{
  if(!confirm("删除这张导入的角色卡？")) return;
  RP_CARDIMPORT.del(id); showTraverse();
};

/* ---- 功能二-1/2: 看图写卡（一图多人自动拆卡） ----
 * 纯图片(无内嵌 chara 数据) -> vision 模型识别 -> 一人一张卡 -> 勾选导入。
 * 模型是否支持 vision 按 RP_MODELTAGS 能力标签判断, 不硬编码模型名。 */
window.travVisionPick = ()=>{ const f=$("#travVisionFile"); if(f){ f.value=""; f.click(); } };
window.travVisionFile = async (inp)=>{
  const file = inp.files && inp.files[0]; if(!file) return;
  try{
    const dataUrl = await new Promise((res, rej)=>{
      const rd = new FileReader(); rd.onload = ()=>res(rd.result); rd.onerror = rej;
      rd.readAsDataURL(file);
    });
    /* PNG 先试内嵌卡片数据: 有则走普通导入, 没有才走 vision */
    if((file.type||"").indexOf("png") >= 0 || /\.png$/i.test(file.name||"")){
      try{
        const buf = await (await fetch(dataUrl)).arrayBuffer();
        const jsonText = RP_CARDIMPORT.extractChara(buf);
        const card = RP_CARDIMPORT.normalizeTavern(RP_CARDIMPORT.parseCardJson(jsonText));
        if(!confirm(`导入角色卡「${card.name}」？\n${(card.scenario||card.fields.core_identity||"").slice(0,80)}`)) return;
        RP_CARDIMPORT.add(card); achvUnlock("card_1");
        const miss = RP_CARDIMPORT.missingGapfillKeys(card);
        if(miss.length >= 2){ cardGapfillPrompt(card.id, miss, []); return; }
        alert(`已导入「${card.name}」`); showTraverse(); return;
      }catch(e){ /* 无内嵌数据, 继续 vision 流程 */ }
    }
    travVisionSetup(dataUrl);
  }catch(e){ alert("读取图片失败："+e.message); }
};
window.travVisionSetup = (dataUrl)=>{
  const cfg = getCfg();
  if(!cfg.key||!cfg.base){ alert("先去「设置」配好 API 地址/Key"); return; }
  window._visionDataUrl = dataUrl;
  __backAction = ()=>{ showTraverse(); };
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.textContent = "看图写卡"; subEl.textContent = "AI 识别图中人物";
  const tags = (typeof RP_MODELTAGS !== "undefined" && RP_MODELTAGS.get) ? RP_MODELTAGS.get(cfg.model||"") : [];
  const hasVision = tags.indexOf("视觉") >= 0;
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  <div class="card"><div class="kv">待识别图片</div>
  <img src="${dataUrl}" style="max-width:100%;max-height:220px;border-radius:8px;display:block;margin:8px auto"></div>
  <div class="card"><div class="kv">识别模型</div>
  <div class="field"><label>当前模型：${esc(cfg.model||"（未设置）")} ${tags.map(t=>`<span class="badge">${esc(t)}</span>`).join("")}</label>
  ${hasVision ? `<div class="hint">当前模型已标记视觉能力，可直接识别。</div>`
    : `<div class="hint" style="color:var(--gold)">当前模型未标记「视觉」能力，看图写卡需要 vision 模型。请在下方指定（不硬编码，以你的网关实际支持为准）：</div>
      <input id="vv_model" placeholder="输入 vision 模型名，如 gpt-4o" value="${esc(cfg.model||"")}">`}
  </div></div>
  <div class="btnrow"><button class="btn" onclick="travVisionGen()">🔍 开始识别</button></div>
  <div class="hint">识别后一人一张卡，可勾选要导入的；图片不会上传到别处，只发给你的模型网关。</div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.travVisionGen = async ()=>{
  const cfg = getCfg();
  const dataUrl = window._visionDataUrl; if(!dataUrl) return;
  const vModelEl = document.getElementById("vv_model");
  const vModel = vModelEl ? vModelEl.value.trim() : "";
  const model = vModel || cfg.model;
  if(!model){ alert("请指定 vision 模型"); return; }
  view.innerHTML = `<div class="card"><div class="kv">AI 正在看图…</div><div class="hint">识别图中人物并写卡，稍候</div></div>`;
  try{
    const raw = await RP_NET.visionComplete({base:cfg.base,key:cfg.key,model:model},
      dataUrl, RP_CARDIMPORT.visionCardPrompt(), null, {maxTokens: 4000});
    const chars = RP_CARDIMPORT.parseVisionCards(raw);
    if(!chars || !chars.length){ alert("AI 没有识别出人物，换张图或换个 vision 模型试试"); travVisionSetup(dataUrl); return; }
    window._visionChars = chars;
    travVisionSelect();
  }catch(e){ alert("识别失败："+e.message); travVisionSetup(dataUrl); }
};
function travVisionSelect(){
  const chars = window._visionChars || [];
  __backAction = ()=>travVisionSetup(window._visionDataUrl);
  titleEl.textContent = "看图写卡"; subEl.textContent = `识别出 ${chars.length} 个人物`;
  view.innerHTML = `<button class="back" onclick="travVisionSetup(window._visionDataUrl)">${icon("back")} 重新识别</button>
  <div class="hint">勾选要导入的角色卡（默认全选），一人一张</div>
  ${chars.map((c,i)=>`<div class="card"><label class="row" style="align-items:flex-start;cursor:pointer">
    <input type="checkbox" id="vc_${i}" checked style="width:22px;height:22px;margin-top:4px;flex:none">
    <div style="flex:1;min-width:0;margin-left:8px"><div class="name">${esc(c.name||("人物"+(i+1)))}</div>
    <div class="meta">${esc(String(c.appearance||"").slice(0,60))}</div>
    <div class="meta">${esc(String(c.personality||"").slice(0,80))}</div></div></label></div>`).join("")}
  <div class="btnrow"><button class="btn" onclick="travVisionImport()">导入选中</button></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
}
window.travVisionImport = ()=>{
  const chars = window._visionChars || [];
  const queue = [];
  let n = 0;
  chars.forEach((c,i)=>{
    const el = document.getElementById("vc_"+i);
    if(!el || !el.checked) return;
    const card = RP_CARDIMPORT.fromVisionChar(c);
    RP_CARDIMPORT.add(card); n++;
    if(RP_CARDIMPORT.missingGapfillKeys(card).length >= 2) queue.push(card.id);
  });
  window._visionChars = null; window._visionDataUrl = null;
  achvUnlock("card_1");
  if(!n){ alert("没有选中任何人物"); return; }
  /* 批量导入后: 有缺失层的卡走 AI 补完队列 */
  if(queue.length){
    const first = queue.shift();
    const c = RP_CARDIMPORT.findById(first);
    cardGapfillPrompt(first, RP_CARDIMPORT.missingGapfillKeys(c), queue);
    return;
  }
  alert(`已导入 ${n} 张角色卡`);
  showTraverse();
};

/* ---- 魂穿：选目标 -> 选锚点 -> 开局 ---- */
function soulPickTarget(){
  __backAction = ()=>showTraverse();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("user")+" 魂穿"; subEl.textContent = "选择你要成为的角色";
  const cs = allChars();
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  <div class="chargrid">${cs.map(c=>`
    <button type="button" class="charcard" onclick="soulAnchors('${jq(c.runId)}','${jq(c.name)}')">
      <div class="avatar ${charCoverCls(c.name)}">${esc(c.name[0])}</div>
      <div class="ccname">${esc(c.name)}</div><div class="ccnovel">${esc(c.novel)}</div>
    </button>`).join("")}</div><div style="height:40px"></div>`;
  window.scrollTo(0,0);
}
function soulOutlineFor(runId, name){
  try{
    const p = JSON.parse(localStorage.getItem(`nd_plot_${runId}_${name}`));
    if(p && p.updatedAt && p.outline) return p.outline;
  }catch(e){}
  return bundledPlotFor(runId, name);
}
/* 锚点选项区 (B15): 导入卡没有剧情大纲, RP_TRAVERSE.anchorsFor 只会兜底给出 traverse.js 自带的
   那一条"从头开始"(id="start") —— 等于没有预设锚点, 页面不该只剩这一条无意义选项。
   空列表 / 只剩这条内置兜底项时, 渲染一个默认选中的"自由开局"选项(走 soulStart 的 custom 分支:
   下面那句自定为空时用"故事开端")。有真锚点时按原样列出、第一条默认选中, 行为不变
   (value 仍是 anchors 的原下标, soulStart 按下标回查不受影响)。 */
function anchorOptionsHTML(anchors){
  const list = anchors || [];
  const real = list.filter(a=>a && a.id !== "start");
  if(real.length)
    return list.map((a,i)=>`
    <label class="kvline" style="display:block"><input type="radio" name="anchor" value="${i}"${i===0?" checked":""}> ${esc(a.title)}</label>`).join("");
  return `<label class="kvline" style="display:block"><input type="radio" name="anchor" value="custom" checked>
    无预设剧情锚点：从当前剧情自由开局（可在下面补一句切入点）</label>`;
}
 window.soulAnchors = (runId, name)=>{
  __backAction = ()=>soulPickTarget();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("user")+" 魂穿 · "+esc(name); subEl.textContent = "选择进入的剧情锚点";
  const anchors = RP_TRAVERSE.anchorsFor(soulOutlineFor(runId, name));
  const _anchNovel = ((((window.__DATA__||{}).runs||{})[runId]||{}).novel)||"";
  const run = (((window.__DATA__||{}).runs||{})[runId]||{});
  const secs = run.sections || [];
  /* 地点列表：从 worldbook geography + 事件地点聚合 */
  let places = [];
  try{
    const wb = run.worldbook || [];
    const geoTitles = wb.filter(e=>e.category==="geography").map(e=>e.title);
    /* 从标题提取具体地名（取前2-4字核心词） */
    const placeSet = new Set();
    ["大观园","潇湘馆","怡红院","蘅芜苑","荣国府","宁国府","太虚幻境","铁槛寺",
     "梁山泊","忠义堂","东京","郓城","阳谷","景阳冈","二龙山","桃花山",
     "梨香院","栊翠庵","藕香榭","滴翠亭","金陵","神京","姑苏"].forEach(p=>{
      if(JSON.stringify(wb).includes(p)) placeSet.add(p);
    });
    geoTitles.forEach(t=>{
      const m = t.match(/^(.{2,6}?)(整体|方位|格局|布局|与|之|的)/);
      if(m && m[1].length>=2) placeSet.add(m[1]);
    });
    places = [...placeSet].slice(0, 24);
  }catch(e){}
  view.innerHTML = `<button class="back" onclick="soulPickTarget()">${icon("back")} 返回</button>
  <h2 class="sec">你想从哪里开始成为${esc(name)}？</h2>
  <div class="card">${anchorOptionsHTML(anchors)}
    <label class="kvline" style="display:block"><input type="radio" name="anchor" value="custom"> 自定：<input id="anchorCustom" style="width:55%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:6px" placeholder="比如：黛玉初进贾府那天">${RP_AIFILL.btn("anchorCustom","魂穿锚点","一句话描述想切入的剧情时间点，如：黛玉初进贾府那天","魂穿进"+(_anchNovel?("小说《"+_anchNovel+"》"):"异世界")+"成为"+name)}</label>
  </div>
  ${secs.length?`<h2 class="sec">📖 时间线（可选）</h2>
  <div class="card"><div class="field" style="margin:0"><label>从哪一章切入？角色只知道该章及之前的事</label>
  <select id="travChapter" style="width:100%">
    <option value="-1">不指定（用锚点）</option>
    ${secs.map((s,i)=>`<option value="${i}">第${i+1}章 · ${esc(s.title||"")}</option>`).join("")}
  </select></div></div>`:""}
  ${places.length?`<h2 class="sec">📍 地点（可选）</h2>
  <div class="card"><div class="field" style="margin:0"><label>故事从哪里开始？</label>
  <select id="travPlace" style="width:100%">
    <option value="">不指定</option>
    ${places.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}
  </select></div></div>`:""}
  <h2 class="sec">⚡ 事件（可选）</h2>
  <div class="card"><div class="field" style="margin:0"><label>从哪个关键事件切入？（输入关键词搜索）</label>
  <input id="travEventKey" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:8px" placeholder="比如：葬花、拳打镇关西" oninput="travEventSearch('${jq(runId)}')">
  <div id="travEventList" style="margin-top:8px;max-height:200px;overflow-y:auto"></div>
  <input type="hidden" id="travEventSel" value="">
  </div></div>
  <div class="card"><label class="kvline" style="display:block"><input type="checkbox" id="oocRemind" checked> OOC 提醒：我说的话不符合身份/时代时，世界轻轻点我一下</label></div>
  <div class="btnrow"><button class="btn" style="flex:1" onclick="soulStart('${jq(runId)}','${jq(name)}')">开始穿越</button></div>
  <div style="height:40px"></div>`;
  /* 预加载事件日历，供事件搜索用 */
  try{ loadEventCal(runId); }catch(e){}
  window.scrollTo(0,0);
};
/* 事件搜索：从 event_calendar / event_dag 找匹配事件 */
window.travEventSearch = (runId)=>{
  const key = ($("#travEventKey").value||"").trim();
  const listEl = $("#travEventList");
  if(!listEl) return;
  if(key.length < 1){ listEl.innerHTML = ""; return; }
  const doSearch = ()=>{
    let events = [];
    try{
      let cal = _calCache[runId] || window["__EVENTCAL_" + runId];
      if(cal && cal.events){
        events = cal.events.filter(e=>(e.summary||"").includes(key)).slice(0, 20)
          .map(e=>({text: e.summary, chapter: e.chapter, location: (e.location||[]).join("、")}));
      }else{
        let dag = window["__DAG_" + runId];
        if(dag && dag.nodes){
          events = dag.nodes.filter(n=>(n.text||"").includes(key)).slice(0, 20)
            .map(n=>({text: n.text, chapter: "", location: (n.location||[]).join("、")}));
        }
      }
    }catch(e){}
    if(!events.length){ listEl.innerHTML = `<div class="hint">没找到相关事件，换个关键词试试</div>`; return; }
    listEl.innerHTML = events.map((e,i)=>`
      <div class="kvline" style="display:block;cursor:pointer;padding:8px;border:1px solid var(--line-soft);border-radius:8px;margin-bottom:6px"
        onclick="travEventPick(${jq(i)})" data-idx="${i}">
        <div style="font-size:calc(13px * var(--fs))">${esc(e.text.slice(0,80))}${e.text.length>80?"…":""}</div>
        <div style="font-size:calc(11px * var(--fs));color:var(--ink-faint)">${e.chapter?("第"+e.chapter+"回 · "):""}${esc(e.location||"")}</div>
      </div>`).join("");
    window.__travEvents = events;
  };
  /* 确保数据已加载 */
  if(!_calCache[runId] && !window["__EVENTCAL_" + runId]){
    listEl.innerHTML = `<div class="hint">加载事件数据…</div>`;
    loadEventCal(runId).then(()=>{
      /* P2-5: 加载失败区分于"没找到"，给重试入口 */
      if(_calFailed[runId] && !_calCache[runId] && !window["__EVENTCAL_" + runId]){
        listEl.innerHTML = `<div class="hint">事件数据加载失败 <button class="btn ghost sm" onclick="travEventSearch('${jq(runId)}')">重试</button></div>`;
        return;
      }
      doSearch();
    });
  }else doSearch();
};
window.travEventPick = (i)=>{
  const ev = (window.__travEvents||[])[i];
  if(!ev) return;
  $("#travEventSel").value = ev.text.slice(0, 200);
  /* 高亮选中 */
  document.querySelectorAll("#travEventList .kvline").forEach((el,idx)=>{
    el.style.borderColor = idx===i ? "var(--gold-deep)" : "var(--line-soft)";
    el.style.background = idx===i ? "rgba(212,162,78,.08)" : "";
  });
  rpToast("已选事件");
};
window.soulStart = async (runId, name)=>{
  const rs = document.querySelectorAll('input[name="anchor"]');
  let idx = 0; rs.forEach(r=>{ if(r.checked) idx = r.value; });
  let anchorTitle;
  if(idx === "custom"){
    anchorTitle = ($("#anchorCustom").value||"").trim() || "故事开端";
  } else {
    anchorTitle = RP_TRAVERSE.anchorsFor(soulOutlineFor(runId, name))[parseInt(idx,10)].title;
  }
  const oocRemind = $("#oocRemind").checked;
  /* 新增：时间线/地点/事件三选 */
  let entryChapter = -1, entryPlace = "", entryEvent = "";
  try{
    const chSel = $("#travChapter");
    if(chSel) entryChapter = parseInt(chSel.value, 10);
    const plSel = $("#travPlace");
    if(plSel) entryPlace = plSel.value || "";
    const evSel = $("#travEventSel");
    if(evSel) entryEvent = evSel.value || "";
  }catch(e){}
  let worldKind = "book", worldId = runId;
  if(runId === "imported"){
    const c = RP_CARDIMPORT.find(name);
    worldKind = "card"; worldId = c ? c.id : "";
  } else if(runId === "custom"){
    try{
      const cc = RP_WRITER.findCustom(name);
      if(cc && cc.worldRunId) worldId = cc.worldRunId;
    }catch(e){}
  }
  const sess = RP_TRAVERSE.newSession({
    mode:"soul", worldKind, worldId,
    worldName: RP_TRAVERSE.worldDisplayName(worldKind, worldId),
    charName:name, anchorTitle, oocRemind,
    entryChapter, entryPlace, entryEvent,
  });
  travBegin(sess);
};
/* ---- 肉身穿越：选世界 -> 捏身份 -> 开局 ---- */
function bodyPickWorld(){
  __backAction = ()=>showTraverse();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("users")+" 肉身穿越"; subEl.textContent = "选择你要进入的世界";
  const ws = travWorlds();
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  ${ws.length ? ws.map(w=>`
    <div class="card card--tap" onclick="bodyIdentity('${jq(w.kind)}','${jq(w.id)}')">
      <div class="name">${esc(w.name)}</div><div class="meta">${esc(w.sub)}</div>
      ${w.kind==="card"?`<button class="linkbtn" style="margin-top:4px" onclick="event.stopPropagation();travWorldComplete('${jq(w.kind)}','${jq(w.id)}')">${icon("scroll",12)} AI 补完这个世界</button>`:""}
    </div>`).join("") : `<div class="empty">还没有可用世界：先导入角色卡，或等蒸馏任务产出</div>`}
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
}
/* ---- P1: 完整身份捏造（十项字段，逐项重随） ---- */
const IDT_INPUTS = {name:"idName",gender:"idGender",age:"idAge",looks:"idLooks",origin:"idOrigin",
  traits:"idTraits",talent:"idTalent",situation:"idSituation"};
function idtInp(fid, tag){ tag = tag||"input";
  const style = "width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px";
  return tag==="textarea"
    ? `<textarea id="${fid}" style="${style};min-height:52px"></textarea>`
    : `<input id="${fid}" style="${style}">`;
}
function idtRow(kind, id, key, label, inputHtml){
  return `<div class="field"><label>${label} <button class="linkbtn" onclick="bodyReroll('${jq(kind)}','${jq(id)}','${jq(key)}')">重随</button></label>${inputHtml}</div>`;
}
window.bodyIdentity = (kind, id)=>{
  __backAction = ()=>bodyPickWorld();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  const wname = RP_TRAVERSE.worldDisplayName(kind, id);
  window._idtDraft = null;
  titleEl.innerHTML = icon("users")+" 肉身穿越"; subEl.textContent = wname+" · 捏造你的身份";
  const F = RP_TRAVERSE2.IDENT_FIELDS;
  const lbl = k=>{ const f = F.find(x=>x.key===k); return f?f.label:k; };
  view.innerHTML = `<button class="back" onclick="bodyPickWorld()">${icon("back")} 返回</button>
  <div class="card"><div class="kv">一句话愿望，AI 帮你捏身份（十项完整字段）</div>
  <div class="row" style="margin-top:8px"><input id="idWish" style="flex:1;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" placeholder="比如：我想当个落魄书生混进贾府">
  <button class="btn" style="white-space:nowrap" onclick="bodyAiGen('${jq(kind)}','${jq(id)}')">AI 生成</button></div></div>
  <div class="card"><label class="kvline" style="display:block"><input type="checkbox" id="idModern"> 现代人直穿：不捏古代身份，以现在的自己进去（携带手机/打火机/纸巾）</label></div>
  <h2 class="sec">身份卡 <span class="badge">P1</span></h2>
  <div class="card">
  ${idtRow(kind,id,"name",lbl("name"),`<select id="idNameCand" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px;margin-bottom:6px" onchange="idNamePick()"></select>`+idtInp("idName"))}
  ${idtRow(kind,id,"gender",lbl("gender"),idtInp("idGender"))}
  ${idtRow(kind,id,"age",lbl("age"),idtInp("idAge"))}
  ${idtRow(kind,id,"looks",lbl("looks"),idtInp("idLooks"))}
  ${idtRow(kind,id,"origin",lbl("origin"),idtInp("idOrigin"))}
  ${idtRow(kind,id,"traits",lbl("traits"),idtInp("idTraits"))}
  ${idtRow(kind,id,"talent",lbl("talent"),idtInp("idTalent"))}
  ${idtRow(kind,id,"items",lbl("items"),idtInp("idItems","textarea"))}
  ${idtRow(kind,id,"situation",lbl("situation"),idtInp("idSituation","textarea"))}
  ${idtRow(kind,id,"hooks",lbl("hooks"),idtInp("idHooks","textarea"))}
  </div>
  <div class="btnrow"><button class="btn" style="flex:1" onclick="bodyStart('${jq(kind)}','${jq(id)}')">开始穿越</button></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
/* 备选名选择 */
window.idNamePick = ()=>{ const s=$("#idNameCand"); if(s&&s.value) $("#idName").value = s.value; };
function fillIdtForm(d){
  d = d||{};
  Object.keys(IDT_INPUTS).forEach(k=>{ const el=$("#"+IDT_INPUTS[k]); if(el) el.value = d[k]||""; });
  const sel = $("#idNameCand");
  if(sel){ const cands = (d.nameCandidates&&d.nameCandidates.length)?d.nameCandidates:[d.name||""];
    sel.innerHTML = cands.filter(Boolean).map(c=>`<option ${c===d.name?"selected":""}>${esc(c)}</option>`).join(""); }
  const items = $("#idItems");
  if(items) items.value = (d.items||[]).map(i=>typeof i==="string"?i:(i.name||"")).filter(Boolean).join("\n");
  const hooks = $("#idHooks");
  if(hooks) hooks.value = (d.hooks||[]).join("\n");
}
function readIdtForm(){
  const d = window._idtDraft||{};
  Object.keys(IDT_INPUTS).forEach(k=>{ const el=$("#"+IDT_INPUTS[k]); if(el) d[k]=el.value.trim(); });
  const oldItems = d.items||[];
  d.items = ($("#idItems").value||"").split("\n").map(s=>s.trim()).filter(Boolean).map(nm=>{
    const old = oldItems.find(o=>(o.name||o)===nm);
    return old? old : {name:nm, durability:"", uses:1};
  });
  d.hooks = ($("#idHooks").value||"").split("\n").map(s=>s.trim()).filter(Boolean).slice(0,3);
  d.modern = !!$("#idModern").checked;
  return d;
}
window.bodyAiGen = async (kind, id)=>{
  const wish = ($("#idWish").value||"").trim();
  if(!wish){ alert("先写一句愿望，比如：我想当个落魄书生"); return; }
  const cfg = getCfg();
  if(!cfg.key||!cfg.base||!cfg.model){ alert("先去「设置」配好 API 地址/Key/模型"); return; }
  const btn = window.event && window.event.target;
  try{
    if(btn) btn.textContent = "生成中…";
    const draft = await RP_TRAVERSE2.genIdentityFull(wish, RP_TRAVERSE.worldDisplayName(kind,id),
      cfg, (c,m,t)=>RP_NET.complete(c,m,t));
    draft._wish = wish;
    window._idtDraft = draft;
    fillIdtForm(draft);
  }catch(e){ alert("生成失败："+e.message); }
  finally{ if(btn) btn.textContent = "AI 生成"; }
};
window.bodyReroll = async (kind, id, fieldKey)=>{
  readIdtForm();
  const d = window._idtDraft||{};
  const wish = ($("#idWish").value||"").trim() || d._wish || "";
  if(!wish){ alert("先写一句愿望"); return; }
  const cfg = getCfg();
  if(!cfg.key||!cfg.base||!cfg.model){ alert("先去「设置」配好 API 地址/Key/模型"); return; }
  try{
    const v = await RP_TRAVERSE2.rerollField(fieldKey, d, wish,
      RP_TRAVERSE.worldDisplayName(kind,id), cfg, (c,m,t)=>RP_NET.complete(c,m,t));
    d[fieldKey] = v;
    window._idtDraft = d;
    fillIdtForm(d);
  }catch(e){ alert("重随失败："+e.message); }
};
window.bodyStart = (kind, id)=>{
  const d = readIdtForm();
  const modern = d.modern;
  const name = (d.name||"").trim();
  if(!modern && !name){ alert("给身份起个名字，或勾选现代人直穿"); return; }
  let finalName = name;
  if(modern && !finalName){
    try{ finalName = (RP_PERSONA.resolve("trav").name)||"我"; }catch(e){ finalName = "我"; }
  }
  const items = modern
    ? RP_TRAVERSE2.cloneItems(RP_TRAVERSE2.MODERN_ITEMS)
    : RP_TRAVERSE2.cloneItems(d.items);
  const idt = RP_TRAVERSE.saveIdentity({
    name: finalName||"无名氏", gender:d.gender, age:d.age, looks:d.looks,
    origin: modern ? "现代" : d.origin,
    traits:d.traits, talent:d.talent, items:items,
    situation:d.situation, hooks:d.hooks, modern,
    worldName: RP_TRAVERSE.worldDisplayName(kind, id),
  });
  const sess = RP_TRAVERSE.newSession({
    mode:"body", worldKind:kind, worldId:id,
    worldName: RP_TRAVERSE.worldDisplayName(kind, id),
    identityId: idt.id, anchorTitle: idt.situation||"初入此界", oocRemind:true,
  });
  travBegin(sess);
};
/* ---- 进入穿越聊天 ---- */
function travBegin(sess){
  CHAT = {mode:"traverse", travId: sess.id};
  LAST_STATS = null;
  achvUnlock("traverse_1");
  /* P1: 肉身携带物同步到世界状态（仅新会话、状态尚无物品时，避免覆盖 AI 已更新的状态） */
  try{
    if(sess.mode === "body" && sess.identityId && typeof RP_TRAVERSE2 !== "undefined"){
      const idt = RP_TRAVERSE.getIdentity(sess.identityId);
      const st = RP_TRAVERSE.getState(sess.id);
      if(idt && idt.items && idt.items.length && (!st.items || !st.items.length)){
        st.items = idt.items.slice();
        RP_TRAVERSE.saveState(sess.id, st);
      }
    }
  }catch(e){}
  setNav("chat");
}
async function showTraverseChat(cfg){
  __backAction = ()=>exitChat();
  document.body.classList.add("chatmode");
  const trav = RP_TRAVERSE.get(CHAT.travId);
  if(!trav){ setNav("traverse"); return; }
  const _comps0 = (typeof RP_TRAVERSE2!=="undefined")? RP_TRAVERSE2.getCompanions(trav.id):[];
  const modeName = _comps0.length? "组团穿越" : trav.mode==="isekai"? "异世界" : (RP_TRAVERSE.MODES[trav.mode]||"穿越");
  const _plotHud = (trav.plotrunId && typeof RP_PLOTRUN!=="undefined") ? RP_PLOTRUN.hudHTML(RP_PLOTRUN.load(trav.plotrunId)) : "";
  const title = travPlayerName();
  await warmWallpaper(); await warmGlobalWall(); /* 先读用户壁纸，避免先闪默认图 */
  view.innerHTML = `
  ${chatBgHTML()}
  <div class="chathead" id="chathead">
  <button class="backbtn" onclick="exitChat()">‹</button>
  <div class="avatar">${esc((title||"穿")[0])}</div>
  <div class="chead-main"><div class="cname">${esc(title)} <span class="badge">${modeName}</span>${_plotHud}<span class="aimark">AI</span></div>
  <div class="cstat"><span>${esc(trav.worldName)}</span></div></div>
  <button class="menubtn" onclick="toggleChatSearch()" title="搜索聊天记录">${icon("search")}</button>
<button class="menubtn" onclick="toggleDrawer(true)" title="菜单">${icon("menu")}</button>
  </div>
  <div class="chatwrap">
  <div id="ctxbar"></div>
  <div id="chatsearch"></div>
  <div id="wsbar" class="wsbar" onclick="travWsEditor()"></div>
  <div id="chatlog"></div>
  <div class="chatbar">${chatbarInner(STREAMING)}</div>
  </div>
  <div class="scrim" id="scrim" onclick="toggleDrawer(false)"></div>
  <div class="drawer" id="drawer">
  <h3>穿越</h3>
  <button class="ditem" onclick="toggleDrawer(false);travWsEditor()">${icon("scroll")} 世界状态</button>
  <button class="ditem" onclick="toggleDrawer(false);travIdentityView()">${icon("user")} 我的身份</button>
  <button class="ditem" onclick="toggleDrawer(false);travPartyView()">${icon("users")} 队伍</button>
  <button class="ditem" onclick="toggleDrawer(false);travRegexEditor()">🔤 正则替换</button>
  <button class="ditem" onclick="toggleDrawer(false);wallpaperEditor()">🖼️ 聊天壁纸</button>
  <button class="ditem" onclick="toggleDrawer(false);showSystem()">${icon("settings")} prompt 预览</button>
  <button class="ditem" onclick="toggleDrawer(false);exportChat()">${icon("download")} 复制聊天记录</button>
  <button class="ditem danger" onclick="toggleDrawer(false);travEnd()">${icon("x")} 结束穿越</button>
  </div>`;
  renderChat(); renderWsBar(); paintChatBg(); attachHeadHide();
  const k = chatHistKey();
  /* P0-2/P1-4: 读失败≠空历史；await 开场白生成后必须再确认（用户可能已发消息） */
  let __th0 = null;
  try{ __th0 = getHist(k); }catch(e){
    const _tlog = document.getElementById("chatlog");
    if(_tlog) _tlog.innerHTML = `<div class="msg"><div class="msgcol"><div class="bubble">⚠️ 聊天记录读取失败（存储异常），未做任何写入。请稍后重进，历史数据仍在。</div></div></div>`;
    return;
  }
  if(!__th0.length){
    try{
      const opening = await RP_TRAVERSE.genOpening(trav, cfg, (c,m,t)=>RP_NET.complete(c,m,t));
      const parsed = RP_TRAVERSE.parseWsBlock(opening);
      if(parsed.patch) RP_TRAVERSE.saveState(trav.id,
        RP_TRAVERSE.mergeState(RP_TRAVERSE.getState(trav.id), parsed.patch));
      let __th2 = null;
      try{ __th2 = getHist(k); }catch(e){ return; } /* 读失败：放弃写入 */
      if(__th2.length) return; /* 用户已发消息：不开场白覆盖 */
      saveHist(k, [{role:"assistant", content: parsed.clean || opening, ts:Date.now()}]);
    }catch(e){
      let __th3 = null;
      try{ __th3 = getHist(k); }catch(e2){ return; }
      if(__th3.length) return;
      saveHist(k, [{role:"assistant", content: RP_TRAVERSE.offlineOpening(trav), ts:Date.now()}]);
    }
    renderChat(); renderWsBar();
  }
}
function renderWsBar(){
  const bar = $("#wsbar"); if(!bar || CHAT.mode!=="traverse") return;
  const st = RP_TRAVERSE.getState(CHAT.travId);
  /* 单行世界状态：时间 · 地点天气 · 导演模式 · 物品/出戏值（2026-10-09 合并三重叠加） */
  let parts = [];
  /* 时间地点：优先用 traverse state，worldsim 只补天气 */
  let dateStr = st.date || "", locStr = st.loc || "", weatherStr = "";
  try{
    if(typeof RP_WORLDSIM!=="undefined" && RP_WORLDSIM.enabled()){
      const ws = RP_WORLDSIM.get("nd_travchat_"+CHAT.travId) || {};
      if(ws.weather) weatherStr = ws.weather;
      /* traverse state 为空时才用 worldsim 的 */
      if(!dateStr && ws.date) dateStr = ws.date;
      if(!locStr && ws.loc) locStr = ws.loc;
    }
  }catch(e){}
  if(dateStr) parts.push(esc(dateStr));
  if(locStr) parts.push("📍"+esc(locStr));
  if(weatherStr) parts.push(esc(weatherStr));
  try{
    if(typeof RP_DIRECTOR!=="undefined"){
      const dh = RP_DIRECTOR.briefHTML("nd_travchat_"+CHAT.travId);
      /* briefHTML 返回 html，提取纯文本 */
      const tmp = document.createElement("div"); tmp.innerHTML = dh;
      const dtxt = (tmp.textContent||"").trim();
      if(dtxt) parts.push("🎬"+esc(dtxt));
    }
  }catch(e){}
  if(st.items && st.items.length) parts.push("🎒"+st.items.length);
  if(st.flags && st.flags.ooc>0) parts.push(`<span class="ooc">出戏${st.flags.ooc}</span>`);
  bar.innerHTML = `${icon("scroll",13)} <span class="wsline">${parts.join(" · ")||"世界状态"}</span>`
    + `<span style="float:right;opacity:.6">查看 ›</span>`;
}
window.travWsEditor = ()=>{
  const trav = RP_TRAVERSE.get(CHAT.travId); if(!trav) return;
  __backAction = ()=>showChat();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  const st = RP_TRAVERSE.getState(trav.id);
  titleEl.innerHTML = icon("scroll")+" 世界状态"; subEl.textContent = trav.worldName;
  const _wsCtx = "穿越世界「"+trav.worldName+"」的世界状态；最近剧情：\n"+RP_AIFILL._recentChatCtx(8,"nd_travchat_"+trav.id);
  const favRows = Object.keys(st.favor||{}).map(k=>
    `<div class="kvline">${esc(k)}：好感 ${st.favor[k]}</div>`).join("") || `<div class="meta">暂无</div>`;
  view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回</button>
  <div class="card">
  <div class="field"><label>日期${RP_AIFILL.btn("wsDate","世界日期","如：某年八月十五；结合剧情进度推断",_wsCtx)}</label><input id="wsDate" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" value="${esc(st.date||"")}"></div>
  <div class="field"><label>地点${RP_AIFILL.btn("wsLoc","当前地点","故事当前所在的地点名",_wsCtx)}</label><input id="wsLoc" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" value="${esc(st.loc||"")}"></div>
  <div class="field"><label>剧情进度${RP_AIFILL.btn("wsProg","剧情进度","一句话概括当前剧情进展到哪了",_wsCtx)}</label><input id="wsProg" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" value="${esc(st.progress||"")}"></div>
  <div class="btnrow" style="margin-top:8px"><button class="btn" onclick="travWsSave()">保存</button></div>
  </div>
  <div class="card"><h3>${icon("clock",15)} 世界模拟</h3>
  <div class="btnrow"><button class="btn ghost" onclick="simEditor()">调整时间 / 天气 / 地点</button></div>
  <div class="hint">每会话独立时钟，随聊天自动流逝；天气按季节流转；地点切换消耗移动时间。三者会注入 prompt，AI 叙述自动呼应。</div>
  </div>
  <h2 class="sec">随身物品</h2>
  <div class="card">${st.items.length? st.items.map(i=>`<div class="kvline">${esc(i)}</div>`).join("") : `<div class="meta">空</div>`}</div>
  <h2 class="sec">人物好感</h2>
  <div class="card">${favRows}</div>
  <div class="hint">世界状态由 AI 在剧情推进时自动更新，你也可以手动修正时间地点。</div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.travWsSave = ()=>{
  const st = RP_TRAVERSE.getState(CHAT.travId);
  st.date = $("#wsDate").value.trim(); st.loc = $("#wsLoc").value.trim();
  st.progress = $("#wsProg").value.trim();
  RP_TRAVERSE.saveState(CHAT.travId, st);
  showChat();
};
window.travIdentityView = ()=>{
  const trav = RP_TRAVERSE.get(CHAT.travId); if(!trav) return;
  __backAction = ()=>showChat();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("user")+" 我的身份"; subEl.textContent = RP_TRAVERSE.MODES[trav.mode]||"";
  const body = trav.mode==="soul"
    ? `<div class="card"><div class="name" style="font-size:calc(16px * var(--fs))">${esc(trav.charName)}</div>
       <div class="meta">${esc(trav.worldName)} · ${esc(trav.anchorTitle||"")}</div>
       <div class="kv" style="margin-top:8px">你是玩家本人，正在扮演 TA。能做的只有 TA 能做的，知道的只有 TA 知道的。</div></div>`
    : trav.mode==="isekai"
    ? `<div class="card"><div class="name" style="font-size:calc(16px * var(--fs))">${esc(trav.charName)}</div>
       <div class="meta">${esc(trav.srcName||"")} → ${esc(trav.worldName)}</div>
       <div class="kv" style="margin-top:8px">${esc(trav.fusion==="reborn"?"转生：AI 安排目标世界新身份，保留性格与记忆":"异乡人：完整保留原身份记忆，目标世界视你为异人")}</div></div>`
    : (()=>{
        const idt = RP_TRAVERSE.getIdentity(trav.identityId)||{};
        const rows = [["姓名",idt.name],["性别",idt.gender],["年龄",idt.age],["相貌",idt.looks],
          ["出身",idt.origin],["性格",idt.traits],["特长",idt.talent],["当前处境",idt.situation]];
        const items = (idt.items||[]).map((it,ix)=>{
          const nm = typeof it==="string"?it:(it.name||"");
          const det = typeof it==="string"?"":[(it.durability?"耐久"+it.durability:""),
            (it.uses!=null?("可用"+it.uses+"次"):"")].filter(Boolean).join(" ");
          return `<div class="kvline"><span class="kv">${esc(nm)}</span> <span class="dim">${esc(det)}</span>
            ${typeof it==="string"?"":`<button class="linkbtn" onclick="travUseItem(${jq(ix)})">使用</button>`}</div>`;
        }).join("") || `<div class="meta">空</div>`;
        const hooks = (idt.hooks||[]).map(h=>`<div class="kvline">🔗 ${esc(h)}</div>`).join("");
        return `<div class="card">${rows.filter(r=>r[1]).map(r=>
          `<div class="kvline"><span class="kv">${r[0]}</span> ${esc(r[1])}</div>`).join("")}
          ${idt.modern?`<div class="kvline"><span class="badge">现代人直穿</span></div>`:""}
          </div>
          <h2 class="sec">携带物（P1）</h2><div class="card">${items}</div>
          ${hooks?`<h2 class="sec">关系钩子（P1）</h2><div class="card">${hooks}</div>`:""}`;
      })();
  view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回</button>${body}
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.travEnd = ()=>{
  if(!confirm("结束这次穿越？聊天记录和世界状态会保留在「最近穿越」里。")) return;
  CHAT = {mode:"single", runId:null, name:null, members:[], forcedSpeaker:null};
  setNav("traverse");
};

/* ================= 穿越 P1/P2/P3 UI（2026-09-30） ================= */

/* ---- P1: 携带物使用 ---- */
window.travUseItem = (ix)=>{
  const trav = RP_TRAVERSE.get(CHAT.travId); if(!trav || trav.mode!=="body") return;
  const idt = RP_TRAVERSE.getIdentity(trav.identityId); if(!idt || !idt.items) return;
  const res = RP_TRAVERSE2.useItem(idt.items, ix);
  if(!res.used){ alert("没有这件物品"); return; }
  idt.items = res.items;
  RP_TRAVERSE.saveIdentity(idt);
  /* P1: 同步世界状态里的物品 */
  try{
    const st = RP_TRAVERSE.getState(trav.id);
    st.items = res.items.slice();
    RP_TRAVERSE.saveState(trav.id, st);
  }catch(e){}
  travIdentityView();
};

/* ---- P1: 出戏值 ---- */
function travOocCheck(travId, text){
  if(!text || typeof RP_TRAVERSE2==="undefined") return;
  try{
    const hits = RP_TRAVERSE2.detectOoc(text);
    if(!hits.length) return;
    const st = RP_TRAVERSE.getState(travId);
    RP_TRAVERSE2.addOoc(st, text);
    RP_TRAVERSE.saveState(travId, st);
  }catch(e){}
}
/* ---- P1/P2/P3: 拼穿越 prompt 增补段（ooc + 异世界 + 组团） ---- */
function travExtraPrompt(travId, userText){
  if(typeof RP_TRAVERSE2==="undefined") return "";
  const trav = RP_TRAVERSE.get(travId); if(!trav) return "";
  const parts = [];
  try{
    const st = RP_TRAVERSE.getState(travId);
    const ooc = (st.flags && st.flags.ooc) || 0;
    if(ooc > 0){
      parts.push("「出戏值」当前 " + ooc + "/100：玩家言行中的现代元素让 NPC 感到困惑、起疑或好奇。"
        + "出戏值越高，NPC 越可能把玩家当成异类对待；出戏值达到整百时，安排一个趣味特殊事件"
        + "（如被当成妖怪围观、被奉为贵人），趣味为主、不要惩罚玩家。");
    }
    if(trav.mode === "isekai"){
      parts.push(RP_TRAVERSE2.isekaiPrompt(trav, RP_TRAVERSE2.getWorld(trav.dstId) || {}));
    }
    const comps = RP_TRAVERSE2.getCompanions(travId);
    if(comps.length){
      const speakers = RP_TRAVERSE2.planParty(userText, comps, window._travLastSpeaker || null, {});
      window._travLastSpeaker = speakers[speakers.length - 1] || window._travLastSpeaker || null;
      parts.push(RP_TRAVERSE2.partyPrompt(trav)
        + "\n本轮应发言队友：" + (speakers.join("、") || "无")
        + "（按各自人设自由发言、行动或互相拌嘴；正文里用「名字：」区分说话人）");
    }
  }catch(e){}
  /* 走原著线：注入当前剧情节点调度素材（只读状态机，不推进） */
  try{
    if(trav.plotrunId && typeof RP_PLOTRUN!=="undefined"){
      const _pst = RP_PLOTRUN.load(trav.plotrunId);
      if(_pst){ const _blk = RP_PLOTRUN.directorBlock(_pst); if(_blk) parts.push(_blk); }
    }
  }catch(e){}
  return parts.join("\n\n");
}

/* ---- P1: 角色卡世界 AI 补完 ---- */
window.travWorldComplete = (kind, id)=>{
  __backAction = ()=>showTraverse();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  const wname = RP_TRAVERSE.worldDisplayName(kind, id);
  titleEl.innerHTML = icon("scroll")+" 世界补完"; subEl.textContent = wname;
  const card = (kind === "card" && typeof RP_CARDIMPORT !== "undefined") ? RP_CARDIMPORT.findById(id) : null;
  const seed = RP_TRAVERSE2.extractSeed(card);
  let done = null;
  try{ done = JSON.parse(localStorage.getItem("nd_wb2_"+kind+"_"+id) || "null"); }catch(e){}
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  <div class="card"><div class="kv">角色卡原文设定</div>
  <div class="hint">名称：${esc((card&&card.name)||"")} · 种子文本 ${seed.length} 字</div>
  <div class="meta" style="white-space:pre-wrap;max-height:120px;overflow:hidden">${esc(seed.slice(0,300))}${seed.length>300?"…":""}</div></div>
  ${done?`<div class="card"><div class="kv">已补完 <span class="badge">AI 补完</span></div>
  <div class="hint">${esc((done.bg||"").slice(0,140))}…</div></div>`:""}
  <div class="btnrow"><button class="btn" style="flex:1" onclick="travWorldCompleteGen('${jq(kind)}','${jq(id)}')">${done?"重新补完":"AI 补完世界"}</button></div>
  <div class="hint">AI 只补：时代背景、势力/门派、关键地点、当前局势、3–5 个剧情锚点。补完内容会标注「AI 补完」来源，你确认后才生效。</div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.travWorldCompleteGen = async (kind, id)=>{
  const cfg = getCfg();
  if(!cfg.key||!cfg.base||!cfg.model){ alert("先去「设置」配好 API 地址/Key/模型"); return; }
  try{
    const card = (kind === "card" && typeof RP_CARDIMPORT !== "undefined") ? RP_CARDIMPORT.findById(id) : null;
    const bible = await RP_TRAVERSE2.genWorldBible(card, cfg, (c,m,t)=>RP_NET.complete(c,m,t));
    window._wbDraft = {kind, id, bg: bible.bg, anchors: bible.anchors};
    travWorldCompleteView();
  }catch(e){ alert("补完失败："+e.message); }
};
function travWorldCompleteView(){
  const d = window._wbDraft; if(!d) return;
  __backAction = ()=>travWorldComplete(d.kind, d.id);
  titleEl.innerHTML = icon("scroll")+" 世界补完"; subEl.textContent = RP_TRAVERSE.worldDisplayName(d.kind, d.id);
  view.innerHTML = `<button class="back" onclick="travWorldComplete('${jq(d.kind)}','${jq(d.id)}')">${icon("back")} 返回</button>
  <div class="card"><div class="kv">补完结果（可编辑，确认后生效）</div>
  <div class="field"><label>世界设定 <span class="badge">AI 补完</span></label>
  <textarea id="wbBg" style="width:100%;min-height:180px;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px">${esc(d.bg)}</textarea></div>
  <div class="field"><label>剧情锚点（每行一条） <span class="badge">AI 补完</span></label>
  <textarea id="wbAnchors" style="width:100%;min-height:80px;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px">${esc(d.anchors.join("\n"))}</textarea></div>
  <div class="btnrow" style="margin-top:8px"><button class="btn" style="flex:1" onclick="travWorldCompleteSave()">确认生效</button></div></div>
  <div class="hint">来源标注：卡片原文保持原样；上方内容均为 AI 补完，注入 prompt 时自动标注。</div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
}
window.travWorldCompleteSave = ()=>{
  const d = window._wbDraft; if(!d) return;
  d.bg = $("#wbBg").value.trim();
  d.anchors = $("#wbAnchors").value.split("\n").map(s=>s.trim()).filter(Boolean).slice(0,5);
  d.updatedAt = Date.now();
  localStorage.setItem("nd_wb2_"+d.kind+"_"+d.id, JSON.stringify(d));
  travWorldComplete(d.kind, d.id);
};

/* ---- P2: 异世界穿越 ---- */
window.isekaiPickSrc = ()=>{
  __backAction = ()=>showTraverse();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("repeat")+" 异世界穿越"; subEl.textContent = "第一步：选择穿越的角色";
  const cs = allChars();
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  <div class="hint">把这个角色送进另一部作品的世界。</div>
  <div class="chargrid">${cs.map(c=>`
    <button type="button" class="charcard" onclick="isekaiPickDst('${jq(c.runId)}','${jq(c.name)}')">
      <div class="avatar ${charCoverCls(c.name)}">${esc(c.name[0])}</div>
      <div class="ccname">${esc(c.name)}</div><div class="ccnovel">${esc(c.novel)}</div>
    </button>`).join("")}</div><div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.isekaiPickDst = (srcRunId, srcName)=>{
  __backAction = ()=>isekaiPickSrc();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("repeat")+" 异世界穿越"; subEl.textContent = "第二步：选择目标世界";
  const worlds = RP_TRAVERSE2.listWorlds();
  view.innerHTML = `<button class="back" onclick="isekaiPickSrc()">${icon("back")} 返回</button>
  <div class="hint">穿越者：${esc(srcName)}</div>
  ${worlds.map(w=>`
  <div class="card card--tap" onclick="isekaiFusion('${jq(srcRunId)}','${jq(srcName)}','${jq(w.key)}')">
    <div class="name">《${esc(w.title)}》 ${w.status==="pending"?'<span class="badge">数据待接入</span>':'<span class="badge">已接入</span>'}</div>
    <div class="meta">${esc(w.note||"")}</div>
  </div>`).join("")}
  <div class="hint">「数据待接入」的世界（如水浒）也可以进：AI 不会编造该世界的具体人物剧情，用开放式异世界推进。</div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.isekaiFusion = (srcRunId, srcName, dstKey)=>{
  const w = RP_TRAVERSE2.getWorld(dstKey);
  __backAction = ()=>isekaiPickDst(srcRunId, srcName);
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("repeat")+" 异世界穿越"; subEl.textContent = "第三步：选择融合方式";
  view.innerHTML = `<button class="back" onclick="isekaiPickDst('${jq(srcRunId)}','${jq(srcName)}')">${icon("back")} 返回</button>
  <div class="card"><div class="name">${esc(srcName)} → 《${esc(w.title)}》</div>
  <div class="row" style="margin-top:8px">
  <label class="kvline" style="display:block"><input type="radio" name="fusion" value="outsider" checked> 异乡人：完整保留原身份与记忆，目标世界视你为异人</label>
  <label class="kvline" style="display:block;margin-top:6px"><input type="radio" name="fusion" value="reborn"> 转生：AI 安排目标世界新身份，保留性格与记忆</label></div></div>
  <div class="btnrow"><button class="btn" style="flex:1" onclick="isekaiStart('${jq(srcRunId)}','${jq(srcName)}','${jq(dstKey)}')">开始穿越</button></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.isekaiStart = (srcRunId, srcName, dstKey)=>{
  const w = RP_TRAVERSE2.getWorld(dstKey); if(!w) return;
  const fusion = (document.querySelector('input[name="fusion"]:checked')||{}).value || "outsider";
  const sess = RP_TRAVERSE2.isekaiSession({
    srcKind:"char", srcId:srcRunId, srcName:srcName,
    dstKey:dstKey, dstKind:w.kind, dstId:w.key, fusion, charName:srcName,
  });
  /* 补齐 buildMessages 需要的世界字段：ready 世界尽量映射到真实 runId */
  let runId = w.key;
  if(w.status === "ready" && w.kind === "book"){
    const idx = (window.__DATA__ && window.__DATA__.index) || [];
    const hit = idx.find(r=>(r.novel||"").indexOf(w.title) >= 0);
    if(hit) runId = hit.run_id;
  }
  sess.worldKind = "book"; sess.worldId = runId;
  sess.worldName = RP_TRAVERSE.worldDisplayName("book", runId);
  sess.anchorTitle = "初入异世界";
  RP_TRAVERSE.save(sess);
  travBegin(sess);
};

/* ---- P3: 组团穿越 ---- */
window.partySetup = ()=>{
  __backAction = ()=>showTraverse();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("chat")+" 组团穿越"; subEl.textContent = "第一步：选择世界";
  const ws = travWorlds();
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  <div class="hint">2–4 人小队：你 + 最多 3 名队友。AI 按 talkativeness 调度发言，被你点名的队友一定发言。</div>
  ${ws.map(w=>`
    <div class="card card--tap" onclick="partyPickMain('${jq(w.kind)}','${jq(w.id)}')">
      <div class="name">${esc(w.name)}</div><div class="meta">${esc(w.sub)}</div>
    </div>`).join("")}<div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.partyPickMain = (kind, id)=>{
  __backAction = ()=>partySetup();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("chat")+" 组团穿越"; subEl.textContent = "第二步：你的身份";
  const wname = RP_TRAVERSE.worldDisplayName(kind, id);
  view.innerHTML = `<button class="back" onclick="partySetup()">${icon("back")} 返回</button>
  <div class="card"><div class="kv">${esc(wname)}</div>
  <div class="btnrow" style="margin-top:8px">
  <button class="btn" style="flex:1" onclick="partyPickMainSoul('${jq(kind)}','${jq(id)}')">魂穿：选一个角色</button>
  <button class="btn ghost" style="flex:1" onclick="partyPickMainBody('${jq(kind)}','${jq(id)}')">肉身：快速捏身份</button></div></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.partyPickMainSoul = (kind, id)=>{
  __backAction = ()=>partyPickMain(kind, id);
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("chat")+" 组团穿越"; subEl.textContent = "选择你要扮演的角色";
  const cs = allChars();
  window._partyCands = cs;
  view.innerHTML = `<button class="back" onclick="partyPickMain('${jq(kind)}','${jq(id)}')">${icon("back")} 返回</button>
  <div class="chargrid">${cs.map((c,ix)=>`
    <button type="button" class="charcard" onclick="partyPickMainSoulGo('${jq(kind)}','${jq(id)}',${jq(ix)})">
      <div class="avatar ${charCoverCls(c.name)}">${esc(c.name[0])}</div>
      <div class="ccname">${esc(c.name)}</div><div class="ccnovel">${esc(c.novel)}</div>
    </button>`).join("")}</div><div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.partyPickMainSoulGo = (kind, id, ix)=>{
  const c = (window._partyCands||[])[ix]; if(!c) return;
  partyPickComps(kind, id, {mode:"soul", runId:c.runId, name:c.name});
};
window.partyPickMainBody = (kind, id)=>{
  __backAction = ()=>partyPickMain(kind, id);
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("chat")+" 组团穿越"; subEl.textContent = "肉身：快速捏身份";
  view.innerHTML = `<button class="back" onclick="partyPickMain('${jq(kind)}','${jq(id)}')">${icon("back")} 返回</button>
  <div class="card"><div class="field"><label>一句话设定你的身份/开场</label>
  <input id="pbWish" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" placeholder="比如：现代大学生，带着手机穿进大观园"></div>
  <label class="kvline"><input type="checkbox" id="pbModern" checked> 现代人直穿（携带手机/打火机/纸巾）</label>
  <div class="btnrow" style="margin-top:8px"><button class="btn" style="flex:1" onclick="partyBodyNext('${jq(kind)}','${jq(id)}')">下一步：选队友</button></div></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.partyBodyNext = (kind, id)=>{
  partyPickComps(kind, id, {mode:"body",
    wish:($("#pbWish").value||"").trim(), modern:$("#pbModern").checked});
};
window.partyPickComps = (kind, id, main)=>{
  __backAction = ()=>partyPickMain(kind, id);
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("chat")+" 组团穿越"; subEl.textContent = "第三步：选择队友（最多3人）";
  const cs = allChars().filter(c=>!(main.mode==="soul" && c.name===main.name));
  window._partyCands = cs; window._partySel = []; window._partyMain = main;
  view.innerHTML = `<button class="back" onclick="partyPickMain('${jq(kind)}','${jq(id)}')">${icon("back")} 返回</button>
  <div class="hint">主身份：${esc(main.mode==="soul"?main.name:((main.wish||"")+"（肉身）")||"肉身")}</div>
  <div class="chargrid">${cs.map((c,ix)=>`
    <button type="button" class="charcard" id="pc_${ix}" onclick="partyToggleComp(${jq(ix)})">
      <div class="avatar ${charCoverCls(c.name)}">${esc(c.name[0])}</div>
      <div class="ccname">${esc(c.name)}</div><div class="ccnovel">${esc(c.novel)}</div>
    </button>`).join("")}</div>
  <div class="btnrow" style="position:sticky;bottom:70px"><button class="btn" style="flex:1" onclick="partyStart('${jq(kind)}','${jq(id)}')">出发！</button></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.partyToggleComp = (ix)=>{
  const s = window._partySel || [];
  const el = $("#pc_"+ix);
  const at = s.indexOf(ix);
  if(at >= 0){ s.splice(at,1); if(el) el.classList.remove("sel"); }
  else{ if(s.length >= 3){ alert("最多 3 名队友"); return; } s.push(ix); if(el) el.classList.add("sel"); }
  window._partySel = s;
};
window.partyStart = (kind, id, main)=>{
  const sel = window._partySel || [];
  main = main || window._partyMain;
  if(!main) return;
  if(!sel.length){ alert("至少选 1 名队友"); return; }
  const wname = RP_TRAVERSE.worldDisplayName(kind, id);
  let sess;
  if(main.mode === "soul"){
    sess = RP_TRAVERSE.newSession({mode:"soul", worldKind:kind, worldId:id,
      worldName:wname, charName:main.name, runId:main.runId,
      anchorTitle:"组团穿越", oocRemind:true});
  }else{
    const idt = RP_TRAVERSE.saveIdentity({name:"我", modern:!!main.modern,
      origin:"现代", situation:main.wish || "初入此界",
      items:RP_TRAVERSE2.cloneItems(RP_TRAVERSE2.MODERN_ITEMS), worldName:wname});
    sess = RP_TRAVERSE.newSession({mode:"body", worldKind:kind, worldId:id,
      worldName:wname, identityId:idt.id, anchorTitle:main.wish || "初入此界", oocRemind:true});
  }
  sel.forEach(ix=>{
    const c = (window._partyCands||[])[ix]; if(!c) return;
    RP_TRAVERSE2.addCompanion(sess.id, {name:c.name, runId:c.runId, talk:50});
  });
  travBegin(sess);
};
window.travPartyView = ()=>{
  const trav = RP_TRAVERSE.get(CHAT.travId); if(!trav) return;
  __backAction = ()=>showChat();
  document.body.classList.remove("chatmode","immersive"); /* P2-1: 切页同时清 immersive, 不留残 */
  titleEl.innerHTML = icon("chat")+" 队伍"; subEl.textContent = trav.worldName || "";
  const comps = RP_TRAVERSE2.getCompanions(trav.id);
  view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回</button>
  <div class="hint">AI 按 talkativeness（0–100，默认 50）调度队友发言；被你点名的队友一定发言。聊天记录独立保存在这次穿越里。</div>
  ${comps.map((c,ix)=>`
  <div class="card"><div class="row"><div style="flex:1"><div class="name">${esc(c.name)}</div>
  <div class="meta">talkativeness ${c.talk==null?50:c.talk}</div></div>
  <button class="linkbtn" onclick="travPartyTalk(${jq(ix)},-10)">−</button>
  <button class="linkbtn" onclick="travPartyTalk(${jq(ix)},10)">＋</button>
  <button class="linkbtn danger" onclick="travPartyRemove(${jq(ix)})">移除</button></div></div>`).join("")
  || `<div class="empty">暂无队友</div>`}
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.travPartyTalk = (ix, d)=>{
  const trav = RP_TRAVERSE.get(CHAT.travId); if(!trav) return;
  const comps = RP_TRAVERSE2.getCompanions(trav.id);
  const c = comps[ix]; if(!c) return;
  c.talk = Math.max(0, Math.min(100, (c.talk==null?50:c.talk) + d));
  RP_TRAVERSE2.removeCompanion(trav.id, c.name);
  RP_TRAVERSE2.addCompanion(trav.id, c);
  travPartyView();
};
window.travPartyRemove = (ix)=>{
  const trav = RP_TRAVERSE.get(CHAT.travId); if(!trav) return;
  const comps = RP_TRAVERSE2.getCompanions(trav.id);
  if(comps[ix] && confirm("移除队友 "+comps[ix].name+"？")){
    RP_TRAVERSE2.removeCompanion(trav.id, comps[ix].name);
  }
  travPartyView();
};
