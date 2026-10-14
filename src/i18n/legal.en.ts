import { legalProvider } from '@/constants/legal';

import type { LegalCopySet } from './legal.de';

/** Appends the country unless the configured address already names it. */
function withCountry(address: string, country: string) {
  return /deutschland|germany/i.test(address) ? address : `${address}, ${country}`;
}

function provider() {
  if (!legalProvider.name) {
    return 'Kandro is operated by the provider of the app.';
  }
  const parts = [legalProvider.name];
  if (legalProvider.address) parts.push(withCountry(legalProvider.address, 'Germany'));
  return `The controller responsible for processing is ${parts.join(', ')}.`;
}

function contact() {
  return legalProvider.email
    ? `You can reach us for privacy requests and support at ${legalProvider.email}.`
    : 'You can reach support and privacy requests through the support address listed on the App Store.';
}

export const legalEn: LegalCopySet = {
  version: '2.6 · Last updated 10 October 2026',
  privacy: {
    title: 'Privacy notice',
    intro: 'This notice explains in plain language which data Kandro processes, why, and how you can delete it again at any time.',
    sections: [
      {
        title: '1. Controller and contact',
        paragraphs: [
          provider(),
          contact(),
        ],
      },
      {
        title: '2. What data is processed',
        paragraphs: [
          'For access control, Supabase stores once against your account ID which access applies to you, or why you are not assigned to a test variant, and when. The earlier limited access test for new installs by adults with no prior use is paused: no new variants are assigned. For accounts created after the current access model was introduced, Supabase also stores the ID and time of the one free meal so that Kandro Pro applies afterwards; this record is deleted with the account. Existing assignments remain until account deletion and are not redrawn at sign-in or restore. Individual permissions for meal saves already begun preserve their later synchronization. When the paywall is shown to you, Supabase also stores against your account ID in which context (for example after the free analyses) and when it first appeared, and once each whether and when you started, cancelled or completed a purchase (without plan, price or payment data); these records are deleted with the account as well. Optional events about the paywall actually shown remain subject to your separate analytics consent. No device fingerprinting is used.',
          'On your device, Kandro processes your profile, your targets, weight entries, confirmed meals and at most three failed, compressed photo scans kept for a retry you trigger yourself.',
          'Optional daily reminders are scheduled locally and contain no nutrition totals. In your profile, you can allow home screen widgets to show today’s calories, protein and confirmed targets on this device. Without this choice, and on the Lock Screen, widgets only offer shortcuts. A protected shared app container holds a small, time-limited daily snapshot without names, meal descriptions, images or credentials. Turning sharing off clears it; iOS may briefly retain a previously rendered widget image. Local usage and request counters limit the optional native review request; Kandro does not upload these counters.',
          'When the cloud is active, Supabase stores in the EU a random account ID, your profile, your current targets, confirmed meals, ingredients, recommendations and feedback. Weight entries stay on your device; an email address is only stored if you deliberately secure your guest account. If you secure it with Sign in with Apple, Apple provides an identifier for your Apple ID and an email address that Apple can relay anonymously at your choice; Kandro never receives your Apple password. If you speak a meal, Apple speech recognition turns it into text, on the device where possible and otherwise via Apple. Kandro stores no audio, only the text you send.',
          'When you save a product as “My product” (from a photographed nutrition label or entered yourself), Kandro stores its name, optionally brand and barcode, the values per 100 g you confirmed, and serving and pack size on your device and, when the cloud is active, in Supabase in the EU. You can delete each product individually; all of them are deleted with your account.',
          'To prevent automated exhaustion of USDA, Open Food Facts and RevenueCat, Supabase keeps per-provider counters linked to one-way pseudonyms of the random account ID and source network for at most two hours after their last use. Food queries and barcodes are not stored in these counters.',
          'Kandro is for people aged 16 and over. Older app versions let users aged 14 or 15 ask a parent or legal guardian to approve by an emailed link. As long as such requests still arrive, the following applies: the guardian email exists only in the delivery function’s working memory and is not stored in Kandro’s database. Until confirmation or expiry after 48 hours, Supabase stores only the pending request with a hash of the single-use token. To prevent automated guardian-email abuse, each request also consumes atomic limits based on separately salted hashes of the app account, source network and guardian email. The raw network address and guardian email are not stored for this purpose, and these separate rate-limit records are deleted within three hours. After successful confirmation, the request is deleted immediately; the confirmation time and notice version remain in the protected profile as evidence. Resend processes the address and technical delivery data to send the message.',
          'If the app crashes or a serious technical error occurs, Kandro sends an error report to Sentry (Functional Software, Inc.; stored in the EU region, Frankfurt). It contains the sanitised error with its code location, app version, device model, operating system, a random installation identifier and the last interface steps without any input. Without an error, Sentry only counts the start and end of app sessions to measure the share of crash-free sessions, and may record technical load times for a small share of sessions. Kandro does not send an account ID, email address, IP address, photos, screen contents, typed text, foods, calories or body data. The legal basis is our legitimate interest in a stable, error-free app (Art. 6(1)(f) GDPR); error reports are deleted after no more than 90 days.',
          'If you deliberately enable optional usage analytics, PostHog receives a random Distinct or device ID persisted on the device, allowlisted feature events, sanitised errors and technical app-version, operating-system and SDK information. Photos, email addresses, foods, calories, macros and Supabase IDs are not sent to PostHog.',
          'For subscription management, RevenueCat receives the random Supabase account ID as a Custom App User ID, plus product, purchase, duration and entitlement information. This lets Kandro associate and restore a purchase for the same account; RevenueCat receives no meals, body details or nutrition data.',
          "Only with your separate, default-off consent to analysis of the now paused subscription experiment does RevenueCat additionally receive the fixed experiment identifier, your original A/B variant and consent version. These are linked to your account ID and subscription information. Apple checks the installation origin; Kandro exposes only an App Store, test or unknown category to the app, not receipts, transaction data or device identifiers. Test and uncertain installations are excluded from this measurement. Earlier consent to PostHog usage analytics does not cover this purpose.",
        ],
      },
      {
        title: '3. Photo analysis and recipients',
        paragraphs: [
          'A photo is downscaled on your device. The original is discarded afterwards. The working copy, or a meal description you deliberately typed, is transferred to OpenRouter in the United States and from there exclusively to Microsoft Azure, where the OpenAI GPT-4.1 mini model identifies foods and portions. USDA FoodData Central is then queried with text search terms only. For a barcode, the number is looked up at Open Food Facts through the Kandro analysis gateway.',
          'Confirmed meals contain no photo. The local failure queue is capped at three scans and is cleared once an analysis succeeds.',
          'When you photograph a nutrition label (optionally also the front of the pack), these photos are downscaled on your device like a meal photo, transferred to the same recipients only to read the values, and discarded afterwards; Kandro does not store them. Only the values you confirm are saved. Kandro keeps public Open Food Facts product data for up to 30 days in a shared cache that is not linked to your account.',
        ],
      },
      {
        title: '4. Purpose, legal basis and retention',
        paragraphs: [
          'Nutrition and goal data are health data within the meaning of Art. 9 GDPR. The legal basis is your explicit consent under Art. 9(2)(a) GDPR, which you give during onboarding and can withdraw at any time under “You → Analysis & data use” with effect for the future. After withdrawal, Kandro sends no analysis, body or nutrition data to the named recipients. Consent is stored with a timestamp and notice version on your device and, when the cloud is active, in your protected profile.',
          'Kandro is available from age 16; from 16 you can consent for yourself under Art. 8 GDPR in Germany. Where a parent approved through an older app version, they confirmed the disclosed recipients and purposes through a single-use link that expires after 48 hours. After successful confirmation, the request and token hash are deleted immediately; a daily database job removes expired requests. A given authorization can be withdrawn through the contact address above; future processing can also be stopped in the app at any time.',
          'Local data remains until you delete the app data or your account. Confirmed meals are stored locally for your history; for the cloud history the app currently loads at most 90 days. Cloud data remains until the account is deleted. Technically necessary backups may expire according to the retention periods of the respective processor.',
          'To recover a successful analysis after an interrupted response and prevent free or Pro allowances from being counted twice, Supabase stores the structured nutrition result with a random request ID and your account ID. The photo, Base64 working copy, prompt and typed raw text are not stored for this purpose. An hourly job clears the result after 22 hours. The request ID, status and allowance type then remain for at most 30 days to prevent duplicate calls and abuse; RevenueCat webhook IDs remain for at most 90 days for deduplication. Account deletion immediately cascades to these Kandro records.',
          'To understand whether Kandro actually helps new users and where analyses fail, we evaluate data that Supabase already holds to run the service, only in aggregated form as counts per sign-up day. We count, for example, how many new accounts created a profile, tried or successfully completed an AI analysis, saved a meal (on the first day, from the second day or from the eighth day), saw the paywall or started a trial or subscription, how many of them are adults, and for which technical reasons analyses fail. For meals, only whether and when something was saved counts, not what. No additional data is collected for this, no nutrition values, body data or photos are evaluated, no profiles of individual people are built and nothing is passed to analytics services or other third parties; only the provider has access through the protected database. The legal basis is our legitimate interest in improving Kandro and finding errors (Art. 6(1)(f) GDPR). You can object to this evaluation under Art. 21 GDPR through the contact address above.',
          'Voluntarily transmitted PostHog events remain until the retention configured for the EU project expires or a valid erasure request is completed. Switching analytics off stops future transmission and clears the random local analytics identity and pending event queues. PostHog never receives the Supabase account ID, so previously sent events cannot be joined to the deleted Kandro account. Apple may keep purchase and subscription history as long as needed for restoration, billing, fraud prevention or legal duties. OpenRouter does not retain prompt or response content, but keeps content-free request metadata under its own retention criteria.',
          "You can turn off subscription experiment analysis under You or on the paywall. New attribute transmissions stop immediately; previously set Kandro RevenueCat attributes are removed at the next possible sync. Subscription management, purchase rights and functional access assignment remain unchanged. Your choice and any pending removal are stored locally per account; account deletion also removes the RevenueCat customer. This does not guarantee retroactive removal from already aggregated reports.",
        ],
      },
      {
        title: '5. Your rights',
        paragraphs: [
          'You can request access, rectification, erasure, restriction and, where applicable, data portability, and you can withdraw consent with effect for the future. Pseudonymous usage analytics can be switched off at any time under “You”.',
          'Under “You → Delete account and data” you can delete your Supabase account, the associated Kandro cloud data, the linked RevenueCat customer and your local history and identifiers. Kandro asks RevenueCat to complete or durably queue that erasure before destroying the account join ID. An Apple subscription and Apple purchase history remain separate; the subscription must additionally be cancelled in your Apple subscription settings. Events already sent to PostHog remain pseudonymous and unlinked to the Supabase account until their configured retention expires or a valid erasure request is completed. You can contact the address above about any further erasure right.',
          'You have the right to lodge a complaint with a supervisory authority; for North Rhine-Westphalia this is the State Commissioner for Data Protection and Freedom of Information NRW.',
        ],
      },
      {
        title: '6. Processors and transfers',
        paragraphs: [
          'We use Supabase (database and account, EU region), OpenRouter in the United States and Microsoft Azure with the OpenAI GPT-4.1 mini model (image and text analysis), USDA FoodData Central and Open Food Facts (nutrition matching), RevenueCat (subscription management with a linked account ID and purchase status), Resend (guardian and waiting-list email delivery), Sentry (crash reports without account ID or content, EU region) and optionally PostHog (pseudonymous usage analytics, EU). Optional product analytics stay disabled for users under 18.',
          'The AI data path is restricted to OpenRouter and ZDR-capable Microsoft Azure endpoints without fallback. Requests are configured with “store: false”, data collection denied and Zero Data Retention: prompt, photo and response content is not used for training and is not retained by OpenRouter or the selected inference endpoint. Separately, OpenRouter stores content-free request metadata such as timestamp, model used, token counts and latency for billing, reporting and model ranking. According to its documentation, OpenRouter may temporarily pass a small number of prompts to a ZDR model for anonymous categorisation; only the category, not the prompt, is stored without an account or user-ID association. Photos are processed solely for the duration of the analysis. OpenRouter and USDA FoodData Central process data in the United States; USDA receives normalized food terms only, not photos, account IDs or body data.',
          // Verified 2026-10-10: OpenRouter's privacy policy (Section 9) relies on SCCs
          // (Art. 46 GDPR); no DPF certification. Sign OpenRouter's DPA (privacy@openrouter.ai).
          'Transfers to third countries: analysis requests go to OpenRouter in the United States and from there to Microsoft Azure; processing may take place outside the EU. Supabase, RevenueCat, Resend, Sentry and PostHog are also headquartered in the United States; access from there cannot be ruled out even where data is stored in the EU. We base these transfers on the European Commission’s adequacy decision for the EU-U.S. Data Privacy Framework (Art. 45 GDPR) where the recipient is certified under it, and otherwise on the EU Standard Contractual Clauses (Art. 46(2)(c) GDPR), which form part of the respective data processing agreement. OpenRouter is not certified under the Data Privacy Framework; the EU Standard Contractual Clauses apply to OpenRouter. You can obtain a copy of these safeguards through the contact address above.',
          'RevenueCat processes the Supabase account ID with product, purchase, subscription and entitlement status. When voluntarily enabled, PostHog processes the pseudonymous Distinct ID, allowlisted product interactions, sanitised errors and technical app, operating-system and SDK information. Resend processes the email address and technical delivery data for the relevant message. Retention follows the purposes described above and each processor’s retention or deletion rules; details and erasure requests are available through the contact address.',
        ],
      },
      {
        title: '7. Waiting list on getkandro.com',
        paragraphs: [
          'Anyone signing up on the website to be told about the launch gives an email address. We store it with the chosen language, an optional campaign source from the “ref” parameter, and the sign-up and confirmation times. The website also stores your language choice locally in the browser. The legal basis for the waiting list is your consent, Art. 6(1)(a) GDPR.',
          'Sign-up is double opt-in: after submitting you receive a confirmation mail, and only the click in it adds you. Without that click we do not use the address. We store separate random tokens for confirmation and unsubscribe. To keep automated bulk sign-ups out we also store a salted hash of the IP address, not the IP address itself. Each sign-up attempt additionally consumes an atomic limit using separately salted hashes of the IP and email address. These separate rate-limit records are deleted within three hours.',
          'The address is used only for the launch notice and messages directly related to it, not for an ongoing newsletter. Every mail carries an unsubscribe link; once you confirm it, the complete waiting-list entry is deleted immediately. Unconfirmed entries are deleted after 30 days. Confirmed entries are deleted no later than six months after the actual public app launch recorded in the system. A daily database job enforces these limits.',
          'Sending is done through Resend; Resend processes the address and technical delivery data under its own retention criteria. Waiting-list entries are stored at Supabase in the EU until the deletion described above.',
          'The Discord server is an offering of Discord. Joining it is something you do towards Discord; we receive no data from you in the process and have no influence over how Discord handles it.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of use',
    intro: 'These terms describe what Kandro does and what it does not do. The app deliberately stays within general wellness support and transparent estimates.',
    sections: [
      {
        title: '1. What the app does',
        paragraphs: [
          'Kandro is a general wellness and planning tool for users aged 16 and over. The app structures foods you photograph or describe, or packaged products via barcode, estimates their nutrition values, calculates a daily frame and suggests suitable next meals from a curated catalogue of typical reference values.',
          'All values are estimates. You can correct detected ingredients and portion sizes before saving.',
          "Adults may optionally save a target weight and date in their profile. These preferences do not change calorie calculations and are not a prediction. The weekly review compares saved meal estimates; incomplete or missing entries limit what the comparison can tell you.",
        ],
      },
      {
        title: '2. Not a medical service',
        paragraphs: [
          'Kandro does not diagnose, does not treat any condition and does not replace medical or dietetic advice. Do not make medical decisions on the basis of the app alone.',
          'For users aged 16 and 17, Kandro uses an adolescent energy-balance equation that includes normal growth and does not prescribe a calorie deficit or surplus. Goals affect meal suggestions, not a weight-change target. If weight or growth is a concern, involve a parent or guardian and seek qualified advice.',
          'If you have health complaints, are pregnant, have an eating disorder or a metabolic condition, or follow a medically prescribed diet, please seek qualified advice before you change your targets.',
        ],
      },
      {
        title: '3. Acceptable use',
        paragraphs: [
          'You are responsible for checking your entries and the estimated values. Do not use Kandro for emergencies, medication dosing or clinical decisions.',
          'Automated attacks, circumventing technical protection measures and using other people’s accounts are not permitted.',
        ],
      },
      {
        title: '4. Subscriptions',
        paragraphs: [
          'New accounts (set up after this access model was introduced) get one free sample analysis by photo, voice or text and can save their first meal. After that, further meals, analyses, the plan and the daily view require Kandro Pro; a seven-day trial confirmed by Apple counts as Kandro Pro. If you skip the first scan, you see the Kandro Pro offer straight away.',
          'Nothing changes for accounts created before. Food search, barcode, daily balance, meal suggestions and history are free, together with three successful AI analyses by photo, voice or text. Kandro Pro unlocks further photo, voice and text analyses within a fair-use limit (currently up to 60 per day) and the weekly review. An earlier test of two access variants is paused; its participants keep the access of existing accounts. Previously saved data, privacy settings, account deletion, account controls and legal information always remain accessible.',
          'Kandro Pro is available as a monthly and an annual subscription. Both may include an Apple-confirmed seven-day introductory trial. Your actual Apple eligibility determines whether the trial is available; the displayed renewal price and terms apply.',
          'Price, duration, trial period and renewal are shown before the purchase. Subscriptions renew automatically for the selected period until you cancel them. Payment is charged to your Apple ID; you can cancel at any time up to 24 hours before the period ends in your Apple ID settings.',
          'Purchases by a minor require the authorization applicable to their Apple account, such as Ask to Buy or approval by the family organizer. Kandro does not bypass Apple’s purchase controls.',
          'Deleting your Kandro account does not automatically end an Apple subscription. Purchases can be restored from the paywall.',
          "The offer, eligibility and actual total price in the purchase dialog apply; a monthly equivalent does not change the annual charge. Apple allows one introductory trial per subscription group, including when switching between monthly and annual products.",
        ],
      },
      {
        title: '5. Availability and changes',
        paragraphs: [
          'Analysis providers and nutrition databases can be temporarily unavailable. On network errors, Kandro keeps at most three compressed scans locally for a manual retry.',
          'Material changes to the service, to privacy or to prices are shown transparently before they take effect.',
        ],
      },
      {
        title: '6. Provider and governing law',
        paragraphs: [
          `${provider()} ${contact()}`,
          'German law applies, without prejudice to the mandatory consumer protection rules of your country of residence. For subscriptions purchased through the App Store, Apple’s terms apply in addition.',
        ],
      },
    ],
  },
  sources: {
    title: 'Data sources',
    intro: 'Logged ingredients show their nutrition source. Kandro visibly separates database values, AI-assisted matching and its own typical planning references.',
    sections: [
      {
        title: 'German dishes · Bundeslebensmittelschlüssel',
        paragraphs: [
          'For typical German dishes, Kandro uses reviewed reference values from the Bundeslebensmittelschlüssel. These values are not generated by AI; they are database and average values. Matching them to the detected dish, assuming a preparation and scaling them to the estimated portion remain estimates.',
          'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0',
          'Licence: Creative Commons Attribution 4.0 International (CC BY 4.0). The data was selected for use in Kandro and converted to portion sizes; the Max Rubner-Institut has neither reviewed nor endorsed Kandro.',
        ],
      },
      {
        title: 'Individual ingredients · USDA FoodData Central',
        paragraphs: [
          'Ingredients outside the German dish reference are matched against USDA FoodData Central of the U.S. Department of Agriculture. This data is available in the public domain.',
          'Matching a food name to a USDA entry is an estimate. That is why every ingredient shows where its value came from, and uncertain matches are flagged for review.',
        ],
      },
      {
        title: 'Packaged products · Open Food Facts',
        paragraphs: [
          'Barcodes are looked up at Open Food Facts. The product database is published under the Open Database License (ODbL) and is maintained by volunteers.',
          'Nutrition values for packaged products therefore come from the manufacturer’s declaration and can be incomplete or out of date. When in doubt, check the value on the packaging.',
        ],
      },
      {
        title: 'Kandro recommendation catalogue',
        paragraphs: [
          'The three next-meal options come from a catalogue curated by Kandro. Its calories and macros are typical, plausible planning references for the described standard portion, not measurements of an individual preparation. The app labels them “Kandro catalog · typical reference value”.',
          'The catalogue is ranked deterministically against your remaining daily frame, context and preferences. AI does not invent recommendation cards.',
        ],
      },
      {
        title: 'How a photo estimate is produced',
        paragraphs: [
          'GPT-4.1 mini identifies foods and estimates visible gram amounts. Kandro does not take nutrition values from the model; it matches the detected terms against BLS or USDA references. Uncertain matches, hidden calories and broad portion ranges are flagged.',
          'Before saving, Kandro shows every ingredient, gram amount and source for confirmation. You can change amounts or exclude ingredients. This review is part of every photo and text analysis.',
        ],
      },
      {
        title: 'Imagery',
        paragraphs: [
          'The example meal photo is by Markus Winkler and is used under the Unsplash licence. It only appears until you have taken a photo of your own.',
        ],
      },
      {
        title: 'What this means for your numbers',
        paragraphs: [
          'Every value in Kandro is an estimate. Even reviewed reference values assume a standard preparation – oil, sauce and portion size vary considerably in practice. That is why you can correct every ingredient and every portion before saving.',
        ],
      },
    ],
  },
};
