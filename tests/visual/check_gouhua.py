#!/usr/bin/env python3
"""构画便携包导入 360x800 视觉检查：抽屉按钮/确认页排版/真实导入落库。"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

CHROME = "/opt/meta-chromium/chrome"
DIR = os.path.dirname(os.path.abspath(__file__))
SEED_JS = open(os.path.join(DIR, "seed.js"), encoding="utf-8").read()
AUDIT_JS = open(os.path.join(DIR, "audit.js"), encoding="utf-8").read()
REPO = "/home/hatch/workspace/github/novel-reader"
PKG = open(os.path.join(REPO, "tests/fixtures/gouhua-portable-real.json"), encoding="utf-8").read()
SHOW_CHAT = ('(async()=>{ CHAT={mode:"single",runId:"r1",name:"林黛玉"}; '
             'await showChat(); return "ok"; })()')

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
    async def ev(self, js, await_promise=False):
        r = await self.send("Runtime.evaluate", {"expression": js, "awaitPromise": await_promise, "returnByValue": True})
        res = r.get("result", {})
        if res.get("subtype") == "error":
            raise RuntimeError("page JS error: %s" % res.get("description", "")[:300])
        return res.get("value")
    async def shot(self, path):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(path, "wb").write(base64.b64decode(r["data"]))

async def main():
    port = 9458
    profile = "/tmp/visreg-gouhua"
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
            await asyncio.sleep(4)
            await c.ev(SEED_JS)
            await c.ev(SHOW_CHAT, await_promise=True)
            await asyncio.sleep(0.8)
            fails = []
            # 1) 抽屉里有新按钮
            await c.ev("toggleDrawer(true)")
            await asyncio.sleep(0.4)
            btns = await c.ev(
                "Array.prototype.map.call(document.querySelectorAll('#drawer .ditem'),function(b){return b.textContent.trim();})")
            if not any("导入构画便携包" in b for b in btns):
                fails.append("抽屉缺少「导入构画便携包」按钮")
            await c.shot("/tmp/gouhua_drawer.png")
            print("drawer shot: /tmp/gouhua_drawer.png")
            await c.ev("toggleDrawer(false)")
            # 2) 确认页(真实包)
            n = await c.ev(
                "(function(){var r=RP_GOUHUA.parsePortable(" + json.dumps(PKG) +
                ");if(!r.ok)return 'parse-fail:'+r.message;"
                "GOUHUA_PENDING={pkg:r.pkg,file:'gouhua-modules-test.json'};gouhuaConfirm();"
                "return RP_GOUHUA.summarize(r.pkg).length;})()")
            print("modules:", n)
            if n != 6: fails.append(f"模块数 {n} != 6")
            await asyncio.sleep(0.8)
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"横向溢出 scrollWidth={sw}")
            rows = await c.ev("document.querySelectorAll('#view .card').length")
            if rows < 2: fails.append(f"信息卡数量 {rows} < 2")
            btn = await c.ev("document.querySelector('button.btn.primary')?document.querySelector('button.btn.primary').getBoundingClientRect().toJSON():null")
            if not btn: fails.append("开始导入按钮缺失")
            elif btn["bottom"] > 810: fails.append(f"导入按钮超出视口 bottom={btn['bottom']}")
            bad = await c.ev(
                "Array.prototype.filter.call(document.querySelectorAll('#view .card .name,.meta'),function(el){return el.getBoundingClientRect().right>361;}).length")
            if bad: fails.append(f"{bad} 个元素超右边界")
            audit = await c.ev(AUDIT_JS)
            if audit.get("overlaps"): fails.append(f"audit overlaps={len(audit['overlaps'])}")
            await c.shot("/tmp/gouhua_confirm.png")
            print("confirm shot: /tmp/gouhua_confirm.png")
            # 3) 真实执行导入, 验证落库
            res = await c.ev("(function(){doGouhuaImport();return {lore:JSON.parse(localStorage.getItem('nd_lore_r1')||'[]').length,hist:JSON.parse(localStorage.getItem('nd_chat_r1_林黛玉')||'[]').length};})()")
            print("after import:", res)
            if res["lore"] < 11: fails.append(f"世界书落库 {res['lore']} < 11")
            if res["hist"] < 4: fails.append(f"聊天落库增量不足 hist={res['hist']}")
            if fails:
                print("VISUAL FAIL:"); [print(" -", f) for f in fails]; sys.exit(1)
            print("VISUAL PASS")
    finally:
        proc.terminate()

asyncio.run(main())
