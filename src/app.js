'use strict';

const APP_VERSION = '17.4.0';
const SUPABASE_URL = 'https://fgeseogicphovwroritm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-D7olun_9Vu3vwtaGNvTkQ_SEXsAd09';
const STORE_KEY = 'mm_tracker_v13_1_clean_sync_state';
const DRAFT_KEY = 'mm_tracker_v13_1_clean_sync_draft';
const DELETE_QUEUE_KEY = 'mm_tracker_v13_1_clean_sync_delete_queue';
const DELETE_META_KEY = 'mm_tracker_v13_1_clean_sync_delete_meta';
const UPSERT_QUEUE_KEY = 'mm_tracker_v13_1_clean_sync_upsert_queue';
const LEGACY_KEYS = ['mm_tracker_v13_backend_v12_ui','mm_tracker_v12','mm_tracker_v11','mm_tracker_v10','mm_tracker_v9','mm_tracker_v8','mm_tracker_v7','mm_tracker_v6_3_stable','mm_tracker_v6','mm_tracker_v5'];
const LEGACY_DELETE_QUEUE_KEYS = ['mm_tracker_v13_backend_v12_ui_delete_queue','mm_tracker_v10_delete_queue','mm_tracker_v9_delete_queue'];
const LEGACY_DELETE_META_KEYS = ['mm_tracker_v13_backend_v12_ui_delete_meta','mm_tracker_v10_delete_meta','mm_tracker_v9_delete_meta'];
const LEGACY_UPSERT_QUEUE_KEYS = ['mm_tracker_v13_backend_v12_ui_upsert_queue'];

const state = {
  program:null, split:[], page:'train', week:1, day:'Full Body', exIndex:0,
  sessions:[], draft:null, pendingUpserts:new Set(), pendingDeletes:new Set(), deleteMeta:{},
  lastSyncAt:null, lastSyncError:null, syncRunning:false, user:null, supabase:null,
  schema:{deletedAt:true, meta:true}, progressView:'overall', progressExercise:'',
  sessionOpen:false, editId:null, saving:false, deleting:false, authBusy:false,
  prefs:{theme:'auto', showRir:false, usedAutofill:false, badges:{}, lowPower:false, profile:{height:173, weight:76, age:24, sex:'m'}}, swReloading:false
};

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v,min,max) => Math.min(max, Math.max(min, Number(v)||0));
const round = v => Math.round((Number(v)||0)*10)/10;
const uid = () => 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9);
const localDate = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const nowIso = () => new Date().toISOString();
const fmtDate = d => { const x=new Date(`${d}T00:00:00`); if(Number.isNaN(x.getTime())) return d; const sameYear=x.getFullYear()===new Date().getFullYear(); return x.toLocaleDateString(undefined, sameYear?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'}); };
const shortDate = d => { const x=new Date(`${d}T00:00:00`); return Number.isNaN(x.getTime())?d:x.toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
const updatedAt = s => s?.updated_at || s?.updatedAt || nowIso();
const deletedAt = s => s?.deleted_at || s?.deletedAt || null;
const isIsoLike = v => v && !Number.isNaN(new Date(v).getTime());

const memoryStore = {};
const store = {
  getItem(key){ try{return window.localStorage.getItem(key);}catch(e){return Object.prototype.hasOwnProperty.call(memoryStore,key)?memoryStore[key]:null;} },
  setItem(key,value){ try{window.localStorage.setItem(key,value);}catch(e){memoryStore[key]=String(value);} },
  removeItem(key){ try{window.localStorage.removeItem(key);}catch(e){delete memoryStore[key];} },
  clear(){ try{window.localStorage.clear();}catch(e){for(const k of Object.keys(memoryStore)) delete memoryStore[k];} }
};

/* Derived-data caches. History-derived lookups (per-exercise entries, summaries, sorted
   sessions) are rebuilt lazily and invalidated once per data change instead of being
   recomputed from scratch on every render — this was the main source of UI lag. */
const entryCache=new Map(), summaryCache=new Map(), metaIndex=new Map();
let sortedSessionsCache=null, namesCache=null, lastBwCache;
const dirty={train:false, log:true, progress:true};
const pageScroll={};
function invalidateDataCache(){ entryCache.clear(); summaryCache.clear(); sortedSessionsCache=null; namesCache=null; lastBwCache=undefined; }
function activeSessionsAsc(){
  if(!sortedSessionsCache){
    sortedSessionsCache=state.sessions.filter(s=>!state.pendingDeletes.has(String(s.id)))
      .sort((a,b)=>new Date(a.date)-new Date(b.date)||String(updatedAt(a)||'').localeCompare(String(updatedAt(b)||''))||String(a.id).localeCompare(String(b.id)));
  }
  return sortedSessionsCache;
}
function trainInputFocused(){ const a=document.activeElement; return !!(a && a.closest && a.closest('#pageTrain') && (a.tagName==='INPUT'||a.tagName==='SELECT')); }
/* Pages re-render only when visible; hidden pages are just marked dirty and render on visit. */
function dataChanged(){
  invalidateDataCache();
  dirty.train=dirty.log=dirty.progress=true;
  renderSyncChip();
  if(state.page==='train' && trainInputFocused()) return; // don't yank focus mid-typing; train re-renders on next interaction
  renderActivePage();
}
function renderActivePage(){
  if(state.page==='train'){ if(dirty.train) renderTrain(); }
  else if(state.page==='log'){ if(dirty.log) renderHistory(); }
  else if(state.page==='progress'){ if(dirty.progress) renderProgress(); }
  else if(state.page==='settings'){ renderDiagnostics(); }
}
function haptic(pattern){ try{ navigator.vibrate?.(pattern); }catch(e){} }

/* Confetti burst for PRs, milestones and unlocked secrets. Pure DOM + CSS, no deps;
   skipped entirely under prefers-reduced-motion (the global reduce rule would freeze it). */
function confetti(count=28){
  if(state.prefs.lowPower) return;
  try{ if(matchMedia('(prefers-reduced-motion: reduce)').matches) return; }catch(e){}
  let host=$('#confetti');
  if(!host){ host=document.createElement('div'); host.id='confetti'; host.setAttribute('aria-hidden','true'); document.body.appendChild(host); }
  const colors=['#007aff','#34c759','#ff9f0a','#ff3b30','#af52de','#ffd60a'];
  for(let i=0;i<count;i++){
    const p=document.createElement('i');
    const size=6+Math.random()*6, dur=1+Math.random()*.9, delay=Math.random()*.25;
    p.style.cssText=`left:${Math.random()*100}vw;width:${size}px;height:${size*.45}px;background:${colors[i%colors.length]};animation-duration:${dur}s;animation-delay:${delay}s;--drift:${(Math.random()-.5)*60}px;transform:rotate(${Math.random()*360}deg)`;
    host.appendChild(p);
    setTimeout(()=>p.remove(),(dur+delay)*1000+150);
  }
}

function lifetimeVolume(){ let t=0; for(const s of activeSessionsAsc()) for(const e of s.exercises) for(const st of e.sets) t+=setVolume(st,e.name,s); return t; }
const WORKOUT_MARKS={1:'🎉 Workout #1 — the journey begins!',10:'🔥 10 workouts logged. It’s becoming a habit.',25:'💪 25 workouts — quarter century club.',50:'⚡ 50 workouts strong!',100:'🏆 Workout #100 — certified regular.',250:'🦾 250 workouts. Absolute machine.',500:'👑 500 workouts. Legend status.',1000:'🐐 Workout #1000. The GOAT.'};
const VOLUME_MARKS=[[1000000,'🐋 1,000,000 kg lifetime volume — you’ve out-lifted a blue whale. Several times.'],[500000,'🚀 500,000 kg lifetime volume. Half a million!'],[250000,'🚂 250,000 kg lifetime — a whole locomotive.'],[100000,'🚛 100,000 kg lifetime — that’s a loaded semi-truck.'],[10000,'🐘 10,000 kg lifetime — about two elephants, moved by you.']];
/* Milestone check for a freshly saved (new) session: workout count first, then lifetime volume thresholds. */
function milestoneMessage(session){
  const total=activeSessionsAsc().length;
  if(WORKOUT_MARKS[total]) return WORKOUT_MARKS[total];
  const sVol=session.exercises.reduce((a,e)=>a+e.sets.reduce((x,st)=>x+setVolume(st,e.name,session),0),0);
  const vol=lifetimeVolume();
  for(const [t,msg] of VOLUME_MARKS){ if(vol>=t && vol-sVol<t) return msg; }
  return '';
}

function toast(msg, tone='', action=null){
  const el = $('#toast');
  if(!el) return;
  const pill=$('#restPill');
  if(!msg){ el.hidden=true; el.textContent=''; el.dataset.tone=''; el.classList.remove('show'); pill?.classList.remove('shifted'); return; }
  if(action){
    el.textContent='';
    el.append(msg + ' ');
    const btn=document.createElement('button');
    btn.type='button'; btn.className='toast-act'; btn.textContent=action.label;
    btn.onclick=e=>{ e.stopPropagation(); toast(''); action.fn(); };
    el.appendChild(btn);
  } else {
    el.textContent = msg;
  }
  el.hidden = false; el.dataset.tone = tone;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  pill?.classList.add('shifted');
  // Longer messages (milestones, errors) and actionable toasts get more reading time.
  const dur = (action?5200:2600) + Math.min(2400, Math.max(0, msg.length-40)*30);
  clearTimeout(el._t); el._t=setTimeout(()=>toast(''), dur);
}

function modal({title, message, danger=false, requireText='', confirmText='Confirm'}){
  return new Promise(resolve=>{
    const root=$('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalMsg"><div class="modal"><h2 id="modalTitle">${esc(title)}</h2><p id="modalMsg" class="muted" style="margin-top:8px">${esc(message)}</p>${requireText?`<label style="margin-top:14px">Type ${esc(requireText)}<input id="modalConfirmInput" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"></label>`:''}<div class="modal-actions"><button id="modalCancel" class="btn ghost" type="button">Cancel</button><button id="modalOk" class="btn ${danger?'danger-fill':'primary'}" type="button">${esc(confirmText)}</button></div></div></div>`;
    const opener = document.activeElement;
    const cleanup = val => { document.removeEventListener('keydown', onKey); root.innerHTML=''; if(opener?.focus) opener.focus(); resolve(val); };
    const confirm = () => { if(requireText && $('#modalConfirmInput').value.trim().toUpperCase() !== requireText.toUpperCase()){ toast(`Type ${requireText} to continue`); $('#modalConfirmInput')?.focus(); return; } cleanup(true); };
    const onKey = e => {
      if(e.key==='Escape'){ e.preventDefault(); cleanup(false); }
      else if(e.key==='Enter'){ e.preventDefault(); confirm(); }
      else if(e.key==='Tab'){ // keep focus inside the dialog
        const f=$$('.modal input, .modal button', root).filter(x=>!x.disabled);
        if(!f.length) return;
        const first=f[0], last=f[f.length-1];
        if(e.shiftKey && (document.activeElement===first || !root.contains(document.activeElement))){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && (document.activeElement===last || !root.contains(document.activeElement))){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    $('#modalCancel').onclick=()=>cleanup(false);
    $('.modal-backdrop').onclick=e=>{ if(e.target.classList.contains('modal-backdrop')) cleanup(false); };
    $('#modalOk').onclick=confirm;
    ($('#modalConfirmInput') || $('#modalOk'))?.focus();
  });
}

function createDraft(){ return {date:localDate(), bw:null, notes:'', meta:{energy:null,sleep:null,stress:null}, exercises:{}, updated_at:nowIso()}; }
function initDraft(){ state.draft = createDraft(); }
function normalizeSet(s, meta={}){ const load=Math.max(0, Number(s?.load)||0), reps=Math.max(0, Number(s?.reps)||0); if(!reps) return null; return {load, reps, rir:s?.rir===''||s?.rir==null?null:clamp(s.rir,0,5), timed:!!s?.timed || !!meta.timed}; }
function normalizeExercise(e){ if(!e || !e.name || !Array.isArray(e.sets)) return null; const meta=findExerciseMeta(e.name); const sets=e.sets.map(s=>normalizeSet(s,meta)).filter(Boolean); return sets.length?{name:String(e.name), sets}:null; }
function normalizeSession(s){
  if(!s || !s.id || !s.date || !s.day) return null;
  if(deletedAt(s)) return null;
  const exercises=(Array.isArray(s.exercises)?s.exercises:[]).map(normalizeExercise).filter(Boolean);
  if(!exercises.length) return null;
  const ts = isIsoLike(updatedAt(s)) ? updatedAt(s) : nowIso();
  return {id:String(s.id), user_id:s.user_id||null, date:String(s.date).match(/^\d{4}-\d{2}-\d{2}$/)?s.date:localDate(), week:clamp(s.week||1,1,12), day:state.split.includes(s.day)?s.day:String(s.day), bw:s.bw==null||s.bw===''?null:Math.max(0,Number(s.bw)||0), notes:String(s.notes||'').slice(0,180), exercises, meta:normalizeMeta(s.meta||{}), updated_at:ts, deleted_at:null};
}
function normalizeMeta(m){ return {energy:m.energy?clamp(m.energy,1,5):null, sleep:m.sleep?clamp(m.sleep,1,5):null, stress:m.stress?clamp(m.stress,1,5):null, durationMin:m.durationMin?Math.max(0,Number(m.durationMin)||0):null, startedAt:m.startedAt||null, finishedAt:m.finishedAt||null}; }

function parseArray(raw){ try{ const v=JSON.parse(raw||'[]'); return Array.isArray(v)?v:[]; }catch(e){ return []; } }
function parseObject(raw){ try{ const v=JSON.parse(raw||'{}'); return v && typeof v==='object' && !Array.isArray(v) ? v : {}; }catch(e){ return {}; } }
function readLegacyQueue(keys){ for(const k of keys){ const raw=store.getItem(k); if(raw) return parseArray(raw).map(String); } return []; }
function normalizeDeleteMeta(meta){ const out={}; for(const id of Object.keys(meta||{})){ const m=meta[id]||{}; out[String(id)]={...m,id:String(id),deletedAt:m.deletedAt||m.deleted_at||nowIso(),cloudConfirmed:!!m.cloudConfirmed}; } return out; }
function saveDeleteQueue(){ store.setItem(DELETE_QUEUE_KEY, JSON.stringify([...state.pendingDeletes])); store.setItem(DELETE_META_KEY, JSON.stringify(state.deleteMeta||{})); }
function saveUpsertQueue(){ store.setItem(UPSERT_QUEUE_KEY, JSON.stringify([...state.pendingUpserts])); }
function queueUpsert(id){ id=String(id); if(state.pendingDeletes.has(id)) return; state.pendingUpserts.add(id); saveLocal(); }
function unqueueUpsert(id){ state.pendingUpserts.delete(String(id)); saveLocal(false); }
function clearUpsertQueue(){ state.pendingUpserts.clear(); saveLocal(false); }
function pendingUpsertCount(){ pruneQueues(); return state.pendingUpserts.size; }
function sessionSignature(s){ if(!s) return ''; return [s.day||'', s.date||'', s.week||'', s.bw??'', (s.notes||'').trim(), (s.exercises||[]).map(e=>`${e.name}:${(e.sets||[]).map(x=>`${x.load}x${x.reps}r${x.rir??''}`).join('|')}`).join(';')].join('::'); }
function sessionSnapshot(s){ if(!s) return null; return {id:String(s.id), date:s.date||localDate(), week:clamp(s.week||1,1,12), day:state.split.includes(s.day)?s.day:(state.split[0]||'Full Body'), bw:s.bw??null, notes:String(s.notes||'').slice(0,180), exercises:Array.isArray(s.exercises)?s.exercises:[], meta:normalizeMeta(s.meta||{}), updated_at:updatedAt(s)}; }
function similarSessionCount(session){ if(!session) return 0; const sig=sessionSignature(session); return state.sessions.filter(s=>String(s.id)!==String(session.id) && sessionSignature(s)===sig && !state.pendingDeletes.has(String(s.id))).length; }
function duplicateOf(session){ if(!session) return null; const sig=sessionSignature(session); return state.sessions.find(s=>String(s.id)!==String(session.id) && sessionSignature(s)===sig && !state.pendingDeletes.has(String(s.id))) || null; }
function queueDelete(id, session=null){ id=String(id); state.pendingDeletes.add(id); state.pendingUpserts.delete(id); const previous=state.deleteMeta[id]||{}; state.deleteMeta[id]={...previous, id, signature:sessionSignature(session)||previous.signature||'', snapshot:sessionSnapshot(session)||previous.snapshot||null, deletedAt:previous.deletedAt||nowIso(), cloudConfirmed:false}; invalidateDataCache(); saveLocal(false); }
function markDeleteConfirmed(id){ id=String(id); state.pendingDeletes.delete(id); delete state.deleteMeta[id]; invalidateDataCache(); saveLocal(false); }
function unqueueDelete(id){ id=String(id); state.pendingDeletes.delete(id); delete state.deleteMeta[id]; invalidateDataCache(); saveLocal(false); }
function clearDeleteQueue(){ state.pendingDeletes.clear(); state.deleteMeta={}; invalidateDataCache(); saveLocal(false); }
function pendingDeleteCount(){ return state.pendingDeletes.size; }
function isDeletedId(id){ return state.pendingDeletes.has(String(id)); }
function pruneQueues(){ const activeIds=new Set(state.sessions.map(s=>String(s.id))); for(const id of [...state.pendingUpserts]){ if(!activeIds.has(String(id)) || state.pendingDeletes.has(String(id))) state.pendingUpserts.delete(String(id)); } for(const id of state.pendingDeletes){ if(!state.deleteMeta[id]) state.deleteMeta[id]={id,deletedAt:nowIso(),cloudConfirmed:false}; } }
function purgeQueuedLocalDeletes(){ if(!state.pendingDeletes?.size) return; const before=state.sessions.length; state.sessions = state.sessions.filter(s => !isDeletedId(s.id)); if(state.sessions.length!==before) invalidateDataCache(); }

/* Theme: Auto follows the system (iOS-style), Light/Dark force it. */
const themeMedia = typeof matchMedia==='function' ? matchMedia('(prefers-color-scheme: dark)') : null;
themeMedia?.addEventListener?.('change', ()=>{ if(state.prefs.theme==='auto') applyResolvedTheme(); });
function applyResolvedTheme(){
  const dark = state.prefs.theme==='dark' || (state.prefs.theme==='auto' && !!themeMedia?.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.body.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
}
function setTheme(pref){
  state.prefs.theme = pref==='dark' || pref==='light' ? pref : 'auto';
  applyResolvedTheme();
  $$('#themeSeg [data-theme-pref]').forEach(b=>{ const on=b.dataset.themePref===state.prefs.theme; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
}
/* 🥚 Badge vault: 12 secret badges. Locked slots hide the name (“???”) but show how to earn
   it. Checked after every new save; each unlock gets a full-screen reveal with confetti. */
const BADGES=[
  {id:'first_blood',  icon:'🩸', name:'First Blood',        line:'The iron tasted you. It wants more.',                                      how:'Save your very first workout.',                        check:c=>c.total>=1},
  {id:'night_stalker',icon:'🦇', name:'Night Stalker',      line:'Gains don’t sleep. Apparently neither do you.',                            how:'Finish a workout between midnight and 5 AM.',          check:c=>c.hour<5},
  {id:'dawn_raider',  icon:'🌅', name:'5AM Psychopath',     line:'Alarm at 4:45. Chose violence before breakfast.',                          how:'Finish a workout between 5 and 7 AM.',                 check:c=>c.hour>=5&&c.hour<7},
  {id:'widowmaker',   icon:'💀', name:'Widowmaker',         line:'20 reps. One set. Your ancestors felt it.',                                how:'Crank out 20+ reps in a single set.',                  check:c=>c.maxReps>=20},
  {id:'plate_goblin', icon:'👺', name:'Plate Goblin',       line:'Double bodyweight moved. The plates whisper your name now.',               how:'Lift 2× your bodyweight in one set.',                  check:c=>c.bw>0&&c.maxLoad>=2*c.bw},
  {id:'rampage',      icon:'👹', name:'Rampage',            line:'Three PRs in one session. Leave some for the rest of us.',                 how:'Break 3 personal records in one workout.',             check:c=>c.prs>=3},
  {id:'no_mercy',     icon:'⚔️', name:'No Mercy',           line:'Skipped nothing. Not even the ones you hate.',                             how:'Complete every exercise on the day’s plan.',           check:c=>c.fullDay},
  {id:'hitman',       icon:'⚡', name:'Hitman',             line:'In. Out. Thirty minutes. Nobody saw you coming.',                          how:'Finish 4+ exercises in 30 minutes or less.',           check:c=>c.duration>0&&c.duration<=30&&c.exCount>=4},
  {id:'undead',       icon:'👻', name:'Back From the Dead', line:'Two weeks gone. The dumbbells almost filed a missing person report.',      how:'Come back and train after 14+ days away.',             check:c=>c.gapDays>=14},
  {id:'grave_digger', icon:'⚰️', name:'Grave Digger',       line:'100 tonnes lifted. That’s a lot of soup cans, sweetie.',                   how:'Move 100,000 kg of lifetime volume.',                  check:c=>c.lifetimeVol>=100000},
  {id:'centurion',    icon:'🛡️', name:'Centurion',          line:'100 workouts deep. Your rest days fear you.',                              how:'Log your 100th workout.',                              check:c=>c.total>=100},
  {id:'annihilator',  icon:'💥', name:'Annihilator',        line:'Whole split flattened in one week. Even grandma is impressed. Barely.',    how:'Train all 4 program days within 7 days.',              check:c=>c.weekSweep}
];
function buildBadgeCtx(session, prs){
  const sessions=activeSessionsAsc();
  let maxReps=0, maxLoad=0;
  for(const e of session.exercises) for(const s of e.sets){ if(!s.timed) maxReps=Math.max(maxReps, Number(s.reps)||0); maxLoad=Math.max(maxLoad, Number(s.load)||0); }
  const dayList=state.program?.days?.[session.day]||[];
  const names=new Set(session.exercises.map(e=>e.name));
  const others=sessions.filter(s=>String(s.id)!==String(session.id));
  let gapDays=0;
  if(others.length){ const latest=others.reduce((m,s)=>s.date>m?s.date:m, others[0].date); gapDays=Math.round((new Date(session.date)-new Date(latest))/86400000); }
  return {
    total:sessions.length,
    // Time badges should reflect when you trained, not when you pressed Save.
    hour:new Date(session.meta?.finishedAt||session.meta?.startedAt||Date.now()).getHours(),
    maxReps, maxLoad,
    bw:Number(session.bw)||Number(lastBodyweight())||Number(state.prefs.profile?.weight)||0,
    prs:prs.length,
    fullDay:dayList.length>0 && dayList.filter(x=>!x.optional).every(x=>names.has(x.name)),
    duration:Number(session.meta?.durationMin)||0,
    exCount:session.exercises.length,
    gapDays,
    lifetimeVol:lifetimeVolume(),
    weekSweep:state.split.length>=2 && state.split.every(d=>sessions.some(s=>{ const diff=(new Date(session.date)-new Date(s.date))/86400000; return s.day===d && diff>=0 && diff<=6; }))
  };
}
function checkBadges(ctx){
  const out=[];
  for(const b of BADGES){
    if(state.prefs.badges[b.id]) continue;
    let ok=false; try{ ok=!!b.check(ctx); }catch(e){}
    if(ok){ state.prefs.badges[b.id]=nowIso(); out.push(b); }
  }
  if(out.length){ saveLocal(false); renderBadgeCount(); }
  return out;
}
function showBadge(b, onDone){
  haptic([20,80,20]); confetti(34);
  const el=document.createElement('div');
  el.className='badge-pop';
  el.innerHTML=`<div class="badge-card" role="alertdialog" aria-label="Badge unlocked: ${esc(b.name)}" tabindex="-1"><span class="badge-glow" aria-hidden="true"></span><span class="badge-icon">${b.icon}</span><span class="badge-tag">Badge unlocked</span><b class="badge-name">${esc(b.name)}</b><span class="badge-line">${esc(b.line)}</span><span class="badge-hint">Tap to continue</span></div>`;
  document.body.appendChild(el);
  const opener=document.activeElement;
  let closed=false;
  const close=()=>{ if(closed) return; closed=true; document.removeEventListener('keydown', onKey); el.classList.add('out'); setTimeout(()=>{ el.remove(); if(opener?.focus) opener.focus(); if(onDone) onDone(); }, 200); };
  const onKey=e=>{ if(e.key==='Escape'||e.key==='Enter'||e.key===' '){ e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', close);
  try{ $('.badge-card', el).focus({preventScroll:true}); }catch(e){}
  setTimeout(close, 7000);
}
function revealBadges(list){ if(!list.length) return; showBadge(list[0], ()=>revealBadges(list.slice(1))); }
function renderBadgeCount(){ const el=$('#badgeCount'); if(el) el.textContent=`🏅 ${Object.keys(state.prefs.badges).length}/${BADGES.length}`; }
function renderBadgePanel(){
  const host=$('#badgePanel'); if(!host) return;
  const n=Object.keys(state.prefs.badges).length;
  host.innerHTML=`<p class="small badge-intro">${n===BADGES.length?'All badges collected. You are the final boss.':`${BADGES.length-n} still locked. The instructions are right there, sweetheart.`}</p><div class="badge-cells">`+
    BADGES.map(b=>state.prefs.badges[b.id]
      ?`<div class="badge-cell unlocked"><span class="b-ico">${b.icon}</span><b>${esc(b.name)}</b><span class="small">${esc(b.line)}</span></div>`
      :`<div class="badge-cell"><span class="b-ico">?</span><b>???</b><span class="small">${esc(b.how)}</span></div>`).join('')+'</div>';
}
function toggleBadgePanel(){ const panel=$('#badgePanel'); const btn=$('#aboutRow'); if(!panel) return; const open=panel.hidden; if(open) renderBadgePanel(); panel.hidden=!open; btn?.setAttribute('aria-expanded', String(open)); }

/* Low power mode: kills backdrop-filter blur (the main GPU/battery drain on old Android),
   confetti and long transitions. Auto-enabled on weak devices, manual toggle in Settings. */
function applyLowPower(){ document.body.classList.toggle('lite', !!state.prefs.lowPower); const t=$('#lowPowerToggle'); if(t) t.checked=!!state.prefs.lowPower; }

function renderProfile(){
  const p=state.prefs.profile||{};
  const set=(id,v)=>{ const el=$('#'+id); if(el) el.value=v??''; };
  set('pHeight',p.height); set('pWeight',p.weight); set('pAge',p.age);
  $$('#sexSeg [data-sex]').forEach(b=>{ const on=b.dataset.sex===p.sex; b.classList.toggle('active',on); b.setAttribute('aria-pressed',String(on)); });
}
function collectProfile(){
  const p=state.prefs.profile;
  p.height=clamp($('#pHeight')?.value||173,120,230);
  p.weight=Math.max(30,Number($('#pWeight')?.value)||76);
  p.age=clamp($('#pAge')?.value||24,10,100);
  saveLocal(false);
  invalidateDataCache(); // bodyweight-based volume/e1RM fall back to the profile weight
  dirty.train=dirty.progress=true; // goal suggestions and summaries depend on profile weight
}
function setShowRir(on){
  state.prefs.showRir = !!on;
  $('#exerciseList')?.classList.toggle('advanced', state.prefs.showRir);
  const t = $('#rirToggle'); if(t) t.checked = state.prefs.showRir;
}

function localStateSnapshot(){
  pruneQueues();
  return {
    version:APP_VERSION,
    sessions:state.sessions.filter(s=>!state.pendingDeletes.has(String(s.id))).map(s=>({...s,updated_at:updatedAt(s),deleted_at:null})),
    pendingUpserts:[...state.pendingUpserts],
    pendingDeletes:[...state.pendingDeletes],
    deleteMeta:state.deleteMeta||{},
    lastSyncAt:state.lastSyncAt,
    lastSyncError:state.lastSyncError,
    preferences:{theme:state.prefs.theme, showRir:state.prefs.showRir, usedAutofill:state.prefs.usedAutofill, badges:state.prefs.badges, lowPower:state.prefs.lowPower, profile:state.prefs.profile},
    week:state.week,
    day:state.day
  };
}
function saveLocal(updateUi=true){ purgeQueuedLocalDeletes(); store.setItem(STORE_KEY, JSON.stringify(localStateSnapshot())); saveUpsertQueue(); saveDeleteQueue(); if(updateUi) renderDiagnostics(); }
function loadLocal(){
  let raw=store.getItem(STORE_KEY), parsed=null;
  if(!raw){ for(const k of LEGACY_KEYS){ raw=store.getItem(k); if(raw) break; } }
  if(raw){ try{ parsed=JSON.parse(raw); }catch(e){ parsed=null; } }
  state.prefs.badges={};
  const savedBadges=parsed?.preferences?.badges;
  if(savedBadges && typeof savedBadges==='object'){ for(const b of BADGES){ if(savedBadges[b.id]) state.prefs.badges[b.id]=savedBadges[b.id]; } }
  /* Low power defaults ON for weak hardware: ≤2 GB RAM or ≤3 cores. Manual toggle wins once set. */
  const weakDevice=(navigator.deviceMemory && navigator.deviceMemory<=2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency<=3);
  state.prefs.lowPower = parsed?.preferences?.lowPower!=null ? !!parsed.preferences.lowPower : !!weakDevice;
  const prof=parsed?.preferences?.profile||{};
  state.prefs.profile={height:clamp(prof.height||173,120,230), weight:Math.max(30,Number(prof.weight)||76), age:clamp(prof.age||24,10,100), sex:prof.sex==='f'?'f':'m'};
  setTheme(parsed?.preferences?.theme || parsed?.theme || 'auto');
  state.prefs.showRir = !!parsed?.preferences?.showRir;
  state.prefs.usedAutofill = !!parsed?.preferences?.usedAutofill;
  state.week=clamp(parsed?.week||1,1,12);
  state.day=state.split.includes(parsed?.day)?parsed.day:(state.split[0]||state.day);
  const pendingDeletes = Array.isArray(parsed?.pendingDeletes) ? parsed.pendingDeletes.map(String) : readLegacyQueue([DELETE_QUEUE_KEY,...LEGACY_DELETE_QUEUE_KEYS]);
  const pendingUpserts = Array.isArray(parsed?.pendingUpserts) ? parsed.pendingUpserts.map(String) : readLegacyQueue([UPSERT_QUEUE_KEY,...LEGACY_UPSERT_QUEUE_KEYS]);
  state.pendingDeletes = new Set(pendingDeletes);
  state.pendingUpserts = new Set(pendingUpserts);
  state.deleteMeta = normalizeDeleteMeta(parsed?.deleteMeta || parseObject(store.getItem(DELETE_META_KEY)) || {});
  for(const id of state.pendingDeletes){ if(!state.deleteMeta[id]) state.deleteMeta[id]={id,deletedAt:nowIso(),cloudConfirmed:false}; }
  state.lastSyncAt = parsed?.lastSyncAt || null;
  state.lastSyncError = parsed?.lastSyncError || null;
  state.sessions=(Array.isArray(parsed?.sessions)?parsed.sessions:[]).map(normalizeSession).filter(Boolean).filter(s=>!state.pendingDeletes.has(String(s.id)));
  invalidateDataCache();
  pruneQueues();
  saveLocal(false);
  try{
    const d=JSON.parse(store.getItem(DRAFT_KEY)||'null');
    state.draft=d&&typeof d==='object'?{...createDraft(),...d,meta:normalizeMeta(d.meta||{})}:createDraft();
    // A truncated/hand-edited draft must not brick startup: keep only well-formed exercise entries.
    const ex=state.draft.exercises;
    state.draft.exercises=(ex&&typeof ex==='object'&&!Array.isArray(ex))?Object.fromEntries(Object.entries(ex).filter(([,v])=>v&&Array.isArray(v.sets))):{};
  }catch(e){ initDraft(); store.removeItem(DRAFT_KEY); }
  // Restore edit mode across reloads — otherwise saving a restored draft duplicates the workout being edited.
  const draftEdit = state.draft?.editId ? String(state.draft.editId) : null;
  state.editId = draftEdit && state.sessions.some(s=>String(s.id)===draftEdit) ? draftEdit : null;
  if(!state.editId && state.draft) delete state.draft.editId;
}
/* Draft writes are debounced: state.draft is always current in memory, storage catches up
   after a pause in typing and is flushed when the page is hidden or closed. */
let draftSaveTimer=null;
function flushDraft(){ if(draftSaveTimer){ clearTimeout(draftSaveTimer); draftSaveTimer=null; } store.setItem(DRAFT_KEY, JSON.stringify(state.draft)); }
function saveDraft(){ state.draft.updated_at=nowIso(); clearTimeout(draftSaveTimer); draftSaveTimer=setTimeout(flushDraft,300); }
function cancelDraftSave(){ clearTimeout(draftSaveTimer); draftSaveTimer=null; }
function clearDraft(){ state.editId=null; initDraft(); cancelDraftSave(); store.removeItem(DRAFT_KEY); stopRest(); state.exIndex=firstOpenIndex(); fillSessionFields(); renderWorkout(); renderTrainStatus(); }
async function confirmClearDraft(){
  syncOpenBlock(); collectSessionFields();
  const hasData=Object.keys(state.draft.exercises).length>0 || !!state.draft.notes || state.draft.bw!=null || state.draft.meta.energy!=null || state.draft.meta.sleep!=null;
  if(hasData){ const ok=await modal({title:'Clear draft?',message:state.editId?'This stops editing and discards the unsaved changes on this device. The saved workout is not affected.':'This removes all unsaved sets and session info on this device. Saved workouts are not affected.',danger:true,confirmText:'Clear draft'}); if(!ok) return; }
  clearDraft(); if(hasData) toast('Draft cleared');
}

function applyProgram(p){ state.program=p; state.split=p.split || Object.keys(p.days||{}); metaIndex.clear(); for(const d of state.split){ for(const ex of (p.days?.[d]||[])){ if(!metaIndex.has(ex.name)) metaIndex.set(ex.name, ex); } } if(!state.split.includes(state.day)) state.day=state.split[0]; }
function loadProgramSync(){
  let p=null;
  try{ p=JSON.parse(document.getElementById('programFallback')?.textContent || 'null'); }catch(e){}
  if(!p || !p.days) throw new Error('Program failed to load');
  applyProgram(p);
}
async function refreshProgram(){
  try{
    const res = await fetch(`program.json?v=${APP_VERSION}`, {cache:'no-store'});
    if(!res.ok) return;
    const fresh = await res.json();
    if(!fresh || !fresh.days) return;
    if(fresh.version !== state.program?.version){ applyProgram(fresh); dataChanged(); } // dataChanged respects the typing/focus guard
    else state.program = fresh;
  }catch(e){}
}
function currentExercises(){ return state.program?.days?.[state.day] || []; }
function findExerciseMeta(name){ return metaIndex.get(name) || {}; }
function isBodyweightExercise(name){ return !!findExerciseMeta(name).bw; }

function renderApp(){ dirty.train=dirty.log=dirty.progress=true; renderAuth(); renderSyncChip(); renderDiagnostics(); renderActivePage(); }
function setPage(page){
  if(page===state.page){ window.scrollTo({top:0, behavior:'smooth'}); return; } // iOS: tap active tab → scroll to top
  pageScroll[state.page]=window.scrollY;
  state.page=page;
  $$('.page').forEach(p=>p.classList.toggle('active', p.dataset.page===page));
  $$('.navbtn').forEach(b=>{ const on=b.dataset.nav===page; b.classList.toggle('active', on); if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  if(page==='settings') renderAuth();
  renderActivePage();
  window.scrollTo(0, pageScroll[page]||0);
}
function renderTrain(){ dirty.train=false; const list=currentExercises(); if(state.exIndex>=list.length) state.exIndex=firstOpenIndex(); $('#weekNumber').textContent=state.week; renderDayTabs(); fillSessionFields(); renderWorkout(); renderTrainStatus(); }
function renderDayTabs(){ $('#dayTabs').innerHTML = state.split.map(d=>`<button class="chip ${d===state.day?'active':''}" data-day="${esc(d)}" type="button" aria-pressed="${d===state.day}">${esc(d)}</button>`).join(''); try{ $('#dayTabs .chip.active')?.scrollIntoView({inline:'nearest', block:'nearest'}); }catch(e){} }
function completedCount(){ return currentExercises().filter(ex => (state.draft.exercises[ex.name]?.sets||[]).some(s=>s.reps>0)).length; }
function renderTrainStatus(){
  const total=currentExercises().length, done=completedCount();
  const light=(state.program?.lightWeeks||[]).includes(state.week);
  $('#trainTitle').textContent=state.day;
  $('#trainSub').textContent=`${done}/${total} logged${light?' · light week':''}`;
  const pct=total?Math.round(done/total*100):0;
  const track=$('.progress-track'); if(track){ track.setAttribute('aria-valuenow', String(pct)); track.setAttribute('aria-valuetext', `${done} of ${total} exercises logged`); }
  $('#workoutProgress').style.width=`${pct}%`;
  const saveBtn=$('#saveWorkout'); if(saveBtn) saveBtn.textContent=state.editId?'Update workout':'Save workout';
  const clearBtn=$('#clearDraft'); if(clearBtn) clearBtn.textContent=state.editId?'Cancel edit':'Clear';
  // Edit mode gets an unmissable banner — the old '· editing' suffix was too easy to overlook.
  const banner=$('#editBanner');
  if(banner){
    if(state.editId){
      const s=state.sessions.find(x=>String(x.id)===String(state.editId));
      banner.innerHTML=`<span>✏️ Editing ${esc(s?`${s.day} · ${fmtDate(s.date)}`:'saved workout')}</span><button id="cancelEdit" type="button">Cancel</button>`;
      banner.hidden=false;
    } else { banner.hidden=true; banner.innerHTML=''; }
  }
  // Week stepper: disable at range bounds instead of silently doing nothing.
  const maxWeek=state.program?.weeks||12;
  const wm=$('#weekMinus'), wp=$('#weekPlus');
  if(wm) wm.disabled=state.week<=1;
  if(wp) wp.disabled=state.week>=maxWeek;
}
function lastBodyweight(){ if(lastBwCache!==undefined) return lastBwCache; const list=activeSessionsAsc(); lastBwCache=null; for(let i=list.length-1;i>=0;i--){ if(Number(list[i].bw)>0){ lastBwCache=list[i].bw; break; } } return lastBwCache; }
function fillSessionFields(){ const lastBw=lastBodyweight()||state.prefs.profile?.weight; $('#sDate').value=state.draft.date||localDate(); $('#sBw').value=state.draft.bw??''; $('#sBw').placeholder=lastBw?`${round(lastBw)} kg`:'kg'; $('#sNotes').value=state.draft.notes||''; $('#sEnergy').value=state.draft.meta.energy??''; $('#sSleep').value=state.draft.meta.sleep??''; }
function collectSessionFields(){ state.draft.date=$('#sDate').value||localDate(); state.draft.bw=$('#sBw').value===''?null:Math.max(0,Number($('#sBw').value)||0); state.draft.notes=$('#sNotes').value.trim().slice(0,180); state.draft.meta.energy=$('#sEnergy').value?clamp($('#sEnergy').value,1,5):null; state.draft.meta.sleep=$('#sSleep').value?clamp($('#sSleep').value,1,5):null; saveDraft(); }

/* ---- Logbook view: the whole day as one checklist, one exercise expanded at a time ---- */
function draftSetsFor(name){ return state.draft.exercises[name]?.sets || []; }
function isExerciseDone(name){ return draftSetsFor(name).some(s=>s.reps>0); }
function firstOpenIndex(){ const list=currentExercises(); const i=list.findIndex(ex=>!isExerciseDone(ex.name)); return i<0 ? -1 : i; } // -1: everything logged — show the day as a finished checklist
function shortSetLabel(s){ const load=Number(s.load)||0, reps=round(s.reps); return load>0 ? `${round(load)}\u00d7${reps}` : `${reps}${s.timed?'s':''}`; }
function collapsedSummary(ex, last){
  const drafted=draftSetsFor(ex.name).filter(s=>s.reps>0); // partial rows (load typed, reps pending) aren't a result yet
  if(drafted.length) return {text:drafted.map(shortSetLabel).join(' \u00b7 '), tone:'sum-done'};
  if(last) return {text:`Last ${last.sets.map(shortSetLabel).join(' \u00b7 ')}`, tone:'sum-last'};
  return {text:`${ex.sets} \u00d7 ${ex.reps}${ex.optional?' \u00b7 optional':''}`, tone:'sum-plan'};
}
function renderWorkout(){
  const list=currentExercises(); const host=$('#exerciseList'); if(!host) return;
  if(!list.length){ host.innerHTML='<div class="empty">No exercises for this day.<br>Pick another day above.</div>'; return; }
  host.innerHTML=list.map((ex,i)=>{
    const hist=exerciseEntries(ex.name); const last=hist[hist.length-1];
    const done=isExerciseDone(ex.name); const open=i===state.exIndex;
    const sum=collapsedSummary(ex,last);
    return `<article class="ex-block ${open?'open':''} ${done?'done':''}" data-ex="${esc(ex.name)}" data-i="${i}">
      <button class="ex-head" type="button" data-exi="${i}" aria-expanded="${open}">
        <span class="ex-status" aria-hidden="true">${done?'\u2713':i+1}</span>
        <span class="ex-title"><b>${esc(ex.name)}</b><small class="${sum.tone}">${esc(sum.text)}</small></span>
        <span class="ex-caret" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 10l4 4 4-4"/></svg></span>
      </button>
      ${open?renderExBody(ex,last):''}
    </article>`;
  }).join('');
  host.classList.toggle('advanced', !!state.prefs.showRir);
  if(restActive) tickRest(); // freshly rendered rest button shows the live countdown, not '…'
}
function renderExBody(ex,last){
  const saved=draftSetsFor(ex.name);
  const unitPh = ex.timed?'sec':'reps';
  const running = restActive && restExName===ex.name;
  // Render every drafted set, even beyond today's plan (edited workouts logged under an
  // older program keep their extra sets instead of silently losing them on update).
  const rows=Math.max(ex.sets, saved.length);
  let sets=''; for(let i=0;i<rows;i++){
    const s=saved[i] || {}; const prev=last?.sets?.[i] || null;
    const phLoad = prev && prev.load>0 ? String(round(prev.load)) : 'kg';
    const phReps = prev && prev.reps>0 ? String(round(prev.reps)) : unitPh;
    sets += `<div class="set-card" data-set="${i}"><div class="set-top"><button class="set-num" data-act="same" type="button" aria-label="Set ${i+1}: copy last time">${i+1}</button><input data-field="load" type="number" inputmode="decimal" min="0" step="0.5" placeholder="${esc(phLoad)}" aria-label="Set ${i+1} load, kg" value="${s.load||''}"><input data-field="reps" type="number" inputmode="numeric" min="0" step="1" placeholder="${esc(phReps)}" aria-label="Set ${i+1} ${ex.timed?'seconds':'reps'}" value="${s.reps||''}"><button class="set-clear" data-act="clearSet" type="button" aria-label="Clear set ${i+1}">\u00d7</button></div><div class="rir-field"><label>RIR<input data-field="rir" type="number" inputmode="numeric" min="0" max="5" step="1" placeholder="0-5" value="${s.rir??''}"></label></div></div>`;
  }
  return `<div class="ex-body">
    <div class="goal-row">
      <div class="goal-box"><span>Target ${esc(ex.reps)} \u00b7 RIR ${esc(String(ex.rir||'\u2014').replace(/\s+/g,''))}</span>${esc(makeGoal(ex,last))}</div>
      <button class="rest-btn ${running?'running':''}" data-rest type="button" aria-label="Rest timer">${running?'\u2026':'Rest '+esc(ex.rest||'2 min')}</button>
    </div>
    <p class="last-line">${last?`Last time <b>${last.sets.map(setLabel).map(esc).join(' \u00b7 ')}</b> \u00b7 ${esc(shortDate(last.date))}${last.e1rm>0 && !ex.timed && (last.best?.load>0 || ex.bw)?` \u00b7 e1RM ${round(last.e1rm)} kg`:''}`:'First session \u2014 set your baseline.'}</p>
    <div class="sets">${sets}</div>
    ${last && !state.prefs.usedAutofill?'<p class="hint">Tap a set number to fill in last time\u2019s numbers.</p>':''}
    <details class="tech"><summary>Technique</summary><div><p><b>Technique:</b> ${esc(ex.note||'\u2014')}</p><p><b>Substitutions:</b> ${(ex.substitutions||[]).map(esc).join(' \u00b7 ')||'\u2014'}</p></div></details>
  </div>`;
}
/* Starting-weight estimates for the first session of an exercise: typical novice working
   weights as a fraction of bodyweight (male; ~0.8\u00d7 for female). Fractions are per-implement
   (per dumbbell / per cable handle) for unilateral moves. Order matters \u2014 specific patterns
   (leg curl, kickback) must match before generic ones (curl, triceps). */
const START_FRACTIONS=[
  [/leg curl/, .4],[/leg extension/, .55],[/leg press/, 1.4],[/calf/, .9],
  [/hip thrust/, 1.0],[/rdl|deadlift/, .85],[/squat/, .8],
  [/incline press/, .5],[/chest press|bench press/, .55],
  [/pulldown/, .6],[/t-bar row|row/, .5],[/shrug/, .8],
  [/lateral raise/, .08],[/y-raise/, .06],[/reverse pec|rear delt|reverse.*flye/, .3],
  [/crunch/, .35],[/kickback/, .1],[/triceps/, .18],
  [/wrist/, .1],[/zottman|hammer/, .12],[/curl/, .14],
  [/pull-up|chin-up|dead hang/, 0]
];
function startingWeight(name){
  const p=state.prefs.profile||{};
  const bw=Number(lastBodyweight())||Number(p.weight)||76;
  const sexAdj=p.sex==='f'?0.8:1;
  const n=String(name).toLowerCase();
  for(const [re,frac] of START_FRACTIONS){ if(re.test(n)) return frac?plateRound(bw*frac*sexAdj):0; }
  return 0;
}
/* Goal line: personalized double progression.
   - no history: bodyweight-scaled starting weight (or a clean-baseline cue)
   - plateau/regression: 10% reset, rebuild through the rep range
   - top of the rep range hit: add a plate step, drop back to the bottom of the range
   - otherwise: same load, one more rep */
function makeGoal(ex,last){
  const range=String(ex.reps||'').match(/(\d+)\s*-\s*(\d+)/);
  const low=range?Number(range[1]):6, high=range?Number(range[2]):10;
  if(!last){
    if(ex.timed) return 'Set a baseline hold.';
    if(isBodyweightExercise(ex.name)) return `Bodyweight \u2014 aim ${low}+ clean reps`;
    const est=startingWeight(ex.name);
    return est?`Start ~${est} kg \u00d7 ${low}, leave 3 in the tank`:'Start clean, log consistent reps.';
  }
  const b=last.best;
  if(!(b.load>0)) return `Beat ${round(b.reps)} ${ex.timed?'sec':'reps'}${isBodyweightExercise(ex.name)&&!ex.timed?` \u2014 add weight past ${high}`:''}`;
  const sum=summaryForExercise(ex.name);
  if(sum && (sum.plateau||sum.regressing)) return `Reset: ${plateRound(b.load*0.9)} kg \u00d7 ${high}, then climb`;
  if(b.reps>=high) return `Go up: ${plateRound(b.load+(b.load>=60?2.5:1.25))} kg \u00d7 ${low}`;
  return `Aim ${round(b.load)} kg \u00d7 ${Math.min(high, Math.floor(b.reps)+1)}`;
}
function updateSetsFor(block){
  if(!block) return;
  const name=block.dataset.ex; const meta=findExerciseMeta(name); const sets=[];
  // Keep partial rows (load typed, reps still empty) and row positions so a re-render
  // doesn't wipe or shift half-entered data; save-time normalizeSet still drops rows
  // without reps. Trailing empty rows are trimmed.
  $$('.set-card',block).forEach(card=>{ const load=Number($('[data-field="load"]',card).value)||0, reps=Number($('[data-field="reps"]',card).value)||0, rir=$('[data-field="rir"]',card)?.value ?? ''; sets.push((reps>0||load>0||rir!=='')?{load:Math.max(0,load), reps:Math.max(0,reps), rir:rir===''?null:clamp(rir,0,5), timed:!!meta.timed}:null); });
  while(sets.length && !sets[sets.length-1]) sets.pop();
  for(let i=0;i<sets.length;i++) if(!sets[i]) sets[i]={load:0, reps:0, rir:null, timed:!!meta.timed};
  if(sets.length) state.draft.exercises[name]={sets}; else delete state.draft.exercises[name];
  const counted=sets.some(s=>s.reps>0);
  if(counted && !state.draft.meta.startedAt) state.draft.meta.startedAt=nowIso();
  saveDraft(); renderTrainStatus();
  block.classList.toggle('done',counted);
  const st=$('.ex-status',block); if(st) st.textContent=counted?'\u2713':(Number(block.dataset.i)+1);
}
function syncOpenBlock(){ updateSetsFor($('#exerciseList .ex-block.open')); }
function toggleExercise(i){
  syncOpenBlock();
  state.exIndex = state.exIndex===i ? -1 : i;
  renderWorkout();
  if(state.exIndex>=0){ const el=$(`.ex-block[data-i="${state.exIndex}"]`); el?.scrollIntoView({block:'nearest',behavior:'smooth'}); }
}
function applyQuick(card, action){ if(!card) return; const block=card.closest('.ex-block'); const name=block?.dataset.ex; if(!name) return; const load=$('[data-field="load"]',card), reps=$('[data-field="reps"]',card), idx=Number(card.dataset.set), last=exerciseEntries(name).slice(-1)[0]?.sets?.[idx] || null; if(action==='same'){ if(!last) return toast('No previous set'); load.value=last.load||''; reps.value=last.reps||''; haptic(8); if(!state.prefs.usedAutofill){ state.prefs.usedAutofill=true; $$('.hint').forEach(h=>h.remove()); saveLocal(false); } } if(action==='clearSet'){ load.value=''; reps.value=''; const rir=$('[data-field="rir"]',card); if(rir) rir.value=''; } updateSetsFor(block); }

/* Rest timer \u2014 parses the plan's rest range, keeps running while you browse, vibrates when done. */
let restInterval=null, restEndsAt=0, restExName='', restActive=false;
function parseRestSeconds(rest){ const range=String(rest||'').match(/(\d+)\s*-\s*(\d+)/); const single=String(rest||'').match(/\d+/); const mins=range?Number(range[2]):(single?Number(single[0]):2); return clamp(mins,1,10)*60; }
function currentRestBtn(){ const block=$('#exerciseList .ex-block.open'); return block && block.dataset.ex===restExName ? $('[data-rest]',block) : null; }
function restPill(){ return $('#restPill'); }
/* The ticker is separate from the timer: the end time is a timestamp, so the interval can be
   stopped while the app is hidden (screen off, other tab) and restarted on return without
   losing accuracy. 500 ms is enough for a 1 s countdown; DOM writes only happen on change. */
function startRestTicker(){ if(!restInterval){ tickRest(); if(restActive) restInterval=setInterval(tickRest,500); } }
function stopRestTicker(){ if(restInterval){ clearInterval(restInterval); restInterval=null; } }
function stopRest(){ stopRestTicker(); const b=currentRestBtn(); if(b){ b.classList.remove('running'); const meta=findExerciseMeta(restExName); b.textContent=`Rest ${meta.rest||'2 min'}`; } const pill=restPill(); if(pill) pill.hidden=true; restActive=false; restExName=''; }
function tickRest(){ const left=Math.max(0,Math.round((restEndsAt-Date.now())/1000)); const label=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`; const b=state.page==='train'?currentRestBtn():null; const pill=restPill(); if(b){ if(b.textContent!==label) b.textContent=label; if(pill) pill.hidden=true; } else if(pill){ const t=`Rest ${label}`; if(pill.textContent!==t) pill.textContent=t; pill.hidden=false; } if(left<=0){ stopRest(); try{ navigator.vibrate?.([200,120,200]); }catch(e){} toast('Rest over \u2014 next set'); } }
function toggleRest(btn){ const block=btn.closest('.ex-block'); const name=block?.dataset.ex; if(!name) return; if(restActive && restExName===name) return stopRest(); if(restActive) stopRest(); const meta=findExerciseMeta(name); restExName=name; restActive=true; restEndsAt=Date.now()+parseRestSeconds(meta.rest)*1000; btn.classList.add('running'); startRestTicker(); }
function shiftWeek(n){ state.week=clamp(state.week+n,1,state.program?.weeks||12); saveLocal(); renderTrainStatus(); $('#weekNumber').textContent=state.week; }

/* Unit-consistent per-set strength: seconds for timed work, e1RM kg otherwise — with
   bodyweight folded into the load for bodyweight exercises, so 12 pull-ups vs +10 kg × 6
   compare as total-system strength instead of reps-vs-kilograms. */
function strengthValue(s, name, session){
  const meta=findExerciseMeta(name);
  if(s.timed || meta.timed) return Number(s.reps)||0;
  if(meta.bw){ const bw=bodyweightForSession(session); if(bw>0) return e1rm({...s, load:(Number(s.load)||0)+bw}); }
  return e1rm(s)||Number(s.reps)||0;
}
function bestValue(sets, name, session){ return Math.max(0,...(sets||[]).map(s=>strengthValue(s,name,session))); }
function detectPRs(session){
  const prior=state.sessions.filter(s=>String(s.id)!==String(session.id) && !state.pendingDeletes.has(String(s.id)));
  const out=[];
  for(const ex of session.exercises){
    let prevBest=0, seen=false;
    for(const s of prior){ const m=s.exercises.find(e=>e.name===ex.name); if(!m) continue; seen=true; prevBest=Math.max(prevBest,bestValue(m.sets,ex.name,s)); }
    if(seen && bestValue(ex.sets,ex.name,session)>prevBest) out.push(ex.name);
  }
  return out;
}

async function saveWorkout(){
  if(state.saving) return;
  state.saving = true;
  const saveBtn = $('#saveWorkout');
  if(saveBtn) saveBtn.disabled = true;
  try{
    syncOpenBlock();
    collectSessionFields();
    // When editing, the draft came from the saved workout: keep every exercise, even ones no
    // longer in the current day's plan (day switches and program updates must not silently
    // strip logged training data from the workout being edited).
    const editing=!!state.editId;
    const dayNames=new Set(currentExercises().map(x=>x.name));
    const draftEntries=Object.entries(state.draft.exercises);
    const exercises=draftEntries.filter(([name])=>editing||dayNames.has(name)).map(([name, data])=>normalizeExercise({name,sets:data.sets})).filter(Boolean);
    const leftovers=editing?{}:Object.fromEntries(draftEntries.filter(([name])=>!dayNames.has(name)));
    if(!exercises.length){ toast(Object.keys(leftovers).length?`No sets for ${state.day} yet — your other entries are kept in the draft.`:'Enter at least one set.'); return; }
    const meta=normalizeMeta(state.draft.meta);
    if(!state.editId && meta.startedAt){
      meta.finishedAt=nowIso();
      const mins=Math.round((Date.now()-new Date(meta.startedAt).getTime())/60000);
      meta.durationMin=mins>=1 && mins<=600 ? mins : null;
    }
    const session={id:state.editId||uid(), date:state.draft.date||localDate(), week:state.week, day:state.day, bw:state.draft.bw, notes:state.draft.notes, exercises, meta, updated_at:nowIso()};
    if(!state.editId){
      const duplicate = duplicateOf(session);
      if(duplicate){
        const ok = await modal({title:'Duplicate workout?', message:`An identical ${duplicate.day} log already exists for ${fmtDate(duplicate.date)}. Replace that log instead of creating another copy?`, confirmText:'Replace existing'});
        if(!ok){ toast('Duplicate not saved'); return; }
        session.id = duplicate.id;
        session.updated_at = nowIso();
      }
    }
    const prs=detectPRs(session);
    const idx=state.sessions.findIndex(s=>s.id===session.id);
    const wasNew=idx<0;
    if(idx>=0) state.sessions[idx]=session; else state.sessions.push(session);
    if(state.pendingDeletes.has(String(session.id))) unqueueDelete(session.id);
    queueUpsert(session.id);
    state.editId=null;
    if(Object.keys(leftovers).length){ state.draft={...createDraft(), exercises:leftovers}; saveDraft(); }
    else { initDraft(); cancelDraftSave(); store.removeItem(DRAFT_KEY); }
    stopRest();
    state.exIndex=firstOpenIndex();
    // On iOS, tapping Save doesn't move focus off the last input — blur it so the focus
    // guard in dataChanged() can't leave the just-saved sets visible as a stale draft.
    if(document.activeElement?.closest?.('#pageTrain')) document.activeElement.blur();
    saveLocal(); dataChanged();
    if(state.page==='train' && dirty.train) renderTrain();
    haptic(prs.length?[15,70,15]:12);
    if(prs.length) confetti();
    const milestone=wasNew?milestoneMessage(session):'';
    const prMsg=prs.length?`🏆 PR · ${prs[0]}${prs.length>1?` +${prs.length-1} more`:''} — `:'';
    if(state.user){ const r=await syncNow(false); toast(r===true?`${prMsg}saved & synced`:r==='busy'?`${prMsg}saved · syncing…`:`${prMsg}saved locally · sync pending`, r===true||r==='busy'?'':'danger'); }
    else { toast(`${prMsg}saved locally`); }
    if(milestone) setTimeout(()=>{ toast(milestone); confetti(36); haptic([12,60,12,60,12]); }, 1800);
    if(wasNew){ const earned=checkBadges(buildBadgeCtx(session, prs)); if(earned.length) setTimeout(()=>revealBadges(earned), 900); }
  } finally {
    state.saving = false;
    if(saveBtn) saveBtn.disabled = false;
  }
}


function sessionInfoLine(s){
  const bits=[s.bw?`BW ${round(s.bw)} kg`:'', s.meta?.energy?`Energy ${s.meta.energy}/5`:'', s.meta?.sleep?`Sleep ${s.meta.sleep}/5`:''].filter(Boolean).join(' · ');
  const notes=String(s.notes||'').trim();
  return `${bits?`<div class="small" style="margin-top:8px">${esc(bits)}</div>`:''}${notes?`<div class="small" style="margin-top:${bits?'2px':'8px'}">“${esc(notes)}”</div>`:''}`;
}
/* Log list: newest first, grouped by month, paginated, details rendered on demand.
   Keeping the details out of the initial markup keeps the DOM small on long histories. */
let logVisibleCount=30;
const expandedLog=new Set(); // ids of open log cards — survives re-renders (Show more, background sync)
function monthLabel(d){ const x=new Date(`${d}T00:00:00`); return Number.isNaN(x.getTime())?d:x.toLocaleDateString(undefined,{month:'long',year:'numeric'}); }
function sessionDetailsHtml(s){
  return `${sessionInfoLine(s)}${s.exercises.map(e=>`<div style="margin-top:8px"><b>${esc(e.name)}</b><div class="small">${e.sets.map(setLabel).join(', ')}</div></div>`).join('')}<div class="grid2" style="margin-top:12px"><button class="btn secondary" data-edit="${esc(s.id)}" type="button">Edit</button><button class="btn danger-outline" data-delete="${esc(s.id)}" type="button">Delete</button></div>`;
}
function renderHistory(){
  dirty.log=false;
  purgeQueuedLocalDeletes();
  const host=$('#logList'); if(!host) return;
  const list=[...activeSessionsAsc()].reverse();
  if(!list.length){
    const lines=['Log your first sets in Train.','The best day to start was yesterday.<br>Second best: today.','Every legend’s logbook has a page one.','The iron is patient. It’ll wait — but not forever.'];
    host.innerHTML=`<div class="empty">🏋️ No workouts yet.<br>${lines[new Date().getDate()%lines.length]}</div>`; return;
  }
  const sigCount=new Map(); const sigs=new Map();
  for(const s of list){ const sig=sessionSignature(s); sigs.set(s,sig); sigCount.set(sig,(sigCount.get(sig)||0)+1); }
  const shown=list.slice(0, logVisibleCount);
  let html='', curMonth='';
  for(const s of shown){
    const m=String(s.date).slice(0,7);
    if(m!==curMonth){ curMonth=m; html+=`<h3 class="log-month">${esc(monthLabel(s.date))}</h3>`; }
    const similar=sigCount.get(sigs.get(s))-1;
    const ts=updatedAt(s); const time=ts ? new Date(ts).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}) : '';
    html+=`<article class="session" data-id="${esc(s.id)}">
      <button class="session-head" data-open="${esc(s.id)}" type="button" aria-expanded="false">
        <span class="session-title"><b>${esc(s.day)}</b><span class="small">Week ${s.week} · ${esc(fmtDate(s.date))} · ${s.exercises.length} exercises${s.meta?.durationMin?` · ${s.meta.durationMin} min`:''}${time?` · ${esc(time)}`:''}${similar?` · ${similar} similar`:''}</span></span>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>
      </button>
      <div class="session-details" hidden></div>
    </article>`;
  }
  if(list.length>shown.length) html+=`<button class="btn secondary show-more" data-more type="button">Show ${Math.min(50, list.length-shown.length)} more · ${list.length-shown.length} left</button>`;
  host.innerHTML=html;
  // Restore cards the user had open before this rebuild.
  if(expandedLog.size){
    const ids=new Set(list.map(s=>String(s.id)));
    for(const id of [...expandedLog]){ if(!ids.has(id)) expandedLog.delete(id); }
    for(const id of expandedLog){
      const btn=host.querySelector(`[data-open="${CSS.escape(id)}"]`); if(!btn) continue;
      const cardEl=btn.closest('.session'); const body=cardEl?.querySelector('.session-details'); if(!body) continue;
      const s=state.sessions.find(x=>String(x.id)===id);
      body.innerHTML=s?sessionDetailsHtml(s):'<p class="muted">Workout not found.</p>'; body.dataset.ready='1';
      body.hidden=false; cardEl.classList.add('expanded'); btn.setAttribute('aria-expanded','true');
    }
  }
}

async function deleteSession(id, card=null){
  if(state.deleting) return;
  state.deleting=true;
  try{
    id = String(id);
    const session = state.sessions.find(s => String(s.id) === id);
    const label = session ? `${session.day} · ${fmtDate(session.date)}` : 'this workout';
    const similar = session ? similarSessionCount(session) : 0;
    const cloudable = !!state.user || hasStoredSupabaseSession();
    const ok = await modal({
      title:'Delete workout?',
      message:`Delete ${label}?${similar?` There ${similar===1?'is':'are'} ${similar} similar saved log${similar===1?'':'s'}, but this deletes only this selected log.`:''}${cloudable?' It will also be removed from your cloud backup on the next sync.':''}`,
      danger:true,
      confirmText:'Delete'
    });
    if(!ok) return;
    if(card){
      card.style.maxHeight = `${card.offsetHeight}px`;
      card.offsetHeight;
      card.classList.add('removing');
      await new Promise(r=>setTimeout(r,190));
    }
    state.sessions = state.sessions.filter(s => String(s.id) !== id);
    if(state.editId === id) state.editId = null;
    queueDelete(id, session);
    unqueueUpsert(id);
    saveLocal();
    dataChanged();
    renderDiagnostics();
    // Undo restores the exact session object and re-queues it for upload (the cloud copy
    // may already be tombstoned by the sync below).
    const undo = session ? {label:'Undo', fn:()=>{ if(state.sessions.some(s=>String(s.id)===id)) return; unqueueDelete(id); state.sessions.push(session); invalidateDataCache(); queueUpsert(id); saveLocal(); dataChanged(); toast('Workout restored'); if(state.user) syncNow(false); }} : null;
    toast('Workout deleted', '', undo);
    if(state.user){
      const r = await syncNow(false);
      toast(r===true?'Workout deleted & synced':r==='busy'?'Workout deleted · syncing…':'Workout deleted · cloud delete pending', r===true||r==='busy'?'':'danger', undo);
      renderSyncChip();
      renderDiagnostics();
    }
  } finally {
    state.deleting=false;
  }
}


function editSession(id){ const s=state.sessions.find(x=>x.id===id); if(!s) return; state.editId=s.id; state.week=s.week; state.day=s.day; state.exIndex=0; state.draft={date:s.date,bw:s.bw,notes:s.notes,meta:normalizeMeta(s.meta),exercises:Object.fromEntries(s.exercises.map(e=>[e.name,{sets:e.sets}])),editId:s.id}; flushDraft(); setPage('train'); renderTrain(); toast('Editing workout'); }

function setLabel(s){ const load=Number(s.load)||0, reps=round(s.reps); const base=load>0 ? `${round(load)}×${reps}` : `${reps} ${s.timed?'sec':'reps'}`; return `${base}${s.rir!=null?` · RIR ${s.rir}`:''}`; }
function bestSet(sets){ return [...sets].sort((a,b)=>{ const av=metricSet(a,'e1rm')||metricSet(a,'reps'); const bv=metricSet(b,'e1rm')||metricSet(b,'reps'); return bv-av; })[0] || null; }
/* Estimated 1RM: mean of Epley and Brzycki (Epley alone overshoots at high reps, Brzycki
   undershoots), with logged RIR folded in as reps-in-the-tank — a set of 8 @ RIR 2 reflects
   the same strength as 10 to failure. Reps capped where the formulas stay reliable. */
function e1rm(s){
  const load=Number(s?.load)||0;
  if(load<=0) return 0;
  let reps=Math.min(Number(s.reps)||0, 15);
  if(s.rir!=null && s.rir!=='') reps=Math.min(reps + clamp(s.rir,0,4), 16);
  if(reps<=0) return 0;
  if(reps===1) return load;
  return (load*(1+reps/30) + load*36/(37-reps)) / 2;
}
/* Least-squares slope over the last 6 entries, as % of their mean per entry —
   a noise-tolerant trend signal for plateau/regression detection. */
function trendSlope(vals){
  const v=vals.slice(-6), n=v.length;
  if(n<3) return 0;
  const mx=(n-1)/2, my=v.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0;
  for(let i=0;i<n;i++){ num+=(i-mx)*(v[i]-my); den+=(i-mx)*(i-mx); }
  const slope=den?num/den:0;
  return my?slope/my*100:0;
}
function plateRound(v){ v=Math.max(0,Number(v)||0); const step=v>=20?2.5:1.25; return Math.round(v/step)*step; }
/* Session bw → last logged bw → profile weight, so pull-up volume doesn't silently drop to
   zero when the optional Bodyweight field is left empty. */
function bodyweightForSession(session){ return Number(session?.bw)||Number(lastBodyweight())||Number(state.prefs.profile?.weight)||0; }
/* Timed holds are excluded from tonnage: counting bodyweight×seconds as kg×reps inflated
   lifetime volume by thousands of kg per dead hang. */
function setVolume(s, name, session){ if(s?.timed) return 0; const bw=isBodyweightExercise(name)?bodyweightForSession(session):0; return ((Number(s.load)||0) + bw) * (Number(s.reps)||0); }
function metricSet(s, metric){ if(metric==='load') return Number(s.load)||0; if(metric==='reps') return Number(s.reps)||0; if(metric==='e1rm') return e1rm(s); return Number(s.load||0)*Number(s.reps||0); }
function exerciseEntries(name){
  if(entryCache.has(name)) return entryCache.get(name);
  const out=[];
  for(const session of activeSessionsAsc()){
    const ex=session.exercises.find(e=>e.name===name); if(!ex) continue;
    const best=bestSet(ex.sets);
    out.push({session, date:session.date, name, sets:ex.sets, best, e1rm:strengthValue(best,name,session), load:Math.max(...ex.sets.map(s=>s.load||0)), reps:Math.max(...ex.sets.map(s=>s.reps||0)), volume:ex.sets.reduce((sum,s)=>sum+setVolume(s,name,session),0)});
  }
  entryCache.set(name, out);
  return out;
}
function exerciseNames(){ if(!namesCache){ const set=new Set(); for(const s of activeSessionsAsc()) for(const e of s.exercises) set.add(e.name); namesCache=[...set].sort((a,b)=>a.localeCompare(b)); } return namesCache; }
function autoMetric(name){ const hasLoad=exerciseEntries(name).some(e=>e.load>0); const meta=findExerciseMeta(name); if(meta.timed) return 'reps'; return hasLoad ? 'e1rm' : 'reps'; }
function valueForEntry(e, metric){ if(metric==='load') return e.load; if(metric==='reps') return e.reps; if(metric==='volume') return e.volume; return e.e1rm || e.reps; }
function unitForMetric(metric){ if(metric==='volume') return 'kg×reps'; if(metric==='reps') return 'reps/sec'; return 'kg'; }
function allSummaries(){ return exerciseNames().map(name=>summaryForExercise(name)).filter(Boolean); }
function summaryForExercise(name){ if(summaryCache.has(name)) return summaryCache.get(name); const entries=exerciseEntries(name); let out=null; if(entries.length){ const metric=autoMetric(name), vals=entries.map(e=>valueForEntry(e,metric)), best=Math.max(...vals), latest=vals[vals.length-1], first=vals[0], change=latest-first, percent=first?change/first*100:0; const lastBestIndex=vals.lastIndexOf(best); const noNewHigh=entries.length-1-lastBestIndex; const trend=trendSlope(vals); const plateau=entries.length>=4 && noNewHigh>=3 && trend<0.35; const regressing=entries.length>=5 && trend<=-1 && latest<best*0.97; out={name, entries:entries.length, metric, unit:unitForMetric(metric), best, latest, first, change, percent, noNewHigh, trend, plateau, regressing}; } summaryCache.set(name, out); return out; }
function renderProgress(){
  dirty.progress=false;
  const names=exerciseNames();
  const sel=$('#progressExercise');
  const previous=sel.value || state.progressExercise || '';
  sel.innerHTML=names.map(n=>`<option value="${esc(n)}" ${n===previous?'selected':''}>${esc(n)}</option>`).join('');
  if(previous && names.includes(previous)) sel.value=previous;
  state.progressExercise=sel.value || names[0] || '';
  if(state.progressView==='overall') renderOverall(); else renderExerciseProgress(state.progressExercise);
}

function setProgressView(view){ const overall=view==='overall'; $('#viewOverall').classList.toggle('active',overall); $('#viewOverall').setAttribute('aria-pressed',String(overall)); $('#viewExercise').classList.toggle('active',!overall); $('#viewExercise').setAttribute('aria-pressed',String(!overall)); }
function renderOverall(){ $('#progressControls').style.display='none'; setProgressView('overall'); const sessions=[...state.sessions].filter(s=>!state.pendingDeletes.has(String(s.id))).sort((a,b)=>new Date(a.date)-new Date(b.date)); const summaries=allSummaries(); const totalSets=sessions.reduce((sum,s)=>sum+s.exercises.reduce((a,e)=>a+e.sets.length,0),0); const volume=sessions.map(s=>s.exercises.reduce((sum,e)=>sum+e.sets.reduce((a,set)=>a+setVolume(set,e.name,s),0),0)); const weak=summaries.filter(x=>x.plateau||x.regressing); const improving=summaries.filter(x=>x.percent>0); renderStats([['Workouts',sessions.length],['Sets',totalSets],['Improving',improving.length],['Plateaus',weak.length]]); $('#chartTitle').textContent='Overall workload'; $('#chartSubtitle').textContent=sessions.length?`Last ${Math.min(18,sessions.length)} workouts · kg×reps`:''; drawChart(volume, sessions.map(s=>s.date), 'kg×reps'); renderInsights(); $('#listTitle').textContent='Exercise summary'; $('#progressList').innerHTML=summaries.length?summaries.sort((a,b)=>b.percent-a.percent).map(s=>`<div class="progress-row"><div><b>${esc(s.name)}</b><div class="small">${s.entries} logs · best ${round(s.best)} ${esc(s.unit)}</div></div><div class="metric">${s.percent>=0?'+':''}${round(s.percent)}%</div></div>`).join(''):'<div class="empty">No progress yet. Save a workout first.</div>'; }
function renderExerciseProgress(name){ $('#progressControls').style.display='grid'; setProgressView('exercise'); if(!name){ renderStats([['Best','—'],['Latest','—'],['Change','—'],['Entries',0]]); $('#chartBox').innerHTML='<div class="empty">No chart data.</div>'; renderInsights(); return; } let metric=$('#progressMetric').value==='auto'?autoMetric(name):$('#progressMetric').value; if(findExerciseMeta(name).timed && metric==='e1rm') metric='reps'; /* seconds are not kilograms */ const entries=exerciseEntries(name); const vals=entries.map(e=>valueForEntry(e,metric)); const unit=unitForMetric(metric); const best=vals.length?Math.max(...vals):0, latest=vals[vals.length-1]||0, first=vals[0]||0, change=latest-first; renderStats([['Best',`${round(best)} ${unit}`],['Latest',`${round(latest)} ${unit}`],['Change',`${change>=0?'+':''}${round(change)} ${unit}`],['Entries',entries.length]]); $('#chartTitle').textContent=`${name} · ${metric==='e1rm'?'Estimated 1RM':metric}`; $('#chartSubtitle').textContent=`Last ${Math.min(18, entries.length)} entries`; drawChart(vals, entries.map(e=>e.date), unit); renderInsights(name); $('#listTitle').textContent='Recent entries'; $('#progressList').innerHTML=entries.slice(-12).reverse().map(e=>`<div class="progress-row"><div><b>${esc(fmtDate(e.date))}</b><div class="small">Best set: ${setLabel(e.best)}</div></div><div class="metric">${round(valueForEntry(e,metric))} ${unit}</div></div>`).join('') || '<div class="empty">No entries.</div>'; }
function renderStats(rows){ $('#statsGrid').innerHTML=rows.map(([l,v])=>`<div class="stat"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join(''); }
/* Chart is drawn in real pixel space (no viewBox stretching), so points stay round,
   the line can be smoothed, and axis labels are readable. Redrawn on resize. */
let lastChart=null;
function smoothPath(pts){
  if(pts.length<3) return 'M'+pts.map(p=>`${round(p[0])} ${round(p[1])}`).join(' L ');
  let d=`M${round(pts[0][0])} ${round(pts[0][1])}`;
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||p2;
    d+=`C${round(p1[0]+(p2[0]-p0[0])/6)} ${round(p1[1]+(p2[1]-p0[1])/6)} ${round(p2[0]-(p3[0]-p1[0])/6)} ${round(p2[1]-(p3[1]-p1[1])/6)} ${round(p2[0])} ${round(p2[1])}`;
  }
  return d;
}
function drawChart(values, labels, unit){
  lastChart={values, labels, unit};
  const box=$('#chartBox'); if(!box) return;
  if(!values.length){ box.innerHTML='<div class="empty">No chart data yet.</div>'; return; }
  const n=18, vs=values.slice(-n).map(Number), ls=labels.slice(-n);
  const W=Math.max(260, Math.round(box.clientWidth-24)) || 300, H=216;
  const padL=10, padR=12, padT=30, padB=26, w=W-padL-padR, h=H-padT-padB;
  const minRaw=Math.min(...vs), maxRaw=Math.max(...vs), pad=(maxRaw-minRaw)*.15 || Math.max(1,maxRaw*.15);
  const min=Math.max(0,minRaw-pad), max=maxRaw+pad, span=max-min||1;
  const yOf=v=>padT+(1-(v-min)/span)*h;
  const pts=vs.map((v,i)=>[vs.length===1?padL+w/2:padL+i/(vs.length-1)*w, yOf(v), v]);
  const line=smoothPath(pts);
  const area=pts.length>1?`${line} L ${round(pts[pts.length-1][0])} ${H-padB} L ${round(pts[0][0])} ${H-padB} Z`:'';
  const last=pts[pts.length-1];
  const lastLabelY=last[1]<padT+16 ? last[1]+18 : last[1]-10;
  // The value label on the last point already shows its number — drop the axis label for an
  // extreme the last point sits on, so the two don't collide in the top/bottom-right corner.
  const flat=minRaw===maxRaw;
  const nearRight=last[0]>W-72;
  const gridYs=(flat?[[yOf(maxRaw),maxRaw,-4]]:[[yOf(maxRaw),maxRaw,-4],[yOf(minRaw),minRaw,12]])
    .map(([y,v,dy])=>[y,v,dy,!(nearRight && last[2]===v)]);
  const sameDates=ls.length<2 || ls[0]===ls[ls.length-1];
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Progress chart">
    <defs><linearGradient id="mmArea" x1="0" y1="0" x2="0" y2="1"><stop class="grad-a" offset="0"/><stop class="grad-b" offset="1"/></linearGradient></defs>
    ${gridYs.map(([y,v,dy,showLabel])=>`<line class="grid-line" x1="${padL}" y1="${round(y)}" x2="${W-padR}" y2="${round(y)}"/>${showLabel?`<text class="axis-label" x="${W-padR}" y="${round(y)+dy}" text-anchor="end">${round(v)}</text>`:''}`).join('')}
    ${pts.length>1?`<path class="chart-area" d="${area}" fill="url(#mmArea)"/><path class="chart-line" d="${line}"/>`:''}
    ${pts.map((p,i)=>`<circle class="chart-hit" cx="${round(p[0])}" cy="${round(p[1])}" r="16" data-v="${round(p[2])}" data-u="${esc(unit)}" data-d="${esc(shortDate(ls[i]))}"/>`).join('')}
    ${pts.map((p,i)=>`<circle class="chart-point${i===pts.length-1?' last':''}" cx="${round(p[0])}" cy="${round(p[1])}" r="${i===pts.length-1?4.5:3}" data-v="${round(p[2])}" data-u="${esc(unit)}" data-d="${esc(shortDate(ls[i]))}"><title>${round(p[2])} ${esc(unit)} · ${esc(shortDate(ls[i]))}</title></circle>`).join('')}
    <text class="chart-value" x="${round(Math.min(Math.max(last[0],26),W-30))}" y="${round(lastLabelY)}" text-anchor="middle">${round(last[2])}</text>
    <text class="axis-label" x="${padL}" y="${H-8}">${esc(shortDate(ls[0]))}</text>
    ${sameDates?'':`<text class="axis-label" x="${W-padR}" y="${H-8}" text-anchor="end">${esc(shortDate(ls[ls.length-1]))}</text>`}
  </svg>`;
}
function renderInsights(selected=''){ const sums=allSummaries(); const achievements=sums.filter(x=>x.percent>0).sort((a,b)=>b.percent-a.percent).slice(0,4); const weak=sums.filter(x=>x.plateau||x.regressing).sort((a,b)=>b.noNewHigh-a.noNewHigh||a.percent-b.percent).slice(0,4); $('#recordsPanel').innerHTML='<h2>Records & achievements</h2>'+(achievements.length?achievements.map(x=>`<div class="progress-row"><div><b>${esc(x.name)}</b><div class="small">Best ${round(x.best)} ${esc(x.unit)} · ${x.entries} entries</div></div><div class="metric">+${round(x.percent)}%</div></div>`).join(''):'<p class="muted">No positive trend yet.</p>'); $('#weakPanel').innerHTML='<h2>Weak points</h2>'+(weak.length?weak.map(x=>`<div class="progress-row"><div><b>${esc(x.name)}</b><div class="small">${x.regressing?'Trending down':`No new high for ${x.noNewHigh} entries`} · latest ${round(x.latest)} ${esc(x.unit)}</div></div><div class="metric">${round(x.percent)}%</div></div>`).join(''):'<p class="muted">No plateau detected.</p>'); }

/* The Supabase SDK (~120 KB gz) is injected only when actually needed — a stored auth
   session exists or the user taps Sign in — instead of being parsed on every startup. */
let sdkPromise=null;
function loadSupabaseSdk(){
  if(window.supabase) return Promise.resolve(true);
  if(sdkPromise) return sdkPromise;
  sdkPromise=new Promise(resolve=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.async=true;
    s.onload=()=>resolve(true);
    s.onerror=()=>{ sdkPromise=null; resolve(false); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}
function hasStoredSupabaseSession(){ try{ for(let i=0;i<window.localStorage.length;i++){ const k=window.localStorage.key(i); if(k && k.startsWith('sb-') && k.includes('auth-token')) return true; } }catch(e){} return false; }
async function getSupabase(){ if(state.supabase) return state.supabase; if(!SUPABASE_URL || !SUPABASE_ANON_KEY) return null; if(!(await loadSupabaseSdk()) || !window.supabase) return null; state.supabase=window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); return state.supabase; }
function cloudErrorText(error){ return String(error?.message || error?.details || error?.hint || error || ''); }
function cloudUnavailableMsg(){ return typeof navigator!=='undefined' && navigator.onLine===false ? 'You’re offline — sync will resume when you’re back online' : 'Can’t reach the sync server — try again in a moment'; }
function toDb(s){ return {id:String(s.id),user_id:state.user.id,date:s.date,week:s.week,day:s.day,bw:s.bw,notes:s.notes,exercises:s.exercises,meta:s.meta||{},updated_at:updatedAt(s),deleted_at:null}; }
function fromDb(r){ if(!r || r.deleted_at) return null; return normalizeSession({id:r.id,user_id:r.user_id,date:r.date,week:r.week,day:r.day,bw:r.bw,notes:r.notes,exercises:r.exercises,meta:r.meta||{},updated_at:r.updated_at,deleted_at:r.deleted_at}); }
function deleteTombstoneRow(id){ const meta=state.deleteMeta[String(id)]||{}; const snap=meta.snapshot||{}; const deletedAtValue=meta.deletedAt||nowIso(); return {id:String(id),user_id:state.user.id,date:snap.date||localDate(),week:clamp(snap.week||1,1,12),day:state.split.includes(snap.day)?snap.day:(state.split[0]||'Full Body'),bw:snap.bw??null,notes:snap.notes||'',exercises:Array.isArray(snap.exercises)?snap.exercises:[],meta:normalizeMeta(snap.meta||{}),updated_at:deletedAtValue,deleted_at:deletedAtValue}; }
let authListenerOn=false;
async function initAuth(){ if(!hasStoredSupabaseSession()){ renderAuth(); renderSyncChip(); return; } const sb=await getSupabase(); if(!sb){ renderAuth(); renderSyncChip(); return; } /* getSession reads local storage, so a signed-in user stays signed in when the app starts offline */ const {data}=await sb.auth.getSession(); state.user=data?.session?.user||null; if(!authListenerOn){ authListenerOn=true; sb.auth.onAuthStateChange((ev,session)=>{ state.user=session?.user||null; renderAuth(); renderSyncChip(); if(state.user) syncNow(false); }); } renderAuth(); renderSyncChip(); if(state.user) await syncNow(false); }
function renderAuth(){
  const el=$('#authBox'); if(!el) return;
  const mode=state.user?'in':'out';
  if(el.dataset.mode===mode && mode==='out') return; // don't wipe half-typed credentials on tab revisits
  el.dataset.mode=mode;
  if(state.user){ const email=state.user.email||'Signed in'; el.innerHTML=`<div class="account-row"><span class="avatar" aria-hidden="true">${esc((email[0]||'?').toUpperCase())}</span><div class="account-id"><b>${esc(email)}</b><span class="small">Cloud backup on</span></div></div><div class="grid2" style="margin-top:14px"><button class="btn primary" id="syncNow" type="button">Sync Now</button><button class="btn danger-outline" id="signOut" type="button">Sign Out</button></div>`; }
  else { el.innerHTML=`<h2>Cloud Sync</h2><p class="small" style="margin-top:2px">Sign in to back up workouts and sync across devices.</p><div class="auth-fields" style="margin-top:12px"><label>Email<input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com"></label><label>Password<input id="authPassword" type="password" autocomplete="current-password" placeholder="••••••••"></label></div><div class="grid2" style="margin-top:12px"><button class="btn primary" id="signIn" type="button">Sign In</button><button class="btn secondary" id="signUp" type="button">Create Account</button></div><button class="linklike" id="forgotPw" type="button">Forgot password?</button>`; }
}
function renderSyncChip(){ const chip=$('#syncChip'); if(!chip) return; const cloudable=!!state.user || hasStoredSupabaseSession(); if(!cloudable){ chip.className='status-pill'; chip.textContent='Local'; return; } /* a user with no cloud account shouldn't see permanent 'pending' warnings */ const offline=typeof navigator!=='undefined' && navigator.onLine===false; const pending=pendingDeleteCount()+pendingUpsertCount(); if(offline){ chip.className='status-pill warn'; chip.textContent=pending?`Offline · ${pending} pending`:'Offline'; return; } chip.className='status-pill '+(state.user?(pending?'warn':'ok'):(pending?'warn':'')); chip.textContent = state.user ? (pending?`Cloud · ${pending} pending`:'Cloud synced') : (pending?`${pending} pending`:'Local'); }
function setAuthBusy(on){ state.authBusy=!!on; ['signIn','signUp'].forEach(id=>{ const b=$('#'+id); if(b) b.disabled=state.authBusy; }); }
async function signIn(){ if(state.authBusy) return; const sb=await getSupabase(); if(!sb) return toast(cloudUnavailableMsg()); const email=$('#authEmail')?.value.trim(), password=$('#authPassword')?.value; if(!email||!password) return toast('Enter email and password'); setAuthBusy(true); try{ const {data,error}=await sb.auth.signInWithPassword({email,password}); if(error) return toast(error.message,'danger'); state.user=data.user; renderAuth(); await syncNow(); } finally { setAuthBusy(false); } }
async function signUp(){ if(state.authBusy) return; const sb=await getSupabase(); if(!sb) return toast(cloudUnavailableMsg()); const email=$('#authEmail')?.value.trim(), password=$('#authPassword')?.value; if(!email||!password) return toast('Enter email and password'); if(password.length<6) return toast('Password must be at least 6 characters'); setAuthBusy(true); try{ const {error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}}); toast(error?error.message:'Check your email to confirm your account', error?'danger':''); } finally { setAuthBusy(false); } }
async function forgotPassword(){ if(state.authBusy) return; const email=$('#authEmail')?.value.trim(); if(!email) return toast('Enter your email above first'); const sb=await getSupabase(); if(!sb) return toast(cloudUnavailableMsg()); setAuthBusy(true); try{ const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname}); toast(error?error.message:'Check your email for a reset link', error?'danger':''); } finally { setAuthBusy(false); } }
async function signOut(){ const sb=await getSupabase(); if(sb) await sb.auth.signOut(); state.user=null; renderAuth(); renderSyncChip(); toast('Signed out'); }
async function selectCloudRows(){ const sb=await getSupabase(); if(!sb||!state.user) return {ok:false,error:'No cloud client',data:[]}; const res=await sb.from('tracker_sessions').select('*').eq('user_id',state.user.id).order('updated_at',{ascending:true}); if(res.error){ state.lastSyncError=cloudErrorText(res.error); return {ok:false,error:state.lastSyncError,data:[]}; } return {ok:true,data:res.data||[]}; }
async function bulkUpsert(rows){ const sb=await getSupabase(); if(!sb||!state.user) return {ok:false,error:'No cloud client'}; if(!rows.length) return {ok:true}; const res=await sb.from('tracker_sessions').upsert(rows,{onConflict:'user_id,id'}); if(res.error){ state.lastSyncError=cloudErrorText(res.error); return {ok:false,error:state.lastSyncError}; } return {ok:true}; }
async function deleteCloud(id){ const sb=await getSupabase(); if(!sb||!state.user) return false; id=String(id); const deletedAtValue=state.deleteMeta[id]?.deletedAt||nowIso(); const payload={deleted_at:deletedAtValue,updated_at:deletedAtValue}; let res=await sb.from('tracker_sessions').update(payload).eq('user_id',state.user.id).eq('id',id).select('id,deleted_at'); if(res.error){ state.lastSyncError=cloudErrorText(res.error); renderDiagnostics(); return false; } if(!res.data || !res.data.length){ const up=await bulkUpsert([deleteTombstoneRow(id)]); if(!up.ok) return false; } const check=await sb.from('tracker_sessions').select('id,deleted_at').eq('user_id',state.user.id).eq('id',id).maybeSingle(); if(check.error){ state.lastSyncError=cloudErrorText(check.error); renderDiagnostics(); return false; } if(check.data && !check.data.deleted_at){ state.lastSyncError='Cloud delete not confirmed'; renderDiagnostics(); return false; } if(state.deleteMeta[id]) state.deleteMeta[id].cloudConfirmed=true; return true; }
function mergeSessions(local,cloudRows){ const tombstones=new Set((cloudRows||[]).filter(r=>r.deleted_at).map(r=>String(r.id))); const map=new Map(); for(const s of local){ const id=String(s.id); if(tombstones.has(id) || state.pendingDeletes.has(id)) continue; map.set(id,s); } for(const r of (cloudRows||[])){ if(r.deleted_at || state.pendingDeletes.has(String(r.id))) continue; const s=fromDb(r); if(!s) continue; const id=String(s.id); const cur=map.get(id); if(!cur || new Date(updatedAt(s)||0) > new Date(updatedAt(cur)||0)) map.set(id,s); } return [...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date)||String(a.id).localeCompare(String(b.id))); } // strict '>' keeps the local object on ties so unchanged pulls don't force a re-render
function pruneConfirmedDeletesFromPull(cloudRows){ const activeCloudIds=new Set((cloudRows||[]).filter(r=>!r.deleted_at).map(r=>String(r.id))); for(const id of [...state.pendingDeletes]){ if(state.deleteMeta[id]?.cloudConfirmed && !activeCloudIds.has(id)) markDeleteConfirmed(id); } }
/* syncGeneration invalidates in-flight syncs when a destructive local action (erase/reset)
   changes the world under them — a stale pull must not resurrect erased workouts. */
let syncGeneration=0, syncQueued=false;
async function syncNow(show=true){
  if(state.syncRunning){ syncQueued=true; return 'busy'; } // coalesce: the running sync reruns when done
  if(!state.user){ if(show) toast('Sign in first'); return false; }
  const sb=await getSupabase(); if(!sb){ state.lastSyncError='Supabase SDK not loaded'; saveLocal(false); renderDiagnostics(); if(show) toast(cloudUnavailableMsg()); return false; }
  state.syncRunning=true;
  const gen=syncGeneration;
  purgeQueuedLocalDeletes(); pruneQueues(); saveLocal(false);
  let ok=true;
  try{
    for(const id of [...state.pendingDeletes]){ const deleted=await deleteCloud(id); if(!deleted) ok=false; }
    const uploads=state.sessions.filter(s=>!state.pendingDeletes.has(String(s.id)) && state.pendingUpserts.has(String(s.id)));
    if(uploads.length){
      const up=await bulkUpsert(uploads.map(toDb));
      // Only unqueue ids whose session object is unchanged since capture — an edit saved
      // while the upload was in flight must stay queued or it never reaches the cloud.
      if(up.ok){ uploads.forEach(s=>{ if(state.sessions.find(x=>String(x.id)===String(s.id))===s) state.pendingUpserts.delete(String(s.id)); }); saveLocal(false); } else ok=false;
    }
    const pull=await selectCloudRows();
    if(!pull.ok){ ok=false; if(show) toast('Sync failed', 'danger'); return false; }
    if(gen!==syncGeneration) return false; // local data was erased/reset mid-sync — discard this pull
    const before=state.sessions;
    state.sessions=mergeSessions(state.sessions,pull.data||[]);
    pruneConfirmedDeletesFromPull(pull.data||[]);
    state.lastSyncAt=nowIso();
    state.lastSyncError=ok?null:state.lastSyncError;
    saveLocal(false);
    const changed=state.sessions.length!==before.length || state.sessions.some((s,i)=>s!==before[i]);
    if(changed) dataChanged();
    renderSyncChip(); renderDiagnostics();
    const pending=pendingDeleteCount()+pendingUpsertCount();
    if(show) toast(ok?(pending?`Synced · ${pending} pending`:'Synced'):`Sync pending · ${pending} pending`, ok?'':'danger');
    return ok && pending===0;
  }catch(e){
    state.lastSyncError=cloudErrorText(e); saveLocal(false); renderDiagnostics(); if(show) toast('Sync failed', 'danger'); return false;
  }finally{
    state.syncRunning=false;
    if(syncQueued){ syncQueued=false; syncNow(false); }
  }
}
function renderDiagnostics(){ const el=$('#diagnostics'); if(!el) return; const rows=[['Mode',state.user?'Cloud':'Local only'],['Local workouts',state.sessions.filter(s=>!state.pendingDeletes.has(String(s.id))).length],['Pending uploads',pendingUpsertCount()],['Pending deletes',pendingDeleteCount()],['Last sync',state.lastSyncAt?new Date(state.lastSyncAt).toLocaleString():'Never'],['Schema','soft-delete clean sync'],['Last error',state.lastSyncError||'—']]; el.innerHTML=rows.map(([k,v])=>`<div class="diag-row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join(''); renderSyncChip(); }
function setAccordion(button, body, open){ if(!button || !body) return; button.setAttribute('aria-expanded', String(open)); body.hidden = !open; }
function toggleSessionInfo(){ state.sessionOpen=!state.sessionOpen; setAccordion($('#sessionToggle'), $('#sessionFields'), state.sessionOpen); }
function toggleDiagnostics(){ const body=$('#diagnostics'); const btn=$('#diagnosticsToggle'); const open=!!body?.hidden; setAccordion(btn, body, open); }
async function resetLocalData(){ const ok=await modal({title:'Reset local data?',message:'This clears workouts on this device only. Your cloud backup is not affected.',danger:true,confirmText:'Reset local'}); if(!ok) return; syncGeneration++; state.sessions=[]; state.editId=null; invalidateDataCache(); /* keep pendingDeletes: deletes the user already confirmed must still reach the cloud on the next sync */ clearUpsertQueue(); clearDraft(); store.removeItem(STORE_KEY); saveLocal(); renderApp(); toast('Local data reset'); }

async function eraseAllData(){
  const ok=await modal({title:'Erase all data?',message:state.user?'This permanently removes all workouts from this device and your cloud backup. Type ERASE to continue.':'You are not signed in. This removes only local workouts. Type ERASE to continue.',danger:true,requireText:'ERASE',confirmText:'Erase'});
  if(!ok) return;
  syncGeneration++; // any in-flight sync must not resurrect the erased sessions from its stale pull
  const sessionsBeforeClear=[...state.sessions];
  const idsBeforeClear=sessionsBeforeClear.map(s=>s.id);
  let cloudOk=!state.user;
  if(state.user){
    const sb=await getSupabase();
    if(sb){
      const deletedAt=nowIso();
      const res=await sb.from('tracker_sessions').update({deleted_at:deletedAt,updated_at:deletedAt}).eq('user_id',state.user.id).is('deleted_at', null);
      cloudOk=!res.error;
      state.lastSyncError=res.error?.message||null;
    }else{
      cloudOk=false; state.lastSyncError='Supabase SDK not loaded';
    }
  }
  state.sessions=[]; state.editId=null; invalidateDataCache(); clearDraft(); store.removeItem(STORE_KEY);
  if(cloudOk){ clearDeleteQueue(); clearUpsertQueue(); } else { sessionsBeforeClear.forEach(sess=>queueDelete(sess.id, sess)); clearUpsertQueue(); }
  saveLocal(); renderApp(); toast(cloudOk?'All data erased':'Local erased · cloud erase pending', cloudOk?'':'danger');
}
function exportJson(){ download('minmax-backup.json', JSON.stringify({app:'MinMax Tracker',version:APP_VERSION,exportedAt:nowIso(),sessions:state.sessions},null,2),'application/json'); }
/* Comma-delimited (the delimiter Sheets/US Excel actually split on \u2014 values are quoted, so
   commas in notes are safe) with a unit column so 60 s holds aren't read as 60 reps. */
function exportCsv(){ const rows=[['date','week','day','bodyweight','exercise','set','load','reps_or_seconds','unit','rir']]; state.sessions.forEach(s=>s.exercises.forEach(e=>e.sets.forEach((set,i)=>rows.push([s.date,s.week,s.day,s.bw??'',e.name,i+1,set.load,set.reps,set.timed?'sec':'reps',set.rir??''])))); download('minmax-log.csv','\ufeff'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n'),'text/csv;charset=utf-8'); }
function download(name,content,type){ const a=document.createElement('a'), blob=new Blob([content],{type}); a.href=URL.createObjectURL(blob); a.download=name; a.style.display='none'; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},500); }
async function importJsonFile(file){ try{ const data=JSON.parse(await file.text()); const incoming=(Array.isArray(data)?data:data.sessions||[]).map(normalizeSession).filter(Boolean); if(!incoming.length) return toast('No valid sessions found'); const ok=await modal({title:'Import backup?',message:`Import ${incoming.length} workouts and merge with current local data?`,confirmText:'Import'}); if(!ok) return; incoming.forEach(s=>unqueueDelete(s.id)); state.sessions=mergeSessions(state.sessions,incoming); incoming.forEach(s=>state.pendingUpserts.add(String(s.id))); invalidateDataCache(); saveLocal(); renderApp(); if(state.user) syncNow(false); toast('Imported'); }catch(e){ toast('Import failed'); } }

function registerEvents(){
  document.addEventListener('click', async e=>{
    const nav=e.target.closest('[data-nav]'); if(nav) return setPage(nav.dataset.nav);
    const day=e.target.closest('[data-day]'); if(day){
      if(day.dataset.day===state.day) return;
      // Switching day while editing would rewrite the edited workout against the wrong
      // day's plan — stop editing first (with confirmation) instead of corrupting it.
      if(state.editId){
        const ok=await modal({title:'Stop editing?', message:'Switching day closes this edit and discards unsaved changes. The saved workout is not affected.', danger:true, confirmText:'Stop editing'});
        if(!ok) return;
        clearDraft();
      } else { syncOpenBlock(); collectSessionFields(); }
      state.day=day.dataset.day; state.exIndex=firstOpenIndex(); saveLocal(); renderTrain(); return;
    }
    const quick=e.target.closest('[data-act]'); if(quick){ e.preventDefault(); applyQuick(quick.closest('.set-card'),quick.dataset.act); return; }
    const open=e.target.closest('[data-open]'); if(open){ e.preventDefault(); e.stopPropagation(); const card=open.closest('.session'); const body=card.querySelector('.session-details'); const willOpen=body.hidden; if(willOpen && !body.dataset.ready){ const s=state.sessions.find(x=>String(x.id)===String(open.dataset.open)); body.innerHTML=s?sessionDetailsHtml(s):'<p class="muted">Workout not found.</p>'; body.dataset.ready='1'; } body.hidden=!willOpen; card.classList.toggle('expanded', willOpen); open.setAttribute('aria-expanded', String(willOpen)); if(willOpen) expandedLog.add(String(open.dataset.open)); else expandedLog.delete(String(open.dataset.open)); return; }
    const more=e.target.closest('[data-more]'); if(more){ logVisibleCount+=50; renderHistory(); return; }
    const themeBtn=e.target.closest('[data-theme-pref]'); if(themeBtn){ setTheme(themeBtn.dataset.themePref); saveLocal(false); return; }
    const pt=e.target.closest('.chart-point,.chart-hit'); if(pt && pt.dataset.v){ toast(`${pt.dataset.v} ${pt.dataset.u} · ${pt.dataset.d}`); return; }
    const del=e.target.closest('[data-delete]'); if(del){ e.preventDefault(); e.stopPropagation(); await deleteSession(del.dataset.delete, del.closest('.session')); return; }
    const edit=e.target.closest('[data-edit]'); if(edit){ e.preventDefault(); e.stopPropagation(); editSession(edit.dataset.edit); return; }
    const viewBtn=e.target.closest('#viewOverall,#viewExercise'); if(viewBtn){ state.progressView=viewBtn.dataset.view; state.progressExercise=$('#progressExercise')?.value||state.progressExercise||''; renderProgress(); return; }
    const head=e.target.closest('.ex-head'); if(head){ toggleExercise(Number(head.dataset.exi)); return; }
    const rest=e.target.closest('[data-rest]'); if(rest){ toggleRest(rest); return; }
    const sexBtn=e.target.closest('#sexSeg [data-sex]'); if(sexBtn){ state.prefs.profile.sex=sexBtn.dataset.sex==='f'?'f':'m'; renderProfile(); saveLocal(false); dirty.train=true; return; }
    if(e.target.closest('#aboutRow')){ toggleBadgePanel(); return; }
    if(e.target.closest('#sessionToggle')){ toggleSessionInfo(); return; }
    if(e.target.closest('#diagnosticsToggle')){ toggleDiagnostics(); return; }
    if(e.target.closest('#cancelEdit')){ confirmClearDraft(); return; }
    if(e.target.id==='syncNow') return syncNow(); if(e.target.id==='signIn') return signIn(); if(e.target.id==='signUp') return signUp(); if(e.target.id==='signOut') return signOut(); if(e.target.id==='forgotPw') return forgotPassword();
  });
  $('#weekMinus').onclick=()=>shiftWeek(-1); $('#weekPlus').onclick=()=>shiftWeek(1); $('#saveWorkout').onclick=saveWorkout; $('#clearDraft').onclick=confirmClearDraft;
  const pill=$('#restPill'); if(pill) pill.onclick=()=>{ stopRest(); toast('Rest skipped'); };
  const rirBox=$('#rirToggle'); if(rirBox) rirBox.addEventListener('change', ()=>{ setShowRir(rirBox.checked); saveLocal(false); });
  const lpBox=$('#lowPowerToggle'); if(lpBox) lpBox.addEventListener('change', ()=>{ state.prefs.lowPower=lpBox.checked; applyLowPower(); saveLocal(false); });
  ['pHeight','pWeight','pAge'].forEach(id=>{ const el=$('#'+id); if(el) el.addEventListener('change', ()=>{ collectProfile(); renderProfile(); }); });
  let resizeT=null; window.addEventListener('resize', ()=>{ clearTimeout(resizeT); resizeT=setTimeout(()=>{ if(state.page==='progress' && lastChart) drawChart(lastChart.values, lastChart.labels, lastChart.unit); else dirty.progress=true; /* re-measure on next visit after rotation */ }, 160); });
  document.addEventListener('keydown', e=>{ if(e.key==='Enter' && (e.target.id==='authEmail' || e.target.id==='authPassword')){ e.preventDefault(); signIn(); } });
  window.addEventListener('online', ()=>{ renderSyncChip(); if(!state.user && hasStoredSupabaseSession()){ initAuth().catch(()=>{}); } /* SDK load failed while offline — restore the signed-in session now */ else if(state.user && (pendingDeleteCount()+pendingUpsertCount())>0) syncNow(false); });
  window.addEventListener('offline', renderSyncChip);
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden'){ flushDraft(); stopRestTicker(); if(pendingSwReload && !state.swReloading){ state.swReloading=true; location.reload(); } } else if(restActive){ startRestTicker(); } });
  $('#exerciseList').addEventListener('input', e=>{ const block=e.target.closest('.ex-block'); if(block) updateSetsFor(block); }); ['sDate','sBw','sNotes','sEnergy','sSleep'].forEach(id=>$('#'+id).addEventListener('input', collectSessionFields));
  $('#progressExercise').onchange=()=>{ state.progressExercise=$('#progressExercise').value; renderExerciseProgress(state.progressExercise); }; $('#progressMetric').onchange=()=>{ state.progressExercise=$('#progressExercise').value||state.progressExercise; renderExerciseProgress(state.progressExercise); }; $('#exportJson').onclick=exportJson; $('#exportCsv').onclick=exportCsv; $('#importJsonBtn').onclick=()=>$('#importFile').click(); $('#importFile').onchange=e=>{ if(e.target.files[0]) importJsonFile(e.target.files[0]); e.target.value='';}; $('#resetLocal').onclick=resetLocalData; $('#eraseAll').onclick=eraseAllData;
}
let pendingSwReload=false;
async function registerServiceWorker(){
  if(!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  try{
    const reg=await navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`);
    reg.update?.();
    let hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(!hadController){ hadController=true; return; }
      if(state.swReloading) return;
      // Don't restart the app mid-set: defer the update reload while a rest countdown is
      // running or the user is typing; it applies the next time the app is hidden.
      if(restActive || trainInputFocused()){ pendingSwReload=true; return; }
      state.swReloading=true; location.reload();
    });
  }catch(e){}
}
/* Startup renders the visible page from local data immediately; program refresh, auth
   and the service worker are kicked off in the background without blocking first paint. */
function init(){
  try{
    loadProgramSync(); loadLocal(); fillSessionFields(); registerEvents(); renderApp(); setShowRir(state.prefs.showRir);
    const av=$('#aboutVersion'); if(av) av.textContent=`v${APP_VERSION}`;
    renderProfile(); renderBadgeCount(); applyLowPower();
    try{ console.log('%c🏋️ MinMax Tracker','font-size:15px;font-weight:800;color:#007aff', `v${APP_VERSION} — ${BADGES.length} secret badges are hidden in here. No hints.`); }catch(e){}
  }catch(e){
    document.body.innerHTML=`<main class="shell"><section class="card"><h1>App failed to load</h1><p class="muted">${esc(e.message)}</p></section></main>`;
    return;
  }
  refreshProgram();
  initAuth().catch(()=>{ renderAuth(); renderSyncChip(); });
  registerServiceWorker();
}
document.addEventListener('DOMContentLoaded', init);
