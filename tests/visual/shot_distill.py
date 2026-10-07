#!/usr/bin/env python3
"""蒸馏新UI视觉验证: 质量门/世界书/资料库/角色卡开场白"""
import asyncio, json, os, sys
import urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from runner import CDP

PORT = 9460
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
SHOT_DIR = "/tmp/distill_shots"

SEED = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
// 构造测试剧本包
var pkg = DISTILL_PACKAGE.createPackage("红楼梦测试");
pkg.characters = [{name:"林黛玉",aliases:["黛玉"],importance:9},{name:"贾宝玉",aliases:["宝玉"],importance:9}];
DISTILL_PACKAGE.updatePackage(pkg);
DISTILL_PACKAGE.saveCharacterCard(pkg.id, "林黛玉", {name:"林黛玉",
  description:"贾府小姐 [canon:ch001]",
  _distill:{core_identity:"贾府小姐 [canon:ch001]", core_traits:"多愁善感，眼中闪过泪光 [canon:ch002]",
    appearance:"美貌 [ref:ch003]", speech_style:"文雅 [inference]", background:"林家 [canon:ch004]",
    relationships_summary:"与宝玉 [ref:ch005]", key_events:"进贾府 [canon:ch006]", arc_summary:"成长 [inference]"}});
DISTILL_PACKAGE.saveData(pkg.id, "provenance", {facts:[
  {character:"林黛玉",field:"core_identity",value:"贾府小姐",source:"canon",chunk_id:"ch001"},
  {character:"林黛玉",field:"core_traits",value:"多愁善感",source:"canon",chunk_id:"ch002"},
  {character:"林黛玉",field:"appearance",value:"美貌",source:"unknown",chunk_id:null},
]});
DISTILL_PACKAGE.saveData(pkg.id, "worldbook", {
  rules:[{name:"天道规则",rule:"善恶有报，这是世界的基本法则",cost:"无",limit:"仅对凡人有效",
    exception:"仙人豁免",conflict_hook:"贾雨村会因此产生内心挣扎",source:"ch001"}],
  locations:[{name:"大观园",desc:"贾府的花园，年轻人的乐园",source:"ch002"}],
  factions:[{name:"贾府",desc:"四大家族之一",members:["贾母","贾政"],source:"ch001"}]
});
DISTILL_PACKAGE.saveData(pkg.id, "openings", {"林黛玉":[
  {situation:"初见",text:"你好，我是林黛玉。初次见面，请多关照。"},
  {situation:"日常",text:"今日天气不错，适合在窗前看书。"}
]});
window._testPkgId = pkg.id;
"ok";
"""

async def shot(c, name, js):
    await c.ev(js)
    await asyncio.sleep(0.8)
    r = await c.send("Page.captureScreenshot", {"format":"png"})
    import base64
    open(os.path.join(SHOT_DIR, name + ".png"), "wb").write(base64.b64decode(r["data"]))
    print("shot:", name)

async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
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
            if await c.ev(SEED) != "ok":
                print("FAIL: seed"); return
            # 1. 剧本包列表 (质量门)
            await shot(c, "1_package", "DISTILL_UI.show(); 'ok'")
            # 2. 打开包 (质量门报告)
            await shot(c, "2_pkgdetail", "DISTILL_UI.openPackage(window._testPkgId); 'ok'")
            # 3. 世界书
            await shot(c, "3_worldbook", "DISTILL_UI.showWorldbook(window._testPkgId); 'ok'")
            # 4. 资料库
            await shot(c, "4_library", "DISTILL_UI.showProvenance(window._testPkgId, '林黛玉'); 'ok'")
            # 5. 角色卡 (开场白)
            await shot(c, "5_character", "DISTILL_UI.openCharacter(window._testPkgId, '林黛玉'); 'ok'")
            print("DONE")
    finally:
        proc.terminate()

asyncio.run(main())
