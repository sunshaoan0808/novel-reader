#!/usr/bin/env python3
"""导入卡平等待遇 Phase2+3 视觉验证（360x800 无头 Chromium 真机视口）。

覆盖：
  B4  synthRunFor 给 imported 合成 run（novel/worldbook/relations）
  B9  导入卡聊天抽屉隐藏「章节进度」入口；蒸馏 run 保留
  B10 关系管理页导入卡显示解释性空态
  B11 portraitPrompt 导入卡外貌字段；无外貌时提示补填（不编造）
  B13/B14 loadWorldcard("imported") 短路无 404；无蓝图提示
  B15 魂穿锚点页导入卡降级为「从当前剧情自由开局」
截图全部落在 tests/visual/out/。
"""
import asyncio, base64, json, os, sys, urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(DIR, "out")
os.makedirs(OUT, exist_ok=True)
REPO = "/home/hatch/workspace/github/novel-reader"
PORT = 9493
URL = "file://" + REPO + "/www/index.html"

RAW_CARD = {
    "name": "沈砚", "tags": ["夜行录"],
    "description": "沈砚是当铺的年轻掌柜，说话简短，不轻易交底。",
    "personality": "冷淡、警觉",
    "scenario": "深夜的当铺，雨声敲窗。",
    "first_mes": "门没栓。当东西，还是当别的？",
    "mes_example": "<START>\n{{user}}: 我听说你这当铺收旧物？\n{{char}}: 收。但我只收干净的东西。",
    "character_book": {"name": "当铺志", "entries": [
        {"keys": ["铜铃"], "content": "铜铃是当铺的镇店之物，摇三声即有人来取货。",
         "enabled": True, "constant": False}]},
}
RAW_CARD_B = {
    "name": "白薇", "tags": ["青灯录"],
    "description": "白薇在药庐坐诊。",
    "personality": "沉静",
    "first_mes": "……抓药，还是问病？",
}

SEED = r"""
(function(){
  var a = RP_CARDIMPORT.normalizeTavern(%(cardA)s);
  a.fields = a.fields || {};
  a.fields.appearance_feature = "月白长衫，眉目清俊，左眉有一道浅疤。";
  var b = RP_CARDIMPORT.normalizeTavern(%(cardB)s);
  localStorage.setItem("nd_imported_cards", JSON.stringify([a, b]));
  try{ localStorage.setItem("nd_onboarded","1"); onboardDone(); }catch(e){}
  return "ok";
})()
"""

fails = []
def check(name, cond, detail=""):
    if cond: print("  PASS  %s" % name)
    else:
        print("  FAIL  %s  %s" % (name, detail)); fails.append(name)

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
        r = await self.send("Runtime.evaluate",
                            {"expression": js, "awaitPromise": await_promise, "returnByValue": True})
        res = r.get("result", {})
        if res.get("subtype") == "error":
            raise RuntimeError("page JS error: %s" % str(res.get("description", ""))[:400])
        return res.get("value")
    async def shot(self, path):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        open(path, "wb").write(base64.b64decode(r["data"]))

async def main():
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
                targets = json.loads(urllib.request.urlopen(
                    "http://127.0.0.1:%d/json" % PORT, timeout=5).read())
                break
            except Exception:
                await asyncio.sleep(0.5)
        if not targets:
            print("FAIL: 连不上 Chrome"); return 2
        page = [t for t in targets if t.get("type") == "page"][0]
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50*1024*1024) as ws:
            c = CDP(ws)
            await c.send("Page.enable")
            await c.send("Runtime.enable")
            await c.send("Emulation.setDeviceMetricsOverride",
                         {"width": 360, "height": 800, "deviceScaleFactor": 2, "mobile": True})
            await c.send("Page.navigate", {"url": URL})
            for _ in range(60):
                if await c.ev("document.readyState") == "complete":
                    break
                await asyncio.sleep(0.5)
            await asyncio.sleep(1.5)

            seed = SEED % {"cardA": json.dumps(RAW_CARD, ensure_ascii=False),
                           "cardB": json.dumps(RAW_CARD_B, ensure_ascii=False)}
            if await c.ev(seed) != "ok":
                print("FAIL: seed 失败"); return 2

            print("\n[B4] 合成 run 兜底")
            s = await c.ev("RP.synthRunFor('imported','沈砚')")
            check("synthRunFor(imported) novel=夜行录", s and s.get("novel") == "夜行录", json.dumps(s, ensure_ascii=False)[:200])
            check("synthRunFor(imported) worldbook 非空", s and isinstance(s.get("worldbook"), list) and len(s["worldbook"]) >= 1)
            check("synthRunFor(imported) relations=[]", s and s.get("relations") == [])
            check("synthRunFor(蒸馏run) 返回 null", await c.ev("RP.synthRunFor('honglou_full','林黛玉')") is None)

            print("\n[B9] 章节入口显隐")
            await c.ev("CHAT={mode:'single',runId:'imported',name:'沈砚',members:[],forcedSpeaker:null}; 1")
            await c.ev("(async()=>{ await showChat(); return 1; })()", True)
            await asyncio.sleep(1.0)
            await c.ev("toggleDrawer(true); 1")
            await asyncio.sleep(0.5)
            dt = await c.ev("document.getElementById('drawer').innerText")
            check("导入卡抽屉无「章节进度」", "章节进度" not in dt, dt[:200])
            # 滚抽屉到菜单区再截图（顶部是切换角色列表）
            await c.ev("(function(){var d=document.getElementById('drawer');"
                       "var b=[...d.querySelectorAll('button.ditem')].find(x=>x.innerText.indexOf('世界书管理')>=0);"
                       "if(b) d.scrollTop=b.offsetTop-120; return 1;})()")
            await asyncio.sleep(0.4)
            await c.shot(os.path.join(OUT, "shot_imported_parity_p23_drawer_imported.png"))
            await c.ev("document.getElementById('drawer').scrollTop=0; 1")
            await c.ev("CHAT={mode:'single',runId:'honglou_full',name:'林黛玉',members:[],forcedSpeaker:null}; 1")
            await c.ev("(async()=>{ await showChat(); return 1; })()", True)
            await asyncio.sleep(1.0)
            await c.ev("toggleDrawer(true); 1")
            await asyncio.sleep(0.5)
            dt2 = await c.ev("document.getElementById('drawer').innerText")
            check("蒸馏 run 抽屉保留「章节进度」", "章节进度" in dt2, dt2[:200])
            await c.ev("(function(){var d=document.getElementById('drawer');"
                       "var b=[...d.querySelectorAll('button.ditem')].find(x=>x.innerText.indexOf('章节进度')>=0);"
                       "if(b) d.scrollTop=b.offsetTop-200; return 1;})()")
            await asyncio.sleep(0.4)
            await c.shot(os.path.join(OUT, "shot_imported_parity_p23_drawer_distilled.png"))
            await c.ev("document.getElementById('drawer').scrollTop=0; 1")

            print("\n[B10] 关系管理页空态")
            await c.ev("CHAT={mode:'single',runId:'imported',name:'沈砚',members:[],forcedSpeaker:null}; 1")
            await c.ev("showRelManager(); window.scrollTo(0,0); 1")
            await asyncio.sleep(0.6)
            rt = await c.ev("document.getElementById('view').innerText")
            check("导入卡关系页解释性空态", "没有蒸馏出的静态关系" in rt, rt[:200])
            await c.shot(os.path.join(OUT, "shot_imported_parity_p23_relmanager.png"))

            print("\n[B15] 魂穿锚点自由开局")
            await c.ev("soulAnchors('imported','沈砚'); window.scrollTo(0,0); 1")
            await asyncio.sleep(0.6)
            st = await c.ev("document.getElementById('view').innerText")
            check("导入卡魂穿页有「自由开局」", "自由开局" in st, st[:200])
            sel = await c.ev("(function(){var r=document.querySelector('input[name=anchor]:checked');return r?r.value:'none';})()")
            check("自由开局默认选中", sel == "custom", sel)
            await c.shot(os.path.join(OUT, "shot_imported_parity_p23_soulanchors.png"))

            print("\n[B11] 立绘外貌")
            pp = await c.ev("portraitPrompt('imported','沈砚')")
            check("有外貌卡 prompt 含外貌文本", "月白长衫" in pp, pp[:200])
            pp2 = await c.ev("portraitPrompt('imported','白薇')")
            check("无外貌卡 prompt 外貌段留空不编造", "外貌：。" in pp2, pp2[:200])
            hint = await c.ev("portraitNoAppHint('imported','白薇')")
            check("无外貌卡给出补填提示", "appearance_feature" in hint and "不编造" in hint, hint[:150])
            check("有外貌卡不提示", await c.ev("portraitNoAppHint('imported','沈砚')") == "")
            await c.ev("document.getElementById('view').innerHTML='<div class=\"card\">'+portraitNoAppHint('imported','白薇')+'</div>'; window.scrollTo(0,0); 1")
            await asyncio.sleep(0.4)
            await c.shot(os.path.join(OUT, "shot_imported_parity_p23_portrait_hint.png"))

            print("\n[B13/B14] worldcard 短路 + 无蓝图提示")
            wc = await c.ev(
                "(function(){var n=0;var oc=document.createElement;"
                "document.createElement=function(t){var e=oc.call(document,t);"
                "if(String(t).toLowerCase()==='script'){var _s=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');"
                "try{Object.defineProperty(e,'src',{set:function(v){if(String(v).indexOf('worldcard_imported')>=0)n++;_s.set.call(this,v);},get:function(){return _s.get.call(this);},configurable:true});}catch(x){}}"
                "return e;};"
                "return loadWorldcard('imported').then(function(v){document.createElement=oc;return {v:v,n:n};});})()", True)
            check("loadWorldcard(imported) resolve null", wc and wc.get("v") is None, json.dumps(wc))
            check("零 worldcard_imported script 请求", wc and wc.get("n") == 0, json.dumps(wc))
            nb1 = await c.ev("noBlueprintNote('imported')")
            check("导入卡有无蓝图提示", isinstance(nb1, str) and len(nb1) > 0, nb1[:100])
            check("蒸馏 run 无提示", await c.ev("noBlueprintNote('honglou_full')") == "")

            print("\n==== %s ====" % ("全部通过" if not fails else "失败: " + ", ".join(fails)))
    finally:
        proc.terminate()
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
