# Architecture

## Apple link response repair — 5 October 2026, after Build 38

Native ID-token linking may commit the Apple identity while returning the earlier
identities array. The app now reads the same user back from Auth after a successful
link, then verifies the Apple subject before exchanging the single-use code. A
local pending marker survives a failed read or storage step and never stores the
code or token. Existing linked accounts can explicitly renew Apple sign-in to
finish a handshake interrupted by Build 38 without switching accounts or deleting
their data. A later cloud-sync failure has separate DE/EN feedback and cannot be
reported as a failed Apple link. The client correction shipped internally in Build 39; the deployed Apple key and
functions are unchanged. A read-only production check on 6 October found one stored
Apple token, last written 5 October at 21:42:48 UTC. This verifies a storage event,
not the absence of UI warnings or a device test of the next combined candidate.
Synthetic regression success alone does not certify device login.

## Verbindliche Eigentümerentscheidung vom 05.10.2026: ursprünglicher Claude-Paywall-Test

Der Eigentümer hat ausdrücklich bestätigt, dass die offene anonyme Zielgruppe und
Hard Paywall beabsichtigt waren. `20261005004721_restore_owner_anonymous_paywall`
stellt die zwei gesicherten Funktionsdefinitionen vor der konservativen
Rückänderung exakt wieder her. Öffentliche Aufnahme und Enforcement sind wieder
aktiv; ursprünglicher Beginn und Monatsprodukt bleiben gleich. Geeignete neue
Erwachsene dürfen anonym oder verknüpft teilnehmen; Kontoverknüpfung ist freiwillig.
Serverzuordnung einmalig 50/50: A mit Gratisrückweg, B ohne X vor neuen regulären
Einträgen. Identische sieben Trial-Tage und Folgepreise, echte Store-Berechtigung
und aktive Kaufrechte bleiben maßgeblich. Bestandskonten, Vorabnutzung,
Minderjährige und fehlende Trial-Berechtigung bleiben ausgeschlossen.

Die vorübergehende zusätzliche Gratis-Ausnahme für drei vorhandene B-Zuordnungen
ist zurückgenommen; Zuordnung, Zeitpunkt, Nenner, QA-Ausnahmen und Kaufrechte
sind unverändert. Die historische Spalte `preserve_free_access` bleibt ohne
Wirkung in der wiederhergestellten Resolverfunktion erhalten. Ausgeschlossene
Nutzer werden nicht nachträglich neu ausgelost. Analytics-Einwilligung und
QA-Ausschluss bleiben unverändert. Anonyme Neuinstallationen sind ohne erhaltene
Identität nicht vollständig wiedererkennbar; es wird kein Fingerprinting ergänzt.

Die folgenden konservativen Zwischenstände sind dadurch überholt. Mobile/native
Laufzeitdateien und das bereits geprüfte IPA 1.0.3 (38) ändern sich nicht.

## Native permission generation, 04.10.2026 (after Build 36)

The actual 1.0.3 (36) IPA lacked the photo-library and microphone purpose strings
and Apple rejected it with ITMS-90683. The speech plugin writes its microphone
purpose into config early; the camera plugin's later InfoPlist mod removed it
because `microphonePermission` was still `false`. Both plugins now share the
explicit dictation purpose, and the base plist declares the selected-meal-photo
purpose. DE/EN localizations contain both strings. This changes permission
descriptions, not when the app asks for access; Android camera audio remains off.
The privacy regression executes Expo's native InfoPlist mods, so a later plugin
deletion cannot pass merely because app.json contains the text. Actual isolated
CNG output is checked separately before another Store build. Build 36 itself
remains unchanged and is not a testable or reviewed replacement.

## Aktueller Folgestand, 04.10.2026

Die datierten Abschnitte darunter sind historische Zwischenstände. Insbesondere
die spätere Öffnung für anonyme Neuinstallationen ist wieder zurückgenommen:
`20261004145423_restore_verified_new_adult_paywall` ist remote geprüft, das
öffentliche Experiment ist aus. Nur neue, freiwillig verknüpfte und verifizierte
Erwachsene ohne frühere Nutzung und mit bestätigtem gültigen Sieben-Tage-Angebot
können künftig teilnehmen. Serverzuordnung, Kaufrechte und Messzustimmung bleiben
getrennt. Build 1.0.3 (26) ist intern verfügbar; die folgenden lokalen Änderungen
sind nicht Bestandteil dieses bereits gebauten Artefakts. Maßgeblicher Nachweis:
[Growth-Folgearbeit](qa/GROWTH-FOLLOWUP-2026-10-04.md).

- Optionale Wunschgewichts-/Datumsfelder erweitern den vorhandenen Profilvertrag
  additiv. Das kürzere Onboarding und die Plan-Zusammenfassung ändern keine
  Ernährungsformel. Minderjährige erhalten keine Erwachsenen-Zielgewichtsführung;
  ein nachträglicher Planeditor darf das bestätigte Alter nicht umstellen.
- Die gemeinsame Paywall bevorzugt das Jahresprodukt nur bei tatsächlich
  bestätigter Berechtigung und sieben kostenlosen Store-Tagen. Manuelle Auswahl,
  Gesamtpreis und Kaufabbruch bleiben erhalten. Trialaktivierung und Erinnerungen
  lesen reale Entitlement-Zeitpunkte; ein Ablauf-Timer und App-Foreground-Abgleich
  entfernen veraltete Aktivierungshinweise. Ohne bereits erteilte OS-Erlaubnis
  wird keine Trial-Enderinnerung heimlich aktiviert.
- `weeklyReview` wertet abgeschlossene lokale Siebentagesfenster aus. Fehlende
  Tage sind fehlend, keine Nullaufnahme. Der Proteinvergleich benötigt jeweils
  mindestens drei erfasste Tage und verwendet ungerundete Summen; gerundet wird
  erst die Darstellung. Pro-Details und Erwachsenenansprache behalten ihre Gates.
- `repeatMeals` bildet „Wie gestern“ aus tatsächlichen Frühstückseinträgen mit
  korrigierten Mengen und Quellen. Der bestehende Speicherweg bleibt zuständig;
  Anzeigen allein erzeugt keinen Eintrag. Enge Nudeln-/Parmesan-Brücken nutzen
  bestehende BLS-Identitäten und erhalten Zubereitungs-/Produktgrenzen.
- Die zusätzliche RevenueCat-Auswertung besitzt eine eigene standardmäßig
  ausgeschaltete Kontoeinwilligung, erreichbar auch auf der Hard Paywall.
  [Messvertrag und Nachweise](REVENUECAT-EXPERIMENT-MEASUREMENT.md) beschreiben
  drei feste Attribute, Widerruf, serialisierte SDK-Identität, frische serverseitige
  Access-Autorität und den schmalen StoreKit-Herkunftsfilter. QA/TestFlight,
  unbekannte Herkunft und allein gecachte Zuordnungen gestatten keinen Export.
  Die gezielt bereitgestellte QA-Quellenmigration erhält den Messausschluss nach
  QA-Ablauf, ohne den abgelaufenen Zugangs-Override zu verlängern.

Zielprofil-/QA-Migrationen sind remote mit 12/12 Readbackprüfungen bestätigt;
`nutrition` 63 enthält die BLS-Referenzbrücke und die danach bestätigte enge
Pasta-Sortierkorrektur. Neun Readbackgates und alle 16 Quellhashes stimmen mit
dem geprüften Paket überein; JWT bleibt an, die vier anderen Funktionen unverändert.
Der Sieben-Tage-Jahres-Trial
ist für 175/175 Gebiete eingerichtet, reguläre Preise unverändert. StoreKit muss
das Angebot und die individuelle Berechtigung weiterhin auf dem Gerät liefern.

Die vollständige Suite nach sämtlichen Funktions- und DE/EN-Textkorrekturen ist
am 04.10.2026 um 15:41:38 UTC mit Exitcode 0 bestanden, einschließlich Expo Doctor
18/18 und Webexport. Host und Widget-Extension kompilieren mit der neuen nativen
Herkunftspolicy. Tatsächliche Browserwege belegen Onboarding/Persistenz,
Frühstückwiederholung, Mengenänderung, die enge EN-Suchkorrektur und genau einen
bewusst ausgewählten ersten EN-Erinnerungstermin einschließlich Auswahlwechsel;
Auth-/Storegrenzen sind dabei deklarierte lokale Fixtures. Die native Bedienung
ist wegen hängendem Simulator-Systemstart vor Appstart weiterhin ungeprüft.

Gemini und KI-Suchhilfe bleiben aus. Synthetische UI-/Bildfixtures belegen weder
reale Fotoqualität noch StoreKit-Kauf oder RevenueCat-Zustellung. Neue native
Bedien-, physische Upgrade- und Store-Nachweise stehen im datierten Bericht
getrennt von Modul-/Compilerprüfungen.

## Focused description/photo follow-up, 2026-10-03

The mounted scan tab now restores the active, unsaved description when returning
from confirmation or an analysis error. A newer local edit takes precedence.
Scan identity, completed saves, explicit scanner close and private-data invalidation
clear the form and its RAM-only draft; an obsolete account revision cannot restore
or re-save it. Focus uses current refs without adding unstable context values to
the navigation effect. This client repair requires a new binary after Build23.

The shared description amount binder preserves separate explicit quantities across
DE/EN connectors, fractions and per-portion multipliers. Exclusions remove only an
exact, uniquely identified constituent; contradictory affirmative mentions require
clarification. Plain chicken cannot bind a composite soup. A model-omitted weighed
food may recover its query only from an exact high-confidence existing BLS identity,
without a conflicting detected row; unresolved identities retain correction.
Postposed per-piece amounts preserve their count and total; exact weighed pure
olive oil does not retain a spurious hidden-amount warning. Other ingredients,
unweighed oil, mixtures and the photo path retain their uncertainty checks.
The photo prompt distinguishes identifiable food from sharp non-food imagery and
a dominant foreground meal from equally prominent separate meals. Reference
wording accepts only plain white bread rolls and explicitly raw shredded carrots.
These helpers are shared by hosted and development gateways. Native targets,
consent, authorization, model route and nutrition formulas remain unchanged.
See the continuing capture QA report for bounded real model outcomes and remaining
physical-camera/weighed-portion limits; no universal accuracy is claimed.

## Scan feedback, 2026-09-30 (local only)

The correction screen uses the existing authenticated, free database search for unresolved plain milk names containing a fat percentage. A narrow identity helper suggests a category query while retaining the original name visibly. It never discards plant-based, lactose-free, flavour or mixed-food qualifiers; it never auto-selects a food or changes nutrition. Selection uses the existing portion sheet and ingredient-ID replacement. Late/duplicate lookup responses remain guarded. No backend or nutrition resolver change. Real photo URIs use contain in the shared MealPhoto component; the demo image retains cover. Image compression/upload and temporary-photo retention are unchanged.


## Sync follow-up, 2026-09-27 (local candidate)

Legacy snapshot comparison tolerates only factor rounding within the old
`numeric(6,3)` precision and ingredient ordering. Identity, grams, reference
grams, nutrients, source and inclusion must still match. This also rechecks
legacy conflicts without a mutation ID already flagged by Build 19; genuine
pending/conflicting mutations are never automatically overwritten. Normal
save equality remains strict. Missing historical per-100g / portion metadata
is still enriched by ingredient ID and queued as a new mutation.

Proposed migration `20260926221131_meal_portion_factor_range.sql` widens the
factor column to `numeric(10,6)` with a finite upper bound of 5000, supporting
ratios from the already accepted 1..5000 g inputs without rebasing or clamping
the user's quantity. Existing nutrition/gram checks, RLS, RPCs, retry receipts
and owner isolation remain unchanged. This migration is **local only** until
separately authorized for production. The previously deployed atomic-sync
migration remains unchanged. See `docs/qa/SYNC-KORREKTUREN-2026-09-27.md`.

## Local stabilization candidate, 2026-09-26 (not published)

Local JSON reads now fail explicitly when damaged; absence alone means an empty
value. Initial hydration blocks protected UI and offers a non-destructive retry.
Weight/profile/analysis-queue writes are serialized and account replacement waits
for them. A durable deletion marker hides its meal even if the later diary write
was interrupted. Async save/delete callbacks reject an obsolete account generation.
Unit changes persist before display; a pending-write counter keeps a rapid return
to the original unit from being discarded as an unchanged selection.

Store and server states distinguish active, pending, cancelled, interrupted and
failed outcomes. Native-store refresh always consults server entitlement, even if
the SDK reports Free. Purchase/restore locks are synchronous and late results after
account/consent changes are ignored. Server authority, cache lifetimes and grace
periods are unchanged; a store success alone never grants Pro.

Whole-meal portions preserve tenth-gram base amounts within the existing 1–5000 g
input bounds. Repeating a saved meal uses the free `plan` origin and a shared
in-flight operation. The existing same-day recommendation filter is unchanged.
Progress explicitly compares all seven days with the **current** protein target;
no historical target or weight-cloud-sync system was added.
The confirmation heading wraps the uncertainty badge at larger text sizes.

See [stabilization QA](qa/KANDRO-STABILISIERUNG-2026-09-26.md) for evidence and
limits, including the initial native test isolation failure. QA SDK/network
adapters live outside this repository and must never enter a production bundle.


## Appearance and amount editing (Build 8 remediation)

- Reviewed food-family conflicts are a separate decision from a BLS lookup miss. Both gateways block automatic USDA fallback for those ingredients, including results cached or fetched for another item with the same query. Existing correction-protocol/legacy rejection behavior remains authoritative; eligible unrelated ingredients still resolve normally.

- Result projection replaces any saved meal with the current draft's ID before computing consumed and remaining nutrients. Confirmation upserts the revision once per Result mount, including already-logged scans. The reveal's starting budget excludes that same meal, keeping edits and unrelated meals consistent without double-counting.

- Local recovery candidate, September 6: reviewed whole-term crispy muesli, remoulade and paprika-potato-chip aliases use existing BLS family rows with `estimatedReference` provenance and medium confidence. The app adds one localized typical-value disclosure. Granola uses its dedicated baked-granola row; fruit/chocolate muesli remain separate. A localized alias cannot override a different English preparation qualifier. No Milka LU-to-wholemeal-biscuit substitution is added. The server portion was deployed as nutrition version 50 after explicit user approval and passed DE/EN live checks; the disclosure UI still requires a new mobile build for TestFlight users.

- Build 13 feedback: `food-query.mjs` separates lookup identity from portion words and normalizes a bounded set of equivalent terms. Both gateways use the same canonical query; the user's name, gram amount and piece count are unchanged. Reviewed whole-term aliases bridge common ingredients to existing BLS rows, with medium confidence for generic references. Decimal fat percentages remain atomic, so 3.5% cannot collide with 5.3%.
- Follow-up screenshot tests exposed `pistachios in shell`; a live description exposed `raisins green dried`. Whole-term raisin colour/seedless variants now use the generic medium-confidence raisin reference. Shell presentation is removed only for an allowlisted nut identity while roasting/salt qualifiers and the detected edible grams/count remain unchanged. This is lookup normalization, not a shell-to-kernel weight conversion or a claim of measured cultivar nutrition.
- Exact ingredient/preparation matches take precedence over contradictory model dish keys; egg dish keys also require compatible preparation. Generic USDA analysis queries use 25 Foundation/SR Legacy/Survey candidates rather than branded-product-dominated results. Transformation conflicts (e.g. rice/noodles, almond/milk) remain rejected. Retry variants may normalize boiled/steamed to cooked but never discard preparation. Cache version 8 separates the revised matching from older choices.

- Barcode labels use the shared `openFoodFactsNutrition` boundary in both gateways. All four core fields must be present, finite and non-negative; genuine all-zero labels remain valid, but zero energy with substantial macros is rejected. Source decimals and the client's per-100g reference are preserved. Missing data produces an explicit correction path, not invented calories.
- Progress weight inputs and persistence share 35–350 kg validation and hundredth-kg storage precision, preserving tenth-pound entries. Out-of-range measurements are rejected rather than clamped. Profile edits carry `editedAt` separately from onboarding completion; same-account hydration compares this edit revision while retaining the authoritative missing-cloud-age guard. Unit changes persist an explicit profile snapshot, never a side effect of React executing an updater.

- Analysis requires complete nutrient references before a meal may be saved. Legacy requests still reject the whole result with `missing_nutrition`. New clients explicitly request `ingredientCorrection: 1`: an unmatched lookup returns an editable `correctionRequired` draft with all detected rows preserved, not a complete calorie result. Both gateways share the protocol helper. Unresolved placeholders never display as zero kcal and block totals, confirmation, result-route mounting, and persistence even if their checkbox is excluded. The user must replace the food from search/barcode digits or explicitly confirm its removal. Lookup failures refund the analysis allowance as before; provider rate limits still account for the calls. Corrections themselves do not call the model. Complete responses retain existing idempotent quota semantics.
- Confirm now shows every ingredient with grams/household amount and kcal, including foods without countable portions. `correct-food` changes only the selected ingredient; scan ID, photo, original description, other amounts and meal slot remain intact. The edited meal title follows the corrected ingredient names. The high-confidence badge is now labelled as an estimate; it is not a calibrated probability of visual identity or portion correctness.
- A manually repaired, refunded draft is saved in the existing free-entry origin bucket (`plan`, also used by search/barcode). This prevents legacy history hydration from charging it later by counting `origin=scan`. Fully resolved AI responses remain `scan` and retain their normal allowance accounting. The original description remains visible on the result as well as confirmation.
- BLS English translations that call German Pommes frites "potato chips" are disambiguated as "French fries" in the lookup/display layer. Source rows and nutrient values remain unmodified. Whole-term potato crisps/chips use K280100, fries retain X654042; ordinary chips outrank calorie-reduced variants in search. Unambiguous German ingredient names also protect against a contradictory translated model query.
- Exact unambiguous BLS ingredient names (including dried dates) complement dish keys; USDA automatic matching requires food-identity tokens, not merely shared preparation words. Versioned cache keys invalidate previous misses/mismatches. Client response validation rejects unmatched legacy responses and invalid resolved nutrients even in the correction protocol.

- Onboarding and profile plan editing share the same exact-weight editor. Tapping the weight accepts comma/point and one decimal; invalid drafts do not mutate profile state. Metric buttons step by 0.1 kg and US buttons by 0.1 lb. Pound edits convert to kg without intermediate rounding, preventing display drift and skipped steps. Unit-only changes leave the stored kilogram value unchanged.

- USDA energy resolves legacy kcal, food-specific Atwater, then general Atwater fields. Missing energy/macros are not treated as a complete zero-valued reference. Cache version 5 invalidates previous mappings; source per-100g precision is preserved through scan correction. Zero-energy references with substantial macros are rejected rather than silently logged.
- Scan completion replaces confirm with result and dismisses back to the existing tab navigator. Repeated cycles no longer retain old correction/tab stacks. Camera mounting additionally requires navigation focus and foreground AppState; iOS acquisition is bounded to 1920×1080 before compression. These are preventive lifecycle corrections, not proof of the reported native crash's cause.

- Description input is retained in AppContext and shown on analysis/confirmation;
  text failures use text-specific guidance and return to the populated editor.
  Only photos are subject to image clarity / separate-plate rejection. Identified
  text still uses estimated portions; no-food text remains rejected.
- BLS search normalizes spaced German compounds and everyday oats/banana aliases;
  simple preparations rank above compound recipes. The reference catalogue now
  also separates beef/pork goulash from goulash soup using existing BLS rows.
- The delayed Plan paywall is cancelled on tab blur, including a save that
  completes after focus was lost, not only on component unmount.

- Search and standalone portion dialogs use a fade, with no animation under Reduce Motion. Tapping a detail-row gram value opens grams explicitly. Entry accepts decimal comma or point; resolution and app-state corrections preserve tenths of a gram. Nutrition display remains rounded, and search keeps the original per-100g reference for subsequent edits.

- `ThemeProvider` owns a device-local light/dark preference. First launch is light regardless of the OS setting; only an explicit saved dark selection changes it. The provider updates styles in place without remounting app/account state. `useThemedStyles` resolves palette-dependent styles; pistachio uses `onAccent` text instead of the adaptive body text color.
- Photo/text detection may return a localized piece label and count. The shared nutrition mapper derives estimated grams per piece from the total weight/count. No additional model invocation is needed. Unknown counts remain grams-only. Piece edits assume equally sized pieces and remain estimates.
- The search modal embeds the amount editor, avoiding simultaneous sibling native modals. On iOS, navigation waits for search dismissal. The amount editor keeps close/save outside its scrolling body and accommodates the keyboard.
- Amount corrections retain an unrounded per-100g reference in the in-memory/local meal item to avoid cumulative rounding. Existing cloud rows still contain numeric amounts/nutrients only; household-unit metadata is not currently restored from cloud history. Scan confirmation retains it throughout the active flow.

## Product loop

```text
Onboarding (goal, about incl. birth year, body, activity, plan reveal; 16+)
   ↓
Versioned explicit AI/wellness consent (+ optional adult analytics opt-in)
   ↓
First scan prompt (photo / speak / type, or "Später")
   ↓
Camera / description / barcode / demo capture
   ↓
Local resize/compression
   ↓
Authenticated hosted gateway → GPT-4.1-mini detection → BLS/USDA nutrition lookup
   ↓
Analyzing / retry state
   ↓
Detected-food confirmation
   ↓
Local save → optional Supabase sync (Auth + RLS)
   ↓
Meal result + projected daily balance
   ↓
Three contextual next-meal suggestions
   ↓
RevenueCat-backed paywall / safe preview fallback
```

The application deliberately keeps this loop narrow. New features should strengthen it before expanding into unrelated fitness functionality.

## Navigation

Expo Router uses `src/app` as the route root.

- `src/app/_layout.tsx`: root stack and application providers.
- `src/app/index.tsx`: initial redirect to consent, onboarding or the completed app.
- `src/app/data-consent.tsx`: named AI-recipient disclosure, explicit grant and future withdrawal.
- `src/app/onboarding.tsx`: localized personalization flow with metric, US and UK units.
- `src/app/(tabs)/_layout.tsx`: Today, Plan, Scan, Progress, and Profile tabs.
- `src/app/(tabs)/scan.tsx`: photo-first camera plus real description, barcode, search and demo fallbacks; AI analyses after the first three are gated by RevenueCat.
- `src/app/analyzing.tsx`: staged analysis plus deterministic consent, input, offline and provider errors; every success goes to confirmation.
- `src/app/confirm.tsx`: ingredient inclusion, one-tap meal portion sizing, and optional gram-level correction.
- `src/app/result.tsx`: animated meal estimate, projected remaining targets, automatic idempotent meal save, and delayed recommendation reveal.
- `src/app/paywall.tsx`: transparent annual/monthly choice backed by RevenueCat Offering prices, purchase, and user-triggered restore.
- `src/app/privacy.tsx` and `src/app/terms.tsx`: in-app bilingual legal copy generated identically on the public website.
- `src/app/account-deletion.tsx`: explicit irreversible deletion confirmation and subscription-separation warning.
- `src/app/(tabs)/progress.tsx`: real locally persisted weight history and meal-derived progress instead of fixture achievements.
- `src/components/AccountLinkCard.tsx`: anonymous account upgrade, email verification, password setup, and existing-account recovery from Profile.
- `src/components/AppRouteGuard.tsx`: keeps processing routes behind current consent while leaving consent, legal copy and deletion reachable.

Root stack routes sit above the tab navigator so camera analysis, confirmation, result, and paywall can focus the user on one step.

## State and calculations

`useLocalDay` refreshes the local date on foreground entry and every 30 seconds.
AppContext synchronously filters hydrated meal history when the day changes;
Progress uses the same date signal for its window and streak calculations.
Trial copy is advertised only after StoreKit reports introductory eligibility;
unknown eligibility falls back to the regular subscription price.

Empty scan confirmations are blocked both in the screen and the app-state save handler. Adolescent targets round the adolescent maintenance estimate directly, without adult calorie caps/floors. Below 200 remaining kcal, Today and Result show the target status with an explicit route to optional small-meal ideas; Plan continues to offer three options with their projected overage disclosed.

`AppProvider` owns active UI state, hydrates local storage first, and then optionally reconciles with Supabase:

- saved user profile, onboarding completion, targets, and dietary preferences;
- logged meals;
- 90-day meal history and local weight entries;
- detected meal items;
- temporary compressed photo URI;
- current analysis status and local retry count;
- derived consumed and remaining nutrition.
- current quick portion selection (`0.7×`, `1×`, or `1.4×`; `null` after custom gram edits).
- sync state (`local`, `syncing`, `cloud`, or `error`);
- lifetime free-scan usage derived from local or cloud meal existence.

`mockNutrition.ts` owns the deterministic scan fixture and pure calculations:

- `nutritionFromItems` totals included detected items;
- `createScannedMeal` maps corrected items into a meal;
- `sumMeals` derives daily consumption;
- `getRemaining` derives the daily balance;

`recommendations.ts` scores the paired 200-entry German/English catalogs by context, remaining calories/protein/fat, and saved preferences. Vegetarian, pork-free, and lactose-free choices are hard constraints; high-protein and quick choices affect ranking. It sorts deterministically and returns exactly three entries. The values are explicitly labeled Kandro planning references, not sourced measurements. The catalog validator enforces balanced context coverage, known tags, plausible nutrition ranges, calorie-to-macro consistency, translation parity, and 90 deterministic recommendation sets across 30 budget/preference scenarios.

Small-budget portions use `mealSuggestions.ts`: default suggestions are capped at the greater of 200 kcal and the remaining budget. Thus 200 kcal remaining produces at most 200 kcal suggestions; 20 kcal remaining still permits an optional roughly 200 kcal meal, explicitly shown as 180 kcal above the daily target. Plan computes this disclosure from the signed target-minus-consumed balance, including days already over target. This is proportional sizing of existing catalog meals, not AI recipe generation. Original nutrition and `portionScale` travel with the suggestion so preview, portion controls, recipe ingredients/amounts and saved nutrition use the same combined scale without cumulative rounding. Direct recipe routes retain the standard serving unless given a validated portion.

Today and Result use the calorie/protein range of the actual nine available suggestions across the three contexts, including saved dietary preferences. They no longer advertise an independent fixed protein range that smaller portions cannot meet.

The Pro paywall presents photo and text analysis as the paid benefits. Search, barcode, daily balance, next-meal suggestions and history remain explicitly labeled as permanently free. Purchase/restore behavior and RevenueCat prices are unchanged.

Screens must not maintain separate copies of these totals.

## Integration seams

The typed interfaces already live in `src/services/contracts.ts` and are the boundary for the next backend implementation:

```ts
MealAnalysisService
NutritionLookupService
MealRepository
RecommendationService
```

Current responsibilities:

- `mealAnalysis.ts`: client-side compression, temporary-file cleanup, photo/description/barcode gateway calls, mapping, and typed errors.
- `supabase/functions/nutrition/index.ts`: deployed authenticated and metered production gateway. It verifies the user JWT in the handler, applies the private daily counter, rejects oversized images, and keeps provider errors off the device. Its free search route reads a compact bilingual 7,140-row BLS 4.0 snapshot locally before any external provider call, so common foods are fast and their visible names follow the app language.
- `server/index.mjs`: optional secret-bearing local development gateway. GPT-4.1-mini through OpenRouter or direct OpenAI returns food identity, preparation, portion range, hidden-calorie risk, and confidence from a photo or description only. BLS 4.0 supplies deterministic values for 64 reviewed plate-level matches and a bilingual 7,140-entry search catalogue; USDA is the automatic ingredient fallback; Open Food Facts provides packaged-food barcode data. Both gateways share detection, BLS and USDA logic under `supabase/functions/_shared`. OpenRouter routing requires supported parameters, denies data collection, and defaults to ZDR.
- `localRepository.ts`: profile/onboarding, weight entries, confirmed meals, lifetime scan history, and a maximum-three local retry queue in AsyncStorage.
- Logging flexibility (October 2026): meals carry their own `date` (cloud `meal_date`); a back-dated meal (Today's day switcher or the Confirm "Heute · Mittagessen" selector, at most 30 days back, never in the future) is saved with `savedAt`/`eaten_at` at the slot's usual time on that day (`src/utils/mealDay.ts`) and enters only `mealHistory`, never today's `meals`, totals or plan. Favourites are local only (`@kandro/favorite-meals:v1`, cleared with every account reset/switch) and lead the "Nochmal essen" strip. Foods picked in one search sheet save as one multi-item meal. Amount ambiguity returns `estimatedPortion` drafts (still refunded via `correctionRequired`) instead of a 422; the app also matches unpriced rows against the on-device catalogue and shows a three-state confidence badge.
- `supabaseClient.ts`: optional public-client initialization, persisted React Native sessions, foreground token refresh, and anonymous authenticated bootstrap.
- `accountLinking.ts`: ID-preserving email upgrade with `updateUser`, email-change verification, password setup, and existing-account sign-in.
- `consent.ts`: versioned local wellness-data consent mirrored to the user's RLS-protected profile.
- `accountDeletion.ts`: authenticated Edge Function invocation, local cleanup, analytics reset/opt-out, and deliberate cloud-disable state after deletion.
- `cloudRepository.ts`: maps the actual profile/targets and meal domain records to RLS-protected Supabase rows, checks cloud scan history for the free boundary, and records recommendation feedback.
- `syncRepository.ts`: preserves local-first writes, uploads pending local scans during hydration, and merges cloud meals back into domain state.
- `subscription.ts` + `SubscriptionContext.tsx`: platform/Test Store key selection, Supabase-user identity, current Offering, `kandro_pro` entitlement state, purchase cancellation, and user-triggered restore. Without public SDK configuration, the paywall remains a clearly labeled non-billing preview.
- Server entitlement confirmation uses RevenueCat's authenticated v2 subscription response: `gives_access`, Apple store/environment, exact server-owned iOS product resource allowlist and active entitlement resource ID. Nested entitlement `products` is optional in the real API, not a prerequisite for access; when present it is checked for contradictory app/product metadata. Both the refresh route and webhook use this shared parser. No client flag grants Pro.
- `telemetry.ts`: optional PostHog client with a typed event allowlist, anonymous-only profiles, no health-value properties, persisted opt-in/out, and scrubbed operational error capture. It is a no-op when the public project token is absent.
- `recommendations.ts`: deterministic scoring over the bilingual Kandro planning catalog with explicit typical-value provenance.
- `supermarketCombos.ts`: Plan → Supermarkt. Builds three shopping baskets (one protein anchor plus an optional carb and extra) from `src/data/supermarketProducts.json`, a bundled Open Food Facts extract of real German supermarket products (plus five loose fruits from BLS 4.0 with estimated piece weights). Amounts are whole packs, half packs, multipack cups or the label serving; nutrients are label values and never altered. Deterministic, preference-aware (diet flags only from OFF labels/ingredient analysis), never more than 10 % above the remaining budget. "Das hole ich mir" opens the normal confirm screen prefilled with every product (`startPlannedDraft`, scan mode `plan`, free, saved as a recommendation). The dish catalogue remains the fallback if fewer than three baskets fit. Data is rebuilt with `node scripts/build-supermarket-products.mjs` (≤ 1 request/s, User-Agent `Kandro/1.0`) and checked by `scripts/validate-supermarket-combos.mjs`.

Raw provider payloads should be mapped to the domain types in `src/types/nutrition.ts` before reaching React components.

## Privacy boundary

The current analysis pipeline:

1. resizes to 1024 px on the long edge and compresses to JPEG (q0.8, target about 600 KB) locally, after the scan screen's guide-frame crop;
2. deletes the camera original after the compressed working copy exists;
3. sends the working copy to the authenticated Supabase gateway, or to the explicit local development override;
4. keeps at most three failed scans locally for explicit retry;
5. persists only the user-confirmed structured meal;
6. never retains photos as part of saved meal records.

Age is part of the processing boundary, not display copy. Kandro is 16+: the client blocks onboarding under 16 (`MINIMUM_AGE` in `personalGoal.ts`) and no longer offers a guardian flow. The database still rejects profiles below 14, and for profiles created earlier at 14–15 the server-owned guardian columns and the `guardian-consent` function are retained but unreachable from the app; an authenticated client cannot write them. The nutrition gateway checks age, guardian approval for those legacy profiles and the current privacy version before any barcode, search, text or photo request. Ages 16–17 use the adolescent EER maintenance path with no goal offset, and PostHog opt-in is disabled for them.

The compressed preview lives only in the app cache during the active flow. The production gateway is authenticated and metered, sends the image directly to the configured model provider with storage disabled, and does not persist it in Supabase. Final legal/provider disclosure and retention review remain launch gates.

Product analytics never receives photos, food or ingredient names, email addresses, Supabase user IDs, calories, macros, weights, or goals. Only the events and categorical properties documented in `docs/ANALYTICS.md` are accepted by the client. PostHog person profiles, GeoIP, automatic lifecycle/touch/screen capture, feature flags, push capture, and session replay are disabled; device name/model/manufacturer, locale, timezone, and screen dimensions are stripped before send. The user can persistently opt out from Profile.

During Expo Go testing, the root React error boundary and explicitly caught integration failures report scrubbed JavaScript errors through PostHog. Native Sentry crash reporting is reserved for the development/TestFlight build because the official React Native SDK includes native iOS and Android code that Expo Go does not bundle.

The `delete-account` Edge Function requires a valid user JWT, deletes that exact Auth user with server-only admin privileges, and relies on foreign-key cascades for owned rows. After a successful response, the app clears local meals, queued scans, consent, and telemetry state and does not silently create a replacement anonymous account. The live deletion regression verifies the profile cascade and that the deleted refresh token cannot mint another session.

### Analysis robustness and latency (2026-10-10)

A paid analysis makes at most two model calls inside one request: the first
on `OPENROUTER_VISION_MODEL`, and one automatic retry only after a transient
failure (timeout, 5xx/network, unparsable or truncated output; a 429 only
when a different fallback model is configured). The retry is the cheaper path:
the same photo at `detail: low`, on `VISION_FALLBACK_MODEL` when that optional
secret names an allowlisted Azure-routed OpenAI model (Gemini is never
selectable this way). The user's allowance is reserved and counted once per
request; the retry claims one more unit of the global cost breaker and is
skipped when that is exhausted. Structured output tolerates framing slips
(code fences, trailing text, trailing commas) before schema validation, which
still rejects any content error. Uncached USDA lookups run three at a time.
Each analysis logs one `nutrition timing` line with fixed codes and durations
only (access, model, lookup, total, attempts), never content or identifiers.
`scripts/validate-vision-robustness.mjs` covers this contract;
`npm run eval:analysis` runs 48 German descriptions offline through the
shipped resolution path and reports usable rate, BLS match rate and kcal
plausibility.

## Supabase ownership boundary

### Final-pass network and image boundary (2026-09-06)

The mobile gateway uses a single 90-second deadline across session acquisition,
HTTP headers and JSON body consumption. Expiry aborts the fetch and follows the
existing localized offline/retry path; a token arriving after expiry cannot
start an upload. Unknown provider error prose and warning codes are not exposed
as untranslated UI text. Tests exercise the transpiled client module with
controlled timers and fetch responses.

The hosted nutrition function validates base64 syntax and JPEG SOI/EOI markers
before invoking vision. Oversized bodies still reach the existing 413 guard.
This is structural input validation, not a complete image decoder. Version 51
was deployed with explicit owner approval and source-readback/live regression
checks; production JWT verification stays enabled.

Device language selection follows the first supported DE/EN language in the
ordered locale list; an explicit stored app choice takes precedence. Device
region uses regionCode or Intl.Locale region parsing, independently of language,
units and StoreKit storefront. Unsupported languages fall back to English when
there is no supported preference. This does not claim worldwide localization.

Meal ingredient amounts use `numeric(8,1)` for both current and base grams, preserving the one-decimal portion editor through cloud round trips. Existing 1–5000 g constraints remain authoritative. Cold confirm/result routes require a ready in-memory draft before mounting; `logScannedMeal` independently rejects initial demo state.

The mobile app receives only the project URL and publishable key. Supabase Auth supplies a per-user JWT, and Postgres RLS limits product rows to `(select auth.uid()) = user_id`. The client never receives a provider secret or `service_role` key. `profiles`, `daily_targets`, `meals`, `meal_items`, `recommendations`, `recommendation_feedback`, and `analysis_usage` all enable RLS and revoke access from the unauthenticated `anon` role. The quota table additionally has no client policies or table grants.

Anonymous sign-in is used to avoid blocking the first scan. It is an authenticated Supabase user, not unauthenticated public database access. The Profile account card upgrades it with a verified email through `updateUser`, verifies that the returned identity still has the same user ID, and then lets the user set a password. Existing accounts can sign back in and rehydrate their RLS-owned cloud data. Clearing app data before the upgrade can still make an anonymous account inaccessible.

### Paywall Dynamic Type layout (2026-09-06, local post-Build-15 fix)

`paywall.tsx` uses `useWindowDimensions().fontScale`: above the default scale,
plans and purchase/legal controls share the same ScrollView. Default text keeps
the bottom purchase area fixed. Enlarged plan prices flow below descriptions;
restore and legal links can wrap. The root native subtree remounts on a font-scale
change to invalidate stale iOS text measurements while React subscription/plan
state stays owned by the screen. `PrimaryButton` grows for wrapped text and lets
the label shrink alongside its icon. No billing or entitlement logic changed.


### Onboarding introduction and search UX (2026-09-18, LOCAL ONLY)

- `WeightEntry` replaces the hidden modal/0.1-unit picker for onboarding weight with a visible decimal input and ±1 kg/lb shortcuts. It accepts a comma or point and one decimal place, keeps the existing 40–200 kg bounds, and disables Continue for invalid drafts. Kilograms remain the internal representation; unit changes remount the input to prevent stale drafts. The Done control keeps its layout space on blur, preventing the first shortcut tap from being lost through layout movement.
- Successful first-run consent/setup now routes to `today?tour=1`, not directly to the camera. `AppIntroduction` points to the five existing tabs. It can be closed at any step, started again from Profile, or finished by opening Scan. The route parameter is cleared on dismissal, so it does not gate subsequent navigation. No persistent tutorial flag, schema change, permission prompt or analytics event was added. Profile editing still saves through its existing path.
- The introduction distinguishes free meal suggestions/search/barcodes from the lifetime allowance of three photo/text AI analyses (value read from `FREE_SCAN_ALLOWANCE`). No recommendation paywall or change to entitlements was introduced.

### Hard paywall after the first scan (2026-10-10)

- Server (`20261010120000_hard_paywall_after_first_scan.sql`): `private.paywall_config.hard_after_first_scan` (on) with a cutoff stored once at apply time. Accounts created after it, without a pre-cutoff assignment and not in a live A/B/QA variant, get `mode: 'hard_after_first_scan'`, `freeAnalyses: 1` in `paywall_access_v1`. `reserve_analysis_access` grants that many free analyses (3 otherwise). The first new meal is recorded in `private.paywall_free_meals` (trigger `guard_new_paywall_meal`, serialized per account); from then on `hard = true`, so the existing gateway 402, meal receipt (`authorize_meal_create_v1`) and meal trigger require an active RevenueCat entitlement (a running trial gives access). Existing accounts report `mode: 'legacy'` and are unchanged. Postgres regression: `scripts/validate-hard-paywall-postgres.py`.
- Client: the server mode is authoritative. `services/hardWall.ts` keeps the install side: `cohort` (set by `startHardWallInstall` when a fresh onboarding completes), `used` (first meal created in `saveSyncedMeal`, any meal in history, or "Später" on `/first-scan`) and the last `serverMode` published by `appAccess`. Without a server answer the cohort flag applies (offline: first scan allowed, then paywall). `accessPolicy.applyHardWall` turns a used hard-wall record into a hard one; `AccessContext.record`, `assertNewAppUse` and `authorizeMealCreate` all use it. `AppRouteGuard` keeps only the first meal's `/result` reveal open while the first run is at `scan`; everything except paywall, account help, legal pages, data consent, saved meals and deletion goes to `/paywall`, which then has no close, swipe or back. `useFreeScanAllowance` supplies 1 or 3 to the counters and copy.

### First run: value before the offer (2026-10-09)

- Order: goal → about (year of birth, no preselection) → body → activity → plan reveal → consent sheet → `/first-scan` → normal scan/confirm/result → soft paywall (once) → optional reminder question → the tab chosen on the result (Today or Plan). Target weight/pace and food preferences left first run (defaults: calm 0.25 kg/week, no target, "Proteinreich") and are edited under Du → "Ziel und Angaben ändern" (`onboarding?edit=1`, all steps).
- `services/firstRun.ts` stores the stage (`scan` | `paywall`) in AsyncStorage; `AppRouteGuard` sends primary tabs to `/first-scan` until a meal exists, then to `/paywall`, and suppresses the A/B entry paywall during the run. Viewing the paywall prepares the existing reminder-onboarding flag and clears the stage. Installs from before this flow have no stage and are unaffected. The Today tour is no longer opened automatically (still available from Du).
- Kandro is 16+: under 16 sees a block screen; the guardian flow is no longer reachable from the client (server function and DB boundary unchanged for earlier 14–15 profiles). 16–17 keep the adolescent formula and see "Gesünder essen". BMI < 18.5 never gets a deficit (`effectiveGoal` in `personalization.ts`), and a target weight may not fall below BMI 18.5.
- Onboarding answers are kept in `@kandro/onboarding-draft:v1` until completion so an app kill resumes on the same step.
- Local and hosted search handlers return at most 60 existing reference results. Scan initially renders 15 and reveals additional batches locally. Every new query resets that count; debounce/stale-response guards remain. Common bare queries for bread, milk and yogurt receive targeted bilingual aliases and ordering from existing BLS rows. Explicit requests for chocolate, breadcrumbs, gluten-free bread and yogurt dip retain their identities. Nutrition values and the 7,140-row source snapshot are unchanged.
- Full configured verification and DE/EN web interactions passed. Native simulator launch hung, including after a device restart; no native or physical-device pass is claimed. The simulator's prior AsyncStorage files were backed up and restored byte-for-byte. No new iOS build, TestFlight upload or gateway deployment was performed. Release still requires native checks and a paired deployment/build; save/sync and canonical meal-save analytics fixes remain outstanding.

### Native QA follow-up, 2026-09-18

The onboarding weight input now attaches an iOS `InputAccessoryView` to its decimal keyboard. The bar keeps Done and the current value/validation hint visible when the keyboard covers the inline controls. Web/Android retain the existing inline Done control. No native package upgrade is required. Version 1.0.1 is the next TestFlight candidate; remote build number remains EAS-managed. See the workspace `Native-Test-2026-09-18/` evidence for the simulator scope and separate physical-device limitations.

## Release A integrity changes, 2026-09-25 (local candidate, not deployed)

The following supersedes earlier descriptions of two independent meal UPSERTs
and missing cloud reference metadata. It does not describe the currently public binary.

- A canonical local meal save is serialized and stores `Meal.sync`: account owner,
  base cloud revision, stable UUID mutation, bounded ancestor mutation IDs and
  pending/synced/conflict state. Local success remains separate from cloud success.
  Stable `savedAt` and mutation IDs survive process restarts and retries. Repeated
  unchanged taps retain the same draft; local edits do not inflate `meal saved`.
- The matching schema migration is `20260925142154_atomic_meal_sync.sql`.
  `public.mutate_meal_v2` is an authenticated invoker wrapper around a private,
  owner-checked definer. It locks one account/meal, checks the expected revision,
  replaces parent and complete child set in one transaction, validates included
  nutrient sums and stores per-100g references, household portions, estimated
  provenance, item ordering and metadata version. An invalid child rolls back
  parent, children and sync state. Empty ingredient sets require zero totals.
- Private `meal_sync_state` contains revisions, deletion tombstones and the last
  64 mutation receipts per meal. It has RLS and no client table privileges. A
  retained receipt makes retries idempotent; older receipts eventually produce
  a conflict rather than authorizing a stale write. No analysis quota is touched.
- Legacy direct writes advance revisions through triggers. Existing rows are not
  rewritten. Legacy clients still have their original two-request save limitations;
  the full fix requires this migration AND the matching mobile build. Rollback
  must preserve stored metadata and tombstones; do not automatically drop them.
- Cloud history is read in pages within the existing 90-day history window;
  tombstone lookups are batched. Cloud hydration persists remote meals locally,
  preserves pending edits, recovers compatible legacy local reference metadata,
  and never silently uploads an ambiguous older local copy. Account generation
  and session checks reject late responses during an account switch.
- Conflicts persist until an explicit choice on Today. The latest cloud copy can
  replace the local draft; a chosen local copy uses a fresh expected revision.
  A remotely deleted meal is restored only under a new ID. Pending local deletes
  hide the meal until acknowledgement; conflicting deletes require a separate
  explicit choice. The local record remains available if the network fails.
- OFF search and barcode share `openFoodFactsNutrition`. All four core nutrients
  must be valid; missing/null/empty/negative/non-finite fields are not synthesized
  as zero. Explicit kJ energy is converted only if the kcal field is absent.
  Source and serving decimals are retained until display/portion calculation.
- `caloriePlan` is the shared source for requested/applied offsets, rounding,
  floor/cap and final calorie target. The underlying target rules are unchanged.
  The onboarding rate is described as a planning estimate, not a promised outcome.
- All 85 recipe ingredient references declare reference and weighing states.
  Raw BLS records replace contradictory cooked meat/fish/vegetable references;
  raw eggs and peeled boiled eggs remain distinct. Turkey mince recipes explicitly
  use minced skinless turkey breast; beef mince uses lean beef mince (Tatar).
  Gnocchi use a raw BLS reference. No universal cooking-yield factor is introduced.
  All 67 recipes and both catalogues were recalculated from their actual inputs.
  The protein preference now uses the offered portion's protein values as a
  ranking signal instead of relying on the previous editorial tag alone.
- Tests: `validate-release-a.mjs` exercises runtime adapters/local persistence and
  all recipe states. `validate-meal-sync-postgres.py` uses a separately initialized
  Unix-socket PostgreSQL cluster and synthetic auth fixtures for real rollback,
  concurrent connections, RLS, deletion and metadata tests. Neither is a live
  Supabase, StoreKit, physical camera or public-binary test.

Production ordering: read-only integrity inventory, authorized migration and
advisors, authorized gateway publication and smoke test, then matching mobile
candidate and physical TestFlight QA. Existing discrepancies require a separate
reviewed repair; `supabase/queries/audit_meal_integrity.sql` reports counts only.
There is deliberately no fallback to the old partial-write protocol if the new
RPC is unavailable: the meal stays local and synchronization remains unconfirmed.

## Lokaler Erfassungskandidat vom 01.10.2026

Der Erfassungspfad besitzt einen gemeinsamen streng validierten Modelladapter, eine deterministische Bindung expliziter Textmengen und eine Massenprüfung für USDA/OFF. Normale Suche trennt Katalog während der Eingabe von ausdrücklich abgesendeten Anbieterabfragen und liefert Teil-/Fehlerstatus. Warme Caches ersetzen keine verteilten Quoten. Protokoll 2 ergänzt persistente Auftragsquittungen für Korrektur- und Fehlerfälle, bevor Wiederholungen Kostenzähler erreichen. Alte Clients/Consent bleiben kompatibel.

Gemini `google/gemini-3.8-flash` über `google-vertex/global` und die getrennt budgetierte Suchhilfe sind lokal implementiert und durch eine harte Serversperre deaktiviert. Neue versionierte Zustimmung ist scopegebunden; eine Suchzustimmung erlaubt keine Fotoübertragung. Der bisherige Responses-/Azure-Pfad bleibt erhalten. Neue Migrationen sind lokal; Modell-/Vertrags-/Gerätenachweise fehlen. Details und Datenlebensdauer: [Erfassungskandidat](qa/ERFASSUNG-GEMINI-2026-10-01.md).

## Erweiterter lokaler Kandidat vom 02.10.2026

- Suche normalisiert begrenzte belegte DE/EN-Wortformen beidseitig, erhält Zubereitung und Produktnamen und priorisiert vollständige Grundzutaten vor zusammengesetzten Gerichten. Reihenfolgeunabhängige Komponententreffer und Matcher-Version `2026-10-02-v4` verhindern alte Cachetreffer nach der Reparatur. Nährwerte und Referenz-IDs werden dadurch nicht verändert.
- Der erste abgeschlossene Onboardinglauf führt optional über `reminder-setup`. Erst die bewusste Aktivierung fordert eine OS-Berechtigung an. `reminders.ts` verwaltet eine tägliche lokale Erinnerung beziehungsweise die beiden bewusst übernommenen alten Termine, ausschließlich eigene IDs und generische DE/EN-Inhalte. Profilverwaltung, Ablehnung, Fehler und Überspringen benötigen keinen Pushserver. Der frühere automatische Nach-Save-Prompt entfällt.
- `syncRepository` meldet ausschließlich erfolgreich neu lokal angelegte Mahlzeiten an `CaptureCompanion`. `reviewRequest` speichert lokale Nutzungs- und Anfragezähler; Demo/Updates/Replay zählen nicht erneut. Nach mindestens fünf Mahlzeiten, drei lokalen Tagen und 72 Stunden wird eine bewusste ruhige Rückkehr zu Heute abgewartet. Kamera/Entwurf/Tastatur/Fehler und die gemeinsame Präsentationssperre verhindern störende Angebote. StoreKit entscheidet über die Anzeige; ein API-Versuch ist kein Ratingnachweis. Version, 120-Tage-Abstand und drei Versuche in 365 Tagen sind lokale Grenzen.
- Konto-/Privacywechsel invalidieren zunächst private Begleitdaten. JS-Generation und synchroner nativer Generationstausch verhindern verspätete Widget-Schreibvorgänge; wartende Freigaben überleben den Wechsel nicht. Review-Nutzung wird gelöscht, datensparsame gerätebezogene Anfragegrenzen bleiben erhalten. Diese Zähler werden nicht als Analytics übertragen.
- Der lokale Expo-Modul `KandroWidgets` und das SDK-54-CNG-Plugin erzeugen eine echte WidgetKit-Extension mit drei Kinds: Today (small/medium), Entry und Photo (je circular/rectangular). Die App Group enthält nur einen atomaren versionierten Snapshot der vorhandenen App-Summen/Ziele, Sprache, lokalem Datum, Zeitstempel und neutraler Generation. Standard ist ein Aktionswidget; Summen verlangen explizite Auswahl im Profil. Lock-Screen-Kinds zeigen keine Nährwerte. Kein Widget-Netzwerk, kein Sessionzugriff, keine separate Ernährungsberechnung.
- Swift prüft Schema, numerische Grenzen, Tages-/Zeitzonenwechsel und zwei Stunden Maximalalter. Complete File Protection schützt den Snapshot, sensible Summaryansichten sind entsprechend markiert. Gezielte Reloads und eine Ablauf-Timeline ersetzen kein garantiert sofortiges Löschen bereits von iOS gerenderter Bilder. Galeriebeispiele enthalten keine echten Nutzerdaten.
- Widget-/Reminder-Links dürfen nur feste Erfassungsmodi öffnen. `+native-intent`, `captureIntents` und `capture` warten auf Hydrierung/Consent/Onboarding, deduplizieren letzte Antworten und schützen laufende Entwürfe. Ein Link startet weder Analyse noch Speicherung oder Kauf.
- EAS lädt `plugins/`, `widgets/` und `modules/` hoch, nicht das lokale `ios/`. Host und Extension müssen gleiche Version/Buildnummern erhalten. Gruppe `group.com.hewaddorani.kandro.widgets`, Extension `com.hewaddorani.kandro.widgets`, Team `85S69CVRAY`; entsprechende Apple-Capabilities/Profile sind noch nicht remote eingerichtet oder bestätigt. Native Simulator-Kompilierung ist kein signierter Store-Kandidat.


02.10.2026, freigegebene Fortsetzung: Beide Faktor-/Capture-Migrationen remote angewendet, Retention/Rechte geprüft; nutrition 55 ACTIVE/JWT nach realem Gratis-Smoke. Drei echte GPT-4.1-mini/Azure-Textfälle erhalten alle expliziten Mengen. Der daraus bestätigte USDA-Pluralfehler potatoes→potatoe ist behoben, Cacheversion 10, rote/grüne Regression und vollständiges Verify bestanden. Originalfehler bleibt im Nenner, kein Gemini-/Fotoqualitätsnachweis. Alle vier Medium-Widgetlinks tatsächlich nativ geöffnet. Sprach-/Warmstart-Entwurfsfehler repariert und nachgetestet. Apple-Anmeldung/Signierung und physische Pflichtfälle bleiben offen, kein Cloudbuild/Upload/Submit; genaue Ergebnisse/Budget im laufenden Erfassungsbericht.


### 02.10.2026 – Erfassungskandidat 1.0.3, echter Textvergleich

34 begrenzte echte Azure-Modellaufrufe einschließlich Ausgangs-/Nachtests; kein Gemini. Belegte Mengenbindungsfehler bei gezählten Eiern und Fettprozentformatierung behoben, Rot-Grün-Regressionen, gespeicherte Antworten replayt und vier gezielte neue Livefälle bestanden. Identität/Masse getrennt von Referenz-/Fotoqualität dokumentiert. `nutrition` 56 ACTIVE/JWT kompatibel veröffentlicht und kostenlos live nachgeprüft. Kompletter Verify-Gate und nativer Simulator-Host/Widget-Build 1.0.3 bestanden. EAS-Apple-Anmeldung/Store-Signierung, physische Pflichtfälle und Gemini-/Suchhilfeabnahme bleiben offen; kein Cloudbuild/Upload/Submit. Kosten, Quellmanifest und tatsächliche Grenzen im bestehenden `docs/qa/ERFASSUNG-GEMINI-2026-10-01.md`.


### 02.10.2026 – Store-Build 20: Privacy-Dateizuordnung korrigiert

Apple-Profile/App Group für Host und Widgets sind eingerichtet und direkt geprüft. Genau ein Store-Build 1.0.3 (20) erfolgreich kompiliert, aber vor TestFlight gesperrt: Bei frischem CNG griff React Natives Privacy-Aggregation für den Host auf die vorhandene Widget-Dateireferenz zurück. Im echten IPA fehlen dadurch die aggregierten Required-Reason-API-Angaben der Hauptapp. Der frühere wiederverwendete Simulator-Projektbaum enthielt bereits eine korrekte Hostreferenz und deckte diesen Fehler nicht ab.

`ios.privacyManifests` in `app.json` erzeugt jetzt durch das vorhandene SDK-54-Plugin vor CocoaPods eine eigene Hostdatei mit eigener Ressourcenreferenz. Keine SDK-/Anbieteränderung. `scripts/validate-widget-native-project.mjs <private-ios-dir> [--aggregated]` prüft tatsächliche Target-/Ressourcenreferenzen, getrennte Dateien, Duplikate und nach Pod-Installation die vier erforderlichen API-Kategorien. Regression am frischen alten Projekt rot; nach Reparatur mit zweimaligem Prebuild und echtem Pod-Install grün. Vollständiger Verify bestanden. Ein zusätzlicher Store-Build ist von der bisherigen Ein-Build-Freigabe noch nicht gedeckt; kein TestFlight-Upload oder Review. Frischer nativer Host-/Extension-Nachbuild jetzt ebenfalls bestanden; tatsächliche gebaute Manifeste getrennt und exakt geprüft. Ersatzkandidat `KANDRO-1.0.3-20261002-PRIVACY-FIX`; konkreter Ersatzvorschlag im bestehenden Kandidatenbericht.


### 03.10.2026 – Zugangsexperiment und finaler Testkandidat

`paywall_access_v1` trennt dauerhafte Kontozuordnung von Kaufrechten und Analysekontingenten. Die private serverseitige Konfiguration startet öffentlich ausgeschaltet. Nur ausdrücklich neue, verifizierte freiwillig verknüpfte Erwachsene mit bestätigtem Alter und gültigem sieben Tage Monats-Trial können einmalig A/B erhalten. Bestehende Historie, vorherige Gratisnutzung, unbekannte Identität oder Eligibility schließen dauerhaft aus; es entsteht kein neuer unbegrenzter Pro-Anspruch. Ohne Fingerprinting kann eine vollständig neue Identität nicht sicher demselben Menschen zugeordnet werden.

AccessProvider/RouteGuard schützen sämtliche normalen Einstiege und halten eine erlaubte Zielaktion bis zur bestätigten Freigabe. Aktive Rechte haben Vorrang. Konto, Recht, Widerruf/Löschung und vorhandene Mahlzeiten bleiben zugänglich. Der Gateway prüft die private Zuordnung vor Referenz-/Analysezugriff; ein Trigger schützt neue Cloudmahlzeiten. Spezifische vorher autorisierte Meal-ID-Belege erlauben noch ausstehende Saves nach Ablauf, ohne neue IDs freizuschalten (höchstens 64 unverbrauchte Belege). Korrektur und Tombstones bleiben erhalten. Cachefehler können einen bekannten B-Zugang nicht in Free umwandeln.

Die beiden Paywalls teilen Produktangebot und Inhalt; B hat kein X/Gratisziel. Der vorhandene freiwillige Kontoverknüpfungsbaustein erscheint nur im ersten Onboarding vor einer möglichen Teilnahme. Getrennte expirable QA-Konten ermöglichen A/B bei ausgeschaltetem öffentlichen Experiment; sie ändern keine Apple-Entitlements. Die Erinnerungsentscheidung wird getrennt vom OS-Berechtigungsstatus gespeichert; gesperrter B-Zugang pausiert Erinnerungen. Widgets zeigen größere tabellarische Summen, eine dezente Zielanzeige und im Mediumformat vier einzelne Aktionsflächen. Native Kinds, Datenschutz und Deep-Link-Allowlist bleiben erhalten.

Aktuell: nutrition 57 mit JWT und additive Migration 20261002210021 extern geprüft; A-Suche erlaubt und B vor Suche gesperrt mit echten eigenen QA-JWTs. Vollständige Suite, neun lokale Auth/PostgREST-Gruppen und frischer nativer Host/Widget-Build bestanden. Physische Kauf-/Widgetpflichtfälle sind separate TestFlight-Gates. Frühere offene Angaben oben sind historische Zwischenstände.


### Beta22 reminder/capture repair (2026-10-03)

Reminder onboarding completion has one observable owner in `services/reminders.ts`. Both the route guard and reminder screen subscribe through `useReminderOnboarding`; completion publishes before asynchronous persistence/navigation, with a revision guard against stale reads. Only the screen's declarative redirect completes navigation. Existing access/consent/save guards remain in place.

Description amounts permit a narrowly source-backed estimate for plain dairy milk volume (FAO/INFOODS1.030g/ml,1.02–1.05 range). This is medium-confidence, locally explained and editable; unsupported volume types are still rejected. Nutrition continues to come from BLS/USDA. Exact food/fat qualifiers bind quantities, and contradictory milk recognition remains one unresolved ingredient. Bilingual milk searches prioritize existing plain dairy references; search cache version is2026-10-03-v5. Gemini/search-assistance release gates remain off.


### 04.10.2026 – Beta-24-Feedback (lokal, nicht deployt)

- **Beschreibung:** `applyDescriptionAmountsTolerant` ersetzt in beiden Gateways die harte Ablehnung. Eindeutige Mengen binden weiter exakt; nicht sicher zuordenbare Angaben („100 g Reis mit Hähnchen“, „200 ml Öl“, >5000 g) behalten die Modellschätzung mit mittlerer Konfidenz und Warnung `amount_estimated`. Die Vorabprüfung vor der Modellanfrage entfällt. Alltagsgetränke (Wasser, Kaffee/Tee, Saft/Schorle, Softdrinks, Bier, Wein, Smoothie/Kakao) dürfen in ml/l angegeben werden (gerundete typische Dichten, Warnung `drink_volume_estimated`); Pflanzenmilch und Öl bleiben ohne Volumenumrechnung.
- **Toast:** Reviewte BLS-Aliase für Weizentoast (B314000), getoastet (B314072), Vollkorn (B111200), Mehrkorn (B314200) als typische Referenzwerte. Die Suche nach „Toast/Toastbrot“ zeigt gewöhnlichen Toast zuerst statt glutenfreiem.
- **Bestätigen:** Nicht aufgelöste Zutaten zeigen einen Ein-Tipp-Vorschlag aus der kostenlosen Suche; die erkannte Grammzahl bleibt, nichts ändert sich ohne Tippen.
- **Suche:** Die Liste bleibt beim Tippen stehen; liefert der lokale Katalog weniger als fünf Treffer, startet nach einer Tipp-Pause automatisch die volle Suche (Marken/OFF), ohne Return.
- **Paywall-Experiment:** Migration `20261004120000_paywall_open_to_new_installs.sql` entfernt die Pflicht zum verifizierten E-Mail-Konto; `access-setup` meldet neue Installationen automatisch an (50/50 A/B). Bestandsnutzer, Minderjährige, Vorabnutzung, aktives Pro und fehlende Trial-Berechtigung bleiben ausgeschlossen. Das Einschalten (`public_enabled`) ist eine getrennte Eigentümeraktion: `supabase/queries/enable_paywall_experiment.sql`. Datenschutz/AGB 1.9 entsprechend angepasst.
- **Paywall-Test pausiert (09.10.2026):** `20261009100300_pause_paywall_access_test.sql` setzt `public_enabled` und `enforcement_enabled` auf `false`; `paywall_access_v1()` liefert damit für alle (auch B) `hard=false`, Gateway, Mahlzeiten-Guard und App folgen diesem Flag. Die Paywall meldet ihre erste Sichtung je Kontext über `mark_paywall_shown` (`private.paywall_exposures`); erstattete KI-Analysen tragen `failure_code`. Auswertung nur serverseitig über `private.growth_funnel_daily` / `private.ai_failure_daily` (`docs/GROWTH_FUNNEL.md`).
- **Erinnerungen:** Modus `meals` mit vier antippbaren Zeitfenstern (Frühstück, Mittag, Abendessen, Tagesabschluss), Zeit per −/+ in 15-Minuten-Schritten. Mahlzeiten öffnen die Kamera, der Tagesabschluss die Beschreibung. Ältere Einzel-Erinnerungen werden als Abendessen übernommen.
- **Demo-Mahlzeit:** Wird angezeigt, aber nie mehr im Tagebuch gespeichert.
- Tests: `scripts/validate-beta24-feedback.mjs` (10 Fälle) im Verify-Gate; vollständiger `npm run verify` bestanden. Kein Deployment, kein Build, keine KI-Aufrufe.

### 04.10.2026 – Sofort-Erfassung (lokal, nicht deployt)

- `services/foodSuggest.ts`: Der gebündelte BLS-4.0-Snapshot und das Gateway-Ranking (`_shared/bls-search.mjs`) laufen auch auf dem Gerät. Tippen liefert ab 2 Zeichen sofort Treffer, offline, mit Alltags-Priorität, Synonymen, Plural/Tippfehlern, eigener Historie und typischen Portionen (als Schätzung gekennzeichnet). Gateway-Treffer (Marken, Open Food Facts) werden danach ohne Dubletten ergänzt.
- Suche → Menge → `AppContext.logFoodDirect` speichert sofort (kostenlos, `origin: plan`); die Suche bleibt für weitere Lebensmittel offen. Leeres Suchfeld zeigt „Zuletzt gegessen“ mit letzter Menge.
- `ManualFoodForm`: unbekannte Lebensmittel mit Quelle `manual` (Migration `20261004130000_manual_food_source.sql`, additiv).
- `services/localDescription.ts`: einfache Beschreibungen mit eindeutigen Lebensmitteln und Mengen werden lokal aufgelöst (kein KI-Aufruf, kein Kontingent). Negationen, Bereiche, unquantifizierte „mit“-Zugaben und unbekannte Wörter gehen unverändert an die KI.
- Lokale Web-Exporte müssen Backend-Variablen leeren (siehe Masteraudit F01); `.env.local` wird sonst trotz `EXPO_NO_DOTENV` eingebunden.
- Tests: `scripts/validate-instant-logging.mjs` im Verify-Gate. Audit: `docs/qa/MASTERAUDIT-2026-10-04.md`.


## Apple account activation — 5 October 2026

The candidate explicitly enables the SDK 54 Apple authentication plugin and host entitlement. The existing account card links Apple to the current guest or email account while retaining the Supabase user ID. Loading a different account continues through the guarded account-switch path; a rejected sign-in now rechecks the persisted identity before restoring old local data.

The authenticated `apple-account-token` function exchanges the fresh native authorization code with Apple, validates its signed ID token including issuer, audience, subject and hashed nonce, and stores only an AES-256-GCM encrypted refresh token in a server-only RLS table. The encryption key and Apple private key are Edge secrets, never public Expo configuration. An atomic service-only RPC limits exchange attempts. Token registration can be retried with a fresh Apple authorization; it is not reported as complete after a storage failure.

Account deletion revokes the stored Apple token before the existing RevenueCat and Supabase deletion. Missing or unusable tokens preserve the data-deletion path and return a manual-revocation notice, following Apple TN3194. Native revocation/foreground checks close the existing recovery gate; they retain the diary and require the same account to authenticate again. Simulator or network errors are not treated as revocation.

Deployment order is additive migration and server secrets, followed by `apple-account-token` and the compatible `delete-account` function. The existing native TestFlight build 37 cannot gain the entitlement through a server change. Current external activation, source checks and remaining release gates are tracked in the private `apple-login-20261005` evidence directory and workspace current-status document; implementation here is not proof of a real Apple login or a new uploaded binary.

## Habits and reminders — 9 October 2026

- Meal-slot reminders are one-off `DATE` notifications for the next seven occurrences per chosen slot (IDs `kandro-reminder-<slot>` and `-1`…`-6`), not repeating `DAILY` triggers. `ReminderScheduler` subscribes to the hydrated diary (today's remaining kcal/protein, logged meal types, last save) and re-plans after every save or removal and on each foreground. Today's breakfast/lunch/dinner reminder shows what is really left and opens Plan; a slot already logged is skipped; an exceeded or nearly complete day (< 200 kcal), the end-of-day check and later days stay neutral capture prompts. The old single daily/legacy modes keep their `DAILY` trigger.
- One re-engagement note (`kandro-reengage`) three days after the last saved meal, moved by every save, never repeated, only with existing permission and its own switch under Du → Benachrichtigungen.
- Progress shows a forgiving weekly goal (`weeklyLoggingGoal`: logged days of the last seven, goal 4) instead of a consecutive-day streak. The first weekly review with entries is free for adults (week start stored per device in `@kandro/free-weekly-review:v1`); later weeks show a Pro teaser.
- `utils/daypart.ts` is the single clock for greeting and default meal slot. The widget reads the same remaining/over values as the ring.

## Food database coverage (FOODDB), 2026-10-10 (local, not deployed)

- **Barcode**: `lookupBarcode` reads `public.off_product_cache` (service role only; found 30 days, unknown 3 days), then tries Open Food Facts v2 and falls back to v0 when v2 fails (5xx/timeout/broken body; a 429 is respected). UPC-A/EAN-13 spellings are tried (`offBarcodeCandidates`). German readers get `product_name_de`, then `generic_name_de`; the brand is appended. Every product request claims a provider unit first (`offProductRequest`).
- **Mein Produkt**: an unknown barcode offers "Nährwerttabelle fotografieren" (`src/app/label-scan.tsx`). `POST /v1/label` runs through the same auth, consent, paywall, reserve/quota/global-breaker, capture-receipt and refund path as `/v1/analyze` and costs one analysis; unreadable/per-100 ml tables (422) and incomplete reads (`correctionRequired`) are refunded. The model only transcribes the table (`labelSchema`); `label-facts.mjs` converts kJ/per-serving values, checks Atwater (warning) and physical limits (blocking), and the user confirms every value. Products are stored per account in AsyncStorage and written through to `public.custom_foods` (owner RLS, FK cascade to `auth.users`, max 500); barcode scans check own products before the gateway. Label photos are temporary like meal photos.
- **Search**: `food-synonyms.mjs` (Hühnchen→Hähnchen, Jogurt→Joghurt, Topfen→Quark, plurals) is shared by the gateway catalogue and on-device suggestions. Own products lead, then BLS, then the debounced gateway rows; `mergeSuggestions` drops duplicates by reference, barcode and name+energy. Rows show a source badge. The empty field lists own products, frequent foods and recent foods. German OFF search is scoped to products sold in Germany (`countries_tags:"en:germany"`, `langs=de`) with a brand-tag fallback (`countries_tags_en=germany&lc=de`).
- **Quick add**: "Kalorien schnell eintragen" stores kcal (+ optional protein) as one 100 g portion of an own entry (`manual`, `quick-` reference), free and outside the AI allowance.

## Search UX: foods and products in parallel (SEARCH-UX), 2026-10-12 (local, not deployed)

- The search sheet shows two sections: "Lebensmittel" (own products, on-device BLS, gateway BLS/USDA rows; 5 shown, then more) and "Produkte & Marken" (branded rows with brand line, pack size, kcal/100 g and source badge; skeleton while loading, empty state offers the nutrition-label photo). Local suggestions stay instant; the product search (`searchProducts` in `src/services/mealAnalysis.ts`) runs 300 ms after every query of ≥2 characters, no longer only when fewer than five local foods matched.
- Request: `GET /v1/search?q=<query>&language=de|en&scope=products[&brands=<comma-separated brand names>]`. The `brands` hint comes from `src/services/productSearch.ts` (store → food own-brands in `src/data/storeBrands.json`, e.g. Lidl → Milbona, Pilos, …; Aldi → Milsani, …). A query naming a store or brand puts products first.
- Response: `{ products?: ProductHit[], results?: FoodSearchResult[], searchStatus?: 'complete'|'partial' }`. `ProductHit` = `{ code, name, brand?, stores?, packageG?, servingG?, per100g{kcal,protein,carbs,fat,fiber?}, source:'off'|'productdb' }`; it maps to an `open-food-facts` search result (logged name "Name (Brand)", serving/pack portions). Older `results` rows still work: Open Food Facts rows go to products ("Name (Brand)" split for display), BLS/USDA rows to the generic list. Malformed rows are skipped individually.
- Everyday BLS names (`src/data/blsDisplayNames.json`, 192 codes incl. every EVERYDAY code): the title is the everyday name ("Donut", "Magerquark", "Cola"), the official BLS label is shown small below it (`officialName`). Codes, sources and per-100 g values are unchanged. Bakery aliases (donut, berliner, krapfen, kreppel, muffin, croissant) map to their BLS rows.
