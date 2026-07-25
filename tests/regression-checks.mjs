import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

function localStorageMock(){
  const values = new Map();
  return {
    get length(){ return values.size; },
    key(index){ return [...values.keys()][index] ?? null; },
    getItem(key){ return values.has(key) ? values.get(key) : null; },
    setItem(key, value){ values.set(String(key), String(value)); },
    removeItem(key){ values.delete(String(key)); },
    clear(){ values.clear(); }
  };
}

function elementMock(){
  return {
    className:'', textContent:'', innerHTML:'', hidden:false, disabled:false,
    dataset:{}, style:{},
    classList:{add(){},remove(){},toggle(){}},
    setAttribute(){}, addEventListener(){}, querySelector(){ return null; },
    querySelectorAll(){ return []; }
  };
}

async function loadApp(){
  const app = await read('src/app.js');
  const storage = localStorageMock();
  const elements = new Map([
    ['#authBox', elementMock()],
    ['#syncChip', elementMock()]
  ]);
  let sdkMode = 'fail';
  let sdkAttempts = 0;
  let authSubscriptions = 0;
  const cloudRows = [];
  const cloudBuilder = {
    select(){ return this; },
    eq(){ return this; },
    order:async()=>({data:cloudRows,error:null})
  };
  const supabaseClient = {
    auth:{
      getSession:async()=>({data:{session:{user:{id:'user-1',email:'test@example.com'}}}}),
      onAuthStateChange(){ authSubscriptions++; }
    },
    from(){ return cloudBuilder; }
  };
  const document = {
    documentElement:elementMock(),
    body:elementMock(),
    head:{
      appendChild(node){
        if(node.tagName === 'SCRIPT'){
          sdkAttempts++;
          queueMicrotask(()=>{
            if(sdkMode === 'success'){
              context.window.supabase = {createClient:()=>supabaseClient};
              node.onload?.();
            }else node.onerror?.();
          });
        }
        return node;
      }
    },
    querySelector:selector=>elements.get(selector) || null,
    querySelectorAll:()=>[],
    createElement:tag=>({...elementMock(),tagName:String(tag).toUpperCase()}),
    addEventListener(){}
  };
  const context = {
    console, document, navigator:{onLine:true}, localStorage:storage,
    location:{origin:'https://example.test',pathname:'/minmax/'},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Date, Math, Map, Set, URL, Blob,
  };
  context.window = {
    localStorage:storage,
    addEventListener(){},
    matchMedia:context.matchMedia
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    `${app}\n;globalThis.__test={state,applyProgram,normalizeSession,detectPRs,summaryForExercise,invalidateDataCache,initAuth,handleOnline};`,
    context,
    {filename:'src/app.js'}
  );
  return {
    api:context.__test,
    storage,
    setSdkMode:mode=>{ sdkMode=mode; },
    sdkAttempts:()=>sdkAttempts,
    authSubscriptions:()=>authSubscriptions
  };
}

async function checkStrengthMetrics(){
  const {api} = await loadApp();
  const program = JSON.parse(await read('program.json'));
  api.applyProgram(program);
  const name = 'Pull-Up (Wide Grip)';
  const prior = {
    id:'prior', date:'2026-07-01', week:1, day:'Full Body', bw:80,
    notes:'', meta:{}, updated_at:'2026-07-01T10:00:00Z',
    exercises:[{name,sets:[{load:0,reps:10,rir:0,timed:false}]}]
  };
  const weighted = {
    id:'weighted', date:'2026-07-08', week:2, day:'Full Body', bw:80,
    notes:'', meta:{}, updated_at:'2026-07-08T10:00:00Z',
    exercises:[{name,sets:[{load:5,reps:15,rir:0,timed:false}]}]
  };
  api.state.sessions=[prior];
  api.invalidateDataCache();
  assert.deepEqual([...api.detectPRs(weighted)], [name], 'weighted pull-up should register as a PR');
  api.state.sessions=[prior,weighted];
  api.invalidateDataCache();
  const summary=api.summaryForExercise(name);
  assert.equal(summary.metric, 'e1rm');
  assert(summary.latest > summary.first, 'weighted bodyweight e1RM should improve, not mix kg with reps');

  const timedName='Dead Hang (optional)';
  const timedPrior={...prior,id:'hang-1',day:'Arms + Delts',exercises:[{name:timedName,sets:[{load:5,reps:60,timed:true}]}]};
  const timedShorter={...weighted,id:'hang-2',day:'Arms + Delts',exercises:[{name:timedName,sets:[{load:10,reps:50,timed:true}]}]};
  api.state.sessions=[timedPrior];
  api.invalidateDataCache();
  assert.deepEqual([...api.detectPRs(timedShorter)], [], 'timed PRs should compare seconds, not added load');
}

async function checkLegacyDayFallback(){
  const {api} = await loadApp();
  const program = JSON.parse(await read('program.json'));
  api.applyProgram(program);
  const session=api.normalizeSession({
    id:'legacy', date:'2026-07-01', week:1, day:'Retired Day',
    exercises:[{name:'Lying Leg Curl',sets:[{load:40,reps:8}]}]
  });
  assert.equal(session.day, program.split[0]);
}

async function checkAuthReconnect(){
  const test = await loadApp();
  test.storage.setItem('sb-test-auth-token', '{"access_token":"stored"}');
  test.setSdkMode('fail');
  assert.equal(await test.api.initAuth(), false);
  assert.equal(test.api.state.user, null);
  assert.equal(test.sdkAttempts(), 1);

  test.setSdkMode('success');
  assert.equal(await test.api.handleOnline(), true);
  assert.equal(test.api.state.user.id, 'user-1');
  assert.equal(test.sdkAttempts(), 2, 'reconnect should retry SDK loading');
  assert.equal(test.authSubscriptions(), 1, 'auth listener should only be registered once');
}

async function runServiceWorker(path, href, cacheKeys){
  const source=await read(path);
  const listeners={};
  const deleted=[];
  let installed=[];
  const caches={
    keys:async()=>cacheKeys,
    delete:async key=>{ deleted.push(key); return true; },
    open:async()=>({
      addAll:async assets=>{ installed=assets; },
      put:async()=>{}
    }),
    match:async()=>null
  };
  const self={
    location:{href,origin:new URL(href).origin},
    clients:{claim:async()=>{}},
    skipWaiting:async()=>{},
    addEventListener:(type,handler)=>{ listeners[type]=handler; }
  };
  const context={self,caches,URL,AbortController,setTimeout,clearTimeout,fetch:async()=>({ok:true,type:'basic',clone(){return this;}})};
  vm.createContext(context);
  vm.runInContext(source,context,{filename:path});
  let installPromise=Promise.resolve();
  listeners.install({waitUntil:p=>{ installPromise=p; }});
  await installPromise;
  let activatePromise=Promise.resolve();
  listeners.activate({waitUntil:p=>{ activatePromise=p; }});
  await activatePromise;
  return {deleted,installed};
}

async function checkPwaIsolation(){
  const minmax=await runServiceWorker(
    'sw.js',
    'https://example.test/laughing-invention/sw.js?v=17.3.2',
    ['minmax-17.3.1','minmax-17.3.2','tuck-v3','unrelated']
  );
  assert.deepEqual(minmax.deleted, ['minmax-17.3.1']);
  assert(minmax.installed.every(url=>url.startsWith('https://example.test/laughing-invention/')));

  const tuck=await runServiceWorker(
    'chin-tuck/sw.js',
    'https://example.test/laughing-invention/chin-tuck/sw.js',
    ['tuck-v2','tuck-v3','minmax-17.3.2','unrelated']
  );
  assert.deepEqual(tuck.deleted, ['tuck-v2']);

  const manifest=JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
}

await checkStrengthMetrics();
await checkLegacyDayFallback();
await checkAuthReconnect();
await checkPwaIsolation();
console.log('All MinMax regression checks passed.');
