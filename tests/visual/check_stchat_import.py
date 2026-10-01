#!/usr/bin/env python3
"""ST 聊天记录导入确认页 360x800 视觉检查：信息卡/单选/按钮排版、无横向溢出、无重叠。"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

CHROME = "/opt/meta-chromium/chrome"
DIR = os.path.dirname(os.path.abspath(__file__))
SEED_JS = open(os.path.join(DIR, "seed.js"), encoding="utf-8").read()
AUDIT_JS = open(os.path.join(DIR, "audit.js"), encoding="utf-8").read()
REPO = "/home/hatch/workspace/github/novel-reader"
CHAT = open(os.path.join(REPO, "tests/fixtures/chat-ruby.jsonl"), encoding="utf-8").read()

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
    port = 9457
    profile = "/tmp/visreg-stchat"
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
            # 用真实 RUBY jsonl 构造 pending 并打开确认页
            ok = await c.ev(
                "(function(){var p=stChatParse(" + json.dumps(CHAT) +
                ");var e=stChatToEntries(p);STCHAT_PENDING={parsed:p,entries:e,file:'chat-ruby.jsonl'};stChatConfirm();return e.length;})()")
            print("entries:", ok)
            await asyncio.sleep(1)
            fails = []
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"横向溢出 scrollWidth={sw}")
            # 关键元素可见且在视口内
            btn = await c.ev("document.querySelector('button.btn.primary')?document.querySelector('button.btn.primary').getBoundingClientRect().toJSON():null")
            if not btn: fails.append("开始导入按钮缺失")
            elif btn["bottom"] > 810: fails.append(f"导入按钮超出视口 bottom={btn['bottom']}")
            radios = await c.ev("document.querySelectorAll('input[name=stchat_mode]').length")
            if radios != 2: fails.append(f"单选框数量 {radios} != 2")
            cards = await c.ev("document.querySelectorAll('#view .card').length")
            if cards < 2: fails.append(f"信息卡数量 {cards} < 2")
            # 长文件名/角色名不横向溢出
            bad = await c.ev(
                "Array.prototype.filter.call(document.querySelectorAll('#view .card .name'),function(el){return el.getBoundingClientRect().right>361;}).length")
            if bad: fails.append(f"{bad} 个名称超右边界")
            audit = await c.ev(AUDIT_JS)
            if audit.get("overlaps"): fails.append(f"audit overlaps={len(audit['overlaps'])}")
            await c.shot("/tmp/stchat_confirm.png")
            print("screenshot: /tmp/stchat_confirm.png")
            if fails:
                print("VISUAL FAIL:"); [print(" -", f) for f in fails]; sys.exit(1)
            print("VISUAL PASS")
    finally:
        proc.terminate()

asyncio.run(main())
