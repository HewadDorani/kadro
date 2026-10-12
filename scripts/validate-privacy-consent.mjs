import {modelRequest,GEMINI_MODEL,requestStructured} from '../supabase/functions/_shared/model-adapter.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { safeGatewayFailureCode } from '../server/core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const [consent, context, routes, subscription, reminders, telemetry, gateway, localGateway, analysis, analyzing, onboarding, guardianService, guardianFunction, config, de, en, legalDe, legalEn, guardianPageDe, guardianPageEn, guardianScript, profileScreen, personalization, syncRepository, localRepository, accountLinkCard, appJsonRaw, ageMigration, retentionMigration] = await Promise.all([
  read('src/services/consent.ts'), read('src/context/AppContext.tsx'), read('src/components/AppRouteGuard.tsx'),
  read('src/context/SubscriptionContext.tsx'), read('src/components/ReminderScheduler.tsx'),
  read('src/services/telemetry.ts'), read('supabase/functions/nutrition/index.ts'), read('server/index.mjs'), read('src/services/mealAnalysis.ts'), read('src/app/analyzing.tsx'),
  read('src/app/onboarding.tsx'), read('src/services/guardianConsent.ts'), read('supabase/functions/guardian-consent/index.ts'), read('supabase/config.toml'),
  read('src/i18n/de.ts'), read('src/i18n/en.ts'), read('src/i18n/legal.de.ts'), read('src/i18n/legal.en.ts'),
  read('site/guardian-consent/index.html'), read('site/en/guardian-consent/index.html'), read('site/guardian-consent.js'),
  read('src/app/(tabs)/profile.tsx'), read('src/services/personalization.ts'), read('src/services/syncRepository.ts'), read('src/services/localRepository.ts'), read('src/components/AccountLinkCard.tsx'), read('app.json'),
  read('supabase/migrations/20260904120000_allow_teen_profiles_with_guardian_consent.sql'),
  read('supabase/migrations/20260904184701_add_waitlist_retention.sql'),
]);

const appJson = JSON.parse(appJsonRaw);
assert.doesNotMatch(telemetry, /goal: NutritionGoal/, 'analytics must not accept nutrition goals');
assert.doesNotMatch(onboarding, /trackEvent\('plan edited',\s*\{\s*goal:/, 'plan edits must not send health goals');
assert.match(telemetry, /blockedAutomaticProperties = new Set\([\s\S]*?'goal'/, 'legacy queued goal properties must be scrubbed before sending');
assert.match(await read('src/app/data-consent.tsx'), /color=\{wellnessConsentGranted \? colors\.onAccent : colors\.attentionText\}/, 'paused consent icon must remain visible in dark mode and meet contrast on the pale amber');
const version = consent.match(/PRIVACY_VERSION = '([^']+)'/)?.[1];
assert.ok(version, 'the app must expose a versioned privacy consent');
assert.ok(gateway.includes(`REQUIRED_PRIVACY_VERSION = '${version}'`), 'app and gateway consent versions must match');
assert.match(gateway, /select\('age,privacy_version,wellness_consent_at,guardian_consent_at,guardian_consent_version'\)/, 'the gateway must verify consent and guardian approval server-side');
assert.match(gateway, /code: 'consent_required'/, 'the gateway needs a stable consent error code');
assert.match(context, /if \(!wellnessConsentGranted\)/, 'cloud hydration must stop without consent');
assert.match(subscription, /!wellnessConsentGranted/, 'RevenueCat must not initialize before consent');
assert.match(reminders, /!wellnessConsentGranted/, 'reminders must not initialize before consent');
assert.match(context, /withdrawStoredWellnessConsent/, 'the app must expose withdrawal');
assert.match(context, /clearAnalysisQueue\(\)/, 'withdrawal must discard pending photos');
for (const queue of ['Queue', 'AiQueue', 'AiCaptureQueue', 'LogsQueue']) {
  assert.match(telemetry, new RegExp(`PostHogPersistedProperty\\.${queue}`),
    `account deletion does not discard PostHog's persisted ${queue}`);
}
assert.match(telemetry, /await posthog\.optOut\(\)[\s\S]*posthog\.reset\(\[\]\)[\s\S]*await posthog\.optOut\(\)/,
  'account deletion must opt out before and after clearing the PostHog identity and queues');
assert.ok(routes.includes("'data-consent'"), 'privacy controls must stay reachable before consent');

for (const [language, dictionary] of [['de', de], ['en', en]]) {
  for (const recipient of ['OpenRouter', 'Microsoft Azure', 'OpenAI', 'GPT-4.1 mini']) {
    assert.ok(dictionary.includes(recipient), `${language} explicit consent must name ${recipient}`);
  }
  assert.match(dictionary, /Zero Data Retention/, `${language} must disclose the configured retention protection`);
}
assert.ok(gateway.includes('https://openrouter.ai/api/v1/responses'), 'the configured OpenRouter endpoint must stay explicit');
assert.ok(!gateway.includes('https://api.openai.com'), 'the hosted gateway must not expose an undisclosed direct-provider route');
assert.ok(!gateway.includes("Deno.env.get('AI_PROVIDER')"), 'the production AI recipient must not be switchable by configuration');
assert.deepEqual(modelRequest({content:[]}).body.provider.only, ['azure'], 'the disclosed Azure processor must be pinned');
assert.equal(modelRequest({content:[]}).body.provider.allow_fallbacks, false, 'provider fallback would invalidate the named-recipient disclosure');
assert.equal(modelRequest({content:[]}).body.provider.zdr, true, 'Zero Data Retention must be enforced in code');
assert.ok(!gateway.includes("Deno.env.get('OPENROUTER_ZDR')"), 'ZDR must not be disableable by production configuration');
assert.ok(!gateway.includes('response.text()'), 'the hosted gateway must never read a provider error body into an exception');
assert.ok(!localGateway.includes('response.text()'), 'the local gateway must never read a provider error body into an exception');
assert.match(gateway, /console\.error\('nutrition gateway failure', safeCode\)/, 'gateway logs may contain only the sanitized failure code');
const sensitiveProviderError = new Error('openrouter_429:prompt=two bananas;authorization=secret');
assert.equal(safeGatewayFailureCode(sensitiveProviderError), 'gateway_unexpected_error', 'provider error details must collapse to a fixed non-sensitive code');
assert.equal(safeGatewayFailureCode(new Error('openrouter_429')), 'openrouter_429', 'provider HTTP status must remain diagnosable without a body');
assert.equal(safeGatewayFailureCode(new SyntaxError('meal output followed by invalid JSON')), 'provider_response_invalid', 'model parse errors must not log their message');

assert.match(analysis, /MAX_IMAGE_BASE64/, 'the client must enforce the gateway image ceiling');
assert.match(analysis, /'invalid-input'/, 'oversized photos need a non-retry error');
assert.ok(!analyzing.includes('const destination = needsReview'), 'every estimate must pass through confirmation');
assert.ok(analyzing.includes("router.replace('/confirm')"), 'analysis must always lead to confirmation');
// Kandro is 16+ (owner decision 10/2026). The age is a deliberately chosen
// birth year (nothing preselected), under 16 is a friendly block, and the
// client no longer reaches the guardian-consent flow; the server boundary for
// earlier 14–15 profiles below stays untouched.
const personalGoalSource = await read('src/services/personalGoal.ts');
assert.match(personalGoalSource, /export const MINIMUM_AGE = 16;/, 'the client minimum age is 16');
assert.match(onboarding, /const \[birthYear, setBirthYear\] = useState<number \| null>\(null\)/,
  'no birth year may be preselected');
assert.match(onboarding, /const ageKnown = editing \|\| \(birthYear !== null/,
  'a picker position is still treated as a declared age');
assert.match(onboarding, /if \(step !== 'goal' && !ageKnown\) return;/,
  'a non-UI caller can advance past an undeclared age');
assert.ok(onboarding.includes("disabled={(step === 'about' && !ageKnown)"),
  'the combined about step allows an undeclared age through');
assert.match(onboarding, /if \(step === 'about' && !editing && age < MINIMUM_AGE\) \{ setUnderage\(true\); return; \}/,
  'under-16 must stop at the friendly block before any consent or data processing');
assert.doesNotMatch(onboarding, /from '@\/services\/guardianConsent'|requestGuardianConsent\(|getGuardianConsentStatus\(|confirmAge/,
  'the client onboarding must not reach the guardian flow or the old age checkbox');
assert.ok(onboarding.includes("step === 'about' && !editing"),
  'recorded age must not be editable in the plan editor');
// The database keeps 14–100 so profiles created before the 16+ change stay valid.
assert.match(ageMigration, /between 14 and 100/, 'database age policy must keep earlier 14+ profiles valid');
assert.match(ageMigration, /age >= 16[\s\S]*guardian_consent_at is not null[\s\S]*guardian_consent_version/, 'under-16 consent must depend on server-recorded guardian approval');
assert.match(ageMigration, /alter table public\.guardian_consent_requests enable row level security/, 'guardian requests need RLS');
assert.match(ageMigration, /revoke all on table public\.guardian_consent_requests from anon, authenticated/, 'guardian emails must be unreachable to clients');
assert.ok(!/create policy .*guardian_consent_requests/i.test(ageMigration), 'guardian requests must not have a client policy');
assert.match(ageMigration, /protect_guardian_consent_fields/, 'guardian approval fields must be server managed');
assert.match(ageMigration, /\(old\.age < 16\) is distinct from \(new\.age < 16\)[\s\S]*\(old\.age < 18\) is distinct from \(new\.age < 18\)[\s\S]*minor age boundary is server managed/,
  'an existing minor profile can cross a consent or analytics age boundary through the Data API');
assert.doesNotMatch(ageMigration, /old\.guardian_consent_at[\s\S]{0,180}new\.age >= 16/,
  'guardian approval must not let a known minor promote the profile to an adult age');
assert.match(config, /\[functions\.guardian-consent\]\s*\nverify_jwt = false/, 'the emailed confirmation link must be publicly reachable');
assert.match(guardianFunction, /async function currentUser/, 'request and status paths must still validate the app user JWT');
assert.match(guardianFunction, /crypto\.subtle\.digest\('SHA-256'/, 'raw confirmation tokens must not be stored');
assert.match(guardianFunction, /GUARDIAN_RATE_LIMIT_SALT/, 'guardian mail rate limiting needs an independent server-only salt');
assert.match(guardianFunction, /trustedClientIp[\s\S]*chain\.at\(-1\)/,
  'guardian IP limiting trusts the attacker-controlled first forwarded address');
assert.match(guardianFunction, /admin\.rpc\('claim_guardian_consent_request'/,
  'guardian delivery is still protected by a racy read-then-write cooldown');
assert.match(guardianFunction, /hashFingerprint\('user', user\.id\)[\s\S]*hashFingerprint\('ip', clientIp\)[\s\S]*hashFingerprint\('email', guardianEmail\)/,
  'guardian abuse controls must cover account, network and recipient without raw values');
assert.ok(!/\.from\('guardian_consent_requests'\)[\s\S]{0,160}\.upsert\(/.test(guardianFunction),
  'the Edge Function still writes a guardian token outside the atomic claim');
assert.match(guardianFunction, /\.delete\(\)[\s\S]*\.eq\('user_id', user\.id\)[\s\S]*\.eq\('token_hash', tokenHash\)/,
  'a failed slow send can delete a newer guardian token without token compare-and-swap');
assert.match(guardianFunction, /MAX_BODY_BYTES = 4_096/,
  'the public guardian endpoint has no bounded request body');
assert.match(guardianFunction, /declaredLength > MAX_BODY_BYTES[\s\S]*tooLarge: true/,
  'the guardian endpoint ignores an oversized declared body');
assert.match(guardianFunction, /byteLength \+= value\.byteLength[\s\S]*byteLength > MAX_BODY_BYTES[\s\S]*reader\.cancel/,
  'a chunked guardian request can bypass the body-size ceiling');
assert.match(guardianFunction, /if \(parsed\.tooLarge\) return json\(request, \{ code: 'payload_too_large' \}, 413\)/,
  'the guardian endpoint parses an oversized body instead of rejecting it');
assert.match(guardianFunction, /admin\.rpc\('consume_guardian_consent'/,
  'guardian approval and token consumption are still separate, non-atomic writes');
assert.match(guardianFunction, /if \(consumed !== true\)[\s\S]*invalid_token/,
  'an unknown or replayed guardian token can still report approval');
assert.match(retentionMigration, /create or replace function private\.consume_guardian_consent[\s\S]*for update[\s\S]*update public\.profiles[\s\S]*delete from public\.guardian_consent_requests/,
  'the database does not atomically record guardian approval and delete its request');
assert.match(retentionMigration, /update public\.guardian_consent_requests\s+set guardian_email = null\s+where guardian_email is not null/,
  'historically persisted guardian addresses are not cleared during rollout');
assert.match(retentionMigration, /create or replace function public\.protect_guardian_consent_fields\(\)[\s\S]*\(old\.age < 16\) is distinct from \(new\.age < 16\)[\s\S]*\(old\.age < 18\) is distinct from \(new\.age < 18\)/,
  'the pending rollout does not close the consent and analytics age-boundary escalations');
assert.match(retentionMigration, /consent_request\.guardian_email is null[\s\S]*for update/,
  'a request that still contains a guardian address can be approved after cleanup failed');
assert.match(retentionMigration, /revoke all on function public\.consume_guardian_consent\(text, text\) from public, anon, authenticated/,
  'clients can invoke the privileged guardian-consent transaction');
assert.match(retentionMigration, /grant execute on function public\.consume_guardian_consent\(text, text\) to service_role/,
  'the guardian Edge Function cannot invoke the atomic confirmation transaction');
assert.match(retentionMigration, /create table if not exists private\.guardian_request_rate_limits[\s\S]*kind in \('user', 'email', 'ip'\)/,
  'guardian request limits do not cover account, recipient and network');
assert.match(retentionMigration, /create or replace function private\.claim_guardian_consent_request[\s\S]*interval '10 minutes'[\s\S]*email_attempts > 3[\s\S]*ip_attempts > 10[\s\S]*insert into public\.guardian_consent_requests/,
  'guardian rate checks and token rotation are not one atomic transaction');
assert.match(retentionMigration, /create or replace function private\.claim_guardian_consent_request[\s\S]*from public\.guardian_consent_requests[\s\S]*for update;[\s\S]*from public\.profiles[\s\S]*for update;/,
  'guardian claim must lock request then profile to match confirmation and avoid a resend/confirm deadlock');
assert.match(retentionMigration, /grant execute on function private\.claim_guardian_consent_request\([\s\S]*\) to service_role/,
  'the invoker wrapper cannot reach the private guardian claim as service_role');
assert.match(retentionMigration, /revoke all on function public\.claim_guardian_consent_request\([\s\S]*from public, anon, authenticated/,
  'untrusted clients can invoke the privileged guardian delivery claim');
assert.match(retentionMigration, /claim_clock \+ interval '48 hours'/,
  'guardian links need a database-enforced bounded lifetime');
assert.match(retentionMigration, /create or replace function private\.purge_guardian_request_rate_limits[\s\S]*interval '2 hours'/,
  'guardian rate fingerprints are retained longer than their abuse-prevention purpose');
assert.match(retentionMigration, /cron\.schedule\([\s\S]*'kandro-guardian-rate-limit-retention'[\s\S]*private\.purge_guardian_request_rate_limits\(\)/,
  'guardian rate-limit retention is not scheduled');
assert.match(retentionMigration, /create or replace function private\.purge_guardian_consent_requests[\s\S]*expires_at < retention_clock/,
  'expired guardian requests and token hashes are retained indefinitely');
assert.match(retentionMigration, /cron\.schedule\([\s\S]*'kandro-guardian-request-retention'[\s\S]*private\.purge_guardian_consent_requests\(\)/,
  'the guardian-request retention function is never scheduled');
assert.match(guardianService, /ensureSupabaseUser/, 'guardian requests must belong to an authenticated anonymous user');
assert.match(guardianScript, /guardianConfirmed: true/, 'the public page must send an explicit guardian affirmation');
assert.match(guardianScript, /if \(!checkbox\.checked\)/, 'opening the email link alone must not count as guardian consent');
for (const [language, page] of [['de', guardianPageDe], ['en', guardianPageEn]]) {
  assert.match(page, /type="checkbox" required/, `${language} guardian page needs an affirmative checkbox`);
  assert.match(page, /14[^<]*15|14- oder 15|14 or 15/, `${language} guardian page must identify the protected ages`);
}
assert.match(gateway, /REQUIRED_GUARDIAN_VERSION/, 'the paid gateway must enforce guardian approval server-side');
assert.match(gateway, /select\('age,privacy_version,wellness_consent_at,guardian_consent_at,guardian_consent_version'\)/, 'the gateway must read the complete age-consent boundary');
for (const [language, legal] of [['de', legalDe], ['en', legalEn]]) {
  for (const phrase of ['14', '15', '16', 'Resend']) {
    assert.ok(legal.includes(phrase), `${language} legal copy must disclose the teen/guardian flow and mail processor`);
  }
  for (const phrase of language === 'de'
    ? ['Hashwerte des App-Accounts', 'Ausgangsnetzwerks', 'Eltern-E-Mail', 'drei Stunden']
    : ['hashes of the app account', 'source network', 'guardian email', 'three hours']) {
    assert.ok(legal.includes(phrase), `${language} legal copy must disclose guardian-mail abuse fingerprints and retention`);
  }
  for (const phrase of ['Custom App User ID', 'Distinct', 'OpenRouter', 'Token']) {
    assert.ok(legal.toLowerCase().includes(phrase.toLowerCase()), `${language} privacy copy must disclose ${phrase}`);
  }
}
assert.match(legalDe, /ZDR-Modell anonym kategorisieren/,
  'German privacy copy omits OpenRouter anonymous prompt categorisation');
assert.match(legalEn, /ZDR model for anonymous categorisation/,
  'English privacy copy omits OpenRouter anonymous prompt categorisation');
assert.match(telemetry, /let analyticsSubjectAge: number \| null = null/,
  'analytics must fail closed until a profile age is adopted');
assert.match(telemetry, /trackEvent[^]*analyticsAllowedForCurrentProfile\(\)[^]*posthog\?\.capture/,
  'a persisted SDK opt-in must not bypass the in-memory age policy');
assert.match(telemetry, /before_send: \(event\) => event && analyticsAllowedForCurrentProfile\(\) && allowedEvents\.has\(event\.event\)/,
  'a queued allowed event must not flush during startup before the age policy is known');
assert.match(telemetry, /setAnalyticsCollectionEnabled\(enabled: boolean\)[^]*if \(!analyticsAgeEligible\(\)\)[^]*return false;[^]*persistLocalAnalyticsConsent\(true\)[^]*readyPostHog\(\)[^]*client\.optIn\(\)/,
  'a minor must not enable analytics by calling the telemetry service directly');
assert.match(context, /if \(!currentUserId \|\| currentUserId === pendingSwitch\.previousUserId\) \{[^]*restoreLocalStateAfterFailedLogin\(\)[^]*completeLocalAccountSwitch\(\)[^]*setHydrationReady\(true\)[^]*return;/,
  'a successful retry cannot recover from a pre-login account-switch interruption');
assert.match(telemetry, /if \(!enabled\) \{[^]*persistLocalAnalyticsConsent\(false\)[^]*await posthog\.optOut\(\);[^]*clearPersistedQueues\(posthog\)/,
  'turning analytics off must discard events queued before the opt-out');
assert.match(telemetry, /analyticsConsentGranted = enabled;[\s\S]*if \(!enabled && posthog\) clearPersistedQueues\(posthog\);[\s\S]*AsyncStorage\.removeItem/,
  'revocation must close the in-memory gate and erase queued events before its first asynchronous storage boundary');
assert.ok((telemetry.match(/await posthog\.ready\(\);\s*clearPersistedQueues\(posthog\);\s*await posthog\.optOut\(\)/g) ?? []).length >= 3,
  'minor, opt-out and deletion paths must clear a queue hydrated during ready before awaiting opt-out');
assert.match(telemetry, /let posthog: PostHog \| null = null[^]*function createPostHog\(\)[^]*return new PostHog/,
  'PostHog must stay unconstructed until an adult profile is authoritative');
assert.match(telemetry, /analyticsAllowedForCurrentProfile\(\)[^]*analyticsConsentGranted === true/,
  'the analytics emission gate must require the separate local opt-in flag');
const telemetryEnabledRead = telemetry.slice(
  telemetry.indexOf('export async function getAnalyticsCollectionEnabled'),
  telemetry.indexOf('export async function setAnalyticsCollectionEnabled'),
);
assert.doesNotMatch(telemetryEnabledRead, /readyPostHog|new PostHog/,
  'reading an untouched analytics switch must not start the SDK or contact PostHog');
assert.match(telemetry, /if \(await loadLocalAnalyticsConsent\(\)\) await readyPostHog\(\)/,
  'an adult profile may start PostHog only after a separately persisted explicit opt-in');
assert.match(telemetry, /POSTHOG_STORAGE_KEYS = \['\.posthog-rn\.json', '\.posthog-rn-logs\.json'\]/,
  'legacy PostHog event and log storage locations must both be known');
assert.match(telemetry, /customStorage: AsyncStorage/,
  'new PostHog data must use the storage backend Kandro can erase deterministically');
const identityCleanup = telemetry.slice(
  telemetry.indexOf('async function clearTelemetryIdentity'),
  telemetry.indexOf('async function readyPostHog'),
);
assert.doesNotMatch(identityCleanup, /if \(!posthog\) return/,
  'legacy PostHog files must be erased even when the lazy SDK was never constructed');
assert.match(identityCleanup, /erasePersistedPostHogStorage\(\)/,
  'identity cleanup must remove the persisted SDK stores after draining writes');
assert.match(telemetry, /AsyncStorage\.multiRemove\(\[ANALYTICS_CONSENT_KEY, \.\.\.POSTHOG_STORAGE_KEYS\]\)/,
  'identity cleanup must directly erase the local opt-in and current PostHog stores together');
assert.doesNotMatch(identityCleanup, /\.catch\(\(\) => undefined\)/,
  'identity cleanup must not report success when current telemetry storage or SDK draining fails');
assert.match(telemetry, /if \(!analyticsAgeEligible\(\)\) \{\s*await clearTelemetryIdentity\(\)/,
  'minor and unknown-age profiles must erase legacy PostHog identity and queues');
assert.match(context, /const adoptProfile[^]*applyAnalyticsAgePolicy\(nextProfile\.completedAt \? nextProfile\.age : null\)[^]*saveProfile\(nextProfile\)[^]*setProfile\(nextProfile\)/,
  'hydrated profile state must apply the analytics age policy before it becomes visible');
assert.ok((context.match(/await adoptProfile\(cloudState\.profile\)/g) ?? []).length >= 3,
  'initial, manual and post-consent cloud hydration must all use the same age-policy adoption path');
assert.match(context, /if \(!isSupabaseConfigured \|\| !hasConsent\) \{[^]*await applyAnalyticsAgePolicy\(storedProfile\.completedAt \? storedProfile\.age : null\)[^]*setHydrationReady\(true\)/,
  'a local-only profile must apply its age policy before hydration completes');
assert.match(retentionMigration, /update public\.profiles[\s\S]*set age = null,[\s\S]*privacy_version = null,[\s\S]*wellness_consent_at = null[\s\S]*where age = 18/,
  'the irreversible 16/17-to-18 legacy rewrite must be invalidated instead of treating ambiguous users as adults');
const promotionPredicate = syncRepository.match(/export function shouldPromoteLocalProfile\([^)]*\) \{([\s\S]*?)\n\}/);
assert.ok(promotionPredicate, 'the local/cloud profile promotion boundary must be independently testable');
const shouldPromoteLocalProfile = new Function('localCompletedAt', 'cloudCompletedAt', 'cloudAgeDeclared', promotionPredicate[1]);
assert.equal(shouldPromoteLocalProfile('2026-09-04T19:00:00Z', null, false), false,
  'migrated cloud age=null must beat an old local completed age=18 profile');
assert.equal(shouldPromoteLocalProfile('2026-09-04T19:00:00Z', null, true), true,
  'age-declared interrupted onboarding must be repairable from its completed local profile');
assert.equal(shouldPromoteLocalProfile('2026-09-04T18:00:00Z', '2026-09-04T19:00:00Z', true), false,
  'an older local profile must not overwrite a newer completed cloud profile');
const existingAccountHydration = syncRepository.slice(
  syncRepository.indexOf('export async function hydrateExistingCloudAccount'),
  syncRepository.indexOf('export async function syncUserSetup'),
);
assert.match(existingAccountHydration, /initializeCloudProfile\(DEFAULT_PROFILE, DEFAULT_TARGETS, true\)/,
  'existing-account hydration must not seed the destination from the previous local profile');
assert.match(existingAccountHydration, /loadCloudMealHistory\(\)/,
  'existing-account hydration must load only the destination account history');
assert.doesNotMatch(existingAccountHydration, /saveCloudProfile|saveCloudMeal|deleteCloudMeal|loadAllStoredScans|loadDeletedMealIds/,
  'existing-account hydration must never upload, merge or delete using the previous account data');
assert.match(localRepository, /ACCOUNT_SWITCH_PENDING_KEY/,
  'account switching needs a durable crash-recovery marker before auth changes');
assert.match(localRepository, /replaceLocalAccountData[\s\S]*multiSet\([\s\S]*MEALS_KEY[\s\S]*PROFILE_KEY[\s\S]*COUNTED_SCAN_IDS_KEY[\s\S]*multiRemove\(\[QUEUE_KEY, WEIGHTS_KEY, DELETED_MEALS_KEY\]/,
  'account switching must replace local health data and clear the prior queue, weights and tombstones');
const accountSwitch = context.slice(
  context.indexOf('const switchAccount = useCallback'),
  context.indexOf('const refreshCloudState'),
);
assert.ok(accountSwitch.indexOf('beginLocalAccountSwitch(previousUserId)') < accountSwitch.indexOf('await signIn()'),
  'the crash marker must be durable before Supabase changes identity');
assert.ok(accountSwitch.indexOf('clearTelemetryForAccountSwitch()') < accountSwitch.indexOf('await signIn()'),
  'analytics must fail closed before Supabase changes identity');
assert.match(accountSwitch, /loadAppleAccount = useCallback[\s\S]*switchAccount\(\(\) => signInWithApple/, 'Apple sign-in must use the same guarded account switch');
assert.match(accountSwitch, /retryAccountRecovery\(\)/,
  'credential sign-in must use the cloud-authoritative hydration path');
const accountRecovery = context.slice(
  context.indexOf('const retryAccountRecovery = useCallback'),
  context.indexOf('const switchAccount = useCallback'),
);
assert.match(accountRecovery, /hydrateExistingCloudAccount\(\)/,
  'account recovery must use the cloud-authoritative hydration path');
assert.doesNotMatch(accountSwitch, /hydrateCloudState\(\)|refreshCloudState\(\)/,
  'credential sign-in must not call the local-merging hydration path');
assert.match(context, /loadLocalAccountSwitch\(\)[\s\S]*if \(pendingAccountSwitch\)[\s\S]*currentUserId === pendingAccountSwitch\.previousUserId[\s\S]*retryAccountRecovery\(\)/,
  'launch must recover an interrupted account switch without merging old local data');
assert.match(context, /analysisIdentityGenerationRef\.current === invocationIdentityGeneration[\s\S]*countLifetimeScanOnce/,
  'an analysis completed under the old identity must not increment the new account local allowance');
assert.match(routes, /if \(appleReauthenticationRequired \|\| !hydrationReady\)[\s\S]*syncMode === 'error'[\s\S]*return <BrandGate \/>;[\s\S]*return children/,
  'the protected app tree must stay unmounted while an account identity is being recovered');
assert.match(routes, /const recoverAccount = async[\s\S]*appleReauthenticationRequired \? await appleCredential\(\) : undefined[\s\S]*await retryAccountRecovery\(credential\)/,
  'the guarded recovery action must collect Apple credentials only when required and use AppContext recovery');
assert.match(accountLinkCard, /Alert\.alert\([\s\S]*loadExistingAccount\(email, password\)/,
  'destructive local replacement must be explained and confirmed before loading an existing account');
assert.doesNotMatch(accountLinkCard, /signInToExistingAccount/,
  'the UI must not bypass the AppContext identity boundary with a direct auth mutation');
const initialHydration = context.slice(context.indexOf('useEffect(() => {'), context.indexOf('const grantWellnessConsent'));
assert.doesNotMatch(initialHydration.slice(0, initialHydration.indexOf('if (!isSupabaseConfigured || !hasConsent)')), /applyAnalyticsAgePolicy\(storedProfile\.age\)/,
  'a cloud-enabled upgrade must not trust a locally persisted adult age before authoritative hydration');
assert.ok(context.indexOf('await adoptProfile(cloudState.profile)') < context.indexOf("setSyncMode('cloud')"),
  'a cloud-authoritative age policy must apply before cloud hydration is exposed as complete');
assert.match(profileScreen, /const analyticsEligible = hydrationReady && Boolean\(profile\.completedAt\) && profile\.age >= 18/,
  'the analytics switch must treat pre-hydration and incomplete profiles as ineligible');
assert.match(profileScreen, /getAnalyticsCollectionEnabled\(\)[\s\S]*\}, \[hydrationReady, profile\.age, profile\.completedAt\]\)/,
  'the analytics switch must re-read explicit consent after authoritative profile hydration');
assert.match(profileScreen, /disabled=\{!analyticsEligible \|\| !isTelemetryConfigured\}/, 'minors must not be able to enable optional analytics');
assert.match(personalization, /const requestedOffset = teen \? 0 :/, 'teen goals must never turn into an adult calorie deficit or surplus');

const cameraPlugin = appJson.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-camera');
assert.equal(cameraPlugin?.[1]?.recordAudioAndroid, false, 'the camera must not enable Android video-audio recording');
assert.ok(appJson.expo.locales?.en && appJson.expo.locales?.de, 'permission copy must be localized in English and German');
assert.equal(appJson.expo.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads, false, 'iOS must reject arbitrary unencrypted network loads');

// Build 36 had a speech microphone string in app.json, but the camera's late
// InfoPlist mod deleted it. Execute the actual installed Expo plugins: inspecting
// static app.json alone cannot detect that ordering failure.
const require = createRequire(import.meta.url);
const { getPrebuildConfigAsync } = require('@expo/prebuild-config');
const { compileModsAsync } = require('@expo/config-plugins');
const nativeConfig = await getPrebuildConfigAsync(root, { platforms: ['ios'] });
await compileModsAsync(nativeConfig.exp, {
  projectRoot: root, platforms: ['ios'], introspect: true, assertMissingModProviders: false,
});
const generatedPlist = nativeConfig.exp._internal?.modResults?.ios?.infoPlist;
assert.ok(generatedPlist, 'Expo must execute the iOS InfoPlist mods');
for (const key of ['NSPhotoLibraryUsageDescription', 'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']) {
  assert.ok(typeof generatedPlist[key] === 'string' && generatedPlist[key].trim().length > 15,
    `${key} must survive the generated native plugin chain (Build 36 / ITMS-90683)`);
  assert.equal(generatedPlist[key], appJson.expo.ios.infoPlist[key], `${key}: native and declared purposes must agree`);
  for (const language of ['de', 'en']) {
    const localized = JSON.parse(await read(appJson.expo.locales[language]));
    assert.ok(typeof localized[key] === 'string' && localized[key].trim().length > 15,
      `${language}: ${key} must have an explicit localized purpose`);
  }
}

console.log('Validated explicit AI consent, withdrawal, 16+ onboarding, server-side guardian enforcement for earlier 14–15 profiles and minimal native permissions.');

await assert.rejects(requestStructured({apiKey:'synthetic',content:[],model:GEMINI_MODEL,fetchImpl:()=>{throw new Error('must not call');}}),/ai_route_not_approved/);
