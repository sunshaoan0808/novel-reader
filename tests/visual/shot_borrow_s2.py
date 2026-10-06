#!/usr/bin/env python3
"""S级清单 UI 检查: 卡片编辑页新字段 / 场景条输入框 / 🧠召回指示器"""
import asyncio, base64, json, os, sys
import urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from runner import CDP

PORT = 9457
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"

SEED_CARD = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
var card = {id:"imp_s1", name:"测试角色", novel:"导入角色卡",
  fields:{core_identity:"身份描述", core_traits:"傲娇"},
  greeting:"嗨！", altGreetings:[], exampleDialogue:"",
  scenario:"学园都市", systemPrompt:"保持人设", postHistoryInstructions:"",
  creatorNotes:"", flair:"roleplay", temperature:1.2, tags:["傲娇","毒舌"],
  worldbook:[], raw:{}, createdAt:Date.now()};
localStorage.setItem("nd_imported_cards", JSON.stringify([card]));
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
editCard("imported","imp_s1");
"ok";
"""

SEED_CHAT = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
var h = [
 {mid:"m1", role:"user", content:"你还记得我们上次去的茶馆吗？", ts:Date.now()-60000},
 {mid:"m2", role:"assistant", content:"当然记得，城西那家老茶馆，你说老板娘的桂花糖藕最好吃。",
  ts:Date.now()-30000, candidates:["当然记得，城西那家老茶馆，你说老板娘的桂花糖藕最好吃。"], ci:0,
  memHits:[{pool:"important",label:"铁律记忆",items:1},{pool:"important",label:"置顶记忆",items:2},{pool:"recent",label:"事件",items:3}],
  loreHits:["学园都市"]}
];
localStorage.setItem("nd_chat_r1_测试角色", JSON.stringify(h));
CHAT={mode:"single",runId:"r1",name:"测试角色"};
showChat();
"ok";
"""

async def run_case(port, seed_js, shots):
    targets = None
    for _ in range(60):
        try:
            data = urllib.request.urlopen("http://127.0.0.1:%d/json" % port, timeout=5).read()
            targets = json.loads(data)
            break
        except Exception:
            await asyncio.sleep(0.5)
    if not targets:
        print("FAIL: 连不上 Chrome"); return
    page = [t for t in targets if t.get("type") == "page"][0]
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50*1024*1024) as ws:
        c = CDP(ws)
        await c.send("Page.enable")
        await c.send("Emulation.setDeviceMetricsOverride",
                     {"width": 360, "height": 800, "deviceScaleFactor": 2, "mobile": True})
        await c.send("Page.navigate", {"url": URL})
        for _ in range(60):
            if await c.ev("document.readyState") == "complete": break
            await asyncio.sleep(0.5)
        await asyncio.sleep(1.5)
        print("seed:", await c.ev(seed_js), flush=True)
        await asyncio.sleep(0.8)
        for path, js in shots:
            if js: await c.ev(js)
            await asyncio.sleep(0.4)
            await c.shot(path)
            print("shot:", path, flush=True)
        ov = await c.ev("""(function(){var bad=[];document.querySelectorAll("#view *").forEach(function(e){var r=e.getBoundingClientRect();if(r.right>361&&e.children.length===0&&r.width>1)bad.push(e.tagName+":"+Math.round(r.right));});return bad.slice(0,10);})()""")
        print("横向溢出:", ov)

async def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "card"
    if which == "card":
        await run_case(PORT, SEED_CARD, [
            ("/tmp/s2_cardedit2.png", "window.scrollTo(0,1400)"),
        ])
    else:
        await run_case(PORT, SEED_CHAT, [
            ("/tmp/s2_chat_scen.png", None),
            ("/tmp/s2_chat_brain.png",
             """(function(){
                 var msgs=document.querySelectorAll('.msg');
                 var last=msgs[msgs.length-1]; last.classList.add('show-tools');
                 toggleMemHits(1);
                 last.scrollIntoView({block:'center'});
                 return 'ok';
               })()"""),
        ])

asyncio.run(main())
