# MinMax Tracker

Mobile-first PWA workout tracker for the Min-Max Program.

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
