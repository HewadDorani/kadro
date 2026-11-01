# Agent guide

This repository contains the Kandro mobile MVP: photograph a meal, confirm the estimate, see the remaining daily nutrition budget, and get three practical next-meal suggestions. The product line is “Kandro sagt dir, was als Nächstes passt.” (EN: “Know what fits next.”)

## ⛔ Release gate — read before any build or App Review submission (owner decision, 06.10.2026)

Claude finished release fixes after build 38. **Build 38 and every older build must not be submitted for App Review.** The next submitted build must be built from a commit that contains **all** of these commits on `release/1.0.4`:

| Commit | Contains |
| --- | --- |
| `557c09f` | New App Store screenshots from real release-app captures (`app-store/screenshots/`, 6 per locale); onboarding target date follows the pace; no "cloud not confirmed" notice in local-only mode; "Add" instead of "Save amount" for new search entries |
| `b31aea5` | Everyday dishes in search with real servings (bolognese, lasagne, pizza, döner, currywurst, chili, schnitzel, burger) while descriptions still go to the analysis; weight labels without a trailing `,0` (159 lb, 78 kg); US spelling in the English UI; Kandro mark instead of a bare spinner on launch |
| `b5de12a` | Microphone button reliably present after a fresh install; target weight input uses the language's decimal mark; final store screenshots re-captured from this build |
| `d5d0fc8` | Microphone stops instantly on tap (abort fallback when iOS does not report the end) |

Rules:

1. Do not revert, rewrite or drop these commits. Build on top of them (rebase/merge your work onto `release/1.0.4`, never reset it).
2. `npm run verify` and `npm run validate:release` run `scripts/validate-release-gate.mjs`, which fails if a commit or fix is missing. A failing gate means: do not build, do not submit.
3. In App Store Connect, replace the old screenshots with the six per locale from `app-store/screenshots/de-DE` and `app-store/screenshots/en-US`, in filename order. Regenerate them with `python3 app-store/compose/render.py` (see `app-store/README.md`).
4. Uncommitted Sign in with Apple work (`AccountLinkCard`, `accountLinking`, `appleSyncRetry` strings, `validate-apple-account`) was deliberately left untouched by Claude: commit it on top, do not discard it. Production recheck on 6 October found one stored Apple token (latest write: 5 October 2026 at 21:42:48 UTC); the earlier empty-table claim is stale. Build 39 includes the client repair, but the combined next candidate still needs a device test before review.
5. App Review submission needs the owner's explicit approval for the exact build number.

## Start here

1. Read this file completely.
2. Read `README.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`.
3. Inspect `git status` before editing. Preserve user work and unrelated changes.
4. Run `npm install` and `npm run verify` before handing work back.

## Expo version constraint

The project intentionally uses Expo SDK 54 because it must open in the current App Store build of Expo Go. Read the exact versioned documentation at https://docs.expo.dev/versions/v54.0.0/ before changing Expo APIs or native dependencies.

Do not upgrade Expo, React, React Native, Expo Router, or other native packages independently. Use `npx expo install <package>` and finish with `npm run doctor`. A future SDK upgrade must be an explicit, isolated migration.

## Repository map

- `src/app/`: Expo Router route files only. Root stack screens live here; the five primary tabs live in `src/app/(tabs)/`.
- `src/components/`: reusable visual components. Extend these before duplicating card, button, progress, badge, or photo patterns.
- `src/components/KandroMark.tsx`: reusable vector brand mark used in the application UI.
- `src/constants/theme.ts`: the design tokens and source of truth for color, spacing, radii, and shadows.
- `src/context/AppContext.tsx`: hydrated local/cloud application state, personalization, progress data, scan state, and derived daily nutrition values.
- `src/services/mockNutrition.ts`: the current mock service boundary. Real data sources should replace or sit behind this layer, not leak into UI components.
- `src/services/contracts.ts`: typed interfaces for analysis, nutrition lookup, persistence, retry, and recommendations.
- `src/types/nutrition.ts`: shared domain types.
- `docs/ARCHITECTURE.md`: data flow and extension seams.
- `docs/ROADMAP.md`: completed scope, next priorities, and acceptance criteria.

## Product invariants

- The core loop is `onboarding → scan → analyze → confirm → result → replan → three options`.
- The app is an adaptive decision system, not a conventional food diary or seven-day meal planner.
- Always communicate nutrition as an estimate. Preserve confidence labels and easy ingredient/portion correction.
- Never introduce guilt, punishment, medical diagnosis, treatment claims, or eating-disorder guidance.
- The user-facing UI is bilingual. English is the primary international locale and German is the complete localized alternative; keep internal domain identifiers stable when translating copy.
- The recommendation screen returns exactly three contextual options for Zuhause, Supermarkt, or Unterwegs.
- Meal photos are temporary by default. Do not persist or upload originals without an explicit privacy decision and deletion policy.
- Keep the central Scan action visually dominant and available from the primary navigation.
- Preserve the Kandro visual system: `#F5F3EE` canvas, white surfaces, `#14150F` ink, `#6E7066` muted text, `#E4E2D9` hairlines, `#BBDC8E` pistachio, `#3F5233` moss, 18px cards, system typography, no gradients, and no glassmorphism. An optional Rosé accent under Du → Darstellung is an owner decision (01.11.2026); pistachio stays the default.
- `#EFF6E3` accent tint is reserved for recommendation surfaces. Pistachio fill may be used for the central scan action, progress, and selected controls.
- The only shadow belongs to the central Scan button.

## Engineering boundaries

- The MVP has a local development gateway and a hosted Supabase Edge Function for production analysis, live OpenRouter/OpenAI and USDA adapters, Supabase Auth/data sync, RevenueCat Test Store billing, and optional privacy-minimal EU PostHog analytics. Native StoreKit billing and purchase/restore testing remain release gates until the Apple enrollment and App Store products exist; do not imply those are live.
- Supabase access from the app uses only the publishable key and a user JWT. Never add a secret or `service_role` key to Expo code or an `EXPO_PUBLIC_` variable.
- Every table in an exposed Supabase schema must enable RLS, revoke unnecessary grants, and include owner-scoped policies before it is used by the client.
- UI components should consume typed domain data, not raw third-party API responses.
- Put external integrations behind small service interfaces. Keep USDA/Open Food Facts mapping, vision parsing, storage, and billing separate.
- Derived totals must come from meal data and daily targets. Do not hard-code remaining calories or macros in screens.
- Keep route components focused on presentation and interaction. Shared business logic belongs in context, hooks, or services.

## Validation

Run the full gate:

```bash
npm run verify
```

For camera or navigation changes, also run the app in Expo Go and manually verify:

1. Camera permission denied and granted states.
2. Demo capture through analyzing and confirmation.
3. `weniger / passt / mehr` and gram-level detail correction both update the estimate.
4. Confirming the result saves it once and updates Today by exactly the corrected meal totals.
5. New install (hard wall, 10/2026): exactly one free analysis; after the first saved meal (or "Später") the paywall has no close button and every route except paywall, account help, legal and data controls leads to it; a sandbox trial opens the app. Existing install: the soft paywall appears once after the first saved meal; the limit paywall only after the 3 free AI analyses.
6. The result sequence counts the meal up, the remaining day down, then reveals the recommendation; Reduce Motion skips the sequence.

## Change discipline

- Keep changes scoped and reviewable.
- Do not commit `.expo`, `dist`, screenshots, credentials, or local environment files.
- Update `docs/ARCHITECTURE.md` when data flow or ownership changes.
- Update `docs/ROADMAP.md` when a milestone is completed or reprioritized.
- In the final handoff, state what changed, what was verified, and any remaining risk or mock behavior.
