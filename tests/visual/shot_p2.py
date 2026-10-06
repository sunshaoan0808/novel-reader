#!/usr/bin/env python3
"""P2 视觉验证：开源卡只读/主题切换/签到日历/专辑"""
import asyncio, json, os, sys
import urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from runner import CDP

PORT = 9462
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
SHOT_DIR = "/tmp/p2_shots"

SEED = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
var card = {id:"imp_a", name:"白月光", novel:"导入角色卡",
  fields:{core_identity:"温柔体贴的学姐", core_traits:"温柔，偶尔腹黑", speech_style:"轻声细语"},
  greeting:"你来了，我等你好久了。",
  altGreetings:["好久不见，最近还好吗？"],
  exampleDialogue:"", scenario:"", systemPrompt:"", postHistoryInstructions:"",
  creatorNotes:"", tags:["校园"], worldbook:[{name:"学园", keys:"学校"}], raw:{tags:["校园"]}, createdAt:Date.now()};
localStorage.setItem("nd_imported_cards", JSON.stringify([card]));
localStorage.setItem("nd_checkin_v1", JSON.stringify((function(){ var o={}, d=new Date();
  function f(x){ var m=x.getMonth()+1,dd=x.getDate();
    return x.getFullYear()+"-"+(m<10?"0"+m:m)+"-"+(dd<10?"0"+dd:dd); }
  o[f(d)]=1; d.setDate(d.getDate()-1); o[f(d)]=1; d.setDate(d.getDate()-1); o[f(d)]=1; return o; })()));
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
"ok";
"""

async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        "/opt/meta-chromium/chrome", "--headless=new",
        "--remote-debugging-port=%d" % PORT, "--user-data-dir=/tmp/p2_%d" % PORT,
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
            # 1) 开源卡只读视图
            await c.ev("charDetail('imported','白月光'); 'ok'")
            await asyncio.sleep(0.8)
            await c.ev("viewCardSource('imported','白月光'); 'ok'")
            await asyncio.sleep(0.8)
            info = await c.ev("""(JSON.stringify({
  title: document.getElementById('title').textContent,
  hasFields: document.body.textContent.includes('人设字段'),
  hasCopy: document.body.textContent.includes('复制设定 JSON'),
  hasReadonly: document.body.textContent.includes('只读'),
}))""")
            print("开源卡检查:", info)
            await c.shot(SHOT_DIR+"/cardsource.png")
            # 2) 主题切换：设置页切松烟
            await c.ev("showSettings(); 'ok'")
            await asyncio.sleep(0.8)
            await c.shot(SHOT_DIR+"/settings_theme.png")
            await c.ev("setThemeUI('songyan'); 'ok'")
            await asyncio.sleep(0.8)
            info2 = await c.ev("""(JSON.stringify({
  theme: localStorage.getItem('nd_theme_v1'),
  bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
}))""")
            print("主题检查:", info2)
            await c.shot(SHOT_DIR+"/theme_songyan.png")
            # 切回墨夜
            await c.ev("setThemeUI('moye'); 'ok'")
            await asyncio.sleep(0.5)
            # 3) 签到日历
            info3 = await c.ev("""(JSON.stringify({
  streak: document.body.textContent.includes('连续签到'),
  signedCells: document.querySelectorAll('.calcell.signed').length,
  hasBtn: document.body.textContent.includes('今日已签到'),
}))""")
            print("签到检查:", info3)
            await c.ev("""(function(){ var h=[...document.querySelectorAll('.setcard h3')]
              .find(x=>x.textContent.includes('签到')); if(h) h.scrollIntoView(); return 'ok'; })()""")
            await asyncio.sleep(0.5)
            await c.shot(SHOT_DIR+"/checkin.png")
            # 4) 专辑：发现页建专辑 → 加卡
            await c.ev("showChatPicker(); 'ok'")
            await asyncio.sleep(0.8)
            info4 = await c.ev("""(JSON.stringify({
  albumRail: document.body.textContent.includes('我的专辑'),
}))""")
            print("专辑轨道检查:", info4)
            await c.ev("var a = RP_ALBUM.create('测试专辑'); RP_ALBUM.addCard(a.id,'imported','白月光'); albumPage(a.id); 'ok'")
            await asyncio.sleep(0.8)
            info5 = await c.ev("""(JSON.stringify({
  title: document.getElementById('title').textContent,
  cards: document.querySelectorAll('.chargrid .charcard').length,
  hasAdd: document.body.textContent.includes('加卡'),
  hasExport: document.body.textContent.includes('导出'),
}))""")
            print("专辑页检查:", info5)
            await c.shot(SHOT_DIR+"/album.png")
            print("shots in", SHOT_DIR)
    finally:
        proc.terminate()

asyncio.run(main())
