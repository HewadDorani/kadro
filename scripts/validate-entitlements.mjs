import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import {
  activeIosSubscriptionFromV2,
  fetchRevenueCatEntitlement,
  isAnalysisRequestId,
  validateRevenueCatEvent,
  verifyRevenueCatWebhook,
} from '../supabase/functions/_shared/revenuecat.mjs';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const encoder = new TextEncoder();
const USER_ID = '3d594650-3436-4b1d-a8f8-1cbf294653ab';
const OTHER_USER_ID = 'a0a83d85-50e9-4480-961d-a77da1a7572d';
const THIRD_USER_ID = 'a5480aa8-0d4c-4681-b799-40cd4d6759b9';
const APP_ID = 'app_expected';
const ENTITLEMENT_RESOURCE_ID = 'entl_expected';
const PRODUCT_RESOURCE_ID = 'prod_monthly';

async function signature(rawBody, timestamp, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  ));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

assert.equal(isAnalysisRequestId(USER_ID), true);
assert.equal(isAnalysisRequestId('scan-123'), false);

const nowMs = 1_800_000_000_000;
const timestamp = Math.floor(nowMs / 1000);
const rawBody = '{"api_version":"1.0","event":{"id":"evt_1"}}';
const signingSecret = 'local-test-signing-secret';
const authorization = 'Bearer local-webhook-secret';
const signed = `t=${timestamp},v1=${await signature(rawBody, timestamp, signingSecret)}`;
assert.deepEqual(await verifyRevenueCatWebhook({
  rawBody,
  authorization,
  signature: signed,
  expectedAuthorization: authorization,
  signingSecret,
  nowMs,
}), { ok: true });
assert.equal((await verifyRevenueCatWebhook({
  rawBody: `${rawBody} `,
  authorization,
  signature: signed,
  expectedAuthorization: authorization,
  signingSecret,
  nowMs,
})).ok, false, 'body tampering must fail HMAC');
assert.equal((await verifyRevenueCatWebhook({
  rawBody,
  authorization: 'Bearer wrong',
  signature: signed,
  expectedAuthorization: authorization,
  signingSecret,
  nowMs,
})).code, 'authorization_invalid');
assert.equal((await verifyRevenueCatWebhook({
  rawBody,
  authorization,
  signature: signed,
  expectedAuthorization: authorization,
  signingSecret,
  nowMs: nowMs + 301_000,
})).code, 'signature_stale');

const eventPayload = {
  api_version: '1.0',
  event: {
    id: 'evt_purchase',
    type: 'INITIAL_PURCHASE',
    app_id: APP_ID,
    app_user_id: '$RCAnonymousID:old',
    aliases: [USER_ID],
    entitlement_ids: ['kandro_pro'],
    store: 'APP_STORE',
    environment: 'SANDBOX',
    event_timestamp_ms: nowMs,
  },
};
assert.deepEqual(validateRevenueCatEvent(eventPayload, APP_ID).event.userIds, [USER_ID]);
assert.equal(validateRevenueCatEvent({
  ...eventPayload,
  event: { ...eventPayload.event, app_id: 'app_other' },
}, APP_ID).code, 'app_invalid');
assert.equal(validateRevenueCatEvent({
  ...eventPayload,
  event: { ...eventPayload.event, entitlement_ids: ['another_entitlement'] },
}, APP_ID).relevant, false);
assert.equal(validateRevenueCatEvent({
  ...eventPayload,
  event: { ...eventPayload.event, store: 'RC_BILLING' },
}, APP_ID).relevant, false, 'RevenueCat Test Store events must not update Pro');
assert.equal(validateRevenueCatEvent({
  ...eventPayload,
  event: { ...eventPayload.event, id: '', entitlement_ids: ['another_entitlement'] },
}, APP_ID).code, 'event_invalid', 'an unrelated entitlement must not bypass common envelope validation');
assert.deepEqual(validateRevenueCatEvent({
  ...eventPayload,
  event: { ...eventPayload.event, aliases: [USER_ID, OTHER_USER_ID] },
}, APP_ID).event.userIds, [USER_ID, OTHER_USER_ID], 'every UUID alias must be independently checked against current state');

const transfer = validateRevenueCatEvent({
  api_version: '1.0',
  event: {
    id: 'evt_transfer',
    type: 'TRANSFER',
    app_id: APP_ID,
    app_user_id: '$RCAnonymousID:destination',
    original_app_user_id: THIRD_USER_ID,
    aliases: [OTHER_USER_ID],
    transferred_from: ['$RCAnonymousID:old', USER_ID],
    transferred_to: [OTHER_USER_ID],
    store: 'APP_STORE',
    event_timestamp_ms: nowMs,
  },
}, APP_ID);
assert.equal(transfer.ok, true);
assert.equal(transfer.relevant, true, 'TRANSFER has no entitlement_ids but can change Pro access');
assert.equal(transfer.event.environment, 'UNKNOWN', 'RevenueCat documents environment as optional for TRANSFER');
assert.deepEqual(transfer.event.userIds, [USER_ID, OTHER_USER_ID, THIRD_USER_ID]);
assert.equal(validateRevenueCatEvent({
  api_version: '1.0',
  event: { ...transfer.event, app_id: APP_ID },
}, APP_ID).ok, false, 'validated output is not itself a valid raw TRANSFER event');

function subscription(overrides = {}) {
  return {
    object: 'subscription',
    environment: 'production',
    store: 'app_store',
    gives_access: true,
    status: 'active',
    product_id: PRODUCT_RESOURCE_ID,
    current_period_ends_at: nowMs + 60_000,
    entitlements: {
      object: 'list',
      items: [{
        id: ENTITLEMENT_RESOURCE_ID,
        state: 'active',
        // Actual authenticated v2 response, 2026-09-05: product_id is on
        // the subscription; the entitlement has NO nested products list.
        object: 'entitlement',
        lookup_key: 'kandro_pro',
      }],
    },
    ...overrides,
  };
}

const iosSubscriptionOptions = {
  entitlementResourceId: ENTITLEMENT_RESOURCE_ID,
  iosAppId: APP_ID,
  productResourceIds: [PRODUCT_RESOURCE_ID],
  nowMs,
};
assert.deepEqual(activeIosSubscriptionFromV2({
  object: 'list',
  items: [subscription()],
}, iosSubscriptionOptions), {
  active: true,
  expiresAt: new Date(nowMs + 60_000).toISOString(),
});
assert.equal(activeIosSubscriptionFromV2({
  object: 'list',
  items: [subscription({ environment: 'sandbox' })],
}, iosSubscriptionOptions).active, true, 'Apple sandbox must work for TestFlight and App Review');
// Hard paywall after the first scan (10/2026): a running free trial is the
// entitlement that opens the app, so a trialing subscription must count.
assert.deepEqual(activeIosSubscriptionFromV2({
  object: 'list',
  items: [subscription({ status: 'trialing' })],
}, iosSubscriptionOptions), {
  active: true,
  expiresAt: new Date(nowMs + 60_000).toISOString(),
}, 'a running App Store trial is an active entitlement');
assert.deepEqual(activeIosSubscriptionFromV2({
  object: 'list',
  items: [subscription({
    status: 'in_grace_period',
    current_period_ends_at: nowMs - 1,
    ends_at: nowMs - 1,
  })],
}, iosSubscriptionOptions), {
  active: true,
  expiresAt: new Date(nowMs + 15 * 60_000).toISOString(),
}, 'access-granting grace must be rechecked on a short leash');
assert.deepEqual(activeIosSubscriptionFromV2({
  object: 'list',
  items: [subscription({
    status: 'future_revenuecat_status',
    current_period_ends_at: nowMs - 1,
    ends_at: nowMs - 1,
  })],
}, iosSubscriptionOptions), {
  active: true,
  expiresAt: new Date(nowMs + 15 * 60_000).toISOString(),
}, 'gives_access is authoritative and future statuses must receive only a short cache lease');
for (const unsafe of [
  subscription({ environment: 'unknown' }),
  subscription({ store: 'test_store' }),
  subscription({ store: 'rc_billing' }),
  subscription({ product_id: 'prod_other' }),
  subscription({ gives_access: false }),
  subscription({ current_period_ends_at: nowMs - 1, gives_access: false }),
  subscription({ entitlements: { object: 'list', items: [] } }),
  subscription({ entitlements: { object: 'list', items: [{ id: 'entl_other', state: 'active' }] } }),
  subscription({ entitlements: { object: 'list', items: [{ id: ENTITLEMENT_RESOURCE_ID, state: 'archived' }] } }),
  subscription({ entitlements: { object: 'list', items: [{
    id: ENTITLEMENT_RESOURCE_ID,
    state: 'active',
    products: { object: 'list', items: [{ id: PRODUCT_RESOURCE_ID, app_id: 'app_other', state: 'active' }] },
  }] } }),
]) {
  assert.deepEqual(activeIosSubscriptionFromV2({ object: 'list', items: [unsafe] }, iosSubscriptionOptions), {
    active: false,
    expiresAt: null,
  }, 'Test Store/wrong store/product/app/entitlement/expired subscriptions must fail closed');
}
assert.throws(() => activeIosSubscriptionFromV2({ items: {} }, iosSubscriptionOptions), /response_invalid/);
assert.throws(() => activeIosSubscriptionFromV2({ object: 'list', items: [subscription()] }, {
  ...iosSubscriptionOptions, productResourceIds: [],
}), /response_invalid/, 'the unexpanded response must still require a server-owned iOS product allowlist');
assert.equal(activeIosSubscriptionFromV2({ object: 'list', items: [subscription({
  entitlements: { object: 'list', items: [{ id: ENTITLEMENT_RESOURCE_ID, state: 'active',
    products: { object: 'list', items: [{ id: PRODUCT_RESOURCE_ID, app_id: APP_ID, state: 'active' }] },
  }] },
})] }, iosSubscriptionOptions).active, true, 'expanded responses remain supported');

let requestedUrl = '';
let requestedAuthorization = '';
let revenueCatClaims = 0;
const fetched = await fetchRevenueCatEntitlement({
  projectId: 'proj_expected',
  userId: USER_ID,
  entitlementResourceId: ENTITLEMENT_RESOURCE_ID,
  iosAppId: APP_ID,
  productResourceIds: [PRODUCT_RESOURCE_ID],
  secretApiKey: 'sk_local_test',
  claimRequest: async () => { revenueCatClaims += 1; },
  fetchImpl: async (url, init) => {
    requestedUrl = String(url);
    requestedAuthorization = init.headers.Authorization;
    return new Response(JSON.stringify({
      object: 'list',
      items: [subscription()],
    }), { status: 200 });
  },
});
assert.equal(fetched.active, true);
assert.match(requestedUrl, /\/v2\/projects\/proj_expected\/customers\/.+\/subscriptions\?limit=100$/);
assert.equal(requestedAuthorization, 'Bearer sk_local_test');
assert.equal(revenueCatClaims, 1, 'every RevenueCat provider request must consume one pre-fetch claim');
assert.deepEqual(await fetchRevenueCatEntitlement({
  projectId: 'proj_expected',
  userId: USER_ID,
  entitlementResourceId: ENTITLEMENT_RESOURCE_ID,
  iosAppId: APP_ID,
  productResourceIds: [PRODUCT_RESOURCE_ID],
  secretApiKey: 'sk_local_test',
  claimRequest: async () => { revenueCatClaims += 1; },
  fetchImpl: async () => new Response('', { status: 404 }),
}), { active: false, expiresAt: null }, 'a never-seen RevenueCat customer is inactive, not an outage');
assert.equal(revenueCatClaims, 2, 'a RevenueCat 404 is still an executed provider request and must consume capacity');
await assert.rejects(() => fetchRevenueCatEntitlement({
  projectId: 'proj_expected',
  userId: USER_ID,
  entitlementResourceId: ENTITLEMENT_RESOURCE_ID,
  iosAppId: APP_ID,
  productResourceIds: [PRODUCT_RESOURCE_ID],
  secretApiKey: 'sk_local_test',
  claimRequest: async () => { throw new Error('quota_denied_before_fetch'); },
  fetchImpl: async () => { throw new Error('fetch_must_not_run'); },
}), /quota_denied_before_fetch/, 'a rejected quota claim must keep RevenueCat completely unreachable');

const [
  migration,
  nutrition,
  webhook,
  config,
  gatewayEnv,
  client,
  serverEntitlement,
  entitlementConfirmation,
  subscriptionContext,
  appContext,
  localRepository,
  english,
  german,
  gatewayDoc,
] = await Promise.all([
  read('supabase/migrations/20260904185227_server_authoritative_analysis_access.sql'),
  read('supabase/functions/nutrition/index.ts'),
  read('supabase/functions/revenuecat-webhook/index.ts'),
  read('supabase/config.toml'),
  read('supabase/.env.gateway.example'),
  read('src/services/mealAnalysis.ts'),
  read('src/services/serverEntitlement.ts'),
  read('src/services/entitlementConfirmation.ts'),
  read('src/context/SubscriptionContext.tsx'),
  read('src/context/AppContext.tsx'),
  read('src/services/localRepository.ts'),
  read('src/i18n/en.ts'),
  read('src/i18n/de.ts'),
  read('docs/GATEWAY.md'),
]);

for (const table of ['analysis_access', 'analysis_requests', 'revenuecat_webhook_events', 'analysis_global_usage']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
}
assert.match(migration, /free_completed between 0 and 3/);
assert.match(migration, /free_completed \+ pending_free < 3/);
assert.match(migration, /state in \('reserved', 'started', 'completed', 'refunded'\)/);
assert.match(migration, /pg_advisory_xact_lock/g);
assert.match(migration, /request_row\.state = 'completed'[\s\S]*'replay'/);
assert.match(migration, /set free_completed = free_completed \+ 1/);
assert.match(migration, /state = 'refunded'/);
assert.match(migration, /access_kind = 'pro'[\s\S]*request_date = today_utc/);
assert.match(migration, /entitlement_checked_at >= now_utc - interval '24 hours'/);
assert.match(migration, /entitlement_active[\s\S]*entitlement_expires_at <= now_utc[\s\S]*'verification_required'/,
  'an ended period must be refreshed immediately instead of remaining falsely inactive for 24 hours');
assert.match(migration, /p_allow_stale_grace and entitlement_in_grace/);
assert.match(migration, /access\.entitlement_checked_at <= excluded\.entitlement_checked_at/);
assert.match(migration, /primary key \(event_id, user_id\)/,
  'one TRANSFER event must be deduplicated independently for both customers');
assert.match(migration, /on conflict \(event_id, user_id\) do nothing/);
assert.match(migration, /environment in \('SANDBOX', 'PRODUCTION', 'UNKNOWN'\)/);
assert.match(migration, /create function private\.apply_revenuecat_entitlement_batch\([\s\S]*p_user_ids uuid\[\][\s\S]*p_active boolean\[\][\s\S]*p_expires_at timestamptz\[\][\s\S]*p_checked_at timestamptz/,
  'all TRANSFER observations must enter one typed batch transaction');
assert.doesNotMatch(migration, /apply_revenuecat_entitlement_event\(/,
  'the pending migration must not retain a per-user webhook mutation RPC');
assert.match(migration, /observation_count not between 1 and 8/);
assert.match(migration, /array_ndims\(p_user_ids\)[\s\S]*array_ndims\(p_active\)[\s\S]*array_ndims\(p_expires_at\)/);
assert.match(migration, /count\(\*\) <> pg_catalog\.count\(distinct item\.user_id\)/,
  'duplicate users must be rejected before the batch mutates anything');
assert.match(migration, /hashtextextended\(p_event_id, 7311093\)/,
  'concurrent deliveries of one event need a shared transaction lock');
assert.match(migration, /unnest\(p_user_ids\)[\s\S]*order by value[\s\S]*hashtextextended\(lock_user_id::text, 4901721\)/,
  'multi-user customer locks must use one deterministic order');
assert.match(migration, /recorded\.event_type <> p_event_type[\s\S]*recorded\.environment <> p_environment[\s\S]*recorded\.event_timestamp_ms <> p_event_timestamp_ms[\s\S]*'event_conflict'/,
  'the same event id must not be accepted with a conflicting signed envelope');
assert.match(migration, /not exists \(select 1 from auth\.users where id = p_user_ids\[row_index\]\)[\s\S]*ignored_count := ignored_count \+ 1/,
  'deleted aliases must not recreate account state');
assert.match(migration, /create function private\.claim_revenuecat_refresh/);
assert.match(migration, /entitlement_refresh_at <= now_utc - pg_catalog\.make_interval/);
const refreshClaimSql = migration.slice(
  migration.indexOf('create function private.claim_revenuecat_refresh'),
  migration.indexOf('create function private.consume_global_analysis_quota'),
);
assert.doesNotMatch(refreshClaimSql, /entitlement_checked_at/,
  'a freshly cached inactive status must remain refreshable after the short cooldown, not be frozen for 24 hours');
assert.match(migration, /grant execute on function public\.claim_revenuecat_refresh[^;]+ to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.claim_revenuecat_refresh[^;]+ to (?:anon|authenticated)/);
assert.match(migration, /create function private\.consume_global_analysis_quota/);
assert.match(migration, /on conflict \(usage_date\) do update[\s\S]*where usage\.request_count < p_daily_limit/,
  'the global daily circuit breaker must increment atomically only below its cap');
assert.match(migration, /grant execute on function public\.consume_global_analysis_quota[^;]+ to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.consume_global_analysis_quota[^;]+ to (?:anon|authenticated)/);
assert.match(migration, /create function private\.purge_analysis_ledger/);
assert.match(migration, /completed_at < retention_clock - interval '22 hours'/);
assert.match(migration, /'kandro-analysis-ledger-retention',[\s\S]*'47 \* \* \* \*'/);
assert.match(migration, /received_at < retention_clock - interval '90 days'/);
assert.match(migration, /grant execute on function public\.reserve_analysis_access[^;]+ to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.(?:reserve_analysis_access|complete_analysis_request|sync_revenuecat_entitlement)[^;]+ to (?:anon|authenticated)/);
assert.match(migration, /grant execute on function public\.apply_revenuecat_entitlement_batch\(text, text, text, bigint, uuid\[\], boolean\[\], timestamptz\[\], timestamptz\) to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.apply_revenuecat_entitlement_batch[^;]+ to (?:anon|authenticated)/);

const freeRoute = nutrition.indexOf("if (request.method === 'GET')");
const reserve = nutrition.indexOf('reserveAnalysis(context.supabaseAdmin');
const quota = nutrition.indexOf("context.supabase.rpc('consume_analysis_quota')");
const globalQuota = nutrition.indexOf("'consume_global_analysis_quota'");
const usdaPreclaim = nutrition.indexOf("await claimProviderRequest(context.supabaseAdmin, data.user.id, 'usda_analysis'");
const provider = nutrition.indexOf('await analyzePhoto(payload');
assert.ok(freeRoute >= 0 && freeRoute < reserve, 'free search/barcode routes must bypass entitlement reservations');
assert.ok(
  reserve > 0 && reserve < quota && quota < globalQuota && globalQuota < provider,
  'reserve, per-user cost ceiling, global circuit breaker, then provider is the required order',
);
assert.ok(quota < usdaPreclaim && usdaPreclaim < globalQuota,
  'the network/global USDA claim must precede the non-refundable global AI-day breaker');
assert.match(nutrition, /isAnalysisRequestId\(requestId\)/);
assert.match(nutrition, /fetchRevenueCatEntitlement/);
assert.match(nutrition, /route === '\/v1\/entitlement\/refresh'[\s\S]*claim_revenuecat_refresh[\s\S]*refreshRevenueCatAccess/,
  'purchase refresh must be authenticated, atomically rate-limited and server-authoritative');
assert.match(nutrition, /claim\?\.status === 'rate_limited'[\s\S]*status: 503[\s\S]*entitlement_verification_unavailable/,
  'an in-flight or failed refresh lease must not return a stale cached boolean as authoritative');
assert.doesNotMatch(nutrition, /claim\?\.status === 'rate_limited'[\s\S]{0,300}cached: true/);
assert.match(nutrition, /ENTITLEMENT_REFRESH_COOLDOWN_SECONDS = 20/);
assert.match(nutrition, /refreshRevenueCatAccess\(context\.supabaseAdmin, data\.user\.id, networkHash\)/g,
  'both public refresh and stale-analysis reconciliation must supply the trusted network claim');
assert.match(nutrition, /refundAnalysis\(/g);
// Every refund records a fixed reason for private.ai_failure_daily.
assert.doesNotMatch(nutrition, /await refundAnalysis\(\s*context\.supabaseAdmin\s*,\s*data\.user\.id\s*,\s*requestId\s*\)/,
  'every refund path must pass a failure code');
assert.match(nutrition, /result\.status === 200 \? 'correction_required'/);
assert.match(nutrition, /p_failure_code: analysisFailureCode\(failureCode\)/);
{
  const failureMigration = await read('supabase/migrations/20261009100000_analysis_failure_codes.sql');
  assert.match(failureMigration, /add column failure_code text/);
  assert.match(failureMigration, /grant execute on function public\.refund_analysis_request\(uuid, uuid, text\) to service_role/);
  assert.doesNotMatch(failureMigration, /to (?:anon|authenticated)\b/);
}
assert.match(nutrition, /quotaError \|\| !Number\.isSafeInteger\(used\) \|\| used < 1/,
  'a malformed per-user quota response must fail closed before the paid provider');
assert.match(nutrition, /complete_analysis_request/);
assert.match(nutrition, /Deno\.env\.get\('PRO_ANALYSIS_DAILY_LIMIT'\) \|\| '60'/);
assert.match(gatewayEnv, /^PRO_ANALYSIS_DAILY_LIMIT=60$/m);
assert.match(gatewayEnv, /^GLOBAL_ANALYSIS_DAILY_LIMIT=5000$/m);
assert.match(nutrition, /DEFAULT_GLOBAL_ANALYSIS_DAILY_LIMIT = 5000;/);
assert.match(nutrition, /Deno\.env\.get\('GLOBAL_ANALYSIS_DAILY_LIMIT'\)/);
assert.match(gatewayEnv, /^REVENUECAT_IOS_PRODUCT_RESOURCE_IDS=$/m);
assert.match(gatewayDoc, /Sandbox Testing Access[\s\S]{0,500}`Anybody`/,
  'the loginless App Review runbook must not pre-allowlist an unknown reviewer UUID');
assert.match(gatewayDoc, /`store=app_store`[\s\S]{0,500}(?:Test Store|`rc_billing`)[\s\S]{0,100}(?:gesperrt|abgewiesen)/i,
  'the runbook must identify the server store allowlist, not Sandbox Testing Access, as the Test Store boundary');

for (const [language, source] of [['en', english], ['de', german]]) {
  // The 60/day fair-use cap moved from a benefit line into the paywall's fine
  // print: still disclosed before purchase, no longer marketing copy.
  assert.match(source, /fairUse: ["'][^\n]*60[^\n]*(?:per day|pro Tag)[^\n]*["']/i, `${language}: the paywall fine print must disclose the combined 60/day cap`);
  assert.doesNotMatch(source, /benefit\w*: ["'][^\n]*60 (?:analyses|Analysen)/i, `${language}: the fair-use cap is not a marketing benefit`);
  assert.match(source, /freeTitle:/, `${language}: permanently free features have their own heading`);
  assert.doesNotMatch(source, /(?:unlimited (?:AI |photo)|unbegrenzte (?:Foto|Scans)|ohne Limit)/i, `${language}: paid analysis must not be described as unlimited`);
}
assert.match(await read('src/app/paywall.tsx'), /t\.paywall\.fairUse/, 'the paywall renders the fair-use cap with the renewal terms');

assert.match(config, /\[functions\.revenuecat-webhook\]\s*verify_jwt = false/);
assert.match(webhook, /request\.body\.getReader\(\)/);
assert.match(webhook, /total > MAX_BODY_BYTES[\s\S]*reader\.cancel\(\)/);
assert.ok(webhook.indexOf('const verification = await verifyRevenueCatWebhook') < webhook.indexOf('JSON.parse(body.text)'), 'HMAC must see raw bytes before JSON parsing');
assert.match(webhook, /verifyRevenueCatWebhook/);
assert.match(webhook, /validateRevenueCatEvent\(payload, appId\)/);
assert.match(webhook, /REVENUECAT_ENTITLEMENT_RESOURCE_ID/);
assert.match(webhook, /apply_revenuecat_entitlement_batch/);
assert.match(webhook, /Promise\.all\(validated\.event\.userIds\.map/,
  'TRANSFER must resolve every current customer state before database writes');
assert.doesNotMatch(webhook, /for \(const observation of observations\)[\s\S]*admin\.rpc/,
  'a multi-user event must never be committed through separate RPC transactions');
for (const argument of ['p_user_ids', 'p_active', 'p_expires_at', 'p_checked_at']) {
  assert.match(webhook, new RegExp(`${argument}:`), `batch webhook RPC is missing ${argument}`);
}
assert.doesNotMatch(webhook, /validated\.event\.userId\b/,
  'the webhook must not silently drop all but one TRANSFER customer');
assert.match(webhook, /const checkedAt = new Date\(\)\.toISOString\(\)[\s\S]*p_checked_at: checkedAt/);
assert.match(nutrition, /const checkedAt = new Date\(\)\.toISOString\(\)[\s\S]*p_checked_at: checkedAt/);
assert.doesNotMatch(webhook, /console\.(?:log|error)\([^\n]*(?:rawBody|userId|authorization|signature)/i);

for (const name of [
  'REVENUECAT_PROJECT_ID',
  'REVENUECAT_APP_ID',
  'REVENUECAT_ENTITLEMENT_RESOURCE_ID',
  'REVENUECAT_IOS_PRODUCT_RESOURCE_IDS',
  'REVENUECAT_SECRET_API_KEY',
  'REVENUECAT_WEBHOOK_AUTHORIZATION',
  'REVENUECAT_WEBHOOK_SIGNATURE_SECRET',
]) {
  assert.match(gatewayEnv, new RegExp(`^${name}=`, 'm'), `${name} must be documented as an Edge secret`);
  assert.doesNotMatch(client + serverEntitlement + subscriptionContext + appContext + localRepository, new RegExp(`EXPO_PUBLIC_${name}`));
}
assert.match(client, /body: \{ imageBase64: input\.imageBase64, mimeType: input\.mimeType, language: input\.language, locale: input\.locale, requestId, ingredientCorrection: 1, captureProtocol: 2, estimates: 1 \}/);
assert.match(client, /description: description\.trim\(\)[\s\S]*requestId/);
assert.match(appContext, /analyzeDescription\(descriptionInput, invocationScanId\)/);
assert.match(appContext, /analyzePreparedPhoto\(input!, invocationScanId\)/);
assert.match(localRepository, /isAnalysisRequestId\(job\.id\)[\s\S]*newAnalysisRequestId\(\)/);
assert.match(serverEntitlement, /\/nutrition\/v1\/entitlement\/refresh/);
assert.match(serverEntitlement, /Authorization: `Bearer \$\{access\.accessToken\}`/);
assert.match(serverEntitlement, /lastRefreshResult\?\.userId === access\.userId/,
  'a cached server entitlement result must belong to the current Supabase user');
assert.match(serverEntitlement, /refreshInFlight\?\.userId === access\.userId/,
  'an in-flight server entitlement refresh must not be shared across account changes');
const compiledConfirmation = ts.transpileModule(entitlementConfirmation, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const confirmationModule = await import(`data:text/javascript;base64,${Buffer.from(compiledConfirmation).toString('base64')}`);
const probeResults = [false, false, true];
const observedWaits = [];
assert.equal(await confirmationModule.confirmServerEntitlementWithRetry(
  async () => probeResults.shift() ?? false,
  async (milliseconds) => { observedWaits.push(milliseconds); },
), true, 'an eventually consistent purchase must be confirmed by a bounded inactive/inactive/active sequence');
assert.deepEqual(observedWaits, [1_500, 19_500]);
assert.ok(observedWaits.reduce((sum, value) => sum + value, 0) > 20_000,
  'the final purchase probe must cross the server refresh cooldown');
const purchaseBody = subscriptionContext.slice(subscriptionContext.indexOf('const runPurchase = useCallback'));
const confirmationIndex = purchaseBody.indexOf('await confirmServerEntitlementWithRetry(');
assert.ok(confirmationIndex >= 0 && confirmationIndex < purchaseBody.indexOf("setStatus('active')"),
  'the UI must not claim Pro before the server confirms it');
// The controller regressions execute these branches. A positive store result
// with no server confirmation now stays pending, not falsely failed.
assert.match(purchaseBody, /confirmServerEntitlementWithRetry\([\s\S]*if \(!serverActive\)[\s\S]*return 'pending'/);
assert.match(subscriptionContext, /const serverActive = visible\.configured && visible\.mode === 'native-store'[\s\S]*await refreshServerEntitlement\(\)[\s\S]*if \(!isCurrent\(\)\) return;[\s\S]*if \(visible\.entitlementActive && !serverActive\)/,
  'SDK refresh must not resurrect Pro UI without server confirmation, nor overrule server-confirmed Pro with SDK Free');
assert.match(subscriptionContext, /const existing = refreshInFlightRef\.current;[\s\S]*if \(existing\?\.generation === generation\) return existing\.promise/,
  'simultaneous hydration, auth and paywall refreshes must share one in-flight operation');
assert.match(subscriptionContext, /const isCurrent = \(\) => refreshGenerationRef\.current === generation[\s\S]*if \(!isCurrent\(\)\) return;/,
  'an invalidated refresh must not overwrite a newer purchase or consent state');
assert.match(subscriptionContext, /setSnapshot\(\{ \.\.\.visible, entitlementActive: serverActive \}\);\s*setError\(null\);\s*setStatus\(/,
  'a successful refresh must clear a losing/stale error in the same commit path');
assert.match(serverEntitlement, /if \(lastRefreshResult\?\.userId === access\.userId && now - lastRefreshResult\.checkedAt < REFRESH_RESULT_CACHE_MS\)[\s\S]*if \(refreshInFlight\?\.userId === access\.userId\) return refreshInFlight\.promise/,
  'server entitlement checks must coalesce and cache inside the 20-second server cooldown');
assert.match(serverEntitlement, /REFRESH_RESULT_CACHE_MS = 20_500/,
  'the client cache must cover the complete server refresh cooldown');
for (const source of [english, german]) {
  assert.match(source, /entitlementConfirmationPending: '[^'\n]*(?:Restore|wiederherstellen)[^'\n]*'/i);
  assert.match(source, /testStoreNote: '[^'\n]*(?:UI|Oberfläche)[^'\n]*(?:not unlocked|keine Freischaltung|nicht freigeschaltet|gesperrt)/i,
    'Expo Go copy must disclose that Test Store cannot unlock hosted Pro');
}
assert.match(subscriptionContext, /next\.mode === 'test-store' && next\.entitlementActive[\s\S]*entitlementActive: false/,
  'a persisted Test Store CustomerInfo must not reappear as Pro after restart');

console.log('Entitlement checks passed: signed multi-user TRANSFER webhook, Apple App Store sandbox/production allowlist, Test Store rejection, server-confirmed purchase refresh with atomic cooldown, 3-success lifetime ledger, pro cap and idempotent replay.');
