#!/usr/bin/env python3
"""ST 预设条目管理页 360x800 视觉检查：长条目名换行、开关触控区、无横向溢出。"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

CHROME = "/opt/meta-chromium/chrome"
DIR = os.path.dirname(os.path.abspath(__file__))
SEED_JS = open(os.path.join(DIR, "seed.js"), encoding="utf-8").read()
AUDIT_JS = open(os.path.join(DIR, "audit.js"), encoding="utf-8").read()
REPO = "/home/hatch/workspace/github/novel-reader"
MOM = open(os.path.join(REPO, "tests/fixtures/mom-2.4.json"), encoding="utf-8").read()

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
    port = 9455
    profile = "/tmp/visreg-preset"
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
            # 导入真实 MoM 预设并打开条目管理页
            pid = await c.ev(
                "(function(){var r=RP_PRESET.parseFile(" + json.dumps(MOM) +
                ");RP_PRESET.save(r.preset);renderStPresetEntries(r.preset.id);return r.preset.id;})()")
            await asyncio.sleep(1)
            fails = []
            # 1) 无横向溢出
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"横向溢出 scrollWidth={sw}")
            # 2) 开关触控区 >= 40px 高，且不超出右边界
            sw_info = await c.ev(
                "Array.prototype.map.call(document.querySelectorAll('.pswitch'),function(el){var r=el.getBoundingClientRect();return [r.width,r.height,r.right];}).slice(0,5)")
            for w, h, right in sw_info:
                if h < 39: fails.append(f"开关太小 {w}x{h}")
                if right > 361: fails.append(f"开关超右边界 right={right}")
            n_sw = await c.ev("document.querySelectorAll('.pswitch').length")
            if n_sw != 146: fails.append(f"开关数量 {n_sw} != 146")
            # 3) 条目名不横向溢出
            bad = await c.ev(
                "Array.prototype.filter.call(document.querySelectorAll('.spname'),function(el){return el.getBoundingClientRect().right>361;}).length")
            if bad: fails.append(f"{bad} 个条目名超右边界")
            # 4) audit.js 无严重重叠
            audit = await c.ev(AUDIT_JS)
            if audit.get("overlaps"): fails.append(f"audit overlaps={len(audit['overlaps'])}")
            # 截图：顶部 + 开关细节
            await c.shot("/tmp/preset_entries_top.png")
            # 点第一个开关，确认状态翻转且持久化
            before = await c.ev("document.querySelector('.pswitch').className")
            await c.ev("document.querySelector('.pswitch').click()")
            await asyncio.sleep(0.5)
            after = await c.ev("document.querySelector('.pswitch').className")
            if before == after: fails.append("开关点击无状态变化")
            # 进详情页截图：条目0是普通条目 -> 编辑器；找一个定位标记 -> 只读视图
            await c.ev("stPresetEntryDetail(" + json.dumps(pid) + ",0)")
            await asyncio.sleep(0.5)
            await c.shot("/tmp/preset_entry_detail.png")
            ed_ok = await c.ev("!!document.getElementById('pe_name') && !!document.getElementById('pe_content')")
            if not ed_ok: fails.append("普通条目编辑器缺失")
            midx = await c.ev("(function(){var p=RP_PRESET.get(%s);for(var i=0;i<p.prompts.length;i++)if(p.prompts[i].marker)return i;return -1;})()" % json.dumps(pid))
            if midx >= 0:
                await c.ev("stPresetEntryDetail(" + json.dumps(pid) + "," + str(midx) + ")")
                await asyncio.sleep(0.5)
                # 定位标记页：只读说明 + 开关，无内容编辑器
                has_hint = await c.ev("document.body.innerHTML.indexOf('定位标记是预设的占位符')")
                has_editor = await c.ev("!!document.getElementById('pe_content')")
                if has_hint < 0 or has_editor: fails.append("定位标记详情页异常")
                sw2 = await c.ev("document.documentElement.scrollWidth")
                if sw2 > 361: fails.append(f"标记详情页横向溢出 scrollWidth={sw2}")
            print("FAILS:", fails if fails else "none")
            return 1 if fails else 0
    finally:
        proc.kill(); subprocess.run(["rm", "-rf", profile])

sys.exit(asyncio.run(main()))
