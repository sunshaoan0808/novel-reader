#!/usr/bin/env python3
"""触控目标 ≥44px 视觉验证：审计清单 8 类目标在 360x800 真机视口下的实际命中尺寸。

   无头 Chromium + CDP（照 tests/visual/shot_tier6.py 的写法）。
   每个目标都用 App 自己的渲染函数产出 DOM，再读 offsetWidth/offsetHeight 断言 ≥44px，
   页面截图落在 /tmp/touch44_shots/。

   注：.gochat 在 www/ 全站没有产出方（app.js/index.html/rp/** 都 grep 不到），
   是孤儿 CSS —— 这一项用注入的探针元素量它的计算样式，其余 7 项都是真实渲染。"""
import asyncio, json, os, sys
import urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from runner import CDP

PORT = 9473
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
SHOT_DIR = "/tmp/touch44_shots"

SEED = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded", "1");
localStorage.setItem("nd_rp_cfg_v1", JSON.stringify({typewriter:false}));
var card = {id:"imp1", name:"白月光", novel:"测试书",
  fields:{core_identity:"外冷内热的白月光", role_tags:"温柔、病娇、校园"},
  greeting:"你来了。", altGreetings:[], exampleDialogue:"", scenario:"",
  systemPrompt:"", postHistoryInstructions:"", creatorNotes:"",
  tags:["温柔","病娇"], worldbook:[], raw:{tags:["温柔"]}, createdAt:Date.now()};
localStorage.setItem("nd_imported_cards", JSON.stringify([card]));
/* 聊天记录：带 candidates 的 AI 回复才会渲染 .swipe 左右箭头 */
localStorage.setItem("nd_chat_imported_白月光", JSON.stringify([
  {mid:"m1", role:"user", content:"嗨", ts:Date.now()},
  {mid:"m2", role:"assistant", content:"回复一", ts:Date.now(),
   candidates:["回复一","回复二","回复三"], ci:0}]));
/* 记忆库：有数据 + 已迁移，renderAlbum 才会吐出 .kindchip 筛选行 */
localStorage.setItem("nd_mem2_imported_白月光", JSON.stringify(
  {short:[{text:"初见", ts:Date.now(), pin:true}], long:"",
   profile3:[], event3:[], record3:[], migrated3:true}));
/* ST 预设：两条目才会同时渲染 ↑ ↓ 两个 .sbtn */
localStorage.setItem("nd_stpresets", JSON.stringify([{
  id:"p1", name:"测试预设", at:Date.now(), params:{},
  prompts:[{name:"身份", role:"system", content:"你是谁", enabled:true},
           {name:"语气", role:"system", content:"轻声细语", enabled:true}]}]));
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
"ok";
"""

# 量一个选择器的第一个可见元素：{n: 个数, w: 盒宽, h: 命中高, rectW/H: 实际绘制矩形, txt: 文本}
# 命中高取 max(盒高, ::after 命中扩展高) —— .aifillbtn 用透明的 ::after 撑到 44px，
# 外观仍是 23px 的小徽标（直接给 min-height 会变成压住输入框的实心药丸）。
MEASURE = """(function(sel){
  var els = Array.from(document.querySelectorAll(sel));
  if(!els.length) return JSON.stringify({n:0, w:0, h:0, box:0});
  var e = els[0];
  var r = e.getBoundingClientRect();
  var a = getComputedStyle(e, '::after');
  var slop = (a && a.content && a.content !== 'none' && a.position === 'absolute')
    ? (parseFloat(a.height) || 0) : 0;
  return JSON.stringify({n:els.length, w:Math.round(e.offsetWidth),
                         h:Math.round(Math.max(e.offsetHeight, slop)),
                         box:Math.round(e.offsetHeight), slop:Math.round(slop),
                         rectW:Math.round(r.width), rectH:Math.round(r.height),
                         txt:(e.textContent||"").trim().slice(0,10)});
})(%s)"""

fails = []
def check(name, m, extra=""):
    ok = m.get("n", 0) > 0 and m.get("w", 0) >= 44 and m.get("h", 0) >= 44
    line = "%s %s  %dx%d (共%d个)%s" % ("PASS" if ok else "FAIL", name,
                                       m.get("w", 0), m.get("h", 0), m.get("n", 0), extra)
    print("  " + line, flush=True)
    if not ok:
        fails.append(name)
    return ok


async def wait_for(c, sel, timeout=8.0):
    """轮询等选择器出现（showChat 是 async，setNav 不 await 它）。"""
    waited = 0.0
    while waited < timeout:
        n = await c.ev("(document.querySelectorAll(%s)||[]).length" % json.dumps(sel))
        if n:
            return True
        await asyncio.sleep(0.25)
        waited += 0.25
    return False


async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        "/opt/meta-chromium/chrome", "--headless=new",
        "--remote-debugging-port=%d" % PORT,
        "--user-data-dir=/tmp/cl_profile_%d" % PORT,
        "--no-sandbox", "--disable-gpu", "about:blank",
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    try:
        targets = None
        for _ in range(60):
            try:
                data = urllib.request.urlopen("http://127.0.0.1:%d/json" % PORT, timeout=5).read()
                targets = json.loads(data); break
            except Exception:
                await asyncio.sleep(0.5)
        if not targets:
            print("FAIL: 连不上 Chrome"); return 2
        page = [t for t in targets if t.get("type") == "page"][0]
        async with websockets.connect(page["webSocketDebuggerUrl"],
                                      max_size=50 * 1024 * 1024) as ws:
            c = CDP(ws)
            await c.send("Page.enable")
            await c.send("Runtime.enable")
            await c.send("Emulation.setDeviceMetricsOverride",
                         {"width": 360, "height": 800, "deviceScaleFactor": 2, "mobile": True})
            await c.send("Page.navigate", {"url": URL})
            await asyncio.sleep(2.5)
            if await c.ev(SEED) != "ok":
                print("FAIL seed"); return 2
            await asyncio.sleep(1.0)
            print("视口 360x800，seed 完成\n", flush=True)

            # ---------- 1. .charbody .ops button（角色卡操作按钮）----------
            print("[1] .charbody.ops button — 选角色页角色卡")
            await c.ev("CHAT = {mode:'single', runId:'', name:''}; setNav('chat'); 'ok'")
            await asyncio.sleep(1.2)
            m = json.loads(await c.ev(MEASURE % "'.charbody .ops button'"))
            check(".charbody.ops button", m, " 「%s」" % m.get("txt", ""))
            await c.shot(SHOT_DIR + "/01_charcard_ops.png")

            # ---------- 2. .swipe button + .povchip（聊天页）----------
            print("[2] .swipe button / .povchip — 聊天页 + 右侧抽屉")
            await c.ev("chatWith('imported','白月光'); 'ok'")
            got = await wait_for(c, ".swipe button")
            if not got:
                # showChat 的 IDB 预热可能卡住：退回到同步渲染路径
                print("     (showChat 未渲染出 .swipe，改走 renderChat 同步路径)")
                await c.ev("""(function(){
                  CHAT = {mode:'single', runId:'imported', name:'白月光', members:[], forcedSpeaker:null};
                  loadPov();
                  document.getElementById('view').innerHTML = '<div id="chatlog"></div>';
                  renderChat();
                })(); 'ok'""")
                got = await wait_for(c, ".swipe button", 4.0)
            m = json.loads(await c.ev(MEASURE % "'.swipe button'"))
            check(".swipe button", m, " 「%s」" % m.get("txt", ""))
            await c.shot(SHOT_DIR + "/02_chat_swipe.png")

            # 抽屉里的视角 chips（.povchip）：抽屉是 transform 移出屏的，但仍参与布局
            await c.ev("toggleDrawer(true); 'ok'")
            await asyncio.sleep(0.8)
            m = json.loads(await c.ev(MEASURE % "'.drawer .povchip'"))
            check(".povchip", m, " 「%s」" % m.get("txt", ""))
            await c.shot(SHOT_DIR + "/03_chat_drawer_povchips.png")
            await c.ev("toggleDrawer(false); 'ok'")
            await asyncio.sleep(0.4)

            # ---------- 3. .kindchip（记忆事件簿分型筛选）----------
            print("[3] .kindchip — 记忆事件簿")
            await c.ev("openAlbum('imported','白月光'); 'ok'")
            await asyncio.sleep(1.2)
            m = json.loads(await c.ev(MEASURE % "'.kindchip'"))
            check(".kindchip", m, " 「%s」" % m.get("txt", ""))
            await c.shot(SHOT_DIR + "/04_album_kindchips.png")

            # ---------- 4. .tagchip（卡片落地页标签）----------
            print("[4] .tagchip — 角色卡落地页")
            await c.ev("charDetail('imported','白月光'); 'ok'")
            await asyncio.sleep(1.4)
            m = json.loads(await c.ev(MEASURE % "'.tagchip'"))
            check(".tagchip", m, " 「%s」" % m.get("txt", ""))
            await c.shot(SHOT_DIR + "/05_landing_tagchips.png")

            # ---------- 5. .aifillbtn（世界书表单里的 ✨AI 徽标）----------
            print("[5] .aifillbtn — 世界书条目表单")
            await c.ev("loreForm('imported', null); 'ok'")
            await asyncio.sleep(1.0)
            m = json.loads(await c.ev(MEASURE % "'.aifillbtn'"))
            check(".aifillbtn", m, " 盒高%dpx + ::after命中扩展%dpx 「%s」"
                  % (m.get("box", 0), m.get("slop", 0), m.get("txt", "")))
            # 版面没被撑坏：表单标题行高应与原来一致（≈20px 的行盒，不是 44px）
            lay = json.loads(await c.ev("""(function(){
              var lab = document.querySelector('.field label');
              var inp = document.querySelector('.field input');
              var btn = document.querySelector('.aifillbtn');
              return JSON.stringify({labelH: lab ? Math.round(lab.offsetHeight) : 0,
                                     inputH: inp ? Math.round(inp.offsetHeight) : 0,
                                     btnTop: btn ? Math.round(btn.getBoundingClientRect().top) : 0,
                                     labelTop: lab ? Math.round(lab.getBoundingClientRect().top) : 0});
            })()"""))
            overlap = lay["btnTop"] > lay["labelTop"] + lay["labelH"]
            print("     版面: label高%dpx input高%dpx 徽标是否压到下一行=%s"
                  % (lay["labelH"], lay["inputH"], overlap), flush=True)
            if overlap:
                fails.append(".aifillbtn 版面溢出")
            await c.shot(SHOT_DIR + "/06_lore_aifill.png")

            # ---------- 6. .sbtn（ST 预设条目排序键）----------
            print("[6] .sbtn — ST 预设条目列表")
            await c.ev("renderStPresetEntries('p1'); 'ok'")
            await asyncio.sleep(1.0)
            m = json.loads(await c.ev(MEASURE % "'.sbtn'"))
            check(".sbtn", m, " 「%s」" % m.get("txt", ""))
            row = json.loads(await c.ev("""(function(){
              var col = document.querySelector('.sbtncol');
              var txt = col && col.previousElementSibling;
              return JSON.stringify({colW: col ? Math.round(col.offsetWidth) : 0,
                                     nameW: txt ? Math.round(txt.offsetWidth) : 0,
                                     overflow: document.documentElement.scrollWidth > 360});
            })()"""))
            print("     版面: 按钮列宽%dpx 文字区宽%dpx 横向溢出=%s"
                  % (row["colW"], row["nameW"], row["overflow"]), flush=True)
            if row["overflow"]:
                fails.append(".sbtn 横向溢出")
            await c.shot(SHOT_DIR + "/07_preset_sbtn.png")

            # ---------- 7. .gochat（孤儿 CSS，注入探针量计算样式）----------
            print("[7] .gochat — 无产出方，注入探针元素量计算样式")
            await c.ev("""(function(){
              document.getElementById('view').innerHTML =
                '<div class="row"><div style="flex:1"><div class="name">发现页角色</div>' +
                '<div class="kv">探针：.gochat 全站无产出方</div></div>' +
                '<button class="gochat">开聊</button></div>';
            })(); 'ok'""")
            await asyncio.sleep(0.5)
            m = json.loads(await c.ev(MEASURE % "'.gochat'"))
            check(".gochat（探针）", m, " 「%s」" % m.get("txt", ""))
            await c.shot(SHOT_DIR + "/08_gochat_probe.png")

        print("")
        if fails:
            print("RESULT: FAIL（%d 项）: %s" % (len(fails), ", ".join(fails)))
            print("截图目录:", SHOT_DIR)
            return 1
        print("RESULT: PASS（8/8 触控目标均 ≥44px）")
        print("截图目录:", SHOT_DIR)
        return 0
    finally:
        proc.terminate()

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))