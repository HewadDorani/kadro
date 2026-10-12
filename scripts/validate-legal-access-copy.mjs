import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=process.argv[2] ?? fileURLToPath(new URL('../',import.meta.url));
// The commercial access disclosure (free scope, Pro scope, trial) must be in
// the subscription terms in both languages, while the separate
// functional-data disclosure stays in privacy.
for (const [language, clause, dataClause] of [
 ['de', 'Kostenlos sind Lebensmittelsuche, Barcode', 'Für die Zugangssteuerung speichert Supabase'],
 ['en', 'Food search, barcode, daily balance, meal suggestions and history are free', 'For access control, Supabase stores']
]) {
 const source=readFileSync(resolve(root,`src/i18n/legal.${language}.ts`),'utf8');
 const privacy=source.slice(source.indexOf('  privacy: {'),source.indexOf('  terms: {'));
 const terms=source.slice(source.indexOf('  terms: {'),source.indexOf('  sources: {'));
 assert.ok(terms.includes(clause),`${language}: free/Pro access disclosure missing from terms`);
 assert.ok(!privacy.includes(clause),`${language}: commercial access disclosure misplaced in privacy`);
 assert.ok(privacy.includes(dataClause),`${language}: functional access-data disclosure missing from privacy`);
 // Owner decision 09.10.2026: the access test is paused, soft paywall for
 // everyone. Terms and privacy must say so instead of describing a live test.
 assert.match(terms, language === 'de' ? /drei erfolgreiche KI-Analysen/ : /three successful AI analyses/);
 assert.match(terms, language === 'de' ? /Fair-Use-Grenze/ : /fair-use limit/);
 assert.match(terms, language === 'de' ? /Test mit zwei Zugangsvarianten ist pausiert/ : /test of two access variants is paused/);
 assert.doesNotMatch(terms, /Bei einem begrenzten Test unter geeigneten neuen Nutzern|A limited test among eligible new users/,
  `${language}: terms still describe the paused access test as running`);
 assert.match(privacy, language === 'de' ? /Zugangstest .* ist pausiert: Es werden keine neuen Varianten zugeordnet/ : /access test .* is paused: no new variants are assigned/);
 assert.match(privacy, language === 'de' ? /Wird dir die Paywall angezeigt, speichert Supabase/ : /When the paywall is shown to you, Supabase also stores/,
  `${language}: the per-account paywall exposure record must be disclosed`);
 assert.match(privacy, language === 'de' ? /standardmäßig ausgeschalteten Einwilligung/ : /separate, default-off consent/);
 // Server-side aggregate funnel: purpose, minimal data, legal basis, objection.
 const funnel = privacy.split('\n').find(line => language === 'de' ? line.includes('Zählwerte je Anmeldetag') : line.includes('counts per sign-up day')) ?? '';
 for (const rule of language === 'de'
  ? [/Art\. 6 Abs\. 1 lit\. f DSGVO/, /Art\. 21 DSGVO/, /keine zusätzlichen Daten/, /nicht was/]
  : [/Art\. 6\(1\)\(f\) GDPR/, /Art\. 21 GDPR/, /No additional data/, /not what/]) {
  assert.match(funnel, rule, `${language}: aggregate funnel disclosure must state ${rule}`);
 }
 // International transfers: DPF where certified, otherwise SCCs.
 const transfers = privacy.split('\n').find(line => language === 'de' ? line.includes('Übermittlung in Drittländer') : line.includes('Transfers to third countries')) ?? '';
 for (const rule of [/OpenRouter/, /Microsoft Azure/, /Data Privacy Framework/, language === 'de' ? /Art\. 46 Abs\. 2 lit\. c DSGVO/ : /Art\. 46\(2\)\(c\) GDPR/]) {
  assert.match(transfers, rule, `${language}: transfer disclosure must mention ${rule}`);
 }
 // Verified 2026-10-10: OpenRouter is not DPF-certified and relies on SCCs; the
 // user-facing text must say so, and the source note stays next to it.
 assert.match(privacy, /Verified 2026-10-10: OpenRouter's privacy policy \(Section 9\) relies on SCCs/,
  `${language}: keep the verification note next to the transfer paragraph`);
 assert.match(transfers, language === 'de' ? /OpenRouter ist nicht nach dem Data Privacy Framework zertifiziert; für OpenRouter gelten die EU-Standardvertragsklauseln/ : /OpenRouter is not certified under the Data Privacy Framework; the EU Standard Contractual Clauses apply to OpenRouter/,
  `${language}: name the SCCs as OpenRouter's transfer basis`);
 // Hard paywall after the first scan (owner decision 10.10.2026): new
 // accounts get one free sample analysis, a confirmed trial counts as Pro,
 // existing accounts keep the legacy scope, and the free-meal record is disclosed.
 for (const rule of language === 'de'
  ? [/Neue Konten .* eine kostenlose Probe-Analyse/, /siebentägiger Trial zählt als Kandro Pro/, /Wer den ersten Scan überspringt/, /Für Konten, die vorher angelegt wurden, ändert sich nichts/]
  : [/New accounts .* one free sample analysis/, /seven-day trial confirmed by Apple counts as Kandro Pro/, /If you skip the first scan/, /Nothing changes for accounts created before/]) {
  assert.match(terms, rule, `${language}: terms must describe the hard paywall honestly (${rule})`);
 }
 assert.match(privacy, language === 'de' ? /ID und den Zeitpunkt der einen kostenlosen Mahlzeit/ : /ID and time of the one free meal/, `${language}: the free-meal record must be disclosed`);
 assert.doesNotMatch(terms + privacy, /alle erhalten denselben Zugang|everyone gets the same access/, `${language}: no longer true for new accounts`);
 // 16+ (owner decision 09.10.2026).
 assert.match(terms, language === 'de' ? /für Nutzer ab 16 Jahren/ : /for users aged 16 and over/);
 assert.doesNotMatch(terms, /ab 14 Jahren|aged 14 and over|14- bis 17|14–17/, `${language}: terms still state the old 14+ minimum`);
 assert.doesNotMatch(privacy, /Kandro ist ab 14|available from age 14/, `${language}: privacy still states the old 14+ minimum`);
}
console.log('PASS: bilingual free/Pro terms, paused access test, aggregate funnel and transfer disclosures, 16+.');
