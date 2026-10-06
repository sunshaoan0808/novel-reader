#!/usr/bin/env python3
"""P1 四件套视觉验证：发现页轨道/chips/开场选择器/徽章tooltip"""
import asyncio, json, os, sys
import urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from runner import CDP

PORT = 9461
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
SHOT_DIR = "/tmp/p1_shots"

SEED = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
var cards = [
 {id:"imp_a", name:"白月光", novel:"导入角色卡",
  fields:{core_identity:"温柔学姐", role_tags:"校园；纯爱"},
  greeting:"你来了，我等你好久了。",
  altGreetings:["好久不见，最近还好吗？","今晚月色真美，要一起去天台看看吗？"],
  exampleDialogue:"", scenario:"", systemPrompt:"", postHistoryInstructions:"",
  creatorNotes:"", tags:["校园"], worldbook:[], raw:{tags:["校园","纯爱"]}, createdAt:Date.now()},
 {id:"imp_b", name:"夜行者", novel:"导入角色卡",
  fields:{core_identity:"神秘的夜行侦探", role_tags:"都市；悬疑"},
  greeting:"深夜造访，有何贵干？", altGreetings:[],
  exampleDialogue:"", scenario:"", systemPrompt:"", postHistoryInstructions:"",
  creatorNotes:"", tags:["都市"], worldbook:[], raw:{tags:["都市","悬疑"]}, createdAt:Date.now()}
];
localStorage.setItem("nd_imported_cards", JSON.stringify(cards));
localStorage.setItem("nd_playstats_v1", JSON.stringify({
  "imported|白月光":{s:7,t:85,pi:128400,po:96200,fav:1,like:0,first:1,last:Date.now()},
  "imported|夜行者":{s:2,t:20,pi:1000,po:2000,fav:0,like:1,first:1,last:Date.now()-99999}
}));
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
showChatPicker();
"ok";
"""

async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        "/opt/meta-chromium/chrome", "--headless=new",
        "--remote-debugging-port=%d" % PORT, "--user-data-dir=/tmp/p1_%d" % PORT,
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
            print("FAIL: 连不上 Chrome"); return
        page = [t for t in targets if t.get("type") == "page"][0]
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50*1024*1024) as ws:
            c = CDP(ws)
            await c.send("Page.enable")
            await c.send("Emulation.setDeviceMetricsOverride",
                         {"width":360,"height":800,"deviceScaleFactor":2,"mobile":True})
            await c.send("Page.navigate", {"url": URL})
            await asyncio.sleep(2.5)
            assert await c.ev(SEED) == "ok", "seed fail"
            await asyncio.sleep(1.0)
            info = await c.ev("""(JSON.stringify({
  rails: document.querySelectorAll('.rail').length,
  railTitles: Array.from(document.querySelectorAll('h2.sec')).map(h=>h.textContent).join('|'),
  chips: document.querySelectorAll('.pickchip').length,
  chipLabels: Array.from(document.querySelectorAll('.pickchip')).map(e=>e.textContent).join('|'),
}))""")
            print("发现页检查:", info)
            await c.shot(SHOT_DIR+"/discover.png")
            # 点 chips 过滤：点"校园"
            await c.ev("""(function(){ var b=[...document.querySelectorAll('.pickchip')]
              .find(x=>x.textContent.includes('校园')); if(b) b.click(); return 'ok'; })()""")
            await asyncio.sleep(0.8)
            info2 = await c.ev("""(JSON.stringify({
  gridCount: document.querySelectorAll('.chargrid .charcard').length,
  gridNames: Array.from(document.querySelectorAll('.chargrid .charcard .n')).map(e=>e.textContent).join(','),
  activeChip: (document.querySelector('.pickchip.on')||{}).textContent || null,
}))""")
            print("chips过滤检查:", info2)
            await c.shot(SHOT_DIR+"/discover_filtered.png")
            # 开场选择器：chatWith 多开场卡
            await c.ev("chatWith('imported','白月光'); 'ok'")
            await asyncio.sleep(0.8)
            info3 = await c.ev("""(JSON.stringify({
  sheetOn: document.getElementById('opensheet').classList.contains('on'),
  items: document.querySelectorAll('#opensheet .opitem').length,
  hasRandom: document.getElementById('opensheet').textContent.includes('随机开场'),
}))""")
            print("开场选择器检查:", info3)
            await c.shot(SHOT_DIR+"/opensheet.png")
            # 选第2个开场 → 进聊天，首条=该开场
            await c.ev("pickOpening('imported','白月光',1); 'ok'")
            await asyncio.sleep(1.2)
            info4 = await c.ev("""(JSON.stringify({
  firstMsg: (function(){ var b=document.querySelector('#chatlog .msg .bubble');
    return b ? b.textContent.slice(0,20) : null; })(),
}))""")
            print("选开场进聊检查:", info4)
            # 徽章 tooltip：回详情页点徽章
            await c.ev("charDetail('imported','白月光'); 'ok'")
            await asyncio.sleep(0.8)
            await c.ev("""(function(){ var b=[...document.querySelectorAll('.tagchip')]
              .find(x=>x.textContent==='多开场'); if(b) b.click(); return 'ok'; })()""")
            await asyncio.sleep(0.6)
            info5 = await c.ev("""(JSON.stringify({
  toastShow: document.getElementById('tipToast').classList.contains('show'),
  toastText: document.getElementById('tipToast').textContent.slice(0,40),
}))""")
            print("徽章tooltip检查:", info5)
            await c.shot(SHOT_DIR+"/badgetip.png")
            print("shots in", SHOT_DIR)
    finally:
        proc.terminate()

asyncio.run(main())
