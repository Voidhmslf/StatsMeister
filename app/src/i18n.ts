// UI strings. Keys are grouped by area; `{name}` placeholders are filled by `t`.

export type Lang = "ru" | "en";

const en = {
  "app.record": "Record",
  "app.stop": "Stop",
  "source.auto": "Auto-detect",
  "source.demo": "Demo (synthetic)",
  "rec.idle": "Idle",
  "rec.starting": "Starting…",
  "rec.stopping": "Stopping…",
  "rec.recording": "Recording…",
  "rec.waiting": "Waiting for game…",
  "rec.lap": "● Lap {n}: {time}",
  "toast.lap": "Lap {n}: {time}",
  "toast.lapInvalid": "Lap {n}: {time} (invalid)",
  "toast.saved": "Session saved: {laps}",
  "toast.exported": "Saved {path}",
  "toast.importing": "Importing {file}…",
  "toast.imported": "Imported {track}: {laps}",

  "view.analysis": "Analysis",
  "view.progress": "Progress",
  "progress.empty": "Select a session on the left to see progress on its track and car.",
  "progress.pb": "Personal best",
  "progress.isPb": "PB",
  "progress.lastVsPb": "Last session vs PB",
  "progress.sinceFirst": "Since the first session",
  "progress.sessions": "{n} sessions",
  "progress.date": "Date",
  "progress.laps": "Laps",
  "progress.best": "Best lap",
  "progress.toPb": "to PB",
  "progress.potential": "Potential",
  "progress.median": "Median",
  "progress.spread": "Spread",
  "progress.hint": "Click a session to open its analysis.",

  "sessions.title": "Sessions",
  "sessions.import": "Import",
  "sessions.importTitle": "Import an Assetto Corsa replay (.acreplay), or drop it on the window",
  "sessions.refresh": "Refresh",
  "sessions.empty": "No sessions recorded yet",
  "sessions.unknownTrack": "Unknown track",
  "sessions.unknownCar": "Unknown car",
  "sessions.rec": "REC",
  "drop.hint": "Drop <b>.acreplay</b> to import",
  "dialog.replay": "Assetto Corsa replay",

  "laps.title": "Laps",
  "laps.titleTrack": "Laps · {track}",
  "laps.hint": "Pick <b class=\"a\">A</b> (reference) and <b class=\"b\">B</b> (compare)",
  "laps.recording": "Session is still being recorded (or was interrupted).",
  "laps.time": "Time",
  "laps.deltaBest": "Δ best",
  "laps.best": "best",
  "laps.partial": "partial",
  "laps.pit": "pit",
  "laps.cut": "cut",

  "summary.lap": "Lap {n}",
  "summary.gap": "Gap",
  "summary.pickB": "Pick a <b class=\"b\">B</b> lap to compare, from this or any other session on the same track.",
  "summary.exportLap": "Export lap A (CSV)",
  "empty": "Select a lap to analyse. No data yet? Choose <b>Demo</b> and press <b>Record</b>, or drop an <b>.acreplay</b> file here.",

  "coach.title": "Coach",
  "coach.sub": "Where lap B loses time to lap A, and why",
  "coach.noLoss": "Lap B does not lose noticeable time in any corner.",
  "coach.lost": "{s} s lost",

  "hint.brakes_where_reference_lifts": "On lap A this corner is taken with just a lift, on B you brake. Try a lift: come off the throttle and let the front load up.",
  "hint.overdriven_entry": "You brake {later_m} m later but are {slower_kmh} km/h slower at the apex: the late braking doesn't pay off. Brake where you did on A and release more smoothly.",
  "hint.early_braking": "You start braking {earlier_m} m earlier than on A. Move the braking point closer to the corner.",
  "hint.slow_apex": "{slower_kmh} km/h slower at the apex with the same braking point. Come off the brake earlier and carry more speed in.",
  "hint.entry_speed_costs_exit": "{faster_kmh} km/h faster at the apex, but full throttle comes {later_m} m later: the extra entry speed ruins the exit. Give up a bit of entry for earlier throttle.",
  "hint.fast_apex_slow_exit": "{faster_kmh} km/h faster at the apex, but {slower_kmh} km/h slower at the end of the following straight: the entry speed costs you the exit. Slow down a bit more on entry and get a straighter, earlier exit.",
  "hint.late_throttle": "Full throttle {later_m} m later than on A. Unwind the wheel sooner and get on the power earlier.",
  "hint.slow_exit": "{slower_kmh} km/h slower at the end of the following straight: the exit is worse and it costs time all the way down the straight.",
  "hint.line": "Pedals and speeds are close to lap A, so the difference is the line. Compare the steering trace and the map here.",

  "corners.corner": "Corner",
  "corners.apex": "Apex",
  "corners.bVsA": "B vs A",
  "corners.minSpeed": "Min speed",
  "corners.deltaMin": "Δ min",
  "corners.brakeB": "Brake point B",
  "corners.throttleB": "Full throttle B",
  "corners.bOnly": "B only",
  "corners.aOnly": "A only",
  "corners.same": "same",

  "potential.title": "Potential",
  "potential.sub": "Best segments from laps {laps}. Click a corner to see how it was done.",
  "potential.reserve": "Reserve",
  "potential.from": "From",
  "potential.consistency": "Consistency",
  "potential.lap": "lap {n}",
  "potential.rowTitle": "Compare lap {a} with lap {b} in T{c}",

  "track.title": "Track",
  "track.gain": "B gains",
  "track.loss": "B loses",
  "cursor.title": "Cursor",
  "cursor.hover": "Hover the charts",
  "cursor.distance": "Distance",
  "cursor.time": "Time",
  "stats.title": "Lap stats",

  "ch.speed": "Speed",
  "ch.throttle": "Throttle",
  "ch.brake": "Brake",
  "ch.steer": "Steering",
  "ch.gear": "Gear",
  "ch.rpm": "RPM",
  "ch.g_lat": "Lateral G",
  "ch.g_long": "Long G",
  "ch.delta": "Delta B − A",

  "st.lapTime": "Lap time",
  "st.maxSpeed": "Max speed",
  "st.avgSpeed": "Avg speed",
  "st.fullThrottle": "Full throttle",
  "st.braking": "Braking",
  "st.coasting": "Coasting",
  "st.gearChanges": "Gear changes",
  "st.maxLatG": "Max lat G",
  "st.maxBrakeG": "Max brake G",

  "unit.m": "m",
  "unit.s": "s",
  "unit.kmh": "km/h",
};

type Key = keyof typeof en;

const ru: Record<Key, string> = {
  "app.record": "Запись",
  "app.stop": "Стоп",
  "source.auto": "Автоопределение",
  "source.demo": "Демо (синтетика)",
  "rec.idle": "Ожидание",
  "rec.starting": "Запуск…",
  "rec.stopping": "Остановка…",
  "rec.recording": "Идёт запись…",
  "rec.waiting": "Ждём игру…",
  "rec.lap": "● Круг {n}: {time}",
  "toast.lap": "Круг {n}: {time}",
  "toast.lapInvalid": "Круг {n}: {time} (не засчитан)",
  "toast.saved": "Сессия сохранена: {laps}",
  "toast.exported": "Сохранено: {path}",
  "toast.importing": "Импорт {file}…",
  "toast.imported": "Импортировано {track}: {laps}",

  "view.analysis": "Анализ",
  "view.progress": "Прогресс",
  "progress.empty": "Выберите сессию слева, чтобы увидеть прогресс на этой трассе и машине.",
  "progress.pb": "Личный рекорд",
  "progress.isPb": "рекорд",
  "progress.lastVsPb": "Последняя сессия к рекорду",
  "progress.sinceFirst": "С первой сессии",
  "progress.sessions": "сессий: {n}",
  "progress.date": "Дата",
  "progress.laps": "Кругов",
  "progress.best": "Лучший круг",
  "progress.toPb": "к рекорду",
  "progress.potential": "Потенциал",
  "progress.median": "Медиана",
  "progress.spread": "Разброс",
  "progress.hint": "Кликните сессию, чтобы открыть её разбор.",

  "sessions.title": "Сессии",
  "sessions.import": "Импорт",
  "sessions.importTitle": "Импорт реплея Assetto Corsa (.acreplay). Можно просто перетащить файл на окно",
  "sessions.refresh": "Обновить",
  "sessions.empty": "Записей пока нет",
  "sessions.unknownTrack": "Неизвестная трасса",
  "sessions.unknownCar": "Неизвестная машина",
  "sessions.rec": "ЗАПИСЬ",
  "drop.hint": "Отпустите <b>.acreplay</b>, чтобы импортировать",
  "dialog.replay": "Реплей Assetto Corsa",

  "laps.title": "Круги",
  "laps.titleTrack": "Круги · {track}",
  "laps.hint": "Выберите <b class=\"a\">A</b> (эталон) и <b class=\"b\">B</b> (для сравнения)",
  "laps.recording": "Сессия ещё записывается (или запись прервалась).",
  "laps.time": "Время",
  "laps.deltaBest": "Δ",
  "laps.best": "лучший",
  "laps.partial": "неполный",
  "laps.pit": "пит",
  "laps.cut": "срезка",

  "summary.lap": "Круг {n}",
  "summary.gap": "Разница",
  "summary.pickB": "Выберите круг <b class=\"b\">B</b> для сравнения: из этой или любой другой сессии на той же трассе.",
  "summary.exportLap": "Круг A в CSV",
  "empty": "Выберите круг для разбора. Данных ещё нет? Выберите <b>Демо</b> и нажмите <b>Запись</b> или перетащите сюда файл <b>.acreplay</b>.",

  "coach.title": "Тренер",
  "coach.sub": "Где круг B теряет время относительно A и почему",
  "coach.noLoss": "Круг B нигде заметно не проигрывает.",
  "coach.lost": "потеря {s} с",

  "hint.brakes_where_reference_lifts": "На круге A здесь только сброс газа, а на B тормоз. Попробуй без торможения: сбрось газ и дай машине загрузить перед.",
  "hint.overdriven_entry": "Тормозишь на {later_m} м позже, но в апексе на {slower_kmh} км/ч медленнее: позднее торможение не окупается. Тормози как на A и отпускай тормоз плавнее.",
  "hint.early_braking": "Начинаешь тормозить на {earlier_m} м раньше, чем на A. Сдвинь точку торможения ближе к повороту.",
  "hint.slow_apex": "В апексе на {slower_kmh} км/ч медленнее при той же точке торможения. Отпускай тормоз раньше и неси больше скорости в поворот.",
  "hint.entry_speed_costs_exit": "В апексе на {faster_kmh} км/ч быстрее, но полный газ на {later_m} м позже: лишняя скорость на входе портит выход. Пожертвуй немного входом ради раннего газа.",
  "hint.fast_apex_slow_exit": "В апексе на {faster_kmh} км/ч быстрее, но к концу следующей прямой на {slower_kmh} км/ч медленнее: скорость на входе съедает выход. Погаси чуть больше на входе и выходи прямее и раньше.",
  "hint.late_throttle": "Полный газ на {later_m} м позже, чем на A. Раньше выпрямляй руль и открывай газ.",
  "hint.slow_exit": "В конце следующей прямой на {slower_kmh} км/ч медленнее: выход хуже, и время теряется на всей прямой.",
  "hint.line": "Педали и скорости почти как на A, значит, разница в траектории. Сравни руль и карту в этом повороте.",

  "corners.corner": "Поворот",
  "corners.apex": "Апекс",
  "corners.bVsA": "B к A",
  "corners.minSpeed": "Мин. скорость",
  "corners.deltaMin": "Δ мин.",
  "corners.brakeB": "Торможение B",
  "corners.throttleB": "Полный газ B",
  "corners.bOnly": "только B",
  "corners.aOnly": "только A",
  "corners.same": "так же",

  "potential.title": "Потенциал",
  "potential.sub": "Лучшие отрезки с кругов {laps}. Кликните поворот, чтобы посмотреть, как он получился.",
  "potential.reserve": "Резерв",
  "potential.from": "Круг",
  "potential.consistency": "Стабильность",
  "potential.lap": "круг {n}",
  "potential.rowTitle": "Сравнить круг {a} с кругом {b} в T{c}",

  "track.title": "Трасса",
  "track.gain": "B быстрее",
  "track.loss": "B медленнее",
  "cursor.title": "Курсор",
  "cursor.hover": "Наведите на графики",
  "cursor.distance": "Дистанция",
  "cursor.time": "Время",
  "stats.title": "Статистика круга",

  "ch.speed": "Скорость",
  "ch.throttle": "Газ",
  "ch.brake": "Тормоз",
  "ch.steer": "Руль",
  "ch.gear": "Передача",
  "ch.rpm": "Обороты",
  "ch.g_lat": "Боковая перегрузка",
  "ch.g_long": "Продольная перегрузка",
  "ch.delta": "Дельта B − A",

  "st.lapTime": "Время круга",
  "st.maxSpeed": "Макс. скорость",
  "st.avgSpeed": "Ср. скорость",
  "st.fullThrottle": "Полный газ",
  "st.braking": "Торможение",
  "st.coasting": "Накат",
  "st.gearChanges": "Переключений",
  "st.maxLatG": "Макс. боковая G",
  "st.maxBrakeG": "Макс. G торможения",

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
    // Storage can be unavailable; fall back to the system language.
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

/** "6 laps" / "6 кругов" with the right Russian plural form. */
export function lapsCount(n: number): string {
  if (lang === "en") return `${n} ${n === 1 ? "lap" : "laps"}`;
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "круг" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "круга" : "кругов";
  return `${n} ${word}`;
}

/** Fills elements marked with data-i18n / data-i18n-title from the dictionary. */
export function applyStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
  });
}

export function isKey(k: string): k is Key {
  return k in en;
}
