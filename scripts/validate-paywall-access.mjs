import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(file, deps = {}) {
  const module = {exports:{}};
  const js = ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',js)(name=>{assert.ok(name in deps,'Unmocked '+name);return deps[name]},module,module.exports);
  return module.exports;
}
const policy=load('src/services/accessPolicy.ts');
const now=Date.now();
const b={...policy.FREE_ACCESS,variant:'B',hard:true,access:'inactive'};
for(const variant of ['A','excluded','unassigned']) assert.equal(policy.resolveAccess({...policy.FREE_ACCESS,variant}),'free');
assert.equal(policy.resolveAccess(b),'locked'); assert.equal(policy.resolveAccess(b,true),'pending');
assert.equal(policy.resolveAccess({...b,access:'unknown'}),'verification');
assert.equal(policy.resolveAccess({...b,access:'active',validUntil:new Date(now+1000).toISOString()},false,now),'active');
assert.equal(policy.resolveAccess({...b,access:'active',validUntil:new Date(now-1).toISOString()},false,now),'verification');
for(const route of ['/capture','/scan','/today','/plan','/recipe','/progress','/analyzing','/confirm','/result','/correct-food']) assert.equal(policy.routeRequiresAccess(route),true,route);
for(const route of ['/account-help','/saved-meals','/privacy','/terms','/sources','/account-deletion','/data-consent','/paywall']) assert.equal(policy.routeRequiresAccess(route),false,route);
for(const route of ['/result','https://evil.test','/capture?save=true']) {policy.rememberAccessDestination(route);assert.equal(policy.takeAccessDestination(),'/today')}
policy.rememberAccessDestination('/capture');policy.rememberAccessDestination('/plan');assert.equal(policy.takeAccessDestination(),'/capture');assert.equal(policy.takeAccessDestination(),'/today');
assert.throws(()=>policy.parseAccessRecord({...b,variant:'A'}));
const storage=new Map();let readFailure=false,writeFailure=false, owner='first', network=true, remote={...policy.FREE_ACCESS,variant:'unassigned',enrollmentOpen:true}, excludes=0, permits=0, held=null, enrollInput;
const asyncStorage={getItem:async k=>{if(readFailure)throw Error('storage');return storage.get(k)??null},setItem:async(k,v)=>{if(writeFailure)throw Error('storage');storage.set(k,v)},removeItem:async k=>storage.delete(k)};
const hardWall=load('src/services/hardWall.ts',{'@react-native-async-storage/async-storage':asyncStorage});
const app=load('src/services/appAccess.ts',{
 '@react-native-async-storage/async-storage':asyncStorage,
 '@/services/accessPolicy':policy,'@/services/hardWall':hardWall,
 '@/services/supabaseClient':{functionsBaseUrl:'https://fixture.invalid/functions/v1',supabaseAnonKey:'fixture-public',getAccessSession:async()=>({userId:owner,accessToken:'fixture-'+owner}),getCurrentSessionUserId:async()=>owner,supabase:{rpc:async(name)=>{if(name==='exclude_paywall_access_v1'){excludes++;if(remote.variant==='unassigned')remote=policy.FREE_ACCESS;}else if(name==='authorize_meal_create_v1')permits++;else throw Error(name);return {error:null};}}},
 '@/i18n/active':{getDictionary:()=>({access:{accessRequired:'access_required',saveOnline:'online_required'}})},
 '@/services/subscription':{loadSubscriptionSnapshot:async()=>({mode:'native-store',plans:{monthly:{hasFreeTrial:true,trialDays:7,package:{product:{identifier:'monthly'}}}}})},
 '@/services/serverEntitlement':{refreshServerEntitlement:async()=>false},
});
globalThis.fetch=async(url,init)=>{
 assert.equal(new URL(url).hostname,'fixture.invalid');if(held)await held;if(!network)throw Error('offline');
 if(url.endsWith('/enroll')) {enrollInput=JSON.parse(init.body);remote=b;}
 return {ok:true,json:async()=>remote};
};
await app.prepareAccessEnrollment(true);assert.equal(await app.hasAccessEnrollmentPending(),true);
assert.equal((await app.completeAccessEnrollment(true)).variant,'B');assert.equal(enrollInput.ageConfirmed,true);assert.equal(enrollInput.sevenDays,true);assert.equal(await app.hasAccessEnrollmentPending(),false);
await app.refreshAppAccess();assert.equal(app.isAppAccessMeasurementVerified('first'),true);assert.equal(app.isAppAccessMeasurementVerified('other'),false);
network=false;const offlineRefresh=app.refreshAppAccess();assert.equal(app.isAppAccessMeasurementVerified('first'),false,'measurement gate closes before awaiting refresh');assert.equal((await offlineRefresh).variant,'B');assert.equal(app.isAppAccessMeasurementVerified('first'),false,'cached public B preserves access but cannot authorize measurement');await assert.rejects(app.assertNewAppUse(),/access_required/);
owner='second';app.invalidateAppAccess();assert.equal((await app.refreshAppAccess()).variant,'excluded');await app.authorizeMealCreate('free-offline');assert.equal(permits,0);
network=true;remote={...policy.FREE_ACCESS,variant:'unassigned'};await app.refreshAppAccess();assert.equal(excludes,1);assert.equal(remote.variant,'excluded');
owner='first';app.invalidateAppAccess();remote={...b,access:'active',validUntil:new Date(Date.now()+10000).toISOString()};await app.refreshAppAccess();assert.equal(app.isAppAccessMeasurementVerified('first'),true,'a parsed live response reopens only its owner measurement gate');await app.authorizeMealCreate('bound-meal');assert.equal(permits,1);
remote=b;await app.refreshAppAccess();await assert.rejects(app.authorizeMealCreate('other-meal'));assert.equal(permits,1);
writeFailure=true; remote=b; assert.equal((await app.refreshAppAccess()).variant,'B'); await assert.rejects(app.assertNewAppUse()); writeFailure=false;
owner='corrupt-cache';app.invalidateAppAccess();readFailure=true;network=false;
assert.equal(policy.resolveAccess(await app.refreshAppAccess()),'verification');
network=true;remote=b;assert.equal((await app.refreshAppAccess()).variant,'B');readFailure=false;
assert.equal(policy.resolveAccess({...policy.FREE_ACCESS,access:'active',validUntil:new Date(Date.now()+10000).toISOString()}),'active');
let release;held=new Promise(r=>release=r);const late=app.refreshAppAccess();await new Promise(r=>setTimeout(r,0));owner='third';app.invalidateAppAccess();release();held=null;await assert.rejects(late,/cloud_identity_changed/);assert.equal(app.isAppAccessMeasurementVerified('first'),false);assert.equal(app.isAppAccessMeasurementVerified('third'),false,'late old response cannot open the new identity measurement gate');
assert.equal(storage.has('@kandro/access:v1:third'),false);
// Paused test (2026-10-09): both flags off, so an assigned B is soft again.
const pause=fs.readFileSync(new URL('../supabase/migrations/20261009100300_pause_paywall_access_test.sql',import.meta.url),'utf8');
assert.match(pause,/set public_enabled = false,\s*enforcement_enabled = false\s*where experiment = 'paywall_access_v1'/);
assert.equal(policy.resolveAccess({...b,hard:false,access:'free'}),'free','a B record without hard enforcement is free');
// Paywall exposure: own-row idempotent insert, authenticated only, fixed contexts.
const exposure=fs.readFileSync(new URL('../supabase/migrations/20261009100100_paywall_exposures.sql',import.meta.url),'utf8');
assert.match(exposure,/on conflict \(user_id, context\) do nothing/);
assert.match(exposure,/values \(auth\.uid\(\), p_context\)/);
assert.match(exposure,/revoke all on function public\.mark_paywall_shown\(text\) from public, anon;/);
assert.doesNotMatch(exposure,/grant [^;]+ to anon/);
const paywallScreen=fs.readFileSync(new URL('../src/app/paywall.tsx',import.meta.url),'utf8');
assert.match(paywallScreen,/paywallViewed\.current = true;\s*markPaywallShown\(/,'paywall marks its first sighting once per mount');
// Purchase steps (2026-10-14): same idempotent per-account record, no plan or price data.
const steps=fs.readFileSync(new URL('../supabase/migrations/20261014170000_paywall_purchase_steps.sql',import.meta.url),'utf8');
assert.match(steps,/'purchase_started', 'purchase_cancelled', 'purchase_failed', 'purchase_pending', 'purchase_completed'/);
assert.match(steps,/on conflict \(user_id, context\) do nothing/);
assert.match(steps,/revoke all on private\.paywall_steps_daily from public, anon, authenticated;/);
assert.doesNotMatch(steps,/grant [^;]+ to anon/);
assert.doesNotMatch(steps.replace(/--[^\n]*/g,''),/price|plan_id|amount/i,'purchase steps store no plan or price');
assert.match(paywallScreen,/markPurchaseStep\('started'\);[\s\S]*?await purchase\(selected\);[\s\S]*?markPurchaseStep\(result\);/,'paywall records start and outcome of every real store purchase');
const exposureClient=fs.readFileSync(new URL('../src/services/paywallExposure.ts',import.meta.url),'utf8');
assert.match(exposureClient,/outcome === 'cancelled' \? 'cancelled'/);
assert.match(exposureClient,/kind: PurchaseStepKind = 'purchase'\) \{[\s\S]*markPaywallShown\(`\$\{kind\}_\$\{step\}`\)/,'paywall purchases keep the purchase_* steps; win-back/retention get their own prefix');
console.log('PASS access states, protected entry routes, legal/history access, safe return intent, stable B, free fallback, account race and per-meal authorization; actual client modules with local mocked boundaries.');
