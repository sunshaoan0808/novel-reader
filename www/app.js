/* 蒸馏工坊 v3: 产物浏览器 + 任务管理 + RP 聊天 (纯手机端, 数据内联) */
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

function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

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
document.body.classList.remove("chatmode");
mainnav.querySelectorAll("button").forEach(b=>
b.classList.toggle("active", b.dataset.nav===n));
window.scrollTo(0,0);
if(n==="product"){ tabs.classList.toggle("hidden",!RUN); RUN? setTab(TAB,true): showRuns();}
else if(n==="tasks"){ tabs.classList.add("hidden"); showTasks();}
else if(n==="chat"){ tabs.classList.add("hidden"); (CHAT.name||CHAT.mode==="traverse"||CHAT.mode==="group") ? showChat() : showChatPicker(); }
else if(n==="traverse"){ tabs.classList.add("hidden"); showTraverse(); }
else if(n==="settings"){ tabs.classList.add("hidden"); showSettings();}
else if(n==="writer"){ tabs.classList.add("hidden"); showWriter();}
}
mainnav.querySelectorAll("button").forEach(b=>
b.addEventListener("click", ()=>setNav(b.dataset.nav)));

async function boot(){
const D = window.__DATA__;
if(!D ||!D.index){
view.innerHTML = `<div class="empty">数据未生成<br><span style="font-size:12px">请先运行 snapshot.py</span></div>`;
return;
}
INDEX = D.index;
showRuns();
}

/* ================= 产物浏览 (原有) ================= */
function showRuns(){
__backAction = null;
titleEl.textContent = "蒸馏工坊";
subEl.textContent = `${INDEX.length} 个蒸馏任务 · 离线浏览`;
view.innerHTML = INDEX.map(r=>`
<div class="card" onclick='openRun(${JSON.stringify(r.run_id)})'>
<div class="row">
<div class="avatar">${esc(r.novel[0]||"书")}</div>
<div>
<div class="name">${esc(r.novel)}</div>
<div class="meta">${esc(r.run_id)} · ${r.n_chunks} 块</div>
</div>
</div>
<div style="margin-top:8px">
${r.characters.map(c=>`<span class="badge">${esc(c)}</span>`).join("")}
${r.scope?`<span class="badge warn">范围蒸馏</span>`:""}
${r.has_plot?`<span class="badge">有剧情层</span>`:""}
</div>
</div>`).join("") || `<div class="empty">暂无任务</div>`;
}

function openRun(runId){
RUN = window.__DATA__.runs[runId];
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
else showMore();
}
tabs.querySelectorAll("button").forEach(b=>
b.addEventListener("click", ()=>setTab(b.dataset.tab)));

function tagline(p){
const m = p.md.match(/\*\*core_identity\*\*:\s*([^\n]+)/)
|| p.md.match(/\*\*core_traits\*\*:\s*([^\n]+)/);
return m ? m[1].trim().slice(0, 46) : "";
}
/* Janitor 式角色卡片网格 (v24) */
function charCoverCls(name){ let h=0; const s2=String(name||"?"); for(let i=0;i<s2.length;i++) h=(h*31+s2.charCodeAt(i))>>>0; return "cc"+(h%4); }
function charCardHTML(o){
return `<div class="charcard" onclick="${o.oncard}">`
+ `<div class="charcover ${charCoverCls(o.name)}">`
+ (o.tag?`<div class="tag">${esc(o.tag)}</div>`:"")
+ `<div class="big">${esc((o.name||"?")[0])}</div></div>`
+ `<div class="charbody"><div class="n">${esc(o.name)}</div>`
+ `<div class="s">${esc(o.sum||"")}</div>`
+ (o.ops?`<div class="ops">${o.ops}</div>`:"")
+ `</div></div>`;
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
const run=(window.__DATA__.runs||{})[runId]||{};
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
window.groupPicker = ()=>{
__backAction = ()=>setTab("chars");
titleEl.textContent = "选择群聊成员"; subEl.textContent = RUN.novel + " · 至少选 2 人";
view.innerHTML = `<button class="back" onclick="setTab('chars')">${icon("back")} 返回人物</button>
<div id="gpick">` + RUN.profiles.map(p=>`
<label class="pickcard"><input type="checkbox" value="${esc(p.name)}">
<div class="avatar sm">${esc(p.name[0])}</div><div class="name">${esc(p.name)}</div></label>`).join("") + `</div>
<div class="actionbar"><button class="btn" style="flex:1" onclick="startGroupChat()">开始群聊</button></div>
<div style="height:76px"></div>`;
window.scrollTo(0,0);
};
window.startGroupChat = ()=>{
const sel = Array.from(document.querySelectorAll("#gpick input:checked")).map(i=>i.value);
if(sel.length < 2){ alert("至少选 2 个人才能群聊"); return; }
CHAT = {mode:"group", runId: RUN.run_id, name:null, members: sel, forcedSpeaker:null};
loadPov();
setNav("chat");
};
function charList(ps){
if(!ps.length) return `<div class="empty"><span class="big">🎭</span>暂无人物卡</div>`;
return `<div class="chargrid">` + ps.map(p=>charCardHTML({
name:p.name, tag:RUN.novel, sum:tagline(p)||"人物档案",
oncard:`openChar(${JSON.stringify(p.name)})`,
ops:`<button class="go" onclick='event.stopPropagation();chatWith(${JSON.stringify(RUN.run_id)},${JSON.stringify(p.name)})'>开聊</button>`
+`<button onclick='event.stopPropagation();openChar(${JSON.stringify(p.name)})'>详情</button>`
})).join("") + `</div>`;
}
window.filterChars = (kw)=>{
const items = RUN.profiles.filter(p=>p.name.includes(kw));
$("#clist").innerHTML = charList(items);
};
window.openChar = (name)=>{
__backAction = ()=>setTab("chars");
const p = RUN.profiles.find(x=>x.name===name);
titleEl.textContent = p.name; subEl.textContent = RUN.novel;
view.innerHTML = `<button class="back" onclick="setTab('chars')">${icon("back")} 返回人物</button>
<div class="btnrow" style="margin-bottom:10px"><button class="btn ghost" onclick='genPortrait(${JSON.stringify(RUN.run_id)},${JSON.stringify(p.name)})'>${icon("palette")} 生成立绘</button></div>
<div class="card md">${md(p.md)}</div>
<div style="height:76px"></div>
<div class="actionbar"><button class="btn" style="flex:1" onclick='chatWith(${JSON.stringify(RUN.run_id)},${JSON.stringify(p.name)})'>和 ${esc(p.name)} 聊天</button></div>`;
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

function showMore(){
const wb = RUN.worldbook;
let wbHtml = "";
if(wb && wb.length){
const cats = {};
wb.forEach(e=>{ (cats[e.category||"其他"] = cats[e.category||"其他"]||[]).push(e); });
wbHtml = `<h2 class="sec">世界观 · ${wb.length} 条</h2>
<div class="btnrow" style="margin-bottom:10px"><button class="btn ghost" onclick="loreEditor(RUN.run_id,'more')">${icon("edit")} 管理世界书</button></div>` + Object.keys(cats).map(c=>
`<div class="wb-cat">${esc(c)}</div>` + cats[c].map(e=>`
<div class="rel"><div class="pair">${esc(e.title||"")}</div>
<div class="st">${esc((e.rules||[]).join("\n"))}</div>
${(e.trigger_keywords||[]).length?`<div class="wb-keys">${e.trigger_keywords.map(k=>`<span class="badge">${esc(k)}</span>`).join("")}</div>`:""}
</div>`).join("")).join("");
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
view.innerHTML = wbHtml + arcHtml + fsHtml + cfHtml;
}


/* ================= 生图立绘 ================= */
function portraitPrompt(runId, name){
const cards = ((window.__DATA__||{}).rp_cards||{})[runId]||[];
const c = cards.find(x=>x.name===name);
const f = (c&&c.fields)||{};
const novel = ((window.__DATA__||{}).runs||{})[runId];
const nv = (novel&&novel.novel)||"";
return `中国古典小说人物立绘，${name}，《${nv}》中的人物。外貌：${f.visual_identity||""}。气质服饰：${f.voice_dressing||""}。工笔国风插画风格，半身像，纯色背景，高质量。`;
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

/* ================= TTS 朗读 ================= */
const ttsCache = {};
let curAudio = null, curAudioKey = null;
window.ttsMsg = async (idx)=>{
const cfg = getCfg();
const k = chatHistKey() + "#" + idx;
if(curAudioKey===k){ ttsStop(); return; }
ttsStop();
const h = getHist(chatHistKey());
const m = h[idx]; if(!m || m.role!=="assistant") return;
const text = String(m.content).replace(/[*#`>\-\[\]()]/g, "").slice(0, 800);
if(cfg.key && cfg.base && cfg.ttsModel){
try{
let url = ttsCache[k];
if(!url){
url = await RP_NET.tts(cfg, text, cfg.ttsModel, cfg.ttsVoice||"alloy");
ttsCache[k] = url;
}
curAudio = new Audio(url); curAudioKey = k;
curAudio.onended = ()=>{ curAudio = null; curAudioKey = null; };
await curAudio.play();
}catch(e){ alert("TTS 失败：" + e.message); }
return;
}
/* 无远端 TTS 配置: 用手机自带免费语音兜底（对标猫箱端侧语音参考） */
if(!("speechSynthesis" in window)){ alert("先去「设置」填 API 地址/Key 和 TTS 模型"); return; }
try{
const u = new SpeechSynthesisUtterance(text);
u.lang = "zh-CN";
window._localTtsOn = true; curAudioKey = k;
u.onend = u.onerror = ()=>{ window._localTtsOn = false; curAudioKey = null; };
speechSynthesis.speak(u);
}catch(e){ alert("本地语音失败：" + e.message); }
};
function ttsStop(){
if(curAudio){ try{curAudio.pause();}catch(e){} curAudio = null; }
if(window._localTtsOn && ("speechSynthesis" in window)){ speechSynthesis.cancel(); window._localTtsOn = false; }
curAudioKey = null;
}

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
const loreKey = (runId)=> `nd_lore_${runId}`;
const getLore = (runId)=>{ try{return JSON.parse(localStorage.getItem(loreKey(runId)))||[]}catch(e){return[]}} ;
const saveLore = (runId, arr)=> localStorage.setItem(loreKey(runId), JSON.stringify(arr));
const loreBack = {to:null};
window.loreEditor = (runId, backTo)=>{
__backAction = ()=>loreGoBack();
document.body.classList.remove("chatmode");
loreBack.to = backTo || "more";
const run = ((window.__DATA__||{}).runs||{})[runId]||{};
titleEl.textContent = "世界书管理"; subEl.textContent = (run.novel||"") + " · 自建条目进 prompt";
renderLoreList(runId);
};
function renderLoreList(runId){
__backAction = ()=>loreGoBack();
const arr = getLore(runId);
view.innerHTML = `<button class="back" onclick="loreGoBack()">${icon("back")} 返回</button>
<div class="btnrow" style="margin-bottom:10px"><button class="btn" onclick="loreForm('${runId}')">${icon("plus")} 新增条目</button><button class="btn" onclick="importStLore('${runId}')">${icon("download")} 导入 ST 世界书</button></div>
<div class="hint">自建条目和蒸馏产出的世界书一起参与关键词触发（常驻条目每轮必进），存在本机。</div>
${arr.map((e,i)=>`
<div class="card"><div class="row"><div style="flex:1">
<div class="name">${esc(e.title||"无标题")} ${e.constant?'<span class="badge warn">常驻</span>':""} ${e.enabled===false?'<span class="badge">停用</span>':""}</div>
<div class="meta">触发词：${esc((e.keys||[]).join("、")||"无")} · 优先级 ${e.priority==null?60:e.priority} · 约 ${RP_PROMPT.estTokens(e.content||"")} tok</div>
</div></div>
<div class="btnrow" style="margin-top:8px">
<button class="btn ghost" onclick="loreForm('${runId}',${i})">编辑</button>
<button class="btn ghost" onclick="loreToggle('${runId}',${i})">${e.enabled===false?"启用":"停用"}</button>
<button class="btn danger" onclick="loreDel('${runId}',${i})">删除</button>
</div></div>`).join("") || `<div class="empty">还没有自建条目<br><button class="btn" style="margin-top:10px" onclick="loreForm('${runId}')">新增第一条</button></div>`}`;
window.scrollTo(0,0);
}
window.loreGoBack = ()=>{ loreBack.to==="chat" ? showChat() : setTab("more"); };
window.loreToggle = (runId, i)=>{ const a = getLore(runId); a[i].enabled = a[i].enabled===false ? true : false; saveLore(runId, a); renderLoreList(runId); };
/* SillyTavern 世界书(JSON, entries 字典) -> 本机条目 */
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
const es = stLoreToEntries(d);
if(!es){ alert("解析失败: 不是 ST 世界书格式"); return; }
const a = getLore(runId); es.forEach(function(e){ a.push(e); });
saveLore(runId, a); renderLoreList(runId);
alert("已导入 " + es.length + " 条世界书");
}catch(e){ alert("解析失败: " + e.message); }
};
rd.readAsText(f);
};
inp.click();
};
window.loreDel = (runId, i)=>{ if(!confirm("删除这条世界书？")) return; const a = getLore(runId); a.splice(i,1); saveLore(runId, a); renderLoreList(runId); };
window.loreForm = (runId, i)=>{
__backAction = ()=>renderLoreList(runId);
const _ll = getLore(runId);
const _isNew = (i==null || !_ll[i]);
const e = _isNew ? {title:"", keys:[], content:"", constant:false, priority:60, enabled:true} : _ll[i];
titleEl.textContent = (_isNew?"新增":"编辑") + "世界书条目"; subEl.textContent = "";
view.innerHTML = `<button class="back" onclick="renderLoreList('${runId}')">${icon("back")} 返回列表</button>
<div class="field"><label>标题</label><input id="l_title" value="${esc(e.title||"")}"></div>
<div class="field"><label>触发词（逗号/顿号分隔，消息里出现即触发）</label><input id="l_keys" value="${esc((e.keys||[]).join("、"))}" placeholder="如：大观园、贾府"></div>
<div class="field"><label>内容（进 prompt 的正文）</label><textarea id="l_content" oninput="tokCount('l_content','l_tok')" style="width:100%;min-height:120px;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:10px">${esc(e.content||"")}</textarea><div class="tokline" id="l_tok"></div></div>
<div class="field"><label>优先级（越大越先，默认 60）</label><input id="l_pri" type="number" value="${e.priority==null?60:e.priority}"></div>
<div class="field"><label><input type="checkbox" id="l_const" style="width:auto" ${e.constant?"checked":""}> 常驻条目（每轮必进 prompt）</label></div>
<div class="field"><label><input type="checkbox" id="l_en" style="width:auto" ${e.enabled===false?"":"checked"}> 启用</label></div>
<div class="btnrow"><button class="btn" onclick="loreSave('${runId}',${i==null?"null":i})">保存</button></div>`;
tokCount("l_content","l_tok");
window.scrollTo(0,0);
};
window.loreSave = (runId, i)=>{
const keys = $("#l_keys").value.split(/[，,、]/).map(x=>x.trim()).filter(Boolean);
const e = {title: $("#l_title").value.trim()||"无标题", keys, content: $("#l_content").value.trim(),
priority: parseInt($("#l_pri").value)||60, constant: $("#l_const").checked, enabled: $("#l_en").checked,
id: "u"+Date.now()};
if(!e.content){ alert("内容不能为空"); return; }
const a = getLore(runId);
if(i==null) a.push(e); else { e.id = a[i].id||e.id; a[i] = e; }
saveLore(runId, a); renderLoreList(runId);
};

/* ================= 正则替换 ================= */
const regexKey = (runId, name)=> `nd_regex_${runId}_${name}`;
const getRegexUI = (runId, name)=>{ try{return JSON.parse(localStorage.getItem(regexKey(runId,name)))||[]}catch(e){return[]}};
const saveRegexUI = (runId, name, arr)=> localStorage.setItem(regexKey(runId,name), JSON.stringify(arr));
const regexBack = {to:null};
window.regexEditor = (runId, name, backTo)=>{
__backAction = ()=>regexGoBack();
RX_CTX.runId = runId; RX_CTX.name = name;
document.body.classList.remove("chatmode");
regexBack.to = backTo || "chat";
const names = name ? [name] : [];
renderRegexList(runId, names[0]||"");
};
function regexCharSel(runId, cur){
const ms = (CHAT.mode==="group") ? CHAT.members : (CHAT.name ? [CHAT.name] : []);
if(!ms.length) return "";
return `<div class="field"><label>角色</label><select id="rx_char" onchange="renderRegexList('${runId}',this.value)">`
+ ms.map(n=>`<option value="${esc(n)}" ${n===cur?"selected":""}>${esc(n)}</option>`).join("") + `</select></div>`;
}
window.renderRegexList = (runId, name)=>{
__backAction = ()=>regexGoBack();
if(!name){ const ms=(CHAT.mode==="group")?CHAT.members:(CHAT.name?[CHAT.name]:[]); name = ms[0]||""; }
titleEl.textContent = "正则替换"; subEl.textContent = (name? name+" · ":"") + "只做查找替换，不执行代码";
const arr = name ? getRegexUI(runId, name) : [];
view.innerHTML = `<button class="back" onclick="regexGoBack()">${icon("back")} 返回</button>
${regexCharSel(runId, name)}
<div class="btnrow" style="margin-bottom:10px"><button class="btn" onclick="importStRegex()">${icon("download")} 导入 ST 脚本</button><button class="btn" onclick="regexForm('${runId}','${name.replace(/'/g,"\\'")}')">${icon("plus")} 新增规则</button></div>
<div class="hint">AI 回复发出前按顺序执行：查找（正则）→ 替换为。如把"好的"替换成"好"，或统一口头禅。非法正则会被跳过。</div>
${arr.map((r,i)=>`
<div class="card">${r.name?`<div class="kv" style="color:var(--gold)">${esc(r.name)}${r.flags&&r.flags!=="g"?` <span style="color:var(--ink-faint)">/${esc(r.flags)}</span>`:""}</div>`:""}<div class="name" style="font-size:13px">${esc(r.find||"")} <span style="color:var(--ink-faint)">→</span> ${esc(String(r.replace||"")).slice(0,60)}</div>
<div class="meta">${r.enabled===false?"停用":"启用"}</div>
<div class="btnrow" style="margin-top:8px">
<button class="btn ghost" onclick="regexForm('${runId}','${name.replace(/'/g,"\\'")}',${i})">编辑</button>
<button class="btn ghost" onclick="regexToggle('${runId}','${name.replace(/'/g,"\\'")}',${i})">${r.enabled===false?"启用":"停用"}</button>
<button class="btn danger" onclick="regexDel('${runId}','${name.replace(/'/g,"\\'")}',${i})">删除</button>
</div></div>`).join("") || `<div class="empty">还没有规则</div>`}`;
window.scrollTo(0,0);
};
window.regexGoBack = ()=>{ showChat(); };
window.regexToggle = (runId, name, i)=>{ const a=getRegexUI(runId,name); a[i].enabled = a[i].enabled===false?true:false; saveRegexUI(runId,name,a); renderRegexList(runId,name); };
window.regexDel = (runId, name, i)=>{ if(!confirm("删除这条规则？")) return; const a=getRegexUI(runId,name); a.splice(i,1); saveRegexUI(runId,name,a); renderRegexList(runId,name); };
let RX_CTX = {runId:null, name:null};
/* SillyTavern 正则脚本 -> 本机规则: 只支持 placement 含 1(AI 输出) 的; {{macro}} 类占位不支持 */
function stRegexToRule(d){
if(!d || typeof d.findRegex !== "string") return null;
const placement = d.placement || [1];
if(placement.indexOf(1) < 0) return null;
let find = d.findRegex, flags = "g";
const m = d.findRegex.match(/^\/(.*)\/([a-z]*)$/s);
if(m){ find = m[1]; flags = ((m[2]||"").replace(/g/g,"")) + "g"; }
try{ new RegExp(find, flags); }catch(e){ return null; }
return {name: d.scriptName || "ST 导入", find: find, flags: flags,
replace: d.replaceString != null ? d.replaceString : "", enabled: !d.disabled};
}
window.importStRegex = ()=>{
const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
inp.onchange = ()=>{
const f = inp.files[0]; if(!f) return;
const rd = new FileReader();
rd.onload = ()=>{
try{
const d = JSON.parse(rd.result);
const r = stRegexToRule(d);
if(!r){ alert("解析失败: 不是 ST 正则脚本, 或只作用于用户输入(本机正则只处理 AI 输出)"); return; }
const a = getRegexUI(RX_CTX.runId, RX_CTX.name); a.push(r);
saveRegexUI(RX_CTX.runId, RX_CTX.name, a); renderRegexList(RX_CTX.runId, RX_CTX.name);
alert("已导入: " + r.name);
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
view.innerHTML = `<button class="back" onclick="renderRegexList('${runId}','${name.replace(/'/g,"\\'")}')">${icon("back")} 返回列表</button>
<div class="field"><label>查找（正则表达式）</label><input id="x_find" value="${esc(r.find||"")}" placeholder="如：好的|嗯嗯"></div>
<div class="field"><label>替换为（可用 $1 引用分组）</label><input id="x_rep" value="${esc(r.replace||"")}" oninput="tokCount('x_rep','x_tok')"><div class="tokline" id="x_tok"></div></div>
<div class="field"><label><input type="checkbox" id="x_en" style="width:auto" ${r.enabled===false?"":"checked"}> 启用</label></div>
<div class="btnrow"><button class="btn" onclick="regexSave('${runId}','${name.replace(/'/g,"\\'")}',${i==null?"null":i})">保存</button></div>`;
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
<button class="btn ghost" onclick="copyTask(${JSON.stringify(t.id)})">复制发给 Muse</button>
<button class="btn danger" onclick="delTask(${JSON.stringify(t.id)})">删除</button>
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
  temperature:0.9, topP:1, ooc:true, preset:"classic", optCards:false, optCount:4, optMood:"none"}, JSON.parse(localStorage.getItem(RPCFG_KEY)||"{}"));
const saveRpCfg = (c)=> localStorage.setItem(RPCFG_KEY, JSON.stringify(c));
const chatKey = (runId, name)=> `nd_chat_${runId}_${name}`;
const getHist = (k)=>{ try{return JSON.parse(localStorage.getItem(k))||[]}catch(e){return[]}};
const saveHist = (k,h)=> localStorage.setItem(k, JSON.stringify(h.slice(-80)));

let CHAT = {mode:"single", runId:null, name:null, members:[], forcedSpeaker:null};
const groupKey = (runId, members)=> `nd_group_${runId}_${members.slice().sort().join("_")}`;
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
else { const run = window.__DATA__.runs[r.run_id];
(run.profiles||[]).forEach(p=>out.push({runId:r.run_id, novel:r.novel, name:p.name})); }
}
return out;
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
const run = (window.__DATA__.runs||{})[CHAT.runId] || {};
let memN = 0;
try{ const mst = RP_MEM.get(CHAT.runId, CHAT.name); memN = (mst && mst.short ? mst.short.length : 0); }catch(e){}
view.innerHTML = `
<div class="chathead" id="chathead">
<button class="backbtn" onclick="exitChat()">‹</button>
<div class="avatar">${esc((CHAT.name||"?")[0])}</div>
<div class="chead-main"><div class="cname">${esc(CHAT.name)}</div>
<div class="cstat">${run.novel?`<span>${esc(run.novel)}</span>`:""}<button onclick="toggleDrawer(false);openAlbum(CHAT.runId,CHAT.name)"><span class="mement">${icon("brain",15)} ${memN}条记忆</span>›</button></div></div>
<button class="menubtn" onclick="toggleDrawer(true)" title="菜单">${icon("menu")}</button>
</div>
<div class="chatwrap">
<div id="ctxbar"></div>
<div id="chatlog"></div>
<div id="scenbar" class="scenbar"></div>
<div class="chatbar">${chatbarInner(false)}</div>
</div>
<div class="scrim" id="scrim" onclick="toggleDrawer(false)"></div>
<div class="drawer" id="drawer">
<h3>切换角色</h3>
${cs.map(c=>`<button class="whoami ${c.runId===CHAT.runId&&c.name===CHAT.name?"active":""}" onclick="switchChat('${c.runId}|${c.name}')">
<div class="avatar sm">${esc(c.name[0])}</div>
<div><div class="name">${esc(c.name)}</div><div class="kv">${esc(c.novel)}</div></div>
</button>`).join("")}
<h3>叙事视角</h3>
${povChipsHTML()}
<h3>聊天</h3>
<button class="ditem" onclick="toggleDrawer(false);openAlbum(CHAT.runId,CHAT.name)">${icon("books")} 记忆事件簿</button>
<button class="ditem" onclick="toggleDrawer(false);openSaves()">${icon("save")} 平行存档</button>
<button class="ditem" onclick="toggleDrawer(false);personaEditor(CHAT.runId,'chat')">${icon("user")} 我的人设（本次覆盖）</button>
<button class="ditem" onclick="toggleDrawer(false);charDetail(CHAT.runId,CHAT.name)">${icon("user")} 角色详情</button>
<button class="ditem" onclick="toggleDrawer(false);showATasks()">${icon("chart")} 分析任务</button>
<button class="ditem" onclick="toggleDrawer(false);plotEditor()">${icon("book-open")} 剧情线</button>
<button class="ditem" onclick="toggleDrawer(false);loreEditor(CHAT.runId,'chat')">${icon("book-open")} 世界书管理</button>
<button class="ditem" onclick="toggleDrawer(false);regexEditor(CHAT.runId,CHAT.name,'chat')">🔤 正则替换</button>
<button class="ditem" onclick="toggleDrawer(false);showSystem()">${icon("settings")} 人设 prompt 预览</button>
<button class="ditem" onclick="toggleDrawer(false);exportChat()">&#x1F4E4; 复制聊天记录</button>
<button class="ditem danger" onclick="toggleDrawer(false);clearChat()">&#x1F5D1; 清空聊天记录</button>
<h3>设置</h3>
<button class="ditem" onclick="exitChatTo('settings')">&#x1F527; 大模型与 RP 设置</button>
</div>
${!cfg.key?`<div class="hint" style="margin:10px 14px">还没配大模型接口，先去「设置」里填 API 地址/Key/模型，聊天才能用。Key 只存在你手机上。</div>`:""}`;
renderChat();
renderScenChips();
attachHeadHide();
const k = chatKey(CHAT.runId, CHAT.name);
if(!getHist(k).length){
RP.greeting(CHAT.runId, CHAT.name, cfg, run.novel).then(g=>{
if(getHist(k).length) return;
saveHist(k, [{role:"assistant", content:g, ts:Date.now()}]); renderChat();
});
}
}

/* ================= 群聊 ================= */
async function showGroupChat(cfg){
__backAction = ()=>exitChat();
const ms = CHAT.members;
const k = chatHistKey();
const gkey = ms.slice().sort().join("_");
const gorder = RP_GROUP.getOrder(CHAT.runId, gkey);
const stack = ms.slice(0,4).map(n=>`<div class="avatar sm stacka">${esc(n[0])}</div>`).join("");
view.innerHTML = `
<div class="chathead" id="chathead">
<button class="backbtn" onclick="exitChat()">‹</button>
<div class="stack">${stack}</div>
<div class="cname">群聊 · ${ms.length} 人<small>${esc(ms.join("、"))}</small></div>
<button class="menubtn" onclick="toggleDrawer(true)" title="菜单">${icon("menu")}</button>
</div>
<div class="chatwrap">
<div id="ctxbar"></div>
<div id="chatlog"></div>
<div id="scenbar" class="scenbar"></div>
<div class="chatbar">${chatbarInner(false)}</div>
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
${ms.map(n=>{const qn=n.replace(/'/g,"\\'"); const tv=RP_GROUP.getTalk(CHAT.runId,n);
return `<div class="gmember"><button class="whoami ${CHAT.forcedSpeaker===n?"active":""}" onclick="forceSpeaker('${qn}')">
<div class="avatar sm">${esc(n[0])}</div>
<div><div class="name">${esc(n)}${CHAT.forcedSpeaker===n?" · 下一个说":""}</div></div>
</button><div class="talkrow"><span>发言欲</span><input type="range" min="0" max="100" step="5" value="${tv}" oninput="setTalkVal('${qn}',this.value)"><b>${tv}</b></div></div>`;}).join("")}
<h3>叙事视角</h3>
${povChipsHTML()}
<h3>聊天</h3>
<button class="ditem" onclick="toggleDrawer(false);showSystem()">${icon("settings")} 人设 prompt 预览</button>
<button class="ditem" onclick="toggleDrawer(false);showATasks()">${icon("chart")} 分析任务</button>
<button class="ditem" onclick="toggleDrawer(false);plotEditor()">${icon("book-open")} 剧情线</button>
<button class="ditem" onclick="toggleDrawer(false);openSaves()">${icon("save")} 平行存档</button>
<button class="ditem" onclick="toggleDrawer(false);personaEditor(null,'chat')">${icon("user")} 我的人设（全局）</button>
<button class="ditem" onclick="toggleDrawer(false);loreEditor(CHAT.runId,'chat')">${icon("book-open")} 世界书管理</button>
<button class="ditem" onclick="toggleDrawer(false);regexEditor(CHAT.runId,null,'chat')">🔤 正则替换</button>
<button class="ditem" onclick="toggleDrawer(false);exportChat()">&#x1F4E4; 复制聊天记录</button>
<button class="ditem danger" onclick="toggleDrawer(false);clearChat()">&#x1F5D1; 清空聊天记录</button>
<h3>设置</h3>
<button class="ditem" onclick="exitChatTo('settings')">&#x1F527; 大模型与 RP 设置</button>
</div>
${!cfg.key?`<div class="hint" style="margin:10px 14px">还没配大模型接口，先去「设置」里填 API 地址/Key/模型，聊天才能用。Key 只存在你手机上。</div>`:""}`;
renderChat();
renderScenChips();
attachHeadHide();
if(!getHist(k).length){
const sp = ms[Math.floor(Math.random()*ms.length)];
const run = (window.__DATA__.runs||{})[CHAT.runId] || {};
RP.greeting(CHAT.runId, sp, cfg, run.novel).then(g=>{
if(getHist(k).length) return;
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
function showChatPicker(){
__backAction = null;
document.body.classList.remove("chatmode");
titleEl.textContent = "选个角色开聊";
subEl.textContent = "";
const cs = allChars();
view.innerHTML = (cs.length ? `<div class="chargrid">` + cs.map(c=>{ const qn=c.name.replace(/'/g,"\\'");
return charCardHTML({name:c.name, tag:c.novel, sum:charSumFor(c.runId,c.name)||"点我直接开聊",
oncard:`chatWith('${c.runId}','${qn}')`,
ops:`<button class="go" onclick="event.stopPropagation();chatWith('${c.runId}','${qn}')">开聊</button>`
+`<button onclick="event.stopPropagation();charDetail('${c.runId}','${qn}','picker')">详情</button>`});
}).join("") + `</div>` : `<div class="empty"><span class="big">🎭</span>还没有角色<br><span style="font-size:12px">去「写卡」创建你的第一个角色</span><br><button class="btn" style="margin-top:10px" onclick="setNav('writer')">去写卡</button></div>`);
}
window.exitChat = ()=>{ showChatPicker(); };
window.exitChatTo = (n)=>{ document.body.classList.remove("chatmode"); setNav(n); };
window.toggleDrawer = (on)=>{
document.getElementById("drawer").classList.toggle("on", !!on);
document.getElementById("scrim").classList.toggle("on", !!on);
};
function attachHeadHide(){
const log = document.getElementById("chatlog");
if(!log) return;
let lastST = 0, hidden = false;
log.onscroll = ()=>{
const st = log.scrollTop;
const head = document.getElementById("chathead");
if(head){
const shouldHide = st > lastST && st > 140;
if(shouldHide !== hidden){
hidden = shouldHide;
head.classList.toggle("hide", hidden);
// 收起顶栏的布局占位, 让正文直接顶到顶部, 不留黑条 (只 translate 不改变布局)
head.style.marginTop = hidden ? (-head.offsetHeight + "px") : "";
}
}
lastST = st;
};
}
window.exportChat = ()=>{
const h = getHist(chatHistKey());
const txt = h.map(m=>`${m.role==="user"?"我":(CHAT.mode==="group"?(m.speaker||"?"):CHAT.name)}：${m.content}`).join("\n\n");
copyText(txt);
alert(`已复制 ${h.length} 条消息到剪贴板`);
};
function copyText(t){
if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t); return; }
const ta = document.createElement("textarea");
ta.value = t; document.body.appendChild(ta); ta.select();
try{ document.execCommand("copy"); }catch(e){}
document.body.removeChild(ta);
}
window.copyMsg = (idx)=>{
const h = getHist(chatHistKey());
copyText(h[idx].content);
};
window.delMsg = (idx)=>{
const k = chatHistKey();
const h = getHist(k);
h.splice(idx, 1);
saveHist(k, h); renderChat();
};
/* ============ P0-2 消息编辑: 原地改文本; 改用户消息后自动重生成其后 AI 回复 ============ */
window.editMsg = (idx)=>{
if(document.getElementById("live")){ alert("等这条生成完再编辑"); return; }
const msgs = document.querySelectorAll("#chatlog .msg");
const el = msgs[idx]; if(!el) return;
const bub = el.querySelector(".bubble"); if(!bub || bub.querySelector("textarea")) return;
const h = getHist(chatHistKey());
const m = h[idx]; if(!m) return;
bub.dataset.orig = bub.innerHTML;
bub.innerHTML = `<textarea id="editbox" onclick="event.stopPropagation()" style="width:100%;min-height:80px;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px;font-size:14px">${esc(m.content)}</textarea>`
+ `<div class="btnrow" style="margin-top:6px" onclick="event.stopPropagation()"><button class="btn" onclick="editMsgSave(${idx})">保存${m.role==="user"?"并重生成":""}</button>`
+ `<button class="btn ghost" onclick="editMsgCancel(${idx})">取消</button></div>`;
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
const h = getHist(chatHistKey());
const m = h[idx]; if(!m) return;
const who = m.role === "user" ? "我" : (CHAT.name || "TA");
const st = RP_MEM.get(CHAT.runId, CHAT.name) || {};
st.short = st.short || [];
let nid = 1;
st.short.forEach(x=>{ if(x.id >= nid) nid = x.id + 1; });
st.short.push({id: nid, time: "手动置顶",
fact: (who + "：" + String(m.content).replace(/<[^>]*>/g, "").slice(0, 120)),
view: "", pin: true});
st.updatedAt = Date.now();
RP_MEM.save(CHAT.runId, CHAT.name, st);
msgSheet(false);
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
};
window.msgSheet = (on, idx)=>{
let sh = document.getElementById("msgsheet");
let sc = document.getElementById("msgscrim");
if(!on){
if(sh) sh.classList.remove("on");
if(sc) sc.classList.remove("on");
return;
}
const h = getHist(chatHistKey());
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
const prev = String(m.content).replace(/<[^>]*>/g, "").slice(0, 40);
const item = (fn, ic, label, danger)=>
`<button class="msitem${danger?" danger":""}" onclick="${fn}">${icon(ic,16)} ${label}</button>`;
const close = "msgSheet(false);";
sh.innerHTML = `<div class="mshandle"></div><div class="msprev">${esc(prev)}${m.content.length>40?"…":""}</div>`
+ (canPin ? item(close+`pinChatMsg(${idx})`, "pin", "Pin 为长期记忆") : "")
+ (isAI ? item(close+`rateMsg(${idx},1)`, "thumb-up", m.rating===1?"已赞同":"赞同")
+ item(close+`rateMsg(${idx},-1)`, "thumb-down", m.rating===-1?"已反对":"反对") : "")
+ item(close+`editMsg(${idx})`, "edit", "编辑")
+ item(close+`copyMsg(${idx})`, "copy", "复制")
+ (isAI ? item(close+`ttsMsg(${idx})`, "volume", "TTS 朗读") : "")
+ item(`if(confirm("删除这条消息？")){${close}delMsg(${idx})}`, "trash", "删除", true);
document.getElementById("msgscrim").classList.add("on");
sh.classList.add("on");
};
window.editMsgSave = async (idx)=>{
const ta = document.getElementById("editbox");
const nv = ta ? ta.value : "";
if(!nv.trim()){ alert("内容不能为空"); return; }
const k = chatHistKey();
const h = getHist(k);
const m = h[idx]; if(!m) return;
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
window.toggleTools = (ev, idx)=>{
if(_pressFired){ _pressFired = false; return; }
if(ev.target.closest(".msgtools") || ev.target.closest(".swipe")) return;
const msgs = document.querySelectorAll("#chatlog .msg");
const el = msgs[idx];
if(!el) return;
const was = el.classList.contains("show-tools");
msgs.forEach(m=>m.classList.remove("show-tools"));
if(!was) el.classList.add("show-tools");
};
window.switchChat = (v)=>{
const [runId, name] = v.split("|");
CHAT = {mode:"single", runId, name, members:[], forcedSpeaker:null};
localStorage.setItem("nd_chat_last", v);
showChat();
};
window.chatWith = (runId, name)=>{
CHAT = {mode:"single", runId, name, members:[], forcedSpeaker:null};
loadPov();
LAST_STATS = null;
localStorage.setItem("nd_chat_last", `${runId}|${name}`);
setNav("chat");
};
function renderChat(){
const h = getHist(chatHistKey());
const log = $("#chatlog");
if(!log) return;
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
const ts = m.ts?`<div class="ts">${new Date(m.ts).toLocaleString("zh-CN",{hour:"2-digit",minute:"2-digit",month:"numeric",day:"numeric"})}</div>`:"";
let extra = "";
const rateBtns = m.role==="assistant"
? `<button class="${m.rating===1?"on":""}" onclick="event.stopPropagation();rateMsg(${idx},1)">${icon("thumb-up",15)}</button>`
+ `<button class="${m.rating===-1?"on":""}" onclick="event.stopPropagation();rateMsg(${idx},-1)">${icon("thumb-down",15)}</button>` : "";
if(m.role==="assistant" && idx===lastAI){
if(m.candidates && m.candidates.length>1){
extra += `<div class="swipe" onclick="event.stopPropagation()"><button onclick="swipeMsg(${idx},-1)">‹</button>`
+ `<span>${(m.ci||0)+1}/${m.candidates.length}</span>`
+ `<button onclick="swipeMsg(${idx},1)">›</button></div>`;
}
extra += `<div class="msgtools">` + rateBtns
+ `<button onclick="event.stopPropagation();ttsMsg(${idx})">${icon("volume",15)}</button>`
+ `<button onclick="event.stopPropagation();editMsg(${idx})">编辑</button>`
+ `<button onclick="event.stopPropagation();copyMsg(${idx})">复制</button>`
+ `<button onclick="event.stopPropagation();regenMsg()">↻ 重生</button>`
+ `<button onclick="event.stopPropagation();delMsg(${idx})">删除</button></div>`;
} else {
extra = `<div class="msgtools">` + rateBtns
+ (m.role==="assistant"?`<button onclick="event.stopPropagation();ttsMsg(${idx})">${icon("volume",15)}</button>`:"")
+ `<button onclick="event.stopPropagation();editMsg(${idx})">编辑</button>`
+ `<button onclick="event.stopPropagation();copyMsg(${idx})">复制</button>`
+ `<button onclick="event.stopPropagation();delMsg(${idx})">删除</button></div>`;
}
let body = m.content, cardHTML = "";
if(m.role==="assistant"){
const oc = parseOptCard(m.content);
if(oc){ body = m.content.replace(oc.full, "").trim(); cardHTML = optCardHTML(oc, idx===lastAI, idx); }
}
return `<div class="msg ${m.role==="user"?"me":""}${mtype==="narr"?" narr":""}${mtype==="npc"?" npc":""}" onclick="toggleTools(event,${idx})" oncontextmenu="event.preventDefault();msgMenu(${idx});return false;" ontouchstart="msgPressStart(event,${idx})" ontouchend="msgPressEnd()" ontouchmove="msgPressEnd()">`
+ `<div class="avatar sm">${esc((who||"?")[0])}</div>`
+ `<div><div class="who">${esc(who)}</div><div class="bubble">${md(body)}${cardHTML}</div>${extra}${ts}</div>`
+ `</div>`;
}).join("") || `<div class="empty">还没有对话，打个招呼吧<br><span style="font-size:12px">试试：你是谁？</span></div>`;
renderCtxBar();
log.scrollTop = log.scrollHeight;
renderWsBar();
}
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
bar.style.display = "block";
bar.innerHTML = `<div class="ctxrow"><div class="ctxbar-bg"><div class="ctxbar-fg${pct>85?" hot":""}" style="width:${pct}%"></div></div>`
+ `<span class="ctxnum">上下文 ${used}/${max} · 历史${s.histKept||0}条</span></div>`
+ (hits.length ? `<div class="ctxlore">${icon("book-open",14)} 触发：${hits.map(x=>esc(x)).join("、")}</div>` : "");
}
/* ============ 单条消息评分 (对标 Talkie RatingFeedback, 本地存档) ============ */
window.rateMsg = (idx, v)=>{
const k = chatHistKey();
const h = getHist(k);
const m = h[idx]; if(!m) return;
m.rating = (m.rating===v) ? 0 : v;
saveHist(k, h); renderChat();
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
  var btns = card.options.map(function(o, i){
    return active
      ? `<button class="optbtn" onclick="event.stopPropagation();pickOption(${idx},${i})">${esc(o)}</button>`
      : `<div class="optbtn off">${esc(o)}</div>`;
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
/* 剧情线 v27: 原著剧情大纲(读者可编辑)。数据源自蒸馏管线(assets/www/data/char_plots.js),
   按角色名匹配; 用户保存过则以用户版为准(含清空); 群聊拼接各成员大纲 */
const bundledPlot = ()=>{
  const names = CHAT.mode==="group" ? (CHAT.members||[]) : [CHAT.name];
  const parts = [];
  for(const n of names||[]){ const o = (window.CHAR_PLOTS||{})[n]; if(o) parts.push(o); }
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
  const h = getHist(chatHistKey());
  const m = h[idx]; if(!m || m.role!=="assistant") return;
  const oc = parseOptCard(m.content); if(!oc || !oc.options[oi]) return;
  pickLock = true;
  try{ await sendChatText(oc.options[oi]); }finally{ pickLock = false; }
};
window.swipeMsg = (idx, dir)=>{
const k = chatKey(CHAT.runId, CHAT.name);
const h = getHist(k);
if(RP.swipe(h[idx], dir)){ saveHist(k, h); renderChat(); }
};
window.regenMsg = async ()=>{
const cfg = getCfg();
const rcfg = getRpCfg();
const k = chatHistKey();
const h = getHist(k);
let rname = CHAT.name;
if(CHAT.mode==="group"){
for(let i=h.length-1;i>=0;i--){ if(h[i].role==="assistant"&&h[i].speaker){ rname = h[i].speaker; break; } }
STREAM_SPEAKER = rname;
}
setStreaming(true);
try{
const r = await RP.regenerate(CHAT.runId, rname, {
cfg: cfg, history: h, temperature: rcfg.temperature,
optCards: !!rcfg.optCards, optCount: rcfg.optCount, optMood: rcfg.optMood,
plotOutline: activePlotOutline(), scenario: scenarioInstr(),
pov: CHAT.pov || "player", person: CHAT.person || "second",
budget: {maxContext: rcfg.maxContext, response: rcfg.respTokens, preset: rcfg.preset},
onToken: streamToken,
signal: streamSignal(),
onSystem: (preview, stats)=>{ LAST_SYSTEM = preview + "\n\n【预算】" + JSON.stringify(stats); LAST_STATS = stats; },
});
saveHist(k, r.history);
}catch(e){}
setStreaming(false);
renderChat();
};
let aborter = null;
function streamSignal(){ aborter = new AbortController(); return aborter.signal; }
/* 输入栏（含旁白按钮；群聊多发言身份选择） */
function chatbarInner(disabled){
if(disabled) return `<input id="chat_in" disabled placeholder="生成中…"><button class="stopbtn" onclick="stopGen()" title="停止">${icon("stop",16)}</button>`;
const ph = CHAT.mode==="group" ? "在群里说点什么…（@名字可点名）"
: CHAT.mode==="traverse" ? `以${esc(travPlayerName())}的身份行动…`
: `和 ${esc(CHAT.name||"TA")} 说点什么…`;
const spk = CHAT.mode==="group"
? `<select id="spksel" onchange="setAsSpeaker(this.value)" title="发言身份"><option value="">我</option>`
+ CHAT.members.map(n=>`<option value="${esc(n)}"${CHAT.asSpeaker===n?" selected":""}>${esc(n)}</option>`).join("") + `</select>` : "";
return `<button id="narrbtn" class="narrbtn${CHAT.narrMode?" on":""}" onclick="toggleNarr()" title="旁白模式：发送场景/动作描写">${icon("scroll")}</button>`
+ `${spk}<input id="chat_in" placeholder="${CHAT.narrMode?"📜 旁白：写场景/动作/心理描写…":ph}" onkeydown="if(event.key==='Enter')sendChat()">`
+ `<button class="sendbtn" onclick="sendChat()" title="发送">${icon("send")}</button>`;
}
window.toggleNarr = ()=>{
CHAT.narrMode = !CHAT.narrMode;
const b = document.getElementById("narrbtn");
if(b) b.classList.toggle("on", !!CHAT.narrMode);
const inp = document.getElementById("chat_in");
if(inp && !inp.disabled) inp.placeholder = CHAT.narrMode ? "📜 旁白：写场景/动作/心理描写…" : (CHAT.mode==="group" ? "在群里说点什么…（@名字可点名）" : `和 ${CHAT.name||"TA"} 说点什么…`);
};
window.setAsSpeaker = (v)=>{ CHAT.asSpeaker = v || null; };
function setStreaming(on){
const bar = document.querySelector(".chatbar");
if(!bar) return;
bar.innerHTML = chatbarInner(on);
}
window.stopGen = ()=>{ if(aborter) aborter.abort(); };
const streamWho = ()=> STREAM_SPEAKER || CHAT.name || "TA";
function streamToken(tok){
const log = $("#chatlog");
let live = document.getElementById("live");
if(!live){
if(document.getElementById("typing")) document.getElementById("typing").remove();
log.insertAdjacentHTML("beforeend",
`<div class="msg"><div class="avatar sm">${esc(streamWho()[0])}</div><div><div class="who">${esc(streamWho())}</div><div class="bubble" id="live"></div></div></div>`);
live = document.getElementById("live");
}
live.textContent += tok;
log.scrollTop = log.scrollHeight;
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
const h = getHist(k);
setStreaming(true);
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
const sendOpts = {
cfg: Object.assign({}, cfg, {maxContext: rcfg.maxContext, summaryModel: rcfg.summaryModel}),
history: h,
temperature: rcfg.temperature, topP: rcfg.topP, maxTokens: rcfg.respTokens,
optCards: !!rcfg.optCards, optCount: rcfg.optCount, optMood: rcfg.optMood,
plotOutline: activePlotOutline(), scenario: scenarioInstr(), oocOn: rcfg.ooc,
userMtype: CHAT.narrMode ? "narr" : (CHAT.asSpeaker ? "npc" : "player"),
userSpeaker: CHAT.asSpeaker || null,
pov: CHAT.pov || "player", person: CHAT.person || "second",
onUserMsg: ()=>{ renderChat(); },
budget: {maxContext: rcfg.maxContext, response: rcfg.respTokens, preset: rcfg.preset},
signal: streamSignal(),
onToken: streamToken,
onSpeaker: (sp)=>{ STREAM_SPEAKER = sp; },
onSpeakerDone: ()=>{ saveHist(k, h); renderChat(); },
onPush: ()=>{ saveHist(k, h); },
onSystem: (preview, stats)=>{ LAST_SYSTEM = preview + "\n\n【预算】" + JSON.stringify(stats); LAST_STATS = stats; },
};
const r = isGroup
? await RP.sendGroup(CHAT.runId, CHAT.members, speakers, text, sendOpts)
: isTrav
? await RP.sendTraverse(CHAT.travId, text, {
  cfg: sendOpts.cfg, history: h, temperature: sendOpts.temperature,
  topP: sendOpts.topP, maxTokens: sendOpts.maxTokens, budget: sendOpts.budget,
  signal: sendOpts.signal, onToken: sendOpts.onToken, onPush: sendOpts.onPush,
  onUserMsg: sendOpts.onUserMsg, onSystem: sendOpts.onSystem})
: await RP.send(CHAT.runId, CHAT.name, text, sendOpts);
saveHist(k, r.history);
if(r.aborted){
const hh = getHist(k);
hh.push({role:"assistant", content:"（已停止生成）", ts:Date.now()});
saveHist(k, hh);
}
}catch(e){
const hh = getHist(k);
hh.push({role:"assistant", speaker: (speakers[0]||null), content:`⚠️ 出错了：${e.message}`, ts:Date.now()});
saveHist(k, hh);
}
STREAM_SPEAKER = null;
setStreaming(false);
renderChat();
};
/* 剧情线编辑器 v27: 原著剧情大纲, 读者可自行编辑 */
window.plotEditor = ()=>{
__backAction = ()=>plotGoBack();
document.body.classList.remove("chatmode");
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
el.innerHTML = SCENARIOS.map(s=>
`<button class="scenchip ${CHAT.scenario===s.id?"on":""}" onclick="toggleScenario('${s.id}')">${s.icon}${s.name}</button>`).join("")
+ (CHAT.scenario ? `<button class="scenchip off" onclick="toggleScenario('')">✕</button>` : "");
}
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
if(!confirm(`清空和${label}的聊天记录？`)) return;
localStorage.removeItem(chatHistKey());
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
+ POVS.map(p=>`<button class="povchip ${pov===p.id?"on":""}" title="${p.desc}" onclick="setPov('${p.id}')">${p.id==="player"?icon("user"):p.icon}${p.name}</button>`).join("")
+ `</div><div class="povlabel">${icon("user",15)} 人称 · AI 怎么称呼你和 TA</div><div class="povrow">`
+ PERSONS.map(p=>`<button class="povchip ${person===p.id?"on":""}" onclick="setPerson('${p.id}')">${p.icon}·${p.name}</button>`).join("")
+ `</div></div>`;
}
window.setPov = (id)=>{ CHAT.pov = id; savePov(); toggleDrawer(false); showChat(); };
window.setPerson = (id)=>{ CHAT.person = id; savePov(); toggleDrawer(false); showChat(); };
/* ============ 记忆事件簿 (对标 Talkie Memory Album + C.AI 记忆 Pin) ============ */
let ALBUM = {runId:null, name:null, back:null};
window.openAlbum = (runId, name, back)=>{
ALBUM = {runId:runId, name:name, back:(typeof back==="function"?back:null)};
renderAlbum();
};
function albumBack(){
if(ALBUM.back) ALBUM.back();
else showChat();
}
function renderAlbum(){
const runId = ALBUM.runId, nm = ALBUM.name;
__backAction = ()=>albumBack();
document.body.classList.remove("chatmode");
const st = RP_MEM.get(runId, nm);
const short = (st && st.short) || [];
const pinned = short.filter(m=>m.pin);
const rest = short.filter(m=>!m.pin);
const h = getHist(`nd_chat_${runId}_${nm}`);
let up = 0, dn = 0;
h.forEach(m=>{ if(m.role==="assistant"){ if(m.rating===1) up++; else if(m.rating===-1) dn++; } });
titleEl.innerHTML = icon("books")+" 记忆事件簿"; subEl.textContent = nm + " · 事件时间线";
const evCard = (m)=>{
const id = m.id;
return `<div class="tl-item${m.pin?" gold":""}"><div class="card alb-event${m.pin?" pinned":""}">`
+ `<div class="alb-time">${esc(m.time||"往事")}${m.pin?' <span class="badge warn">${icon("pin",13)} 置顶</span>':""}</div>`
+ `<div class="alb-fact">${esc(m.fact||"")}</div>`
+ (m.view?`<div class="alb-view">此刻看法：${esc(m.view)}</div>`:"")
+ `<div class="btnrow" style="margin-top:8px">`
+ `<button class="btn ghost" onclick="memPin(${id})">${m.pin?"取消置顶":icon("pin",14)+" 置顶"}</button>`
+ `<button class="btn ghost" onclick="memCopyCard(${id})">📋 复制卡片</button>`
+ `<button class="btn danger" onclick="memDel(${id})">删除</button>`
+ `</div></div></div>`;
};
view.innerHTML = `<button class="back" onclick="albumBack()">${icon("back")} 返回</button>
<div class="alb-stats">${icon("brain",14)} ${short.length} 条记忆 · ${icon("pin",13)} ${pinned.length} 置顶 · ${icon("thumb-up",13)} ${up} ${icon("thumb-down",13)} ${dn}</div>`
+ (st && st.mood && st.mood.state
? `<div class="card alb-mood"><div class="alb-time">当前心境</div><div class="alb-fact">${esc(st.mood.state)}${st.mood.filter?" —— "+esc(st.mood.filter):""}</div></div>` : "")
+ `<h2 class="sec">事件时间线${pinned.length?"（置顶优先）":""}</h2>`
+ `<div class="timeline">` + pinned.concat(rest).map(evCard).join("") + `</div>`
+ (st && st.long ? `<h2 class="sec">长远印象</h2><div class="card"><div class="alb-fact">${esc(st.long)}</div></div>` : "")
+ (!short.length && !(st && st.long) ? `<div class="empty"><span class="big">${icon("brain",44)}</span>还没有记忆<br><span style="font-size:12px">每 ${(getRpCfg().memCycle||10)} 条消息自动整理一次</span><br><button class="btn ghost" style="margin-top:10px" onclick="albumBack()">去聊天产生记忆</button></div>` : "")
+ `<div class="btnrow" style="margin-top:12px"><button class="btn" onclick="memoryNovel()">${icon("book-open")} 转成小说</button></div>
<div style="height:40px"></div>`;
window.scrollTo(0,0);
}
window.memPin = (id)=>{
RP_MEM.togglePin(ALBUM.runId, ALBUM.name, id);
renderAlbum();
};
window.memDel = (id)=>{
if(!confirm("删除这条记忆？")) return;
RP_MEM.delItem(ALBUM.runId, ALBUM.name, id);
renderAlbum();
};
window.memCopyCard = (id)=>{
const st = RP_MEM.get(ALBUM.runId, ALBUM.name);
const m = ((st && st.short)||[]).find(x=>x.id==id);
if(!m) return;
copyText(`📌 记忆快照 · ${ALBUM.name}\n时间：${m.time||"往事"}\n事实：${m.fact||""}${m.view?"\n此刻看法："+m.view:""}`);
alert("记忆卡片已复制");
};
/* ============ 记忆转小说 (对标猫箱记忆转小说: 记忆事件 → 小说体阅读) ============ */
window.memoryNovel = ()=>{
const runId = ALBUM.runId, nm = ALBUM.name;
__backAction = ()=>renderAlbum();
document.body.classList.remove("chatmode");
const st = RP_MEM.get(runId, nm);
titleEl.innerHTML = icon("book-open")+" 记忆小说"; subEl.textContent = nm + " · 由记忆整理成篇";
const cnNum = ["一","二","三","四","五","六","七","八","九","十"];
const cn = (i)=> i < 10 ? cnNum[i] : String(i+1);
let body = "";
const short = (st && st.short) || [];
if(short.length){
body = short.map((m,i)=>
`<div class="nov-ch"><div class="nov-chh">第${cn(i)}章 · ${esc(m.time||"往事")}</div>`
+ `<div class="nov-p">${esc(m.fact||"")}</div>`
+ (m.view?`<div class="nov-p nov-view">—— ${esc(m.view)}</div>`:"")
+ `</div>`).join("");
} else {
// 无记忆时退化为聊天记录对话体
const h = getHist(`nd_chat_${runId}_${nm}`).slice(-30);
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
<div style="height:40px"></div>`;
window.scrollTo(0,0);
};
window.exportNovel = ()=>{
const el = document.querySelector(".novel");
if(!el) return;
copyText(el.innerText);
alert("全文已复制");
};
/* ============ 平行存档 (对标 Xclaw: 多时间线快照, 随时存档/加载/删除) ============ */
function savesKey(){ return "nd_saves_" + chatHistKey(); }
function getSaves(){
try{ const s = JSON.parse(localStorage.getItem(savesKey())||"[]"); return Array.isArray(s)?s:[]; }
catch(e){ return []; }
}
window.openSaves = ()=>{ renderSaves(); };
function renderSaves(){
__backAction = ()=>showChat();
document.body.classList.remove("chatmode");
const label = CHAT.mode==="group" ? ("群聊·"+CHAT.members.length+"人") : CHAT.name;
titleEl.innerHTML = icon("save")+" 平行存档"; subEl.textContent = label + " · 多时间线快照";
const ss = getSaves().slice().sort((a,b)=>b.ts-a.ts);
const fmtT = (ts)=> new Date(ts).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回</button>
<div class="btnrow" style="margin-bottom:10px"><button class="btn" onclick="newSaveSlot()">＋ 新建存档</button></div>`
+ (ss.length ? `<div class="timeline">` + ss.map(s=>{
const n = (s.history||[]).length;
const last = (s.history||[]).filter(m=>m.role==="assistant").slice(-1)[0];
const prev = last ? esc(String(last.content||"").slice(0,60)) : "（空）";
return `<div class="tl-item"><div class="card save-card"><div class="save-name">${esc(s.name||"未命名存档")}</div>`
+ `<div class="meta">${fmtT(s.ts)} · ${n} 条消息</div>`
+ `<div class="save-prev">${prev}</div>`
+ `<div class="btnrow" style="margin-top:8px">`
+ `<button class="btn" onclick="loadSaveSlot(${s.id})">${icon("download")} 加载</button>`
+ `<button class="btn ghost" onclick="renameSaveSlot(${s.id})">改名</button>`
+ `<button class="btn danger" onclick="delSaveSlot(${s.id})">删除</button>`
+ `</div></div></div>`;
}).join("") + `</div>` : `<div class="empty"><span class="big">${icon("save",44)}</span>还没有存档<br><span style="font-size:12px">在关键剧情点存个档，就能随时回到这条时间线，或从这里分出新的平行剧情</span></div>`)
+ `<div style="height:40px"></div>`;
window.scrollTo(0,0);
}
window.newSaveSlot = ()=>{
const def = new Date().toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
const name = prompt("存档名称", "存档 " + def);
if(name === null) return;
const k = chatHistKey();
const ss = getSaves();
ss.push({id: Date.now(), name: (name||"").trim() || ("存档"+(ss.length+1)), ts: Date.now(),
history: getHist(k),
mem: CHAT.mode==="single" ? RP_MEM.get(CHAT.runId, CHAT.name) : null,
plot: getPlot()});
try{ localStorage.setItem(savesKey(), JSON.stringify(ss)); }
catch(e){ alert("存档失败：存储空间不足，试试删除旧存档"); return; }
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
showChat();
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
renderSaves();
};
/* ============ Persona: 全局用户人设 + 按聊天覆盖 ============ */
window.personaEditor = (scope, from)=>{
const isOverride = !!scope;
const p = (isOverride ? RP_PERSONA.getOverride(scope) : RP_PERSONA.getGlobal()) || {name:"", desc:"", extra:""};
__backAction = ()=>{ from==="settings" ? showSettings() : showChat(); };
document.body.classList.remove("chatmode");
titleEl.innerHTML = icon("user")+" 我的人设";
subEl.textContent = isOverride ? "仅本次聊天生效（覆盖全局人设）" : "全局生效：以后所有聊天都会告诉 AI 你是谁";
view.innerHTML = `<button class="back" onclick="__backAction()">${icon("back")} 返回</button>
<div class="field"><label>称呼 / 名字</label>
<input id="p_name" placeholder="希望 AI 怎么称呼你" value="${esc(p.name||"")}" oninput="tokCount(['p_name','p_desc','p_extra'],'p_tok')"></div>
<div class="field"><label>自我描述</label>
<textarea id="p_desc" rows="4" placeholder="年龄、职业、性格、说话习惯……" oninput="tokCount(['p_name','p_desc','p_extra'],'p_tok')">${esc(p.desc||"")}</textarea></div>
<div class="field"><label>补充说明（可选）</label>
<textarea id="p_extra" rows="3" placeholder="希望 AI 记住的偏好、你们的关系设定……" oninput="tokCount(['p_name','p_desc','p_extra'],'p_tok')">${esc(p.extra||"")}</textarea></div>
<div class="tokline" id="p_tok"></div>
<div class="btnrow"><button class="btn" onclick="savePersonaUI(${isOverride?`'${scope}'`:"null"},'${from}')">保存</button>
${isOverride && RP_PERSONA.getOverride(scope) ? `<button class="btn ghost" onclick="RP_PERSONA.saveOverride('${scope}',null);__backAction()">清除本次覆盖</button>` : ""}
</div>
<div class="hint">保存后，人设会以【玩家人设】段注入每轮 prompt，紧跟在角色身份说明之后。</div>
<div style="height:40px"></div>`;
tokCount(['p_name','p_desc','p_extra'],'p_tok');
window.scrollTo(0,0);
};
window.savePersonaUI = (scope, from)=>{
const p = {name: document.getElementById("p_name").value.trim(),
           desc: document.getElementById("p_desc").value.trim(),
           extra: document.getElementById("p_extra").value.trim()};
if(scope) RP_PERSONA.saveOverride(scope, p); else RP_PERSONA.saveGlobal(p);
__backAction();
};
/* ============ 角色卡 PNG 导出 + 分享 ============ */
window.exportCard = async (id)=>{
const c = RP_WRITER.findCustom(id);
if(!c) return;
try{
const r = await RP_CARDEXPORT.exportAndShare(c);
if(r.shared){ alert("已调起系统分享"); return; }
__backAction = ()=>showWriter();
document.body.classList.remove("chatmode");
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
const q = nm.replace(/'/g,"\\'");
__backAction = ()=>detailBack();
document.body.classList.remove("chatmode");
const card = RP.findCard(runId, nm) || {name:nm, fields:{}};
const run = (window.__DATA__.runs||{})[runId] || {};
titleEl.innerHTML = icon("user")+" "+esc(nm); subEl.textContent = run.novel || "";
const tabs = [["info","资料"],["memory","记忆"],["chat","最近聊天"]];
let body = "";
if(DETAIL.tab === "info"){
const groups = [["identity","身份"],["core","内核"],["speech","说话方式"],["background","背景"]];
body = groups.map(g=>{
const txt = RP_PROMPT.renderFields(card, RP_PROMPT.LAYERS[g[0]]);
return txt ? `<h2 class="sec">${g[1]}</h2><div class="card">`
+ txt.split("\n").map(l=>`<div class="kvline">${esc(l)}</div>`).join("") + `</div>` : "";
}).join("") || `<div class="empty">暂无资料</div>`;
} else if(DETAIL.tab === "memory"){
const st = RP_MEM.get(runId, nm);
const n = (st && st.short && st.short.length) || 0;
body = `<div class="card"><div class="name" style="font-size:14px">${st&&st.mood&&st.mood.state?esc(st.mood.state):"还没有心境记录"}</div>`
+ `<div class="meta">${n} 条近期记忆${st&&st.long?" · 有长远印象":""}</div>`
+ `<div class="btnrow" style="margin-top:8px"><button class="btn" onclick="detailOpenAlbum()">${icon("books")} 打开记忆事件簿</button></div></div>`;
} else {
const h = getHist(`nd_chat_${runId}_${nm}`).slice(-10);
body = (h.map(m=>{
const who = m.role==="user" ? "我" : nm;
return `<div class="card"><div class="kv">${esc(who)}</div><div style="font-size:13px">${esc(m.content.slice(0,120))}${m.content.length>120?"…":""}</div></div>`;
}).join("") || `<div class="empty">还没有聊天记录</div>`)
+ `<div class="btnrow" style="margin-top:12px"><button class="btn" onclick="chatWith('${runId}','${q}')">${icon("chat")} 和${esc(nm)}开聊</button><button class="btn ghost" onclick="soulAnchors('${runId}','${q}')">${icon("user")} 魂穿成${esc(nm)}</button></div>`;
}
view.innerHTML = `<button class="back" onclick="detailBack()">${icon("back")} 返回</button>
<div class="dtabs">` + tabs.map(t=>`<button class="dtab${DETAIL.tab===t[0]?" on":""}" onclick="charTab('${t[0]}')">${t[1]}</button>`).join("") + `</div>
${body}<div style="height:40px"></div>`;
window.scrollTo(0,0);
}
window.showSystem = ()=>{
if(!LAST_SYSTEM){ alert("先发一句话，引擎组装好人设 prompt 后这里才能预览。"); return; }
__backAction = ()=>showChat();
titleEl.textContent = "人设 prompt 预览"; subEl.textContent = CHAT.name||"";
view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回聊天</button>
<pre style="white-space:pre-wrap;font-size:13px;background:#fff;border:1px solid #e5e0d8;border-radius:10px;padding:12px">${esc(LAST_SYSTEM)}</pre>`;
window.scrollTo(0,0);
};

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
return (b/1024/1024).toFixed(2) + " MB";
};
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
groups.push(other);
return {total: total, quota: 5*1024*1024, groups: groups.filter(g=>g.keys > 0)};
};
window.renderStorageCard = ()=>{
const su = storageUsage();
const pct = Math.min(100, su.total / su.quota * 100);
const warn = su.total / su.quota >= 0.8;
return `<div class="setcard"><h3>本地存储用量</h3>
<div class="storbar"><div class="storbar-fg${warn?" warn":""}" style="width:${pct.toFixed(1)}%"></div></div>
<div class="stornum${warn?" warn":""}">${fmtBytes(su.total)} / 5 MB（${pct.toFixed(0)}%）${warn?" · 空间告急，建议清理":""}</div>
${su.groups.map(g=>`<div class="storow"><span>${g.label}</span><span>${g.keys} 项 · ${fmtBytes(g.bytes)}</span></div>`).join("")}
<div class="btnrow"><button class="btn ghost" onclick="if(confirm('清空所有单聊/群聊/穿越聊天记录？'))clearChat()">清空聊天记录</button>
<button class="btn danger" onclick="wipeAll()">清空全部数据</button></div>
</div>`;
};
function showSettings(){
__backAction = null;
titleEl.textContent = "设置";
subEl.textContent = "";
const c = getCfg();
view.innerHTML = renderStorageCard() + `
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
<select id="c_model_sel" onchange="document.getElementById('c_model').value=this.value"></select>
<input id="c_model" placeholder="或手动输入模型名" value="${esc(c.model||"")}">
</div></div>
<div class="field"><label>生图模型（可空，如 dall-e-3）</label>
<input id="c_img" placeholder="不填则不启用生图" value="${esc(c.imgModel||"")}"></div>
<div class="field"><label>TTS 模型（可空，如 tts-1）</label>
<input id="c_tts" placeholder="不填则不启用朗读" value="${esc(c.ttsModel||"")}"></div>
<div class="field"><label>TTS 音色</label>
<input id="c_voice" placeholder="alloy" value="${esc(c.ttsVoice||"")}"></div>
<div class="btnrow"><button class="btn" onclick="saveCfgUI()">保存</button></div>
</div>
<div class="setcard"><h3>RP 引擎</h3>
<div class="field"><label>${icon("user",15)} 我的人设（全局）</label>
<div class="btnrow"><button class="btn ghost" onclick="personaEditor(null,'settings')">编辑全局人设</button></div>
<div class="hint" id="persona_sum"></div></div>
<div class="field"><label>Prompt 预设（人设分段组装顺序）</label>
<select id="r_preset">${Object.keys(RP_PROMPT.PRESETS).map(k=>
`<option value="${k}" ${getRpCfg().preset===k?"selected":""}>${RP_PROMPT.PRESETS[k].name} - ${RP_PROMPT.PRESETS[k].desc}</option>`).join("")}</select></div>
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
<div class="field"><label>记忆整理周期（每 N 条消息跑一次三层记忆分析）</label>
<input id="r_memcycle" type="number" min="5" value=""></div>
<div class="btnrow"><button class="btn" onclick="saveRpCfgUI()">保存 RP 设置</button><button class="btn ghost" onclick="importStPreset()">${icon("download")} 导入 ST 预设(采样参数)</button></div>
<div class="hint">每 N 条消息，引擎自动整理一次三层记忆：当前心境 + 30 条近期记忆 + 长远印象（1 次模型调用），存在本机。</div>
<div class="hint">Key 只保存在本机, 聊天时由手机直接请求你填的接口, 不经过任何中转。
免费/便宜的兼容接口 (如硅基流动、DeepSeek) 都可以直接填。</div>

<h2 class="sec">数据</h2>
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
document.getElementById("r_optcards").checked = !!rc.optCards;
document.getElementById("r_optcount").value = rc.optCount||4;
document.getElementById("r_optmood").value = rc.optMood||"none";
document.getElementById("r_ooc").checked = !!rc.ooc;
document.getElementById("r_memcycle").value = rc.memCycle||10;
(function(){ const gp = RP_PERSONA.getGlobal();
const el = document.getElementById("persona_sum");
if(el) el.textContent = gp ? ("当前：" + (gp.name||"") + " " + String(gp.desc||"").slice(0,40)) : "未设置（建议填一下，AI 聊天时会知道你是谁）"; })();
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
window.fetchModels = async (silent)=>{
const cfg = _cfgFromUI();
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
+ `<span style="color:var(--ink-faint);font-size:12px">检查地址/Key/模型名，或手机网络/代理。</span>`;
}
};
window.saveRpCfgUI = ()=>{
saveRpCfg({maxContext:Math.max(2048,parseInt($("#r_ctx").value)||8192),
respTokens:Math.max(128,parseInt($("#r_resp").value)||512),
summaryModel:$("#r_summ").value.trim(),
temperature:Math.max(0,Math.min(1.5,parseFloat($("#r_temp").value)||0.9)),
topP:Math.max(0,Math.min(1,parseFloat($("#r_topp").value)||1)),
optCards:$("#r_optcards").checked,
optCount:Math.min(6,Math.max(2,parseInt($("#r_optcount").value)||4)),
optMood:$("#r_optmood").value||"none",
ooc:$("#r_ooc").checked, preset:$("#r_preset").value,
memCycle:Math.max(5,parseInt($("#r_memcycle").value)||10)});
alert("RP 设置已保存");
};
/* SillyTavern 文本预设 -> 本机 RP 采样设置: 只取采样参数, prompt 组件不导入 */
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
Object.keys(localStorage).filter(k=>k.startsWith("nd_")).forEach(k=>localStorage.removeItem(k));
alert("已清空"); showSettings();
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
const q = s=>String(s).replace(/'/g,"\\'");
const defs = RP_TASKS.getDefs(CHAT.runId, nm);
titleEl.textContent = "分析任务 · " + nm;
subEl.textContent = "";
document.body.classList.remove("chatmode");
view.innerHTML = `
<div class="hint">周期分析任务: 按消息条数或关键词自动触发, 把分析结果注入对话 (常驻/按需) 或仅存档。内置三层记忆不在此列, 每次触发约 1 次模型调用。</div>
${defs.map(d=>{const t=RP_TASKS.normDef(d); const st=RP_TASKS.getState(CHAT.runId,nm,t.id);
return `<div class="card"><div class="row"><div><div class="name">${esc(t.name)}</div>
<div class="kv">${esc(RP_TASKS.describe(t))}</div>
<div class="kv">${st?("上次运行: "+new Date(st.updatedAt).toLocaleString()+(st.reason?" · "+st.reason:"")):"尚未运行"}</div></div></div>
<div class="btnrow"><button class="btn ghost" onclick="viewAOut('${q(nm)}','${t.id}')">查看输出</button>
<button class="btn ghost" onclick="runATaskNow('${q(nm)}','${t.id}')">立即运行</button>
<button class="btn ghost" onclick="editATask('${q(nm)}','${t.id}')">编辑</button>
<button class="btn danger ghost" onclick="delATask('${q(nm)}','${t.id}')">删除</button></div></div>`;}).join("") || `<div class="empty">还没有分析任务, 点下面新建一个。</div>`}
<div class="btnrow"><button class="btn" onclick="editATask('${q(nm)}','')">${icon("plus")} 新建任务</button>
<button class="btn ghost" onclick="showChat()">返回聊天</button></div>`;
};
window.editATask = (name, id)=>{
__backAction = ()=>showATasks(name);
const q = s=>String(s).replace(/'/g,"\\'");
const defs = RP_TASKS.getDefs(CHAT.runId, name);
const t = RP_TASKS.normDef(id ? (defs.find(d=>d.id===id)||{}) : {id: RP_TASKS.nextId(defs)});
titleEl.textContent = (id?"编辑任务 · ":"新建任务 · ") + name;
subEl.textContent = "";
document.body.classList.remove("chatmode");
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
<div class="btnrow"><button class="btn" onclick="saveATask('${q(name)}','${t.id}')">保存</button>
<button class="btn ghost" onclick="showATasks('${q(name)}')">返回</button></div>
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
const q = s=>String(s).replace(/'/g,"\\'");
const defs = RP_TASKS.getDefs(CHAT.runId, name);
const t = defs.find(d=>d.id===id)||{};
const st = RP_TASKS.getState(CHAT.runId, name, id);
titleEl.textContent = "任务输出 · " + (t.name||"");
subEl.textContent = "";
document.body.classList.remove("chatmode");
view.innerHTML = `<div class="setcard">
<div class="kv">${st?("更新于 "+new Date(st.updatedAt).toLocaleString()+(st.reason?" · 触发: "+st.reason:"")):"尚未运行"}</div>
<pre style="white-space:pre-wrap;font-size:13px">${esc((st&&st.output)||"(空)")}</pre>
<div class="btnrow"><button class="btn ghost" onclick="showATasks('${q(name)}')">返回</button></div></div>`;
};
window.runATaskNow = async (name, id)=>{
const cfg = getCfg();
if(!cfg.key){ alert("先去设置里配 API"); return; }
if(!confirm("用最近的聊天记录跑一次这个任务? (约 1 次模型调用)")) return;
const h = getHist(chatHistKey());
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
document.body.classList.remove("chatmode");
const ss = RP_WRITER.listSessions();
const cs = RP_WRITER.getCustomChars();
const q = x=>String(x).replace(/'/g,"\\'");
view.innerHTML = `
${ss.length?`<h2 class="sec">未完成的写卡 (${ss.length})</h2>`+ss.map(x=>`
<div class="card"><div class="row"><div><div class="name">${esc(RP_WRITER.STEPS[x.step].name)} · 进行中</div>
<div class="kv">${new Date(x.updatedAt).toLocaleString()} · ${x.history.length} 轮对话</div></div></div>
<div class="btnrow"><button class="btn" onclick="writerChat('${x.id}')">继续</button>
<button class="btn danger ghost" onclick="if(confirm('放弃这次写卡?')){RP_WRITER.delSession('${x.id}');showWriter();}">放弃</button></div></div>`).join(""):""}
<h2 class="sec">我的角色卡 (${cs.length})</h2>
${cs.length?`<div class="chargrid">`+cs.map(c=>charCardHTML({
name:c.name, tag:c.novel, sum:String((c.fields&&c.fields.core_identity)||"").slice(0,46)||"自创角色 · 点我直接开聊",
oncard:`chatWith('custom','${q(c.name)}')`,
ops:`<button class="go" onclick="event.stopPropagation();chatWith('custom','${q(c.name)}')">开聊</button>`
+`<button onclick="event.stopPropagation();exportCard('${c.id}')">导出</button>`
+`<button class="danger" onclick="event.stopPropagation();if(confirm('删除这张角色卡?')){RP_WRITER.delCustom('${c.id}');showWriter();}">删</button>`
})).join("")+`</div>`:`<div class="empty"><span class="big">🎭</span>还没有自创角色<br><span style="font-size:12px">点下面「新建写卡」，和 Ruby 一起创作</span></div>`}
<div class="btnrow"><button class="btn" onclick="newWriter()">${icon("plus")} 新建写卡</button></div>
<div class="hint">写卡全程走你在设置里配的大模型接口, 每步约 1-3 次调用。写完的角色可直接开聊, 也能配分析任务。</div>`;
};
window.newWriter = ()=>{
__backAction = ()=>showWriter();
const runs = (window.__DATA__.index||[]).map(r=>`<option value="${r.run_id}">${esc(r.novel)}</option>`).join("");
titleEl.textContent = "新建写卡";
subEl.textContent = "";
document.body.classList.remove("chatmode");
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
document.body.classList.remove("chatmode");
const log = s.history.map(m=>`<div class="msg ${m.role==="user"?"me":"ai"}"><div class="bub">${esc(m.content).replace(/\n/g,"<br>")}</div></div>`).join("");
view.innerHTML = `
<div class="hint">第 ${s.step+1}/5 步 · ${esc(st.name)}: ${esc(st.desc)}</div>
<div id="wlog">${log || `<div class="empty">Ruby 正在组织语言…</div>`}</div>
<div class="chatbar"><input id="w_in" placeholder="和 Ruby 聊聊…" onkeydown="if(event.key==='Enter')sendWriterMsg('${id}')" oninput="tokCount('w_in','w_tok')">
<button onclick="sendWriterMsg('${id}')">发送</button></div>
<div class="tokline" id="w_tok" style="padding:0 14px"></div>
<div class="btnrow" style="margin-top:8px">
${s.step<3?`<button class="btn" onclick="finalizeStep('${id}')">✅ 定稿, 进入下一步</button>`:""}
${s.step===3?`<button class="btn" onclick="genCardUI('${id}')">🎴 生成人设卡</button>`:""}
${s.step===4?`<button class="btn" onclick="finishWriterUI('${id}')">${icon("save")} 保存角色卡</button>`:""}
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
boot();
if(!localStorage.getItem("nd_onboarded")) showOnboard(1);

/* ================= 穿越 P0: 魂穿 / 肉身穿越 ================= */
function travPlayerName(){
  if(CHAT.mode === "traverse"){
    const trav = RP_TRAVERSE.get(CHAT.travId);
    if(trav){
      if(trav.mode === "soul") return trav.charName;
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
  document.body.classList.remove("chatmode");
  titleEl.innerHTML = icon("book-open")+" 穿越"; subEl.textContent = "进入书里活";
  const modes = [
    {id:"soul", ic:"user", name:"魂穿", desc:"成为TA：扮演原著角色，走进TA的人生", ok:true},
    {id:"body", ic:"users", name:"肉身穿越", desc:"成为自己：现代人直穿，或捏一个古代身份", ok:true},
    {id:"isekai", ic:"repeat", name:"异世界穿越", desc:"把角色送进另一部作品（林黛玉去水浒）", ok:false, badge:"P2"},
    {id:"party", ic:"chat", name:"组团穿越", desc:"和多名角色组队一起穿", ok:false, badge:"P3"},
  ];
  const recents = RP_TRAVERSE.recent();
  view.innerHTML = `
  <div class="travmodes">${modes.map(m=>`
    <div class="travmode${m.ok?"":" locked"}" ${m.ok?`onclick="travMode('${m.id}')"`:""}>
      <div class="tm-icon">${icon(m.ic,26)}</div>
      <div class="tm-body"><div class="tm-name">${m.name}${m.badge?` <span class="badge warn">${m.badge}</span>`:""}</div>
      <div class="tm-desc">${m.desc}</div></div>
      ${m.ok?`<div class="tm-go">›</div>`:`<div class="tm-desc">即将到来</div>`}
    </div>`).join("")}</div>
  <h2 class="sec">酒馆角色卡</h2>
  <div class="card"><div class="kv">把 SillyTavern 角色卡（PNG/JSON）导进来，也能穿进 TA 的世界</div>
  <div class="btnrow" style="margin-top:8px"><button class="btn" onclick="travImport()">${icon("upload")} 导入角色卡</button></div>
  <div id="impList" style="margin-top:8px">${importedListHTML()}</div></div>
  <h2 class="sec">最近穿越</h2>
  <div>${recents.length ? recents.map(travRecentHTML).join("") : `<div class="empty">还没有穿越过，从上面选一种模式开始吧</div>`}</div>
  <input type="file" id="travFile" accept=".png,.json" style="display:none" onchange="travImportFile(this)">`;
  window.scrollTo(0,0);
}
function importedListHTML(){
  let list = [];
  try{ list = RP_CARDIMPORT.list(); }catch(e){}
  if(!list.length) return `<div class="meta">还没有导入过角色卡</div>`;
  return list.map(c=>`<div class="kvline" style="display:flex;align-items:center;gap:8px"><span>${esc(c.name)}</span>
  <span class="meta"> ${esc(c.novel)}</span><span style="flex:1"></span>
  <button class="btn ghost sm" onclick="event.stopPropagation();travDelImport('${c.id}')">删除</button></div>`).join("");
}
function travRecentHTML(t){
  const who = t.mode==="soul" ? t.charName : ((RP_TRAVERSE.getIdentity(t.identityId)||{}).name || "无名氏");
  const d = new Date(t.updatedAt).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
  return `<div class="card" onclick="travResume('${t.id}')">
  <div class="row"><div class="avatar">${esc(who[0]||"穿")}</div>
  <div><div class="name">${esc(who)} <span class="badge">${RP_TRAVERSE.MODES[t.mode]||""}</span></div>
  <div class="meta">${esc(t.worldName)} · ${esc(t.anchorTitle||"")} · ${d}</div></div></div></div>`;
}
window.travMode = (m)=>{
  if(m==="soul") soulPickTarget();
  else if(m==="body") bodyPickWorld();
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
    alert(`已导入「${card.name}」：魂穿目标和卡片世界里都能选到`);
    showTraverse();
  }catch(e){ alert("导入失败："+e.message); }
};
window.travDelImport = (id)=>{
  if(!confirm("删除这张导入的角色卡？")) return;
  RP_CARDIMPORT.del(id); showTraverse();
};

/* ---- 魂穿：选目标 -> 选锚点 -> 开局 ---- */
function soulPickTarget(){
  __backAction = ()=>showTraverse();
  document.body.classList.remove("chatmode");
  titleEl.innerHTML = icon("user")+" 魂穿"; subEl.textContent = "选择你要成为的角色";
  const cs = allChars();
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  <div class="chargrid">${cs.map(c=>`
    <div class="charcard" onclick="soulAnchors(${JSON.stringify(c.runId)},${JSON.stringify(c.name)})">
      <div class="avatar ${charCoverCls(c.name)}">${esc(c.name[0])}</div>
      <div class="ccname">${esc(c.name)}</div><div class="ccnovel">${esc(c.novel)}</div>
    </div>`).join("")}</div><div style="height:40px"></div>`;
  window.scrollTo(0,0);
}
function soulOutlineFor(runId, name){
  try{
    const p = JSON.parse(localStorage.getItem(`nd_plot_${runId}_${name}`));
    if(p && p.updatedAt && p.outline) return p.outline;
  }catch(e){}
  return (window.CHAR_PLOTS||{})[name] || "";
}
window.soulAnchors = (runId, name)=>{
  __backAction = ()=>soulPickTarget();
  document.body.classList.remove("chatmode");
  titleEl.innerHTML = icon("user")+" 魂穿 · "+esc(name); subEl.textContent = "选择进入的剧情锚点";
  const anchors = RP_TRAVERSE.anchorsFor(soulOutlineFor(runId, name));
  view.innerHTML = `<button class="back" onclick="soulPickTarget()">${icon("back")} 返回</button>
  <h2 class="sec">你想从哪里开始成为${esc(name)}？</h2>
  <div class="card">${anchors.map((a,i)=>`
    <label class="kvline" style="display:block"><input type="radio" name="anchor" value="${i}"${i===0?" checked":""}> ${esc(a.title)}</label>`).join("")}
    <label class="kvline" style="display:block"><input type="radio" name="anchor" value="custom"> 自定：<input id="anchorCustom" style="width:60%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:6px" placeholder="比如：黛玉初进贾府那天"></label>
  </div>
  <div class="card"><label class="kvline" style="display:block"><input type="checkbox" id="oocRemind" checked> OOC 提醒：我说的话不符合身份/时代时，世界轻轻点我一下</label></div>
  <div class="btnrow"><button class="btn" style="flex:1" onclick="soulStart(${JSON.stringify(runId)},${JSON.stringify(name)})">开始穿越</button></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
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
  });
  travBegin(sess);
};
/* ---- 肉身穿越：选世界 -> 捏身份 -> 开局 ---- */
function bodyPickWorld(){
  __backAction = ()=>showTraverse();
  document.body.classList.remove("chatmode");
  titleEl.innerHTML = icon("users")+" 肉身穿越"; subEl.textContent = "选择你要进入的世界";
  const ws = travWorlds();
  view.innerHTML = `<button class="back" onclick="showTraverse()">${icon("back")} 返回</button>
  ${ws.length ? ws.map(w=>`
    <div class="card" onclick="bodyIdentity(${JSON.stringify(w.kind)},${JSON.stringify(w.id)})">
      <div class="name">${esc(w.name)}</div><div class="meta">${esc(w.sub)}</div>
    </div>`).join("") : `<div class="empty">还没有可用世界：先导入角色卡，或等蒸馏任务产出</div>`}
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
}
window.bodyIdentity = (kind, id)=>{
  __backAction = ()=>bodyPickWorld();
  document.body.classList.remove("chatmode");
  const wname = RP_TRAVERSE.worldDisplayName(kind, id);
  titleEl.innerHTML = icon("users")+" 肉身穿越"; subEl.textContent = wname+" · 捏造你的身份";
  view.innerHTML = `<button class="back" onclick="bodyPickWorld()">${icon("back")} 返回</button>
  <div class="card"><div class="kv">一句话愿望，AI 帮你捏身份</div>
  <div class="row" style="margin-top:8px"><input id="idWish" style="flex:1;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" placeholder="比如：我想当个落魄书生混进贾府">
  <button class="btn" style="white-space:nowrap" onclick="bodyAiGen(${JSON.stringify(kind)},${JSON.stringify(id)})">AI 生成</button></div></div>
  <div class="card"><label class="kvline" style="display:block"><input type="checkbox" id="idModern"> 现代人直穿：不捏古代身份，以现在的自己进去</label></div>
  <h2 class="sec">身份卡</h2>
  <div class="card">
  ${[["idName","姓名"],["idGender","性别"],["idAge","年龄"],["idOrigin","出身"],["idTraits","性格"],["idTalent","特长"]].map(f=>`
    <div class="field"><label>${f[1]}</label><input id="${f[0]}" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px"></div>`).join("")}
  <div class="field"><label>当前处境（开场时身在何处、在做什么）</label>
  <textarea id="idSituation" style="width:100%;min-height:60px;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px"></textarea></div>
  </div>
  <div class="btnrow"><button class="btn" style="flex:1" onclick="bodyStart(${JSON.stringify(kind)},${JSON.stringify(id)})">开始穿越</button></div>
  <div style="height:40px"></div>`;
  window.scrollTo(0,0);
};
window.bodyAiGen = async (kind, id)=>{
  const wish = ($("#idWish").value||"").trim();
  if(!wish){ alert("先写一句愿望，比如：我想当个落魄书生"); return; }
  const cfg = getCfg();
  if(!cfg.key||!cfg.base||!cfg.model){ alert("先去「设置」配好 API 地址/Key/模型"); return; }
  try{
    const idt = await RP_TRAVERSE.genIdentity(wish, RP_TRAVERSE.worldDisplayName(kind,id),
      cfg, (c,m,t)=>RP_NET.complete(c,m,t));
    $("#idName").value = idt.name||""; $("#idGender").value = idt.gender||"";
    $("#idAge").value = idt.age||""; $("#idOrigin").value = idt.origin||"";
    $("#idTraits").value = idt.traits||""; $("#idTalent").value = idt.talent||"";
    $("#idSituation").value = idt.situation||"";
  }catch(e){ alert("生成失败："+e.message); }
};
window.bodyStart = (kind, id)=>{
  const modern = $("#idModern").checked;
  const name = ($("#idName").value||"").trim();
  if(!modern && !name){ alert("给身份起个名字，或勾选现代人直穿"); return; }
  let finalName = name;
  if(modern && !finalName){
    try{ finalName = (RP_PERSONA.resolve("trav").name)||"我"; }catch(e){ finalName = "我"; }
  }
  const idt = RP_TRAVERSE.saveIdentity({
    name: finalName||"无名氏", gender:$("#idGender").value.trim(), age:$("#idAge").value.trim(),
    origin: modern ? "现代" : $("#idOrigin").value.trim(),
    traits:$("#idTraits").value.trim(), talent:$("#idTalent").value.trim(),
    situation:$("#idSituation").value.trim(), modern,
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
  setNav("chat");
}
async function showTraverseChat(cfg){
  __backAction = ()=>exitChat();
  document.body.classList.add("chatmode");
  const trav = RP_TRAVERSE.get(CHAT.travId);
  if(!trav){ setNav("traverse"); return; }
  const modeName = RP_TRAVERSE.MODES[trav.mode]||"穿越";
  const title = travPlayerName();
  view.innerHTML = `
  <div class="chathead" id="chathead">
  <button class="backbtn" onclick="exitChat()">‹</button>
  <div class="avatar">${esc((title||"穿")[0])}</div>
  <div class="chead-main"><div class="cname">${esc(title)} <span class="badge">${modeName}</span></div>
  <div class="cstat"><span>${esc(trav.worldName)}</span></div></div>
  <button class="menubtn" onclick="toggleDrawer(true)" title="菜单">${icon("menu")}</button>
  </div>
  <div class="chatwrap">
  <div id="ctxbar"></div>
  <div id="wsbar" class="wsbar" onclick="travWsEditor()"></div>
  <div id="chatlog"></div>
  <div class="chatbar">${chatbarInner(false)}</div>
  </div>
  <div class="scrim" id="scrim" onclick="toggleDrawer(false)"></div>
  <div class="drawer" id="drawer">
  <h3>穿越</h3>
  <button class="ditem" onclick="toggleDrawer(false);travWsEditor()">${icon("scroll")} 世界状态</button>
  <button class="ditem" onclick="toggleDrawer(false);travIdentityView()">${icon("user")} 我的身份</button>
  <button class="ditem" onclick="toggleDrawer(false);showSystem()">${icon("settings")} prompt 预览</button>
  <button class="ditem" onclick="toggleDrawer(false);exportChat()">${icon("download")} 复制聊天记录</button>
  <button class="ditem danger" onclick="toggleDrawer(false);travEnd()">${icon("x")} 结束穿越</button>
  </div>`;
  renderChat(); renderWsBar(); attachHeadHide();
  const k = chatHistKey();
  if(!getHist(k).length){
    try{
      const opening = await RP_TRAVERSE.genOpening(trav, cfg, (c,m,t)=>RP_NET.complete(c,m,t));
      const parsed = RP_TRAVERSE.parseWsBlock(opening);
      if(parsed.patch) RP_TRAVERSE.saveState(trav.id,
        RP_TRAVERSE.mergeState(RP_TRAVERSE.getState(trav.id), parsed.patch));
      saveHist(k, [{role:"assistant", content: parsed.clean || opening, ts:Date.now()}]);
    }catch(e){
      saveHist(k, [{role:"assistant", content: RP_TRAVERSE.offlineOpening(trav), ts:Date.now()}]);
    }
    renderChat(); renderWsBar();
  }
}
function renderWsBar(){
  const bar = $("#wsbar"); if(!bar || CHAT.mode!=="traverse") return;
  const st = RP_TRAVERSE.getState(CHAT.travId);
  bar.innerHTML = `${icon("scroll",13)} ${esc(RP_TRAVERSE.stateLine(st))}`+
    (st.items.length?` · 物品${st.items.length}`:"")+
    `<span style="float:right;opacity:.6">查看 ›</span>`;
}
window.travWsEditor = ()=>{
  const trav = RP_TRAVERSE.get(CHAT.travId); if(!trav) return;
  __backAction = ()=>showChat();
  document.body.classList.remove("chatmode");
  const st = RP_TRAVERSE.getState(trav.id);
  titleEl.innerHTML = icon("scroll")+" 世界状态"; subEl.textContent = trav.worldName;
  const favRows = Object.keys(st.favor||{}).map(k=>
    `<div class="kvline">${esc(k)}：好感 ${st.favor[k]}</div>`).join("") || `<div class="meta">暂无</div>`;
  view.innerHTML = `<button class="back" onclick="showChat()">${icon("back")} 返回</button>
  <div class="card">
  <div class="field"><label>日期</label><input id="wsDate" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" value="${esc(st.date||"")}"></div>
  <div class="field"><label>地点</label><input id="wsLoc" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" value="${esc(st.loc||"")}"></div>
  <div class="field"><label>剧情进度</label><input id="wsProg" style="width:100%;background:#100e0b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px" value="${esc(st.progress||"")}"></div>
  <div class="btnrow" style="margin-top:8px"><button class="btn" onclick="travWsSave()">保存</button></div>
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
  document.body.classList.remove("chatmode");
  titleEl.innerHTML = icon("user")+" 我的身份"; subEl.textContent = RP_TRAVERSE.MODES[trav.mode]||"";
  const body = trav.mode==="soul"
    ? `<div class="card"><div class="name" style="font-size:16px">${esc(trav.charName)}</div>
       <div class="meta">${esc(trav.worldName)} · ${esc(trav.anchorTitle||"")}</div>
       <div class="kv" style="margin-top:8px">你是玩家本人，正在扮演 TA。能做的只有 TA 能做的，知道的只有 TA 知道的。</div></div>`
    : (()=>{
        const idt = RP_TRAVERSE.getIdentity(trav.identityId)||{};
        const rows = [["姓名",idt.name],["性别",idt.gender],["年龄",idt.age],["出身",idt.origin],
          ["性格",idt.traits],["特长",idt.talent],["当前处境",idt.situation]];
        return `<div class="card">${rows.filter(r=>r[1]).map(r=>
          `<div class="kvline"><span class="kv">${r[0]}</span> ${esc(r[1])}</div>`).join("")}
          ${idt.modern?`<div class="kvline"><span class="badge">现代人直穿</span></div>`:""}</div>`;
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
