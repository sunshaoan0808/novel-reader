#!/usr/bin/env python3
"""红学 P0 三项 360x800 视觉检查：方法论卡片/判词区/脂批区/人物页判词。无横向溢出。"""
import asyncio, base64, json, subprocess, time, urllib.request
import websockets

CHROME = "/opt/meta-chromium/chrome"

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

async def main():
    port = 9458
    profile = "/tmp/visreg-hlp0"
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
            await asyncio.sleep(2.5)
            fails = []
            # 进红楼 run 的 more 页 (showMore)
            ok = await c.ev("(function(){var d=window.__DATA__;var r=d.runs['honglou_full'];if(!r)return 'no-run';RUN=r;showMore();return 'ok';})()")
            if ok != "ok": fails.append("honglou_full run 缺失: " + str(ok))
            await asyncio.sleep(1)
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"more页横向溢出 scrollWidth={sw}")
            for key in ["版本与方法论", "判词·红楼梦曲", "脂批"]:
                if await c.ev("document.body.innerHTML.indexOf(%s)<0" % json.dumps(key)):
                    fails.append(f"缺失区块: {key}")
            # 滚到判词区截图
            await c.ev("Array.prototype.find.call(document.querySelectorAll('h2.sec'),function(e){return e.textContent.indexOf('判词')>=0;}).scrollIntoView()")
            await asyncio.sleep(0.5)
            await c.shot("/tmp/hlp0_foretell.png")
            # 滚到脂批区截图
            await c.ev("Array.prototype.find.call(document.querySelectorAll('h2.sec'),function(e){return e.textContent.indexOf('脂批')>=0;}).scrollIntoView()")
            await asyncio.sleep(0.5)
            await c.shot("/tmp/hlp0_zhipi.png")
            # 回顶部截方法论卡片
            await c.ev("window.scrollTo(0,0)")
            await asyncio.sleep(0.5)
            await c.shot("/tmp/hlp0_methodology.png")
            # 人物详情页: 林黛玉判词
            await c.ev("openChar('林黛玉')")
            await asyncio.sleep(1)
            if await c.ev("document.body.innerHTML.indexOf('林黛玉判词')<0"):
                fails.append("人物页判词缺失")
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"人物页横向溢出 scrollWidth={sw}")
            await c.shot("/tmp/hlp0_char.png")
            print("FAILS:", fails if fails else "none")
            return 1 if fails else 0
    finally:
        proc.kill(); subprocess.run(["rm", "-rf", profile])

import sys
sys.exit(asyncio.run(main()))
