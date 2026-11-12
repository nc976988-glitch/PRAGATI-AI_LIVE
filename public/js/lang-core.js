/* Pragati language core — shared by the browser (ES module side-effect import) and Node (require).
 * - LANGS: 120+ world languages with native names, speech locales and Wikipedia codes.
 * - detect(text): offline language identification (script analysis + stop-word scoring).
 * - switchRequest(text): "reply in Tamil", "French mein baat karo", "habla en español" → language.
 * No dependencies, no network. */
(function (root) {
  'use strict';
  // [code, English name, native name, speech/TTS locale, wikipedia code]
  const RAW = [
    ['af', 'Afrikaans', 'Afrikaans', 'af-ZA'], ['sq', 'Albanian', 'Shqip', 'sq-AL'], ['am', 'Amharic', 'አማርኛ', 'am-ET'],
    ['ar', 'Arabic', 'العربية', 'ar-SA'], ['hy', 'Armenian', 'Հայերեն', 'hy-AM'], ['as', 'Assamese', 'অসমীয়া', 'as-IN'],
    ['ay', 'Aymara', 'Aymar aru', 'es-BO'], ['az', 'Azerbaijani', 'Azərbaycanca', 'az-AZ'], ['bm', 'Bambara', 'Bamanankan', 'fr-ML'],
    ['eu', 'Basque', 'Euskara', 'eu-ES'], ['be', 'Belarusian', 'Беларуская', 'be-BY'], ['bn', 'Bengali', 'বাংলা', 'bn-IN'],
    ['bho', 'Bhojpuri', 'भोजपुरी', 'hi-IN', 'bh'], ['bs', 'Bosnian', 'Bosanski', 'bs-BA'], ['bg', 'Bulgarian', 'Български', 'bg-BG'],
    ['my', 'Burmese', 'မြန်မာ', 'my-MM'], ['yue', 'Cantonese', '粵語', 'yue-Hant-HK', 'zh-yue'], ['ca', 'Catalan', 'Català', 'ca-ES'],
    ['ceb', 'Cebuano', 'Cebuano', 'fil-PH'], ['ny', 'Chichewa', 'Chichewa', 'ny-MW'], ['zh', 'Chinese', '中文', 'zh-CN'],
    ['zh-TW', 'Chinese (Traditional)', '繁體中文', 'zh-TW', 'zh'], ['co', 'Corsican', 'Corsu', 'fr-FR'], ['hr', 'Croatian', 'Hrvatski', 'hr-HR'],
    ['cs', 'Czech', 'Čeština', 'cs-CZ'], ['da', 'Danish', 'Dansk', 'da-DK'], ['dv', 'Dhivehi', 'ދިވެހި', 'dv-MV'],
    ['doi', 'Dogri', 'डोगरी', 'hi-IN', 'hi'], ['nl', 'Dutch', 'Nederlands', 'nl-NL'], ['en', 'English', 'English', 'en-IN'],
    ['eo', 'Esperanto', 'Esperanto', 'eo'], ['et', 'Estonian', 'Eesti', 'et-EE'], ['ee', 'Ewe', 'Eʋegbe', 'ee-GH'],
    ['fil', 'Filipino', 'Filipino', 'fil-PH', 'tl'], ['fi', 'Finnish', 'Suomi', 'fi-FI'], ['fr', 'French', 'Français', 'fr-FR'],
    ['fy', 'Frisian', 'Frysk', 'nl-NL'], ['gl', 'Galician', 'Galego', 'gl-ES'], ['ka', 'Georgian', 'ქართული', 'ka-GE'],
    ['de', 'German', 'Deutsch', 'de-DE'], ['el', 'Greek', 'Ελληνικά', 'el-GR'], ['gn', 'Guarani', 'Avañeʼẽ', 'es-PY'],
    ['gu', 'Gujarati', 'ગુજરાતી', 'gu-IN'], ['ht', 'Haitian Creole', 'Kreyòl ayisyen', 'fr-HT'], ['ha', 'Hausa', 'Hausa', 'ha-NG'],
    ['haw', 'Hawaiian', 'ʻŌlelo Hawaiʻi', 'en-US'], ['he', 'Hebrew', 'עברית', 'he-IL'], ['hi', 'Hindi', 'हिन्दी', 'hi-IN'],
    ['hinglish', 'Hinglish', 'Hinglish (Roman Hindi)', 'en-IN', 'en'], ['hmn', 'Hmong', 'Hmoob', 'en-US'], ['hu', 'Hungarian', 'Magyar', 'hu-HU'],
    ['is', 'Icelandic', 'Íslenska', 'is-IS'], ['ig', 'Igbo', 'Igbo', 'ig-NG'], ['ilo', 'Ilocano', 'Ilokano', 'fil-PH'],
    ['id', 'Indonesian', 'Bahasa Indonesia', 'id-ID'], ['ga', 'Irish', 'Gaeilge', 'ga-IE'], ['it', 'Italian', 'Italiano', 'it-IT'],
    ['ja', 'Japanese', '日本語', 'ja-JP'], ['jv', 'Javanese', 'Basa Jawa', 'jv-ID'], ['kn', 'Kannada', 'ಕನ್ನಡ', 'kn-IN'],
    ['ks', 'Kashmiri', 'کٲشُر', 'ur-IN'], ['kk', 'Kazakh', 'Қазақ тілі', 'kk-KZ'], ['km', 'Khmer', 'ខ្មែរ', 'km-KH'],
    ['rw', 'Kinyarwanda', 'Kinyarwanda', 'rw-RW'], ['kok', 'Konkani', 'कोंकणी', 'hi-IN', 'gom'], ['ko', 'Korean', '한국어', 'ko-KR'],
    ['kri', 'Krio', 'Krio', 'en-SL'], ['ku', 'Kurdish', 'Kurdî', 'ku-TR'], ['ckb', 'Kurdish (Sorani)', 'کوردی', 'ckb-IQ'],
    ['ky', 'Kyrgyz', 'Кыргызча', 'ky-KG'], ['lo', 'Lao', 'ລາວ', 'lo-LA'], ['la', 'Latin', 'Latina', 'it-IT'],
    ['lv', 'Latvian', 'Latviešu', 'lv-LV'], ['ln', 'Lingala', 'Lingála', 'fr-CD'], ['lt', 'Lithuanian', 'Lietuvių', 'lt-LT'],
    ['lg', 'Luganda', 'Luganda', 'lg-UG'], ['lb', 'Luxembourgish', 'Lëtzebuergesch', 'lb-LU'], ['mk', 'Macedonian', 'Македонски', 'mk-MK'],
    ['mai', 'Maithili', 'मैथिली', 'hi-IN'], ['mg', 'Malagasy', 'Malagasy', 'mg-MG'], ['ms', 'Malay', 'Bahasa Melayu', 'ms-MY'],
    ['ml', 'Malayalam', 'മലയാളം', 'ml-IN'], ['mt', 'Maltese', 'Malti', 'mt-MT'], ['mni', 'Manipuri', 'ꯃꯤꯇꯩꯂꯣꯟ', 'mni-IN'],
    ['mi', 'Maori', 'Te Reo Māori', 'mi-NZ'], ['mr', 'Marathi', 'मराठी', 'mr-IN'], ['lus', 'Mizo', 'Mizo ṭawng', 'en-IN'],
    ['mn', 'Mongolian', 'Монгол', 'mn-MN'], ['ne', 'Nepali', 'नेपाली', 'ne-NP'], ['no', 'Norwegian', 'Norsk', 'nb-NO'],
    ['or', 'Odia', 'ଓଡ଼ିଆ', 'or-IN'], ['om', 'Oromo', 'Afaan Oromoo', 'om-ET'], ['ps', 'Pashto', 'پښتو', 'ps-AF'],
    ['fa', 'Persian', 'فارسی', 'fa-IR'], ['pl', 'Polish', 'Polski', 'pl-PL'], ['pt', 'Portuguese', 'Português', 'pt-BR'],
    ['pa', 'Punjabi', 'ਪੰਜਾਬੀ', 'pa-IN'], ['qu', 'Quechua', 'Runa Simi', 'es-PE'], ['ro', 'Romanian', 'Română', 'ro-RO'],
    ['ru', 'Russian', 'Русский', 'ru-RU'], ['sm', 'Samoan', 'Gagana Sāmoa', 'en-NZ'], ['sa', 'Sanskrit', 'संस्कृतम्', 'sa-IN'],
    ['sat', 'Santali', 'ᱥᱟᱱᱛᱟᱲᱤ', 'sat-IN'], ['gd', 'Scottish Gaelic', 'Gàidhlig', 'gd-GB'], ['sr', 'Serbian', 'Српски', 'sr-RS'],
    ['st', 'Sesotho', 'Sesotho', 'st-ZA'], ['sn', 'Shona', 'chiShona', 'sn-ZW'], ['sd', 'Sindhi', 'سنڌي', 'sd-IN'],
    ['si', 'Sinhala', 'සිංහල', 'si-LK'], ['sk', 'Slovak', 'Slovenčina', 'sk-SK'], ['sl', 'Slovenian', 'Slovenščina', 'sl-SI'],
    ['so', 'Somali', 'Soomaali', 'so-SO'], ['es', 'Spanish', 'Español', 'es-ES'], ['su', 'Sundanese', 'Basa Sunda', 'su-ID'],
    ['sw', 'Swahili', 'Kiswahili', 'sw-KE'], ['sv', 'Swedish', 'Svenska', 'sv-SE'], ['tg', 'Tajik', 'Тоҷикӣ', 'tg-TJ'],
    ['ta', 'Tamil', 'தமிழ்', 'ta-IN'], ['tt', 'Tatar', 'Татарча', 'tt-RU'], ['te', 'Telugu', 'తెలుగు', 'te-IN'],
    ['th', 'Thai', 'ไทย', 'th-TH'], ['bo', 'Tibetan', 'བོད་སྐད', 'bo-CN'], ['ti', 'Tigrinya', 'ትግርኛ', 'ti-ET'],
    ['ts', 'Tsonga', 'Xitsonga', 'ts-ZA'], ['tr', 'Turkish', 'Türkçe', 'tr-TR'], ['tk', 'Turkmen', 'Türkmençe', 'tk-TM'],
    ['ak', 'Twi', 'Twi', 'ak-GH'], ['uk', 'Ukrainian', 'Українська', 'uk-UA'], ['ur', 'Urdu', 'اردو', 'ur-IN'],
    ['ug', 'Uyghur', 'ئۇيغۇرچە', 'ug-CN'], ['uz', 'Uzbek', 'Oʻzbekcha', 'uz-UZ'], ['vi', 'Vietnamese', 'Tiếng Việt', 'vi-VN'],
    ['cy', 'Welsh', 'Cymraeg', 'cy-GB'], ['xh', 'Xhosa', 'isiXhosa', 'xh-ZA'], ['yi', 'Yiddish', 'ייִדיש', 'yi'],
    ['yo', 'Yoruba', 'Yorùbá', 'yo-NG'], ['zu', 'Zulu', 'isiZulu', 'zu-ZA'],
  ];
  const LANGS = RAW.map(([code, name, native, locale, wiki]) => ({ code, name, native, locale, wiki: wiki || code.split('-')[0] }));
  const BY = Object.create(null); for (const l of LANGS) BY[l.code.toLowerCase()] = l;
  const byCode = (c) => {
    if (!c) return null; const k = String(c).toLowerCase().replace('_', '-');
    return BY[k] || BY[k.split('-')[0]] || LANGS.find((l) => l.locale.toLowerCase() === k) || null;
  };
  // extra names people actually say/type → code
  const ALIAS = {
    angrezi: 'en', angreji: 'en', inglish: 'en', english: 'en', 'अंग्रेज़ी': 'en', 'अंग्रेजी': 'en', hindustani: 'hi', 'हिंदी': 'hi', 'हिन्दी': 'hi',
    bangla: 'bn', bengali: 'bn', oriya: 'or', odiya: 'or', panjabi: 'pa', punjabi: 'pa', farsi: 'fa', mandarin: 'zh', chinese: 'zh',
    tagalog: 'fil', castellano: 'es', espanol: 'es', 'español': 'es', francais: 'fr', 'français': 'fr', deutsch: 'de', italiano: 'it',
    portugues: 'pt', 'português': 'pt', nihongo: 'ja', japanese: 'ja', korean: 'ko', hangul: 'ko', russkiy: 'ru', tamizh: 'ta',
    telegu: 'te', kannad: 'kn', malyalam: 'ml', gujrati: 'gu', marathi: 'mr', urdu: 'ur', arabi: 'ar', arbi: 'ar', 'عربي': 'ar',
    swahili: 'sw', kiswahili: 'sw', bahasa: 'id', malay: 'ms', thai: 'th', vietnamese: 'vi', turkish: 'tr', persian: 'fa',
  };
  function byName(word) {
    const w = String(word || '').toLowerCase().trim(); if (!w) return null;
    if (ALIAS[w]) return BY[ALIAS[w]];
    return LANGS.find((l) => l.name.toLowerCase() === w || l.native.toLowerCase() === w || l.name.toLowerCase().split(' ')[0] === w) || null;
  }

  // ── script ranges ──
  const SCRIPTS = [
    ['deva', /[\u0900-\u097F]/g], ['beng', /[\u0980-\u09FF]/g], ['guru', /[\u0A00-\u0A7F]/g], ['gujr', /[\u0A80-\u0AFF]/g],
    ['orya', /[\u0B00-\u0B7F]/g], ['taml', /[\u0B80-\u0BFF]/g], ['telu', /[\u0C00-\u0C7F]/g], ['knda', /[\u0C80-\u0CFF]/g],
    ['mlym', /[\u0D00-\u0D7F]/g], ['sinh', /[\u0D80-\u0DFF]/g], ['thai', /[\u0E00-\u0E7F]/g], ['laoo', /[\u0E80-\u0EFF]/g],
    ['tibt', /[\u0F00-\u0FFF]/g], ['mymr', /[\u1000-\u109F]/g], ['geor', /[\u10A0-\u10FF]/g], ['ethi', /[\u1200-\u139F]/g],
    ['khmr', /[\u1780-\u17FF]/g], ['mong', /[\u1800-\u18AF]/g], ['olck', /[\u1C50-\u1C7F]/g], ['mtei', /[\uABC0-\uABFF]/g],
    ['thaa', /[\u0780-\u07BF]/g], ['hebr', /[\u0590-\u05FF]/g], ['arab', /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g],
    ['armn', /[\u0530-\u058F]/g], ['grek', /[\u0370-\u03FF]/g], ['cyrl', /[\u0400-\u04FF]/g], ['kana', /[\u3040-\u30FF\u31F0-\u31FF]/g],
    ['hang', /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g], ['hani', /[\u4E00-\u9FFF\u3400-\u4DBF]/g], ['latn', /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g],
  ];
  const SIMPLE = { beng: 'bn', guru: 'pa', gujr: 'gu', orya: 'or', taml: 'ta', telu: 'te', knda: 'kn', mlym: 'ml', sinh: 'si', thai: 'th', laoo: 'lo', tibt: 'bo', mymr: 'my', geor: 'ka', khmr: 'km', mong: 'mn', olck: 'sat', mtei: 'mni', thaa: 'dv', armn: 'hy', grek: 'el', hang: 'ko' };

  // ── Latin-script stop words (most frequent words + greetings) ──
  const SW = {
    en: 'the and is are you what how why who of to in it that this for with my your can do does please i me was will have be on not tell hello hi thanks thank about from could would should',
    hinglish: 'hai hain kya kaise kaisa kaisi mujhe mera meri mere tum tera teri aap aapka karo kar karna karte batao bata nahi nahin haan ka ki ke ko se mein aur bhi kuch yaar acha accha theek thik kyun kyu kab kahan kaun abhi wala wali bolo bhejo dena chahiye raha rahi tha thi hoga hum humko main kal aaj padhna samjhao bhai didi mummy papa',
    es: 'el la los las de que y es en un una por para con no se lo como qué está estoy hola gracias pero muy más yo tú usted dónde cuál porque buenos días soy tengo quiero puedes',
    fr: 'le la les des et est un une je tu vous il elle pas que qui pour dans avec sur ce bonjour merci oui non comment pourquoi très mais où quel suis peux veux',
    de: 'der die das und ist ich du sie nicht ein eine zu mit von wie was warum wo bitte danke hallo guten ja nein auch auf für es sind bin kannst möchte',
    pt: 'o os as de que e é em um uma não para com por eu você como está obrigado obrigada olá sim muito mais onde porque são isso estou quero pode',
    it: 'il lo gli le di che è un una non per con sono io tu come ciao grazie sì perché dove molto ma anche questo cosa voglio puoi',
    nl: 'de het een en is ik je jij niet van wat hoe waarom dank hallo ja nee ook op met voor zijn dat er ben kun wil',
    sv: 'och är jag du det att en ett inte som på med för hur vad varför hej tack ja nej också av kan vill',
    no: 'og er jeg du det at en et ikke som på med for hvordan hva hvorfor hei takk ja nei også av kan vil',
    da: 'og er jeg du det at en et ikke som på med for hvordan hvad hvorfor hej tak ja nej også af kan vil',
    fi: 'ja on minä sinä se ei että mitä miten miksi kiitos hei kyllä myös mutta tämä olen oletko voitko',
    pl: 'i jest nie się że to na w z do jak co dlaczego cześć dziękuję tak czy ja ty jestem bardzo możesz',
    cs: 'a je to se na že v s jak co proč ahoj děkuji ano ne jsem já ty není můžeš',
    sk: 'a je to sa na že v s ako čo prečo ahoj ďakujem áno nie som ja ty môžeš',
    ro: 'și este nu în cu de la pe un o eu tu ce cum bună mulțumesc da sunt foarte poți',
    hu: 'és a az egy nem van hogy mi miért hogyan köszönöm szia igen is én te vagyok',
    tr: 've bir bu da de ne nasıl neden merhaba teşekkür evet hayır ben sen mi mı için çok var yok musun',
    id: 'dan yang di ini itu tidak ada saya kamu anda apa bagaimana mengapa terima kasih halo ya dengan untuk dari akan bisa aku',
    ms: 'dan yang di ini itu tidak ada saya awak anda apa bagaimana kenapa terima kasih hai ya dengan untuk dari akan boleh',
    vi: 'và là của không có tôi bạn gì như thế nào tại sao xin chào cảm ơn vâng được này một những',
    fil: 'ang ng sa na at ako ikaw ka mo ko ano paano bakit salamat oo hindi po ba ito kumusta',
    sw: 'na ni ya wa kwa katika mimi wewe nini vipi habari asante ndiyo hapana hii jambo',
    ha: 'da na ne ce ba ni kai me yaya sannu nagode wannan',
    yo: 'ati ni ti mo o kini bawo jọwọ bẹẹni rara eyi ẹ',
    zu: 'futhi ngi yini kanjani ngoba sawubona ngiyabonga yebo cha lokhu',
    xh: 'kwaye ndi yintoni njani molo enkosi ewe hayi',
    af: 'en die is ek jy nie van wat hoe hoekom dankie hallo ja nee ook vir met',
    ca: 'i el la els les de que és un una no per amb com què hola gràcies sí molt',
    hr: 'i je u na se da ne što kako zašto bok hvala sam ja ti',
    sl: 'in je v na se da ne kaj kako zakaj živjo hvala sem jaz ti',
    lt: 'ir yra ne kad aš tu kas kaip kodėl labas ačiū taip',
    lv: 'un ir ne ka es tu kas kā kāpēc sveiki paldies jā',
    et: 'ja on ei et ma sa mis kuidas miks tere aitäh jah',
    sq: 'dhe është në një nuk që unë ti çfarë si pse përshëndetje faleminderit po',
    az: 'və bir bu nə necə niyə salam təşəkkür bəli mən sən',
    uz: 'va bir bu nima qanday nega salom rahmat ha men sen',
    so: 'iyo waa ku ka oo ma maxaa sidee salaan mahadsanid haa',
    eu: 'eta da ez bat zer nola zergatik kaixo eskerrik bai ni zu',
    ga: 'agus tá is an na ní mé tú cad conas dia duit maith agat',
    cy: 'a yw yn y ac nid fi ti beth sut pam helo diolch ie',
    is: 'og er ég þú ekki að hvað hvernig halló takk já',
    mt: 'u huwa il ta li ma jien int kif għaliex bonġu grazzi iva',
    eo: 'kaj estas la de ne mi vi kio kiel kial saluton dankon jes',
    jv: 'lan iku ora aku kowe apa piye kenapa matur nuwun',
    su: 'jeung nu teu abdi anjeun naon kumaha naha hatur nuhun',
    mg: 'sy ny dia tsy aho ianao inona ahoana nahoana salama misaotra eny',
    ht: 'ak se nan pa mwen ou kisa kijan poukisa bonjou mèsi wi',
    la: 'et est in non ad cum quod sed ego tu quid',
  };
  const SWSET = {}; for (const [k, v] of Object.entries(SW)) SWSET[k] = new Set(v.split(' '));
  const MARKS = [
    ['vi', /[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđơư]/i, 4], ['tr', /[ğış]/i, 3], ['pl', /[ąęłńśźż]/i, 3],
    ['cs', /[ěřů]/i, 3], ['sk', /[ľĺŕ]/i, 3], ['ro', /[șțşţ]/i, 3], ['hu', /[őű]/i, 4], ['de', /ß/, 3], ['de', /[äöü]/i, 1],
    ['es', /[ñ¿¡]/i, 3], ['pt', /[ãõ]/i, 3], ['fr', /[œàèùâêîûë]/i, 1], ['fr', /ç/i, 1], ['is', /[þð]/i, 4], ['az', /ə/i, 4],
    ['mt', /[ħġ]/i, 4], ['lv', /[āēīūģķļņ]/i, 3], ['lt', /[ėįųū]/i, 3], ['et', /õ/i, 2], ['sq', /ë/i, 2], ['cy', /[ŵŷ]/i, 4],
    ['yo', /[ẹọṣ]/i, 4], ['sv', /å/i, 1], ['no', /[æø]/i, 2], ['da', /[æø]/i, 2], ['ca', /l·l|ŀ/i, 4],
  ];

  const pack = (code, confidence, script) => { const l = byCode(code) || BY.en; return { code: l.code, name: l.name, native: l.native, locale: l.locale, wiki: l.wiki, confidence, script }; };

  function detect(input) {
    const text = String(input || '').replace(/https?:\/\/\S+/g, ' ').replace(/`[^`]*`/g, ' ').slice(0, 2000);
    const counts = {}; let total = 0;
    for (const [k, rx] of SCRIPTS) { const n = (text.match(rx) || []).length; if (n) { counts[k] = n; total += n; } }
    if (!total) return pack('en', 0, 'none');
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    // CJK: any kana → Japanese; hangul → Korean; else Chinese
    if (counts.kana) return pack('ja', 0.95, 'kana');
    if (counts.hang && counts.hang >= (counts.hani || 0)) return pack('ko', 0.95, 'hang');
    const nonLatin = top.find(([k]) => k !== 'latn');
    if (nonLatin && (nonLatin[1] >= total * 0.3 || nonLatin[1] >= 4)) {
      const s = nonLatin[0]; const conf = Math.min(0.99, 0.6 + nonLatin[1] / 40);
      if (SIMPLE[s]) {
        if (s === 'beng' && /[ৰৱ]/.test(text)) return pack('as', conf, s);
        if (s === 'ethi' && /(እዩ|ኣ|ትግር)/.test(text)) return pack('ti', conf, s);
        return pack(SIMPLE[s], conf, s);
      }
      if (s === 'ethi') return pack('am', conf, s);
      if (s === 'hani') return pack(/[們這說個來為會時對開過還麼們國學體]/.test(text) ? 'zh-TW' : 'zh', conf, s);
      if (s === 'deva') {
        if (/(आहे|आहेत|मला|तुम्ही|नाही|काय|माझ|आम्ही|करा\b|झाले)/.test(text)) return pack('mr', conf, s);
        if (/(छ\b|छन्|हुन्छ|गर्नु|तपाईं|हुँ|गर्छ|भयो|छैन)/.test(text)) return pack('ne', conf, s);
        if (/(अस्ति|भवति|संस्कृत|वयम्|अहम्)/.test(text)) return pack('sa', conf, s);
        return pack('hi', conf, s);
      }
      if (s === 'arab') {
        if (/[ټډړږښځڅ]/.test(text)) return pack('ps', conf, s);
        if (/[ڄڃڇڏڙڦ]/.test(text)) return pack('sd', conf, s);
        if (/[ٹڈڑںےھ]/.test(text)) return pack('ur', conf, s);
        if (/[ۆێڵڕ]/.test(text)) return pack('ckb', conf, s);
        if (/[ۇۈۋېى]/.test(text) && /ئ/.test(text)) return pack('ug', conf, s);
        if (/[پچژگ]/.test(text) || /(است|می|های|این)/.test(text)) return pack('fa', conf, s);
        return pack('ar', conf, s);
      }
      if (s === 'hebr') return pack(/[װױײ]|ײַ|און\b/.test(text) ? 'yi' : 'he', conf, s);
      if (s === 'cyrl') {
        if (/[іїєґ]/i.test(text) || /(^|[\s,.!?])(що|дякую|привіт|будь|вибачте)/i.test(text)) return pack('uk', conf, s);
        if (/ў/i.test(text)) return pack('be', conf, s);
        if (/[ѓќѕ]/i.test(text)) return pack('mk', conf, s);
        if (/[ђћџ]/i.test(text) || (/[љњј]/i.test(text) && !/[ыэъ]/i.test(text))) return pack('sr', conf, s);
        if (/[әғқңұһ]/i.test(text)) return pack('kk', conf, s);
        if (/[ҷқӣӯ]/i.test(text)) return pack('tg', conf, s);
        if (/[өү]/i.test(text)) return pack(/[ң]/i.test(text) ? 'ky' : 'mn', conf, s);
        if (/ъ/i.test(text) && !/[ыэё]/i.test(text)) return pack('bg', conf, s);
        return pack('ru', conf, s);
      }
      return pack('en', 0.2, s);
    }
    // Latin script: stop-word scoring
    const low = text.toLowerCase().normalize('NFC');
    const toks = low.split(/[^a-z\u00C0-\u024F\u1E00-\u1EFF'·ŀ]+/).filter(Boolean);
    if (!toks.length) return pack('en', 0, 'latn');
    const score = {};
    for (const [k, set] of Object.entries(SWSET)) { let n = 0; for (const t of toks) if (set.has(t)) n++; if (n) score[k] = n; }
    for (const [k, rx, w] of MARKS) if (rx.test(low)) score[k] = (score[k] || 0) + w;
    // ASCII-only text without strong markers leans English
    if (score.en) score.en += 0.4;
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return pack('en', 0.25, 'latn');
    let [best, s1] = ranked[0]; const s2 = ranked[1]?.[1] || 0;
    if (best !== 'hinglish' && score.hinglish && score.hinglish >= s1 - 0.4 && score.hinglish >= 2) best = 'hinglish';
    const conf = Math.min(0.95, (s1 - s2 * 0.5) / Math.max(2, toks.length * 0.45));
    return pack(best, toks.length <= 2 ? Math.min(conf, 0.45) : Math.max(0.3, conf), 'latn');
  }

  // "reply in tamil", "speak French", "tamil mein baat karo", "मराठी में बोलो", "habla en español", "parle en français"
  const SWITCH_VERB = /(reply|respond|answer|speak|talk|write|chat|converse|from now|baat|bol|jawab|likh|samjha|बोल|बात|जवाब|लिख|habla|háblame|responde|parle|réponds|sprich|antworte|parla|rispondi|fale|responda|говори|отвечай)/i;
  function switchRequest(text) {
    const t = String(text || '').toLowerCase(); if (t.length > 120 || !SWITCH_VERB.test(t)) return null;
    if (/\b(translate|anuvad|anuvaad|meaning)\b|अनुवाद/.test(t)) return null;
    const words = t.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const one = byName(words[i]); const two = i + 1 < words.length ? byName(`${words[i]} ${words[i + 1]}`) : null;
      const hit = two || one; if (hit && (/(in|mein|me|main|में|en|em|на|auf|in)\b/.test(t) || SWITCH_VERB.test(t))) return hit;
    }
    return null;
  }

  const api = { LANGS, byCode, byName, detect, switchRequest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PragatiLang = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
