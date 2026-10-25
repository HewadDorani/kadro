import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as nutrition from '../supabase/functions/_shared/nutrition.mjs';
import { detectionSchema } from '../supabase/functions/_shared/detection.mjs';
import { searchBlsCatalog } from '../supabase/functions/_shared/bls-search.mjs';

let failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.message); }
};
await test('explicit tenth-gram and small quantities fit detection contract', () => {
  const grams = detectionSchema.properties.items.items.properties.estimatedGrams;
  assert.equal(grams.type, 'number'); assert.equal(grams.minimum, 1); assert.equal(grams.maximum, 5000);
});
await test('USDA ml serving is not relabelled as grams', () => {
  assert.deepEqual(nutrition.usdaPortions({servingSize:200,servingSizeUnit:'ml',householdServingFullText:'1 glass'}), []);
});
await test('USDA branded volume nutrition is not presented as per 100 grams',()=>{
 const base={fdcId:1,dataType:'Branded',description:'Synthetic liquid',foodNutrients:[{nutrientId:1008,unitName:'KCAL',value:50},{nutrientId:1003,value:3},{nutrientId:1005,value:4},{nutrientId:1004,value:2}]};
 assert.equal(nutrition.toFoodFacts({...base,servingSizeUnit:'ml'}),null);assert.equal(nutrition.toFoodFacts(base),null);
 assert.ok(nutrition.toFoodFacts({...base,servingSizeUnit:'g'}));
});
await test('USDA measured mass retains source decimals', () => {
  assert.equal(nutrition.usdaPortions({servingSize:12.5,servingSizeUnit:'g',householdServingFullText:'1 piece'})[0].grams,12.5);
});
await test('bounded everyday misspelling finds real oats', () => {
  assert.equal(searchBlsCatalog('haferfloken','de')[0]?.code,'C133000');
});
await test('milk fat percentage remains one identity feature', () => {
  const results=searchBlsCatalog('Milch 1,5 %','de'); assert.ok(results.length);
  assert.ok(results.every(r=>!r.nameDe.includes('3,5 %')));
});
await test('unknown nutrient stays unknown, true zero stays valid',()=>{
  const base={'energy-kcal_100g':0,proteins_100g:0,carbohydrates_100g:0,fat_100g:0};
  assert.ok(nutrition.openFoodFactsNutrition(base));
  assert.equal(nutrition.openFoodFactsNutrition({...base,fat_100g:null}),null);
});

const source=fs.readFileSync(new URL('../src/services/mealAnalysis.ts',import.meta.url),'utf8');
const dictionary={errors:new Proxy({},{get:(_,key)=>String(key)}),paywall:{blockedSub:'blocked'}};
let payload=null, generation=0, language='de';
const oldFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,status:200,headers:new Headers(),json:async()=>payload});
const mocks={
 'expo-file-system':{},'expo-image-manipulator':{},'react-native':{Image:{getSize:(_uri,_ok,fail)=>fail()}},
 '@/services/supabaseClient':{isSupabaseConfigured:true,functionsBaseUrl:'http://127.0.0.1/test',supabaseAnonKey:'synthetic',getAccessToken:async()=> 'synthetic'},
 '@/i18n/active':{getLanguage:()=> language,getLocale:()=> 'de-DE',getDictionary:()=>dictionary},
 '@/utils/ingredientCorrection':{needsIngredientCorrection:()=>false},
 '@/services/localRepository':{getLocalDataGeneration:()=>generation},
 // No own product ("Mein Produkt") stored: every barcode reaches the gateway.
 '@/services/region':{getMarketRegion:()=>'de',loadMarketRegion:async()=>{}},
 '@/services/customFoods':{findCustomFoodByBarcode:async()=>null,customFoodResult:()=>{throw new Error('unexpected own product');}},
};
const module={exports:{}};
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>{assert.ok(id in mocks,'unmocked '+id);return mocks[id]},module,module.exports);
await test('malformed successful search is not empty success',async()=>{
  for(payload of [null,{}, {results:{}},{results:[{name:'broken'}]}]) await assert.rejects(module.exports.searchFoods('Banane'));
});
await test('successful empty search remains valid',async()=>{
  payload={query:'nothing',results:[]};assert.deepEqual(await module.exports.searchFoods('nothing'),[]);
});
await test('late responses cannot cross account or language changes',async()=>{
 for(const kind of ['account','language']){
  let release;globalThis.fetch=async()=>({ok:true,status:200,headers:new Headers(),json:()=>new Promise(resolve=>{release=resolve;})});
  const task=module.exports.searchFoods('banana');await new Promise(resolve=>setTimeout(resolve,0));
  if(kind==='account')generation++;else language='en';release({results:[]});await assert.rejects(task,error=>error.kind==='request-expired');
 }
});
await test('same reference and amount produce matching rounded search, barcode, photo/text nutrients',async()=>{
 const facts={provider:'open-food-facts',referenceId:'00000001',label:'Synthetic label',calories:99.75,protein:7.25,carbs:9.75,fat:3.5};
 const per100g={calories:facts.calories,protein:facts.protein,carbs:facts.carbs,fat:facts.fat};
 const found={id:'00000001',name:'Synthetic',source:{provider:facts.provider,referenceId:facts.referenceId,label:facts.label},per100g,defaultGrams:100};
 payload={...found,barcode:'00000001'};globalThis.fetch=async()=>({ok:true,status:200,headers:new Headers(),json:async()=>payload});
 const barcode=(await module.exports.analyzeBarcode('00000001')).items[0];
 for(const grams of [100,100.5,3]){
  const searched=module.exports.mealFromSearch(found,grams).items[0];const analyzed=nutrition.buildMealItem({name:'Synthetic',estimatedGrams:grams,confidence:'high'},facts,0);
  for(const key of ['calories','protein','carbs','fat']){assert.equal(searched[key],analyzed[key]);assert.equal(searched[key],Math.round(barcode.nutritionPer100g[key]*grams/100));}
 }
 assert.equal(barcode.fiber,undefined);
});
globalThis.fetch=oldFetch;
if(failed) process.exitCode=1;

await test('inflected preparation and reversed DE/EN words lead with the actual basic food',()=>{
 for(const language of ['de','en']){
  for(const query of ['gekochtes Ei','gekochte Eier','Ei gekocht','boiled egg','egg boiled']){
   const first=searchBlsCatalog(query,language)[0];assert.ok(first);assert.match(first.nameEn,/^(Chicken egg|Eggs) boiled$/i);
   assert.ok(searchBlsCatalog(query,language).every(r=>!/\braw\b/i.test(r.nameEn)));
  }
  for(const query of ['gekochter Reis','Reis gekocht','boiled rice','rice boiled']) assert.match(searchBlsCatalog(query,language)[0].nameEn,/^Rice boiled$/i);
  for(const query of ['Ei','Eier','egg','eggs']) assert.match(searchBlsCatalog(query,language)[0].nameEn,/^(Chicken egg|Eggs) (raw|boiled)$/i);
  assert.match(searchBlsCatalog('Reis roh',language)[0].nameEn,/rice.*raw/i);
  assert.ok(!/mix|noodle|flour/i.test(searchBlsCatalog('Reis roh',language)[0].nameEn));
 }
});
if(failed) process.exitCode=1;

// Previously unseen holdout failures promoted to fixed regressions.
for (const language of ['de', 'en']) {
  const canned = searchBlsCatalog('chickpeas canned', language)[0];
  const cooked = searchBlsCatalog('couscous cooked', language)[0];
  assert.equal(canned?.code, 'H720902');
  assert.equal(cooked?.code, 'C119232');
  assert.match(cooked.nameDe, /gekocht/);
}
console.log('PASS cooked wording and chickpea plural keep existing prepared/canned reference identities');

await test('bounded ingredient plurals/spellings keep nuts and vegetables ahead of their compounds', () => {
  const cases = [
    ['rohe Karotten', 'G620100'], ['carrots raw', 'G620100'], ['Möhren roh', 'G620100'],
    ['Brokkoli roh', 'G312100'], ['Walnüsse', 'H120100'], ['walnuts', 'H120100'],
    ['red lentils', 'H730000'], ['rote Linsen', 'H730000'],
    ['Walnusseis', 'S242300'], ['walnut ice cream', 'S242300'],
  ];
  for (const [query, expected] of cases) for (const language of ['de', 'en']) {
    assert.equal(searchBlsCatalog(query, language)[0]?.code, expected, `${query}/${language}`);
  }
});
if (failed) process.exitCode = 1;
