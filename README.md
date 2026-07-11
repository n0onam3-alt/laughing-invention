# MinMax Tracker

Mobile-first PWA workout tracker for the Min-Max Program.

## Cortex — study app (`/study`)

`study/index.html` — самодостаточное приложение для учёбы в одном файле (без зависимостей,
без сборки, работает офлайн, всё хранится в localStorage):

- 🧠 **Карточки с интервальным повторением** (SM-2): оценки «Снова / Трудно / Хорошо / Легко»,
  предпросмотр следующего интервала на кнопках, лимит новых карточек в день,
  3D-переворот карточки, клавиши `Space` и `1–4`
- ⚡ **Блиц-квиз**: до 10 вопросов с вариантами ответов, собранными из твоих же карточек
- 🍅 **Помодоро-таймер** (25/5/15) с кольцевым прогрессом, звуком, вибрацией и счётом
  помидорок за день
- 📈 **Статистика**: дневная цель с кольцом прогресса, стрик (🔥) и рекорд, точность за 30 дней,
  теплокарта активности за 12 недель
- 🃏 **Колоды**: создание/редактирование, экспорт и импорт JSON, полный бэкап, демо-колода
  «Учимся учиться» при первом запуске
- 🎨 Тёмная/светлая/авто тема, конфетти за завершённую очередь и квиз ≥80%

Открыть: просто отдать `study/index.html` статикой (или открыть файл в браузере).

## v17.3 "vault"
Badge vault (replaces the gold champion mode):
- 12 secret badges with hidden unlock conditions — locked slots show only "?"
- full-screen animated reveal with confetti and haptics when one unlocks; multiple unlocks
  queue up one after another
- collection grid under Settings → About ("Badge vault · 🏅 x/12") — collect them all

Battery / old-Android performance:
- Low power mode (Settings → Preferences): disables backdrop-filter blur (the main GPU and
  battery drain on older Android), confetti, and long transitions; auto-enabled on weak
  devices (≤2 GB RAM or ≤3 cores), manual toggle always wins
- rest timer ticks at 500 ms instead of 250 ms, writes to the DOM only when the label
  changes, and fully stops while the app is hidden — the end time is a timestamp, so the
  countdown stays accurate and fires the moment you come back

## v17.2 "coach"
Smarter numbers:
- estimated 1RM upgraded: mean of Epley and Brzycki (each is biased alone), with logged RIR
  counted as reps-in-the-tank — 8 reps @ RIR 2 scores like 10 to failure
- plateau detection rebuilt on a least-squares trend over the last 6 entries; separate
  "trending down" (regression) state shown in Weak points
- personalized goal line (double progression): first-session starting weights estimated from
  your bodyweight per movement pattern, "+1 rep" targets inside the rep range, plate-rounded
  load jumps at the top of the range, and a 10% reset when plateaued
- new Profile section in Settings (height / weight / age / sex) feeding the estimates;
  logged bodyweight takes priority over the profile weight
- e1RM shown in the "Last time" line of every loaded exercise

UI:
- week stepper and detail accordions use proper chevron arrows instead of +/− glyphs
- Technique toggle chevron rotates open/closed
- "liquid glass" save bar and tab bar: more translucency, stronger blur/saturation and a
  specular top rim in both themes

## v17.1 "confetti"
Bug fixes:
- starting the app offline no longer signs you out: auth now restores the session from local
  storage (`getSession`) instead of requiring a network round-trip (`getUser`), so the
  back-online auto-sync works again
- editing a workout now survives a reload — the draft remembers which workout it edits, so a
  save after a mid-edit refresh updates the original instead of creating a duplicate
- "Clear" now asks for confirmation when the draft only contains energy/sleep ratings
- while editing, the save button reads "Update workout" and the Train header shows "editing"

Delight:
- confetti burst on PRs 🎉
- milestone celebrations: workout count (1, 10, 25, 50, 100, 250, 500, 1000) and lifetime
  volume (10 t … 1000 t) get a toast + confetti after the save toast
- the empty Log rotates a motivational line by day
- a few Easter eggs are hidden in the app — one of them is whispered in the browser console

## v17 "ios"
A full performance + UI pass: the app renders like an iOS app and stays fast with months of logs.

Performance:
- history-derived data (per-exercise entries, summaries, sorted sessions) is computed once and
  memoized; it used to be re-filtered and re-sorted on every accordion toggle, day switch and
  Progress render
- hidden pages are no longer re-rendered after every save/sync — they're marked dirty and render
  on visit (Progress no longer runs its full analysis at startup either)
- the Log renders lazily: month-grouped list, 30 entries at a time with "Show more", and workout
  details are built only when a card is opened (huge DOM reduction on long histories)
- the Supabase SDK (~120 KB gz) is loaded on demand — only when a stored session exists or you
  tap Sign in — instead of being parsed on every startup
- the service worker serves versioned assets (`/src/*?v=`) cache-first, so repeat startups are
  instant; HTML stays network-first with a 3.5 s timeout fallback to cache on flaky connections
- offscreen log cards skip layout/paint via `content-visibility`

UI/UX (iOS style):
- iOS system palette: grouped-gray light mode, true-black dark mode, iOS blue/green/red accents
- frosted-glass tab bar and sticky save bar, Dynamic-Island-style rest pill, iOS switches,
  segmented controls, alert-style confirm dialogs, capsule toast
- theme setting is now Auto / Light / Dark — Auto follows the system, live
- Settings rebuilt as grouped lists; Log grouped by month with tap-to-expand cards
- smooth pixel-space progress chart: no more stretched points, gradient fill, min/max labels,
  tap a point for its value
- per-tab scroll position is remembered; tapping the active tab scrolls to top
- the autofill hint disappears after the first time you use a set-number button

## v16 "essentials"
More useful, less noise:
- session duration is tracked automatically (first logged set → save) and shown in the Log
- PR detection on save — the toast celebrates a new best (estimated 1RM, or reps/seconds for
  bodyweight and timed work)
- floating rest pill: the countdown stays visible when the exercise card is closed or you switch
  tabs; tap it to skip the rest
- light weeks from the program are flagged in the Train header
- the bodyweight field suggests your last logged weight as a placeholder
- decluttered: redundant "Plan" line removed from Technique (the target box already shows it),
  the autofill hint only appears when there is history to copy, and page headers are simpler

Fixes & performance in v16:
- Clear now really cancels editing — previously a save after "Clear" silently overwrote the
  workout being edited
- a saved day that no longer exists in the program falls back to the first day instead of an
  empty Train screen
- session notes, bodyweight, energy and sleep are shown when a Log entry is opened
- "Last time" picks the newest of two same-day sessions
- rest timer stops on save/clear instead of running into the next session
- startup no longer blocks on fetching program.json — the app renders instantly from the
  embedded program and hot-swaps if the server copy is newer
- draft writes are debounced (flushed on hide/close) instead of hitting localStorage per keystroke
- duplicate detection in the Log is linear instead of quadratic
- no more immediate page reload on the very first visit (service-worker claim guard)

## v15 "logbook"
The Train screen is now a paper-logbook: the whole day as one checklist.
- every exercise of the day visible as a card with status (number → ✓) and a one-line summary
  (logged sets, or "Last 57.5×8 · 57.5×7", or the plan "2 × 6-8")
- tap a card to expand set entry; the first unfinished exercise auto-expands
- jump to any exercise directly — no more prev/next arrows
- day title, mini week stepper, day chips and progress live in one compact header card
Carried over from v14:
- compact Train screen: week + days + progress in one control bar
- last-time values shown as placeholders in every set; tap the set number to autofill them
- built-in rest timer parsed from the program's rest range (vibrates when done)
- "Last time" summary line under the target
- disciplined type scale (500/700/800), icon bottom nav, unified radii and spacing
- RIR fields toggle in Settings

Backend behavior unchanged from v13:
- local-first saves with pending upsert queue
- confirmed delete modal with local immediate removal
- Supabase soft-delete through `deleted_at`
- one sync sequence: pending deletes, pending upserts, cloud pull, merge by `updated_at`
- versioned service-worker cache with network-first app assets

## Supabase
Run `database/supabase_full_setup.sql` in the Supabase SQL editor. The app uses the browser
publishable key with RLS policies based on `auth.uid()`. No schema changes are needed for v14.
