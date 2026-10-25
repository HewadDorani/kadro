# Release notes for builds

## 1.0.6 retention: App Store Connect and RevenueCat steps (owner, before review)

The app code (`wip4/retention`) only shows what StoreKit returns. Without these
steps the new blocks simply stay hidden; nothing breaks.

1. **Billing Grace Period** – App Store Connect → Apps → Kandro → *Subscriptions*
   (the subscription group page) → **Billing Grace Period** → *Turn On*:
   duration **16 days**, eligible renewals **All renewals**, environment
   **Production and Sandbox**. RevenueCat keeps `kandro_pro` active during grace
   and sets `billingIssueDetectedAt`; the app shows the calm Today/Du notice.
   Kandro's server already treats grace as active (`gives_access`) and locks
   again on `EXPIRATION`/recheck. Confirm App Store Connect → App Information →
   **App Store Server Notifications** (Production and Sandbox, Version 2) point
   to the RevenueCat URL shown in RevenueCat → Apps → Kandro (App Store), so
   `BILLING_ISSUE`/`EXPIRATION` arrive promptly.
2. **In-App Purchase key for RevenueCat** (required for Promotional Offers and
   Win-Back Offers): App Store Connect → *Users and Access* → *Integrations* →
   **In-App Purchase** → *Generate In-App Purchase Key* (download the `.p8` once,
   note Key ID and Issuer ID) → RevenueCat → Project settings → Apps → Kandro
   (App Store) → **In-App Purchase Key Configuration** → upload `.p8`, Key ID,
   Issuer ID → save. Never commit the key.
3. **Win-Back Offer** for **both** products (`…pro.monthly`, `…pro.annual`):
   App Store Connect → Subscriptions → product → *Subscription Prices* →
   **Win-Back Offers** → *Create*: type *Pay as you go* (or *Pay up front*),
   e.g. **50 % for the first period** (monthly: 1 month, annual: 1 year);
   eligibility **paid for at least 1 month**, **lapsed at least 30 days**
   (no "subscribed within the last …" restriction); priority *Normal*; available
   in all storefronts; start now, no end date. Requires iOS 18+ on the device;
   older iOS sees the normal paywall.
4. **Promotional Offer** (shown on the in-app "Your subscription" screen):
   App Store Connect → product → *Subscription Prices* → **Promotional Offers**
   → *Create*: reference name e.g. `promo_3m_50`, identifier `promo_3m_50`,
   **Pay as you go, 3 months at 50 %** (monthly product; for annual e.g.
   1 year at 30 %). Repeat per product you want covered. Needs step 2.
5. **Migration** `supabase/migrations/20261025140000_paywall_retention_steps.sql`
   adds `winback_*` / `retention_offer_*` purchase steps (applied 25.10.2026).
6. **Small Business Program** (15 % commission instead of 30 %): enrol at
   https://developer.apple.com/app-store/small-business-program/ (account holder,
   once per developer account; associated developer accounts must be listed).
7. **Device test before review** (sandbox): billing issue (App Store Connect →
   Users and Access → Sandbox → tester → billing retry/interrupted renewals, or
   an Xcode StoreKit configuration with *Billing Grace Period* and *Billing
   Retry* enabled), notice shows and hides after "dismiss for today";
   "Your subscription" → *Cancel anyway* opens Apple's sheet; monthly → annual
   switch; promotional offer purchase; lapsed sandbox account on iOS 18 sees the
   win-back card. Record in `docs/qa/`.

**Status 25.10.2026 (set up in App Store Connect, read back via API):**
grace period 16 days, all renewals, production and sandbox. Win-back
`kandro_winback_monthly_50_v1` and `kandro_winback_annual_50_v1` (50 %, paid
≥ 1 month, lapsed 1–24 months, start 26.10.2026). Promotional offer
`kandro_retention_monthly_3m50_v1` (monthly only, 3 × 50 %); the app reads
StoreKit discounts dynamically, so no identifier is hard-coded. DE/GB/US only.
RevenueCat keys valid. Small Business Program submitted, decision pending.
Still open: the sandbox device test in step 7.

## Sentry source maps (status 09.10.2026: upload still off)

Crash reporting is on in `preview` and `production` (`EXPO_PUBLIC_SENTRY_DSN`).
Since 09.10.2026, 10% of sessions also send performance traces
(`tracesSampleRate: 0.1` in `src/services/crashReporting.ts`). The privacy
scrubbing still applies: no user, no request bodies, no query strings, no
screenshots, no trace headers to Supabase or providers.

Stack traces stay minified until source maps are uploaded. Upload needs a
**Sentry auth token**, which must never be committed. So both build profiles
in `eas.json` keep `"SENTRY_DISABLE_AUTO_UPLOAD": "true"`. Removing that flag
without the token makes the iOS build fail at the "Upload Debug Symbols to
Sentry" step.

To enable upload (owner action, one time):

1. In Sentry (EU region, `de.sentry.io`), create an **Organization Auth Token**
   with the `project:releases` and `org:read` scopes.
2. Store it as an EAS secret for both environments, never in the repo:
   ```bash
   npx eas-cli env:create --environment production --name SENTRY_AUTH_TOKEN --value <token> --visibility secret
   npx eas-cli env:create --environment preview --name SENTRY_AUTH_TOKEN --value <token> --visibility secret
   ```
3. Give the plugin the non-secret target in `app.json` and replace the bare
   `"@sentry/react-native"` plugin entry:
   ```json
   ["@sentry/react-native", { "organization": "<org-slug>", "project": "<project-slug>", "url": "https://de.sentry.io/" }]
   ```
4. Remove `"SENTRY_DISABLE_AUTO_UPLOAD": "true"` from the `preview` and
   `production` profiles in `eas.json`.
5. Create a preview build. In Sentry, check that the release has source maps and
   that a test error shows readable file and line numbers.
