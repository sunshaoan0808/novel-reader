/* 视觉回归测试的数据种子：灌 localStorage，打开聊天页即有可滚动的长历史。
基于 research_notes/ui-audit-20260930/seed.js，追加长消息保证 chatlog 可滚动。 */
(function(){
localStorage.clear();
localStorage.setItem("nd_onboarded","1");
try{ onboardDone();}catch(e){ var ob=document.getElementById("onboard"); if(ob) ob.remove();}
var now = Date.now();
var HK = "nd_chat_r1_林黛玉";
var long1 = "这句话很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长，用来测试气泡换行和溢出行为。";
var msgs = [
{role:"assistant", content:"宝玉，你可算来了。方才我正想着你呢，这几日身子略好些，已能下地走动了。", ts:now-86400000, mid:1},
{role:"user", content:"黛玉，听说你最近又咳了？药可有按时吃？", ts:now-86000000, mid:2},
{role:"assistant", content:"吃了，只是那药苦得很。紫鹃天天盯着我，倒像是我欠了她似的。其实我这病，一半是心病——你若常来陪我说说话，比什么药都灵。", ts:now-85000000, mid:3, rating:1},
{role:"user", content:"好，我以后每天都来。" + long1, ts:now-84000000, mid:4},
{role:"assistant", content:"那咱们可说定了。若你食言，我就把你送我的那方旧帕子剪了，哼。", ts:now-83000000, mid:5, rating:-1},
{role:"assistant", content:"夜色渐深，潇湘馆内烛火摇曳。", ts:now-82000000, mid:6, mtype:"narr"}
];
/* 追加足够长的历史，保证 chatlog 滚动高度 > 视口 + 隐藏阈值(140px) */
var extra = [
["user","宝玉笑道：\"妹妹这番话，却是说到我心坎里去了。\""+long1],
["assistant","黛玉听了，把脸一红，啐道：\"谁跟你说这些没正经的！\""+long1],
["user","我连忙赔笑道：\"好妹妹，是我说错了话，你只当没听见罢。\""+long1],
["assistant","黛玉叹道：\"你我这样的人家，竟连说句心里话都不容易。\""+long1],
["user","宝玉点头道：\"可不是么。老太太、太太跟前，俱是要装出样子的。\""+long1],
["assistant","正说着，紫鹃打起帘子进来，道：\"姑娘，药熬好了，趁热喝了吧。\""+long1],
["user","我接过药碗，闻着那苦味直皱眉：\"这药也忒苦了些。\""+long1],
["assistant","黛玉接过去，一饮而尽，苦得直皱眉，却笑道：\"良药苦口。\""+long1],
["user","窗外竹影摇曳，我轻声道：\"等你大好了，咱们去大观园里走走。\""+long1],
["assistant","黛玉眼中一亮，随即又黯淡下去：\"只怕我这身子，是走不动了。\""+long1],
["user","我急道：\"不许说这丧气话！大夫都说静养些日子便好。\""+long1],
["assistant","黛玉垂泪道：\"我这病，是打娘胎里带来的，哪里养得好。\""+long1]
];
extra.forEach(function(e, i){
msgs.push({role:e[0], content:e[1], ts:now-81000000+i*60000, mid:7+i});
});
localStorage.setItem(HK, JSON.stringify(msgs));
localStorage.setItem("nd_mem2_r1_林黛玉", JSON.stringify({short:[
{fact:"林黛玉葬花", view:"黛玉在大观园葬花，宝玉悄悄加入，两人第一次交心", time:"大观园时期", pin:true},
{fact:"宝玉挨打", view:"宝玉因金钏儿跳井之事被贾政打了板子，黛玉哭肿了眼睛", time:"第三十三回"}
], long:"", pinned:[], up_to_msg_id:6}));
localStorage.setItem("nd_lore_r1", JSON.stringify([
{name:"大观园", keys:["大观园","潇湘馆"], content:"贾府为元春省亲修建的别墅园林，黛玉住潇湘馆，宝玉住怡红院。", probability:100, priority:1, constant:false, inclusionGroup:"", groupWeight:1, minMessages:0, placement:"after_scenario", selectiveLogic:0, regex:false, matchWholeWords:true, caseSensitive:false}
]));
localStorage.setItem("nd_iron_r1_林黛玉", "你是林黛玉，言语尖刻但心地善良，多愁善感，体弱多病，绝不说现代网络用语。");
return "seeded:" + msgs.length + "msgs";
})()
