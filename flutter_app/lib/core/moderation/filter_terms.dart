/// The term lists the content filter matches against, after normalization.
///
/// Scope, deliberately: these lists catch **explicit/adult** content and
/// profile names — the categories a store review tests (nudity, porn,
/// escort/hookup solicitation). They do NOT try to be a general profanity
/// list: a word like "damn" in a post is speech, not a store-policy
/// violation, and every term added is a false-positive risk multiplied by
/// 30 languages.
///
/// Sources and method:
/// - English core derived from the public LDNOOBW list (Shutterstock,
///   CC-BY-4.0) and the Google profanity list, trimmed to explicit-adult
///   terms only.
/// - CJK (Chinese/Japanese) terms from the documented Nostr spam dataset
///   (blakejakopovic/nostr-spam-detection) — the exact phrases the spam
///   waves actually used — plus standard adult terms.
/// - Other languages (es/pt/de/fr/it/tr/ru/hi/ar/th/vi/ko/id/nl/pl) from
///   LDNOOBW, again trimmed to explicit-adult.
///
/// Terms here are matched AFTER ContentFilter.normalize — lowercase, no
/// diacritics, no leet, no separators — so write them plain ("sextoy",
/// "onlyfans"). Multi-word phrases are allowed and match squashed.
library;

/// Explicit-adult terms for POST CONTENT. A match hides the post.
///
/// 2026-10-27 false-positive pass (the "real posts vanish" complaint):
/// everyday words that collide with normal speech were REMOVED from every
/// language — a term on this list must be unambiguous in its own language
/// ('meme', 'queue', 'bite', 'chatter', 'corridas', 'janda', 'dewasa',
/// '떡' (rice cake!), '오피' (officetel), 'นม' (milk), 'privacy',
/// 'link in bio', 'sexting' discourse, 'topless' fashion, 'nipples'
/// breastfeeding… all hid genuine posts). Explicit compounds and
/// unambiguous vulgarity stay — store compliance is about explicit adult
/// content, which the remaining terms still catch.
const kExplicitTerms = <String>[
  // ── English ──────────────────────────────────────────────────────
  'nsfw', 'porn', 'porno', 'pornography', 'xxx', 'onlyfans', 'fansly',
  'chaturbate', 'xvideos', 'xnxx', 'xhamster', 'pornhub', 'redtube',
  'camgirl', 'cam boy', 'camboy', 'webcam sex', 'sextoy',
  'sex toy', 'dildo', 'vibrator', 'fleshlight', 'blowjob', 'handjob',
  'footjob', 'rimjob', 'cumshot', 'creampie', 'gangbang', 'orgy',
  'threesome', 'bdsm', 'bondage', 'hentai', 'ecchi', 'ahegao', 'rule34',
  'r34', 'milf porn', 'teen porn', 'anal sex', 'hardcore sex',
  'live sex', 'sex chat', 'sexchat', 'adult chat', 'phone sex',
  'escort service', 'callgirl', 'call girl', 'hookup tonight',
  'fuckbuddy', 'fuck buddy', 'one night stand', 'meet and fuck',
  'horny girls', 'horny singles', 'nude pics', 'nudes', 'nude photos',
  'leaked nudes', 'free nudes', 'sell nudes', 'buy nudes', 'dickpic',
  'dick pic', 'pussy pic', 'tits', 'boobs',
  'nude selfie', 'xxx video', 'adult video', 'adult content',
  '18+ content', 'erotic massage', 'happy ending massage',

  // ── Chinese (from the actual spam waves) ─────────────────────────
  '约炮', '同城约炮', '妹妹安排', '援交', '找小姐', '上门服务', '全套服务',
  '特殊服务', '包夜', '一夜情', '寂寞交友', '裸聊', '黄色网站', '成人网站',
  '色情', '裸体', '做爱', '性爱', '性行为', '嫖娼', '卖淫', '性服务',
  '口交', '肛交', '乳交', '自慰', '手淫', '射精', '阳具', '阴茎', '阴道',
  '巨乳', '爆乳', '美乳', '人妻', '熟女', '萝莉', '制服诱惑', '丝袜诱惑',
  'AV女优', '成人视频', '无码', '有码', '成人直播', '约啪', '约pao',
  '看片', '黄色视频', '毛片', 'A片', '成人用品', '情趣用品', '跳蛋',
  '飞机杯', '充气娃娃',

  // ── Japanese ─────────────────────────────────────────────────────
  'アダルト', 'エロ', 'エッチ', 'セックス', 'せっくす', '風俗', 'ソープ',
  'デリヘル', 'ホテヘル', '出会い系', '援交', '円光', '援助交際', 'パパ活',
  'オナニー', 'おなにー', 'hentai', '変態', '無修正', 'セフレ', 'ヤリマン',
  'ヌード', '全裸', 'まんこ', 'ちんこ', 'ちんぽ', 'おっぱい', 'パイズリ',
  'フェラ', '素人AV', '裏垢', '裏アカ', 'エロ垢', 'オフパコ', 'ハメ撮り',

  // ── Spanish / Portuguese ─────────────────────────────────────────
  // Trimmed of everyday words that hid genuine posts: 'escorts' (police
  // escorts), 'corridas' (bullfights/running races), 'coño'→"cono" (a
  // cone), 'caralho' (the most common PT interjection), 'peladas'
  // (peeled), 'tetas' (also a place name). Unambiguous vulgarity stays.
  'porno', 'pornografía', 'sexo gratis', 'sexo en vivo', 'cámara web sexo',
  'putas', 'prostitutas', 'chicas calientes', 'maduras cachondas',
  'desnudas', 'fotos desnudas', 'videos caseros xxx', 'sexo anal',
  'mamadas', 'folladas', 'polla',
  'pornô', 'sexo ao vivo', 'acompanhantes', 'garotas de programa',
  'buceta', 'gozada', 'suruba', 'novinhas',
  'fotos peladas', 'nudes gratis', 'pack do pezinho',

  // ── German / Dutch ───────────────────────────────────────────────
  // Trimmed: 'fick' (common German surname), 'blasen' (also the normal
  // verb for playing wind instruments), 'hoeren' (collides with the
  // Dutch "to hear" conjugations). 'ficken' stays (unambiguous).
  'porno', 'pornos', 'ficken', 'ficktreffen', 'sextreffen',
  'sexchat', 'sex cam', 'livecam sex', 'nutten', 'huren', 'escortservice',
  'callgirls', 'gangbang', 'cumshot', 'titten', 'fotze',
  'schwanz', 'muschi', 'nacktfotos', 'nacktbilder', 'geile frauen',
  'geile girls', 'amateursex', 'hardcore porno',
  'neuken', 'sexdate', 'sexdating', 'geile meiden', 'naaktfoto',
  'pijpen', 'kutje', 'lul', 'tieten', 'escortservice',

  // ── French / Italian ─────────────────────────────────────────────
  // Trimmed: 'bite' (English "bite"), 'queue' (English "queue"), 'chatte'
  // (prefix-matched "chatter"), 'baiser' (also "a kiss"), 'seins' (only
  // adult in the right company, common in anatomy), 'culo' (collides
  // with names). Compounds and unambiguous vulgarity stay.
  'porno', 'salope', 'salopes', 'pute', 'putes', 'plan cul',
  'rencontre coquine', 'femmes nues', 'photos nues', 'vidéos x',
  'film x', 'sexe gratuit', 'sexe en direct', 'webcam sexe', 'escort girl',
  'baise', 'sodomie', 'fellation', 'éjaculation', 'gang bang',
  'porno', 'troie', 'puttane', 'incontri sesso', 'sesso gratis',
  'donne nude', 'foto nude', 'video porno', 'scopare', 'scopata',
  'pompino', 'sborrata', 'tette', 'figa', 'cazzo', 'gang bang',

  // ── Turkish ──────────────────────────────────────────────────────
  // Trimmed: 'seks' (the standard word — sex-ed hid; English "sex" is
  // allowed), 'meme'/'memeler' (the English "meme" collision), 'ifşa'
  // (used for legitimate exposure of wrongdoing).
  'porno', 'sex izle', 'porno izle', 'sikiş', 'sikis',
  'escort bayan', 'bayan escort', 'eskort', 'orospu', 'oruspular',
  'çıplak kadın', 'çıplak kız', 'kızlık bozma', 'türk porno',
  'türk ifşa', 'liseli ifşa', 'amcık', 'amcıq', 'yarak',
  'yarrak', 'göt', 'sevişme', 'azgın', 'azgin',
  'seks sohbet', 'canlı seks', 'götten', 'sakso',

  // ── Russian ──────────────────────────────────────────────────────
  'порно', 'порнография', 'секс', 'секс знакомства', 'интим',
  'интим услуги', 'проститутки', 'шлюхи', 'бляди', 'эскорт',
  'девочки по вызову', 'голые', 'обнаженные', 'ню', 'нудисты',
  'порно видео', 'секс видео', 'ххх', 'трах', 'трахаться', 'ебля',
  'ебать', 'хуй', 'хуя', 'пизда', 'писька', 'сиськи', 'титьки',
  'минет', 'анал', 'анальный секс', 'групповуха', 'бдсм', 'хентай',
  'частное фото', 'слитые фото', 'интим фото',

  // ── Hindi / Arabic / Thai / Vietnamese / Korean / Indonesian ─────
  // Trimmed of everyday words that hid genuine posts (CJK/squashed
  // substring matching made these especially brutal):
  // 'भाभी' (sister-in-law — basic family word), 'سحاق' (also "grinding"),
  // 'นม' (milk), 'รับงาน' (freelance "taking jobs"), 'ไซด์ไลน์'
  // (sideline business), 'ngực' (chest — "chest pain" hid), 'cu'
  // (Vietnamese common word + "cu"=see you), 'nude' (fashion/makeup/
  // art), 'khỏa thân' (nude as in art), '가슴' (chest), '몸매' (figure),
  // '오피' (오피스텔/officetel = apartment!), '떡' (RICE CAKE — every
  // tteokbokki post hid), '섹스'/'쎅스'/'เซ็กส์'/'seks' (the standard
  // word — sex education content hid), 'janda' (widow/divorcee),
  // 'dewasa' ("adult" — completely standard), 'telanjang' ("naked eye").
  'चुदाई', 'चुत', 'लंड', 'बूब्स', 'नंगी', 'नग्न', 'सेक्स वीडियो',
  'देसी सेक्स', 'रंडी', 'एस्कॉर्ट',
  'سكس', 'نيك', 'زب', 'كس', 'طيز', 'بزاز', 'عاهرة', 'شرموطة',
  'قحبة', 'سكس عربي', 'افلام سكس', 'صور سكس', 'نياكة',
  'หนังโป๊', 'โป๊', 'เย็ด', 'ควย', 'หี', 'ขายตัว',
  'น้องรับงาน',
  'phim sex', 'sex việt', 'địt nhau', 'đụ', 'lồn',
  'gái gọi', 'gái bao', 'mại dâm', 'chịch',
  '야동', '야한', '보지', '자지', '유두',
  '성인영상', '성인방송', '벗방', '조건만남', '출장안마',
  '런피플', '섹파',
  'bokep', 'film bokep', 'ngentot', 'memek', 'kontol', 'toket',
  'tetek', 'bugil', 'abg bugil', 'open bo',
  'bispak', 'jablay', 'colmek',

  // ── Polish / Czech ───────────────────────────────────────────────
  // Trimmed: 'kozy' ("goats" — every Polish farm post hid), 'nago'
  // (also "Nago", a place name in Okinawa/Brazil). 'dupa' stays —
  // genuinely vulgar, the name collision is rare.
  'porno', 'dziwki', 'kurwy', 'prostytutki', 'sex randki',
  'gołe', 'nagie', 'cipki', 'cipka', 'chuja', 'chuj',
  'fiuty', 'fiut', 'cycki', 'rżnięcie', 'jebanie', 'dupa',
  'kurva', 'kurvy', 'šukat', 'šoustat', 'nahý', 'nahé', 'prsa',
  'píča', 'čůrat', 'sex seznamka',
];

/// Explicit-adult terms for PROFILE FIELDS (name / display name / bio /
/// NIP-05). This list is the post list plus the name-shaped patterns the
/// user called out: "free nudes in bio", dotted/nsfw usernames, porn-site
/// handles. Kept separate so tightening name rules never hides a post
/// quoting the same word.
const kExplicitProfileTerms = <String>[
  ...kExplicitTerms,
  // Username-shaped patterns
  'sexygirl', 'hotgirl', 'hotgirls', 'hotguys',
  'naughtygirl',
  'wetgirl', 'kinky', 'slut', 'slutty',
  'cumslut', 'fuckgirl', 'fuckme', 'sexyme', 'xxxgirl', 'girlnude',
  'nudegirl', 'nudegirls', 'nudewomen', 'milf', 'gilf', 'dilf',
  'daddykink', 'sugardaddy', 'sugarbaby', 'findom', 'paypig',
  'footfetish', 'feetpics', 'sellfeet', 'domme',
  'goddessworship', 'assworship', 'sph', 'joi', 'cei',
  // Escort/hookup solicitation in bios
  'dm for nudes', 'dm for sex', 'dm to buy',
  'buy my content', 'premium snap', 'premium snapchat', 'private snap',
  'spicy link', 'spicy content',
  'no ppv', 'free trial link', 'cam model', 'adult model',
  'adult performer', 'xxx model', 'xxx creator',
  'sugar baby wanted', 'hookups only', 'down to fuck',
  // Chinese name/bio patterns from spam waves
  '约吗', '可加', '看主页', '主页有', '私信有', '加v', '加微', '联系方式',
  '外围', '楼凤', '学生妹', '嫩模', '美女上门', '同城服务', '兼职女',
  // Japanese name/bio patterns
  '裏垢女子', '裏垢男子', 'えろ垢', 'エロ垢', 'オナ電', '通話募集',
  'ママ活', 'パパ募集', '円募集', 'ホ別', 'プチ援',
  // Other-language solicitation
  'contenido adulto', 'vendo contenido', 'fotos privadas',
  'conteúdo adulto', 'vendo pack',
  'privat für mehr', 'link in der bio', 'contenu privé', 'mym',
  'içerik satıyorum', 'özel içerik', 'link profilde',
  'пиши в лс', 'ссылка в шапке', 'контент 18', 'продам интим',
];
