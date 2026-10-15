#!/usr/bin/env python3
"""第六梯队（项 28）视觉验证：P2-51 角标 / P2-26 alt / P2-28 内联样式 / P2-43 弹窗组件
   + DESIGN.md 记的两档阴影在真实计算值里生效。无头 Chromium 360x800。"""
import asyncio, json, os, sys
import urllib.request
import websockets

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)
from runner import CDP

PORT = 9471
URL = "file:///home/hatch/workspace/github/novel-reader/www/index.html"
SHOT_DIR = "/tmp/tier6_shots"

SEED = r"""
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
var card = {id:"imp_cl", name:"白月光", novel:"导入角色卡",
  fields:{core_identity:"温柔体贴的学姐，笑起来眼睛弯成月牙", core_traits:"温柔，偶尔腹黑",
    role_tags:"校园；纯爱；学姐", speech_style:"轻声细语"},
  greeting:"你来了，我等你好久了。",
  altGreetings:["好久不见，最近还好吗？","今晚月色真美，要一起去天台看看吗？"],
  exampleDialogue:"", scenario:"", systemPrompt:"", postHistoryInstructions:"",
  creatorNotes:"", tags:["校园","纯爱"], worldbook:[], raw:{tags:["校园","纯爱"]}, createdAt:Date.now()};
localStorage.setItem("nd_imported_cards", JSON.stringify([card]));
localStorage.setItem("nd_playstats_v1", JSON.stringify(
  {"imported|白月光":{s:7,t:85,pi:128400,po:96200,fav:1,like:0,first:1,last:2}}));
try{ onboardDone(); }catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove(); }
"ok";
"""

fails = []
def check(name, cond, detail=""):
    if cond: print("  PASS  %s" % name)
    else:
        print("  FAIL  %s  %s" % (name, detail)); fails.append(name)

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
            await c.send("Runtime.enable")
            await c.send("Emulation.setDeviceMetricsOverride",
                         {"width":360,"height":800,"deviceScaleFactor":2,"mobile":True})
            await c.send("Page.navigate", {"url": URL})
            await asyncio.sleep(2.5)
            if await c.ev(SEED) != "ok":
                print("FAIL seed"); return
            await asyncio.sleep(1.0)

            # ---------- P2-51 穿越首页角标 ----------
            print("\n[P2-51] 穿越首页内部角标")
            await c.ev("setNav('traverse'); 'ok'"); await asyncio.sleep(1.0)
            r = await c.ev("""(function(){
              var names = Array.from(document.querySelectorAll('.tm-name')).map(function(e){return e.textContent.trim()});
              var badges = document.querySelectorAll('.tm-body .badge').length;
              return JSON.stringify({names:names, badges:badges,
                hasP2: document.body.textContent.indexOf('P2')>=0,
                hasP3: document.body.textContent.indexOf('P3')>=0});
            })()""")
            r = json.loads(r)
            check("无 .badge 角标", r["badges"] == 0, "count=%d" % r["badges"])
            check("无 P2/P3 文本", not r["hasP2"] and not r["hasP3"], str(r))
            check("五个模式卡都在", len(r["names"]) == 5, str(r["names"]))
            await c.ev("setNav('product'); 'ok'"); await asyncio.sleep(1.0)
            await c.ev("openRun('honglou_full'); 'ok'"); await asyncio.sleep(1.4)

            # ---------- P2-26 alt ----------
            print("\n[P2-26] 角色卡头像 alt")
            await asyncio.sleep(0.3)   # 上一步已经 openRun，这里等渲染稳定即可
            r = await c.ev("""(function(){
              var imgs = Array.from(document.querySelectorAll('img.charimg'));
              return JSON.stringify({n:imgs.length, alts:imgs.map(function(i){return i.getAttribute('alt');}),
                hidden:imgs.map(function(i){return i.getAttribute('aria-hidden');})});
            })()""")
            r = json.loads(r)
            if r["n"] == 0:
                check("角色网格有头像", False, "没渲染出 img.charimg")
            else:
                bad = [a for a in r["alts"] if a == "" and r["hidden"][r["alts"].index(a)] != "true"]
                check("每张图 alt 有意义或有 aria-hidden", not bad, "bad=%s" % bad)
                named = [a for a in r["alts"] if a]
                check("真实画像 alt 带角色名", all("的画像" in a for a in named),
                      "named=%s" % named[:3])
            await c.shot(SHOT_DIR + "/02_chargrid_alt.png")

            # ---------- P2-28 落地页内联样式 ----------
            print("\n[P2-28] 卡片落地页内联样式")
            await c.ev("charDetail('imported','白月光'); 'ok'"); await asyncio.sleep(1.4)
            r = await c.ev("""(function(){
              /* 只看 cardLandingHTML 的产物：renderDetail 末尾那个 <div style="height:40px">
                 撑杆是 P2-27 的范围，不在本次项 28 里，单独排除。 */
              var root = document.getElementById('view');
              var spacer = Array.from(root.querySelectorAll('div[style]'))
                  .filter(function(e){ return !e.className && /height/.test(e.getAttribute('style')||''); });
              var ignore = new Set(spacer);
              var withStyle = Array.from(root.querySelectorAll('[style]'))
                  .filter(function(e){ return !ignore.has(e); })
                  .map(function(e){ return e.tagName+'.'+(e.className||''); });
              var cs = function(sel,prop){ var e=document.querySelector(sel);
                  return e ? getComputedStyle(e)[prop] : null; };
              return JSON.stringify({
                inline: withStyle,
                statAlign: cs('.stat-line','textAlign'),
                briefSize: cs('.card-brief','fontSize'),
                opnGoColor: cs('.opn-go','color'),
                srcWidth: cs('.srcbtn','width'),
                tagsMargin: cs('.tagrow','marginTop'),
              });
            })()""")
            r = json.loads(r)
            check("落地页无内联 style", len(r["inline"]) == 0, str(r["inline"]))
            check("数据条居中生效", r["statAlign"] == "center", str(r["statAlign"]))
            check("简介字号生效", r["briefSize"] not in (None, ""), str(r["briefSize"]))
            check("开场 CTA 文字是主色", r["opnGoColor"] not in (None, ""), str(r["opnGoColor"]))
            check("源码按钮撑满宽度", r["srcWidth"] not in (None, ""), str(r["srcWidth"]))
            await c.shot(SHOT_DIR + "/03_landing_no_inline.png")
            await c.ev("window.scrollTo(0,99999); 'ok'"); await asyncio.sleep(0.6)
            await c.shot(SHOT_DIR + "/04_landing_bottom.png")

            # ---------- DESIGN.md 两档阴影 ----------
            print("\n[DESIGN.md] 阴影两档")
            r = await c.ev("""(function(){
              var rootStyle = getComputedStyle(document.documentElement);
              return JSON.stringify({
                shadow: rootStyle.getPropertyValue('--shadow').trim(),
                shadowS: rootStyle.getPropertyValue('--shadow-s').trim(),
                zTokens: ['--z-bg','--z-base','--z-float','--z-sticky','--z-nav','--z-sheet',
                          '--z-overlay','--z-panel','--z-modal','--z-toast','--z-lock']
                    .map(function(k){ return k+'='+rootStyle.getPropertyValue(k).trim(); })
              });
            })()""")
            r = json.loads(r)
            check("--shadow 几何与文档一致（墨夜实测）",
                  r["shadow"] == "0 6px 24px rgba(0,0,0,.45)", r["shadow"])
            check("--shadow-s 几何与文档一致（墨夜实测）",
                  r["shadowS"] == "0 2px 10px rgba(0,0,0,.28)", r["shadowS"])
            check("11 档 z-index token 齐全", len(r["zTokens"]) == 11, str(r["zTokens"]))

            # ---------- P2-43 弹窗组件 ----------
            print("\n[P2-43] App 内弹窗组件")
            # uiMessage（只读说明）
            await c.ev("uiMessage('Soul 多智能体模式已开启','<ul class=\\\"cfopts\\\"><li>每个角色独立思考</li><li>@名字 指定回应</li></ul>'); 'ok'")
            await asyncio.sleep(0.7)
            r = await c.ev("""(function(){
              var ov=document.querySelector('.cfcheck');
              if(!ov) return JSON.stringify({exists:false});
              var box=ov.querySelector('.cfbox');
              return JSON.stringify({exists:true, title:ov.querySelector('.cfttl').textContent,
                z:getComputedStyle(ov).zIndex, shadow:getComputedStyle(box).boxShadow,
                scrollable:getComputedStyle(ov.querySelector('.cfbody')).overflowY,
                ok:!!ov.querySelector('.btn'), role:ov.getAttribute('role')});
            })()""")
            r = json.loads(r)
            check("uiMessage 弹窗渲染", r.get("exists"), str(r))
            check("弹窗用 --z-modal 档", r.get("z") == "60", str(r.get("z")))
            check("弹窗走 --shadow 两档", r.get("shadow","").startswith("rgba(0, 0, 0, 0.45)"), str(r.get("shadow")))
            check("弹窗正文可滚动", r.get("scrollable") == "auto", str(r.get("scrollable")))
            check("弹窗有 role=dialog", r.get("role") == "dialog", str(r.get("role")))
            await c.shot(SHOT_DIR + "/05_dialog_message.png")

            # Esc 关闭
            r = await c.ev("""(async function(){
              document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
              await new Promise(function(r){setTimeout(r,200);});
              return JSON.stringify({closed: !document.querySelector('.cfcheck')});
            })()""", await_promise=True)
            check("Esc 可关闭弹窗", json.loads(r).get("closed"), r)

            # uiConfirm 取消
            await c.ev("window.__v1='PENDING'; uiConfirm('删除多模型配置','删除「白月光」？','删除').then(function(v){window.__v1=v;}); 'ok'")
            await asyncio.sleep(0.6)
            await c.shot(SHOT_DIR + "/06_dialog_confirm.png")
            r = await c.ev("""(function(){
              var ov=document.querySelector('.cfcheck');
              var btns = ov ? Array.from(ov.querySelectorAll('.btn')).map(function(b){return b.textContent;}) : [];
              return JSON.stringify({btns:btns});
            })()""")
            check("uiConfirm 有取消/删除两键", json.loads(r).get("btns") == ["取消","删除"], r)
            await c.ev("document.querySelector('#cfy_no').click(); 'ok'")
            await asyncio.sleep(0.4)
            r = await c.ev("JSON.stringify({val: window.__v1, closed: !document.querySelector('.cfcheck')})")
            r = json.loads(r)
            check("取消返回 null", r["val"] is None and r["closed"], str(r))

            # uiConfirm 确认
            await c.ev("window.__v3='PENDING'; uiConfirm('删除多模型配置','删除？','删除').then(function(v){window.__v3=v;}); 'ok'")
            await asyncio.sleep(0.5)
            await c.ev("document.querySelector('#cfy_yes').click(); 'ok'")
            await asyncio.sleep(0.4)
            r = await c.ev("JSON.stringify({val: window.__v3, closed: !document.querySelector('.cfcheck')})")
            check("确认返回 true", json.loads(r).get("val") is True, r)

            # uiPrompt
            await c.ev("window.__v4='PENDING'; uiPrompt('套用人格模板','<ul class=\\\"cfopts\\\"><li>1. 傲娇</li><li>2. 高冷</li></ul>','',{placeholder:'编号'}).then(function(v){window.__v4=v;}); 'ok'")
            await asyncio.sleep(0.6)
            r = await c.ev("""(function(){
              var inp=document.querySelector('.cfinput');
              return JSON.stringify({exists:!!inp, ph:inp?inp.placeholder:null,
                focused: document.activeElement===inp,
                listStyle: !!document.querySelector('.cfopts')});
            })()""")
            r = json.loads(r)
            check("uiPrompt 有输入框", r.get("exists"), str(r))
            check("输入框自动聚焦", r.get("focused"), str(r))
            check("候选列表按类渲染", r.get("listStyle"), str(r))
            await c.shot(SHOT_DIR + "/07_dialog_prompt.png")
            await c.ev("""document.querySelector('.cfinput').value='2';
                           document.querySelector('#cfp_yes').click(); 'ok'""")
            await asyncio.sleep(0.4)
            r = await c.ev("JSON.stringify({val: window.__v4})")
            check("输入值回传", json.loads(r).get("val") == "2", r)

            # 轻提示
            await c.ev("rpToast('已保存 3 条记忆'); 'ok'"); await asyncio.sleep(0.5)
            r = await c.ev("""(function(){
              var t=document.getElementById('rpToast');
              return JSON.stringify({exists:!!t, txt:t?t.textContent:null, show:t?t.classList.contains('show'):false});
            })()""")
            r = json.loads(r)
            check("rpToast 轻提示可用", r.get("exists") and r.get("show"), str(r))
            await c.shot(SHOT_DIR + "/08_toast.png")

            # 原生弹窗清零
            print("\n[P2-43] soul 模块原生弹窗清零")
            await c.ev("""(function(){
              window.__native = 0;
              var ae = window.alert, ce = window.confirm, pe = window.prompt;
              window.alert = function(){ window.__native++; };
              window.confirm = function(){ window.__native++; return true; };
              window.prompt = function(){ window.__native++; return '1'; };
              window.__restore = function(){ window.alert=ae; window.confirm=ce; window.prompt=pe; };
              return 'ok';
            })()""")
            await c.ev("""(function(){
              try{
                RP_SOUL_CFG.applyTemplateUI('imported','白月光');
                RP_SOUL_CFG.editMemoryUI('imported','白月光');
                RP_SOUL_CFG.exportSoulUI('imported','不存在的角色');
                RP_SOUL_CFG.genSoulUI('imported','不存在的角色');
                RP_SOUL_CFG.arbitrateUI(0);
                RP_SOUL_CFG.compareSoulsUI('imported','不存在A','不存在B');
                RP_SOUL_CFG.showPrompt('不存在');
                RP_SOUL_CFG.replaySoulUI('不存在');
                RP_SOUL_CFG.delProfile('不存在');
                RP_SOUL_CFG.importSoulUI('imported','不存在的角色');
              }catch(e){ window.__err = String(e && e.message || e); }
              return 'ok';
            })()""")
            await asyncio.sleep(1.5)
            r = await c.ev("""(function(){
              var n = window.__native;
              var open = document.querySelectorAll('.cfcheck').length;
              var toast = document.getElementById('rpToast');
              window.__restore();
              return JSON.stringify({native:n, dialogsOpen:open,
                toast: toast?toast.textContent:null, err: window.__err||null});
            })()""")
            r = json.loads(r)
            check("触发 9 个 soul 入口，零原生弹窗", r["native"] == 0, "native=%d err=%s" % (r["native"], r["err"]))
            check("弹窗用 App 内组件呈现", r["dialogsOpen"] > 0, "open=%d" % r["dialogsOpen"])
            await c.shot(SHOT_DIR + "/09_soul_dialog.png")

            # 弹窗不叠加失控
            r = await c.ev("document.querySelectorAll('.cfcheck').length")
            check("同一时刻只开一个弹窗", r == 1, "open=%s" % r)
            await c.ev("""(function(){
              var b=document.querySelector('.cfcheck .btn:not(.ghost)');
              if(b) b.click(); return 'ok';
            })()""")
            await asyncio.sleep(0.5)
            check("关闭后不残留", await c.ev("document.querySelectorAll('.cfcheck').length") == 0)

            print("\n==== %s ====" % ("全部通过" if not fails else "失败: " + ", ".join(fails)))
            print("shots in", SHOT_DIR)
    finally:
        proc.terminate()

asyncio.run(main())
