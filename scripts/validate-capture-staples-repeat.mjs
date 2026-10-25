import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as bls from '../supabase/functions/_shared/bls-search-data.mjs';
import * as references from '../supabase/functions/_shared/bls-reference.mjs';
import * as catalog from '../supabase/functions/_shared/bls-search.mjs';
import * as synonyms from '../supabase/functions/_shared/food-synonyms.mjs';
globalThis.fetch = async () => { throw Error('TEST_EXTERNAL_HTTP_BLOCKED'); };
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function load(path, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (id.endsWith('bls-search-data.mjs')) return bls;
    if (id.endsWith('bls-search.mjs')) return catalog;
    if (id.endsWith('food-synonyms.mjs')) return synonyms;
    if (id.endsWith('bls-reference.mjs')) return references;
    if (id.endsWith('.json') && id.startsWith('../data/')) return JSON.parse(read(`src/data/${id.slice(8)}`));
    assert.ok(id in dependencies, `Unmocked dependency: ${id}`); return dependencies[id];
  }, module, module.exports);
  return module.exports;
}
let passed = 0;
const test = async (name, fn) => { await fn(); console.log('PASS', name); passed++; };
const rows = new Map(bls.BLS_SEARCH_ROWS.map(row => [row[0], row]));
await test('plain pasta preparations and parmesan bridge to existing BLS values, without invented nutrients', () => {
  for (const [query, code] of [
    ['pasta cooked','E401032'],['spaghetti boiled','E401032'],['penne cooked','E401032'],['Nudeln gekocht','E401032'],
    ['pasta dry','E401000'],['uncooked spaghetti','E401000'],['Nudeln roh','E401000'],
    ['whole wheat pasta cooked','E500032'],['wholemeal pasta raw','E510000'],['egg pasta cooked','E432032'],
    ['parmesan cheese','M306400'],['grated parmesan cheese','M306400'],['Parmesan gerieben','M306400'],
  ]) {
    const facts = references.resolveExactBlsFacts(query), row = rows.get(code);
    assert.equal(facts?.referenceId, code, query);
    assert.deepEqual([facts.calories,facts.protein,facts.carbs,facts.fat,facts.fiber], row.slice(3), query);
    assert.equal(facts.estimatedReference, true, query + ': generic vocabulary must disclose typical reference');
  }
});
await test('recipe, brand, grain and raw/cooked conflicts cannot collapse to plain BLS pasta or cheese', () => {
  for (const query of ['pasta','pasta sauce','pasta cooked with butter','rice noodles cooked','lentil pasta cooked','vegan parmesan','parmesan sauce','Kraft grated parmesan cheese','parmesan reduced fat']) {
    assert.equal(references.resolveExactBlsFacts(query), null, query);
  }
  for (const item of [
    {name:'Vollkornnudeln',searchTermEn:'pasta cooked',preparation:'boiled'},
    {name:'Nudeln roh',searchTermEn:'pasta cooked',preparation:'raw'},
    {name:'Nudeln gekocht',searchTermEn:'pasta raw',preparation:'boiled'},
    {name:'Pasta',searchTermEn:'pasta cooked',preparation:'fried'},
    {name:'Nudeln mit Sauce',searchTermEn:'pasta cooked',preparation:'boiled'},
    {name:'Veganer Parmesan',searchTermEn:'parmesan cheese',preparation:'unknown'},
  ]) {
    assert.equal(references.requiresFoodIdentityCorrection(item),true,JSON.stringify(item));
    assert.equal(references.resolveBlsFacts({...item,referenceKey:'other'}),null);
  }
  assert.equal(references.resolveBlsFacts({name:'Spaghetti',searchTermEn:'pasta cooked',preparation:'boiled'})?.referenceId,'E401032');
  assert.equal(references.resolveBlsFacts({name:'Parmesan',searchTermEn:'grated parmesan cheese',preparation:'unknown'})?.referenceId,'M306400');
});
let language = 'de';
const suggest = load('src/services/foodSuggest.ts', {'@/i18n/active':{getLanguage:()=>language,getDictionary:()=>({scan:new Proxy({}, {get:()=> 'portion'})})}});
await test('visible search ranks the reviewed plain pasta first and keeps explicit egg, grain and preparation', () => {
  const cases = [
    ['pasta cooked', 'E401032'], ['cooked pasta', 'E401032'], ['gekochte Nudeln', 'E401032'], ['Nudeln gekocht', 'E401032'],
    ['pasta raw', 'E401000'], ['Nudeln trocken', 'E401000'],
    ['egg noodles cooked', 'E432032'], ['Eiernudeln gekocht', 'E432032'],
    ['whole wheat pasta cooked', 'E500032'], ['Vollkornnudeln gekocht', 'E500032'],
    ['wholemeal pasta raw', 'E510000'], ['Eiernudeln roh', 'E432000'],
  ];
  for (language of ['de', 'en']) for (const [query, code] of cases) {
    const hits = catalog.searchBlsCatalog(query, language, 15);
    assert.equal(hits[0]?.code, code, `${language}/${query}: catalogue must rank the requested identity first`);
    assert.equal(hits[0].strong, true);
    assert.deepEqual(Object.values(hits[0].per100g), rows.get(code).slice(3), query + ': original BLS values');
    // A frequently logged different kind must not override an explicit alias.
    const history = new Map([['E432032', {count: 99, lastGrams: 250, lastAt:'2026-10-04'}], ['E500032', {count: 99, lastGrams: 150, lastAt:'2026-10-04'}]]);
    for (const usage of [new Map(), history]) {
      const local = suggest.suggestFoods(query, usage, 15);
      assert.equal(local[0]?.source.referenceId, code, `${language}/${query}: visible local suggestions`);
      assert.equal(new Set(local.map(food => food.source.referenceId)).size, local.length, 'no duplicate preferred row');
      const merged = suggest.mergeSuggestions(local, hits.map(food => ({id:'bls-'+food.code, source:{provider:'bls',referenceId:food.code}})));
      assert.equal(merged[0].source.referenceId, code, 'remote merge preserves the reviewed first choice');
    }
  }
  language = 'de';
});
await test('search priority does not strip sauce, brand, gluten-free, rice or vegan qualifiers', () => {
  const plain = new Set(['E401032', 'E401000', 'M306400']);
  for (language of ['de', 'en']) for (const query of ['pasta sauce', 'pasta cooked with butter', 'rice noodles cooked', 'lentil pasta cooked', 'gluten free pasta cooked', 'vegan parmesan', 'Kraft grated parmesan cheese']) {
    assert.equal(references.resolveReviewedStapleFacts(query), null, query);
    assert.ok(!plain.has(catalog.searchBlsCatalog(query, language, 1)[0]?.code), query + ': catalogue');
    assert.ok(!plain.has(suggest.suggestFoods(query, new Map(), 1)[0]?.source.referenceId), query + ': local');
  }
  language = 'de';
});
await test('on-device exact matches use the same BLS references for DE/EN, keeping explicit preparation and usage amounts', () => {
  for (const [lang, query, code] of [['de','Nudeln gekocht','E401032'],['de','Nudeln roh','E401000'],['de','Parmesan gerieben','M306400'],['en','pasta cooked','E401032'],['en','pasta raw','E401000'],['en','grated parmesan cheese','M306400']]) {
    language=lang;
    const result=suggest.matchFood(query,new Map([[code,{count:2,lastGrams:55,lastAt:'2026-10-04'}]]));
    assert.equal(result?.source.referenceId,code,query); assert.equal(result.defaultGrams,55);
    assert.equal(result.source.estimatedReference,true);
  }
  for(const query of ['rice noodles cooked','vegan parmesan','pasta with butter','pasta sauce']) assert.ok(!['E401032','M306400'].includes(suggest.matchFood(query)?.source.referenceId),query);
  language='de';
});
const repeats=load('src/services/repeatMeals.ts');
const meal=(id,date,type='Breakfast',calories=100)=>({id,title:id,type,date,savedAt:date+'T08:00:00Z',time:'08:00',origin:'plan',confidence:'medium',calories,protein:4,carbs:10,fat:2,fiber:1,items:[{id:'same-item-id',name:id,amountG:50,baseAmountG:50,portionFactor:1,included:true,calories,protein:4,carbs:10,fat:2,fiber:1,confidence:'medium',source:{provider:'bls',referenceId:'C133000',label:'BLS'}}]});
await test('yesterday breakfast combines the actual entries once and retains exact corrected amounts, sources and nutrition',()=>{
  assert.equal(typeof repeats.yesterdayBreakfast,'function','Missing yesterday breakfast selector');
  const breakfast=[meal('oats','2026-10-03'),meal('milk','2026-10-03','Breakfast',80)];
  breakfast[1].savedAt='2026-10-03T08:10:00Z'; breakfast[1].items[0].amountG=73.5; breakfast[1].items[0].baseAmountG=73.5;
  const history=[...breakfast,meal('dinner','2026-10-03','Dinner',500),...Array.from({length:10},(_,i)=>meal('frequent','2026-09-'+String(i+10).padStart(2,'0')))];
  assert.equal(repeats.availableRepeats(history,[])[0].title,'frequent','Baseline ranks a frequent older meal first');
  const before=structuredClone(history); const candidate=repeats.yesterdayBreakfast(history,[],'2026-10-04');
  assert.equal(candidate.calories,180);assert.equal(candidate.protein,8);assert.equal(candidate.source.type,'Breakfast');
  assert.deepEqual(candidate.source.items.map(x=>x.amountG),[50,73.5]);
  assert.equal(new Set(candidate.source.items.map(x=>x.id)).size,2,'Separate instant-food item IDs remain unique');
  assert.deepEqual(candidate.source.items.map(x=>x.source),breakfast.map(x=>x.items[0].source));
  assert.deepEqual(history,before,'Never mutate saved history');
});
await test('yesterday selector is calendar-based, ignores demos/future/lunch, hides after any breakfast today and has no empty placeholder',()=>{
  assert.equal(repeats.yesterdayBreakfast([],[],'2026-10-04'),null);
  assert.equal(repeats.yesterdayBreakfast([meal('old','2026-10-02'),meal('future','2026-10-05'),meal('lunch','2026-10-03','Lunch'),{...meal('demo','2026-10-03'),origin:'seed'}],[],'2026-10-04'),null);
  for(const [today,yesterday] of [['2026-10-26','2026-10-25'],['2026-03-30','2026-03-29'],['2027-01-01','2026-12-31']]) {
    const old=meal('breakfast',yesterday);assert.ok(repeats.yesterdayBreakfast([old],[],today),today);
    assert.equal(repeats.yesterdayBreakfast([old],[meal('already eaten',today)],today),null);
    assert.ok(repeats.yesterdayBreakfast([old],[meal('lunch',today,'Lunch')],today));
  }
});
await test('Today repeat tap opens the slot sheet (Als … eintragen) preselected by clock, Breakfast for yesterday, on the shown day',async()=>{
  const source=read('src/app/(tabs)/today.tsx'), ast=ts.createSourceFile('today.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='repeat')callback=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);
  assert.ok(callback);const candidate=repeats.yesterdayBreakfast([meal('oats','2026-10-03')],[],'2026-10-04');
  const other={...candidate,key:'other'};
  const calls=[], env={repeatChoices:[candidate,other],yesterday:candidate,repeating:null,setChoosing:value=>calls.push(value),mealTypeForHour:()=>'Dinner',logRepeatMeal:()=>{throw Error('Tap must not log before the slot is confirmed');}};
  const js=ts.transpileModule('return ('+callback+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const run=(e,key)=>new Function(...Object.keys(e),js)(...Object.values(e))(key);
  run(env,candidate.key);run(env,'other');
  assert.deepEqual(calls,[{candidate,slot:'Breakfast'},{candidate:other,slot:'Dinner'}]);
  run({...env,repeating:'other'},candidate.key);assert.equal(calls.length,2,'no second sheet while one is open');
  assert.match(source,/const repeatDate = isToday \? null : viewDay;/,'the shown day (day switcher) is the day the repeat is filed on');
  assert.match(source,/<FavoriteLogSheet[\s\S]*?candidate=\{choosing\?\.candidate \?\? null\}[\s\S]*?date=\{repeatDate\}/,'the carousel logs through the slot sheet');
  assert.ok(!/setPlannedMealType\(/.test(callback),'the carousel never leaves a planned slot behind');
  assert.match(source,/t\.today\.yesterdayBreakfast/,'Yesterday card must be identifiable in the existing repeat strip');
  const sheet=read('src/components/FavoriteLogSheet.tsx');
  assert.match(sheet,/logRepeatMeal\(picked, \{ type: target, date, portion \}\)/,'the sheet logs the chosen slot, day and portion through the single repeat save path');
});
await test('favourites come first in the repeat strip, repeat their stored snapshot 1:1 and never duplicate',()=>{
  const history=[meal('skyr','2026-10-01','Breakfast',300),meal('skyr','2026-10-03','Breakfast',350),...Array.from({length:5},(_,i)=>meal('frequent','2026-09-'+String(i+10).padStart(2,'0')))];
  const base=repeats.availableRepeats(history,[]);
  assert.equal(base[0].title,'frequent');
  const stored=meal('skyr','2026-09-01','Breakfast',200);stored.items[0].amountG=173.5;
  const favorites=[{id:'00000000-0000-4000-8000-000000000001',key:repeats.favoriteKey({title:' Skyr '}),meal:stored,starredAt:'2026-10-02T10:00:00Z'}];
  const merged=repeats.withFavorites(base,favorites,history);
  assert.equal(merged[0].title,'skyr');assert.equal(merged[0].favorite,true);
  assert.equal(merged[0].calories,200,'the starred snapshot is what repeats, not the last logged portion');
  assert.equal(merged[0].source.items[0].amountG,173.5,'items and grams as stored');
  assert.equal(merged.filter(c=>c.title==='skyr').length,1,'a favourite is not listed twice');
  assert.equal(repeats.withFavorites(base,[],history).length,base.length);
  assert.equal(repeats.withFavorites(base,[{...favorites[0],pendingDelete:true}],history)[0].title,'frequent','a removed favourite is gone at once');
  const snapshot=repeats.favoriteSnapshot({...meal('x','2026-10-03'),sync:{mealId:'x',revision:2,status:'synced'}});
  assert.equal(snapshot.sync,undefined,'a favourite never carries a sync identity');
  assert.equal(snapshot.date,undefined,'nor the day it was eaten');
});
console.log(JSON.stringify({passed,scope:'Existing BLS snapshot, actual local food matcher, repeat selector and Today handler; zero network or native UI claims'}));
