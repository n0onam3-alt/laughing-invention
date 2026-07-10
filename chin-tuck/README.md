# Tuck — Chin Tuck Trainer

A minimalist, evidence-based PWA for training chin tucks and the face/neck muscles that
shape your profile. No accounts, no backend, no dependencies — one HTML file, localStorage,
works offline once installed.

Open `chin-tuck/index.html` from any static host (or `python3 -m http.server` locally),
then "Add to Home Screen" on mobile for the full app experience.

## What's in the app

- **Today** — guided daily session (~7 min at Standard) with a full-screen player:
  hold/relax timers, rep counting, progress ring, sound + vibration cues, pause/skip.
  Plus **1-minute posture breaks** (a micro-dose of chin tucks, goal 3/day) — because one
  session can't outweigh hours of phone flexion; interrupting the exposure is half the job.
- **Haptic language** — distinct vibration patterns: long buzz = new exercise, double
  buzz = hold starts, short buzz = rest, tick pulses for the 3-2-1 before each hold —
  so you can train without staring down at the screen.
- **Posture pings** — optional 30/60/90-min reminders (haptic + toast, or a system
  notification when backgrounded). Honest limitation: they fire while the app is open;
  the settings sheet says so and suggests a phone alarm for guaranteed pings.
- **Animated form illustrations** — minimal line pictograms for every exercise, shown in
  the library and in the session player.
- **Exercises** — library with step-by-step form cues, the evidence behind each move,
  and safety cautions.
- **Progress** — day streak, best streak, weekly count, calendar of completed days,
  total sessions and time. All stored locally.
- **Learn** — an honest summary of the research (below).
- **Settings** — Gentle / Standard / Advanced intensity (Advanced unlocks the lying
  chin-tuck head lift), sound, vibration, data reset.

## The research the app is built on

**Chin tucks are the physical-therapy gold standard for forward head posture.** They
activate the deep cervical flexors (longus colli / longus capitis) — the muscles that hold
the head balanced over the spine. Rehab protocols typically prescribe ~10 reps with 5-second
holds, progressing to 10-second endurance holds (the wall variant) and lying head lifts
(craniocervical flexion training). Better head carriage is the fastest visible change most
people can make to the jaw–neck angle.

**Facial exercise has real—but modest—evidence.** The Northwestern trial
(Alam et al., *JAMA Dermatology* 2018) had women aged 40–65 train 30 min/day for 20 weeks;
blinded dermatologists rated them ~3 years younger afterward, mostly from increased cheek
fullness. Small study, long timeline — the app's Cheek Lifter is adapted from that routine
and the Learn tab sets expectations accordingly.

**What exercise cannot do, and the app says so:** no spot reduction of submental fat
(that follows overall body fat and genetics), and no bone remodeling from "mewing" in adults —
though tongue-to-palate posture training is a legitimate part of orofacial myofunctional
therapy for muscle tone, nasal breathing, and swallowing.

**The biggest levers for facial appearance are outside any exercise app**, so the Learn tab
lists them honestly: daily sunscreen (~24% less visible aging over 4 years in the RCT),
nightly retinoid, 7–9 h sleep, body-fat percentage, hydration.

**Safety:** low effort (3–4/10), stop signs (pain, dizziness, tingling, TMJ aggravation)
are called out per-exercise and in Learn. Not medical advice.

### Sources

- Alam M. et al., [Association of Facial Exercise With the Appearance of Aging](https://jamanetwork.com/journals/jamadermatology/fullarticle/2666801), JAMA Dermatology 2018 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/29299598/), [Northwestern summary](https://news.northwestern.edu/stories/2018/january/facial-exercises-help-middle-aged-women-appear-more-youthful))
- [Physiopedia — Deep Neck Flexor Stabilisation Protocol](https://www.physio-pedia.com/Deep_Neck_Flexor_Stabilisation_Protocol) and [Cervical Deep Neck Flexors](https://www.physio-pedia.com/Cervical_Deep_Neck_Flexors)
- [Spine-health — chin tuck technique](https://www.spine-health.com/wellness/exercise/easy-chin-tucks-neck-pain)
- [Mewing vs. myofunctional therapy — what the evidence says](https://handandstructurenyc.com/blog/mewing-vs-myofunctional-therapy-what-the-evidence-really-says); [Complete Physio on mewing claims](https://complete-physio.co.uk/mewing-for-temporomandibular-joint-tmj-pain-and-dysfunction-does-it-work/)
- [Harvard MEEI — neck exercises for double chin](https://face.meei.harvard.edu/neck-exercises-for-double-chin)
- Hughes et al., *Ann Intern Med* 2013 — daily sunscreen slowed visible skin aging by ~24% over 4 years; [Cleveland Clinic — retinol](https://my.clevelandclinic.org/health/treatments/23293-retinol)
