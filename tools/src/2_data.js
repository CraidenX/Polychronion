'use strict';
/* =====================================================================
   ДЕРЖАВА ПАЛЕОЛОГОВ — один файл. Разделы:
   1. ДАННЫЕ (фракции, области, герои, законы)
   2. ЯДРО СТРАТЕГИИ (ходы, экономика, ИИ, осады, герои)
   3. СОБЫТИЯ (исторические и случайные)
   4. МОДУЛЬ БОЯ (BattleRules / BattleSim / BattleAI / BattleView) — отдельный
   5. ИНТЕРФЕЙС (карта, вкладки, окна)
   6. СОХРАНЕНИЕ И ЗАПУСК
   ===================================================================== */
const HEADLESS = typeof window === 'undefined' || !!(typeof globalThis !== 'undefined' && globalThis.__HEADLESS__);
const MAPINFO = /*MAPINFO*/null;

/* ---------- 1. ДАННЫЕ ---------- */
const BAL = { // все ручки баланса в одном месте
  incomeMul: 0.72, aiIncomeMul: 0.75, upkeepMul: 1.0, fleetCost: [0, 18, 34],
  osmanGrowth: 1.0, eventRate: 0.38, raidBase: 0.06,
};
const SEASONS = ['Весна', 'Лето', 'Осень', 'Зима'];
const START = { year: 1261, season: 1 };
const END = { year: 1347, season: 1 };

const FACTIONS = {
  byz:      { name: 'Ромейская империя', short: 'Ромеи', color: '#7a2f8f', greek: true },
  epirus:   { name: 'Эпирский деспотат', short: 'Эпир', color: '#2f8f7a', greek: true, rel: -40, war: true, aggr: .5, mix: [5, 2, 3, 0] },
  achaea:   { name: 'Ахейское княжество', short: 'Ахайя', color: '#d4a22a', rel: -50, war: true, aggr: .5, mix: [3, 4, 1, 1] },
  athens:   { name: 'Афинское герцогство', short: 'Афины', color: '#e0c860', rel: -10, aggr: .2, mix: [3, 3, 1, 1] },
  venice:   { name: 'Венецианская республика', short: 'Венеция', color: '#c0303a', rel: -30, war: true, aggr: .15, mix: [3, 1, 3, 3], trade: true },
  genoa:    { name: 'Генуэзская республика', short: 'Генуя', color: '#3e74b8', rel: 40, aggr: .1, mix: [3, 1, 3, 3], trade: true },
  bulgaria: { name: 'Болгарское царство', short: 'Болгары', color: '#4f8f36', rel: -20, aggr: .45, mix: [4, 4, 2, 0] },
  serbia:   { name: 'Сербское королевство', short: 'Сербы', color: '#b5602a', rel: 0, aggr: .45, mix: [5, 3, 2, 1] },
  trebizond:{ name: 'Трапезундская империя', short: 'Трапезунд', color: '#a07ac8', rel: 10, aggr: .05, mix: [4, 2, 2, 0], greek: true },
  seljuk:   { name: 'Румский султанат', short: 'Сельджуки', color: '#6a9a2a', rel: 10, aggr: .35, mix: [2, 5, 4, 0] },
  osman:    { name: 'Бейлик Османа', short: 'Османы', color: '#1f6b48', rel: -60, aggr: .9, mix: [2, 5, 4, 0] },
  germiyan: { name: 'Бейлик Гермиян', short: 'Гермиян', color: '#8a7a30', rel: -30, aggr: .5, mix: [2, 5, 3, 0] },
  menteshe: { name: 'Бейлик Ментеше', short: 'Ментеше', color: '#3a7a8a', rel: -30, aggr: .5, mix: [2, 4, 3, 0] },
  aydin:    { name: 'Бейлик Айдын', short: 'Айдын', color: '#9a9a30', rel: -50, aggr: .8, mix: [2, 5, 3, 0] },
  karasi:   { name: 'Бейлик Караси', short: 'Караси', color: '#5a9a72', rel: -40, aggr: .7, mix: [2, 5, 3, 0] },
  anjou:    { name: 'Анжуйцы (Карл I)', short: 'Анжуйцы', color: '#2e4fa8', rel: -60, aggr: .7, mix: [3, 3, 2, 4] },
  catalan:  { name: 'Каталонская компания', short: 'Каталонцы', color: '#d0502a', rel: 0, aggr: .8, mix: [2, 2, 2, 6] },
  thessaly: { name: 'Фессалия (Неопатры)', short: 'Фессалия', color: '#7f996a', rel: -20, aggr: .3, mix: [4, 3, 2, 0], greek: true },
  vlachs:   { name: 'Валашские воеводства', short: 'Валахи', color: '#a5734f', rel: 0, aggr: .2, mix: [3, 4, 2, 0] },
  hungary:  { name: 'Венгерское королевство', short: 'Венгрия', color: '#8a4a52', rel: 0, aggr: .2, mix: [3, 4, 2, 1] },
  candar:   { name: 'Бейлик Чобаногуллары', short: 'Чобаногуллары', color: '#d9b860', rel: -20, aggr: .5, mix: [2, 5, 3, 0] },
  kefalonia:{ name: 'Пфальцграфство Кефалония (Орсини)', short: 'Кефалония', color: '#d3acb9', rel: 0, aggr: .1, mix: [3, 2, 1, 2] },
  naxos:    { name: 'Герцогство Архипелаг (Санудо)', short: 'Архипелаг', color: '#18327b', rel: -10, aggr: .1, mix: [3, 1, 2, 2] },
  salona:   { name: 'Сеньория Салона', short: 'Салона', color: '#4cff00', rel: -10, aggr: .05, mix: [2, 3, 1, 1] },
  bodonitsa:{ name: 'Маркграфство Бодоница', short: 'Бодоница', color: '#fc70d6', rel: -10, aggr: .05, mix: [2, 3, 1, 1] },
  papal:    { name: 'Папская область (Беневенто)', short: 'Папство', color: '#fff8d6', rel: 0, aggr: 0, mix: [3, 2, 1, 1] },
  makri:    { name: 'Владение на Ликийском побережье', short: 'Ликийцы', color: '#267f00', rel: 0, aggr: .05, mix: [3, 2, 2, 0] },
  georgia:  { name: 'Грузинское царство', short: 'Грузия', color: '#386599', rel: 20, aggr: .1, mix: [3, 4, 2, 0], greek: false },
  bosnia:   { name: 'Бановина Босния', short: 'Босния', color: '#f0a782', rel: 0, aggr: .1, mix: [4, 3, 2, 0] },
  armenia:  { name: 'Киликийская Армения', short: 'Армения', color: '#d68cbe', rel: 10, aggr: .05, mix: [3, 4, 2, 1] },
  mamluk:   { name: 'Мамлюкский султанат', short: 'Мамлюки', color: '#bca65d', rel: 10, aggr: .1, mix: [2, 5, 3, 1] },
  outremer: { name: 'Иерусалимское королевство (Акра)', short: 'Крестоносцы', color: '#f7f9fd', rel: 0, aggr: .05, mix: [2, 3, 1, 3] },
  antioch:  { name: 'Антиохия и Триполи', short: 'Антиохия', color: '#a3bff3', rel: 0, aggr: .05, mix: [2, 3, 1, 3] },
  ilkhan:   { name: 'Ильханат', short: 'Ильханы', color: '#e83002', rel: 0, aggr: .1, mix: [1, 6, 4, 0] },
  karaman:  { name: 'Караманиды', short: 'Караман', color: '#3a96b2', rel: -10, aggr: .3, mix: [2, 5, 3, 0] },
  sicily:   { name: 'Сицилийское королевство', short: 'Сицилия', color: '#5a4fb0', rel: 0, aggr: .05, mix: [3, 3, 2, 2] },
  cyprus:   { name: 'Кипрское королевство', short: 'Кипр', color: '#e88a20', rel: 0, aggr: .05, mix: [3, 3, 2, 2] },
  rebel:    { name: 'Мятежники', short: 'Мятежники', color: '#555055', rel: -80, aggr: .55, mix: [5, 2, 3, 1], greek: true },
};
// [ид, имя, владелец, доход, население(тыс.), укрепления, гарнизон, настроение, местность]
const LEGACY_REGIONS = [
  ['konst', 'Константинополь', 'byz', 55, 100, 5, 1500, 62, 'walls'],
  ['thrace', 'Фракия', 'byz', 22, 120, 3, 600, 58, 'river'],
  ['rhodope', 'Родопы', 'byz', 12, 70, 2, 400, 55, 'mountains'],
  ['serres', 'Серры', 'byz', 14, 70, 2, 400, 55, 'river'],
  ['thessal', 'Фессалоники', 'byz', 30, 100, 4, 900, 55, 'coast'],
  ['ohrid', 'Охрид', 'byz', 9, 50, 2, 300, 48, 'mountains'],
  ['skopje', 'Скопье', 'byz', 9, 50, 2, 300, 45, 'hills'],
  ['thessaly', 'Фессалия', 'epirus', 16, 80, 2, 500, 50, 'plain'],
  ['epirus', 'Эпир', 'epirus', 12, 60, 3, 500, 55, 'mountains'],
  ['dyrr', 'Диррахий', 'epirus', 10, 40, 3, 400, 50, 'hills'],
  ['morea', 'Морея', 'byz', 14, 60, 4, 500, 52, 'mountains'],
  ['achaea', 'Ахайя', 'achaea', 16, 70, 3, 600, 55, 'hills'],
  ['athens', 'Афины', 'athens', 15, 60, 3, 500, 55, 'hills'],
  ['negro', 'Негропонт', 'venice', 12, 30, 3, 400, 55, 'hills'],
  ['crete', 'Крит', 'venice', 25, 80, 3, 800, 50, 'mountains'],
  ['archip', 'Архипелаг', 'venice', 10, 30, 2, 300, 55, 'coast'],
  ['lesbos', 'Лесбос', 'byz', 8, 30, 2, 250, 60, 'hills'],
  ['chios', 'Хиос', 'byz', 10, 25, 2, 250, 60, 'hills'],
  ['bithynia', 'Никея', 'byz', 16, 60, 4, 700, 62, 'hills'],
  ['nikomed', 'Никомедия', 'byz', 12, 50, 3, 500, 58, 'hills'],
  ['prusa', 'Прусса', 'byz', 14, 60, 3, 500, 58, 'mountains'],
  ['mysia', 'Мисия', 'byz', 12, 60, 2, 400, 55, 'plain'],
  ['smyrna', 'Смирна', 'byz', 14, 60, 3, 500, 58, 'river'],
  ['phila', 'Филадельфия', 'byz', 12, 50, 3, 500, 60, 'plain'],
  ['sogut', 'Сёгют', 'seljuk', 6, 30, 1, 300, 50, 'hills'],
  ['germiyan', 'Кютахья', 'seljuk', 8, 50, 2, 400, 50, 'hills'],
  ['konya', 'Иконий', 'seljuk', 18, 120, 3, 1000, 55, 'plain'],
  ['caria', 'Карий', 'seljuk', 9, 50, 2, 300, 50, 'mountains'],
  ['paphl', 'Пафлагония', 'seljuk', 9, 60, 2, 400, 50, 'forest'],
  ['trebiz', 'Трапезунд', 'trebizond', 18, 70, 4, 800, 60, 'mountains'],
  ['tarnovo', 'Тырново', 'bulgaria', 18, 100, 3, 800, 60, 'forest'],
  ['sofia', 'Средец', 'bulgaria', 12, 70, 3, 500, 58, 'hills'],
  ['mesemb', 'Месемврия', 'bulgaria', 10, 40, 3, 400, 48, 'coast'],
  ['rascia', 'Рашка', 'serbia', 15, 90, 2, 600, 60, 'forest'],
];
const LEGACY_GREEK = ['konst','thrace','rhodope','serres','thessal','ohrid','thessaly','epirus','morea','achaea','athens','negro','crete','archip','lesbos','chios','bithynia','nikomed','prusa','mysia','smyrna','phila','mesemb','trebiz'];
const LEGACY_PORTS = ['lesbos','chios','negro','archip','crete','smyrna','morea','thessal','mesemb'];
const LEGACY_ANATOLIA = ['bithynia','nikomed','prusa','mysia','smyrna','phila','sogut','germiyan','konya','caria','paphl','trebiz'];
// связи: land — суша, strait — пролив (без флота), sea — море (нужен флот у ромеев)
const LEGACY_LINKS = [
  ['konst','thrace','land'],['konst','nikomed','strait'],['konst','bithynia','strait'],['konst','prusa','sea'],['konst','mesemb','sea'],['konst','trebiz','sea'],['konst','thessal','sea'],
  ['thrace','rhodope','land'],['thrace','mesemb','land'],['thrace','tarnovo','land'],['thrace','mysia','strait'],
  ['rhodope','serres','land'],['rhodope','sofia','land'],['rhodope','tarnovo','land'],
  ['serres','thessal','land'],['serres','skopje','land'],['serres','sofia','land'],
  ['thessal','ohrid','land'],['thessal','skopje','land'],['thessal','thessaly','land'],['thessal','lesbos','sea'],
  ['ohrid','skopje','land'],['ohrid','dyrr','land'],['ohrid','epirus','land'],['ohrid','thessaly','land'],
  ['skopje','sofia','land'],['skopje','rascia','land'],['skopje','dyrr','land'],
  ['thessaly','epirus','land'],['thessaly','athens','land'],['thessaly','negro','strait'],
  ['epirus','dyrr','land'],['epirus','achaea','sea'],['dyrr','rascia','land'],
  ['athens','achaea','land'],['athens','morea','land'],['athens','negro','strait'],['achaea','morea','land'],
  ['morea','crete','sea'],['morea','archip','sea'],['negro','archip','sea'],['archip','crete','sea'],['archip','chios','sea'],['archip','caria','sea'],
  ['lesbos','mysia','sea'],['lesbos','chios','sea'],['chios','smyrna','strait'],
  ['bithynia','nikomed','land'],['bithynia','prusa','land'],['bithynia','sogut','land'],['bithynia','germiyan','land'],
  ['nikomed','sogut','land'],['nikomed','paphl','land'],['prusa','mysia','land'],['prusa','germiyan','land'],['prusa','sogut','land'],
  ['mysia','smyrna','land'],['mysia','phila','land'],['mysia','germiyan','land'],
  ['smyrna','phila','land'],['smyrna','caria','land'],['phila','caria','land'],['phila','germiyan','land'],['phila','konya','land'],
  ['sogut','germiyan','land'],['sogut','konya','land'],['sogut','paphl','land'],['germiyan','konya','land'],['caria','konya','land'],
  ['konya','paphl','land'],['paphl','trebiz','land'],
  ['tarnovo','sofia','land'],['tarnovo','mesemb','land'],['sofia','rascia','land'],['rascia','dyrr','land'],
];
// Регионы с карты автора (генерируются сборкой из source/*.png); без них — старые 34 области
const GEN = /*GEN*/null;
const REGION_DEFS = GEN ? GEN.regions : LEGACY_REGIONS;
const LINKS = GEN ? GEN.links : LEGACY_LINKS;
const ALIAS = GEN ? GEN.alias : {};      // старые ид. областей -> регион карты (для исторических событий)
const GREEK_REGIONS = GEN ? GEN.greek : LEGACY_GREEK;
const ANATOLIA = GEN ? GEN.anatolia : LEGACY_ANATOLIA;
const SEA_PORTS = GEN ? GEN.ports : LEGACY_PORTS;
// цвета держав — с карты автора
if (GEN && GEN.fcolors) for (const f in GEN.fcolors) if (FACTIONS[f]) FACTIONS[f].color = GEN.fcolors[f];
const TERRAIN_NAMES = { plain: 'равнина', hills: 'холмы', mountains: 'горы', forest: 'леса', river: 'река', coast: 'побережье', walls: 'стены' };

const UNIT = { // тип: имя, людей в отряде, атака, защита, скорость, дальность, цена найма, содержание за 100 чел./сезон
  inf:  { name: 'Пехота', men: 400, atk: 5, def: 6, spd: 2, rng: 1, cost: 18, up: 1.3, icon: '▣' },
  cav:  { name: 'Конница', men: 200, atk: 8, def: 4, spd: 4, rng: 1, cost: 28, up: 3.6, icon: '♞' },
  arch: { name: 'Лучники', men: 300, atk: 4, def: 3, spd: 2, rng: 3, cost: 20, up: 1.8, icon: '➶' },
  merc: { name: 'Наёмники', men: 300, atk: 8, def: 7, spd: 3, rng: 1, cost: 42, up: 4.6, icon: '✠' },
};
const UTYPES = ['inf', 'cav', 'arch', 'merc'];

const ROLES = {
  general:  { name: 'Полководец', icon: '⚔', skills: ['Тактика', 'Лидерство'] },
  merchant: { name: 'Купец', icon: '⚖', skills: ['Торговля', 'Связи'] },
  governor: { name: 'Наместник', icon: '⌂', skills: ['Управление', 'Правосудие'] },
  priest:   { name: 'Священник', icon: '☦', skills: ['Проповедь', 'Богословие'] },
  spy:      { name: 'Шпион', icon: '◉', skills: ['Скрытность', 'Интрига'] },
  diplomat: { name: 'Дипломат', icon: '✉', skills: ['Красноречие', 'Связи'] },
};
const TRAITS = {
  'Храбрый':      'В бою +10% к натиску, но чаще гибнет.',
  'Осторожный':   'В бою +10% к защите, реже гибнет.',
  'Талантливый':  'Опыт растёт в полтора раза быстрее.',
  'Жадный':       'Может запустить руку в казну; верность падает без жалованья.',
  'Честолюбивый': '+10% к успеху поручений, но верность медленно падает.',
  'Верный':       'Никогда не предаст.',
  'Набожный':     'Церковь любит его: +к делам веры.',
  'Хитрый':       '+15% к интригам и переговорам.',
  'Учёный':       '+к богословию и дипломатии.',
  'Жестокий':     'Наместником держит порядок, но жители его ненавидят.',
  'Щедрый':       'Наместником радует жителей, но тратит доход.',
  'Пьяница':      '−10% ко всему.',
  'Красноречивый':'+15% к переговорам и проповеди.',
  'Удачливый':    'Реже гибнет и попадает в плен.',
};
const TRAIT_LIST = Object.keys(TRAITS);
const FIRST = ['Михаил','Иоанн','Феодор','Алексей','Георгий','Константин','Никифор','Димитрий','Мануил','Андроник','Исаак','Никита','Василий','Лев','Стефан','Фома','Николай','Феодосий','Григорий','Арсений'];
const LAST = ['Палеолог','Кантакузин','Ласкарис','Тарханиот','Филантропен','Ангел','Дука','Ватац','Метохит','Хумн','Синадин','Торник','Рауль','Апокавк','Асень','Враной','Глава','Цамплакон','Музалон','Мономах','Вриенний','Ливадарий','Котерц','Струмпица','Мелиссин'];
const ROLE_DESC = {
  general: ['ветеран малоазийских походов', 'из старого рода стратиотов', 'служил ещё никейским императорам', 'начинал простым командиром пронияров'],
  merchant: ['знает каждого менялу в Галате', 'держит склады на Золотом Роге', 'торговал зерном с Каффой', 'говорит по-итальянски лучше иного генуэзца'],
  governor: ['строгий хозяин и знаток налоговых описей', 'составлял писцовые книги Фракии', 'любим простым людом', 'из чиновников логофета'],
  priest: ['игумен монастыря на Афоне', 'ученик знаменитого богослова', 'проповедник из Фессалоник', 'монах, переписывающий книги'],
  spy: ['бывший слуга при латинском дворе', 'говорит на пяти языках', 'тень, которой никто не помнит в лицо', 'из семьи константинопольских менял'],
  diplomat: ['бывал при папском дворе', 'учился в Никее у лучших риторов', 'вёл переговоры с монголами', 'знает обычаи сельджукского двора'],
};
// исторические герои: [имя, роль, уровень, черты, описание, появляется(год), исчезает(год)]
const HIST_HEROES = [
  ['Алексей Стратигопул', 'general', 3, ['Храбрый', 'Удачливый'], 'Кесарь, 25 июля 1261 года почти без боя занявший Константинополь.', 1261, 1275],
  ['Иоанн Палеолог', 'general', 4, ['Талантливый', 'Верный'], 'Деспот, брат императора, победитель при Пелагонии.', 1261, 1274],
  ['Георгий Акрополит', 'diplomat', 3, ['Учёный', 'Красноречивый'], 'Великий логофет и историк; поедет в Лион подписывать унию.', 1261, 1282],
  ['Арсений Авториан', 'priest', 3, ['Набожный', 'Честолюбивый'], 'Патриарх, который не простит императору ослепления юного Иоанна IV.', 1261, 1270],
  ['Константин Торник', 'governor', 2, ['Верный', 'Щедрый'], 'Опытный правитель из никейской администрации.', 1261, 1290],
  ['Николай Пульхерий', 'merchant', 2, ['Хитрый', 'Жадный'], 'Делец, помогавший заключить Нимфейский договор с Генуей.', 1261, 1285],
  ['Бенедетто Заккария', 'merchant', 3, ['Хитрый', 'Честолюбивый'], 'Генуэзский адмирал и торговец фокейскими квасцами.', 1264, 1307],
  ['Михаил Глава Тарханиот', 'general', 3, ['Осторожный', 'Набожный'], 'Протостратор, полководец трёх императоров.', 1270, 1305],
  ['Иоанн Векк', 'priest', 3, ['Учёный', 'Красноречивый'], 'Хартофилакс, ставший сторонником унии с Римом.', 1272, 1290],
  ['Феодор Музалон', 'diplomat', 2, ['Хитрый', 'Учёный'], 'Великий логофет Андроника II.', 1280, 1294],
  ['Алексей Филантропен', 'general', 4, ['Храбрый', 'Честолюбивый'], 'Победоносный полководец, которого солдаты захотят видеть императором.', 1290, 1310],
  ['Феодор Метохит', 'governor', 4, ['Учёный', 'Жадный'], 'Великий логофет, учёный и богач, построивший мозаики Хоры.', 1295, 1328],
  ['Никифор Хумн', 'governor', 3, ['Учёный', 'Верный'], 'Месазон, философ и тесть деспота Иоанна.', 1292, 1327],
  ['Михаил IX Палеолог', 'general', 2, ['Храбрый', 'Верный'], 'Соправитель, сын Андроника II. Невезучий воин.', 1294, 1320],
  ['Иоанн Кантакузин', 'general', 4, ['Талантливый', 'Честолюбивый'], 'Друг Андроника III, великий доместик, будущий император.', 1320, 1347],
  ['Алексей Апокавк', 'spy', 3, ['Хитрый', 'Честолюбивый'], 'Выскочка из низов, мастер интриг и денег.', 1320, 1345],
  ['Сиргиан Палеолог', 'general', 3, ['Храбрый', 'Честолюбивый'], 'Блестящий и ненадёжный вельможа; трижды сменит сторону.', 1318, 1334],
  ['Никифор Григора', 'priest', 3, ['Учёный', 'Красноречивый'], 'Историк и астроном, противник паламитов.', 1322, 1347],
  ['Григорий Палама', 'priest', 4, ['Набожный', 'Красноречивый'], 'Афонский монах, учитель исихазма.', 1334, 1347],
  ['Варлаам Калабрийский', 'diplomat', 3, ['Учёный', 'Хитрый'], 'Учёный монах, посол к папе в 1339 году.', 1333, 1342],
];
const RULERS = [
  { name: 'Михаил VIII Палеолог', from: [1261, 1], to: [1282, 3], mar: 3, stw: 3, dip: 5, pie: 1, desc: 'Хитрый основатель династии, отвоевавший Город.' },
  { name: 'Андроник II Палеолог', from: [1282, 3], to: [1328, 0], mar: 1, stw: 3, dip: 3, pie: 5, desc: 'Благочестивый книжник; любит Церковь больше флота.' },
  { name: 'Андроник III Палеолог', from: [1328, 0], to: [1341, 1], mar: 4, stw: 2, dip: 3, pie: 2, desc: 'Молодой, весёлый, воинственный император.' },
  { name: 'Иоанн V Палеолог (регентство)', from: [1341, 1], to: [1348, 0], mar: 1, stw: 1, dip: 2, pie: 2, desc: 'Ребёнок на троне; правят регенты.', minor: true },
];
const LAWS = {
  akritai: { name: 'Льготы акритам', desc: 'Пограничные воины Анатолии не платят налогов. Дорого, но граница держится.', on: '−8 дохода, Анатолия крепче против набегов, +настроение там', off: 'Михаил VIII отменил эти льготы — граница ослабла' },
  monktax: { name: 'Налог на монастыри', desc: 'Обложить богатые монастырские земли.', on: '+8% дохода, Церковь −1 за сезон' },
  pronoia: { name: 'Наследственные пронии', desc: 'Разрешить знати передавать пронии сыновьям.', on: 'Порядок +, верность героев +; доход −5%, наём пехоты дороже' },
  judges: { name: 'Вселенские судьи', desc: 'Суд четырёх «вселенских судей» против произвола сборщиков и вельмож (Андроник III, 1329).', on: 'Содержание 6 за сезон; настроение +3 везде, порядок +' },
  genoapriv: { name: 'Привилегии Генуе', desc: 'Нимфейский договор: генуэзцы торгуют без пошлин.', on: 'Генуя дружит, купцы у Генуи +30%; таможня −6' },
  grain: { name: 'Запрет вывоза зерна', desc: 'Держать хлеб дома, а не продавать итальянцам.', on: 'Настроение +2, порядок +; торговля −20%, Венеция и Генуя недовольны' },
};
const BUILD_PRIO = { forts: 'Укрепления на границе', econ: 'Хозяйство и дороги', church: 'Храмы и монастыри', walls: 'Стены Константинополя' };
