#!/usr/bin/env python3
"""视觉回归测试 runner：无头 Chromium + CDP，360x800 真机视口。

用例（TDD 还债：每个用例都能在对应 bug 代码上失败）：
  1. ctxbar-no-stray   顶栏上下文条无游离 0/NaN（v32 一元正号 bug）
  2. scroll-no-jitter   上滑看历史时流式输出/打字机不拽回底部（v33 抖动 bug）
  3. scroll-hidebars    上滑看历史进沉浸式(顶栏/底栏/场景条联动隐藏,正文补位无黑条)；只有滑到底才退出
  4. immersive-bg       沉浸式背景层/毛玻璃/呼吸动效
  5. bars-follow-bg     三栏背景跟随聊天壁纸主色；浅色壁纸时三栏文字转深（v39）
  6. bars-transition    三栏显隐 transform .3s 过渡已接线（v39）
  7. layout-no-overlap  关键页面 360x800 无文字重叠/横向溢出（抽样）

用法： bash tests/visual/run.sh
       WWW_URL=file:///tmp/buggy-www/index.html bash tests/visual/run.sh  # 对指定页面跑
"""
import argparse, asyncio, base64, json, os, subprocess, sys, time, urllib.request

import websockets

CHROME = "/opt/meta-chromium/chrome"
DIR = os.path.dirname(os.path.abspath(__file__))
SEED_JS = open(os.path.join(DIR, "seed.js"), encoding="utf-8").read()
AUDIT_JS = open(os.path.join(DIR, "audit.js"), encoding="utf-8").read()


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.iid = 0

    async def send(self, method, params=None):
        self.iid += 1
        await self.ws.send(json.dumps({"id": self.iid, "method": method,
                                       "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == self.iid:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})

    async def ev(self, js, await_promise=False):
        r = await self.send("Runtime.evaluate",
                            {"expression": js, "awaitPromise": await_promise,
                             "returnByValue": True})
        res = r.get("result", {})
        if res.get("subtype") == "error":
            raise RuntimeError("page JS error: %s" %
                               res.get("description", "")[:300])
        return res.get("value")

    async def shot(self, path):
        r = await self.send("Page.captureScreenshot", {"format": "png"})
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))


SHOW_CHAT = ('(async()=>{ CHAT={mode:"single",runId:"r1",name:"林黛玉"}; '
             'await showChat(); return "ok"; })()')


async def case_ctxbar(c):
    """顶栏 ctxbar：低占用不以游离 0 结尾；高占用警告条不被 NaN 吞掉。"""
    await c.ev(SHOW_CHAT, await_promise=True)
    await asyncio.sleep(0.6)
    js = '''(function(){
      var out = {};
      LAST_STATS = {sysTokens:800, histTokens:1200, maxCtx:8192, histKept:12,
                    loreHits:["大观园"]};
      renderCtxBar();
      var h1 = document.getElementById("ctxbar").innerHTML;
      var h1t = h1.trim();
      out.low = {tail0: />0$/.test(h1t), hasNaN: h1.indexOf("NaN") >= 0,
                 tail: h1t.slice(-12)};
      LAST_STATS = {sysTokens:4000, histTokens:4000, maxCtx:8192, histKept:40,
                    loreHits:[]};
      renderCtxBar();
      var h2 = document.getElementById("ctxbar").innerHTML;
      var h2t = h2.trim();
      out.high = {tail0: />0$/.test(h2t), hasNaN: h2.indexOf("NaN") >= 0,
                  hasWarn: /ctxwarn/.test(h2), tail: h2t.slice(-12)};
      return out;
    })()'''
    r = await c.ev(js)
    ok = (not r["low"]["tail0"] and not r["low"]["hasNaN"]
          and not r["high"]["tail0"] and not r["high"]["hasNaN"]
          and r["high"]["hasWarn"])
    return ok, r


async def case_jitter(c):
    """上滑看历史时：streamToken 打 5 个 token、打字机跑 500ms，scrollTop 必须稳定。"""
    await c.ev(SHOW_CHAT, await_promise=True)
    await asyncio.sleep(0.6)
    js = '''(async()=>{
      var log = document.getElementById("chatlog");
      if (log.scrollHeight - log.clientHeight < 150)
        return {skip: true, reason: "chatlog 不可滚动"};
      var msgs = document.querySelectorAll('#chatlog .msg[id^="smsg-"]');
      var lastAI = -1;
      for (var j = 0; j < msgs.length; j++)
        if (!msgs[j].classList.contains("me"))
          lastAI = parseInt(msgs[j].id.replace("smsg-", ""), 10);
      /* 先测打字机：在干净渲染上取真实 smsg-idx，避免 live 气泡干扰 */
      log.scrollTop = 60;
      await new Promise(function(r){ setTimeout(r, 200); });
      var s0 = log.scrollTop;
      var twRan = false;
      if (lastAI >= 0){
        twStart(lastAI, "打字机抖动测试文本，用于验证用户上滑看历史时不被拽回底部。", "");
        twRan = !!document.getElementById("smsg-" + lastAI);
      }
      await new Promise(function(r){ setTimeout(r, 500); });
      var s1 = log.scrollTop;
      twStop();
      /* 再测流式 token */
      log.scrollTop = 60;
      await new Promise(function(r){ setTimeout(r, 200); });
      var s2 = log.scrollTop;
      for (var i = 0; i < 5; i++){
        streamToken("抖动测试");
        await new Promise(function(r){ setTimeout(r, 80); });
      }
      var s3 = log.scrollTop;
      return {s0:s0, s1:s1, s2:s2, s3:s3, lastAI:lastAI, twRan:twRan,
              twDrift: Math.abs(s1 - s0), streamDrift: Math.abs(s3 - s2)};
    })()'''
    r = await c.ev(js, await_promise=True)
    if r.get("skip"):
        return False, r
    ok = r["twRan"] and r["twDrift"] < 4 and r["streamDrift"] < 4
    return ok, r


async def case_hidebars(c):
    """点按式沉浸（2026-10-09 v52 起）：正文全屏，点中间 toggles 顶底栏，滑动隐藏。
       二态切换，无跟手进度，无 transform 留白。
       注：headless 下一律轮询等待不用固定 sleep。
       注2：关打字机——种子用 Date.now() 时间戳，每次重进 TW.key 都对不上会重播打字机，
       异步改气泡高度干扰判定；打字机由 case_jitter 单独覆盖。"""
    await c.ev(SEED_JS)  # 用例隔离
    await c.ev("try{RP_TYPEWRITER.setEnabled(false);}catch(e){}")
    await c.ev(SHOW_CHAT, await_promise=True)
    await asyncio.sleep(1.0)
    js = '''(async()=>{
      var log = document.getElementById("chatlog");
      var head = document.getElementById("chathead");
      var bar = document.querySelector(".chatbar");
      var sim = document.getElementById("simbar");
      var out = {};
      var imm = function(){ return document.body.classList.contains("immersive"); };
      var barsHidden = function(){
        return (head.style.display === "none") && (bar.style.display === "none");
      };
      var barsShown = function(){
        return (head.style.display !== "none") && (bar.style.display !== "none");
      };
      /* 1) 初始：全屏沉浸，栏隐藏 */
      out.initHidden = barsHidden() && imm();
      /* 2) 点中间 -> 显示 */
      var rect = log.getBoundingClientRect();
      var cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
      /* 直接 dispatch click（target=log 本体） */
      var ev = new MouseEvent("click", {clientX: cx, clientY: cy, bubbles: true});
      /* 确保 target 是 log：找 log 内的空白处 */
      log.dispatchEvent(ev);
      await new Promise(function(r){ setTimeout(r, 300); });
      out.tapShown = barsShown() && !imm();
      /* 3) 滑动 -> 隐藏 */
      var maxST = log.scrollHeight - log.clientHeight;
      if(maxST < 100) return {skip: true, reason: "滚动空间不足"};
      log.scrollTop = maxST - 100;
      await new Promise(function(r){ setTimeout(r, 400); });
      out.scrollHidden = barsHidden() && imm();
      /* 4) 再点中间 -> 显示 */
      log.dispatchEvent(new MouseEvent("click", {clientX: cx, clientY: cy, bubbles: true}));
      await new Promise(function(r){ setTimeout(r, 300); });
      out.tapShown2 = barsShown() && !imm();
      return out;
    })()'''
    r = await c.ev(js, await_promise=True)
    if r.get("skip"):
        return False, r
    ok = r["initHidden"] and r["tapShown"] and r["scrollHidden"] and r["tapShown2"]
    await c.ev("try{RP_TYPEWRITER.setEnabled(true);}catch(e){}")
    return ok, r


async def case_layout(c):
    """抽样 3 个关键页：文字重叠 / 横向溢出必须为 0。"""
    pages = [
        ("chat", SHOW_CHAT),
        ("settings", '(function(){ showSettings(); return "ok"; })()'),
        ("traverse", '(function(){ showTraverse(); return "ok"; })()'),
    ]
    detail = {}
    ok = True
    for name, js in pages:
        try:
            await c.ev(js, await_promise=True)
        except Exception as e:
            detail[name] = {"renderError": str(e)[:150]}
            ok = False
            continue
        await asyncio.sleep(0.7)
        a = await c.ev(AUDIT_JS)
        page_ok = (len(a.get("overlaps", [])) == 0
                   and len(a.get("overflows", [])) == 0
                   and not (a.get("pageOverflow") or {}).get("overflow"))
        detail[name] = {"overlaps": len(a.get("overlaps", [])),
                        "overflows": len(a.get("overflows", [])),
                        "pageOverflow": (a.get("pageOverflow") or {}).get("overflow"),
                        "nLeaf": a.get("nLeaf"),
                        "overlapSample": a.get("overlaps", [])[:3],
                        "overflowSample": a.get("overflows", [])[:3]}
        if not page_ok:
            ok = False
    return ok, detail


async def case_immersive(c):
    """沉浸式聊天背景：全屏层存在、盖满视口、气泡有毛玻璃、呼吸动效未被降级关掉。"""
    await c.ev(SEED_JS)
    await c.ev(SHOW_CHAT, await_promise=True)
    await asyncio.sleep(1.0)
    r = await c.ev("""(function(){
      var bg = document.getElementById("chatbg"),
          layer = bg ? bg.querySelector(".bglayer") : null,
          shade = bg ? bg.querySelector(".bgshade") : null,
          bgr = bg ? bg.getBoundingClientRect() : null,
          vw = window.innerWidth, vh = window.innerHeight;
      var bub = document.querySelector(".bubble"),
          bstyle = bub ? getComputedStyle(bub) : null,
          head = document.getElementById("chathead"),
          hstyle = head ? getComputedStyle(head) : null,
          layerStyle = layer ? getComputedStyle(layer) : null;
      return {
        bgExists: !!bg, layerExists: !!layer, shadeExists: !!shade,
        full: !!(bgr && Math.abs(bgr.width - vw) < 2 && Math.abs(bgr.height - vh) < 2
                 && bgr.top <= 0 && bgr.left <= 0),
        bubbleBlur: bstyle ? (bstyle.backdropFilter || bstyle.webkitBackdropFilter || "") : "",
        headBlur: hstyle ? (hstyle.backdropFilter || hstyle.webkitBackdropFilter || "") : "",
        anim: layerStyle ? layerStyle.animationName : "",
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      };
    })()""")
    ok = (r["bgExists"] and r["layerExists"] and r["shadeExists"] and r["full"]
          and "blur" in r["bubbleBlur"] and "blur" in r["headBlur"]
          and (r["reduced"] or r["anim"] == "chatbreathe"))
    return ok, r



PINK_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGP4tOMYVsQwtCQA/0ycATrnON8AAAAASUVORK5CYII="

async def case_bars_follow_bg(c):
    """三栏跟随背景色: 纯粉色壁纸 -> 顶栏/世界条/底栏背景取粉色, 浅色模式文字转深。"""
    await c.ev(SEED_JS)
    await c.ev('(async()=>{ CHAT={mode:"single",runId:"r1",name:"林黛玉"}; '
              'await saveWallpaper("PINKPH"); await showChat(); return "ok"; })()'
              .replace("PINKPH", PINK_URL), await_promise=True)
    js = """(async()=>{
      var head=document.getElementById("chathead"),
          bar=document.querySelector(".chatbar"),
          sim=document.getElementById("simbar");
      var t0=Date.now(), ready=false;
      while(Date.now()-t0<6000){
        var bg=getComputedStyle(head).backgroundColor||"";
        if(bg.indexOf("242, 184, 198")>=0){ ready=true; break; }
        await new Promise(function(r){setTimeout(r,150);});
      }
      var cn=document.querySelector("#chathead .cname");
      return {
        ready:ready,
        headBg:getComputedStyle(head).backgroundColor,
        simBg:sim?getComputedStyle(sim).backgroundColor:"",
        barBg:getComputedStyle(bar).backgroundColor,
        light:document.body.classList.contains("bars-light"),
        cnameColor:cn?getComputedStyle(cn).color:""
      };
    })()"""
    r = await c.ev(js, await_promise=True)
    ok = (r["ready"] and "242, 184, 198" in r["simBg"]
          and "242, 184, 198" in r["barBg"] and r["light"]
          and r["cnameColor"] == "rgb(42, 32, 19)")
    return ok, r


async def case_bars_transition(c):
    """三栏显隐过渡: chathead/#simbar/.chatbar 的 transition 必须含 transform(.3s)。"""
    await c.ev(SEED_JS)
    await c.ev(SHOW_CHAT, await_promise=True)
    await asyncio.sleep(0.8)
    r = await c.ev("""(function(){
      function tr(sel){
        var el=document.querySelector(sel);
        return el ? (getComputedStyle(el).transition||"") : "missing";
      }
      return {head:tr("#chathead"), sim:tr("#simbar"), bar:tr(".chatbar")};
    })()""")
    ok = all(("transform" in (r[k] or "") and ".3s" in (r[k] or ""))
             for k in ("head", "bar")) and (r["sim"] == "missing" or "transform" in r["sim"])
    return ok, r


CASES = [
    ("ctxbar-no-stray", case_ctxbar),
    ("scroll-no-jitter", case_jitter),
    ("scroll-hidebars", case_hidebars),
    ("immersive-bg", case_immersive),
    ("bars-follow-bg", case_bars_follow_bg),
    ("bars-transition", case_bars_transition),
    ("layout-no-overlap", case_layout),
]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9444)
    ap.add_argument("--url", default="file:///home/hatch/workspace/github/novel-reader/www/index.html")
    ap.add_argument("--shots", default=os.path.join(DIR, "shots"))
    args = ap.parse_args()
    os.makedirs(args.shots, exist_ok=True)

    targets = None
    for _ in range(60):
        try:
            data = urllib.request.urlopen("http://127.0.0.1:%d/json" % args.port,
                                          timeout=5).read()
            targets = json.loads(data)
            break
        except Exception:
            await asyncio.sleep(0.5)
    if not targets:
        print("FAIL: 连不上 Chrome remote debugging (port %d)" % args.port)
        return 2
    page = [t for t in targets if t.get("type") == "page"][0]
    results = []
    async with websockets.connect(page["webSocketDebuggerUrl"],
                                  max_size=50 * 1024 * 1024) as ws:
        c = CDP(ws)
        await c.send("Page.enable")
        await c.send("Emulation.setDeviceMetricsOverride",
                     {"width": 360, "height": 800, "deviceScaleFactor": 2,
                      "mobile": True})
        await c.send("Page.navigate", {"url": args.url})
        for _ in range(60):
            if await c.ev("document.readyState") == "complete":
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(1.5)
        print("seed:", await c.ev(SEED_JS), flush=True)
        for name, fn in CASES:
            try:
                ok, detail = await fn(c)
            except Exception as e:
                ok, detail = False, {"error": str(e)[:300]}
            results.append({"name": name, "ok": bool(ok), "detail": detail})
            try:
                await c.shot(os.path.join(args.shots, name + ".png"))
            except Exception as e:
                print("截图失败 %s: %s" % (name, str(e)[:100]), flush=True)
            print("%s: %s" % (name, "PASS" if ok else "FAIL"), flush=True)
            if not ok:
                print("  detail: %s" % json.dumps(detail, ensure_ascii=False)[:600],
                      flush=True)
    log_path = os.path.join(DIR, "assert_log.json")
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump({"url": args.url, "results": results}, f,
                  ensure_ascii=False, indent=1)
    failed = [r["name"] for r in results if not r["ok"]]
    if failed:
        print("RESULT: FAIL (%d/%d) 失败项: %s"
              % (len(failed), len(results), ", ".join(failed)))
        return 1
    print("RESULT: PASS (%d/%d)" % (len(results), len(results)))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
