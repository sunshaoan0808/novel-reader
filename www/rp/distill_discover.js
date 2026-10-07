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

  // 1. 对话标签中的名字 (复用 speaker 逻辑简化版)
  var tagRe = /([\u4e00-\u9fa5]{2,4})(?:笑道|问道|说道|叹道|忙道|答道|回道|骂道|哭道|喊道|道|说|笑|问)/g;
  var m;
  var TAIL = "笑说道问叹应的了着过";
  function cleanTail(s){ while(s.length > 2 && TAIL.indexOf(s[s.length-1]) >= 0) s = s.slice(0, -1); return s; }
  while((m = tagRe.exec(text))){
    var name = cleanTail(m[1]);
    if(name.length >= 2) freq[name] = (freq[name] || 0) + 1;
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

  // 过滤低频 + 泛称
  var cands = [];
  Object.keys(freq).forEach(function(name){
    if(freq[name] >= minCount && name.length >= 2 && !isGeneric(name)){
      cands.push({name: name, count: freq[name]});
    }
  });
  cands.sort(function(a, b){ return b.count - a.count; });
  return cands.slice(0, 100); // 取 Top 100
}

// 第二遍: LLM 确认 + 别名归一
async function confirmCharacters(candidates, text, opts, warnings){
  opts = opts || {};
  warnings = warnings || [];
  var onProgress = opts.onProgress || function(){};
  // 取 Top 30 让 LLM 确认
  var top = candidates.slice(0, 30);
  onProgress(0, 1, "LLM 确认角色...");
  try{
    var r = await DISTILL_LLM.chat([
      {role: "system", content: "你是小说角色识别器。从候选名单中确认哪些是真实人物角色，合并别名。返回 JSON: {\"characters\": [{\"name\": \"正名\", \"aliases\": [\"别名\"], \"importance\": 1-10, \"reason\": \"一句话推荐理由\"}]}。importance 按戏份打分，reason 说明为什么值得蒸馏（如：主角/关键情节推动者/有完整成长弧）。"},
      {role: "user", content: JSON.stringify({
        candidates: top.map(function(c){ return {name: c.name, count: c.count}; }),
        sample: text.slice(0, 2000)
      })}
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
