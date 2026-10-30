// UI strings. Keys are grouped by area; `{name}` placeholders are filled by `t`.

export type Lang = "ru" | "en";

const en = {
  "app.record": "Record",
  "app.stop": "Stop recording",
  "app.game": "Game",
  "app.import": "Import replay",
  "app.importTitle": "Import an Assetto Corsa replay (.acreplay). You can also drop the file on the window.",
  "source.auto": "Auto",
  "source.demo": "Demo",
  "rec.starting": "Starting…",
  "rec.stopping": "Stopping…",
  "rec.recording": "Recording",
  "rec.waiting": "Waiting for the game…",
  "rec.onTrack": "Recording: {track}",
  "rec.lap": "Lap {n}: {time}",
  "toast.lapInvalid": "Lap {n} ({time}) doesn't count",
  "toast.saved": "Session saved: {laps}",
  "toast.exported": "Saved to {path}",
  "toast.importing": "Importing {file}…",
  "toast.imported": "Imported {track}: {laps}",
  "drop.hint": "Drop the .acreplay file to import it",
  "dialog.replay": "Assetto Corsa replay",
  "date.today": "Today",
  "date.yesterday": "Yesterday",

  "sessions.empty": "Your sessions will appear here.",
  "sessions.unknownTrack": "Unknown track",
  "sessions.unknownCar": "Unknown car",
  "sessions.live": "recording",

  "welcome.title": "Record your first session",
  "welcome.text": "Start Assetto Corsa or ACC, press Record and drive a few laps. StatsMeister finds the laps on its own and shows which corners cost you time.",
  "welcome.replay": "Got an AC replay? Drop the .acreplay file on the window or import it below.",
  "welcome.demo": "Try it with demo data",
  "welcome.demoBusy": "Preparing the demo…",

  "session.best": "Best lap",
  "tab.review": "Review",
  "tab.telemetry": "Charts",
  "tab.progress": "Progress",

  "lap.n": "Lap {n}",
  "lap.best": "Best lap",
  "lap.pbFrom": "Record from {date}",
  "laps.best": "best",
  "laps.partial": "incomplete",
  "laps.pit": "pit",
  "laps.cut": "track limits",

  "review.recording": "This session is still being recorded. The review appears once you stop recording or leave the game.",
  "review.noValid": "This session has no complete counted laps yet, so there is nothing to compare.",
  "review.lead": "Your best lap is {time} (lap {n}).",
  "review.potential": "Put your best stretches from every lap together and you get {time}: {gain} s you have already driven, just not in one lap.",
  "review.pb": "Your record here is {time} from {date}, {gap} s away.",
  "review.newPb": "That's a new personal record on this track.",
  "review.lossTitle": "Where the time goes",
  "review.single": "Only one counted lap so far. Drive a few more and a comparison will appear here.",
  "review.lossNone": "{lap} is close to your best lap in every corner.",
  "review.more": "{n} more corners lose a little time. See the Charts tab for details.",
  "review.corner": "Corner {n}",
  "review.lost": "+{s} s",
  "review.show": "Show",
  "review.hide": "Hide",
  "review.lapsTitle": "Laps",
  "review.lapsHint": "Click a lap to compare it with your best.",

  "compare.label": "Compare",
  "compare.vsLap": "Best lap with lap {n} ({time})",
  "compare.vsPb": "Personal record ({time}, {date}) with today's best",

  "hint.brakes_where_reference_lifts": "On your best lap a lift is enough here, but this time you brake. Try it without the brake: lift and let the front load up.",
  "hint.overdriven_entry": "You brake {later_m} m later but are {slower_kmh} km/h slower at the apex, so the late braking doesn't pay off. Brake where you did on your best lap and release more smoothly.",
  "hint.early_braking": "You start braking {earlier_m} m earlier than on your best lap. Move the braking point closer to the corner.",
  "hint.slow_apex": "{slower_kmh} km/h slower at the apex with the same braking point. Come off the brake earlier and carry more speed in.",
  "hint.entry_speed_costs_exit": "{faster_kmh} km/h faster at the apex, but full throttle comes {later_m} m later: the extra entry speed costs you the exit. Slow down a little more and get on the power earlier.",
  "hint.fast_apex_slow_exit": "{faster_kmh} km/h faster at the apex, but {slower_kmh} km/h slower by the end of the next straight: the entry speed costs you the exit. Slow down a little more on entry and get a straighter exit.",
  "hint.late_throttle": "Full throttle {later_m} m later than on your best lap. Unwind the wheel sooner and get on the power earlier.",
  "hint.slow_exit": "{slower_kmh} km/h slower by the end of the next straight: the exit is worse, and that costs time all the way down the straight.",
  "hint.line": "Pedals and speed are close to your best lap, so the difference is the line. Compare steering and the map in the Charts tab.",

  "tele.export": "Export lap to CSV",
  "corners.corner": "Corner",
  "corners.time": "Time",
  "corners.minSpeed": "Min speed",
  "corners.deltaMin": "Difference",
  "corners.brake": "Braking",
  "corners.throttle": "Full throttle",
  "corners.bOnly": "extra brake",
  "corners.aOnly": "no brake",
  "corners.same": "same",

  "potential.title": "Potential {time}",
  "potential.sub": "Best stretches from all laps of this session. Click a row to compare.",
  "potential.reserve": "Reserve",
  "potential.from": "Best on",
  "potential.spread": "Spread",

  "cursor.hover": "Hover a chart to see the values at that point.",
  "cursor.distance": "Distance",
  "cursor.time": "Time",
  "stats.title": "Whole lap",

  "ch.speed": "Speed",
  "ch.throttle": "Throttle",
  "ch.brake": "Brake",
  "ch.steer": "Steering",
  "ch.gear": "Gear",
  "ch.rpm": "RPM",
  "ch.g_lat": "Lateral G",
  "ch.g_long": "Longitudinal G",
  "ch.delta": "Time difference",

  "st.maxSpeed": "Top speed",
  "st.avgSpeed": "Average speed",
  "st.fullThrottle": "Full throttle",
  "st.braking": "Braking",
  "st.coasting": "Coasting",
  "st.maxLatG": "Max lateral G",
  "st.maxBrakeG": "Max braking G",

  "progress.empty": "No finished sessions on this track yet.",
  "progress.lead": "{sessions} on this track with this car, {laps} in total. Your record is {time} from {date}.",
  "progress.lastPb": "The record was set in the latest session.",
  "progress.lastSlower": "The latest session was {gap} s off the record.",
  "progress.improved": "Since the first session you have found {gap} s.",
  "progress.single": "One session so far. Come back to this track and a progress chart will appear here.",
  "progress.date": "Date",
  "progress.laps": "Laps",
  "progress.best": "Best lap",
  "progress.toPb": "To record",
  "progress.potential": "Potential",
  "progress.median": "Typical lap",
  "progress.spread": "Spread",
  "progress.hint": "Click a session to open its review.",

  "unit.m": "m",
  "unit.s": "s",
  "unit.kmh": "km/h",
};

type Key = keyof typeof en;

const ru: Record<Key, string> = {
  "app.record": "Записать",
  "app.stop": "Остановить запись",
  "app.game": "Игра",
  "app.import": "Импорт реплея",
  "app.importTitle": "Импорт реплея Assetto Corsa (.acreplay). Файл можно просто перетащить в окно.",
  "source.auto": "Авто",
  "source.demo": "Демо",
  "rec.starting": "Запускаем…",
  "rec.stopping": "Останавливаем…",
  "rec.recording": "Идёт запись",
  "rec.waiting": "Ждём игру…",
  "rec.onTrack": "Запись: {track}",
  "rec.lap": "Круг {n}: {time}",
  "toast.lapInvalid": "Круг {n} ({time}) не засчитан",
  "toast.saved": "Сессия сохранена: {laps}",
  "toast.exported": "Сохранено в {path}",
  "toast.importing": "Импортируем {file}…",
  "toast.imported": "Импортировано: {track}, {laps}",
  "drop.hint": "Отпустите файл .acreplay, чтобы импортировать",
  "dialog.replay": "Реплей Assetto Corsa",
  "date.today": "Сегодня",
  "date.yesterday": "Вчера",

  "sessions.empty": "Здесь появятся ваши сессии.",
  "sessions.unknownTrack": "Неизвестная трасса",
  "sessions.unknownCar": "Неизвестная машина",
  "sessions.live": "запись",

  "welcome.title": "Запишите первую сессию",
  "welcome.text": "Запустите Assetto Corsa или ACC, нажмите «Записать» и проедьте несколько кругов. StatsMeister сам найдёт круги и покажет, в каких поворотах уходит время.",
  "welcome.replay": "Есть реплей AC? Перетащите файл .acreplay в окно или импортируйте его кнопкой ниже.",
  "welcome.demo": "Посмотреть на демо-данных",
  "welcome.demoBusy": "Готовим демо…",

  "session.best": "Лучший круг",
  "tab.review": "Разбор",
  "tab.telemetry": "Графики",
  "tab.progress": "Прогресс",

  "lap.n": "Круг {n}",
  "lap.best": "Лучший круг",
  "lap.pbFrom": "Рекорд от {date}",
  "laps.best": "лучший",
  "laps.partial": "неполный",
  "laps.pit": "пит",
  "laps.cut": "срезка",

  "review.recording": "Сессия ещё записывается. Разбор появится, когда вы остановите запись или выйдете из игры.",
  "review.noValid": "В этой сессии пока нет полных засчитанных кругов, сравнивать нечего.",
  "review.lead": "Лучший круг {time} (круг {n}).",
  "review.potential": "Если сложить ваши лучшие отрезки со всех кругов, выйдет {time}. Эти {gain} с вы уже проезжали, просто не в одном круге.",
  "review.pb": "Ваш рекорд здесь {time} от {date}, до него {gap} с.",
  "review.newPb": "Это новый личный рекорд на этой трассе.",
  "review.lossTitle": "Где уходит время",
  "review.single": "Пока один засчитанный круг. Проедьте ещё несколько, и здесь появится сравнение.",
  "review.lossNone": "{lap} почти нигде не уступает лучшему кругу.",
  "review.more": "Ещё поворотов с небольшими потерями: {n}. Подробности во вкладке «Графики».",
  "review.corner": "Поворот {n}",
  "review.lost": "+{s} с",
  "review.show": "Показать",
  "review.hide": "Скрыть",
  "review.lapsTitle": "Круги",
  "review.lapsHint": "Нажмите на круг, чтобы сравнить его с лучшим.",

  "compare.label": "Сравнение",
  "compare.vsLap": "Лучший круг и круг {n} ({time})",
  "compare.vsPb": "Личный рекорд ({time}, {date}) и лучший круг сегодня",

  "hint.brakes_where_reference_lifts": "На лучшем круге здесь хватает сброса газа, а в этот раз вы тормозите. Попробуйте без тормоза: сбросьте газ и дайте машине загрузить перед.",
  "hint.overdriven_entry": "Тормозите на {later_m} м позже, но в апексе на {slower_kmh} км/ч медленнее, так что позднее торможение не окупается. Тормозите там же, где на лучшем круге, и отпускайте тормоз плавнее.",
  "hint.early_braking": "Начинаете тормозить на {earlier_m} м раньше, чем на лучшем круге. Сдвиньте точку торможения ближе к повороту.",
  "hint.slow_apex": "В апексе на {slower_kmh} км/ч медленнее при той же точке торможения. Отпускайте тормоз раньше и несите больше скорости в поворот.",
  "hint.entry_speed_costs_exit": "В апексе на {faster_kmh} км/ч быстрее, но полный газ на {later_m} м позже: лишняя скорость на входе мешает выходу. Погасите чуть больше и откройте газ раньше.",
  "hint.fast_apex_slow_exit": "В апексе на {faster_kmh} км/ч быстрее, но к концу следующей прямой на {slower_kmh} км/ч медленнее: скорость на входе съедает выход. Погасите чуть больше на входе и выходите прямее.",
  "hint.late_throttle": "Полный газ на {later_m} м позже, чем на лучшем круге. Раньше выпрямляйте руль и открывайте газ.",
  "hint.slow_exit": "К концу следующей прямой на {slower_kmh} км/ч медленнее: выход хуже, и время уходит на всей прямой.",
  "hint.line": "Педали и скорость почти как на лучшем круге, значит, дело в траектории. Сравните руль и карту во вкладке «Графики».",

  "tele.export": "Экспорт круга в CSV",
  "corners.corner": "Поворот",
  "corners.time": "Время",
  "corners.minSpeed": "Мин. скорость",
  "corners.deltaMin": "Разница",
  "corners.brake": "Торможение",
  "corners.throttle": "Полный газ",
  "corners.bOnly": "лишний тормоз",
  "corners.aOnly": "без тормоза",
  "corners.same": "так же",

  "potential.title": "Потенциал {time}",
  "potential.sub": "Лучшие отрезки со всех кругов сессии. Нажмите на строку, чтобы сравнить.",
  "potential.reserve": "Резерв",
  "potential.from": "Лучше всего",
  "potential.spread": "Разброс",

  "cursor.hover": "Наведите курсор на график, чтобы увидеть значения в этой точке.",
  "cursor.distance": "Дистанция",
  "cursor.time": "Время",
  "stats.title": "Круг целиком",

  "ch.speed": "Скорость",
  "ch.throttle": "Газ",
  "ch.brake": "Тормоз",
  "ch.steer": "Руль",
  "ch.gear": "Передача",
  "ch.rpm": "Обороты",
  "ch.g_lat": "Боковая перегрузка",
  "ch.g_long": "Продольная перегрузка",
  "ch.delta": "Разница во времени",

  "st.maxSpeed": "Макс. скорость",
  "st.avgSpeed": "Средняя скорость",
  "st.fullThrottle": "Полный газ",
  "st.braking": "Торможение",
  "st.coasting": "Накат",
  "st.maxLatG": "Макс. боковая G",
  "st.maxBrakeG": "Макс. G торможения",

  "progress.empty": "На этой трассе пока нет завершённых сессий.",
  "progress.lead": "{sessions} на этой трассе с этой машиной, всего {laps}. Рекорд {time} от {date}.",
  "progress.lastPb": "Рекорд поставлен в последней сессии.",
  "progress.lastSlower": "Последняя сессия медленнее рекорда на {gap} с.",
  "progress.improved": "С первой сессии вы нашли {gap} с.",
  "progress.single": "Пока одна сессия. Возвращайтесь на эту трассу, и здесь появится график прогресса.",
  "progress.date": "Дата",
  "progress.laps": "Кругов",
  "progress.best": "Лучший круг",
  "progress.toPb": "До рекорда",
  "progress.potential": "Потенциал",
  "progress.median": "Обычный круг",
  "progress.spread": "Разброс",
  "progress.hint": "Нажмите на сессию, чтобы открыть её разбор.",

  "unit.m": "м",
  "unit.s": "с",
  "unit.kmh": "км/ч",
};

const dicts: Record<Lang, Record<Key, string>> = { en, ru };

const STORAGE_KEY = "ui-lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {
    // Storage can be unavailable; fall back to the default.
  }
  // The main audience is the CIS community, and many of them run an English
  // Windows, so Russian is the default; English is one click away.
  return "ru";
}

let lang: Lang = initialLang();

export function getLang(): Lang {
  return lang;
}

/** `persist` only for an explicit user choice, so the default can change later. */
export function setLang(l: Lang, persist = false) {
  lang = l;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Not persisted; the choice still applies for this run.
    }
  }
  document.documentElement.lang = l;
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  return dicts[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** "6 laps" / "6 кругов". */
export function lapsCount(n: number): string {
  return lang === "en" ? `${n} ${n === 1 ? "lap" : "laps"}` : `${n} ${ruPlural(n, "круг", "круга", "кругов")}`;
}

/** "3 sessions" / "3 сессии". */
export function sessionsCount(n: number): string {
  return lang === "en" ? `${n} ${n === 1 ? "session" : "sessions"}` : `${n} ${ruPlural(n, "сессия", "сессии", "сессий")}`;
}

/** Fills elements marked with data-i18n / data-i18n-title from the dictionary. */
export function applyStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
  });
}

export function isKey(k: string): k is Key {
  return k in en;
}
