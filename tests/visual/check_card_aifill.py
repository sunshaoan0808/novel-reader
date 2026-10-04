#!/usr/bin/env python3
"""AI 补完 + 看图写卡新 UI 360x800 视觉检查。"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

CHROME = "/opt/meta-chromium/chrome"
DIR = os.path.dirname(os.path.abspath(__file__))
SEED_JS = open(os.path.join(DIR, "seed.js"), encoding="utf-8").read()

class CDP:
    def __init__(self, ws):
        self.ws = ws; self.iid = 0
    async def send(self, method, params=None):
        self.iid += 1
        await self.ws.send(json.dumps({"id": self.iid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == self.iid:
                if "error" in msg: raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})
    async def ev(self, js):
        r = await self.send("Runtime.evaluate", {"expression": js, "returnByValue": True})
        res = r.get("result", {})
        if res.get("subtype") == "error":
            raise RuntimeError("page JS error: %s" % res.get("description", "")[:300])
        return res.get("value")
    async def shot(self, path):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(path, "wb").write(base64.b64decode(r["data"]))

SETUP_JS = """
(function(){
localStorage.setItem("nd_api_cfg_v1", JSON.stringify({base:"http://x",key:"k",model:"mimo-v2.6-flash-free"}));
var card = {id:"gf1", name:"测试卡", novel:"导入角色卡",
  fields:{core_identity:"国中生", core_traits:"傲娇"},
  greeting:"", altGreetings:[], exampleDialogue:"", exampleBlocks:[],
  scenario:"学园都市", systemPrompt:"", postHistoryInstructions:"", creatorNotes:"",
  depthPrompt:null, groupOnlyGreetings:[], characterVersion:"", creator:"",
  bookMeta:{}, sysNote:"", worldbook:[], raw:{}, aiFilled:{}, createdAt:Date.now()};
RP_CARDIMPORT.add(card);
return card.id;
})()
"""

async def main():
    port = 9458
    profile = "/tmp/visreg-aifill"
    subprocess.run(["rm", "-rf", profile])
    url = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
    proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}",
                             f"--user-data-dir={profile}", "--no-sandbox", "--disable-gpu",
                             "--hide-scrollbars"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2))
                break
            except Exception: time.sleep(0.5)
        wsurl = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
        async with websockets.connect(wsurl, max_size=64*1024*1024) as ws:
            c = CDP(ws)
            await c.send("Emulation.setDeviceMetricsOverride",
                         {"width": 360, "height": 800, "deviceScaleFactor": 2, "mobile": True})
            await c.send("Page.navigate", {"url": url})
            await asyncio.sleep(2)
            await c.ev(SEED_JS)
            cid = await c.ev(SETUP_JS)
            await asyncio.sleep(0.5)
            fails = []
            def check_overflow(name):
                return None
            # 1) 补完提示页
            await c.ev("cardGapfillPrompt(%s, ['ooc_redline','soul_goal','hidden_desire'], [])" % json.dumps(cid))
            await asyncio.sleep(0.8)
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"补完提示页横向溢出 {sw}")
            if await c.ev("document.body.innerHTML.indexOf('AI 补完缺失层')") < 0: fails.append("补完按钮缺失")
            await c.shot("/tmp/aifill_prompt.png")
            # 2) 补完编辑预览页
            await c.ev("""(function(){
              window._gapfillDraft = {cardId:%s, fields:{ooc_redline:"绝不欺负弱小", soul_goal:"守护朋友", hidden_desire:"被需要的感觉"}};
              cardGapfillView();
            })()""" % json.dumps(cid))
            await asyncio.sleep(0.8)
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"补完预览页横向溢出 {sw}")
            nta = await c.ev("document.querySelectorAll('textarea[id^=gf_]').length")
            if nta != 3: fails.append(f"补完字段数 {nta} != 3")
            await c.shot("/tmp/aifill_preview.png")
            # 3) 确认写入 -> 编辑页看 AI 补完标注
            await c.ev("cardGapfillSave()")
            await asyncio.sleep(0.8)
            await c.ev("editCard('imported', %s)" % json.dumps(cid))
            await asyncio.sleep(0.8)
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"编辑页横向溢出 {sw}")
            badges = await c.ev("(document.body.innerHTML.match(/AI 补完/g)||[]).length")
            if badges < 3: fails.append(f"AI 补完标注数 {badges} < 3")
            await c.shot("/tmp/aifill_editor.png")
            # 4) 看图写卡设置页（无 vision 标签 -> 警告 + 模型输入框）
            png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
            await c.ev("travVisionSetup(%s)" % json.dumps(png))
            await asyncio.sleep(0.8)
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"看图设置页横向溢出 {sw}")
            if await c.ev("!!document.getElementById('vv_model')") != True: fails.append("vision 模型输入框缺失")
            if await c.ev("document.body.innerHTML.indexOf('需要 vision 模型')") < 0: fails.append("vision 能力警告缺失")
            await c.shot("/tmp/vision_setup.png")
            # 5) 多人选择页
            await c.ev("""(function(){
              window._visionChars = [
                {name:"美琴", appearance:"茶色短发", personality:"傲娇"},
                {name:"黑子", appearance:"双马尾", personality:"病娇"}
              ];
              travVisionSelect();
            })()""")
            await asyncio.sleep(0.8)
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"多人选择页横向溢出 {sw}")
            ncb = await c.ev("document.querySelectorAll('input[type=checkbox][id^=vc_]').length")
            if ncb != 2: fails.append(f"人物复选框数 {ncb} != 2")
            await c.shot("/tmp/vision_select.png")
            # 6) 穿越页导入区新按钮
            await c.ev("showTraverse()")
            await asyncio.sleep(0.8)
            if await c.ev("document.body.innerHTML.indexOf('看图写卡')") < 0: fails.append("看图写卡入口缺失")
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"穿越页横向溢出 {sw}")
            await c.shot("/tmp/vision_entry.png")
            print("FAILS:", fails if fails else "none")
            return 1 if fails else 0
    finally:
        proc.kill(); subprocess.run(["rm", "-rf", profile])

sys.exit(asyncio.run(main()))
