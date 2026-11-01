# App Store privacy answers

Use this as the source of truth when completing **App Privacy** in App Store Connect. Re-check it against the exact production build and every enabled third-party SDK before submitting.

## Tracking

- **Data used to track you:** No.
- No IDFA, advertising, data broker, cross-app targeting or third-party advertising use.

## Data collected and linked to the user

| App Store data type | Purpose | Why |
|---|---|---|
| Health & Fitness → Health | App Functionality | Body measurements, nutrition targets, confirmed meals and macros are stored under the user's Supabase account. |
| Identifiers → User ID | App Functionality | Supabase anonymous or secured account ID; also used as the RevenueCat App User ID. |
| Purchases → Purchase History | App Functionality | RevenueCat and Apple maintain subscription entitlement state. |
| Contact Info → Email Address | App Functionality, Account Management | When the user voluntarily secures/restores the guest account, or (builds up to 1.0.3 only; Kandro is 16+ from 09.10.2026) when a 14–15-year-old asks a parent/guardian to confirm permission. The guardian address is used from Edge Function memory for Resend delivery and is never written to Kandro's database. Short-lived, separately salted account, recipient and network fingerprints enforce guardian-mail limits and are purged within three hours. |
| Contact Info → Name | App Functionality | An optional display name is stored in the Supabase profile and used for the greeting. |
| Usage Data → Product Interaction | App Functionality | The authenticated gateway stores linked request IDs, state, access kind, failure code and short-lived structured nutrition results to enforce the three free analyses, paid access, abuse limits and idempotent retries. The access assignment (variant or exclusion reason of the paused access test) and the first paywall exposure per context are stored against the account. |

These records also feed the server-side aggregate funnel (`private.growth_funnel_daily`, `private.ai_failure_daily`): counts per sign-up day, read only with the service role, never exported per person. From 1.0.7 it also stores `private.usage_days` (per account and Berlin day: app opened, how a meal was captured, fixed feature signals; no content, device or value data). This stays product interaction linked to the account, the same App Store data type as the rest of this table; the privacy notice (2.5) discloses it under Art. 6(1)(f) GDPR.

## Optional analytics

Production currently has PostHog enabled. Even though collection is off by default and an adult user must opt in, the App Privacy answer must cover the users who opt in. It cannot be enabled on a profile under 18. Declare:

| App Store data type | Purpose | Why |
|---|---|---|
| Identifiers → Device ID | Analytics | The SDK persists random device/distinct identifiers. Treat them conservatively as linked to the user/device. |
| Usage Data → Product Interaction | Analytics | Allowlisted feature events and bucketed properties. No food, nutrition value, photo, email or Supabase ID is included. |
| Diagnostics → Other Diagnostic Data | Analytics, App Functionality | Sanitized operational exception type/code and original stack frames, plus limited app/OS/SDK metadata used to diagnose failures. |

If PostHog is deliberately disabled in the submitted production environment, re-run the packet/log test before removing these disclosures merely because the dormant SDK remains present. A default opt-out does **not** make collection undisclosable when an adult can opt in.

## Crash diagnostics (Sentry)

Sentry (`@sentry/react-native`, EU region) is active whenever `EXPO_PUBLIC_SENTRY_DSN` is set in the build, independent of the analytics opt-in. `src/services/crashReporting.ts` sends no user object, no default PII, no screenshots or view hierarchy, no request bodies, and drops console, network, navigation and text-input breadcrumbs. Declare as **not linked to the user**:

| App Store data type | Purpose | Why |
|---|---|---|
| Diagnostics → Crash Data | App Functionality | Native and JavaScript crash reports with stack traces. |
| Diagnostics → Performance Data | App Functionality | Release-health session counts (`enableAutoSessionTracking`), and sampled performance traces whenever `tracesSampleRate` is above 0. |
| Diagnostics → Other Diagnostic Data | App Functionality | Sanitised error type, app version, device model, OS version and the last interface breadcrumbs without input. |
| Identifiers → Device ID | App Functionality | Sentry's random installation identifier, used only to group reports. Declared conservatively; it is never joined to the Supabase account. |

If a release build ships without a DSN, Sentry stays inactive; keep the declaration anyway if any later build of the same version can enable it.

## Transient photos and descriptions

Meal photos and descriptions leave the device to fulfil the user-triggered analysis request. The route is pinned to OpenRouter in the United States and ZDR-capable Microsoft Azure endpoints with fallbacks disabled, `store: false`, provider data collection denied and Zero Data Retention. Originals are discarded after compression; confirmed meals contain no image. Under Apple's definition, data processed only transiently to service a request and not retained does not normally count as “collected”.

Before choosing **Photos or Videos: Not Collected** and **Other User Content: Not Collected** for the raw description, deploy the safe-log correction, retain evidence from the live ZDR smoke test and verify that neither application logs nor the selected OpenRouter/Azure route retain request content. If that guarantee changes, disclose the affected types and update the privacy notice before submission.

The gateway's idempotency ledger keeps only the structured nutrition result, not the original photo, Base64 payload, prompt or typed description, for less than 24 hours. It is linked to the Supabase user and is already covered by **Health & Fitness → Health** and **Usage Data → Product Interaction** above. The request tombstone is retained for 30 days and RevenueCat webhook IDs for 90 days; both are used for App Functionality and abuse/duplicate prevention.

## Nutrition lookups

USDA receives normalized food search terms. Open Food Facts receives a barcode. These are used for App Functionality and are not used for tracking. The authenticated Kandro gateway verifies the current consent version before either provider is called. To protect USDA, Open Food Facts and RevenueCat, Supabase keeps only per-provider counters tied to one-way account and source-network pseudonyms. The counters contain no query or barcode and are purged within two hours after last use; this remains covered by **Identifiers → User ID** and **Usage Data → Product Interaction** above.

## Reviewer consistency checks

- Primary English Privacy Policy URL: `https://getkandro.com/en/privacy`
- German Privacy Policy URL: `https://getkandro.com/privacy`
- In-app withdrawal: **You → Analysis & data use → Withdraw consent**
- Account deletion: **You → Delete account and data**
- Analytics opt-in/opt-out: offered in the onboarding consent step; changeable under **You → Privacy settings → Anonymous usage analytics**
- Minimum age: 16+ in the listing, privacy notice and terms (set the App Store Connect age rating to 16+, see APP_STORE.md)
- Account deletion does not cancel an Apple subscription; the app says this before deletion.


## Native Apple account candidate

Voluntary Sign in with Apple uses the existing linked User ID and optional email disclosures above. Apple sends its account identifier and identity/authorization credentials to the native app; the fresh authorization code is forwarded only to the authenticated Kandro backend. The backend validates the Apple response and keeps an encrypted refresh token solely for account authentication lifecycle and revocation. The encryption key is stored separately as an Edge secret. Client roles cannot read or modify the token table, and account erasure cascades the row. Raw codes and token payloads are not persisted in client storage or returned in function errors.

A local recovery marker contains only the Kandro and Apple identity references, to prevent revoked access from silently creating a replacement guest account or mixing diaries. Successful account deletion removes the markers. If no usable Apple token exists, deletion still proceeds and the app explains manual removal under the user's Apple account settings. This does not cancel an Apple subscription. Verify real native sign-in and revocation on the submitted binary before claiming release readiness.
