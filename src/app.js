'use strict';

const APP_VERSION = '16.0.0-essentials';
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
  prefs:{theme:'light', showRir:false}, swReloading:false
};

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v,min,max) => Math.min(max, Math.max(min, Number(v)||0));
const round = v => Math.round((Number(v)||0)*10)/10;
const uid = () => 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9);
const localDate = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const nowIso = () => new Date().toISOString();
const fmtDate = d => { const x=new Date(`${d}T00:00:00`); return Number.isNaN(x.getTime())?d:x.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); };
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

function toast(msg, tone=''){
  const el = $('#toast');
  if(!el) return;
  if(!msg){ el.hidden=true; el.textContent=''; el.dataset.tone=''; return; }
  el.textContent = msg; el.hidden = false; el.dataset.tone = tone;
  clearTimeout(el._t); el._t=setTimeout(()=>toast(''), 2600);
}

function modal({title, message, danger=false, requireText='', confirmText='Confirm'}){
  return new Promise(resolve=>{
    const root=$('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true"><div class="modal"><h2>${esc(title)}</h2><p class="muted" style="margin-top:8px">${esc(message)}</p>${requireText?`<label style="margin-top:14px">Type ${esc(requireText)}<input id="modalConfirmInput" autocomplete="off"></label>`:''}<div class="modal-actions"><button id="modalCancel" class="btn ghost" type="button">Cancel</button><button id="modalOk" class="btn ${danger?'danger-fill':'primary'}" type="button">${esc(confirmText)}</button></div></div></div>`;
    const opener = document.activeElement;
    const cleanup = val => { document.removeEventListener('keydown', onKey); root.innerHTML=''; if(opener?.focus) opener.focus(); resolve(val); };
    const confirm = () => { if(requireText && $('#modalConfirmInput').value.trim() !== requireText){ toast(`Type ${requireText} to continue`); $('#modalConfirmInput')?.focus(); return; } cleanup(true); };
    const onKey = e => { if(e.key==='Escape'){ e.preventDefault(); cleanup(false); } else if(e.key==='Enter'){ e.preventDefault(); confirm(); } };
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
function queueDelete(id, session=null){ id=String(id); state.pendingDeletes.add(id); state.pendingUpserts.delete(id); const previous=state.deleteMeta[id]||{}; state.deleteMeta[id]={...previous, id, signature:sessionSignature(session)||previous.signature||'', snapshot:sessionSnapshot(session)||previous.snapshot||null, deletedAt:previous.deletedAt||nowIso(), cloudConfirmed:false}; saveLocal(false); }
function markDeleteConfirmed(id){ id=String(id); state.pendingDeletes.delete(id); delete state.deleteMeta[id]; saveLocal(false); }
function unqueueDelete(id){ id=String(id); state.pendingDeletes.delete(id); delete state.deleteMeta[id]; saveLocal(false); }
function clearDeleteQueue(){ state.pendingDeletes.clear(); state.deleteMeta={}; saveLocal(false); }
function pendingDeleteCount(){ return state.pendingDeletes.size; }
function isDeletedId(id){ return state.pendingDeletes.has(String(id)); }
function pruneQueues(){ const activeIds=new Set(state.sessions.map(s=>String(s.id))); for(const id of [...state.pendingUpserts]){ if(!activeIds.has(String(id)) || state.pendingDeletes.has(String(id))) state.pendingUpserts.delete(String(id)); } for(const id of state.pendingDeletes){ if(!state.deleteMeta[id]) state.deleteMeta[id]={id,deletedAt:nowIso(),cloudConfirmed:false}; } }
function purgeQueuedLocalDeletes(){ if(!state.pendingDeletes?.size) return; state.sessions = state.sessions.filter(s => !isDeletedId(s.id)); }

function setTheme(theme){
  const dark = theme === 'dark';
  state.prefs.theme = dark ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', dark);
  document.body.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', dark ? '#081120' : '#0a2242');
  const btn = $('#darkToggle'); if(btn) btn.textContent = dark ? 'Light mode' : 'Dark mode';
}
function setShowRir(on){
  state.prefs.showRir = !!on;
  $('#exerciseList')?.classList.toggle('advanced', state.prefs.showRir);
  const btn = $('#rirToggle'); if(btn){ btn.textContent = state.prefs.showRir ? 'Hide RIR fields' : 'Show RIR fields'; btn.setAttribute('aria-pressed', String(state.prefs.showRir)); }
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
    preferences:{theme:state.prefs.theme, showRir:state.prefs.showRir},
    week:state.week,
    day:state.day
  };
}
function saveLocal(updateUi=true){ purgeQueuedLocalDeletes(); store.setItem(STORE_KEY, JSON.stringify(localStateSnapshot())); saveUpsertQueue(); saveDeleteQueue(); if(updateUi) renderDiagnostics(); }
function loadLocal(){
  let raw=store.getItem(STORE_KEY), parsed=null;
  if(!raw){ for(const k of LEGACY_KEYS){ raw=store.getItem(k); if(raw) break; } }
  if(raw){ try{ parsed=JSON.parse(raw); }catch(e){ parsed=null; } }
  const theme=parsed?.preferences?.theme || parsed?.theme || 'light'; setTheme(theme==='dark'?'dark':'light');
  state.prefs.showRir = !!parsed?.preferences?.showRir;
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
  pruneQueues();
  saveLocal(false);
  try{ const d=JSON.parse(store.getItem(DRAFT_KEY)||'null'); state.draft=d&&typeof d==='object'?{...createDraft(),...d,meta:normalizeMeta(d.meta||{})}:createDraft(); }catch(e){ initDraft(); }
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
  const hasData=Object.keys(state.draft.exercises).length>0 || !!state.draft.notes || state.draft.bw!=null;
  if(hasData){ const ok=await modal({title:'Clear draft?',message:state.editId?'This stops editing and discards the unsaved changes on this device. The saved workout is not affected.':'This removes all unsaved sets and session info on this device. Saved workouts are not affected.',danger:true,confirmText:'Clear draft'}); if(!ok) return; }
  clearDraft(); if(hasData) toast('Draft cleared');
}

function applyProgram(p){ state.program=p; state.split=p.split || Object.keys(p.days||{}); if(!state.split.includes(state.day)) state.day=state.split[0]; }
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
    if(fresh.version !== state.program?.version){ applyProgram(fresh); renderTrain(); }
    else state.program = fresh;
  }catch(e){}
}
function currentExercises(){ return state.program?.days?.[state.day] || []; }
function findExerciseMeta(name){ for(const d of state.split){ const ex=(state.program?.days?.[d]||[]).find(x=>x.name===name); if(ex) return ex; } return {}; }
function isBodyweightExercise(name){ return !!findExerciseMeta(name).bw; }

function renderApp(){ renderAuth(); renderSyncChip(); renderTrain(); renderHistory(); renderProgress(); renderDiagnostics(); }
function setPage(page){ state.page=page; $$('.page').forEach(p=>p.classList.toggle('active', p.dataset.page===page)); $$('.navbtn').forEach(b=>b.classList.toggle('active', b.dataset.nav===page)); if(page==='progress') renderProgress(); if(page==='log') renderHistory(); if(page==='settings') {renderAuth(); renderDiagnostics();} }
function renderTrain(){ const list=currentExercises(); if(state.exIndex>=list.length) state.exIndex=firstOpenIndex(); $('#weekNumber').textContent=state.week; renderDayTabs(); fillSessionFields(); renderWorkout(); renderTrainStatus(); }
function renderDayTabs(){ $('#dayTabs').innerHTML = state.split.map(d=>`<button class="chip ${d===state.day?'active':''}" data-day="${esc(d)}" type="button" role="tab" aria-selected="${d===state.day}">${esc(d)}</button>`).join(''); }
function completedCount(){ return currentExercises().filter(ex => (state.draft.exercises[ex.name]?.sets||[]).some(s=>s.reps>0)).length; }
function renderTrainStatus(){ const total=currentExercises().length, done=completedCount(); const light=(state.program?.lightWeeks||[]).includes(state.week); $('#trainTitle').textContent=state.day; $('#trainSub').textContent=`${done}/${total} logged${light?' · light week':''}`; $('#workoutProgress').style.width= total ? `${done/total*100}%` : '0%'; }
function lastBodyweight(){ return [...state.sessions].filter(s=>!state.pendingDeletes.has(String(s.id)) && Number(s.bw)>0).sort((a,b)=>new Date(b.date)-new Date(a.date))[0]?.bw || null; }
function fillSessionFields(){ const lastBw=lastBodyweight(); $('#sDate').value=state.draft.date||localDate(); $('#sBw').value=state.draft.bw??''; $('#sBw').placeholder=lastBw?`${round(lastBw)} kg`:'kg'; $('#sNotes').value=state.draft.notes||''; $('#sEnergy').value=state.draft.meta.energy??''; $('#sSleep').value=state.draft.meta.sleep??''; }
function collectSessionFields(){ state.draft.date=$('#sDate').value||localDate(); state.draft.bw=$('#sBw').value===''?null:Math.max(0,Number($('#sBw').value)||0); state.draft.notes=$('#sNotes').value.trim().slice(0,180); state.draft.meta.energy=$('#sEnergy').value?clamp($('#sEnergy').value,1,5):null; state.draft.meta.sleep=$('#sSleep').value?clamp($('#sSleep').value,1,5):null; saveDraft(); }

/* ---- Logbook view: the whole day as one checklist, one exercise expanded at a time ---- */
function draftSetsFor(name){ return state.draft.exercises[name]?.sets || []; }
function isExerciseDone(name){ return draftSetsFor(name).some(s=>s.reps>0); }
function firstOpenIndex(){ const list=currentExercises(); const i=list.findIndex(ex=>!isExerciseDone(ex.name)); return i<0 ? (list.length?0:-1) : i; }
function shortSetLabel(s){ const load=Number(s.load)||0, reps=round(s.reps); return load>0 ? `${round(load)}\u00d7${reps}` : `${reps}${s.timed?'s':''}`; }
function collapsedSummary(ex, last){
  const drafted=draftSetsFor(ex.name);
  if(drafted.length) return {text:drafted.map(shortSetLabel).join(' \u00b7 '), tone:'sum-done'};
  if(last) return {text:`Last ${last.sets.map(shortSetLabel).join(' \u00b7 ')}`, tone:'sum-last'};
  return {text:`${ex.sets} \u00d7 ${ex.reps}${ex.optional?' \u00b7 optional':''}`, tone:'sum-plan'};
}
function renderWorkout(){
  const list=currentExercises(); const host=$('#exerciseList'); if(!host) return;
  if(!list.length){ host.innerHTML='<div class="empty">No exercises for this day.</div>'; return; }
  host.innerHTML=list.map((ex,i)=>{
    const hist=exerciseEntries(ex.name); const last=hist[hist.length-1];
    const done=isExerciseDone(ex.name); const open=i===state.exIndex;
    const sum=collapsedSummary(ex,last);
    return `<article class="ex-block ${open?'open':''} ${done?'done':''}" data-ex="${esc(ex.name)}" data-i="${i}">
      <button class="ex-head" type="button" data-exi="${i}" aria-expanded="${open}">
        <span class="ex-status" aria-hidden="true">${done?'\u2713':i+1}</span>
        <span class="ex-title"><b>${esc(ex.name)}</b><small class="${sum.tone}">${esc(sum.text)}</small></span>
        <span class="ex-caret" aria-hidden="true">${open?'\u2212':'+'}</span>
      </button>
      ${open?renderExBody(ex,last):''}
    </article>`;
  }).join('');
  host.classList.toggle('advanced', !!state.prefs.showRir);
}
function renderExBody(ex,last){
  const saved=draftSetsFor(ex.name);
  const unitPh = ex.timed?'sec':'reps';
  const running = !!restInterval && restExName===ex.name;
  let sets=''; for(let i=0;i<ex.sets;i++){
    const s=saved[i] || {}; const prev=last?.sets?.[i] || null;
    const phLoad = prev && prev.load>0 ? String(round(prev.load)) : 'kg';
    const phReps = prev && prev.reps>0 ? String(round(prev.reps)) : unitPh;
    sets += `<div class="set-card" data-set="${i}"><div class="set-top"><button class="set-num" data-act="same" type="button" aria-label="Set ${i+1}: copy last time">${i+1}</button><input data-field="load" type="number" inputmode="decimal" min="0" step="0.5" placeholder="${esc(phLoad)}" aria-label="Set ${i+1} load, kg" value="${s.load??''}"><input data-field="reps" type="number" inputmode="numeric" min="0" step="1" placeholder="${esc(phReps)}" aria-label="Set ${i+1} ${ex.timed?'seconds':'reps'}" value="${s.reps??''}"><button class="set-clear" data-act="clearSet" type="button" aria-label="Clear set ${i+1}">\u00d7</button></div><div class="rir-field"><label>RIR<input data-field="rir" type="number" inputmode="numeric" min="0" max="5" step="1" placeholder="0-5" value="${s.rir??''}"></label></div></div>`;
  }
  return `<div class="ex-body">
    <div class="goal-row">
      <div class="goal-box"><span>Target \u00b7 ${esc(ex.reps)} reps \u00b7 RIR ${esc(ex.rir)}</span>${esc(makeGoal(ex,last))}</div>
      <button class="rest-btn ${running?'running':''}" data-rest type="button" aria-label="Rest timer">${running?'\u2026':'Rest '+esc(ex.rest||'2 min')}</button>
    </div>
    <p class="last-line">${last?`Last time <b>${last.sets.map(setLabel).map(esc).join(' \u00b7 ')}</b> \u00b7 ${esc(shortDate(last.date))}`:'First session \u2014 set your baseline.'}</p>
    <div class="sets">${sets}</div>
    ${last?'<p class="hint">Tap a set number to fill in last time\u2019s numbers.</p>':''}
    <details class="tech"><summary>Technique</summary><div><p><b>Technique:</b> ${esc(ex.note||'\u2014')}</p><p><b>Substitutions:</b> ${(ex.substitutions||[]).map(esc).join(' \u00b7 ')||'\u2014'}</p></div></details>
  </div>`;
}
function makeGoal(ex,last){ if(!last) return 'Start clean, log consistent reps.'; const b=last.best; const top=String(ex.reps||'').match(/(\d+)-(\d+)/); if(b.load>0 && top && b.reps>=Number(top[2])) return `Try ${round(b.load+2.5)} kg \u00d7 ${top[1]}`; if(b.load>0) return `Beat ${round(b.load)} kg \u00d7 ${round(b.reps)}`; return `Beat ${round(b.reps)} ${ex.timed?'sec':'reps'}`; }
function updateSetsFor(block){
  if(!block) return;
  const name=block.dataset.ex; const meta=findExerciseMeta(name); const sets=[];
  $$('.set-card',block).forEach(card=>{ const load=Number($('[data-field="load"]',card).value)||0, reps=Number($('[data-field="reps"]',card).value)||0, rir=$('[data-field="rir"]',card)?.value ?? ''; if(reps>0) sets.push({load:Math.max(0,load), reps:Math.max(0,reps), rir:rir===''?null:clamp(rir,0,5), timed:!!meta.timed}); });
  if(sets.length) state.draft.exercises[name]={sets}; else delete state.draft.exercises[name];
  if(sets.length && !state.draft.meta.startedAt) state.draft.meta.startedAt=nowIso();
  saveDraft(); renderTrainStatus();
  const done=sets.length>0; block.classList.toggle('done',done);
  const st=$('.ex-status',block); if(st) st.textContent=done?'\u2713':(Number(block.dataset.i)+1);
}
function syncOpenBlock(){ updateSetsFor($('#exerciseList .ex-block.open')); }
function toggleExercise(i){
  syncOpenBlock();
  state.exIndex = state.exIndex===i ? -1 : i;
  renderWorkout();
  if(state.exIndex>=0){ const el=$(`.ex-block[data-i="${state.exIndex}"]`); el?.scrollIntoView({block:'nearest',behavior:'smooth'}); }
}
function applyQuick(card, action){ if(!card) return; const block=card.closest('.ex-block'); const name=block?.dataset.ex; if(!name) return; const load=$('[data-field="load"]',card), reps=$('[data-field="reps"]',card), idx=Number(card.dataset.set), last=exerciseEntries(name).slice(-1)[0]?.sets?.[idx] || null; if(action==='same'){ if(!last) return toast('No previous set'); load.value=last.load||''; reps.value=last.reps||''; } if(action==='clearSet'){ load.value=''; reps.value=''; const rir=$('[data-field="rir"]',card); if(rir) rir.value=''; } updateSetsFor(block); }

/* Rest timer \u2014 parses the plan's rest range, keeps running while you browse, vibrates when done. */
let restInterval=null, restEndsAt=0, restExName='';
function parseRestSeconds(rest){ const range=String(rest||'').match(/(\d+)\s*-\s*(\d+)/); const single=String(rest||'').match(/\d+/); const mins=range?Number(range[2]):(single?Number(single[0]):2); return clamp(mins,1,10)*60; }
function currentRestBtn(){ const block=$('#exerciseList .ex-block.open'); return block && block.dataset.ex===restExName ? $('[data-rest]',block) : null; }
function restPill(){ return $('#restPill'); }
function stopRest(){ if(restInterval){ clearInterval(restInterval); restInterval=null; } const b=currentRestBtn(); if(b){ b.classList.remove('running'); const meta=findExerciseMeta(restExName); b.textContent=`Rest ${meta.rest||'2 min'}`; } const pill=restPill(); if(pill) pill.hidden=true; restExName=''; }
function tickRest(){ const left=Math.max(0,Math.round((restEndsAt-Date.now())/1000)); const label=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`; const b=state.page==='train'?currentRestBtn():null; const pill=restPill(); if(b){ b.textContent=label; if(pill) pill.hidden=true; } else if(pill){ pill.textContent=`Rest ${label}`; pill.hidden=false; } if(left<=0){ stopRest(); try{ navigator.vibrate?.([200,120,200]); }catch(e){} toast('Rest over \u2014 next set'); } }
function toggleRest(btn){ const block=btn.closest('.ex-block'); const name=block?.dataset.ex; if(!name) return; if(restInterval && restExName===name) return stopRest(); if(restInterval) stopRest(); const meta=findExerciseMeta(name); restExName=name; restEndsAt=Date.now()+parseRestSeconds(meta.rest)*1000; btn.classList.add('running'); tickRest(); restInterval=setInterval(tickRest,250); }
function shiftWeek(n){ state.week=clamp(state.week+n,1,state.program?.weeks||12); saveLocal(); renderTrainStatus(); $('#weekNumber').textContent=state.week; }

function bestValue(sets){ return Math.max(0,...(sets||[]).map(s=>e1rm(s)||Number(s.reps)||0)); }
function detectPRs(session){
  const prior=state.sessions.filter(s=>String(s.id)!==String(session.id) && !state.pendingDeletes.has(String(s.id)));
  const out=[];
  for(const ex of session.exercises){
    let prevBest=0, seen=false;
    for(const s of prior){ const m=s.exercises.find(e=>e.name===ex.name); if(!m) continue; seen=true; prevBest=Math.max(prevBest,bestValue(m.sets)); }
    if(seen && bestValue(ex.sets)>prevBest) out.push(ex.name);
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
    const dayNames=new Set(currentExercises().map(x=>x.name));
    const draftEntries=Object.entries(state.draft.exercises);
    const exercises=draftEntries.filter(([name])=>dayNames.has(name)).map(([name, data])=>normalizeExercise({name,sets:data.sets})).filter(Boolean);
    const leftovers=Object.fromEntries(draftEntries.filter(([name])=>!dayNames.has(name)));
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
    if(idx>=0) state.sessions[idx]=session; else state.sessions.push(session);
    if(state.pendingDeletes.has(String(session.id))) unqueueDelete(session.id);
    queueUpsert(session.id);
    state.editId=null;
    if(Object.keys(leftovers).length){ state.draft={...createDraft(), exercises:leftovers}; saveDraft(); }
    else { initDraft(); cancelDraftSave(); store.removeItem(DRAFT_KEY); }
    stopRest();
    state.exIndex=firstOpenIndex();
    saveLocal(); renderTrain(); renderHistory(); renderProgress();
    const prMsg=prs.length?`🏆 PR · ${prs[0]}${prs.length>1?` +${prs.length-1} more`:''} — `:'';
    if(state.user){ const ok=await syncNow(false); toast(ok?`${prMsg}saved & synced`:`${prMsg}saved locally · sync pending`, ok?'':'danger'); }
    else { toast(`${prMsg}saved locally`); }
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
function renderHistory(){
  purgeQueuedLocalDeletes();
  const list=[...state.sessions].filter(s=>!state.pendingDeletes.has(String(s.id))).sort((a,b)=>new Date(b.date)-new Date(a.date)||String(updatedAt(b)||'').localeCompare(String(updatedAt(a)||''))||String(b.id).localeCompare(String(a.id)));
  const host=$('#logList');
  if(!list.length){ host.innerHTML='<div class="empty">No workouts yet.</div>'; return; }
  const withSig=list.map(s=>[s,sessionSignature(s)]);
  const sigCount=new Map(); for(const [,sig] of withSig) sigCount.set(sig,(sigCount.get(sig)||0)+1);
  host.innerHTML=withSig.map(([s,sig])=>{
    const similar=sigCount.get(sig)-1;
    const ts=updatedAt(s); const time=ts ? new Date(ts).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}) : '';
    return `<article class="session" data-id="${esc(s.id)}"><div class="row between gap wrap"><div><b>${esc(s.day)}</b><div class="small">Week ${s.week} · ${esc(fmtDate(s.date))} · ${s.exercises.length} exercises${s.meta?.durationMin?` · ${s.meta.durationMin} min`:''}${time?` · saved ${esc(time)}`:''}${similar?` · ${similar} similar`:''}</div></div><div class="log-actions"><button class="btn secondary small" data-open="${esc(s.id)}" type="button" aria-expanded="false">Open</button><button class="btn danger-outline small" data-delete="${esc(s.id)}" type="button">Delete</button></div></div><div class="session-details" hidden>${sessionInfoLine(s)}${s.exercises.map(e=>`<div style="margin-top:8px"><b>${esc(e.name)}</b><div class="small">${e.sets.map(setLabel).join(', ')}</div></div>`).join('')}<div class="grid2" style="margin-top:12px"><button class="btn secondary" data-edit="${esc(s.id)}" type="button">Edit</button><button class="btn danger-outline" data-delete="${esc(s.id)}" type="button">Delete</button></div></div></article>`;
  }).join('');
}

async function deleteSession(id, card=null){
  if(state.deleting) return;
  state.deleting=true;
  try{
    id = String(id);
    const session = state.sessions.find(s => String(s.id) === id);
    const label = session ? `${session.day} · ${fmtDate(session.date)}` : 'this workout';
    const similar = session ? similarSessionCount(session) : 0;
    const ok = await modal({
      title:'Delete workout?',
      message:`Delete ${label}?${similar?` There ${similar===1?'is':'are'} ${similar} similar saved log${similar===1?'':'s'}, but this deletes only this selected log.`:''} It will disappear locally now and will be marked deleted in Supabase on sync.`,
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
    const before = state.sessions.length;
    state.sessions = state.sessions.filter(s => String(s.id) !== id);
    if(state.editId === id) state.editId = null;
    queueDelete(id, session);
    unqueueUpsert(id);
    saveLocal();
    renderHistory();
    renderProgress();
    renderSyncChip();
    renderDiagnostics();
    toast(before === state.sessions.length ? 'Workout already removed · cloud delete pending' : 'Workout deleted · cloud delete pending');
    if(state.user){
      const okCloud = await syncNow(false);
      toast(okCloud?'Workout deleted & synced':'Workout deleted locally · cloud delete pending', okCloud?'':'danger');
      renderSyncChip();
      renderDiagnostics();
    }
  } finally {
    state.deleting=false;
  }
}


function editSession(id){ const s=state.sessions.find(x=>x.id===id); if(!s) return; state.editId=s.id; state.week=s.week; state.day=s.day; state.exIndex=0; state.draft={date:s.date,bw:s.bw,notes:s.notes,meta:normalizeMeta(s.meta),exercises:Object.fromEntries(s.exercises.map(e=>[e.name,{sets:e.sets}]))}; setPage('train'); renderTrain(); toast('Editing workout'); }

function setLabel(s){ const load=Number(s.load)||0, reps=round(s.reps); const base=load>0 ? `${round(load)}×${reps}` : `${reps} ${s.timed?'sec':'reps'}`; return `${base}${s.rir!=null?` · RIR ${s.rir}`:''}`; }
function bestSet(sets){ return [...sets].sort((a,b)=>{ const av=metricSet(a,'e1rm')||metricSet(a,'reps'); const bv=metricSet(b,'e1rm')||metricSet(b,'reps'); return bv-av; })[0] || null; }
function e1rm(s){ return s && s.load>0 ? s.load*(1+s.reps/30) : 0; }
function bodyweightForSession(session){ return Number(session?.bw)||0; }
function setVolume(s, name, session){ const bw=isBodyweightExercise(name)?bodyweightForSession(session):0; return ((Number(s.load)||0) + bw) * (Number(s.reps)||0); }
function metricSet(s, metric){ if(metric==='load') return Number(s.load)||0; if(metric==='reps') return Number(s.reps)||0; if(metric==='e1rm') return e1rm(s); return Number(s.load||0)*Number(s.reps||0); }
function exerciseEntries(name){ return [...state.sessions].filter(s=>!state.pendingDeletes.has(String(s.id))).sort((a,b)=>new Date(a.date)-new Date(b.date)||String(updatedAt(a)||'').localeCompare(String(updatedAt(b)||''))).map(session=>{ const ex=session.exercises.find(e=>e.name===name); if(!ex) return null; const best=bestSet(ex.sets); return {session, date:session.date, name, sets:ex.sets, best, e1rm:e1rm(best), load:Math.max(...ex.sets.map(s=>s.load||0)), reps:Math.max(...ex.sets.map(s=>s.reps||0)), volume:ex.sets.reduce((sum,s)=>sum+setVolume(s,name,session),0)}; }).filter(Boolean); }
function exerciseNames(){ const set=new Set(); state.sessions.filter(s=>!state.pendingDeletes.has(String(s.id))).forEach(s=>s.exercises.forEach(e=>set.add(e.name))); return [...set]; }
function autoMetric(name){ const hasLoad=exerciseEntries(name).some(e=>e.load>0); const meta=findExerciseMeta(name); if(meta.timed) return 'reps'; return hasLoad ? 'e1rm' : 'reps'; }
function valueForEntry(e, metric){ if(metric==='load') return e.load; if(metric==='reps') return e.reps; if(metric==='volume') return e.volume; return e.e1rm || e.reps; }
function unitForMetric(metric){ if(metric==='volume') return 'kg×reps'; if(metric==='reps') return 'reps/sec'; return 'kg'; }
function allSummaries(){ return exerciseNames().map(name=>summaryForExercise(name)).filter(Boolean); }
function summaryForExercise(name){ const entries=exerciseEntries(name); if(!entries.length) return null; const metric=autoMetric(name), vals=entries.map(e=>valueForEntry(e,metric)), best=Math.max(...vals), latest=vals[vals.length-1], first=vals[0], change=latest-first, percent=first?change/first*100:0; const lastBestIndex=vals.lastIndexOf(best); const noNewHigh=entries.length-1-lastBestIndex; const recent=vals.slice(-4); const slope=recent.length>=2?recent[recent.length-1]-recent[0]:0; const plateau=entries.length>=4 && (noNewHigh>=3 || (slope<=0 && latest < best*0.98)); return {name, entries:entries.length, metric, unit:unitForMetric(metric), best, latest, first, change, percent, noNewHigh, plateau}; }
function renderProgress(){
  const names=exerciseNames();
  const sel=$('#progressExercise');
  const previous=sel.value || state.progressExercise || '';
  sel.innerHTML=names.map(n=>`<option value="${esc(n)}" ${n===previous?'selected':''}>${esc(n)}</option>`).join('');
  if(previous && names.includes(previous)) sel.value=previous;
  state.progressExercise=sel.value || names[0] || '';
  if(state.progressView==='overall') renderOverall(); else renderExerciseProgress(state.progressExercise);
}

function renderOverall(){ $('#progressControls').style.display='none'; $('#viewOverall').classList.add('active'); $('#viewExercise').classList.remove('active'); const sessions=[...state.sessions].filter(s=>!state.pendingDeletes.has(String(s.id))).sort((a,b)=>new Date(a.date)-new Date(b.date)); const summaries=allSummaries(); const totalSets=sessions.reduce((sum,s)=>sum+s.exercises.reduce((a,e)=>a+e.sets.length,0),0); const volume=sessions.map(s=>s.exercises.reduce((sum,e)=>sum+e.sets.reduce((a,set)=>a+setVolume(set,e.name,s),0),0)); const weak=summaries.filter(x=>x.plateau); const improving=summaries.filter(x=>x.percent>0); renderStats([['Workouts',sessions.length],['Sets',totalSets],['Improving',improving.length],['Plateaus',weak.length]]); $('#chartTitle').textContent='Overall workload'; $('#chartSubtitle').textContent=sessions.length?`Last ${Math.min(18,sessions.length)} workouts · kg×reps`:''; drawChart(volume, sessions.map(s=>s.date), 'kg×reps'); renderInsights(); $('#listTitle').textContent='Exercise summary'; $('#progressList').innerHTML=summaries.length?summaries.sort((a,b)=>b.percent-a.percent).map(s=>`<div class="progress-row"><div><b>${esc(s.name)}</b><div class="small">${s.entries} logs · best ${round(s.best)} ${esc(s.unit)}</div></div><div class="metric">${s.percent>=0?'+':''}${round(s.percent)}%</div></div>`).join(''):'<div class="empty">No progress yet. Save a workout first.</div>'; }
function renderExerciseProgress(name){ $('#progressControls').style.display='grid'; $('#viewOverall').classList.remove('active'); $('#viewExercise').classList.add('active'); if(!name){ renderStats([['Best','—'],['Latest','—'],['Change','—'],['Entries',0]]); $('#chartBox').innerHTML='<div class="empty">No chart data.</div>'; renderInsights(); return; } const metric=$('#progressMetric').value==='auto'?autoMetric(name):$('#progressMetric').value; const entries=exerciseEntries(name); const vals=entries.map(e=>valueForEntry(e,metric)); const unit=unitForMetric(metric); const best=vals.length?Math.max(...vals):0, latest=vals[vals.length-1]||0, first=vals[0]||0, change=latest-first; renderStats([['Best',`${round(best)} ${unit}`],['Latest',`${round(latest)} ${unit}`],['Change',`${change>=0?'+':''}${round(change)} ${unit}`],['Entries',entries.length]]); $('#chartTitle').textContent=`${name} · ${metric==='e1rm'?'Estimated 1RM':metric}`; $('#chartSubtitle').textContent=`Last ${Math.min(18, entries.length)} entries`; drawChart(vals, entries.map(e=>e.date), unit); renderInsights(name); $('#listTitle').textContent='Recent entries'; $('#progressList').innerHTML=entries.slice(-12).reverse().map(e=>`<div class="progress-row"><div><b>${esc(fmtDate(e.date))}</b><div class="small">Best set: ${setLabel(e.best)}</div></div><div class="metric">${round(valueForEntry(e,metric))} ${unit}</div></div>`).join('') || '<div class="empty">No entries.</div>'; }
function renderStats(rows){ $('#statsGrid').innerHTML=rows.map(([l,v])=>`<div class="stat"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join(''); }
function drawChart(values, labels, unit){ const box=$('#chartBox'); if(!values.length){box.innerHTML='<div class="empty">No chart data.</div>';return;} const n=18, vs=values.slice(-n).map(Number), ls=labels.slice(-n); const minRaw=Math.min(...vs), maxRaw=Math.max(...vs), pad=(maxRaw-minRaw)*.15 || Math.max(1,maxRaw*.15), min=Math.max(0,minRaw-pad), max=maxRaw+pad, span=max-min||1; const left=8,right=94,top=10,bottom=82,w=right-left,h=bottom-top; const pts=vs.map((v,i)=>[vs.length===1?(left+right)/2:left+i/(vs.length-1)*w, bottom-(v-min)/span*h, v]); const poly=pts.map(p=>`${round(p[0])},${round(p[1])}`).join(' '); const area=pts.length>1?`${poly} ${right},${bottom} ${left},${bottom}`:''; box.innerHTML=`<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Progress chart"><line class="grid-line" x1="${left}" y1="${top}" x2="${right}" y2="${top}"/><line class="grid-line" x1="${left}" y1="46" x2="${right}" y2="46"/><line class="grid-line" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"/>${pts.length>1?`<polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${poly}"/>`:''}${pts.map(p=>`<circle class="chart-point" cx="${p[0]}" cy="${p[1]}" r="1.6"><title>${round(p[2])} ${esc(unit)}</title></circle>`).join('')}</svg><div class="chart-note">${esc(shortDate(ls[0]))} → ${esc(shortDate(ls[ls.length-1]))} · ${vs.length} point${vs.length===1?'':'s'} · ${esc(unit)}</div>`; }
function renderInsights(selected=''){ const sums=allSummaries(); const achievements=sums.filter(x=>x.percent>0).sort((a,b)=>b.percent-a.percent).slice(0,4); const weak=sums.filter(x=>x.plateau).sort((a,b)=>b.noNewHigh-a.noNewHigh||a.percent-b.percent).slice(0,4); $('#recordsPanel').innerHTML='<h2>Records & achievements</h2>'+(achievements.length?achievements.map(x=>`<div class="progress-row"><div><b>${esc(x.name)}</b><div class="small">Best ${round(x.best)} ${esc(x.unit)} · ${x.entries} entries</div></div><div class="metric">+${round(x.percent)}%</div></div>`).join(''):'<p class="muted">No positive trend yet.</p>'); $('#weakPanel').innerHTML='<h2>Weak points</h2>'+(weak.length?weak.map(x=>`<div class="progress-row"><div><b>${esc(x.name)}</b><div class="small">No new high for ${x.noNewHigh} entries · latest ${round(x.latest)} ${esc(x.unit)}</div></div><div class="metric">${round(x.percent)}%</div></div>`).join(''):'<p class="muted">No plateau detected.</p>'); }

async function getSupabase(){ if(state.supabase) return state.supabase; if(!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null; state.supabase=window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); return state.supabase; }
function cloudErrorText(error){ return String(error?.message || error?.details || error?.hint || error || ''); }
function toDb(s){ return {id:String(s.id),user_id:state.user.id,date:s.date,week:s.week,day:s.day,bw:s.bw,notes:s.notes,exercises:s.exercises,meta:s.meta||{},updated_at:updatedAt(s),deleted_at:null}; }
function fromDb(r){ if(!r || r.deleted_at) return null; return normalizeSession({id:r.id,user_id:r.user_id,date:r.date,week:r.week,day:r.day,bw:r.bw,notes:r.notes,exercises:r.exercises,meta:r.meta||{},updated_at:r.updated_at,deleted_at:r.deleted_at}); }
function deleteTombstoneRow(id){ const meta=state.deleteMeta[String(id)]||{}; const snap=meta.snapshot||{}; const deletedAtValue=meta.deletedAt||nowIso(); return {id:String(id),user_id:state.user.id,date:snap.date||localDate(),week:clamp(snap.week||1,1,12),day:state.split.includes(snap.day)?snap.day:(state.split[0]||'Full Body'),bw:snap.bw??null,notes:snap.notes||'',exercises:Array.isArray(snap.exercises)?snap.exercises:[],meta:normalizeMeta(snap.meta||{}),updated_at:deletedAtValue,deleted_at:deletedAtValue}; }
async function initAuth(){ const sb=await getSupabase(); if(!sb){ renderAuth(); renderSyncChip(); return; } const {data}=await sb.auth.getUser(); state.user=data?.user||null; sb.auth.onAuthStateChange((ev,session)=>{ state.user=session?.user||null; renderAuth(); renderSyncChip(); if(state.user) syncNow(false); }); renderAuth(); renderSyncChip(); if(state.user) await syncNow(false); }
function renderAuth(){ const el=$('#authBox'); if(!el) return; if(state.user){ el.innerHTML=`<h2>${esc(state.user.email||'Signed in')}</h2><div class="grid2" style="margin-top:12px"><button class="btn primary" id="syncNow" type="button">Sync now</button><button class="btn danger-outline" id="signOut" type="button">Sign out</button></div>`; } else { el.innerHTML=`<h2>Cloud sync</h2><div class="grid2" style="margin-top:12px"><label>Email<input id="authEmail" type="email" placeholder="email"></label><label>Password<input id="authPassword" type="password" placeholder="password"></label></div><div class="grid2" style="margin-top:12px"><button class="btn primary" id="signIn" type="button">Sign in</button><button class="btn secondary" id="signUp" type="button">Sign up</button></div>`; } }
function renderSyncChip(){ const chip=$('#syncChip'); if(!chip) return; const offline=typeof navigator!=='undefined' && navigator.onLine===false; const pending=pendingDeleteCount()+pendingUpsertCount(); if(offline){ chip.className='status-pill warn'; chip.textContent=pending?`Offline · ${pending} pending`:'Offline'; return; } chip.className='status-pill '+(state.user?(pending?'warn':'ok'):(pending?'warn':'')); chip.textContent = state.user ? (pending?`Cloud · ${pending} pending`:'Cloud synced') : (pending?`${pending} pending`:'Local'); }
function setAuthBusy(on){ state.authBusy=!!on; ['signIn','signUp'].forEach(id=>{ const b=$('#'+id); if(b) b.disabled=state.authBusy; }); }
async function signIn(){ if(state.authBusy) return; const sb=await getSupabase(); if(!sb) return toast('Supabase SDK not loaded'); const email=$('#authEmail')?.value.trim(), password=$('#authPassword')?.value; if(!email||!password) return toast('Enter email and password'); setAuthBusy(true); try{ const {data,error}=await sb.auth.signInWithPassword({email,password}); if(error) return toast(error.message,'danger'); state.user=data.user; renderAuth(); await syncNow(); } finally { setAuthBusy(false); } }
async function signUp(){ if(state.authBusy) return; const sb=await getSupabase(); if(!sb) return toast('Supabase SDK not loaded'); const email=$('#authEmail')?.value.trim(), password=$('#authPassword')?.value; if(!email||!password) return toast('Enter email and password'); if(password.length<6) return toast('Password must be at least 6 characters'); setAuthBusy(true); try{ const {error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}}); toast(error?error.message:'Check your email to confirm your account', error?'danger':''); } finally { setAuthBusy(false); } }
async function signOut(){ const sb=await getSupabase(); if(sb) await sb.auth.signOut(); state.user=null; renderAuth(); renderSyncChip(); toast('Signed out'); }
async function selectCloudRows(){ const sb=await getSupabase(); if(!sb||!state.user) return {ok:false,error:'No cloud client',data:[]}; const res=await sb.from('tracker_sessions').select('*').eq('user_id',state.user.id).order('updated_at',{ascending:true}); if(res.error){ state.lastSyncError=cloudErrorText(res.error); return {ok:false,error:state.lastSyncError,data:[]}; } return {ok:true,data:res.data||[]}; }
async function bulkUpsert(rows){ const sb=await getSupabase(); if(!sb||!state.user) return {ok:false,error:'No cloud client'}; if(!rows.length) return {ok:true}; const res=await sb.from('tracker_sessions').upsert(rows,{onConflict:'user_id,id'}); if(res.error){ state.lastSyncError=cloudErrorText(res.error); return {ok:false,error:state.lastSyncError}; } return {ok:true}; }
async function deleteCloud(id){ const sb=await getSupabase(); if(!sb||!state.user) return false; id=String(id); const deletedAtValue=state.deleteMeta[id]?.deletedAt||nowIso(); const payload={deleted_at:deletedAtValue,updated_at:deletedAtValue}; let res=await sb.from('tracker_sessions').update(payload).eq('user_id',state.user.id).eq('id',id).select('id,deleted_at'); if(res.error){ state.lastSyncError=cloudErrorText(res.error); renderDiagnostics(); return false; } if(!res.data || !res.data.length){ const up=await bulkUpsert([deleteTombstoneRow(id)]); if(!up.ok) return false; } const check=await sb.from('tracker_sessions').select('id,deleted_at').eq('user_id',state.user.id).eq('id',id).maybeSingle(); if(check.error){ state.lastSyncError=cloudErrorText(check.error); renderDiagnostics(); return false; } if(check.data && !check.data.deleted_at){ state.lastSyncError='Cloud delete not confirmed'; renderDiagnostics(); return false; } if(state.deleteMeta[id]) state.deleteMeta[id].cloudConfirmed=true; return true; }
function mergeSessions(local,cloudRows){ const tombstones=new Set((cloudRows||[]).filter(r=>r.deleted_at).map(r=>String(r.id))); const map=new Map(); for(const s of local){ const id=String(s.id); if(tombstones.has(id) || state.pendingDeletes.has(id)) continue; map.set(id,s); } for(const r of (cloudRows||[])){ if(r.deleted_at || state.pendingDeletes.has(String(r.id))) continue; const s=fromDb(r); if(!s) continue; const id=String(s.id); const cur=map.get(id); if(!cur || new Date(updatedAt(s)||0) >= new Date(updatedAt(cur)||0)) map.set(id,s); } return [...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date)||String(a.id).localeCompare(String(b.id))); }
function pruneConfirmedDeletesFromPull(cloudRows){ const activeCloudIds=new Set((cloudRows||[]).filter(r=>!r.deleted_at).map(r=>String(r.id))); for(const id of [...state.pendingDeletes]){ if(state.deleteMeta[id]?.cloudConfirmed && !activeCloudIds.has(id)) markDeleteConfirmed(id); } }
async function syncNow(show=true){
  if(state.syncRunning) return false;
  if(!state.user){ if(show) toast('Sign in first'); return false; }
  const sb=await getSupabase(); if(!sb){ state.lastSyncError='Supabase SDK not loaded'; saveLocal(false); renderDiagnostics(); if(show) toast('Supabase SDK not loaded'); return false; }
  state.syncRunning=true;
  purgeQueuedLocalDeletes(); pruneQueues(); saveLocal(false);
  let ok=true;
  try{
    for(const id of [...state.pendingDeletes]){ const deleted=await deleteCloud(id); if(!deleted) ok=false; }
    const uploads=state.sessions.filter(s=>!state.pendingDeletes.has(String(s.id)) && state.pendingUpserts.has(String(s.id)));
    if(uploads.length){ const up=await bulkUpsert(uploads.map(toDb)); if(up.ok){ uploads.forEach(s=>state.pendingUpserts.delete(String(s.id))); saveLocal(false); } else ok=false; }
    const pull=await selectCloudRows();
    if(!pull.ok){ ok=false; if(show) toast('Sync failed', 'danger'); return false; }
    state.sessions=mergeSessions(state.sessions,pull.data||[]);
    pruneConfirmedDeletesFromPull(pull.data||[]);
    state.lastSyncAt=nowIso();
    state.lastSyncError=ok?null:state.lastSyncError;
    saveLocal(false);
    renderSyncChip(); renderDiagnostics(); renderHistory(); renderProgress();
    const pending=pendingDeleteCount()+pendingUpsertCount();
    if(show) toast(ok?(pending?`Synced · ${pending} pending`:'Synced'):`Sync pending · ${pending} pending`, ok?'':'danger');
    return ok && pending===0;
  }catch(e){
    state.lastSyncError=cloudErrorText(e); saveLocal(false); renderDiagnostics(); if(show) toast('Sync failed', 'danger'); return false;
  }finally{
    state.syncRunning=false;
  }
}
function renderDiagnostics(){ const el=$('#diagnostics'); if(!el) return; const rows=[['Mode',state.user?'Cloud':'Local only'],['Local workouts',state.sessions.filter(s=>!state.pendingDeletes.has(String(s.id))).length],['Pending uploads',pendingUpsertCount()],['Pending deletes',pendingDeleteCount()],['Last sync',state.lastSyncAt?new Date(state.lastSyncAt).toLocaleString():'Never'],['Schema','soft-delete clean sync'],['Last error',state.lastSyncError||'—']]; el.innerHTML=rows.map(([k,v])=>`<div class="diag-row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join(''); renderSyncChip(); }
function setAccordion(button, body, open){ if(!button || !body) return; button.setAttribute('aria-expanded', String(open)); const mark=button.querySelector('[data-mark], span'); if(mark) mark.textContent=open?'−':'+'; body.hidden = !open; }
function toggleSessionInfo(){ state.sessionOpen=!state.sessionOpen; setAccordion($('#sessionToggle'), $('#sessionFields'), state.sessionOpen); }
function toggleDiagnostics(){ const body=$('#diagnostics'); const btn=$('#diagnosticsToggle'); const open=!!body?.hidden; setAccordion(btn, body, open); }
async function resetLocalData(){ const ok=await modal({title:'Reset local data?',message:'This clears only this device. Cloud workouts stay in Supabase unless you use Erase all data.',danger:true,confirmText:'Reset local'}); if(!ok) return; state.sessions=[]; state.editId=null; clearDeleteQueue(); clearUpsertQueue(); clearDraft(); store.removeItem(STORE_KEY); saveLocal(); renderApp(); toast('Local data reset'); }

async function eraseAllData(){
  const ok=await modal({title:'Erase all data?',message:state.user?'This marks all cloud workouts deleted in Supabase and removes local data. Type ERASE to continue.':'You are not signed in. This removes only local workouts. Type ERASE to continue.',danger:true,requireText:'ERASE',confirmText:'Erase'});
  if(!ok) return;
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
  state.sessions=[]; state.editId=null; clearDraft(); store.removeItem(STORE_KEY);
  if(cloudOk){ clearDeleteQueue(); clearUpsertQueue(); } else { sessionsBeforeClear.forEach(sess=>queueDelete(sess.id, sess)); clearUpsertQueue(); }
  saveLocal(); renderApp(); toast(cloudOk?'All data erased':'Local erased · cloud erase pending', cloudOk?'':'danger');
}
function exportJson(){ download('minmax-v13-backup.json', JSON.stringify({app:'MinMax Tracker',version:APP_VERSION,exportedAt:nowIso(),sessions:state.sessions},null,2),'application/json'); }
function exportCsv(){ const rows=[['date','week','day','bodyweight','exercise','set','load','reps','rir']]; state.sessions.forEach(s=>s.exercises.forEach(e=>e.sets.forEach((set,i)=>rows.push([s.date,s.week,s.day,s.bw??'',e.name,i+1,set.load,set.reps,set.rir??''])))); download('minmax-v13-log.csv','\ufeff'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\n'),'text/csv;charset=utf-8'); }
function download(name,content,type){ const a=document.createElement('a'), blob=new Blob([content],{type}); a.href=URL.createObjectURL(blob); a.download=name; a.style.display='none'; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},500); }
async function importJsonFile(file){ try{ const data=JSON.parse(await file.text()); const incoming=(Array.isArray(data)?data:data.sessions||[]).map(normalizeSession).filter(Boolean); if(!incoming.length) return toast('No valid sessions found'); const ok=await modal({title:'Import backup?',message:`Import ${incoming.length} workouts and merge with current local data?`,confirmText:'Import'}); if(!ok) return; incoming.forEach(s=>unqueueDelete(s.id)); state.sessions=mergeSessions(state.sessions,incoming); incoming.forEach(s=>state.pendingUpserts.add(String(s.id))); saveLocal(); renderApp(); if(state.user) syncNow(false); toast('Imported'); }catch(e){ toast('Import failed'); } }

function registerEvents(){
  document.addEventListener('click', async e=>{
    const nav=e.target.closest('[data-nav]'); if(nav) return setPage(nav.dataset.nav);
    const day=e.target.closest('[data-day]'); if(day){ syncOpenBlock(); collectSessionFields(); state.day=day.dataset.day; state.exIndex=firstOpenIndex(); saveLocal(); renderTrain(); return; }
    const quick=e.target.closest('[data-act]'); if(quick){ e.preventDefault(); applyQuick(quick.closest('.set-card'),quick.dataset.act); return; }
    const open=e.target.closest('[data-open]'); if(open){ e.preventDefault(); e.stopPropagation(); const card=open.closest('.session'); const body=card.querySelector('.session-details'); const willOpen=body.hidden; body.hidden=!willOpen; open.setAttribute('aria-expanded', String(willOpen)); open.textContent = willOpen ? 'Close' : 'Open'; return; }
    const del=e.target.closest('[data-delete]'); if(del){ e.preventDefault(); e.stopPropagation(); await deleteSession(del.dataset.delete, del.closest('.session')); return; }
    const edit=e.target.closest('[data-edit]'); if(edit){ e.preventDefault(); e.stopPropagation(); editSession(edit.dataset.edit); return; }
    const viewBtn=e.target.closest('#viewOverall,#viewExercise'); if(viewBtn){ state.progressView=viewBtn.dataset.view; state.progressExercise=$('#progressExercise')?.value||state.progressExercise||''; renderProgress(); return; }
    const head=e.target.closest('.ex-head'); if(head){ toggleExercise(Number(head.dataset.exi)); return; }
    const rest=e.target.closest('[data-rest]'); if(rest){ toggleRest(rest); return; }
    if(e.target.closest('#sessionToggle')){ toggleSessionInfo(); return; }
    if(e.target.closest('#diagnosticsToggle')){ toggleDiagnostics(); return; }
    if(e.target.id==='syncNow') return syncNow(); if(e.target.id==='signIn') return signIn(); if(e.target.id==='signUp') return signUp(); if(e.target.id==='signOut') return signOut();
  });
  $('#weekMinus').onclick=()=>shiftWeek(-1); $('#weekPlus').onclick=()=>shiftWeek(1); $('#saveWorkout').onclick=saveWorkout; $('#clearDraft').onclick=confirmClearDraft;
  const pill=$('#restPill'); if(pill) pill.onclick=()=>{ stopRest(); toast('Rest skipped'); };
  const rirBtn=$('#rirToggle'); if(rirBtn) rirBtn.onclick=()=>{ setShowRir(!state.prefs.showRir); saveLocal(false); };
  document.addEventListener('keydown', e=>{ if(e.key==='Enter' && (e.target.id==='authEmail' || e.target.id==='authPassword')){ e.preventDefault(); signIn(); } });
  window.addEventListener('online', ()=>{ renderSyncChip(); if(state.user && (pendingDeleteCount()+pendingUpsertCount())>0) syncNow(false); });
  window.addEventListener('offline', renderSyncChip);
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') flushDraft(); });
  $('#exerciseList').addEventListener('input', e=>{ const block=e.target.closest('.ex-block'); if(block) updateSetsFor(block); }); ['sDate','sBw','sNotes','sEnergy','sSleep'].forEach(id=>$('#'+id).addEventListener('input', collectSessionFields));
  $('#progressExercise').onchange=()=>{ state.progressExercise=$('#progressExercise').value; renderExerciseProgress(state.progressExercise); }; $('#progressMetric').onchange=()=>{ state.progressExercise=$('#progressExercise').value||state.progressExercise; renderExerciseProgress(state.progressExercise); }; $('#darkToggle').onclick=()=>{setTheme(document.documentElement.classList.contains('dark')?'light':'dark'); saveLocal();}; $('#exportJson').onclick=exportJson; $('#exportCsv').onclick=exportCsv; $('#importJsonBtn').onclick=()=>$('#importFile').click(); $('#importFile').onchange=e=>{ if(e.target.files[0]) importJsonFile(e.target.files[0]); e.target.value='';}; $('#resetLocal').onclick=resetLocalData; $('#eraseAll').onclick=eraseAllData;
}
async function registerServiceWorker(){
  if(!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  try{
    const reg=await navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`);
    reg.update?.();
    let hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(!hadController){ hadController=true; return; } if(state.swReloading) return; state.swReloading=true; location.reload(); });
  }catch(e){}
}
async function init(){ try{ loadProgramSync(); loadLocal(); fillSessionFields(); registerEvents(); renderApp(); setShowRir(state.prefs.showRir); refreshProgram(); await initAuth(); await registerServiceWorker(); }catch(e){ document.body.innerHTML=`<main class="shell"><section class="card"><h1>App failed to load</h1><p class="muted">${esc(e.message)}</p></section></main>`; } }
document.addEventListener('DOMContentLoaded', init);
