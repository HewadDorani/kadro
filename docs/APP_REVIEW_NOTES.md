# App Review notes — Kandro (hard-paywall candidate after build 41; not submitted)

> Updated 10.10.2026 for the hard paywall after the first scan (owner decision 10.10.2026). Use these notes only for a build that contains it, after migration `20261010120000_hard_paywall_after_first_scan.sql` is applied in production. The earlier access experiment stays paused. The build must pass the real-device purchase/trial checks and receive exact-build owner approval before these notes are submitted.

Paste the "Review notes" section into App Store Connect → version 1.0.4 → App Review Information → Notes.

## Review notes (English)

Kandro is a general wellness calorie and nutrition tracker for users aged 16 and over (age rating 16+). After every meal it suggests three dishes that fit the rest of the day. It does not diagnose or treat a medical condition and is not submitted in the Kids category.

**No login is required.** On first launch the reviewer completes a short onboarding (goal, age, body data and activity; five steps including the starting plan) and gives explicit consent before any nutrition, body, photo, voice-transcript or text data is transferred. Kandro then builds the personal plan on screen and shows it.

**Reviewer path:** onboarding → plan → consent → **one free AI analysis** (photo, voice or text; "Later" skips it) → confirm and save the meal → the result shows the meal, what is left today and three suggestions → any next step opens the **Kandro Pro paywall**. Please start the 7-day free trial with the App Store **sandbox** purchase sheet; the app then opens fully. "Restore Purchases" and "Account & help · Already have an account? Sign in" are on the paywall.

**Subscription and free trial.** A new install gets one free sample analysis and can save that first meal. After that, logging further meals, analyses, the plan and the daily view require Kandro Pro; this paywall has no close button. The annual plan is preselected and shows its monthly equivalent and the 7-day trial when Apple confirms eligibility; the monthly plan is the alternative. Without trial eligibility the button reads "Start Kandro Pro". Kandro Pro includes logging by photo, voice, text, barcode and search, daily balance, suggestions, history, the weekly review and AI analyses (fair use: up to 60 per day). The paywall shows price, period, auto-renewal, cancellation, Privacy Policy, Terms and **Restore Purchases** before purchase, and links **Account & help**, from which sign-in, restore, subscription management, saved meals, privacy policy, terms, consent withdrawal and account deletion stay reachable without a purchase. Accounts created before this change keep their earlier free scope (three free AI analyses, dismissible offer). Both the monthly and annual product currently include a seven-day free trial for eligible subscribers (Apple metadata checked 6 October 2026). Please use the App Store sandbox purchase sheet. Previously logged meals, settings, consent withdrawal and account deletion always remain accessible. Pro is shown as active only after Kandro's server verifies the Apple transaction; Restore Purchases repeats the same verification.

**Managing and cancelling (1.0.6).** For an active subscriber, **You → Kandro Pro** and **Account & help → Manage subscription** open a short in-app screen with the current plan and its renewal date. It may show up to two real App Store options before leaving: switching from monthly to annual (a normal purchase of the annual product) and, only if a Promotional Offer is configured in App Store Connect and Apple/RevenueCat sign it for this customer, that offer with its StoreKit price. A fixed **Cancel anyway** button sits at the bottom of this screen in every state; it is never hidden, disabled or delayed and immediately opens Apple's own subscription management (StoreKit sheet, fallback `https://apps.apple.com/account/subscriptions`). An optional one-tap reason is not required and does not change the flow. Cancelling in iOS Settings is unchanged. Without an active, verified subscription (including a locked account whose renewal is still retrying) "Manage subscription" opens Apple's management directly. Lapsed subscribers on iOS 18+ may see an Apple **Win-Back Offer** on the paywall ("Welcome back – …") only when StoreKit reports eligibility; price, period and the regular renewal price come from StoreKit and are shown before purchase. During Apple's billing grace period Kandro Pro stays active and a calm notice links to Apple's subscription management to check the payment method.

Subscription products:
- `com.hewaddorani.kandro.pro.monthly` (7-day free trial for eligible new subscribers)
- `com.hewaddorani.kandro.pro.annual` (7-day free trial for eligible new subscribers)
- Entitlement: `kandro_pro`

**Logging.** The central button offers:
1. Photo — camera permission is requested only when Photo is chosen. A torch button is available for dark rooms.
2. Describe — type a meal in your own words, or tap the microphone and speak it. Speech is converted to text by Apple's speech recognition (on device where supported); no audio is recorded or stored.
3. Barcode — scan a packaged food.
4. Search — pick a food from the German Federal Food Code (BLS) or product database without any AI call.

Every AI estimate goes to a confirmation screen where amounts can be changed and ingredients removed before saving. Nutrition values remain estimates, especially for portions, hidden ingredients and mixed dishes.

**Privacy controls.** Consent can be withdrawn under **You → Analysis & data use** (without Pro: **Account & help** on the paywall → Analysis & data use); analysis and cloud processing then stop while existing data is kept. **You → Delete account and data** (without Pro: **Account & help** → Delete account) permanently deletes the account, cloud data, the linked RevenueCat customer and local data in the app, without contacting support. An Apple subscription remains manageable in the Apple subscription settings, linked on the same screen.

**Age and calorie safety.** New users cannot select an age below 16 in this build. Existing users from earlier builds keep the applicable legacy safety protections. For ages 16–17 Kandro uses the adolescent Estimated Energy Requirement (DRI 2023) including growth, applies no deficit or surplus and shows no weight pace; they are excluded from analytics. Adults use Mifflin-St Jeor × activity factor; targets never fall below 1,300 kcal or 70 % of maintenance. There is no fasting mode or punishment mechanic.

Sign in with Apple is optional: under **You → Account** an anonymous account can be linked to an Apple ID. Deleting the account revokes stored Apple authorization when available. If no revocable authorization was stored, after confirmed deletion the app explains how to remove its Apple authorization in Apple settings. No login is required to use the app.

Support: https://getkandro.com/en/support
Privacy: https://getkandro.com/en/privacy
Terms: https://getkandro.com/en/terms

## What's New

The canonical DE/EN release notes are in `store.config.json`.
