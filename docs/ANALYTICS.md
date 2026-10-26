# Product analytics and operational diagnostics

Current implementation: `src/services/telemetry.ts`, schema **2**, first release candidate **1.0.1 (18)**. Schema 1 events from earlier builds are not comparable for meal-save conversion.

## Coverage and privacy

Collection is off by default. Only a known adult profile with an explicit opt-in can emit; the opt-in is offered in the onboarding consent step and stays changeable under You → Privacy settings. Unknown age, users under 18, revocation, deletion and account switching close the gate. No retroactive events are sent. In particular, **onboarding steps before the opt-in cannot be measured**; do not call the setup-step chart an all-installs onboarding funnel. For all-installs numbers use the server-side funnel below.

PostHog EU receives a random installation identity, fixed feature/outcome categories and app version/build/platform/environment. The identity is reset at account boundaries. It is not a unique-person or cross-device account count. App foreground events enable activity/retention measurement within this consenting sample.

Never send photos, search queries, barcode numbers, food names, descriptions, ingredient names, email, Supabase IDs, meal IDs, body values, goals, calories, macros, payment receipts or provider responses. Typed properties also pass a runtime categorical allowlist. Device name/model/manufacturer, locale/timezone, dimensions and old goal properties are scrubbed. Person profiles, GeoIP, feature flags, touch/lifecycle autocapture, surveys and replay remain disabled. No other product-analytics service is installed. Crash and error reports go separately to Sentry (EU region, `src/services/crashReporting.ts`): no user object, no default PII, no screenshots, no input breadcrumbs, independent of the analytics opt-in; see APP_PRIVACY.md.

## Event contract

All product events include `analytics_schema=2`, `app_version`, `app_build`, `app_platform`, `app_environment`. The environment is `development` for local development and `release` for signed release binaries. **TestFlight also uses a release binary**: exclude known internal test installations using PostHog's internal-user filter; `release` alone does not prove App Store acquisition. Do not compare synthetic development data to real users.

| Events | Meaning / categorical properties |
|---|---|
| `app active` | Launch, foreground or opt-in. Active installations use distinct IDs, not event count. |
| `screen viewed` | Fixed route name only, no parameters. |
| `setup step viewed`, `onboarding completed`, `plan edited` | Step name/editing or completion; post-consent coverage only. No input values. |
| `introduction step viewed`, `introduction exited` | Tour step 1–5; completed vs explicitly closed. |
| `camera permission resolved`, `camera capture failed` | Permission outcome; not-ready/capture-failed category. |
| `food search started`, `food search completed`, `food search failed`, `food search selected` | Dispatched debounced request, latest applicable result/failure, selected rank bucket. Queries omitted. Result count 0/1–15/16–30/31+. |
| `meal scan started` | Input selected/submitted: camera, description, barcode, search, demo, queued retry. |
| `meal analysis completed`, `meal analysis failed` | Result confidence/item-count/warning flag or fixed failure reason/queued flag, source and duration bucket. |
| `meal confirmed` | Confirmation with correction flag and coarse included-item count; not a save. |
| `meal save attempted`, `meal save completed`, `meal save failed` | Local write attempt, completed outcome created/updated/unchanged, or local-storage failure. Source category identifies the entry path. |
| **`meal saved`** | **Exactly one event for a newly created local meal ID after durable local storage succeeds.** Automatic Result save, search, barcode, recommendation and repeat paths use the same boundary. |
| `meal updated` | A persisted correction, not a new meal. Changing only attempted save timestamp is unchanged. |
| `meal deleted` | Local deletion completed. |
| `cloud sync completed`, `cloud sync failed` | Individual cloud writes/deletes. Outcome synced/local-only; failed uploads leave the durable local record available for retry on hydration. A save event does not imply cloud success. |
| `result continued` | Navigation from Result to Today/recommendations. Never used as saved-meal count. |
| `recommendation set viewed`, `recommendation selected` | Meal context and selected rank. |
| `paywall viewed` | Billing mode; includes an unavailable store state, not proof products loaded. |
| `subscription purchase started`, `subscription purchase ended` | Selected plan, billing mode, active/cancelled/pending/interrupted/failed. Pending is an unresolved store/server confirmation; interrupted belongs to an obsolete account context. Completed means StoreKit plus backend entitlement confirmed. |
| `subscription purchase completed` | Successful activation only. Not booked revenue. |
| `subscription restore started`, `subscription restore ended`, `subscription restore completed` | Active/no purchase/pending/interrupted/failed; restore is not a new sale. |
| `subscription offer purchase ended` | 1.0.6 retention: offer kind (winback/promotional/annual_switch), billing mode and outcome. No price, product id or offer id. |
| `$exception` | Explicit scrubbed JS/render/integration errors with fixed area/operation/code, only for opted-in adults. No raw error message or payload. Native and JavaScript crashes for all users are covered by Sentry, not by these events; Apple's diagnostics remain a second source. |

Duration buckets: under 1s, 1–3s, 3–10s, 10–30s, over 30s. Counts: 1/2–3/4+ where applicable. No per-keystroke analytics.

## Diagnostic measurement plan

Review daily after release, compare by app build and entry source. Use schema 2, iOS, release, exclude internal/test IDs. Use the same date range and filters in numerators and denominators. Do not mix schema 1 meal saves into the new funnel.

1. **Core value:** distinct installations with `meal saved` / distinct installations with `app active`, daily and weekly. Also count saved events by source. Source-of-truth event is the local persistence outcome; cloud success is a separate reliability measure.
2. **Return use:** retention starting from `meal saved`, returning to `meal saved`, exact day D1/D7 and weekly as separate metrics. Use only cohorts old enough to complete each window. An uninstall, identity reset, opt-out or another device limits observed retention; this is not all-user churn.
3. **Reliability:** `meal save failed` / `meal save attempted` and cloud failures / (cloud success + failure), with local-only excluded from cloud attempts. Examine build/source and error group. No baseline or target is invented before real data arrives.

Useful ordered funnels (30-minute window, distinct installation, same filters):
- `meal scan started` -> `meal analysis completed` -> `meal confirmed` -> `meal saved` for camera/description/barcode. **Search skips analysis** and needs its own funnel.
- `food search started` -> `food search completed` -> `food search selected` -> `meal confirmed` -> `meal saved` (saved source search).
- `recommendation selected` -> `meal saved` (source recommendation).
- `paywall viewed` -> `subscription purchase started` -> `subscription purchase completed`, split monthly/yearly and billing mode native_store.

A missing next step is an **observed drop-off**, not proof of a bug: users may leave voluntarily, background the app, revoke consent or be offline. Replaced search requests intentionally have no latest-result event; start-to-complete is not an exact network error rate. Use explicit failure events and latency buckets to narrow causes. Events buffered by the SDK can arrive late, and app termination between persistence and capture can still undercount. This is not an exactly-once server ledger.

## Server-side funnel (no client analytics)

Because the PostHog sample is opt-in only, all-installs questions (how many new accounts try an AI analysis, save a meal, come back on day 1+ or 7+, see the paywall, start a trial) are answered from data Supabase already holds, as aggregate counts per sign-up day (Europe/Berlin): `private.growth_funnel_daily` and `private.ai_failure_daily` (failure code per day), plus `private.paywall_exposures` (first paywall exposure per account and context). They are readable only with the service role (Supabase SQL editor); never export per-person rows. The privacy notice 2.5 discloses this under Art. 6(1)(f) GDPR with a right to object. How to query them: `docs/GROWTH_FUNNEL.md`.

Use Apple App Store Connect for first-time downloads, redownloads and native crash diagnostics, and RevenueCat/Apple financial records for active subscriptions, renewals, refunds and revenue. Client events diagnose flow friction, not financial truth.

## Verification

`npm run validate:observability` executes storage race, read/write/corruption failure, duplicate save, edit, offline cloud failure, consent/minor, property-scrubbing and cloud-write ordering tests. It is included in `npm run verify`.

Release-specific native and live ingestion evidence belongs in the workspace release report, not this evergreen contract. Passing local tests does not prove a production event has arrived.


## paywall_access_v1 (03.10.2026)

**Pausiert seit 09.10.2026:** zu wenige Nutzer für eine interpretierbare Auswertung; alle erhalten die weiche Paywall mit kostenloser Option (3 KI-Analysen, Suche/Barcode/Plan/Verlauf frei). Bestehende Zuordnungen bleiben gespeichert, neue Varianten werden nicht vergeben. Der folgende Abschnitt beschreibt die Auswertungsregeln für den Fall einer Wiederaufnahme.

Die Grundgesamtheit heißt ausdrücklich **freiwillig verknüpfte geeignete Neunutzer**, nicht alle Downloads. Die einmalige funktionale Serverzuordnung ist unabhängig von Analytics-Einwilligung; A/B, Grund und Zeitpunkt sind private Kontodaten, keine Tracking-ID. Anonyme, ausgeschlossene und bestehende Nutzer sind keine Kontrollgruppe. Auswertung nach ursprünglicher Zuteilung: Auch Nutzer, die nach Zuteilung abbrechen oder nie kaufen, bleiben im Nenner ihrer Gruppe. Keine Neuverlosung nach Restore, Login oder Eligibilityverlust.

Clientereignisse bleiben unter dem vorhandenen Analytics-Opt-in und Altersgrenzen. `access paywall shown` trägt nur erlaubte Experiment-/Varianten-/Umgebungswerte, Kaufabschluss unterscheidet tatsächlichen Trial von bezahltem Kauf; Restore ist kein neuer Kauf. QA-Zuordnungen sind von Experimentereignissen ausgeschlossen. Ereignisse allein können wegen Opt-out und Zustellverlust den vollständigen Nenner nicht liefern; fehlende Messbarkeit offen berichten. Funktionale Zuordnungen nicht stillschweigend in personenbezogene Analytics exportieren. Apple/RevenueCat bleibt maßgeblich für Zahlungsstatus; weder Conversionresultate noch statistische Überlegenheit sind bislang gemessen.
