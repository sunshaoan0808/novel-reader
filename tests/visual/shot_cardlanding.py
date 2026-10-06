#!/usr/bin/env python3
"""P0 卡片详情落地页视觉验证：徽章/数据条/CTA/开场列表/点击开场直达开聊"""
import asyncio, json, os, sys
import urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from runner import CDP

PORT = 9458
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
SHOT_DIR = "/tmp/cardlanding_shots"

SEED = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
var card = {id:"imp_cl", name:"白月光", novel:"导入角色卡",
  fields:{core_identity:"温柔体贴的学姐，笑起来眼睛弯成月牙", core_traits:"温柔，偶尔腹黑",
    role_tags:"校园；纯爱；学姐", speech_style:"轻声细语"},
  greeting:"你来了，我等你好久了。",
  altGreetings:["好久不见，最近还好吗？","今晚月色真美，要一起去天台看看吗？"],
  exampleDialogue:"", scenario:"", systemPrompt:"", postHistoryInstructions:"",
  creatorNotes:"", tags:["校园","纯爱"], worldbook:[], raw:{tags:["校园","纯爱"]}, createdAt:Date.now()};
localStorage.setItem("nd_imported_cards", JSON.stringify([card]));
/* 种子游玩统计 */
localStorage.setItem("nd_playstats_v1", JSON.stringify(
  {"imported|白月光":{s:7,t:85,pi:128400,po:96200,fav:1,like:0,first:1,last:2}}));
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
charDetail("imported","白月光");
"ok";
"""

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
            print("FAIL: 连不上 Chrome"); return
        page = [t for t in targets if t.get("type") == "page"][0]
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50*1024*1024) as ws:
            c = CDP(ws)
            await c.send("Page.enable")
            await c.send("Emulation.setDeviceMetricsOverride",
                         {"width":360,"height":800,"deviceScaleFactor":2,"mobile":True})
            await c.send("Page.navigate", {"url": URL})
            await asyncio.sleep(2.5)
            if await c.ev(SEED) != "ok":
                print("FAIL seed"); return
            await asyncio.sleep(1.2)
            info = await c.ev("""(JSON.stringify({
  hasCTA: !!document.querySelector('.btn.landcta'),
  badges: Array.from(document.querySelectorAll('.tagchip')).map(e=>e.textContent),
  stat: document.body.textContent.includes('开局 7 次'),
  openings: document.querySelectorAll('.opencard').length,
  howto: document.body.textContent.includes('玩法说明'),
  spec: !!document.querySelector('.specgrid'),
}))""")
            print("落地页检查:", info)
            await c.shot(SHOT_DIR+"/landing_top.png")
            await c.ev("window.scrollTo(0,99999); 'ok'")
            await asyncio.sleep(0.6)
            await c.shot(SHOT_DIR+"/landing_bottom.png")
            await c.ev("window.scrollTo(0,0); 'ok'")
            await asyncio.sleep(0.4)
            await c.ev("document.querySelectorAll('.opencard')[1].click(); 'ok'")
            await asyncio.sleep(1.5)
            info2 = await c.ev("""(JSON.stringify({
  inChat: !!document.getElementById('chatlog'),
  firstMsg: (function(){ var b=document.querySelector('#chatlog .msg .bubble');
    return b ? b.textContent.slice(0,20) : null; })(),
  histLen: (function(){ try{ return JSON.parse(localStorage.getItem('nd_chat_imported_白月光')||'[]').length; }catch(e){ return -1; } })(),
}))""")
            print("开场直达检查:", info2)
            await c.shot(SHOT_DIR+"/opening_chat.png")
            print("shots in", SHOT_DIR)
    finally:
        proc.terminate()

asyncio.run(main())
