#!/usr/bin/env node
// Runs shipped controller + repositories with synthetic platform adapters.
// No native-render, backend, billing or model-call claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const read = file => fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
function load(file,mocks={},source=read(file)) {
 const module={exports:{}};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)(id=>{assert.ok(id in mocks,`${file}: unmocked ${id}`);return mocks[id]},module,module.exports);
 return module.exports;
}
const goals=load('src/services/personalGoal.ts');
const units=load('src/utils/units.ts',{'@/i18n/active':{getLocale:()=> 'de-DE'},'@/i18n':{deviceRegion:()=> 'DE'}});
const personalization=load('src/services/personalization.ts',{'@/i18n/active':{getDictionary:()=>({common:{}})},'@/utils/units':units});
const base={...personalization.DEFAULT_PROFILE,age:29,goal:'lose',heightCm:178,weightKg:78,unitSystem:'metric',completedAt:null};
const checks=[];
async function test(name,run){await run();checks.push(name);console.log('PASS',name)}
await test('first run: every step, the wish only for adults with a weight goal; plan editing keeps target/preferences; strict calendar and optional fields',()=>{
 const full=['goal','why','obstacle','about','body','activity','target','potential','preferences','rhythm','plan'];
 for(const [age,goal] of [[29,'lose'],[29,'gain']])assert.deepEqual(goals.onboardingSteps(age,goal),full);
 for(const [age,goal] of [[16,'lose'],[17,'gain'],[29,'maintain']])assert.deepEqual(goals.onboardingSteps(age,goal),full.filter(step=>step!=='target'),'no target weight below 18 or for maintain');
 assert.deepEqual(goals.onboardingSteps(29,'lose',true),['goal','about','body','activity','target','preferences','plan'],'editing reaches every step');
 for(const [age,goal] of [[14,'lose'],[17,'gain'],[29,'maintain']]){const steps=goals.onboardingSteps(age,goal,true);assert.equal(steps.length,6);assert.ok(!steps.includes('target'));assert.ok(steps.includes('preferences'))}
 for(const [date,valid] of [['2028-02-29',true],['2027-02-29',false],['2026-04-31',false],['2026-00-10',false],['2026-10-00',false],['2026-10-04',true],['04.10.2026',false],['2026-1-04',false],['2026-10-04T12:00:00Z',false]]) assert.equal(goals.isPersonalGoalDate(date),valid,date);
 assert.equal(goals.personalGoalError(null,null,'2026-10-04'),null);
 assert.equal(goals.personalGoalError(70,'2026-10-04','2026-10-04'),null);
 assert.equal(goals.personalGoalError(70,'2026-10-03','2026-10-04'),'date');
 assert.equal(goals.personalGoalError(null,'2026-12-04','2026-10-04'),'weight');
 for(const weight of [NaN,Infinity,39.9,200.1])assert.equal(goals.personalGoalError(weight,null,'2026-10-04'),'weight');
 // A wish never points below BMI 18.5 (178 cm: 58.6 kg).
 assert.equal(goals.personalGoalError(58.5,null,'2026-10-04',178),'weight');assert.equal(goals.personalGoalError(58.7,null,'2026-10-04',178),null);
 assert.deepEqual(goals.normalizePersonalGoal({...base,targetWeightKg:55,targetDate:null}),{targetWeightKg:null,targetDate:null},'a stored wish below BMI 18.5 is dropped');
 for(const [value,result]of [['70,5',70.5],['150.25',150.25],['70kg',null],['1e2',null],['',null],['70.123',null]])assert.equal(goals.parsePersonalGoalWeight(value),result);
 for(const profile of [{...base,age:17},{...base,goal:'maintain'}])assert.deepEqual(goals.normalizePersonalGoal({...profile,targetWeightKg:70,targetDate:'2027-01-01'}),{targetWeightKg:null,targetDate:null});
 assert.deepEqual(personalization.calculateDailyTargets(base),personalization.calculateDailyTargets({...base,targetWeightKg:40,targetDate:'2026-10-04'}),'a wish must never change the calorie/protein calculation');
 // Birth year → age: only the 16 and 18 boundary years ask for the birthday.
 assert.equal(goals.MINIMUM_AGE,16);
 for(const [year,birthday,age] of [[1997,null,29],[2010,null,15],[2010,false,15],[2010,true,16],[2008,null,17],[2008,true,18],[2009,null,17],[2011,null,15]])assert.equal(goals.ageFromBirthYear(year,2026,birthday),age,`${year}/${birthday}`);
 assert.deepEqual([2010,2008,2009,1997].map(y=>goals.birthYearNeedsBirthday(y,2026)),[true,true,false,false]);
});
function draftStore(){const values=new Map();return{values,mock:load('src/services/onboardingDraft.ts',{'@react-native-async-storage/async-storage':{default:{getItem:async k=>values.get(k)??null,setItem:async(k,v)=>values.set(k,v),removeItem:async k=>values.delete(k)}}})}}
async function controller(profile=base,editing=false,drafts=draftStore()){
 let cursor=0,slots=[],effects=[],tree,focus=null;const saved=[],routes=[],events=[],grants=[],enrolled=[],stages=[],analytics=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={
  useState(initial){const index=cursor++;slots[index]??={value:typeof initial==='function'?initial():initial};return[slots[index].value,v=>{slots[index].value=typeof v==='function'?v(slots[index].value):v}]},
  useRef(initial){const index=cursor++;slots[index]??={current:initial};return slots[index]},
  useMemo(fn,deps){const index=cursor++;if(!same(slots[index]?.deps,deps))slots[index]={deps,value:fn()};return slots[index].value},
  useCallback(fn,deps){return this.useMemo(fn,deps)},
  useEffect(fn,deps){const index=cursor++;if(!same(slots[index]?.deps,deps)){slots[index]={deps};effects.push(fn)}}
 };react.useCallback=(fn,deps)=>react.useMemo(()=>fn,deps);
 const section=new Proxy({}, {get:(_,key)=>['step','potentialDaily','planTitleNamed','paceGain','paceLose','dateMonths','dateChosen','paceWeeks','targetDiff','goalBy','decreaseUnit','increaseUnit'].includes(key)?(...args)=>`${key}:${args.join('/')}`:key==='rhythmSlots'||key==='whyEcho'?new Proxy({},{get:(_,id)=>String(id)}):['whyChoices','obstacleChoices'].includes(key)?new Proxy({},{get:(_,id)=>({label:String(id),detail:String(id),answer:String(id)})}):String(key)});
 const t={onboarding:section,common:section,access:section,portion:{decimalMark:'.'}};
 const jsx=(type,props)=>({type,props:props??{}});
 const source=process.env.KANDRO_ONBOARDING_BASELINE==='1'?execFileSync('git',['show','HEAD:src/app/onboarding.tsx'],{encoding:'utf8'}):read('src/app/onboarding.tsx');
 const screen=load('src/app/onboarding.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'react-native':{...Object.fromEntries(['KeyboardAvoidingView','Modal','Pressable','ScrollView','Switch','Text','TextInput','View'].map(k=>[k,k])),Platform:{OS:'ios'},Keyboard:{addListener:()=>({remove(){}})},StyleSheet:{create:v=>v,hairlineWidth:1},useWindowDimensions:()=>({height:844,fontScale:1})},
  'react-native-safe-area-context':{SafeAreaView:'SafeAreaView',useSafeAreaInsets:()=>({top:0,bottom:0})},
  'expo-router':{useFocusEffect:fn=>{focus=fn},useLocalSearchParams:()=>editing?{edit:'1'}:{},useRouter:()=>({replace:p=>routes.push(p),push:p=>routes.push(p)})},
  '@expo/vector-icons/Ionicons':{default:'Icon'},'@/components/WeightEntry':{WeightEntry:'WeightEntry'},'@/components/KandroMark':{KandroMark:'Mark'},
  '@/components/PersonalGoalSummary':{PersonalGoalSummary:'PersonalGoalSummary'},'@/components/PlanBuilder':{PlanBuilder:'PlanBuilder',BUILDING_MS:-250},
  '@/components/ui':{PrimaryButton:'PrimaryButton',ProgressBar:'ProgressBar'},
  '@/constants/theme':{radii:{},spacing:{},typeScale:{micro:12,caption:13,compact:15,body:17,heading:22,title:32,display:56}},'@/context/ThemeContext':{useTheme:()=>({colors:{}}),useThemedStyles:()=>new Proxy({},{get:()=>({})})},
  '@/context/AppContext':{useApp:()=>({profile,completeOnboarding:async p=>saved.push(p),grantWellnessConsent:async age=>grants.push(age)})},
  '@/i18n/LanguageProvider':{useLanguage:()=>({language:'de',locale:'de-DE',t})},
  '@/services/personalization':personalization,'@/services/personalGoal':goals,'@/services/onboardingDraft':drafts.mock,
  '@/services/firstRun':{setFirstRunStage:async stage=>stages.push(stage)},'@/services/hardWall':{startHardWallInstall:async()=>stages.push('hard-wall')},
  '@/services/motivation':{MOTIVATIONS:['energy','health','feel','strength'],OBSTACLES:['time','ideas','out','stop'],saveMotivation:async()=>{}},
  '@/services/reminders':{DEFAULT_SLOTS:{breakfast:{hour:8,minute:0},lunch:{hour:12,minute:30},dinner:{hour:18,minute:30}},enableRhythmReminders:async()=>({enabled:true,permission:'authorized'})},
  '@/services/usageSignals':{markUsage(){}},
  '@/services/appAccess':{prepareAccessEnrollment:async confirmed=>enrolled.push(confirmed)},
  '@/services/telemetry':{trackEvent:(event,payload)=>events.push({event,...payload}),setAnalyticsCollectionEnabled:async v=>{analytics.push(v);return v}},
  '@/services/haptics':Object.fromEntries(['errorHaptic','selectionHaptic','stepHaptic','successHaptic'].map(k=>[k,async()=>{}])),
  '@/utils/format':{formatClockTime:()=>'12:30',formatNumber:String,formatDateParts:d=>d.toISOString().slice(0,10)},'@/utils/decimalInput':load('src/utils/decimalInput.ts'),'@/utils/units':units,'@/utils/date':{localDateKey:()=> '2026-10-04'},
 },source).default;
 const render=()=>{cursor=0;tree=screen();const pending=effects;effects=[];pending.forEach(fn=>fn());return tree};
 const nodes=(node=tree)=>{if(Array.isArray(node))return node.flatMap(n=>nodes(n));if(!node||typeof node!=='object')return[];if(node.type==='Modal'&&!node.props.visible)return[];return[node,...nodes(node.props.children??null)]};
 const find=(type,predicate=()=>true)=>{const node=nodes().find(n=>(typeof n.type==='function'?n.type.name:n.type)===type&&predicate(n.props));assert.ok(node,`${type} not on ${step()}`);return node.props};
 const has=(type,predicate=()=>true)=>nodes().some(n=>(typeof n.type==='function'?n.type.name:n.type)===type&&predicate(n.props));
 const step=()=>events.filter(e=>e.event==='setup step viewed').at(-1)?.step;
 const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();await new Promise(r=>setTimeout(r,5));render();await new Promise(r=>setTimeout(r,5));render()};
 // The why and obstacle answers are required; these tests are about the steps around them.
 const press=async()=>{find('PrimaryButton',p=>p.icon==='arrow-forward').onPress();await flush()};
 const answer=async()=>{for(let guard=0;guard<4&&['why','obstacle'].includes(step());guard++){find('ChoiceList').onSelect(step()==='why'?'energy':'time');render();await press()}assert.ok(!['why','obstacle'].includes(step()),'an answered step must move on')};
 const next=async()=>{await press();await answer()};
 render();await flush();
 return{sex:profile.sex,birthYear:1997,render,find,has,nodes,step,next,flush,saved,routes,grants,enrolled,stages,analytics,drafts,focus:async()=>{focus?.();await flush()},back:async()=>{find('Pressable',p=>p.accessibilityLabel==='back').onPress();await flush()}};
}
// Birth year and biological sex are explicit choices: nothing is preselected on "about".
async function toConsent(c){for(let guard=0;guard<14&&!c.has('PrimaryButton',p=>p.label==='consentAccept');guard++){if(c.step()==='about')await through(c,['about']);else await c.next()}assert.ok(c.has('PrimaryButton',p=>p.label==='consentAccept'),'consent reached')}
async function through(c,steps){for(const expected of steps){assert.equal(c.step(),expected);if(expected==='about'){const year=c.nodes().find(n=>n.type?.name==='BirthYearPicker'&&n.props.value===null);if(year){assert.equal(c.find('PrimaryButton',p=>p.icon==='arrow-forward').disabled,true,'birth year must be chosen');year.props.onChange(c.birthYear);c.render()}const sex=c.nodes().find(n=>n.type?.name==='Segmented'&&n.props.selected===null&&n.props.values.includes('female'));if(sex){assert.equal(c.find('PrimaryButton',p=>p.icon==='arrow-forward').disabled,true,'sex must be chosen');sex.props.onSelect(c.sex??'female');c.render()}}await c.next()}}
await test('real screen: explicit birth year, manual next, five steps, defaults and consent boundary',async()=>{
 const c=await controller();assert.equal(c.step(),'goal');c.find('ChoiceList').onSelect('gain');c.render();assert.equal(c.step(),'goal','selection does not navigate');await c.next();assert.equal(c.step(),'about');
 assert.equal(c.find('PrimaryButton',p=>p.icon==='arrow-forward').disabled,true);await c.next();assert.equal(c.step(),'about','direct handler cannot bypass age');
 assert.equal(c.find('BirthYearPicker').value,null,'no year is preselected');assert.ok(!c.has('Pressable',p=>p.accessibilityRole==='checkbox'),'the old "I am 29" checkbox is gone');
 await through(c,['about','body','activity','target','potential','preferences','rhythm']);assert.equal(c.step(),'plan');await c.next();assert.equal(c.saved.length,0,'needs wellness consent');
 c.find('PrimaryButton',p=>p.label==='consentAccept').onPress();await c.flush();assert.equal(c.saved.length,1);
 const saved=c.saved[0];assert.equal(saved.age,29);assert.equal(saved.goal,'gain');assert.equal(saved.weeklyRateKg,0.25,'calm pace by default');assert.deepEqual(saved.preferences,['high-protein'],'"Proteinreich" by default');assert.equal(saved.targetWeightKg,81,'the suggested wish is kept unless removed');assert.equal(saved.targetDate,'2026-12-27','its pace date comes with it');
 assert.deepEqual(c.enrolled,[true]);assert.deepEqual(c.stages,['hard-wall','scan'],'a fresh install joins the hard wall, then the first scan comes next');assert.deepEqual(c.routes,['/(tabs)/today']);assert.deepEqual(c.analytics,[],'analytics stay off unless chosen');
});
await test('real screen: plan editing keeps tap-only goal entry, date chips, validation, back retention, unit conversion',async()=>{
 const previous={...base,displayName:'Saved',sex:'female',completedAt:'2026-09-01T12:00:00Z',targetWeightKg:70.5,targetDate:'2027-04-01'};
 const c=await controller(previous,true);assert.equal(c.find('ChoiceList').selected,'lose');await c.next();assert.equal(c.find('TextInput',p=>p.accessibilityLabel==='nameTitle').value,'Saved');assert.ok(!c.has('BirthYearPicker'),'recorded age cannot be edited');
 await through(c,['about','body','activity']);assert.equal(c.step(),'target');
 const weightInput=()=>c.find('TextInput',p=>p.accessibilityLabel==='targetWeightLabel');
 assert.equal(weightInput().value,'70.5');
 assert.ok(!c.nodes().some(n=>n.type==='TextInput'&&n.props.accessibilityLabel==='targetDateLabel'),'the date is never typed');
 const chip=label=>c.find('Pressable',p=>p.accessibilityRole==='radio'&&p.accessibilityLabel===label);
 assert.equal(c.find('Pressable',p=>p.accessibilityRole==='radio'&&p.accessibilityState?.checked&&p.accessibilityLabel!==undefined).accessibilityLabel,'2027-04-01');
 chip('dateMonths:6').onPress();c.render();
 weightInput().onChangeText('0');c.render();await c.next();assert.equal(c.step(),'target');
 // Below BMI 18.5 for 178 cm (58.6 kg) is refused like any invalid wish.
 weightInput().onChangeText('58');c.render();await c.next();assert.equal(c.step(),'target','a wish below BMI 18.5 blocks Next');
 weightInput().onChangeText('70,5');c.render();
 c.find('StepperButton',p=>p.icon==='add').onPressIn();c.render();assert.equal(weightInput().value,'71');
 c.find('StepperButton',p=>p.icon==='remove').onPressIn();c.render();assert.equal(weightInput().value,'70.5');
 c.find('UnitToggle').onChange('us');await c.flush();c.render();assert.equal(weightInput().value,'155.4');
 c.find('UnitToggle').onChange('metric');await c.flush();c.render();
 await c.next();await c.back();assert.equal(c.step(),'target');
 await through(c,['target','preferences']);const shown=c.find('PersonalGoalSummary').profile;assert.equal(shown.age,29);assert.ok(Math.abs(shown.targetWeightKg-70.5)<0.06);assert.equal(shown.targetDate,'2027-04-04');assert.equal(shown.completedAt,previous.completedAt);await c.next();
 assert.equal(c.saved.length,1);assert.equal(c.saved[0].targetDate,'2027-04-04');assert.deepEqual(c.grants,[],'edits do not re-request consent');assert.deepEqual(c.enrolled,[],'edits never enroll anew');assert.deepEqual(c.stages,[],'edits never restart the first run');assert.deepEqual(c.routes,['/(tabs)/profile']);
});
await test('real screen: plan editing suggests a target with matching pace date, never below BMI 18.5; removing clears both',async()=>{
 const c=await controller({...base,completedAt:'2026-09-01T12:00:00Z',targetWeightKg:null,targetDate:null},true);await through(c,['goal','about','body','activity']);assert.equal(c.step(),'target');
 c.find('Pressable',p=>p.accessibilityRole==='button'&&String(p.onPress).includes('suggestedTargetWeight')).onPress();c.render();c.render();
 assert.equal(c.find('TextInput',p=>p.accessibilityLabel==='targetWeightLabel').value,'73','suggested target is prefilled');
 const checked=c.find('Pressable',p=>p.accessibilityRole==='radio'&&p.accessibilityState?.checked&&typeof p.accessibilityLabel==='string');
 assert.match(checked.accessibilityLabel,/^datePace/,'the pace date is preselected');
 const input=c.find('TextInput',p=>p.accessibilityLabel==='targetWeightLabel');input.onChangeText('70');c.render();c.render();
 const moved=c.find('Pressable',p=>p.accessibilityRole==='radio'&&p.accessibilityState?.checked&&typeof p.accessibilityLabel==='string');
 assert.match(moved.accessibilityLabel,/^datePace/,'pace stays selected after a new target');
 assert.notEqual(moved.accessibilityLabel,checked.accessibilityLabel,'the pace date follows the new target');
 // The − stepper stops at the healthy floor (58.6 kg → 59 on the 0.5 grid).
 c.find('TextInput',p=>p.accessibilityLabel==='targetWeightLabel').onChangeText('59');c.render();
 c.find('StepperButton',p=>p.icon==='remove').onPressIn();c.render();assert.equal(c.find('TextInput',p=>p.accessibilityLabel==='targetWeightLabel').value,'59');
 c.find('Pressable',p=>p.accessibilityRole==='button'&&String(p.onPress).includes("setTargetWeightInput('')")).onPress();c.render();
 assert.ok(!c.nodes().some(n=>n.type==='TextInput'&&n.props.accessibilityLabel==='targetWeightLabel'));
 await through(c,['target','preferences']);await c.next();assert.equal(c.saved[0].targetWeightKg,null);assert.equal(c.saved[0].targetDate,null);
});
await test('real screen: under 16 is a friendly block with no consent, data or guardian flow',async()=>{
 const c=await controller();c.birthYear=2011;await c.next();await through(c,['about']);
 assert.ok(c.find('Text',p=>p.children==='underageTitle'),'block screen shown');assert.ok(!c.has('Modal',()=>true)||!c.nodes().some(n=>n.props?.label==='consentAccept'));
 assert.equal(c.saved.length,0);assert.deepEqual(c.grants,[]);assert.deepEqual(c.enrolled,[]);
 assert.ok(!c.nodes().some(n=>typeof n.props?.label==='string'&&/guardian/.test(n.props.label)),'no guardian request');
 // The birth year 2010 straddles 16: the birthday decides.
 const d=await controller();d.birthYear=2010;await d.next();d.find('BirthYearPicker').onChange(2010);d.render();
 assert.equal(d.find('PrimaryButton',p=>p.icon==='arrow-forward').disabled,true,'birthday still open');
 d.find('Segmented',p=>p.values.includes('yes')).onSelect('no');d.render();d.find('Segmented',p=>p.values.includes('female')).onSelect('female');d.render();await d.next();
 assert.ok(d.find('Text',p=>p.children==='underageTitle'),'15 until the birthday');
 d.find('PrimaryButton',p=>p.label==='underageFix').onPress();d.render();assert.equal(d.find('BirthYearPicker').value,null,'the year can be corrected');
});
await test('real screen: 16–17 get "Gesünder essen" and no deficit; underweight cannot choose to lose',async()=>{
 const c=await controller();c.birthYear=2009;await c.next();await through(c,['about','body']);await c.back();await c.back();await c.back();await c.back();await c.back();assert.equal(c.step(),'goal');
 const teenLose=c.find('ChoiceList').choices[0];assert.equal(teenLose.label,'goalLoseTeen');assert.equal(teenLose.detail,'goalLoseTeenDetail');
 await c.next();await toConsent(c);c.find('PrimaryButton',p=>p.label==='consentAccept').onPress();await c.flush();
 assert.equal(c.saved[0].age,17);assert.equal(personalization.caloriePlan(c.saved[0]).requestedOffset,0,'teen: no deficit');assert.ok(!c.has('Switch'),'no analytics opt-in under 18');
 const u=await controller();await u.next();await through(u,['about']);assert.equal(u.step(),'body');
 u.find('WeightEntry').onChange(52);u.render();assert.ok(u.find('SafetyNotice').text==='underweightNotice','the reason is shown right away');
 await u.back();await u.back();await u.back();await u.back();assert.equal(u.step(),'goal');const lose=u.find('ChoiceList');assert.equal(lose.choices[0].disabled,true);assert.equal(lose.choices[0].detail,'underweightNotice');assert.equal(lose.selected,'maintain','falls back to maintain');
 await u.next();await toConsent(u);u.find('PrimaryButton',p=>p.label==='consentAccept').onPress();await u.flush();
 assert.equal(u.saved[0].goal,'maintain');assert.equal(personalization.caloriePlan(u.saved[0]).requestedOffset,0);
});
await test('real screen: progress survives an app kill and is cleared on completion',async()=>{
 const drafts=draftStore();const c=await controller(base,false,drafts);c.find('ChoiceList').onSelect('maintain');c.render();await c.next();c.birthYear=1990;await through(c,['about']);
 c.find('WeightEntry').onChange(83.5);c.render();await c.flush();assert.ok(drafts.values.size===1,'saved while answering');
 const resumed=await controller(base,false,drafts);assert.equal(resumed.step(),'body','the same step');assert.equal(resumed.find('WeightEntry').value,83.5);
 await resumed.back();await resumed.back();await resumed.back();await resumed.back();assert.equal(resumed.find('ChoiceList').selected,'maintain');await resumed.next();assert.equal(resumed.find('BirthYearPicker').value,1990);
 await toConsent(resumed);resumed.find('PrimaryButton',p=>p.label==='consentAccept').onPress();await resumed.flush();
 assert.equal(resumed.saved[0].age,36);assert.equal(resumed.saved[0].weightKg,83.5);assert.equal(drafts.values.size,0,'cleared on completion');
 // A draft can never resume past the age gate without an allowed age.
 drafts.values.set('@kandro/onboarding-draft:v1',JSON.stringify({...JSON.parse(JSON.stringify({stepIndex:4,goal:'lose',displayName:'',sex:'female',sexChosen:true,unitSystem:'metric',birthYear:2012,hadBirthday:null,heightCm:170,weightKg:60,activityLevel:'light'}))}));
 const young=await controller(base,false,drafts);assert.equal(young.step(),'about');
 assert.equal(drafts.mock.parseOnboardingDraft('{"stepIndex":"x"}'),null);assert.equal(drafts.mock.parseOnboardingDraft('nope'),null);
});
await test('real screen: adult consent sheet has an unselected analytics opt-in and legal links keep the sheet',async()=>{
 const c=await controller();await c.next();await toConsent(c);
 const toggle=c.find('Switch');assert.equal(toggle.value,false,'not preselected');assert.equal(toggle.accessibilityLabel,'analyticsOptIn');
 toggle.onValueChange(true);c.render();c.find('Pressable',p=>p.accessibilityRole==='button'&&p.accessibilityState?.expanded===false).onPress();c.render();
 c.find('Pressable',p=>p.accessibilityRole==='link'&&c.nodes().some(()=>true)&&String(p.onPress).includes('/privacy')).onPress();c.render();
 assert.deepEqual(c.routes,['/privacy']);assert.ok(!c.has('Switch'),'the sheet steps aside for the legal page');
 await c.focus();assert.equal(c.find('Switch').value,true,'choice kept after returning');assert.ok(c.has('Text',p=>p.children==='consentBody'),'details still expanded');
 c.find('PrimaryButton',p=>p.label==='consentAccept').onPress();await c.flush();assert.equal(c.saved.length,1);assert.deepEqual(c.analytics,[true],'enabled only after completion, because it was chosen');
});
const values=new Map();
const storage={getItem:async k=>values.get(k)??null,setItem:async(k,v)=>values.set(k,v),removeItem:async k=>values.delete(k),multiSet:async pairs=>pairs.forEach(([k,v])=>values.set(k,v)),multiRemove:async keys=>keys.forEach(k=>values.delete(k))};
const localMocks={'@/services/personalGoal':goals,'@react-native-async-storage/async-storage':{default:storage},'@/services/personalization':personalization,'@/utils/date':{localDateKey:()=> '2026-10-04'},'@/utils/units':units,'@/utils/requestId':{isAnalysisRequestId:()=>true,newAnalysisRequestId:()=> 'test-id'}};
let local=load('src/services/localRepository.ts',localMocks);
await test('real local repository survives restart, legacy rows, corrupted wishes and account replacement',async()=>{
 const desired={...base,completedAt:'2026-09-01',targetWeightKg:70.25,targetDate:'2028-02-29'};await local.saveProfile(desired);local=load('src/services/localRepository.ts',localMocks);assert.deepEqual(await local.loadProfile(),desired);
 values.set('@kandro/profile:v1',JSON.stringify({...base,completedAt:'2026-09-01'}));const old=await local.loadProfile();assert.equal(old.completedAt,'2026-09-01');assert.equal(old.targetWeightKg,null);assert.equal(old.targetDate,null);
 for(const extra of [{targetWeightKg:'70',targetDate:'2027-01-01'},{targetWeightKg:201},{age:17,targetWeightKg:70}]){values.set('@kandro/profile:v1',JSON.stringify({...base,...extra}));assert.equal((await local.loadProfile()).targetWeightKg,null)}
 await local.saveProfile(desired);await local.replaceLocalAccountData({...base,completedAt:'2026-09-02'},[],0);assert.equal((await local.loadProfile()).targetWeightKg,null);assert.equal((await local.loadProfile()).completedAt,'2026-09-02');
});
await test('real cloud repository stores/reads wishes for owner, keeps legacy completed state and target formula',async()=>{
 const writes=[],filters=[];let row={display_name:'Stored',goal:'lose',age:29,height_cm:178,weight_kg:78,activity_level:'light',weekly_rate_kg:0.5,unit_system:'metric',sex:'female',preferences:[],target_weight_kg:'70.25',target_date:'2028-02-29',updated_at:'2026-09-01'};
 const targets=personalization.calculateDailyTargets(base);
 const supabase={from:table=>{const chain={upsert:async(payload,options)=>{writes.push({table,payload,options});return{error:null}},select:()=>chain,eq:(key,value)=>{filters.push({table,key,value});return chain},single:async()=>({data:table==='profiles'?row:targets,error:null})};return chain}};
 const cloud=load('src/services/cloudRepository.ts',{'@/services/personalGoal':goals,'./supabaseClient':{supabase,isSupabaseConfigured:true,ensureSupabaseUser:async()=>({id:'owner-A'}),getCurrentSessionUserId:()=> 'owner-A'},'@/utils/date':{localDateKey:()=> '2026-10-04'},'@/utils/units':units,'@/services/personalization':personalization,'@/utils/format':{formatClockTime:String},'./localRepository':{getLocalDataGeneration:()=>0},'@/utils/requestId':{newAnalysisRequestId:()=> 'test-id'}});
 await cloud.saveCloudProfile({...base,targetWeightKg:70.25,targetDate:'2028-02-29'},targets);assert.equal(writes[0].payload.user_id,'owner-A');assert.equal(writes[0].payload.target_weight_kg,70.25);assert.equal(writes[0].payload.target_date,'2028-02-29');assert.equal(writes[1].payload.calories,targets.calories);
 const result=await cloud.initializeCloudProfile(base,targets,true,{userId:'owner-A',generation:0});assert.equal(result.profile.targetWeightKg,70.25);assert.equal(result.profile.targetDate,'2028-02-29');assert.equal(result.profile.completedAt,'2026-09-01');assert.ok(filters.some(f=>f.table==='profiles'&&f.key==='user_id'&&f.value==='owner-A'));
 row={...row,target_weight_kg:null,target_date:null};const old=await cloud.initializeCloudProfile(base,targets,true);assert.equal(old.profile.targetWeightKg,null);assert.equal(old.profile.completedAt,'2026-09-01');
 await assert.rejects(cloud.initializeCloudProfile(base,targets,true,{userId:'owner-B',generation:0}),/cloud_identity_changed/);
 await cloud.saveCloudProfile({...base,age:17,targetWeightKg:70,targetDate:'2028-02-29'},targets);assert.equal(writes.at(-2).payload.target_weight_kg,null);assert.equal(writes.at(-2).payload.target_date,null);
});
console.log(`Personal-goal/onboarding: ${checks.length} controller/persistence groups passed. Native layout and hosted schema not claimed.`);
// Order: the plan is built on screen before it is revealed (no number shown
// first and "calculated" afterwards), and no button can skip past it.
{
  const src = read('src/app/onboarding.tsx');
  const buildAt = src.indexOf("step === 'plan' && building ? <View style={styles.buildingStage}><PlanBuilder");
  const revealAt = src.indexOf("step === 'plan' && !building ?");
  assert.ok(buildAt > 0 && revealAt > buildAt, 'building precedes the reveal');
  assert.match(src, /showFooterButton && !keyboardOpen && !\(step === 'plan' && building\)/, 'no Next while the plan is being built');
  assert.match(src, /setTimeout\(\(\) => setRevealed\(true\), BUILDING_MS \+ 250\)/, 'reveal waits for the full count');
  assert.match(src, /const building = step === 'plan' && !editing && !revealed;/, 'building from the first frame');
  assert.doesNotMatch(read('src/app/access-setup.tsx'), /PlanBuilder|buildingTitle/, 'the plan is never built a second time after consent');
  console.log('PASS build-then-reveal order; no second calculation after consent');
}
