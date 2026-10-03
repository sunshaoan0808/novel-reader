#!/usr/bin/env python3
"""ST 任意组合新 UI 360x800 视觉检查：新增条目/排序按钮/编辑页/聊天注入徽标。"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

CHROME = "/opt/meta-chromium/chrome"
DIR = os.path.dirname(os.path.abspath(__file__))
SEED_JS = open(os.path.join(DIR, "seed.js"), encoding="utf-8").read()
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
    port = 9456
    profile = "/tmp/visreg-compose"
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
            pid = await c.ev(
                "(function(){var r=RP_PRESET.parseFile(" + json.dumps(MOM) +
                ");RP_PRESET.save(r.preset);renderStPresetEntries(r.preset.id);return r.preset.id;})()")
            await asyncio.sleep(1)
            fails = []
            # 1) 新增条目按钮存在
            addbtn = await c.ev("document.body.innerHTML.indexOf('新增自定义条目')")
            if addbtn < 0: fails.append("新增条目按钮缺失")
            # 2) 每行有上移/下移按钮，不超右边界
            sbtns = await c.ev(
                "Array.prototype.map.call(document.querySelectorAll('.sbtn'),function(el){var r=el.getBoundingClientRect();return [r.right,r.height];})")
            if not sbtns: fails.append("排序按钮缺失")
            for right, h in sbtns[:10]:
                if right > 361: fails.append(f"排序按钮超右边界 right={right}")
                if h < 30: fails.append(f"排序按钮太小 h={h}")
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"条目页横向溢出 scrollWidth={sw}")
            await c.shot("/tmp/compose_entries.png")
            # 3) 点新增条目，进编辑页
            await c.ev("stPresetAddEntry(" + json.dumps(pid) + ")")
            await asyncio.sleep(0.8)
            for fid in ["pe_name", "pe_role", "pe_pos", "pe_depth", "pe_content"]:
                if not await c.ev("!!document.getElementById('%s')" % fid):
                    fails.append(f"编辑页字段缺失 {fid}")
            sw = await c.ev("document.documentElement.scrollWidth")
            if sw > 361: fails.append(f"编辑页横向溢出 scrollWidth={sw}")
            await c.shot("/tmp/compose_editor.png")
            # 4) 填内容：聊天注入深度2，保存后回列表看徽标
            await c.ev("""(function(){
              document.getElementById('pe_name').value='测试注入';
              document.getElementById('pe_content').value='记住：你是猫娘';
              var sel=document.getElementById('pe_pos'); sel.value='chat';
              sel.dispatchEvent(new Event('change'));
              document.getElementById('pe_depth').value='2';
            })()""")
            await asyncio.sleep(0.3)
            vis = await c.ev("document.getElementById('pe_depthrow').style.display")
            if vis == "none": fails.append("深度行未随位置切换显示")
            await c.ev("stPresetSaveEntry(" + json.dumps(pid) + "," + str(await c.ev(
                "(function(){var p=RP_PRESET.get(%s);return p.prompts.length-1;})()" % json.dumps(pid))) + ")")
            await asyncio.sleep(0.8)
            badge = await c.ev("document.body.innerHTML.indexOf('聊天注入·深度2')")
            if badge < 0: fails.append("聊天注入徽标未出现")
            await c.shot("/tmp/compose_badge.png")
            # 5) 排序：把最后一条上移一位，顺序变化
            order0 = await c.ev("(function(){var p=RP_PRESET.get(%s);return p.prompts.map(function(e){return e.name;}).join(',');})()" % json.dumps(pid))
            await c.ev("stPresetMoveEntry(" + json.dumps(pid) + "," + str(await c.ev(
                "(function(){var p=RP_PRESET.get(%s);return p.prompts.length-1;})()" % json.dumps(pid))) + ",-1)")
            await asyncio.sleep(0.5)
            order1 = await c.ev("(function(){var p=RP_PRESET.get(%s);return p.prompts.map(function(e){return e.name;}).join(',');})()" % json.dumps(pid))
            if order0 == order1: fails.append("上移排序未生效")
            # 6) 删除刚加的条目（headless 下 confirm 会阻塞，直接调底层 API 验证逻辑）
            idx = await c.ev("(function(){var p=RP_PRESET.get(%s);for(var i=0;i<p.prompts.length;i++)if(p.prompts[i].name==='测试注入')return i;return -1;})()" % json.dumps(pid))
            await c.ev("RP_PRESET.deleteEntry(%s,%d)" % (json.dumps(pid), idx))
            gone = await c.ev("(function(){var p=RP_PRESET.get(%s);return p.prompts.some(function(e){return e.name==='测试注入';});})()" % json.dumps(pid))
            if gone: fails.append("删除条目未生效")
            print("FAILS:", fails if fails else "none")
            return 1 if fails else 0
    finally:
        proc.kill(); subprocess.run(["rm", "-rf", profile])

sys.exit(asyncio.run(main()))
