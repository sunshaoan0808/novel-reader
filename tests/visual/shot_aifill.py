#!/usr/bin/env python3
"""AI 帮填按钮排版抽查：世界书表单 / 人设页 / 聊天输入栏，360x800 截图。"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets
CHROME = "/opt/meta-chromium/chrome"
DIR = os.path.dirname(os.path.abspath(__file__))
SEED_JS = open(os.path.join(DIR, "seed.js"), encoding="utf-8").read()
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
PORT = 9455
OUT = "/tmp/aifill_shots"
os.makedirs(OUT, exist_ok=True)

class CDP:
    def __init__(self, ws): self.ws = ws; self.iid = 0
    async def send(self, m, p=None):
        self.iid += 1
        await self.ws.send(json.dumps({"id": self.iid, "method": m, "params": p or {}}))
        while True:
            r = json.loads(await self.ws.recv())
            if r.get("id") == self.iid: return r.get("result", {})
    async def ev(self, js):
        r = await self.send("Runtime.evaluate", {"expression": js, "returnByValue": True})
        e = r.get("result", {})
        if e.get("subtype") == "error": raise RuntimeError(e.get("description", "")[:300])
        return e.get("value")
    async def shot(self, path):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(path, "wb").write(base64.b64decode(r["data"]))

async def main():
    targets = None
    for _ in range(60):
        try:
            data = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=5).read()
            targets = json.loads(data)
            break
        except Exception:
            await asyncio.sleep(0.5)
    page = [t for t in targets if t.get("type") == "page"][0]
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50*1024*1024) as ws:
        c = CDP(ws)
        await c.send("Page.enable")
        await c.send("Emulation.setDeviceMetricsOverride",
                     {"width": 360, "height": 800, "deviceScaleFactor": 2, "mobile": True})
        await c.send("Page.navigate", {"url": URL})
        await asyncio.sleep(2.5)
        await c.ev(SEED_JS)
        await asyncio.sleep(1)
        # 1. 世界书新增表单
        await c.ev("loreForm('r1', null)")
        await asyncio.sleep(0.8)
        await c.shot(f"{OUT}/lore.png")
        # 2. 人设页
        await c.ev("personaEditor(null, 'chat')")
        await asyncio.sleep(0.8)
        await c.shot(f"{OUT}/persona.png")
        # 3. 聊天输入栏
        await c.ev("(async()=>{ CHAT={mode:'single',runId:'r1',name:'林黛玉'}; await showChat(); return 'ok'; })()")
        await asyncio.sleep(1.2)
        n = await c.ev("document.querySelectorAll('.aifillbtn').length")
        print("aifillbtn count on chat page:", n)
        await c.shot(f"{OUT}/chatbar.png")
        print("shots ->", OUT)

chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
    "--user-data-dir=/tmp/aifill-vis", "--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(2)
    asyncio.run(main())
finally:
    chrome.terminate()
