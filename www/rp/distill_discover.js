/* 角色自动发现 (2026-10-07 v2): 借鉴 NER4Novel 两遍式。
 * 第一遍: 规则粗提 (对话标签 + 高频2-4字词 + 称谓模式)
 * 第二遍: LLM 确认 + 别名归一
 * 输出: [{name, count, aliases[], importance}]
 */
var DISTILL_DISCOVER = (function(){
"use strict";

// 泛称过滤: 这些不是具体人物
var GENERIC_WORDS = ["门子","公子","小姐","夫人","太太","奶奶","爷","老爷","少爷",
  "姑娘","大人","将军","丞相","王爷","皇上","娘娘","先生","师父","师傅",
  "大哥","二哥","大姐","妹妹","哥哥","弟弟","姐姐","父亲","母亲","爹","娘",
  "众人","大家","小厮","丫鬟","婆子","丫头","仆人","下人","小厮","老者","道人",
  "和尚","尼姑","道士","书生","秀才","举人","进士","官员","差役","衙役"];

function isGeneric(name){
  return GENERIC_WORDS.indexOf(name) >= 0;
}

// 停用词: 姓氏滑窗误伤的高频非人名词（2026-10-10 实测补）
var STOP_WORDS = {};
var STOP_PHRASES = ("那个 那些 这个 这些 这里 那里 哪里 什么 怎么 为什么 如此 这样 那样 别的 别处 每当 当时 同时 之后 之前 之间 之中 之下 之上 以内 以外 以来 一起 一样 一般 一同 一切 一共 一度 一番 一家 一事 一种 一旁 一侧 一头 一边 一面 一会儿 一时 一刻 一秒 一分 一天 一月 一年 一世 一生 一辈子 东西 南北 上下 左右 前后 里外 中间 中央 当中 之内 之外 以前 以后 期间 时候 时刻 时辰 时光 时间 年代 年份 月份 日期 春夏秋冬 晨昏昼夜 今明昨 早晚 午夜 半夜 凌晨 傍晚 黄昏 清晨 正午 天地 乾坤 宇宙 世界 人间 世间 尘世 红尘 江湖 武林 朝廷 官府 衙门 客栈 酒楼 茶馆 庙宇 寺庙 道观 祠堂 山洞 洞穴 山谷 山峰 山顶 山脚 山路 官道 大道 小道 小路 街巷 村庄 城镇 城池 都城 京城 皇宫 宫殿 大殿 书房 书院 学堂 广场 市场 集市 灯会 烟火 歌舞 戏曲 拳脚 刀枪 暗器 毒药 解药 丹药 灵丹 真气 灵力 法力 修为 境界 品级 实力 势力 帮派 门派 宗门 家族 世家 豪门 贵族 皇族 大臣 武将 文官 谋士 军师 卫兵 侍卫 宾客 客人 贵客 主人 奴仆 随从 跟班 小厮 书童 弟子 门徒 徒弟 师兄 师弟 师姐 师妹 同门 秘籍 宝典 阵法 禁制 结界 封印 符箓 咒语 因果 轮回 转世 温柔 怀里 双手 方才 任何 那根 那股 子的 里的 上的 人的 有一 那一 低声 高声 大声 轻声 低低 轻轻 微微 悄悄 默默 暗暗 偷偷 满足 满意 满意地 不清 不楚 都不知 正要 将要 就要 快要 每一 每个 各位 诸位 那双 这双 双眼 眼睛 目光 眼神 眉眼 口鼻 嘴唇 嘴角 舌尖 牙齿 头发 发丝 青丝 衣衫 衣裙 长袍 衣袖 袖口 领口 腰带 玉佩 香囊 荷包 手帕 帕子 棉被 被褥 枕头 床榻 床帐 帷幔 帘子 门帘 窗户 窗棂 房门 屋门 院门 院墙 围墙 高墙 城墙 房顶 屋顶 瓦片 青瓦 梁柱 门框 台阶 石阶 石径 小径 路边 道旁 林间 林中 树下 花下 月下 灯下 烛光 火光 电光 剑光 刀光 寒光 冷光 金光 银光 白光 红光 蓝光 绿光 紫光 黑光 灰光 暗光 微光 余光 眼角 眉梢 心头 心间 心底 心底深处 脑海 脑中 耳边 耳畔 身后 身前 身旁 身侧 左右 两侧 对面 前方 后方 上方 下方 头顶 脚下 足下 身下 体内 体外 周身 全身 浑身 满身 一身 通体 遍体 鳞伤 伤痕 血痕 血迹 血渍 汗水 泪水 雨水 露水 晨露 霜降 冰雪 风雪 雨雪 阴云 乌云 浓云 烟云 云雾 雾气 水汽 热气 暑气 寒气 冷气 凉气 暖气 香气 臭气 腥气 血腥 杀气 戾气 怨气 怒气 火气 脾气 性子 性情 秉性 本性 天性 野性 魔性 妖性 鬼性 神性 佛性 慧根 灵根 仙骨 道骨 凡骨 肉身 法身 金身 真身 化身 分身 投影 虚影 残影 幻影 幻象 假象 真相 实情 内情 隐情 苦衷 难处 处境 境地 田地 下场 结局 收场 落幕 开场 开端 肇始 缘起 前缘 宿缘 孽缘 情缘 尘缘 佛缘 仙缘 机缘 造化 气数 定数 变数 异数").split(" ");
STOP_PHRASES.forEach(function(w){ STOP_WORDS[w] = true; });
function isStopWord(name){ return !!STOP_WORDS[name]; }

// 别名清洗: 去动词尾，去截断碎片
var VERB_TAIL = "说道问叹笑应答喊骂哭嚷道着了过";
function cleanAlias(alias, canonical){
  // 去尾部动词
  while(alias.length > 2 && VERB_TAIL.indexOf(alias[alias.length-1]) >= 0){
    alias = alias.slice(0, -1);
  }
  // 如果是正名的截断碎片 (如"王夫" vs "王夫人")，丢弃
  if(canonical && canonical.indexOf(alias) === 0 && alias.length < canonical.length){
    return null;
  }
  // 如果别名包含正名或被正名包含，保留
  return alias.length >= 2 ? alias : null;
}

// 第一遍: 规则提取候选
function extractCandidates(text, opts){
  opts = opts || {};
  var minCount = opts.minCount || 5;
  var freq = {};
  var tagBonus = {}; // 对话标签命中的候选，质量更高

  // 1. 对话标签中的名字 (复用 speaker 逻辑简化版)
  // 收紧：排除"的/他/她/它/这/那"开头（"他说"不是名字），排除"接着说"类副词+说；
  // 只取 2-3 字（4 字多为"压低声音"类状语）；
  // 强信号：名字前是标点/句首（"，凌安说道"），"微微一笑"这类紧贴动词的状语会被弱化
  var tagRe = /(^|[，。！？；：“”"'\s])([\u4e00-\u9fa5]{2,3})(?:笑道|问道|说道|叹道|忙道|答道|回道|骂道|哭道|喊道|道|说|笑|问)/g;
  var m;
  var TAIL = "笑说道问叹应的了着过";
  function cleanTail(s){ while(s.length > 2 && TAIL.indexOf(s[s.length-1]) >= 0) s = s.slice(0, -1); return s; }
  while((m = tagRe.exec(text))){
    var name = cleanTail(m[2]);
    // 过滤：代词开头、副词+说结构、尾部否定词（"凌安没说"→"凌安没"非名）
    if(/^[他她它这那]/.test(name)) continue;
    if(/[没不别]$/.test(name)) continue;
    if(/(?:接着|跟着|随后|于是|然后|便|就|却|倒|竟|还|又|也|都|只|单|空|白|硬|死|苦|笑|哭|喊|骂)说$/.test(m[0])) continue;
    if(name.length >= 2){ freq[name] = (freq[name] || 0) + 1; tagBonus[name] = true; }
  }

  // 2. 高频 2-4 字词 (简化版，不用分词，用滑动窗口统计)
  // 为性能，只统计对话标签附近和常见姓氏开头的
  var surnames = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公万俟司马上官欧阳夏侯诸葛闻人东方赫连皇甫尉迟公羊澹台公冶宗政濮阳淳于单于太叔申屠公孙仲孙轩辕令狐钟离宇文长孙慕容鲜于闾丘司徒司空亓官司寇仉督子车颛孙端木巫马公西漆雕乐正壤驷公良拓跋夹谷宰父谷梁晋楚闫法汝鄢涂钦段干百里东郭南门呼延归海羊舌微生岳帅缑亢况郈有琴梁丘左丘东门西门商牟佘佴伯赏南宫墨哈谯笪年爱阳佟";
  var surnameSet = {};
  for(var i = 0; i < surnames.length; i++) surnameSet[surnames[i]] = true;

  // 滑动窗口找姓氏开头的 2-3 字组合
  var windowSize = 50000; // 分段处理防卡死
  for(var seg = 0; seg < text.length; seg += windowSize){
    var segText = text.slice(seg, seg + windowSize);
    for(var j = 0; j < segText.length - 3; j++){
      var ch = segText[j];
      if(surnameSet[ch]){
        // 尝试 2字、3字
        for(var len = 2; len <= 3; len++){
          var word = segText.slice(j, j + len);
          if(/^[\u4e00-\u9fa5]{2,3}$/.test(word)){
            // 排除明显不是名字的 (后接"的/了/着"等)
            var next = segText[j + len];
            if(next && "的了着过和与在".indexOf(next) < 0){
              freq[word] = (freq[word] || 0) + 1;
            }
          }
        }
      }
    }
  }

  // 过滤低频 + 泛称 + 停用词；剥离尾部的"的"并合并计数（"凌安的"→"凌安"）
  var merged = {};
  Object.keys(freq).forEach(function(name){
    var base = name;
    if(base.length > 2 && base[base.length-1] === "的") base = base.slice(0, -1);
    if(base.length < 2) return;
    merged[base] = (merged[base] || 0) + freq[name];
    if(tagBonus[name]) tagBonus[base] = true;
  });
  var cands = [];
  Object.keys(merged).forEach(function(name){
    if(merged[name] >= minCount && !isGeneric(name) && !isStopWord(name)){
      cands.push({name: name, count: merged[name], tagHit: !!tagBonus[name]});
    }
  });
  // 对话标签命中的优先，其次按频次
  cands.sort(function(a, b){
    if(!!a.tagHit !== !!b.tagHit) return a.tagHit ? -1 : 1;
    return b.count - a.count;
  });
  return cands.slice(0, 100); // 取 Top 100
}

// 第二遍: LLM 确认 + 别名归一
// 为每个候选提取 N 条证据句（名字出现的原句），供 LLM 快速判断是否为真角色
function extractEvidence(text, name, n){
  n = n || 5;
  var out = [];
  // 按句切分（。！？\n），找包含名字的句子
  var sentences = text.split(/[。！？\n]+/);
  for(var i = 0; i < sentences.length && out.length < n; i++){
    var s = sentences[i].trim();
    if(s.indexOf(name) >= 0 && s.length >= 8 && s.length <= 120){
      // 去重：太相似的跳过
      var dup = out.some(function(e){ return e === s; });
      if(!dup) out.push(s);
    }
  }
  return out;
}

async function confirmCharacters(candidates, text, opts, warnings){
  opts = opts || {};
  warnings = warnings || [];
  var onProgress = opts.onProgress || function(){};
  // 取 Top 30 让 LLM 确认
  var top = candidates.slice(0, 30);
  onProgress(0, 1, "提取证据句...");
  // 每个候选附 5 条证据句
  var candsWithEv = top.map(function(c){
    return {name: c.name, count: c.count, evidence: extractEvidence(text, c.name, 5)};
  });
  onProgress(0, 1, "LLM 确认角色...");
  try{
    var r = await DISTILL_LLM.chat([
      {role: "system", content: "你是小说角色识别器。从候选名单中确认哪些是真实人物角色，合并别名。每个候选附了 5 条原文证据句，帮你快速判断（证据句里名字若指代物品/状语/泛称则不是角色）。返回 JSON: {\"characters\": [{\"name\": \"正名\", \"aliases\": [\"别名\"], \"importance\": 1-10, \"reason\": \"一句话推荐理由\"}]}。importance 按戏份打分，reason 说明为什么值得蒸馏（如：主角/关键情节推动者/有完整成长弧）。"},
      {role: "user", content: JSON.stringify({candidates: candsWithEv})}
    ]);
    var m = r.content.match(/\{[\s\S]*\}/);
    if(m){
      var obj = JSON.parse(m[0]);
      return (obj.characters || []).map(function(c){
        var cand = top.find(function(t){ return t.name === c.name; });
        // 过滤泛称正名
        if(isGeneric(c.name)) return null;
        // 清洗别名
        var aliases = (c.aliases || []).map(function(a){ return cleanAlias(a, c.name); })
          .filter(function(a){ return a && a !== c.name && !isGeneric(a); });
        // 去重
        aliases = aliases.filter(function(a, i){ return aliases.indexOf(a) === i; });
        return {
          name: c.name,
          aliases: aliases,
          importance: c.importance || 5,
          count: cand ? cand.count : 0,
          reason: c.reason || ""
        };
      }).filter(Boolean).sort(function(a, b){ return b.importance - a.importance || b.count - a.count; });
    }
  }catch(e){
    var wmsg = "LLM 确认失败，已降级为规则结果: " + e.message;
    warnings.push(wmsg);
    onProgress(0, 1, wmsg);
  }
  // 降级: 直接用规则结果
  return top.slice(0, 20).map(function(c){
    return {name: c.name, aliases: [], importance: 5, count: c.count,
      reason: "规则提取 (出现 " + c.count + " 次)"};
  });
}

async function discover(text, opts){
  opts = opts || {};
  var onProgress = opts.onProgress || function(){};
  onProgress(0, 2, "第一遍: 规则提取候选...");
  var cands = extractCandidates(text, opts);
  onProgress(1, 2, "发现 " + cands.length + " 个候选");
  onProgress(1, 2, "第二遍: LLM 确认...");
  var warnings = [];
  var chars = await confirmCharacters(cands, text, opts, warnings);
  chars.warnings = warnings;  // 挂到数组上，UI 可读
  onProgress(2, 2, "确认 " + chars.length + " 个角色");
  return chars;
}

return {
  extractCandidates: extractCandidates,
  confirmCharacters: confirmCharacters,
  discover: discover,
  isGeneric: isGeneric,
  cleanAlias: cleanAlias
};
})();
