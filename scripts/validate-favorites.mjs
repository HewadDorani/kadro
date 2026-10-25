/**
 * Favourites (Kandro 1.0.6): add from Confirm/Result, log into a chosen slot
 * and day (Today's carousel, the scan sheet, "Alle Favoriten"), manage
 * (rename/remove), and the offline-first cloud copy (public.meal_favorites).
 *
 * Runs the real repeat helpers, the real favourites store against synthetic
 * storage and a synthetic Supabase client, and the real logRepeatMeal
 * callback from AppContext. No network, no native UI claims.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import ts from 'typescript';

globalThis.fetch = async () => { throw Error('TEST_EXTERNAL_HTTP_BLOCKED'); };
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const load = (file, mocks = {}) => {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    assert.ok(id in mocks, 'Unmocked dependency: ' + id + ' in ' + file);
    return mocks[id];
  }, module, module.exports);
  return module.exports;
};
let passed = 0;
const test = async (name, run) => { await run(); passed += 1; console.log('PASS', name); };

const repeats = load('src/services/repeatMeals.ts');
const item = (id, grams, kcalPer100 = 100) => ({
  id, name: id, amountG: grams, baseAmountG: grams, portionFactor: 1, included: true,
  calories: Math.round(kcalPer100 * grams / 100), protein: Math.round(10 * grams / 100), carbs: Math.round(12 * grams / 100), fat: Math.round(3 * grams / 100), fiber: 0,
  nutritionPer100g: { calories: kcalPer100, protein: 10, carbs: 12, fat: 3, fiber: 0 },
  confidence: 'high', source: { provider: 'bls', referenceId: 'X1', label: 'BLS' },
});
const meal = (title, items, extra = {}) => {
  const sum = (key) => items.filter((entry) => entry.included).reduce((total, entry) => total + (entry[key] ?? 0), 0);
  return { id: 'meal-' + title, title, type: 'Lunch', time: '12:00', confidence: 'high', origin: 'scan', date: '2026-10-20', savedAt: '2026-10-20T12:00:00.000Z', items, calories: sum('calories'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), fiber: sum('fiber'), ...extra };
};

await test('portion check scales the stored grams per item; totals stay the sum; 1x is the stored meal 1:1', () => {
  const stored = meal('Bowl', [item('rice', 180), item('chicken', 133.5, 165), { ...item('sauce', 30), included: false }]);
  assert.equal(repeats.scaleMealPortion(stored, 1), stored);
  for (const factor of [0.7, 1.4]) {
    const scaled = repeats.scaleMealPortion(stored, factor);
    assert.equal(scaled.items[0].amountG, Math.round(180 * factor * 10) / 10);
    assert.equal(scaled.items[1].amountG, Math.round(133.5 * factor * 10) / 10);
    assert.equal(scaled.items[2].amountG, 30, 'an excluded item stays as it was');
    const included = scaled.items.filter((entry) => entry.included);
    assert.equal(scaled.calories, included.reduce((total, entry) => total + entry.calories, 0));
    assert.equal(scaled.items[1].calories, Math.round(165 * scaled.items[1].amountG / 100), 'from the per-100 g reference');
  }
  assert.deepEqual(stored.items.map((entry) => entry.amountG), [180, 133.5, 30], 'never mutates the favourite');
});

await test('snapshot keeps the meal as logged (included items, grams, sources), never day, sync or excluded rows', () => {
  const logged = meal('Skyr mit Beeren', [item('skyr', 250), { ...item('honey', 10), included: false }], { sync: { mealId: 'x', revision: 3, status: 'synced' } });
  const snapshot = repeats.favoriteSnapshot(logged);
  assert.deepEqual(snapshot.items.map((entry) => [entry.name, entry.amountG]), [['skyr', 250]]);
  assert.equal(snapshot.sync, undefined); assert.equal(snapshot.date, undefined); assert.equal(snapshot.savedAt, undefined);
  assert.equal(snapshot.origin, 'plan', 'a repeat never counts as an analysis');
  assert.equal(snapshot.calories, logged.calories);
});

await test('favourites search filters by name and ingredients; star state ignores pending deletes', () => {
  const entries = ['Skyr mit Beeren', 'Spaghetti Bolognese', 'Döner Teller'].map((title, index) => ({ id: randomUUID(), key: repeats.favoriteKey({ title }), meal: meal(title, [item(index === 1 ? 'Hackfleisch' : 'x', 100)]), starredAt: '2026-10-0' + (index + 1) }));
  const candidates = entries.map((entry) => repeats.favoriteCandidate(entry));
  assert.deepEqual(repeats.filterFavoriteCandidates(candidates, 'bolo').map((c) => c.title), ['Spaghetti Bolognese']);
  assert.deepEqual(repeats.filterFavoriteCandidates(candidates, 'hackfleisch').map((c) => c.title), ['Spaghetti Bolognese']);
  assert.deepEqual(repeats.filterFavoriteCandidates(candidates, 'doner').map((c) => c.title), ['Döner Teller'], 'umlaut-insensitive');
  assert.equal(repeats.filterFavoriteCandidates(candidates, '  ').length, 3);
  assert.ok(repeats.findFavorite(entries, { title: ' skyr MIT beeren ' }));
  assert.equal(repeats.findFavorite([{ ...entries[0], pendingDelete: true }], { title: 'Skyr mit Beeren' }), null);
});

// --- The favourites store, offline first, with a synthetic cloud ------------
function storeFixture({ cloud = true, failCloud = false } = {}) {
  const disk = { favorites: [] };
  let generation = 0;
  const invalidations = [];
  const calls = [];
  const remote = new Map();
  const table = () => {
    const query = { filters: {} };
    const api = {
      select() { return api; },
      eq(column, value) { query.filters[column] = value; return api; },
      order() { return api; },
      limit() { calls.push(['select']); return Promise.resolve(failCloud ? { data: null, error: { message: 'offline' } } : { data: [...remote.values()], error: null }); },
      upsert(row) { calls.push(['upsert', row]); if (failCloud) return Promise.resolve({ error: { message: 'offline' } }); remote.set(row.id, row); return Promise.resolve({ error: null }); },
      delete() { query.delete = true; return api; },
      then(resolve) { calls.push(['delete', query.filters.id]); if (!failCloud) remote.delete(query.filters.id); resolve({ error: failCloud ? { message: 'offline' } : null }); },
    };
    return api;
  };
  const store = load('src/services/favoriteMeals.ts', {
    '@/services/localRepository': {
      getLocalDataGeneration: () => generation,
      loadFavoriteMeals: async () => structuredClone(disk.favorites),
      saveFavoriteMeals: async (next) => { disk.favorites = structuredClone(next); },
      subscribePrivateDataInvalidation: (listener) => { invalidations.push(listener); },
    },
    '@/services/repeatMeals': repeats,
    '@/services/supabaseClient': { isSupabaseConfigured: cloud, supabase: cloud ? { from: (name) => { assert.equal(name, 'meal_favorites'); return table(); } } : null, ensureSupabaseUser: async () => ({ id: 'user-a' }) },
    '@/utils/requestId': { newAnalysisRequestId: randomUUID },
  });
  return { store, disk, calls, remote, switchAccount: async () => { generation += 1; for (const listener of invalidations) await listener(); } };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

await test('add stores the meal as logged; the same name replaces its portion under the same id; 100 is the limit', async () => {
  const { store, disk } = storeFixture({ cloud: false });
  const first = await store.addFavorite(meal('Bowl', [item('rice', 180)]));
  assert.ok(/^[0-9a-f-]{36}$/.test(first.id));
  assert.deepEqual(disk.favorites[0].meal.items.map((entry) => entry.amountG), [180]);
  const again = await store.addFavorite(meal(' bowl ', [item('rice', 250)]));
  assert.equal(again.id, first.id, 'one favourite per name');
  assert.equal(disk.favorites.length, 1); assert.equal(disk.favorites[0].meal.items[0].amountG, 250);
  for (let index = 1; index < 100; index += 1) await store.addFavorite(meal('Meal ' + index, [item('x', 100)]));
  await assert.rejects(store.addFavorite(meal('One too many', [item('x', 100)])), /favorite_limit_reached/);
  assert.equal(store.getFavoriteMealsSnapshot().length, 100);
});

await test('rename and remove; a taken name is refused; nothing reaches the cloud without consent', async () => {
  const { store, calls } = storeFixture({ cloud: true });
  store.setFavoriteCloudEnabled(false);
  const a = await store.addFavorite(meal('Skyr', [item('skyr', 200)]));
  await store.addFavorite(meal('Porridge', [item('oats', 60)]));
  await store.renameFavorite(a.id, '  Mein   Skyr ');
  assert.equal(store.getFavoriteMealsSnapshot().find((entry) => entry.id === a.id).meal.title, 'Mein Skyr');
  assert.equal(store.getFavoriteMealsSnapshot().find((entry) => entry.id === a.id).key, 'mein skyr');
  await assert.rejects(store.renameFavorite(a.id, 'porridge'), /favorite_name_taken/);
  await assert.rejects(store.renameFavorite(a.id, '   '), /favorite_without_title/);
  await store.removeFavorite(a.id);
  assert.deepEqual(store.getFavoriteMealsSnapshot().map((entry) => entry.meal.title), ['Porridge']);
  await store.syncFavorites(); await settle();
  assert.deepEqual(calls, [], 'wellness data stays on the device without consent');
});

await test('cloud write-through: owner row with validated items; offline keeps the local change and the next sync pushes it', async () => {
  const offline = storeFixture({ cloud: true, failCloud: true });
  offline.store.setFavoriteCloudEnabled(true);
  const entry = await offline.store.addFavorite(meal('Bowl', [item('rice', 180), item('chicken', 133.5, 165)]));
  await settle();
  assert.equal(offline.store.getFavoriteMealsSnapshot().length, 1, 'offline first: the favourite exists at once');
  assert.equal(offline.disk.favorites[0].syncedAt, undefined, 'not marked synced after a failed write');

  const { store, calls, remote, disk } = storeFixture({ cloud: true });
  store.setFavoriteCloudEnabled(true);
  disk.favorites = structuredClone(offline.disk.favorites);
  await store.syncFavorites(); await settle();
  const row = remote.get(entry.id);
  assert.ok(row, 'pushed on the next sync');
  assert.equal(row.user_id, 'user-a'); assert.equal(row.title, 'Bowl');
  assert.deepEqual(row.items.map((value) => value.amountG), [180, 133.5]);
  assert.equal(row.calories, row.items.reduce((total, value) => total + value.calories, 0));
  assert.ok(row.items.every((value) => value.included === true && value.source.provider === 'bls'));
  assert.ok(disk.favorites[0].syncedAt, 'marked synced');
  assert.ok(calls.some(([kind]) => kind === 'upsert'));
});

await test('sync: another device\'s favourite arrives, one deleted elsewhere disappears, a removal deletes the cloud row', async () => {
  const { store, remote, disk } = storeFixture({ cloud: true });
  store.setFavoriteCloudEnabled(true);
  const kept = await store.addFavorite(meal('Kept', [item('a', 100)]));
  const goneElsewhere = await store.addFavorite(meal('Gone elsewhere', [item('b', 100)]));
  await settle();
  remote.delete(goneElsewhere.id);
  const other = randomUUID();
  remote.set(other, { id: other, user_id: 'user-a', title: 'From iPad', meal_type: 'Dinner', confidence: 'medium', items: [item('soup', 300)], calories: 300, protein: 30, carbs: 36, fat: 9, fiber: 0, starred_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z' });
  remote.set('broken', { id: randomUUID(), title: 'Broken', meal_type: 'Lunch', confidence: 'high', items: [{ name: 'no grams' }], calories: 1, protein: 0, carbs: 0, fat: 0, fiber: 0, starred_at: 'x', updated_at: 'x' });
  await store.syncFavorites(); await settle();
  const titles = store.getFavoriteMealsSnapshot().map((entry) => entry.meal.title).sort();
  assert.deepEqual(titles, ['From iPad', 'Kept'], 'damaged rows are dropped, never repaired');
  assert.equal(store.getFavoriteMealsSnapshot().find((entry) => entry.id === other).meal.type, 'Dinner');
  await store.removeFavorite(kept.id); await settle();
  assert.equal(remote.has(kept.id), false, 'a synced favourite is deleted in the cloud too');
  assert.equal(disk.favorites.some((entry) => entry.id === kept.id), false, 'tombstone cleared after the cloud delete');
});

await test('older device-only favourites get a stable id once; an account switch hides the previous account at once', async () => {
  const { store, disk, switchAccount } = storeFixture({ cloud: false });
  disk.favorites = [{ key: 'skyr', meal: meal('Skyr', [item('skyr', 200)]), starredAt: '2026-09-01T08:00:00.000Z' }];
  const [loaded] = await store.loadFavorites();
  assert.ok(loaded.id); assert.equal(disk.favorites[0].id, loaded.id, 'the migrated id is persisted');
  await switchAccount();
  assert.deepEqual(store.getFavoriteMealsSnapshot(), []);
});

// --- logRepeatMeal: the chosen slot and day win, the portion scales ----------
const appSource = read('src/context/AppContext.tsx');
const appAst = ts.createSourceFile('AppContext.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = (name) => {
  let found;
  const visit = (node) => { if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === name) found = node.initializer.getText(appAst); ts.forEachChild(node, visit); };
  visit(appAst); assert.ok(found, name); return found;
};
const evaluate = (source, env) => new Function(...Object.keys(env), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(env));
const daypart = load('src/utils/daypart.ts');
const mealDay = load('src/utils/mealDay.ts', { '@/utils/date': load('src/utils/date.ts'), '@/utils/daypart': daypart });
function repeatEnv({ plannedType = null, plannedDate = null } = {}) {
  const saved = [], spent = [];
  let meals = [], history = [];
  const env = {
    useCallback: (fn) => fn, getLocalDataGeneration: () => 0, repeatInFlightRef: { current: new Map() },
    consumePlannedMealType: () => { spent.push('type'); return plannedType; },
    consumePlannedMealDate: () => { spent.push('date'); return plannedDate; },
    mealTypeForHour: () => 'Snack', mealMoment: mealDay.mealMoment, formatClockTime: () => '12:00', localDateKey: (date) => (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : 'today'),
    scaleMealPortion: repeats.scaleMealPortion,
    saveSyncedMeal: async (value) => { saved.push(value); },
    setMeals: (fn) => { meals = fn(meals); }, setMealHistory: (fn) => { history = fn(history); },
  };
  return { log: evaluate(`return (${declaration('logRepeatMeal')});`, env), saved, spent, meals: () => meals, history: () => history };
}
const favorite = repeats.favoriteCandidate({ id: randomUUID(), key: 'bowl', meal: repeats.favoriteSnapshot(meal('Bowl', [item('rice', 180), item('chicken', 133.5, 165)])), starredAt: '2026-10-01T00:00:00.000Z' });
const dayKey = (offset) => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };

await test('Today carousel: the slot confirmed in the sheet wins over the clock and a stale planned slot, which is still spent', async () => {
  const run = repeatEnv({ plannedType: 'Breakfast' });
  const logged = await run.log(favorite, { type: 'Dinner', date: null, portion: 1 });
  assert.equal(logged.type, 'Dinner'); assert.deepEqual(run.spent, ['type', 'date']);
  assert.deepEqual(logged.items.map((entry) => entry.amountG), [180, 133.5], 're-logged 1:1');
  assert.equal(logged.origin, 'plan'); assert.equal(logged.sync, undefined);
  assert.equal(run.meals().length, 1, 'today goes into today\'s totals');
});

await test('Day switcher: a past day shown on Today files the favourite on that day, not today', async () => {
  const run = repeatEnv();
  const past = dayKey(2);
  const logged = await run.log(favorite, { type: 'Lunch', date: past });
  assert.equal(logged.date, past); assert.equal(logged.type, 'Lunch');
  assert.equal(run.meals().length, 0, 'a back-dated favourite stays out of today\'s totals');
  assert.equal(run.history().length, 1);
});

await test('Slot flow (Today "+ Abendessen" → scan → Favoriten): the planned slot and day are used; Weniger/Mehr scale the grams', async () => {
  const past = dayKey(1);
  const run = repeatEnv({ plannedType: 'Dinner', plannedDate: past });
  const viaSheet = await run.log(favorite, { type: 'Dinner', date: past, portion: 1.4 });
  assert.equal(viaSheet.type, 'Dinner'); assert.equal(viaSheet.date, past);
  assert.deepEqual(viaSheet.items.map((entry) => entry.amountG), [252, 186.9]);
  assert.equal(viaSheet.calories, viaSheet.items.reduce((total, entry) => total + entry.calories, 0));
  // Without a target (older callers), the planned slot and day still apply.
  const legacy = repeatEnv({ plannedType: 'Dinner', plannedDate: past });
  const plain = await legacy.log({ ...favorite, key: 'other' });
  assert.equal(plain.type, 'Dinner'); assert.equal(plain.date, past);
});

// --- Wiring on the screens -----------------------------------------------------
await test('Confirm and Result offer "Zu Favoriten hinzufügen" (never for the example meal); the save fulfils a star set before it', () => {
  const confirm = read('src/app/confirm.tsx'), result = read('src/app/result.tsx'), toggle = read('src/components/FavoriteToggle.tsx');
  assert.match(confirm, /\{scanMode !== 'demo' && canConfirm \? <FavoriteToggle onToast=\{showToast\} \/> : null\}/);
  assert.match(result, /\{demo \? null : <FavoriteToggle onToast=\{showToast\} \/>\}/);
  for (const source of [confirm, result]) assert.match(source, /<Screen overlay=\{toast\}>/, 'the toast is shown');
  assert.match(toggle, /accessibilityRole="switch"/); assert.match(toggle, /accessibilityState=\{\{ checked: scanFavorite/);
  assert.match(toggle, /successHaptic\(\)/); assert.match(toggle, /t\.favorites\.toastAdded/);
  assert.match(appSource, /return persistedMeal;\n  \}, \[analysisStatus, detectedItems, mealHistory, scannedMeal\]\);/, 'logScannedMeal returns the meal as stored');
  assert.match(appSource, /if \(logged\) \{\s*favoriteFulfilledRef\.current = favoriteSignature\(logged\);\s*await addFavorite\(logged\);/, 'starring after the save stores the logged meal');
  assert.match(appSource, /const logged = mealHistory\.find\(\(meal\) => meal\.id === favoriteDraftScanId\);\s*if \(!logged \|\| favoriteFulfilledRef\.current === favoriteSignature\(logged\)\) return;/, 'a star set on Confirm is stored once per save');
});

await test('Scan sheet: "Favoriten" sits beside the capture modes and saves into the slot and day the scan was opened for', () => {
  const scan = read('src/app/(tabs)/scan.tsx'), scanFavorites = read('src/components/ScanFavorites.tsx');
  assert.match(scan, /<ScanFavoritesSheet onClose=\{\(\) => setShowFavorites\(false\)\} onLogged=\{favoriteLogged\} visible=\{showFavorites\} \/>/);
  assert.match(scan, /<ScanFavoritesButton onPress=\{openFavorites\} \/>/);
  assert.match(scanFavorites, /<FavoriteLogSheet\s+date=\{plannedMealDate\}\s+defaultSlot=\{plannedMealType \?\? mealTypeForTime\(\)\}\s+fixedSlot=\{plannedMealType\}/);
  assert.match(scanFavorites, /t\.favorites\.modeChip/);
  assert.match(scan, /&& !showFavorites\n/, 'the camera pauses behind the sheet');
  const sheet = read('src/components/FavoriteLogSheet.tsx');
  assert.match(sheet, /const target = fixedSlot \?\? slot;/); assert.match(sheet, /logRepeatMeal\(picked, \{ type: target, date, portion \}\)/);
  assert.match(sheet, /FAVORITE_SEARCH_THRESHOLD = 8/); assert.match(sheet, /searchable \? \(\s*<TextInput/);
  assert.match(sheet, /\{fixedSlot \? null : \(/, 'a stated slot is used directly, no chooser');
  assert.match(sheet, /t\.favorites\.emptyText/, 'the empty list explains how to add favourites');
});

await test('Alle Favoriten: rename, remove, slot-aware logging and an explaining empty state; copy in DE and EN', async () => {
  const saved = read('src/app/saved-meals.tsx');
  for (const pattern of [/renameFavoriteMeal\(renaming\.id, renaming\.title\)/, /removeFavoriteMeal\(id\)/, /<FavoriteLogSheet/, /t\.access\.favoritesEmpty/, /t\.favorites\.nameTaken/]) assert.match(saved, pattern);
  const { de } = load('src/i18n/de.ts');
  const en = load('src/i18n/en.ts', { '@/i18n/de': { de } }).en;
  assert.equal(de.favorites.add, 'Zu Favoriten hinzufügen'); assert.equal(de.favorites.toastAdded, 'Zu Favoriten hinzugefügt');
  assert.equal(de.favorites.logAs('Abendessen'), 'Als Abendessen eintragen');
  assert.equal(en.favorites.logAs('Dinner'), 'Log as dinner');
  assert.deepEqual(Object.keys(en.favorites).sort(), Object.keys(de.favorites).sort());
  assert.match(de.access.favoritesEmpty, /Zu Favoriten hinzufügen/);
});

await test('meal_favorites migration: owner RLS, anon revoked, FK cascade, validated items, max 100 (not applied here)', () => {
  const name = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).find((file) => file.endsWith('_meal_favorites.sql'));
  assert.ok(name, 'migration file');
  const sql = read('supabase/migrations/' + name);
  assert.match(sql, /create table public\.meal_favorites \(\s*user_id uuid not null references auth\.users \(id\) on delete cascade/);
  assert.match(sql, /alter table public\.meal_favorites enable row level security/);
  assert.match(sql, /revoke all on table public\.meal_favorites from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.meal_favorites to authenticated/);
  for (const action of ['select', 'insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`create policy meal_favorites_${action}_own on public\\.meal_favorites\\s+for ${action} to authenticated\\s+(using|with check) \\(\\(select auth\\.uid\\(\\)\\) is not null and \\(select auth\\.uid\\(\\)\\) = user_id\\)`));
  }
  assert.match(sql, /jsonb_typeof\(items\) = 'array'\s+and jsonb_array_length\(items\) between 1 and 40/);
  assert.match(sql, />= 100 then\s+raise exception 'meal_favorite_limit_reached'/);
  assert.match(sql, /language plpgsql security definer set search_path = ''/);
  assert.match(sql, /revoke all on function private\.validate_meal_favorite\(\) from public, anon, authenticated/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /to (anon|public)\b/i);
  const service = read('src/services/favoriteMeals.ts');
  assert.doesNotMatch(service, /service_role|SERVICE_ROLE/);
});

console.log(JSON.stringify({ passed, scope: 'Real repeat helpers, favourites store (synthetic storage + Supabase), AppContext.logRepeatMeal, screen wiring and migration text; no network, no rendered UI' }));
