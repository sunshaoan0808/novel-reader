#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0-3 任务 1: 十人物弧光写回数据。

把 ~/workspace/your_files/honglou-character-arcs/*.md 凝练后的弧光
写回 www/data/rp_cards_honglou_full.json 与 www/data.js
(data.js 为单行 window.__DATA__=...; , 用 JSON round-trip 原位更新)。

凝练原则: arc_start/arc_end <=150 字; arc_mid 每点一句话; timeline_stage
取文档内容推断的最适合开聊的 RP 阶段。凝练文本由人工从弧光文档逐份
整理, 非逐字摘录。

用法: python3 tools/arc_writeback.py   (在仓库根目录运行)
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(REPO, "www", "data", "rp_cards_honglou_full.json")
DATAJS_PATH = os.path.join(REPO, "www", "data.js")

# name -> {arc_type, arc_start, mids[list], arc_end, timeline_stage}
ARCS = {
    "林黛玉": {
        "arc_type": "fall",
        "timeline_stage": "大观园诗社时期",
        "arc_start": "黛玉入府之初，多心敏感、冷面妒意，以反话影射伤人；诗成即焚不欲人见，心事深藏、伤春自怜易垂泪，是恋爱婚姻悲剧的主线当事人。",
        "mids": [
            "宝钗赠燕窝推心相待，黛玉旧疑尽释，由多心妒疑转为宽厚待人，结为金兰契。",
            "第八十九回窃闻宝玉定亲之讯，立意绝粒拒药，由宽厚自处转为自弃。",
            "沁芳桥畔从傻大姐处泄出宝玉将娶宝钗之说，黛玉登时神思散乱、迷了本性。",
            "与宝玉相对痴笑后至潇湘馆门口吐血栽倒，病势倾颓至不能言。",
            "宝玉成婚同辰气绝，情竭而死收束全弧。",
        ],
        "arc_end": "窃闻宝玉定亲即绝粒拒药，闻泄讯迷本性、相对痴笑吐血，宝玉成婚同辰气绝；临终焚去旧日诗稿，弥留紧攥紫鹃之手、话至「好」字气绝，嘱送柩回南。",
    },
    "贾宝玉": {
        "arc_type": "awakening",
        "timeline_stage": "大观园时期",
        "arc_start": "衔玉而生，周岁抓周只取脂粉钗环，被贾政断为酒色之徒；只在闺阁厮混的荣府公子，对世俗功名毫无兴致。",
        "mids": [
            "掉包娶宝钗、黛玉病逝，失玉神昏；哭灵寻黛玉、还魂病愈，会癞和尚强还通灵玉，仙缘之念日坚。",
            "出家之念已定而赴考在即，佯作攻书用功以安妻母，赴考前跪辞王夫人许诺「中举报母」。",
            "陵驿雪夜贾政亲见宝玉披大红猩猩毡斗篷下拜，随一僧一道登岸而去，俗缘已毕。",
        ],
        "arc_end": "佯作攻书以安妻母，赴考中第七名举人；陵驿雪夜拜父四拜后随僧道出世，由痴入悟、俗缘已毕。",
    },
    "薛宝钗": {
        "arc_type": "flat",
        "timeline_stage": "大观园诗社时期",
        "arc_start": "开篇仅以恋爱婚姻悲剧主线人物被点名；寄居贾府后行事周全、暗中施恩而不留痕迹，是受王夫人托付的「妥当人」。",
        "mids": [
            "由序言提及的悲剧主线人物，转为寄居贾府、受王夫人托付监察家务的行事周全「妥当人」。",
            "掉包计中成为新妇，婚姻成而人未得，以理节情。",
            "家运多艰、母老兄祸中独力忧劳；闻宝玉出走哭得人事不知，转而端庄劝慰王夫人。",
        ],
        "arc_end": "家运多艰、母老兄祸中独力忧劳的持家新妇；闻宝玉随僧道去哭得人事不知，痛哭后即转而端庄劝慰王夫人，至痛仍以理节情。",
    },
    "王熙凤": {
        "arc_type": "fall",
        "timeline_stage": "协理宁国府时期",
        "arc_start": "荣府抢先张罗、样样先料的当家少奶奶，出入华贵排场，一心做上头头一个得力讨好的人，强势干练、杀伐果决。",
        "mids": [
            "怀哥儿六七个月小产，添下红之症卧床不起，由强力当家转为病中失位、只能遥控家务。",
            "贾母卒后内宅失盗，失盗次日扶病看家，权柄与身体同时垮掉。",
            "病入膏肓、众冤魂缠绕夜不敢安，被贾琏与上头冷落，低声褪下金镯托刘姥姥代为祷告，并将性命和巧姐一并托付。",
            "弥留整夜哭喊要船要轿，至四更咽气，死亡终结一切权柄与体面。",
        ],
        "arc_end": "扶病看家至沉疴不起，病榻见鬼、被上头冷落，临终托孤于刘姥姥；弥留整夜哭喊至四更咽气，棺木由贾蓉送往金陵安葬，身后旧班星散。",
    },
    "贾母": {
        "arc_type": "flat",
        "timeline_stage": "大观园时期",
        "arc_start": "经冷子兴演说转述的荣国府太夫人，以把宝玉当命根、极爱孙女闻名；慈厚诙谐、重体统的当家尊长。",
        "mids": [
            "由冷子兴转述的太夫人，转为溺爱宝玉、千叮咛万嘱咐托人照护黛玉的慈厚当家尊长。",
            "临终坐起把儿孙逐一唤至床前拉手叮嘱「我的儿，你要争气才好」，慈嘱与嗔怨并出，含笑而逝。",
            "灵柩归金陵安葬，被贾政叹为因疼爱而养育宝玉十九年，始终以他人之口成其形象。",
        ],
        "arc_end": "临终慈嘱与嗔怨并出的八十三岁老祖宗，含笑而逝；身后灵柩归金陵安葬，被贾政叹为因疼爱而养育宝玉十九年。",
    },
    "王夫人": {
        "arc_type": "awakening",
        "timeline_stage": "黛玉入府时期",
        "arc_start": "以当家主母身份接见黛玉、依礼法规训晚辈，对宝玉之患只以「孽根祸胎」式嗔怪遮掩而不深究，循规蹈矩、慈而不深。",
        "mids": [
            "金钏投井后裁例给玉钏、又自出月例银两给袭人，施银必指明生路，由规训遮掩转向施恩抚恤。",
            "贾政笞挞宝玉几乎致死时横身救护，当众垂泪哭诉「打坏了将来我靠谁」，护子之情压过主母仪体。",
            "被贾母当众错怪「盘算我」时受屈隐忍、以退让换转圜，不再出言整饬。",
            "处置袭人去留时自陈「怕再害一个人」，托薛姨妈暗中探意愿、查实再行，以「不害人」的底线取代依例直办。",
        ],
        "arc_end": "以隐忍克制维系家宅，处置下人必先探意愿、查实再行；「怕再害一个人」的自疚压过旧日的礼法决断，在金钏之死、笞子、错怪中醒来的母亲。",
    },
    "袭人": {
        "arc_type": "fall",
        "timeline_stage": "怡红院时期",
        "arc_start": "贾母拨给宝玉的贴身大丫鬟，忠心尽职、悄然照料，对宝玉的乖僻每每规谏，却因此心中着实忧郁。",
        "mids": [
            "宝玉挨打后含泪看伤、向王夫人进言深合其心，王夫人许「把他交给你了」，由贾母旧婢转为王夫人心腹。",
            "风闻「宝玉若不回来，便要打发屋里的人都出去」，急怒攻心、心痛气厥，由房中有体面的贴身人骤沦为名分悬空的弃置者。",
            "奉王夫人之命外嫁蒋家，薛姨妈、宝钗以大义相劝，怀死志而不得死，把决断一再往后拖。",
            "嫁到蒋家见姑爷正是蒋玉菡、见旧日系的汗巾信姻缘前定，死心既明而死无所就，安心留下。",
        ],
        "arc_end": "始终未过明路、名分悬空，宝玉出走后奉命外嫁蒋家；怀必死之心而屡以「不害人」自止，见汗巾信姻缘前定后柔顺认命。",
    },
    "晴雯": {
        "arc_type": "fall",
        "timeline_stage": "怡红院时期",
        "arc_start": "出场仅为宝玉房中四个并列贴身丫鬟之一，无任何外貌、言语、心理或行为描写，默默无闻。",
        "mids": [
            "雀金裘烧眼无人能补，晴雯正受凉病重，挣命坐起披衣织补至四更天独力补成，以拼命换下宝玉急事。",
            "被王夫人以「狐狸精」之名斥为「轻狂样儿」下令撵逐出园，病重四五日水米不沾、从炕上被架走，由得宠近婢沦为垂死之人。",
            "宝玉私探诀别，晴雯自知必死、有冤无处诉，铰下两根指甲、互换旧红绫袄与宝玉作别，剪甲换袄留死证明志。",
            "宝玉魂游幻境，晴雯奉妃子之命前来引路，只作引路人不叙旧情。",
        ],
        "arc_end": "被诬「狐狸精」撵出园后病死于姑舅哥哥家；死前剪甲换袄留证明志，身后被传为芙蓉花神。",
    },
    "刘姥姥": {
        "arc_type": "rise",
        "timeline_stage": "二进荣国府时期",
        "arc_start": "女婿家冬事无着，自认是个不配登门的穷姥姥，舍着老脸投奔荣国府求一条活路。",
        "mids": [
            "女婿狗儿家业萧条、冬事未办，天未明便梳洗动身进城，舍老脸进府求援，从在家空愁变为主动碰机会。",
            "门人初则不理，经旧恩周瑞家的念旧引荐得见凤姐，忍耻开口陈情，得二十两银并一吊钱。",
            "二进荣府送瓜果，获贾母留住赐座赐菜，凤姐鸳鸯设局劝杯取笑，从求告者转为受府中喜爱留住的席上客人。",
            "贾府离散、巧姐被逼亲，闻讯即出「扔崩一走」之计收留巧姐；凤姐病危中托命托女，由受恩者转为受恩重托的干妈。",
            "巧姐与周家亲事议定，贾琏请她入府，周家求配当场应承做媒，重金坚辞不受，说吉语贺府中复兴。",
        ],
        "arc_end": "由受惠者转为受托者与回报者，收留并送归干女儿巧姐、应承亲事、说吉语贺府中复兴，恩义两全。",
    },
    "秦钟": {
        "arc_type": "fall",
        "timeline_stage": "家塾读书时期",
        "arc_start": "清寒少年初入宁府，与宝玉初会即互生倾慕，一心求一二知己为伴、读书进益。",
        "mids": [
            "与香怜的私语被金荣撞破并当众讥嘲，告状讨没趣后讪讪退避，在学中自此无颜自处。",
            "水月庵与智能私会之事被撞破宣扬，被拿住短处即连声告饶许尽条件，遮掩不成反致身败家破。",
            "智能败露致秦业因己气绝，秦钟悔痛卧床、病笃奄奄一息，央求鬼判放回只为再见宝玉一面，临终尽弃前念改劝功名。",
        ],
        "arc_end": "私情败露、老父气死，病笃中自认见识全误；央求鬼判放回见宝玉最后一面，劝「以后还该立志功名」后长叹而逝。",
    },
}


def arc_fields(name):
    a = ARCS[name]
    return {
        "arc_type": a["arc_type"],
        "arc_start": a["arc_start"],
        "arc_mid": "；".join(a["mids"]),
        "arc_end": a["arc_end"],
        "timeline_stage": a["timeline_stage"],
    }


def apply_to_cards(cards):
    updated = []
    for c in cards:
        nm = c.get("name")
        if nm in ARCS:
            f = c.setdefault("fields", {})
            f.update(arc_fields(nm))
            updated.append(nm)
    return updated


def main():
    # 字数守卫
    for nm, a in ARCS.items():
        assert len(a["arc_start"]) <= 150, (nm, "arc_start", len(a["arc_start"]))
        assert len(a["arc_end"]) <= 150, (nm, "arc_end", len(a["arc_end"]))
        assert a["arc_type"] in ("fall", "awakening", "rise", "flat"), nm
        assert a["timeline_stage"], nm
        assert a["mids"], nm

    # 1) rp_cards_honglou_full.json
    with open(JSON_PATH, encoding="utf-8") as f:
        cards = json.load(f)
    assert isinstance(cards, list) and len(cards) == 10, len(cards)
    u1 = apply_to_cards(cards)
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("json 更新:", len(u1), "卡:", ",".join(u1))

    # 2) data.js (单行 window.__DATA__=...;)
    raw = open(DATAJS_PATH, encoding="utf-8").read().strip()
    assert raw.startswith("window.__DATA__=") and raw.endswith(";"), "data.js 头尾异常"
    data = json.loads(raw[len("window.__DATA__="):-1])
    dcards = data["rp_cards"]["honglou_full"]
    assert len(dcards) == 10, len(dcards)
    u2 = apply_to_cards(dcards)
    out = "window.__DATA__=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
    with open(DATAJS_PATH, "w", encoding="utf-8") as f:
        f.write(out)
    print("data.js 更新:", len(u2), "卡")

    # 3) 回读校验
    data2 = json.loads(open(DATAJS_PATH, encoding="utf-8").read().strip()[len("window.__DATA__="):-1])
    ok = 0
    for c in data2["rp_cards"]["honglou_full"]:
        f = c["fields"]
        need = ("arc_type", "arc_start", "arc_mid", "arc_end", "timeline_stage")
        if c["name"] in ARCS and all(f.get(k) for k in need):
            ok += 1
        else:
            print("缺失:", c["name"])
    print("回读校验通过:", ok, "/ 10")
    if ok != 10:
        sys.exit(1)


if __name__ == "__main__":
    main()
