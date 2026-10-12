// Execute the real services, account card and guarded switch with deterministic
// native/Auth boundaries. No Apple sheet, production account or network request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
const root = process.env.KANDRO_APPLE_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function compile(name, mocks) {
  const js = ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => { if (!(id in mocks)) throw Error(`Unmocked boundary: ${id}`); return mocks[id]; }, module, module.exports);
  return module.exports;
}
const dict = compile('src/i18n/en.ts', {}).en;
const results = [];
async function test(name, action) { try { await action(); results.push({ name, passed: true }); } catch (e) { results.push({ name, passed: false, error: e.message }); } }
const ticks = async () => { for (let n = 0; n < 32; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const appleIdentity = { provider: 'apple', identity_id: 'identity-uuid', id: 'apple-subject', identity_data: { sub: 'apple-subject' } };
const user = (fields = {}) => ({ id: 'same-account', is_anonymous: false, email: 'tester@example.invalid', identities: [{ provider: 'email' }], ...fields });
const credential = { token: 'synthetic-id-token', nonce: 'synthetic-raw-nonce', authorizationCode: 'synthetic-authorization-code', appleUserId: 'apple-subject' };
function recoveryStore() {
  const values = new Map(); const operations = []; const faults = { write: false };
  const storage = { async getItem(key) { return values.get(key) ?? null; }, async setItem(key, value) { if (faults.write) throw Error('local storage unavailable'); operations.push(['set', key]); values.set(key, value); }, async removeItem(key) { operations.push(['remove', key]); values.delete(key); }, async multiRemove(keys) { for (const key of keys) await storage.removeItem(key); } };
  return { values, operations, faults, storage, service: compile('src/services/appleReauthentication.ts', { '@react-native-async-storage/async-storage': storage }) };
}
function serviceFixture(initial = user()) {
  const store = recoveryStore();
  const f = { store, user: initial, sessionUser: initial, reads: 0, tokens: [], signOuts: [], links: [], signIns: [], remembered: [], sheet: [], nonceCalls: [], nativeResult: { identityToken: credential.token, authorizationCode: credential.authorizationCode, user: credential.appleUserId } };
  const api = { auth: {
    async getUser() { f.reads++; if (f.links.length && f.postLinkReadError) return { data: { user: null }, error: f.postLinkReadError }; return { data: { user: f.user }, error: null }; },
    async linkIdentity(input) { f.links.push(input); if (f.linkPending) await f.linkPending.promise; if (f.linkError) { if (f.racedUser) f.user = f.racedUser; return { data: { user: null }, error: f.linkError }; } f.user = f.linkResult ?? { ...f.user, is_anonymous: false, identities: [...(f.user.identities ?? []), appleIdentity] }; f.sessionUser = f.user; return { data: { user: f.linkResponse ?? f.user }, error: null }; },
    async signInWithIdToken(input) { f.signIns.push(input); return { data: { user: f.signInResult ?? f.user }, error: f.signInError ?? null }; },
    async signOut(input) { f.signOuts.push(input); f.sessionUser = null; return { error: null }; },
    async getSession() { return { data: { session: f.sessionUser ? { user: f.sessionUser } : null }, error: null }; },
    async signInWithPassword() { if (f.emailPending) await f.emailPending.promise; f.sessionUser = f.user = user({ id: 'email-B' }); return { data: { user: f.user }, error: null }; },
  }, functions: { async invoke(name, input) { f.tokens.push({ name, ...input }); return { data: f.tokenResult ?? { stored: true }, error: f.tokenError ?? null }; } } };
  f.api = api;
  f.service = compile('src/services/accountLinking.ts', {
    '@/i18n/active': { getDictionary: () => dict },
    '@/services/appleReauthentication': store.service,
    '@/services/supabaseClient': { supabase: api, isSupabaseConfigured: true, ensureSupabaseUser: async () => f.user, isCloudSyncDisabledAfterDeletion: async () => false, rememberSupabaseUser: u => f.remembered.push(u?.id ?? null) },
    'expo-apple-authentication': { AppleAuthenticationScope: { EMAIL: 0 }, async signInAsync(input) { f.sheet.push(input); if (f.nativeError) throw f.nativeError; return f.nativeResult; } },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'sha256' }, randomUUID: () => credential.nonce, async digestStringAsync(algorithm, value) { f.nonceCalls.push([algorithm, value]); return 'hashed-nonce'; } },
  });
  return f;
}
await test('The native build gate is enabled and the Build 37 permission fix is retained', () => {
  const app = JSON.parse(read('app.json')).expo;
  assert.equal(app.ios.usesAppleSignIn, true);
  assert.ok(app.plugins.includes('expo-apple-authentication'));
  for (const key of ['NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription']) assert.ok(app.ios.infoPlist[key]);
});
await test('Apple linkage is read from verified identities, with or without an email', async () => {
  for (const email of ['relay@privaterelay.appleid.com', null]) {
    const f = serviceFixture(user({ email, identities: [appleIdentity] }));
    const state = await f.service.getAccountLinkState();
    assert.equal(state.status, 'linked'); assert.equal(state.appleLinked, true); assert.equal(state.email, email);
  }
  const f = serviceFixture(user({ user_metadata: { provider: 'apple' } }));
  assert.equal((await f.service.getAccountLinkState()).appleLinked, false);
});
await test('Guest and existing email accounts link Apple under the same account ID, without sign-in', async () => {
  for (const anonymous of [true, false]) {
    const f = serviceFixture(user({ is_anonymous: anonymous }));
    const state = await f.service.linkAppleAccount(credential);
    assert.equal(state.userId, 'same-account'); assert.equal(state.appleLinked, true);
    assert.deepEqual(f.links, [{ provider: 'apple', token: credential.token, nonce: credential.nonce }]); assert.equal(f.signIns.length, 0);
    assert.ok(f.remembered.every(id => id === 'same-account'));
  }
});
await test('An existing Apple identity cannot be linked again, including a raced identical identity', async () => {
  const existing = user({ identities: [appleIdentity] });
  const f = serviceFixture(existing);
  assert.equal((await f.service.linkAppleAccount(credential)).appleLinked, true); assert.equal(f.links.length, 0);
  const race = serviceFixture(); race.linkError = { code: 'identity_already_exists' }; race.racedUser = existing;
  assert.equal((await race.service.linkAppleAccount(credential)).appleLinked, true); assert.equal(race.signIns.length, 0);
});
await test('A successful native link with a stale identities list is verified again before token exchange', async () => {
  for (const anonymous of [true, false]) {
    const f = serviceFixture(user({ is_anonymous: anonymous }));
    f.linkResponse = user({ is_anonymous: anonymous, identities: [] });
    const state = await f.service.linkAppleAccount(credential);
    assert.equal(state.userId, 'same-account'); assert.equal(state.appleLinked, true);
    assert.equal(f.links.length, 1); assert.equal(f.reads, 2); assert.equal(f.tokens.length, 1);
    assert.equal(await f.store.service.loadAppleTokenPending(), null);
  }
});
await test('Failed post-link verification retains a retry marker and never exchanges or accepts another account', async () => {
  const f = serviceFixture(); f.linkResponse = user({ identities: [] }); f.postLinkReadError = new Error('offline');
  await assert.rejects(f.service.linkAppleAccount(credential), e => e.message === dict.account.appleTokenRetry);
  assert.equal(f.tokens.length, 0); assert.equal((await f.store.service.loadAppleTokenPending()).userId, 'same-account');
  f.postLinkReadError = null;
  await f.service.linkAppleAccount(credential);
  assert.equal(f.links.length, 1); assert.equal(f.tokens.length, 1); assert.equal(await f.store.service.loadAppleTokenPending(), null);
  const switched = serviceFixture(); switched.linkResponse = user({ identities: [] }); switched.linkResult = user({ id: 'other', identities: [appleIdentity] });
  await assert.rejects(switched.service.linkAppleAccount(credential));
  assert.equal(switched.tokens.length, 0); assert.ok(!switched.remembered.includes('other'));
});
await test('Installed Supabase SDK completes stale native-link response, verified readback and authenticated function call', async () => {
  const guest = user({ is_anonymous: true, email: null, identities: [] });
  const linked = user({ identities: [appleIdentity] });
  const f = serviceFixture(guest); const requests = []; let didLink = false;
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: guest.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.c3ludGhldGlj';
  const session = account => ({ access_token: jwt, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user: account });
  const client = createClient('https://kandro-sdk-test.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options = {}) => {
      const address = new URL(String(url)); assert.equal(address.hostname, 'kandro-sdk-test.invalid');
      requests.push(address.pathname);
      let body;
      if (address.pathname === '/auth/v1/signup') body = session(guest);
      else if (address.pathname === '/auth/v1/user') body = didLink ? linked : guest;
      else if (address.pathname === '/auth/v1/token') {
        assert.equal(JSON.parse(options.body).link_identity, true); didLink = true;
        body = session({ ...linked, identities: [] });
      } else if (address.pathname === '/functions/v1/apple-account-token') {
        assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer ' + jwt);
        assert.deepEqual(JSON.parse(options.body), { authorizationCode: credential.authorizationCode, nonce: credential.nonce });
        body = { stored: true };
      } else throw Error('Unexpected SDK request');
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  await client.auth.signInAnonymously();
  f.api.auth = client.auth; f.api.functions = client.functions;
  const result = await f.service.linkAppleAccount(credential);
  assert.equal(result.userId, guest.id); assert.equal(result.appleLinked, true);
  assert.equal(requests.filter(p => p === '/auth/v1/token').length, 1);
  assert.equal(requests.filter(p => p === '/auth/v1/user').length, 2);
  assert.equal(requests.filter(p => p === '/functions/v1/apple-account-token').length, 1);
  assert.equal(await f.store.service.loadAppleTokenPending(), null);
});
await test('A wrong account ID, unverified linked result or identity owned elsewhere is rejected', async () => {
  const wrong = serviceFixture(); wrong.linkResult = user({ id: 'different', identities: [appleIdentity] });
  await assert.rejects(wrong.service.linkAppleAccount(credential)); assert.ok(!wrong.remembered.includes('different'));
  const incomplete = serviceFixture(); incomplete.linkResult = user(); await assert.rejects(incomplete.service.linkAppleAccount(credential));
  const other = serviceFixture(); other.linkError = { code: 'identity_already_exists' }; await assert.rejects(other.service.linkAppleAccount(credential));
  assert.equal(other.user.id, 'same-account'); assert.equal(other.signIns.length, 0);
});
await test('Native nonce is hashed for Apple and kept raw for Supabase; missing tokens and cancellation fail safely', async () => {
  const f = serviceFixture(); assert.deepEqual(await f.service.appleCredential(), credential);
  assert.deepEqual(f.sheet[0], { requestedScopes: [0], nonce: 'hashed-nonce' }); assert.deepEqual(f.nonceCalls, [['sha256', credential.nonce]]);
  for (const missing of ['identityToken', 'authorizationCode', 'user']) { f.nativeResult = { identityToken: credential.token, authorizationCode: credential.authorizationCode, user: credential.appleUserId }; delete f.nativeResult[missing]; await assert.rejects(f.service.appleCredential()); }
  f.nativeError = { code: 'ERR_REQUEST_CANCELED' }; await assert.rejects(f.service.appleCredential(), e => f.service.isAppleCancel(e));
  assert.equal(f.links.length + f.signIns.length, 0);
});

function hooks() {
  const slots = []; let cursor = 0, effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    useState(value) { const n = cursor++; slots[n] ??= { value }; return [slots[n].value, next => { slots[n].value = typeof next === 'function' ? next(slots[n].value) : next; }]; },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useEffect(fn, deps) { const n = cursor++; if (!same(slots[n]?.deps, deps)) { slots[n]?.cleanup?.(); slots[n] = { deps }; effects.push(() => { slots[n].cleanup = fn(); }); } },
    render(render) { cursor = 0; const tree = render(); const queue = effects; effects = []; queue.forEach(fn => fn()); return tree; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(Array.isArray(tree.props?.children) ? tree.props.children : [tree.props?.children]).flatMap(child => Array.isArray(child) ? child.flatMap(nodes) : nodes(child))];
function cardModule() {
  let active;
  const jsx = (type, props) => ({ type, props });
  const boundary = serviceFixture().service;
  const live = name => (...args) => active[name](...args);
  const Component = compile('src/components/AccountLinkCard.tsx', {
    react: { useState: (...args) => active.h.useState(...args), useRef: (...args) => active.h.useRef(...args), useEffect: (...args) => active.h.useEffect(...args) },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ActivityIndicator: 'Spinner', Alert: { alert: (...args) => active.alerts.push(args) }, Pressable: 'Pressable', StyleSheet: { create: x => x }, Text: 'Text', TextInput: 'TextInput', View: 'View' },
    'expo-constants': { expoConfig: { ios: { usesAppleSignIn: true } } },
    'expo-apple-authentication': { isAvailableAsync: async () => active.available, AppleAuthenticationButton: 'AppleButton', AppleAuthenticationButtonType: { SIGN_IN: 'sign-in', CONTINUE: 'continue' }, AppleAuthenticationButtonStyle: { BLACK: 'black' } },
    '@expo/vector-icons/Ionicons': 'Icon', '@/components/ui': { Card: 'Card', PrimaryButton: 'Primary' }, '@/constants/theme': { radii: {} },
    '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: dict, language: 'en' }) },
    '@/context/AppContext': { useApp: () => ({ loadAppleAccount: live('loadApple'), loadExistingAccount: async () => { throw Error('unexpected email switch'); }, refreshCloudState: live('refresh'), userName: 'Tester' }) },
    '@/services/accountLinking': { getAccountLinkState: async () => active.account, appleCredential: live('credential'), linkAppleAccount: live('link'), isAppleCancel: boundary.isAppleCancel, isAppleIdentityTaken: boundary.isAppleIdentityTaken, accountLinkErrorMessage: boundary.accountLinkErrorMessage, requestEmailLink: live('emailLink'), setAccountPassword: live('password'), enableNewCloudAccount: async () => { throw Error('unexpected enable'); }, resendEmailLink: async () => {}, verifyEmailLink: async () => { throw Error('unexpected verify'); } },
  }).AccountLinkCard;
  return (account = { status: 'linked', userId: 'same-account', email: 'tester@example.invalid', appleLinked: false }) => {
    const f = { h: hooks(), account, available: true, alerts: [], calls: [],
      async credential() { f.calls.push('credential'); if (f.credentialError) throw f.credentialError; if (f.pending) return f.pending.promise; return credential; },
      async link() { f.calls.push('link'); if (f.linkError) throw f.linkError; return { status: 'linked', userId: 'same-account', email: 'tester@example.invalid', appleLinked: true }; },
      async loadApple() { f.calls.push('load'); return { status: 'linked', userId: 'other', email: null, appleLinked: true }; },
      async refresh() { f.calls.push('refresh'); if (f.refreshError) throw f.refreshError; }, async emailLink() { f.calls.push('email'); return f.account; }, async password() { f.calls.push('password'); return f.account; },
    };
    f.render = () => { active = f; return f.h.render(Component); };
    f.activate = () => { active = f; };
    f.ready = async () => { f.render(); await ticks(); return f.render(); };
    return f;
  };
}
const apple = tree => nodes(tree).find(n => n.type === 'AppleButton');
await test('Native button appears for guests and linked email accounts, not Apple-linked or unsupported accounts', async () => {
  const make = cardModule();
  for (const account of [{ status: 'anonymous', userId: 'same-account' }, { status: 'linked', userId: 'same-account', email: 'a@example.invalid', appleLinked: false }]) assert.ok(apple(await make(account).ready()));
  const linked = make({ status: 'linked', userId: 'same-account', email: null, appleLinked: true });
  const tree = await linked.ready(); assert.equal(apple(tree), undefined); assert.ok(nodes(tree).some(n => n.props?.children === dict.account.appleConnected));
  assert.ok(!nodes(tree).some(n => n.props?.children === dict.account.setPassword));
  const unavailable = make(); unavailable.available = false; assert.equal(apple(await unavailable.ready()), undefined);
});
await test('Duplicate taps and another mounted card cannot start concurrent Apple or email actions', async () => {
  const make = cardModule(), a = make(), b = make({ status: 'anonymous', userId: 'same-account' });
  const aTree = await a.ready(), bTree = await b.ready(); a.pending = deferred();
  a.activate(); apple(aTree).props.onPress(); apple(aTree).props.onPress();
  b.activate(); apple(bTree).props.onPress(); nodes(bTree).find(n => n.type === 'Primary').props.onPress();
  assert.deepEqual(a.calls, ['credential']); assert.deepEqual(b.calls, []);
  assert.equal(apple(a.render()).props.accessibilityState.disabled, true);
  a.activate(); a.pending.resolve(credential); await ticks();
  assert.deepEqual(a.calls, ['credential', 'link', 'refresh']); assert.equal(apple(a.render()), undefined);
});
await test('An already linked account can repair a missing token marker without switching accounts', async () => {
  const f = cardModule()({ status: 'linked', userId: 'same-account', email: null, appleLinked: true });
  const renew = nodes(await f.ready()).find(n => n.type === 'Pressable' && nodes(n).some(c => c.props?.children === dict.account.appleRecoveryTitle));
  assert.ok(renew); renew.props.onPress(); renew.props.onPress(); await ticks();
  assert.deepEqual(f.calls, ['credential', 'link', 'refresh']);
  const feedback = nodes(f.render()).find(n => n.type?.name === 'Feedback');
  assert.equal(feedback.props.error, null); assert.equal(feedback.props.message, dict.account.appleLinked);
});
await test('A post-link cloud-sync error is distinguished from linking failure and clears on a successful retry', async () => {
  const f = cardModule()(); f.refreshError = { message: 'private database error' };
  apple(await f.ready()).props.onPress(); await ticks();
  let tree = f.render(); let feedback = nodes(tree).find(n => n.type?.name === 'Feedback');
  assert.equal(feedback.props.error, dict.account.appleSyncRetry); assert.notEqual(feedback.props.error, dict.errors.linkingFailed);
  assert.ok(nodes(tree).some(n => n.props?.children === dict.account.appleConnected));
  f.refreshError = null;
  nodes(tree).find(n => n.type === 'Pressable' && nodes(n).some(c => c.props?.children === dict.account.appleRecoveryTitle)).props.onPress(); await ticks();
  feedback = nodes(f.render()).find(n => n.type?.name === 'Feedback');
  assert.equal(feedback.props.error, null); assert.equal(feedback.props.message, dict.account.appleLinked);
});
await test('Apple cancellation and link errors retain the current card and never load another account', async () => {
  for (const cancel of [true, false]) {
    const f = cardModule()(); if (cancel) f.credentialError = { code: 'ERR_REQUEST_CANCELED' }; else f.linkError = new Error('Network unavailable');
    apple(await f.ready()).props.onPress(); await ticks(); const tree = f.render();
    assert.ok(apple(tree)); assert.ok(!f.calls.includes('load')); assert.ok(!f.calls.includes('refresh'));
    assert.equal(apple(tree).props.accessibilityState.disabled, false);
    const feedback = nodes(tree).find(n => n.type?.name === 'Feedback'); assert.equal(Boolean(feedback.props.error), !cancel);
  }
});
await test('A collision never loads the other account before explicit destructive confirmation', async () => {
  const f = cardModule()(); f.linkError = { code: 'identity_already_exists' };
  apple(await f.ready()).props.onPress(); await ticks(); assert.equal(f.alerts.length, 1); assert.ok(!f.calls.includes('load'));
  assert.equal(f.alerts[0][1], dict.account.appleTakenBody);
  const buttons = f.alerts[0][2]; assert.ok(buttons.some(x => x.style === 'cancel'));
  buttons.find(x => x.text === dict.account.replaceAction).onPress(); await ticks(); assert.equal(f.calls.filter(x => x === 'load').length, 1);
});
await test('Direct existing-account Apple login also requires replacement confirmation', async () => {
  const f = cardModule()({ status: 'anonymous', userId: 'same-account' }); const first = await f.ready();
  const mode = nodes(first).find(n => n.type === 'Pressable' && nodes(n).some(c => c.props?.children === dict.account.signInTitle)); mode.props.onPress();
  apple(f.render()).props.onPress(); assert.deepEqual(f.calls, []); assert.equal(f.alerts[0][1], dict.account.replaceText);
  f.alerts[0][2].find(x => x.text === dict.account.replaceAction).onPress(); await ticks(); assert.ok(f.calls.includes('load'));
});
await test('Leaving the card during the native sheet prevents a late credential from linking', async () => {
  const f = cardModule()(); f.pending = deferred(); apple(await f.ready()).props.onPress(); f.h.unmount(); f.pending.resolve(credential); await ticks(); assert.deepEqual(f.calls, ['credential']);
});

// Execute the actual useCallback body so a rejected SDK subscriber after its
// session write cannot be mistaken for an untouched identity.
function switchFixture(destination, unreadable = false) {
  const raw = read('src/context/AppContext.tsx');
  const block = raw.slice(raw.indexOf('const switchAccount = useCallback'), raw.indexOf('const loadExistingAccount = useCallback'));
  const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const events = []; let reads = 0;
  const names = { useCallback: fn => fn, getCurrentSessionUserId: async () => { if (++reads === 1) return 'A'; if (unreadable) throw Error('session unavailable'); return destination; }, getDictionary: () => dict,
    analysisGenerationRef: { current: 0 }, analysisIdentityGenerationRef: { current: 0 }, photoUriRef: { current: null }, scanModeRef: { current: 'demo' }, DEFAULT_PROFILE: {}, DEFAULT_TARGETS: {},
    loadAppleTokenPending: async () => null, rememberSupabaseUser: () => {}, selectAppleRecoveryReference: recoveryStore().service.selectAppleRecoveryReference, setAppleReauthenticationRequired: value => events.push(['apple-recovery', value]), beginLocalAccountSwitch: async id => { events.push(['marker', id]); }, clearTelemetryForAccountSwitch: async () => {}, completeLocalAccountSwitch: async () => { events.push(['clear-marker']); }, restoreLocalStateAfterFailedLogin: async () => { events.push(['restore-old']); }, retryAccountRecovery: async () => {},
  };
  for (const name of ['setHydrationReady', 'setWellnessConsentGranted', 'setSyncMode']) names[name] = value => events.push([name, value]);
  const action = new Function(...Object.keys(names), `${js};return switchAccount;`)(...Object.values(names));
  return { events, run: () => action(async () => { events.push(['sdk-session-written', destination]); throw Error('subscriber rejected after session write'); }) };
}
await test('Rejected sign-in with a changed, missing or unreadable session retains recovery and keeps old data hidden', async () => {
  for (const [destination, unreadable] of [['B', false], [null, false], ['B', true]]) {
    const f = switchFixture(destination, unreadable); await assert.rejects(f.run());
    assert.ok(!f.events.some(e => ['clear-marker', 'restore-old'].includes(e[0])));
    assert.deepEqual(f.events.filter(e => e[0] === 'setHydrationReady').at(-1), ['setHydrationReady', false]);
    assert.ok(f.events.some(e => e[0] === 'setSyncMode' && e[1] === 'error'));
  }
});
await test('A failed sign-in proven to keep the same session restores the existing local state', async () => {
  const f = switchFixture('A'); await assert.rejects(f.run());
  assert.ok(f.events.some(e => e[0] === 'restore-old'));
  assert.deepEqual(f.events.filter(e => e[0] === 'setHydrationReady').at(-1), ['setHydrationReady', true]);
});

await test('The single-use code goes only to the authenticated token endpoint, with raw nonce and no token/ID body', async () => {
  const f = serviceFixture(); await f.service.linkAppleAccount(credential);
  assert.deepEqual(f.tokens, [{ name: 'apple-account-token', body: { authorizationCode: credential.authorizationCode, nonce: credential.nonce } }]);
  assert.equal(await f.store.service.loadAppleTokenPending(), null);
  assert.ok([...f.store.values.values()].every(value => !value.includes(credential.token) && !value.includes(credential.authorizationCode) && !value.includes(credential.nonce)));
});
await test('Token-storage failures retain the successful same-ID link and require a fresh native retry', async () => {
  for (const failure of ['network', 'unconfirmed']) {
    const f = serviceFixture(); if (failure === 'network') f.tokenError = Error(credential.authorizationCode); else f.tokenResult = { stored: false };
    await assert.rejects(f.service.linkAppleAccount(credential), e => e.message === dict.account.appleTokenRetry && !e.message.includes(credential.authorizationCode));
    const state = await f.service.getAccountLinkState(); assert.equal(state.userId, 'same-account'); assert.equal(state.appleLinked, true); assert.equal(state.appleTokenPending, true);
    assert.deepEqual(await f.store.service.loadAppleTokenPending(), { userId: 'same-account', appleUserId: 'apple-subject' });
    const pendingTree = await cardModule()(state).ready(); assert.ok(apple(pendingTree));
    f.tokenError = null; f.tokenResult = { stored: true }; await f.service.linkAppleAccount({ ...credential, authorizationCode: 'fresh-code' });
    assert.equal(f.links.length, 1); assert.equal((await f.service.getAccountLinkState()).appleTokenPending, false);
  }
});
await test('Revoked Apple recovery rejects another Apple identity before Auth and another Supabase ID after Auth', async () => {
  const f = serviceFixture(user({ identities: [appleIdentity] }));
  await f.store.service.requireAppleReauthentication({ userId: 'same-account', appleUserId: 'apple-subject' });
  await assert.rejects(f.service.recoverAppleSession({ ...credential, appleUserId: 'other-apple' })); assert.equal(f.signIns.length, 0);
  f.signInResult = user({ id: 'different-account', identities: [appleIdentity] }); await assert.rejects(f.service.recoverAppleSession(credential));
  assert.deepEqual(f.signOuts, [{ scope: 'local' }]); assert.equal(f.tokens.length, 0); assert.equal((await f.store.service.loadAppleReauthentication()).userId, 'same-account');
  f.signInResult = user({ identities: [appleIdentity] }); const account = await f.service.recoverAppleSession(credential);
  assert.equal(account.userId, 'same-account'); assert.equal(f.tokens.length, 1);
  // UI recovery clears this only after local data restoration also succeeds.
  assert.equal((await f.store.service.loadAppleReauthentication()).userId, 'same-account');
});
await test('Recovery network failure never changes its expected account or clears its durable lock', async () => {
  const f = serviceFixture(user({ identities: [appleIdentity] })); await f.store.service.requireAppleReauthentication({ userId: 'same-account', appleUserId: 'apple-subject' });
  f.signInError = Error('offline'); await assert.rejects(f.service.recoverAppleSession(credential));
  assert.equal((await f.store.service.loadAppleReauthentication()).userId, 'same-account'); assert.equal(f.tokens.length, 0); assert.deepEqual(f.remembered, []);
});
function monitorFixture() {
  const store = recoveryStore(); const f = { store, generation: 1, identity: { userId: 'same-account', appleUserId: 'apple-subject' }, state: 'revoked', reads: 0, locks: [] };
  f.monitor = store.service.createAppleCredentialMonitor({ generation: () => f.generation, readIdentity: async () => f.identity,
    readCredentialState: async () => { f.reads++; if (f.nativeError) throw f.nativeError; return f.pending ? f.pending.promise : f.state; },
    onRevoked: async identity => { f.locks.push(identity); await store.service.requireAppleReauthentication(identity); },
  }); return f;
}
await test('Repeated native events coalesce and only definitive REVOKED/NOT_FOUND lock the original account', async () => {
  for (const state of ['revoked', 'not-found']) {
    const f = monitorFixture(); f.state = state; f.pending = deferred();
    const checks = [f.monitor.check(), f.monitor.check(), f.monitor.check()]; await ticks(); assert.equal(f.reads, 1);
    f.pending.resolve(state); await Promise.all(checks); await f.monitor.check(); assert.equal(f.locks.length, 1); assert.equal(f.locks[0].userId, 'same-account');
    f.monitor.reset(); await f.monitor.check(); assert.equal(f.locks.length, 2);
  }
  for (const state of ['authorized', 'transferred', 'unavailable', 'network', 'simulator']) {
    const f = monitorFixture(); f.state = state; if (['network', 'simulator'].includes(state)) f.nativeError = Error(state);
    await f.monitor.check(); assert.deepEqual(f.locks, []); assert.equal(await f.store.service.loadAppleReauthentication(), null);
  }
});
await test('Late revoke checks cannot sign out a newly switched identity or survive monitor disposal', async () => {
  for (const change of ['identity', 'generation', 'unmount']) {
    const f = monitorFixture(); f.pending = deferred(); const checking = f.monitor.check(); await ticks();
    if (change === 'identity') f.identity = { userId: 'other-account', appleUserId: 'other-apple' };
    if (change === 'generation') f.generation++;
    if (change === 'unmount') f.monitor.stop();
    f.pending.resolve('revoked'); await checking; assert.deepEqual(f.locks, []);
  }
});
function clientFixture(store) {
  const f = { anonymous: 0, current: { user: user({ identities: [appleIdentity] }), access_token: 'synthetic-access' } };
  const api = { auth: { async getSession() { return { data: { session: f.current }, error: null }; }, async signInAnonymously() { f.anonymous++; return { data: { user: user({ is_anonymous: true }) }, error: null }; } } };
  const saved = { url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fixture.invalid'; process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'synthetic-publishable';
  try { f.service = compile('src/services/supabaseClient.ts', { '@react-native-async-storage/async-storage': store.storage, '@supabase/supabase-js': { createClient: () => api }, 'react-native': { AppState: {}, Platform: { OS: 'ios' } }, 'react-native-url-polyfill/auto': {}, '@/services/appleReauthentication': store.service }); }
  finally { if (saved.url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL; else process.env.EXPO_PUBLIC_SUPABASE_URL = saved.url; if (saved.key === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key; }
  return f;
}
await test('A persistent revoke lock defeats cached sessions and cold-start guest creation', async () => {
  const store = recoveryStore(), f = clientFixture(store); assert.equal((await f.service.ensureSupabaseUser()).id, 'same-account');
  await store.service.requireAppleReauthentication({ userId: 'same-account', appleUserId: 'apple-subject' });
  assert.equal(await f.service.ensureSupabaseUser(), null); assert.equal(await f.service.getAccessSession(), null);
  const freshStore = compile('src/services/appleReauthentication.ts', { '@react-native-async-storage/async-storage': store.storage });
  const cold = clientFixture({ ...store, service: freshStore }); cold.current = null;
  assert.equal(await cold.service.ensureSupabaseUser(), null); assert.equal(await cold.service.getAccessSession(), null); assert.equal(cold.anonymous, 0);
});
await test('Confirmed deletion clears Apple markers; failed deletion retains them and all local data', async () => {
  for (const failed of [true, false]) {
    const store = recoveryStore(); const reference = { userId: 'same-account', appleUserId: 'apple-subject' };
    await store.service.requireAppleReauthentication(reference); await store.service.markAppleTokenPending(reference);
    const calls = [];
    const service = compile('src/services/accountDeletion.ts', {
      '@/i18n/active': { getDictionary: () => dict }, '@/services/appleReauthentication': store.service,
      '@/services/localRepository': { invalidatePrivateData: async () => {}, clearLocalKandroData: async () => calls.push('clear-data') },
      '@/services/consent': { clearLocalWellnessConsent: async () => calls.push('clear-consent') },
      '@/services/reminders': { clearRemindersAfterAccountDeletion: async () => {} }, '@/services/telemetry': { clearTelemetryAfterAccountDeletion: async () => {} },
      '@/services/subscription': { clearSubscriptionIdentityAfterAccountDeletion: async () => {} }, '@/services/revenueCatExperimentAnalytics': { clearRevenueCatExperimentMeasurementForAccountDeletion: async () => {} },
      '@/services/supabaseClient': { isSupabaseConfigured: true, disableCloudSyncAfterDeletion: async () => calls.push('disable-cloud'), rememberSupabaseUser: () => {}, supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'same-account' } } } }), signOut: async () => calls.push('sign-out') }, functions: { invoke: async () => ({ data: { deleted: true, appleRevocation: 'manual_required' }, error: failed ? Error('offline') : null }) } } },
    });
    if (failed) { await assert.rejects(service.deleteKandroAccount()); assert.equal((await store.service.loadAppleReauthentication()).userId, 'same-account'); assert.equal((await store.service.loadAppleTokenPending()).userId, 'same-account'); assert.deepEqual(calls, []); }
    else { assert.equal((await service.deleteKandroAccount()).appleRevocation, 'manual_required'); assert.equal(await store.service.loadAppleReauthentication(), null); assert.equal(await store.service.loadAppleTokenPending(), null); assert.ok(calls.includes('clear-data')); }
  }
});

await test('A failed pending-marker write still exposes a repairable Apple retry without leaking the code', async () => {
  const f = serviceFixture(); f.store.faults.write = true;
  await assert.rejects(f.service.linkAppleAccount(credential), e => e.message === dict.account.appleTokenRetry);
  assert.equal((await f.service.getAccountLinkState()).appleTokenPending, true); assert.equal(f.tokens.length, 0);
  f.store.faults.write = false; await f.service.linkAppleAccount(credential); assert.equal(f.links.length, 1); assert.equal((await f.service.getAccountLinkState()).appleTokenPending, false);
});
function actualRecoveryFixture({ previous = null, current = null, pending = false, revoked = true } = {}) {
  const f = serviceFixture(user({ identities: [appleIdentity] })); const events = [];
  f.previous = previous; f.current = current; f.events = events;
  f.initialize = async () => { const reference = { userId: 'same-account', appleUserId: 'apple-subject' }; if (revoked) await f.store.service.requireAppleReauthentication(reference); if (pending) await f.store.service.markAppleTokenPending(reference); };
  const raw = read('src/context/AppContext.tsx');
  const block = raw.slice(raw.indexOf('const retryAccountRecovery = useCallback'), raw.indexOf('const switchAccount = useCallback'));
  const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const names = {
    useCallback: fn => fn, analysisGenerationRef: { current: 0 }, analysisIdentityGenerationRef: { current: 0 }, DEFAULT_PROFILE: {}, DEFAULT_TARGETS: {}, getDictionary: () => dict,
    loadLocalAccountSwitch: async () => f.previous ? { previousUserId: f.previous } : null, getCurrentSessionUserId: async () => f.current,
    loadAppleReauthentication: f.store.service.loadAppleReauthentication, loadAppleTokenPending: f.store.service.loadAppleTokenPending,
    selectAppleRecoveryReference: f.store.service.selectAppleRecoveryReference,
    clearAppleReauthentication: f.store.service.clearAppleReauthentication, clearAppleTokenPending: f.store.service.clearAppleTokenPending,
    recoverAppleSession: f.service.recoverAppleSession, appleCredentialMonitor: { reset() { events.push('reset-monitor'); } },
    restoreLocalStateAfterFailedLogin: async () => { events.push('restore-local'); if (f.restoreError) throw f.restoreError; },
    completeLocalAccountSwitch: async () => { events.push('clear-switch'); f.previous = null; },
    clearTelemetryForAccountSwitch: async () => {}, clearLocalWellnessConsent: async () => events.push('clear-consent'), clearRemindersForAccountSwitch: async () => {},
    hydrateExistingCloudAccount: async () => { events.push('hydrate-destination'); return { userId: f.current }; },
    adoptExistingAccountState: async cloud => { events.push(['adopt-destination', cloud.userId]); },
    clearLocalKandroData: async () => events.push('erase-local'),
  };
  for (const name of ['setHydrationReady', 'setLocalStorageError', 'setWellnessConsentGranted', 'setSyncMode', 'setAppleReauthenticationRequired', 'setProfile', 'setTargets', 'setMeals', 'setMealHistory', 'setLifetimeScanCount', 'setWeightEntries', 'setPendingAnalysisCount']) names[name] = value => events.push([name, value]);
  f.retry = new Function(...Object.keys(names), `${js};return retryAccountRecovery;`)(...Object.values(names)); return f;
}
await test('Actual recovery restores the exact original account locally, including unsynced data, only after Apple/token success', async () => {
  const f = actualRecoveryFixture(); await f.initialize();
  await f.retry(credential); assert.ok(f.events.includes('restore-local')); assert.ok(!f.events.includes('hydrate-destination')); assert.ok(!f.events.includes('erase-local'));
  assert.equal(await f.store.service.loadAppleReauthentication(), null); assert.equal(await f.store.service.loadAppleTokenPending(), null);
  assert.deepEqual(f.events.filter(e => e[0] === 'setHydrationReady').at(-1), ['setHydrationReady', true]);
  const failed = actualRecoveryFixture(); await failed.initialize(); failed.restoreError = Error('disk unavailable');
  await assert.rejects(failed.retry(credential)); assert.equal((await failed.store.service.loadAppleReauthentication()).userId, 'same-account'); assert.ok(!failed.events.includes('erase-local'));
});
await test('A destination token marker with no surviving session cannot restore the previous diary or create a guest', async () => {
  const f = actualRecoveryFixture({ previous: 'previous-account', current: null, pending: true, revoked: false }); await f.initialize();
  await assert.rejects(f.retry()); assert.ok(!f.events.includes('restore-local')); assert.ok(!f.events.includes('clear-switch')); assert.ok(!f.events.includes('erase-local'));
  assert.equal((await f.store.service.loadAppleTokenPending()).userId, 'same-account');
  const client = clientFixture(f.store); client.current = null; assert.equal(await client.service.ensureSupabaseUser(), null); assert.equal(client.anonymous, 0);
  f.current = 'same-account'; await f.retry(credential); assert.ok(f.events.includes('hydrate-destination')); assert.ok(!f.events.includes('restore-local'));
});
await test('An old A token marker cannot force A recovery after an intentional email-account switch to B', async () => {
  const f = actualRecoveryFixture({ previous: 'same-account', current: 'confirmed-email-B', pending: true, revoked: false }); await f.initialize();
  await f.retry(); assert.ok(f.events.includes('hydrate-destination')); assert.ok(f.events.some(e => Array.isArray(e) && e[0] === 'adopt-destination' && e[1] === 'confirmed-email-B'));
  assert.equal(f.signIns.length, 0); assert.equal(await f.store.service.loadAppleTokenPending(), null); assert.ok(!f.events.includes('restore-local'));
});
function routeFixture() {
  const f = { h: hooks(), state: { appleReauthenticationRequired: true, hydrationReady: true, syncMode: 'cloud', profile: {}, analysisStatus: 'idle', detectedItems: [], mealHistory: [], wellnessConsentGranted: false }, calls: [], pending: null };
  const jsx = (type, props) => ({ type, props });
  const Component = compile('src/components/AppRouteGuard.tsx', {
    react: { useState: (...a) => f.h.useState(...a), useEffect: (...a) => f.h.useEffect(...a), useRef: (...a) => f.h.useRef(...a) }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { StyleSheet: { create: a => a }, Text: 'Text', View: 'View' },
    '@/constants/theme': { typeScale: {} },
    'expo-apple-authentication': { isAvailableAsync: async () => true, AppleAuthenticationButton: 'AppleButton', AppleAuthenticationButtonType: { SIGN_IN: 'sign-in' }, AppleAuthenticationButtonStyle: { BLACK: 'black' } },
    'expo-router': { usePathname: () => '/profile', useSegments: () => ['(tabs)'], useRouter: () => ({ replace: destination => f.calls.push(['redirect', destination]) }) },
    '@/components/KandroMark': { KandroMark: 'Brand' }, '@/components/ui': { PrimaryButton: 'Primary' }, '@/context/ThemeContext': { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) },
    '@/context/AccessContext': { useAccess: () => ({ ready: true, canUse: true }) }, '@/services/accessPolicy': { rememberAccessDestination() {}, routeRequiresAccess: () => true },
    '@/hooks/useReminderOnboarding': { useReminderOnboarding: () => false }, '@/hooks/useFirstRun': { useFirstRun: () => null }, '@/services/firstRun': { firstRunRedirect: () => null }, '@/context/AppContext': { useApp: () => ({ ...f.state, retryAccountRecovery: async value => f.calls.push(['retry', value]) }) },
    '@/i18n/LanguageProvider': { useLanguage: () => ({ t: dict }) }, '@/utils/mealDraftGuard': { requiresMealDraftRedirect: () => false }, '@/utils/ingredientCorrection': { canSaveMealDraft: () => true },
    '@/services/accountLinking': { appleCredential: async () => { f.calls.push(['native-sheet']); return f.pending ? f.pending.promise : credential; }, isAppleCancel: e => e?.code === 'ERR_REQUEST_CANCELED' },
  }).AppRouteGuard;
  f.render = () => f.h.render(() => Component({ children: 'PRIVATE-DIARY' })); return f;
}
await test('Apple recovery stays above stale hydration/cloud completions and its native button rejects duplicate taps', async () => {
  const f = routeFixture(); f.render(); await ticks();
  for (const syncMode of ['cloud', 'local', 'syncing', 'error']) { f.state.syncMode = syncMode; const tree = f.render(); assert.notEqual(tree, 'PRIVATE-DIARY'); assert.ok(apple(tree)); }
  assert.ok(!f.calls.some(c => c[0] === 'redirect'));
  f.pending = deferred(); const button = apple(f.render()); button.props.onPress(); button.props.onPress(); await ticks();
  assert.equal(f.calls.filter(c => c[0] === 'native-sheet').length, 1); assert.equal(f.calls.filter(c => c[0] === 'retry').length, 0);
  f.pending.resolve(credential); await ticks(); assert.equal(f.calls.filter(c => c[0] === 'retry').length, 1);
  f.state.appleReauthenticationRequired = false; assert.equal(f.render(), 'PRIVATE-DIARY');
});
await test('A deliberate deletion suppresses native revoke events and invalidates already pending checks', async () => {
  const f = monitorFixture(); f.pending = deferred(); const running = f.monitor.check(); await ticks();
  const finishDeletion = f.store.service.beginAppleAccountDeletion(); f.pending.resolve('revoked'); await running;
  await f.monitor.check(); assert.deepEqual(f.locks, []);
  await f.store.service.clearAppleAuthenticationState(); f.identity = null; finishDeletion(); await f.monitor.check(); assert.deepEqual(f.locks, []);
  // After a failed deletion, a later definitive revoke check remains possible.
  f.identity = { userId: 'same-account', appleUserId: 'apple-subject' }; f.pending = null; await f.monitor.check(); assert.equal(f.locks.length, 1);
});

function deletionForAuthFixture(f) {
  const originalInvoke = f.api.functions.invoke; f.deleteCalls = []; f.cleanup = [];
  f.api.functions.invoke = async (name, options) => {
    if (name !== 'delete-account') return originalInvoke(name, options);
    f.deleteCalls.push(f.sessionUser?.id); return { data: { deleted: true, appleRevocation: 'revoked' }, error: null };
  };
  return compile('src/services/accountDeletion.ts', {
    '@/i18n/active': { getDictionary: () => dict }, '@/services/appleReauthentication': f.store.service,
    '@/services/localRepository': { invalidatePrivateData: async () => {}, clearLocalKandroData: async () => f.cleanup.push('diary') },
    '@/services/consent': { clearLocalWellnessConsent: async () => {} }, '@/services/reminders': { clearRemindersAfterAccountDeletion: async () => {} },
    '@/services/telemetry': { clearTelemetryAfterAccountDeletion: async () => {} }, '@/services/subscription': { clearSubscriptionIdentityAfterAccountDeletion: async () => {} }, '@/services/revenueCatExperimentAnalytics': { clearRevenueCatExperimentMeasurementForAccountDeletion: async () => {} },
    '@/services/supabaseClient': { isSupabaseConfigured: true, supabase: f.api, disableCloudSyncAfterDeletion: async () => f.cleanup.push('disable-cloud'), rememberSupabaseUser: value => f.remembered.push(value?.id ?? null) },
  });
}
await test('Deletion waits for an in-flight SDK Apple write and rejects queued stale auth after cleanup', async () => {
  const f = serviceFixture(); const deletion = deletionForAuthFixture(f); f.linkPending = deferred();
  const linking = f.service.linkAppleAccount(credential); await ticks(); assert.equal(f.links.length, 1);
  const deleting = deletion.deleteKandroAccount(); await ticks(); assert.deepEqual(f.deleteCalls, []);
  const stale = f.service.linkAppleAccount(credential); const staleRejected = assert.rejects(stale, e => e.code === 'account_operation_stale');
  f.linkPending.resolve(); await linking; await deleting; await staleRejected;
  assert.deepEqual(f.deleteCalls, ['same-account']); assert.equal(f.sessionUser, null); assert.equal(f.remembered.at(-1), null);
  assert.equal(await f.store.service.loadAppleTokenPending(), null); assert.equal(await f.store.service.loadAppleReauthentication(), null); assert.deepEqual(f.cleanup, ['disable-cloud', 'diary']); assert.equal(f.links.length, 1);
});
await test('The same lock covers email login; waiting to delete A cannot accidentally delete newly signed-in B', async () => {
  const f = serviceFixture(); const deletion = deletionForAuthFixture(f); f.emailPending = deferred();
  const signingIn = f.service.signInToExistingAccount('b@example.invalid', 'synthetic-password'); await ticks();
  const deleting = deletion.deleteKandroAccount(); const rejected = assert.rejects(deleting); await ticks(); assert.deepEqual(f.deleteCalls, []);
  f.emailPending.resolve(); await signingIn; await rejected;
  assert.equal(f.sessionUser.id, 'email-B'); assert.deepEqual(f.deleteCalls, []); assert.deepEqual(f.cleanup, []);
});
console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, total: results.length, results, scope: 'Actual app service/card/account-switch logic with synthetic native/Auth boundaries; no Apple, hosted account or device claim.' }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
