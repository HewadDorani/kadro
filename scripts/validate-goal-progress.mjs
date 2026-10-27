import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
// Real source modules and provider callbacks; synthetic storage and UI boundaries.
// The fixed clock exists only in this Node process. No native/network SDK loads.
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : ['2026-09-26T12:00:00'])); }
  static now() { return new RealDate('2026-09-26T12:00:00').valueOf(); }
};
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let locale = 'en-GB', dictionary;
const cache = new Map();
const active = { getLocale: () => locale, getDictionary: () => dictionary };
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (id in mocks) return mocks[id];
    if (id === '@/i18n/active') return active;
    if (id === '@/i18n') return { deviceRegion: () => 'DE' };
    if (id.startsWith('@/')) {
      const path = 'src/' + id.slice(2) + '.ts';
      if (!cache.has(path)) cache.set(path, load(path));
      return cache.get(path);
    }
    throw Error('Unexpected dependency: ' + id);
  }, module, module.exports);
  return module.exports;
}
const de = load('src/i18n/de.ts').de, en = load('src/i18n/en.ts').en;
dictionary = en;
const personalization = load('src/services/personalization.ts');
const units = load('src/utils/units.ts');
const dates = load('src/utils/date.ts');
const mealDay = load('src/utils/mealDay.ts', { '@/utils/date': dates });
const consistency = load('src/services/consistency.ts');
const nutrition = load('src/services/mockNutrition.ts', {'@/utils/format': { formatClockTime: () => '12:00' }});
const correction = load('src/utils/ingredientCorrection.ts');
const results = [];
async function test(name, fn) { try { await fn(); results.push({ name, status: 'PASS' }); } catch (e) { results.push({ name, status: 'FAIL', reason: e.message }); } finally { dictionary=en; locale='en-GB'; } }
function localFixture() {
  const values = new Map();
  const storage = { getItem: async k => values.get(k) ?? null, setItem: async (k,v) => { values.set(k,v); }, removeItem: async k => { values.delete(k); }, multiSet: async pairs => { pairs.forEach(([k,v])=>values.set(k,v)); }, multiRemove: async keys => { keys.forEach(k=>values.delete(k)); } };
  const local = load('src/services/localRepository.ts', { '@react-native-async-storage/async-storage': { default: storage }, '@/utils/requestId': { isAnalysisRequestId: () => true, newAnalysisRequestId: randomUUID } });
  return { values, local, storage };
}
const base = { ...personalization.DEFAULT_PROFILE, displayName:'Synthetic goal check', age:35, weightKg:90.5, heightCm:180, activityLevel:'low', completedAt:'2026-09-01T10:00:00Z', preferences:[] };
const meal = (id,date,protein=20) => ({ id, title:'Synthetic food', date, protein, calories:200, carbs:20, fat:4, fiber:1, items:[], origin:'plan', type:'Lunch', time:'12:00' });
const weights = n => Array.from({length:n}, (_,i)=>({ date:`2026-09-${String(i+1).padStart(2,'0')}`, weightKg:90+i/10 }));
const appSource = read('src/context/AppContext.tsx');
const ast = ts.createSourceFile('AppContext.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name,env) {
  let source;
  function visit(node) { if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name) source=node.initializer.getText(ast); ts.forEachChild(node,visit); }
  visit(ast); assert.ok(source,name);
  const code=ts.transpileModule(`return (${source});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const scope={ useCallback:fn=>fn,...env };
  return new Function(...Object.keys(scope),code)(...Object.values(scope));
}
function render(profile=base, meals=[], weightEntries=[], review={ status:'active', freeWeek:null }) {
  const jsx = (type,props) => typeof type==='function' ? type(props) : {type,props};
  const rn = Object.fromEntries(['KeyboardAvoidingView','Modal','ScrollView','Text','TextInput','View'].map(k=>[k,k]));
  const colors=new Proxy({}, {get:()=> '#fff'});
  const mocks = {
    '@/context/ThemeContext':{ useTheme:()=>({colors}), useThemedStyles:fn=>fn(colors) },
    '@expo/vector-icons/Ionicons':{default:'Icon'},
    'react':{useMemo:fn=>fn(),useState:fn=>[typeof fn==='function'?fn():fn,()=>{}]},
    'react/jsx-runtime':{jsx,jsxs:jsx}, 'react-native':{...rn,Platform:{OS:'ios'},StyleSheet:{create:x=>x}},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:0})},
    'react-native-svg':{default:'Svg',Circle:'Circle',Line:'Line',Path:'Path',Rect:'Rect'},
    '@/components/ui':Object.fromEntries(['Card','Eyebrow','IconCircle','PageTitle','PrimaryButton','Screen','SectionTitle'].map(k=>[k,k])),
    '@/components/KeyboardBackfill':{KeyboardBackfill:()=>null},
    '@/context/AppContext':{useApp:()=>({addWeightEntry:async()=>{},mealHistory:meals,profile,targets:personalization.calculateDailyTargets(profile),weightEntries,hydrationReady:true})},
    '@/i18n/LanguageProvider':{useLanguage:()=>({locale,t:dictionary})}, '@/hooks/useLocalDay':{useLocalDay:()=> '2026-09-26'},
    '@/utils/format':{ formatDateParts: (s,opts)=>new Date(s+'T12:00:00').toLocaleDateString(locale,opts), formatNumber: (value, loc)=>Number(value).toLocaleString(loc) },
  };
  // The screen now includes a TSX child with router/subscription boundaries.
  // Execute that real child under this render's adapters, not the pure-TS cache.
  // The free-first-review marker is read from storage; tests preset it directly.
  mocks['@/components/WeeklyReviewCard'] = load('src/components/WeeklyReviewCard.tsx', {
    ...mocks, 'expo-router': { useRouter: () => ({ push: () => {} }) },
    'react': { ...mocks.react, useEffect: () => {}, useState: () => [review.freeWeek, () => {}] },
    '@react-native-async-storage/async-storage': { default: { getItem: async () => review.freeWeek, setItem: async () => {} } },
    '@/context/SubscriptionContext': { useSubscription: () => ({ status: review.status }) },
  });
  const screen = load('src/app/(tabs)/progress.tsx', mocks).default();
  const nodes=[];
  function walk(x) { if(!x||typeof x!=='object') return; if(Array.isArray(x)){x.forEach(walk);return;} nodes.push(x); walk(x.props?.children); }
  walk(screen);
  function text(x) { if(x==null||typeof x==='boolean')return ''; if(typeof x!=='object')return String(x); if(Array.isArray(x))return x.map(text).join(''); return text(x.props?.children); }
  return { nodes, texts:nodes.filter(n=>['Text','PageTitle','Eyebrow'].includes(n.type)).map(text), byType:type=>nodes.filter(n=>n.type===type), text };
}
await test('Empty progress distinguishes a daily target from a measured average',()=>{
  const r=render(); assert.ok(r.texts.includes(en.weeklyReview.title),'The real weekly-review child must render under the test providers'); assert.ok(r.texts.includes(en.progress.proteinTarget),'Missing target label'); assert.ok(!r.texts.includes('0 g'),'No logs must not read as a measured 0 g'); assert.ok(r.texts.includes(en.progress.profileWeight),'No measurement must identify the profile fallback');
});
await test('Thirty-day meal summary excludes tomorrow and old records',()=>{
  const r=render(base,[meal('past','2026-08-27'),meal('first','2026-08-28'),meal('now','2026-09-26'),meal('future','2026-09-27')]);
  const card=r.byType('Card').find(n=>r.text(n).includes(en.progress.meals)); assert.ok(r.text(card).startsWith('2'),r.text(card));
});
await test('Weight chart dates match its last twelve actual observations',()=>{
  const r=render(base,[],weights(14)); assert.ok(!r.texts.includes('1 Sept'),'Chart must not label a dropped measurement'); assert.ok(r.texts.includes('3 Sept')); assert.ok(r.texts.includes(en.progress.timeScaled));
  assert.ok(!/not scaled by time|nicht zeitlich skaliert/.test(en.progress.timeScaled + de.progress.timeScaled),'the chart is time-scaled now; the note must not say otherwise');
});
await test('Future weights do not become the current measurement',()=>{
  const r=render(base,[],[{date:'2026-09-25',weightKg:89},{date:'2026-09-27',weightKg:99}]); assert.ok(r.texts.includes(units.formatWeight(89,'metric',locale))); assert.ok(!r.texts.includes(units.formatWeight(99,'metric',locale)));
});
await test('Insight names separate 30-day meal and 7-day protein windows',()=>{
  const r=render(base,[meal('a','2026-09-01',99),meal('b','2026-09-02',99),meal('c','2026-09-26',20)]); assert.ok(r.texts.includes(en.progress.insightBuildingText(3,20))); assert.match(en.progress.insightBuildingText(3,20),/30/); assert.match(en.progress.insightBuildingText(3,20),/7/);
});
await test('Goal-specific adult copy and neutral teen copy in both languages',()=>{
  for(const [dict,tag] of [[de,'de-DE'],[en,'en-GB']]) { dictionary=dict; locale=tag; const titles=[];
    for(const goal of ['lose','maintain','gain']) { const r=render({...base,goal}); const title=r.text(r.byType('PageTitle')[0]); titles.push(title); assert.ok(r.texts.includes(dict.progress.goalContext[goal])); assert.ok(r.texts.includes(dict.progress.currentTargetNote)); }
    assert.equal(new Set(titles).size,3);
    const teen=render({...base,age:15,goal:'lose'}); assert.ok(teen.texts.includes(dict.progress.teenContext)); assert.ok(!teen.texts.includes(dict.progress.goalContext.lose));
  }
  dictionary=en;locale='en-GB';
});
await test('First weekly review is free for adults; later weeks show the Pro teaser',()=>{
  const card = load('src/components/WeeklyReviewCard.tsx', { 'react':{useEffect:()=>{},useState:x=>[x,()=>{}]}, 'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null}, 'react-native':{Text:'Text',View:'View'}, 'expo-router':{useRouter:()=>({})}, '@react-native-async-storage/async-storage':{default:{}}, '@/components/ui':{}, '@/context/AppContext':{}, '@/context/SubscriptionContext':{}, '@/context/ThemeContext':{}, '@/i18n/LanguageProvider':{}, '@/hooks/useLocalDay':{}, '@/services/weeklyReview':{}, '@/utils/format':{} });
  assert.deepEqual(card.freeReviewAccess(null,'2026-09-19',3),{full:true,claim:true},'first week with entries is claimed and shown');
  assert.deepEqual(card.freeReviewAccess(null,'2026-09-19',0),{full:true,claim:false},'an empty week never uses up the free review');
  assert.deepEqual(card.freeReviewAccess('2026-09-19','2026-09-19',3),{full:true,claim:false},'the free week stays open all week');
  assert.deepEqual(card.freeReviewAccess('2026-09-12','2026-09-19',3),{full:false,claim:false},'week two shows the teaser');
  const week=[meal('w1','2026-09-20'),meal('w2','2026-09-22')];
  const free=render(base,week,[],{status:'ready',freeWeek:null});
  assert.ok(free.texts.includes(en.weeklyReview.loggedDays(2)),'non-Pro adult sees the full first review'); assert.ok(free.texts.includes(en.weeklyReview.freeNote)); assert.ok(!free.texts.includes(en.weeklyReview.teaser));
  const later=render(base,week,[],{status:'ready',freeWeek:'2026-09-12'});
  assert.ok(later.texts.includes(en.weeklyReview.teaser),'week two shows the Pro teaser'); assert.ok(!later.texts.includes(en.weeklyReview.loggedDays(2)));
  const pro=render(base,week,[],{status:'active',freeWeek:'2026-09-12'}); assert.ok(pro.texts.includes(en.weeklyReview.loggedDays(2))); assert.ok(!pro.texts.includes(en.weeklyReview.freeNote));
  const teen=render({...base,age:16},week,[],{status:'ready',freeWeek:null}); assert.ok(!teen.texts.includes(en.weeklyReview.title),'no weekly review under 18');
  assert.equal(de.weeklyReview.teaser,'Deine nächsten Wochenrückblicke mit Kandro Pro');
});
await test('Weekly goal replaces the streak flame: forgiving, no reset, no pressure',()=>{
  const r=render(base,[meal('a','2026-09-20'),meal('b','2026-09-22'),meal('c','2026-09-26')]);
  assert.ok(r.texts.includes(en.progress.weekGoal(3,4)),'3 of 7 days logged · Goal: 4'); assert.ok(r.texts.includes(en.progress.weekGoalOpen));
  assert.equal(de.progress.weekGoal(3,4),'3 von 7 Tagen erfasst · Ziel: 4');
  const done=render(base,['20','21','23','26'].map(d=>meal('d'+d,'2026-09-'+d))); assert.ok(done.texts.includes(en.progress.weekGoalReached));
  assert.ok(!r.nodes.some(n=>n.props?.name==='flame-outline'));
});
await test('Irregular and empty meal days keep their meaning, not zero-calorie consumption',()=>{
 const m=[meal('a','2026-09-20',40),meal('b','2026-09-26',20),meal('future','2026-09-27',200)];
 const s=consistency.proteinConsistency(m,100); assert.equal(s.loggedCount,2); assert.equal(s.averageProtein,30); assert.equal(s.days.filter(d=>!d.logged).length,5);
 const one=render(base,[],[{date:'2026-09-26',weightKg:90.5}]); assert.ok(one.texts.includes(en.progress.emptyChart)); assert.equal(one.nodes.filter(n=>n.props?.accessibilityLabel?.startsWith('Weight history')).length,0);
});
// Exercise actual AppContext callbacks + actual local repository and reload.
for(const goal of ['lose','maintain','gain']) for(const access of ['free_remaining','free_exhausted','pro']) await test(`${goal}/${access}: plan, correction/save-once, restart, goal cycle, new weight`,async()=>{
 const f=localFixture(); let profile={...base,goal},targets=personalization.calculateDailyTargets(profile),entries=[];
 const ref={current:profile}; const quota=access==='free_remaining'?2:3;
 await f.local.saveProfile(profile); await f.local.saveWeightEntry({date:'2026-09-01',weightKg:90});
 f.values.set('@kandro/lifetime-scans:v1',String(quota)); f.values.set('@kandro/wellness-consent:v1',JSON.stringify({granted:true,synthetic:true}));
 f.values.set('synthetic-account', 'A'); f.values.set('synthetic-pro',String(access==='pro'));
 let visibleMeals=[], history=[], items=[{ id:'synthetic-food',name:'Synthetic food',included:true,amountG:100,baseAmountG:100,portionFactor:1,calories:200,protein:20,carbs:20,fat:4,fiber:1,confidence:'high',source:{provider:'demo',label:'Synthetic QA'} }];
 const modesSource=appSource.match(/const FREE_ANALYSIS_MODES = new Set<ScanMode>\((\[[^;]+?\])\);/)[1];
 const freeModes=new Function('return '+modesSource)();
 for(const mode of ['search','barcode','live','description']) {
  const logEnv={analysisStatus:'ready',detectedItems:items,canSaveMealDraft:correction.canSaveMealDraft,...f.local,...nutrition,...dates,
   mealHistory:history,scannedMeal:{...meal('same-id','2026-09-26'),items},scanModeRef:{current:mode},correctionDraftRef:{current:false},
   FREE_ANALYSIS_MODES:new Set(freeModes),consumePlannedMealType:()=>null,consumePlannedMealDate:()=>null,mealMoment:mealDay.mealMoment,formatClockTime:()=>'12:00',telemetryScanSource:x=>x,
   saveSyncedMeal:f.local.saveMeal,setMeals:fn=>{visibleMeals=fn(visibleMeals);},setMealHistory:fn=>{history=fn(history);}};
  const log=callback('logScannedMeal',logEnv);await Promise.all([log(),log()]);
  assert.equal((await f.local.loadMeals()).length,1);assert.equal(visibleMeals.length,1);
  assert.equal((await f.local.loadMeals())[0].origin,freeModes.includes(mode)?'plan':'scan');
 }
 // Confirming a corrected draft returns through the same actual callback.
 items=items.map(item=>({...item,calories:300,protein:30,amountG:150}));
 const saveCorrected=callback('logScannedMeal',{analysisStatus:'ready',detectedItems:items,canSaveMealDraft:correction.canSaveMealDraft,...f.local,...nutrition,...dates,mealHistory:history,scannedMeal:{...meal('same-id','2026-09-26'),items},scanModeRef:{current:'search'},correctionDraftRef:{current:false},FREE_ANALYSIS_MODES:new Set(freeModes),consumePlannedMealType:()=>null,consumePlannedMealDate:()=>null,mealMoment:mealDay.mealMoment,formatClockTime:()=>'12:00',telemetryScanSource:x=>x,saveSyncedMeal:f.local.saveMeal,setMeals:fn=>{visibleMeals=fn(visibleMeals);},setMealHistory:fn=>{history=fn(history);}});
 await saveCorrected();await saveCorrected();assert.equal((await f.local.loadMeals()).length,1);assert.equal((await f.local.loadMeals())[0].calories,300);
 const used=nutrition.sumMeals(await f.local.loadMeals());assert.equal(used.calories,300);assert.equal(nutrition.getRemaining(targets,used).calories,targets.calories-300);

 const env={ profile,profileRef:ref,...f.local,...personalization,...dates,
 adoptProfile:async p=>{await f.local.saveProfile(p);profile=p;ref.current=p;},
 setProfile:p=>{profile=p;ref.current=p;},setTargets:t=>{targets=t;},setWeightEntries:w=>{entries=w;},setHydrationReady:()=>{},isSupabaseConfigured:false,
 normalizeWeightKg:units.normalizeWeightKg };
 const edit=callback('completeOnboarding',env); const add=callback('addWeightEntry',env);
 for(const nextGoal of ['lose','maintain','gain','lose']) {
  await edit({...profile,goal:nextGoal});
  const reloaded=await f.local.loadProfile(); assert.equal(reloaded.goal,nextGoal); assert.equal(reloaded.completedAt,base.completedAt);
  assert.deepEqual(targets,personalization.calculateDailyTargets(reloaded));
  const explanation=personalization.explainTargets(reloaded); assert.equal(explanation.filter(step=>step.unit==='kcal').at(-1).value,targets.calories);
  assert.equal((await f.local.loadMeals())[0].calories,300); assert.equal((await f.local.loadWeightEntries())[0].date,'2026-09-01');
 }
 await add(91.5); await add(91.5);
 const reloaded=await f.local.loadProfile(); assert.equal(reloaded.weightKg,91.5); assert.deepEqual(targets,personalization.calculateDailyTargets(reloaded)); assert.equal((await f.local.loadWeightEntries()).length,2);
 assert.equal(f.values.get('@kandro/lifetime-scans:v1'),String(quota)); assert.equal(f.values.get('synthetic-account'),'A'); assert.equal(f.values.get('synthetic-pro'),String(access==='pro')); assert.match(f.values.get('@kandro/wellness-consent:v1'),/true/);
});
await test('Maintain ignores rate; teen goals do not become adult deficit/surplus',()=>{
 assert.deepEqual(personalization.calculateDailyTargets({...base,goal:'maintain',weeklyRateKg:.25}),personalization.calculateDailyTargets({...base,goal:'maintain',weeklyRateKg:.5}));
 assert.equal(personalization.weeklyRateLabel('maintain',.5,en.common),en.common.paceHold);
 for(const age of [14,15,16,17]) { const t=['lose','maintain','gain'].map(goal=>personalization.calculateDailyTargets({...base,age,goal})); assert.deepEqual(t[0],t[1]);assert.deepEqual(t[1],t[2]); }
});
await test('Metric/US/UK and both locales preserve the same kilograms and plan on reload',async()=>{
 const f=localFixture(); const ref={current:{...base}}, inFlight={current:0}; await f.local.saveProfile(ref.current);
 const set=callback('setUnitSystem',{profileRef:ref,unitWritesInFlightRef:inFlight,...f.local,isSupabaseConfigured:false,setProfile:p=>{ref.current=p;}});
 for(const tag of ['de-DE','en-GB']) for(const unit of ['metric','us','uk']) { locale=tag; await set(unit); const p=await f.local.loadProfile(); assert.equal(p.weightKg,base.weightKg);assert.equal(p.heightCm,base.heightCm); assert.deepEqual(personalization.calculateDailyTargets(p),personalization.calculateDailyTargets(base)); assert.ok(units.formatWeight(p.weightKg,unit,tag)); }
 await Promise.all([set('us'),set('uk'),set('metric')]); assert.equal((await f.local.loadProfile()).unitSystem,'metric');
});
console.log(JSON.stringify({method:'actual TS modules, rendered element tree and extracted current AppContext callbacks; synthetic storage, no provider calls; not a native touch test',clock:'2026-09-26 local noon in process only',results},null,2));
if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
