# Roadmap


### Owner decisions delegated to Claude (2026-10-10)

- **No renewed consent for "Mein Produkt" / label scan.** Custom foods hold product nutrition facts, not new health data about the person; label photos follow the existing meal-photo path (same processor, temporary, same purpose). The privacy notice was updated (inform, Art. 13); the consent version stays.
- **OpenRouter transfer basis:** OpenRouter is not DPF-certified; its privacy policy (§9) relies on EU SCCs. Privacy text names this. Action for the owner: request/sign OpenRouter's DPA via privacy@openrouter.ai.
- **ODbL:** the supermarket extract is published under ODbL at `site/data/supermarket-products.json` (live with the next site deploy from `main`).
- **Canned tuna:** label values are per drained fish; whole cans without a labelled serving count ~72 % of the net weight, marked as estimate.
- **Rollout order:** custom-foods migration and `nutrition` deploy are live (2026-10-10). The hard-paywall migration (`20261010120000`) is applied only after 1.0.4 is live in the App Store.

## 2026-10-25 – Plan → Unterwegs mit echten Ketten (`wip4/chains`, 1.0.6)

- [x] Offizielle Nährwerte je Markt in `src/data/chains/{de,gb,us}.json` (Quelle-URL und Prüfdatum je Artikel, Atwater-geprüft): DE 8 Ketten/180 Artikel, GB 15/391, US 16/412; zusammen ~400 KB. Ohne offizielle Daten ausgelassen: DE Pizza Hut, Domino's, Dunkin', Vapiano, L'Osteria, Haus des Döners, Nordsee, Ditsch, Kamps, Lila Bäcker (geschlossen); GB Domino's (Geo-Sperre); US Dunkin' (Geo-Sperre), Jersey Mike's (nicht erreichbar).
- [x] `services/chainCombos.ts`: drei Bestellungen aus drei Ketten des Markts (`useMarketRegion`), Hauptgericht + optional Beilage/proteinhaltiges Getränk + kalorienfreies Getränk, ≤ 10 % über dem Restbudget, Diäten über `meetsDiet`, Ziele über `preferenceBonus`, Frühstück nur vor 11 Uhr, deterministisch, < 20 ms.
- [x] `ChainComboCard` aus den PlanOptionCard-Bausteinen; „Das bestelle ich“ öffnet die Bestätigung mit allen Artikeln als eine Mahlzeit. Ohne veröffentlichtes Portionsgewicht zählt die App in Portionen („1 × 1 Burger“), nie in erfundenen Gramm (`unitOnly`).
- [x] Weniger als drei passende Bestellungen (z. B. vegan in den USA) → der Unterwegs-Katalog bleibt, genau drei Optionen.
- [x] `scripts/validate-chain-combos.mjs` in `verify`; Hinweise in `THIRD_PARTY_NOTICES.md`.
- [ ] Offen (Mensch): Stichprobe je Kette gegen die Quelle; Nando's UK (Makros aus Datei von 01/2022, nur Artikel mit identischen kcal im aktuellen Menü), Taco Bell US (Werte aus dem Nutritionix-Panel der offiziellen Produktseiten), Shake Shack US (PDF 04/2025), Burger King UK (gescanntes PDF, per Auge gelesen); Gerätetest der Karten (Dark Mode, große Schrift); Daten vor jedem Release neu prüfen.

## 2026-10-12 – Deutscher Produktindex `products_de` (Branch `wip3/productdb`, nicht deployt)

- Build (2026-10-12, OFF Parquet-Export): 228.540 in Deutschland verkaufte Produkte (21.788 davon pro 100 ml), 14,4 MB gzip; 25 % mit Store-Tag. Verworfen: 19.651 ohne vollständige Nährwerte, 5.636 Atwater-unplausibel, 6.064 ohne Namen u. a.
- `search_products_de` lokal (Postgres 17, voller Datensatz): 7–43 ms je Suche; „lidl skyr“ → Milbona, „ja gouda“ → ja!, „k-classic joghurt“ → K-Classic.
- `/v1/search` fragt zuerst den Index (`scope=products` immer), Live-OFF nur bei < 3 Treffern/Fehler; Barcode erst Index, dann OFF. Index-Treffer verbrauchen kein OFF-Kontingent.
- Offen (Lead): Migration `20261012120000_products_de.sql` anwenden, Daten laden (`scripts/load-products-de.mjs`), `nutrition` deployen; ODbL-Export des Builds veröffentlichen oder auf Anfrage bereitstellen.

## 2026-10-10 – Harte Paywall nach dem ersten Scan (Branch `wip2/hardwall`, nicht ausgeliefert)

Eigentümerentscheidung 10.10.2026: Umsatz pro Installation. Ersetzt für **neue** Installationen die weiche Paywall aus dem pausierten Test vom 09.10.; bestehende Installationen behalten ihren Umfang.

- [x] **Server:** Modus `hard_after_first_scan` in `private.paywall_config` (an, Stichtag einmalig beim Anwenden gespeichert). Neue Konten: genau 1 kostenlose KI-Analyse und 1 kostenlose Mahlzeit (`private.paywall_free_meals`), danach `hard = true` über die bestehenden Wege (Gateway 402, Mahlzeit-Freigabe, Meal-Trigger). Laufender Trial = aktives Entitlement. Bestandskonten, Zuordnungen vor dem Stichtag und aktive A/B-/QA-Varianten bleiben `legacy` (3 Analysen, weiche Paywall). md5-Guards auf allen drei ersetzten Funktionen; `validate-hard-paywall-postgres.py`.
- [x] **App:** Servermodus maßgeblich, offline gilt das Installationsflag (erster Scan erlaubt, danach Paywall). Nach der ersten gespeicherten Mahlzeit bzw. „Später“ führen alle Routen außer Paywall, Konto & Hilfe, Rechtstexten, Datenschutz/Einwilligung, gespeicherten Mahlzeiten und Kontolöschung zur Paywall; das Ergebnis der ersten Mahlzeit bleibt bis zum nächsten Schritt sichtbar. Harte Paywall ohne X, Wischen oder Zurück: Jahresabo vorausgewählt, „Dein Plan steht. Starte jetzt deine 7 Tage gratis.“, Preis und Monatsäquivalent aus RevenueCat, „7 Tage gratis starten“ bzw. „Kandro Pro starten“ ohne Trial-Berechtigung, Wiederherstellen, Bedingungen/Datenschutz, Konto & Hilfe, Fair-Use-Hinweis. First-Scan: „Deine kostenlose Probe-Analyse“, ohne Gratis-Umfang-Karte. Sichtung `markPaywallShown('hard')`.
- [x] **Ehrlichkeit:** Store-Texte DE/EN mit Abschnitt ZUGANG/ACCESS, AGB/Datenschutz 2.6 (neue vs. bestehende Konten, Speicherung der kostenlosen Mahlzeit), Review-Notes mit Prüfpfad, Website-Rechtstexte neu erzeugt.
- [x] **Validatoren:** neu `validate-hard-paywall.mjs` (in `verify`) und `validate-hard-paywall-postgres.py`; angepasst: Store-Listing, Rechtstexte, Abo-Hinweis, Trial-Entitlement, bestehende Mocks.

Offene Produktionsschritte (Eigentümer, nicht durch Claude ausgeführt):

- [ ] Reihenfolge: **zuerst** den App-Build mit diesem Stand veröffentlichen, **danach** Migration `20261010120000_hard_paywall_after_first_scan.sql` anwenden (Stichtag = Anwendungszeitpunkt). Ältere Builds verstehen `mode` nicht und würden bei neuen Konten nur serverseitig blockiert. Vorher `20261009100000`–`20261009100300` anwenden, falls noch offen.
- [ ] Edge Function `nutrition`: keine Codeänderung nötig (reicht `mode`/`freeAnalyses` unverändert durch); nur deployen, falls der Stand vom 09.10. noch nicht live ist.
- [ ] Gerätetest: Neuinstallation → eine Analyse → Paywall ohne X → Sandbox-Trial → App offen; „Später“ → Paywall; Bestandsinstallation unverändert; Flugmodus nach dem ersten Scan.
- [ ] Store-Texte in App Store Connect übernehmen; Abschalten bei Bedarf: `update private.paywall_config set hard_after_first_scan=false`.

## 2026-10-10 – Plan → Supermarkt mit echten Produkten (`wip2/supermarket`)

- [x] Gebündelter Open-Food-Facts-Auszug (`src/data/supermarketProducts.json`, 397 Produkte, ~104 KB) per `npm run data:supermarket`; Händler nur aus dem OFF-Stores-Tag, nie aus der Marke abgeleitet.
- [x] Drei Einkaufskombis (Protein-Anker + optional Obst/Brot + Beilage), deterministisch, ≤ 10 % über dem Restbudget, Präferenzen als harte Filter.
- [x] „Das hole ich mir“ öffnet die Bestätigung mit allen Produkten vorausgefüllt und trägt sie als eine Mahlzeit ein (kostenlos, keine Analyse).
- [x] ODbL-Hinweis in Plan und `THIRD_PARTY_NOTICES.md`; `scripts/validate-supermarket-combos.mjs` in `verify`.
- [ ] Offen: Stichprobe der Produktdaten gegen echte Packungen, Gerätetest der Karten (Dark Mode, große Schrift), Datenaktualisierung vor jedem Release.

## 2026-10-09 – Growth/Funnel release (`growth/1.0.4-funnel`)

Zusammenführung aller Arbeitsstränge seit `20f93d3`. Ziel: mehr erste gespeicherte Mahlzeiten, weniger erstattete KI-Analysen, Messung ohne Client-Analytics.

- [x] **Erster Start:** Ziel → Plan → Einwilligung → `/first-scan` (Foto / Sprechen / Tippen, ehrlicher Hinweis auf die Gratis-Analysen) → weiche Paywall genau einmal → optionale Erinnerung. Kürzere Onboarding-Schritte, Geburtsjahr-Liste ohne Vorauswahl.
- [x] **16+:** Altersgrenze 16 auf dem Client (Sperrbildschirm unter 16, kein Erziehungsberechtigten-Flow mehr erreichbar); 16–17 behalten die Jugendformel. Nie ein Defizit unter BMI 18,5, Zielgewicht nicht unter BMI 18,5. Datenschutz/AGB 2.5, Einwilligung `2026-10-09-ai-v3`, Website und Store-Texte auf 16+.
- [x] **Flexibles Erfassen:** unklare Mengen landen als geschätzte Portion auf „Bestätigen“ statt als 422 (Gateway und Client), drei Vertrauensstufen (Sicher / Geschätzt / Bitte prüfen), Nachtragen bis 30 Tage über den Tageswechsler auf „Heute“, Suche speichert alles Gewählte als eine Mahlzeit, Favoriten.
- [x] **Gewohnheiten:** personalisierte Mahlzeit-Erinnerungen für die kommende Woche, eine einzige Wiederkehr-Notiz, Wochenziel (4 von 7 Tagen) statt Streak, abgestufte Überschreitungs-Texte, gemeinsame Tageszeit-Logik (`src/utils/daypart.ts`) für Begrüßung und Mahlzeit-Slot.
- [x] **Paywall:** Test `paywall_access_v1` pausiert (weiche Paywall für alle); Vorteile versprechen nur, was Pro wirklich ergänzt – Mahlzeitideen bleiben gratis. Grenz-Paywall erst nach den 3 freien KI-Analysen.
- [x] **Serverseitige Messung:** `failure_code` für jede erstattete Analyse, Funnel-Views `private.growth_funnel_daily` / `private.ai_failure_daily`, Paywall-Sichtungen per RPC `mark_paywall_shown`; globaler KI-Breaker standardmäßig 5000/Tag.
- [x] **Beobachtbarkeit:** Sentry-Traces zu 10 % mit Span-/Transaction-Scrubbing; ruhende Gemini-Einwilligungstexte entfernt, KI-Suchhilfe bleibt aus.
- [x] **Store:** Listing führt mit „was als Nächstes passt“, Screenshots mit „782 kcal übrig. Was jetzt?“ und Schätzung statt Exaktheit; klare Free/Pro-Abgrenzung.
- [x] **CI/Doku:** CI läuft auf `release/**`, Impressum-Identität aus Repository-Variablen; Doku zu 16+, Sentry-Privacy-Labels, Funnel und aktueller Version.
- [x] **Design & Barrierefreiheit:** Schrift nirgends unter 12 pt (Validator), Scan-Modi 13 pt; neuer Token `attentionText` für Bernstein-Text (≥ 4,5:1), Makrofarben nur auf Balken; Darstellung folgt standardmäßig dem System (Wahl System/Hell/Dunkel in „Du“, gespeicherte Wahl bleibt), Scan-Schatten folgt dem aktiven Theme; VoiceOver-Beschriftungen für Heute, First-Scan, Paywall-Pläne und Geburtsjahr.
- [x] Wiederholen-Pfad nutzt die gemeinsame Tageszeit-Uhr; Validatoren prüfen jeweils das neue, beabsichtigte Verhalten.

Offene Produktionsschritte (Eigentümer, nicht durch Claude ausgeführt):

- [ ] Migrationen `20261009100000`–`20261009100300` in Produktion anwenden, **danach** `nutrition` deployen.
- [ ] App-Store-Altersfreigabe in App Store Connect auf 16+ setzen.
- [ ] Store-Screenshots neu rendern (`python3 app-store/compose/render.py`) und hochladen.
- [ ] Repository-Variablen `IMPRESSUM_NAME`, `IMPRESSUM_ADDRESS`, `IMPRESSUM_EMAIL` anlegen.
- [ ] OpenRouter: Data-Privacy-Framework-Zertifizierung bzw. Standardvertragsklauseln (DPF/SCC) prüfen und ablegen.
- [ ] Gerätetest des kombinierten Kandidaten (erster Start, Erinnerungen, Dunkelmodus nach System, VoiceOver, Paywall) vor jeder Einreichung; Release-Gate in `AGENTS.md` gilt weiter.

## 09.10.2026 – Paywall-Test pausiert, Backend-Messung ohne Client-Analytics

- **Paywall-A/B-Test `paywall_access_v1` pausiert.** Grund: nur ~10 eingeschriebene Nutzer, Ergebnis nicht interpretierbar; die harte Wall kostete Aktivierung. Migration `20261009100300_pause_paywall_access_test.sql` setzt `public_enabled = false` **und** `enforcement_enabled = false`: weiche Paywall für alle, auch bisher zugeordnete B-Nutzer (nur `public_enabled = false` hätte B hart gelassen). Zuordnungen bleiben für die Auswertung erhalten. Neustart nur per Eigentümerentscheidung (`supabase/queries/enable_paywall_experiment.sql`).
- Fehlercodes für erstattete KI-Analysen (`analysis_requests.failure_code`), Funnel-Views `private.growth_funnel_daily` / `private.ai_failure_daily`, serverseitige Paywall-Sichtungen (`private.paywall_exposures`, RPC `mark_paywall_shown`). Abfragen: `docs/GROWTH_FUNNEL.md`.
- Globaler KI-Tages-Breaker: Standard 5000 statt 1000 (`GLOBAL_ANALYSIS_DAILY_LIMIT`, siehe `docs/GATEWAY.md`).
- [ ] Freigabe: Migrationen `20261009100000`–`20261009100300` anwenden, **danach** `nutrition` deployen; Produktions-Secret `GLOBAL_ANALYSIS_DAILY_LIMIT` prüfen.
- [ ] Prüfen, ob `20260926221131_meal_portion_factor_range.sql` (Grammänderungen > Faktor 20) in Produktion angewendet ist; laut `docs/qa/SYNC-KORREKTUREN-2026-09-27.md` war sie am 27.09. noch nicht live.

## Apple-Warnung nach Verknüpfung — 05.10.2026, nach Build 38

- [x] Gemeldete Kombination „Mit Apple verknüpft“ plus generische Warnung im
  stale-response-Pfad reproduziert. Erfolgreiche Verknüpfung frisch vom Server
  lesen, bevor das Apple-Token gespeichert wird; gleiche ID und Subject prüfen.
- [x] Erneute bewusste Apple-Bestätigung für bereits betroffene Konten und
  eigener Hinweis für einen nachgelagerten Cloud-Abgleichfehler ergänzt.
- [x] Gezielte Service-/Komponentenregressionen einschließlich tatsächlicher
  installierter Supabase-SDK-Kette mit synthetischen HTTP-Antworten bestanden.
- [x] Ersatzbinary 1.0.3 (39) intern in TestFlight verfügbar. Produktionsprüfung
  am 06.10.: ein Apple-Token gespeichert, letzter Schreibzeitpunkt 05.10.2026
  21:42:48 UTC. Die vorherige Aussage „Tabelle leer“ ist damit überholt.
- [ ] Sichtbarer Apple-Anmelde-Nachtest und Gerätepflichtfälle des gemeinsamen
  Kandidaten mit den nach Build 39 hinzugekommenen Claude-Korrekturen.
  Speicherung allein bestätigt weder die Warnungsfreiheit noch den neuen Build.

## Verbindlicher Nachtrag 05.10.2026: Claude-A/B-Stand wiederhergestellt

- [x] Ausdrückliche Eigentümerkorrektur umgesetzt: geeignete neue Erwachsene auch
  anonym, freiwillige Kontoverknüpfung; dauerhafte 50/50-Zuteilung A/B mit bisheriger
  Hard Paywall. Öffentliche Aufnahme wieder aktiv, bisheriger Start unverändert.
- [x] Zwei historische SQL-Funktionen und Konfiguration live exakt zurückgelesen;
  zusätzliche drei Gratis-Ausnahmen entfernt, ursprüngliche Zuteilungen,
  Kaufrechte, Daten und QA-Overrides unverändert. Neue vorwärtsgerichtete Migration,
  alte Migrationshistorie erhalten.
- [x] Sechs lokale PostgreSQL-Prüfgruppen einschließlich zehn Migrationen in
  Reihenfolge: A/B, anonyme Neunutzer, Ausschlüsse, stabile Verknüpfung,
  Kaufvorrang, QA und Clientrechte. Kein echter StoreKit-/Gerätetest behauptet.
- [x] Build38 bleibt dasselbe bereits signierte und geprüfte IPA; kein neuer Build
  für diese serverseitige Wiederherstellung erforderlich.
- [ ] Apple-Schlüsseldatei/Backend, TestFlight38 und tatsächliche Geräte-/Store-
  Prüfungen sowie aktuelle Screenshots bleiben im bestehenden Releaseplan offen.

Die konservativen Kohorten- und Aktivierungsangaben in älteren Abschnitten sind
historisch; maßgeblich ist die obige Eigentümerentscheidung.

## Build 36 purpose-string repair, 04.10.2026

- [x] Actual 1.0.3 (36) IPA inspected: host and widget versions agree, but host
  `NSPhotoLibraryUsageDescription` and `NSMicrophoneUsageDescription` are absent;
  Apple rejected the upload with both ITMS-90683 errors.
- [x] Base DE/EN photo/dictation purpose descriptions and camera/speech plugin
  conflict repaired locally. Existing privacy regression executes native plist
  generation rather than trusting config alone; old Build 36 proof preserved.
- [ ] A specifically authorized replacement binary must pass actual IPA and
  Apple processing checks before TestFlight availability can be claimed.
- [ ] Real-device testing and the owner's exact review approval remain separate
  from successful generation or upload. No App Review or customer release here.

## Maßgeblicher Folgestand, 04.10.2026

Die älteren Build-, Budget- und A/B-Angaben darunter sind historische
Zwischenstände. [Aktueller Bericht](qa/GROWTH-FOLLOWUP-2026-10-04.md) trennt
Implementierung, lokale Prüfung, tatsächlich bereitgestellten Stand und offene
Geräte-/Freigabegates.

- [x] Konservative Kohorte auf ausdrücklichen Nutzerwunsch remote
  wiederhergestellt und Rechte/Funktionsdefinition nachgelesen; öffentlich aus,
  keine neue Zuteilung und keine Modellaufrufe bei dieser Prüfung.
- [x] Build 1.0.3 (26) bei Apple `VALID` / intern `IN_BETA_TESTING` nachgewiesen.
  Dieser Build enthält die nachfolgenden lokalen Änderungen noch nicht.
- [x] Optionales persönliches Ziel und kürzeres Onboarding, ehrliche
  Store-Trial-Auswahl/Abbruchhilfe, Trialaktivierung, Pro-Wochenrückblick,
  enger BLS-Vorrang und tatsächliches gestriges Frühstück lokal implementiert.
- [x] Separat freiwillige RC-Messzustimmung samt Widerruf, dauerhafter
  Servergruppe, QA-/StoreKit-Herkunftsfilter und Mess-Frischegate implementiert;
  gezielte Modul-, Swift-Typecheck- und isolierte SQL-Regressionen bestanden.
- [x] Vollständiger Verify nach sämtlichen Funktions- und DE/EN-Copykorrekturen:
  Exitcode 0, Expo Doctor 18/18 und Webexport;
  `growth-followup-20261004/verify-final-after-copy-result.json` belegt den
  Abschluss am 04.10.2026 um 15:41:38 UTC.
- [x] Bestehendes Jahresprodukt in 175/175 Gebieten auf sieben kostenlose
  Einführungs-Tage eingerichtet und rückgelesen; reguläre Preise unverändert.
  Geräte-StoreKit-Antwort/Eligibility bleiben gesondert offen.
- [ ] Native Touchmatrix auf dem final synchronisierten Quellstand;
  System-App-Boot blockiert vor Kandro. Host-/Widgetbuild einschließlich neuem
  Swift-Helfer bestanden; Compiler und Export ersetzen keine Bediennachweise.
- [x] DE-Onboarding/Persistenz, Frühstück genau einmal, Such-/Mengen-/Saveweg,
  EN-Pasta-Sortierkorrektur, EN-Onboarding mit US-Einheit und einzelne
  Erinnerungsauswahl/Zeitänderung im lokalen Browser tatsächlich bedient;
  deklarierte Auth-/Store-Fixtures, keine Cloud-/Kauf-/Fotoqualitätsbehauptung.
- [x] Zielprofil-/QA-Quellenmigrationen remote rückgelesen, 12/12 Gates;
  nutrition 63 ACTIVE/JWT einschließlich enger Rankingkorrektur, 9/9 Readbackgates
  und 16/16 Quellhashes; vier andere Funktionen unverändert.
- [ ] Websitepaket im tatsächlich freigegebenen Umfang abschließen: sechs Seiten
  lokal, frühere 0-€-Freigabe benennt nur vier Rechtstexte; nichts neu publiziert.
- [ ] Konkreten neuen Store-Kandidaten einfrieren; zusätzliche Buildfreigabe,
  frische Kosten-/Signierungsprüfung, tatsächliche IPA-Prüfung und interner Upload.
- [ ] Physischer Upgrade ohne Deinstallation, Foto/Beschreiben/Suche/Barcode,
  Kauf/Restore/Ablauf, Widgets und Mitteilungsentscheidung im tatsächlichen Build.
- [ ] 20–30 reale gewogene Mahlzeiten nach vorab festgelegtem Protokoll prüfen.
  Aktuell enthält die Messdatei **0** gewogene Fälle; keine Genauigkeitsquote.
- [ ] RC-Serverzustellung/Widerruf sowie echter TestFlight-Negativfall und später
  öffentlicher Store-Herkunftsfall separat prüfen; keine Conversionbehauptung.
- [ ] Exakte Reviewfreigabe `REVIEW FREIGEBEN: X (Y)` nach Geräteabnahme.
  Kundenrelease, öffentlicher A/B-Start und ein möglicher späterer 100%-Rollout
  folgen daraus nicht automatisch.

Modellbudget: mindestens 70 bekannte Aufrufe, höchstens 42 rechnerisch offene
Aufrufe von 112; 3,50 € reserviert und 6,50 € unreserviert innerhalb 10 €.
Reservierung ist keine tatsächliche Abrechnung. Vor weiterer kostenpflichtiger
Serie abgleichen; Gemini und KI-Suchhilfe bleiben aus.

## Rückmeldung vom 30.09.2026 – lokaler Kandidat

- Fotos in Bestätigung und Ergebnis passen vollständig in den vorhandenen Rahmen (contain bei echten Foto-URIs).
- Unaufgelöste reine Milchangaben mit Fettprozent öffnen echte Datenbankvorschläge; Auswahl und Menge bleiben ausdrücklich beim Nutzer. Speichern unbekannter Nährwerte bleibt gesperrt.
- Aktuell Apple: 1.0.2 (19) genehmigt, ausstehende Entwicklerfreigabe; öffentlich weiterhin 1.0.1. Die heutigen und die bestehenden Sync-Korrekturen sind nicht in Build 19.
- Lokale Prüfsuite bestanden; gezielter nativer/physischer Nachtest der heutigen Änderungen bleibt offen. Keine Veröffentlichung oder Produktionsänderung in dieser Aufgabe.
- Maßgeblich für den neuen Stand: `docs/qa/SCAN-FEEDBACK-2026-09-30.md`; Nachweise und Kandidatenmanifest außerhalb iCloud unter `/Users/hewaddorani/Developer/Kandro-QA-Feedback-20260930`.


## Current handoff, 2026-09-27

The dated sections below are historical, not the current release gate. Build
1.0.2 (19) was submitted on 26 September at 23:34 Europe/Berlin with **manual**
release after approval. The existing atomic-sync migration was deployed once
and nutrition v53 verified before that build. Camera/AI and sandbox purchase/
restore still lack individual final physical evidence; owner confirmations are
recorded separately. See the workspace `Release-1.0.2-2026-09-26/STATUS.md`.

- [x] Local follow-up: distinguish old factor rounding / ingredient ordering
  from real content conflicts, including legacy conflicts already flagged by
  Build 19. Real pending edits retain their mutation/revision protection.
- [x] Prepare a separate bounded migration for the existing gram editor's full
  ratio range. Preserve amounts, references, nutrition limits, RPCs and RLS.
- [x] Close the additional real Auth/JWT/PostgREST regression: 10/10 targeted
  groups pass on the preserved existing stack, fully copied outside iCloud.
  Fresh local upload archive / iOS Hermes export and 18 isolation checks pass.
- [ ] Deploy **new** migration `20260926221131_meal_portion_factor_range.sql`
  requested by the owner, but held until the corrected build path is feasible.
  Current Free iOS quota: 15/15 used through 1 October. Owner chose to wait
  for the next free quota; continuation scheduled for 1 October, 10:00 Berlin.
  Apple confirmed 1.0.2 (19) waiting for review, with manual release.
  No new build, upload, production mutation or review change performed.
- [ ] New mobile candidate/build and corresponding physical checks after the
  local follow-up. These source changes are **not in the submitted Build 19**.

Current targeted evidence: `docs/qa/SYNC-KORREKTUREN-2026-09-27.md`.

## Local stabilization, 2026-09-26

- [x] Confirm and fix damaged-storage recovery, serialized auxiliary writes, stale billing/account results, pending purchase classification, decimal portions and free/deduplicated repeats.
- [x] Full local verify, 29 new behavioral regressions and 12 isolated PostgreSQL groups; native scoped storage/restart/deletion/portion/error-recovery checks, plus larger-text heading correction. Rapid unit reversal found and fixed in final review.
- [ ] Complete native matrix, physical camera and real StoreKit/production verification only under a later separate authorization. Initial native isolation incident is documented in `docs/qa/KANDRO-STABILISIERUNG-2026-09-26.md`.
- [ ] Separately authorize and stage the existing additive meal-sync migrations / OFF Edge fix before a compatible new mobile release. Nothing in this task authorizes deployment.

## Local priority fixes, 2026-09-17

- [x] Cap default recommendation portions to the remaining budget, with an optional 200 kcal small-meal floor and visible target-overage disclosure. Keep ideas reachable near/above the daily target.
- [x] Keep recommendation preview, relative portion choices, recipe quantities and saved nutrition consistent. Validate 2,592 DE/EN recipe/preview/save combinations, including 20 kcal remaining, 200 kcal remaining and already-exceeded targets.
- [x] Separate paid photo/text analysis from permanently free features in the bilingual Pro paywall.
- [x] Derive dashboard/result calorie and protein previews from the actual available scaled suggestions.
- [x] Pass the complete local `npm run verify` gate and targeted iOS 26.5 simulator QA in DE/EN: 20/200 kcal remaining, all three contexts, recipe scaling, less/more, exact persisted meal total, and free/paid paywall copy. These local changes are not included in the public 1.0.0 (16) binary. No new build, paid AI call, purchase or deployment was made.

## Historical submission, 2026-09-06

Build **1.0.0 (16)** passed the scoped core check and was submitted to App Review with Kandro Pro group/monthly/annual. All four items are **Waiting for Review**, submission `6124065d-7d86-4075-bfbe-7a17c5427d8e`. The older entries below retain historical/unverified work; they do not mean submission authorization is missing. DSA remains pending for EU publication. See the final-pass VERDICT and CORE_TESTS for the precise verified scope.

## Local recovery and Build 14 follow-up, 2026-09-06

- [x] Reproduce and fix identity conflicts bypassing BLS through USDA fallback in both gateways; exercise shared-query results and legacy/new correction protocols. Live follow-up and deployment evidence: `release/app-store-audit/35_NUTRITION_DEPLOYMENT_QA.md`.
- [x] Publish the approved nutrition correction as function version 50, preserve JWT verification, compare all ten live source files and pass DE/EN plus legacy/auth/consent live checks. Chocolate-with-biscuit and physical-photo evidence remain open.

- [x] Clone verified remote `633d688` outside iCloud and compare all 65 overlapping backed-up files: identical. Unreadable original changes are not proven recovered.
- [x] Reconstruct and behaviorally test typical-value aliases for crispy muesli, remoulade and paprika potato chips, preserving amounts and rejecting conflicting light/sugar-free/milk/yogurt preparations.
- [x] Add bilingual generic-reference disclosure; granola uses the dedicated BLS granola row.
- [x] Reproduce stale daily remaining values after editing an already-saved meal in the iOS simulator; replace that meal in the projection and persist its confirmed revision. Behavioral tests cover new, saved, edited and over-budget meals alongside unrelated entries.
- [ ] Resolve chocolate-with-biscuit with a suitable verified reference; the wholemeal-biscuit bar does not establish Milka LU product values.
- [x] Build the standalone iOS Debug app with Xcode and install/start it on an isolated simulator. Expo Go native demo checks cover decimal keyboard, ingredient replacement, stable scroll endpoints and corrected budget persistence; this is limited coverage, not a full TestFlight pass.
- [ ] Complete the remaining native matrix and original-photo scroll reproduction; finish physical-device camera and StoreKit purchase/restore gates before review.

## Build 13 feedback: multi-ingredient correction

- [x] Show every detected food in the quick ingredient list, not only countable foods.
- [x] Targeted database/barcode-digit replacement with portion confirmation and explicit removal, preserving the rest of the meal.
- [x] Opt-in correction drafts for missing nutrient mappings; legacy clients remain fail-closed. No incomplete total, no saving unresolved ingredients, no additional AI charge for the lookup repair.
- [x] Behavioral regression coverage for 1-12 ingredient sums, replacement isolation, old/new gateway behavior and persistence/route guards.
- [ ] Verify the updated native interface on the next TestFlight build, including iPhone keyboard/back/cancel, replacement, removal and multi-food sums.
- [ ] Reproduce the reported apple/tomato/peach vision confusion using an original photo. Screenshots and text fixtures cannot establish visual recognition accuracy.

## Build 13 analysis feedback

- [x] Reproduce follow-up false negatives for `raisins green dried` and `pistachios in shell`; normalize only bounded variety/presentation wording, preserve food transformations and verify unchanged edible-weight scaling.
- [x] Reproduce bread/slice and dried-raisin false rejection. Normalize lookup-only portion wording and bridge common nuts/dried fruit/dairy/prepared ingredients to reviewed BLS source rows without inventing nutrition.
- [x] Add behavioral regressions for query wording, source/portion scaling, decimal-fat identity, wrong egg dish keys and transformed-food rejection. Generic USDA lookup no longer competes primarily against branded rows or removes preparation as a fallback.
- [ ] Repeat the owner's original raisin/nut photos on the hosted correction and complete the weighed real-photo set. Text/lookup regressions do not prove universal visual accuracy.

## Review remediation, 2026-09-05

- Fixed partial barcode labels, progress pound precision/range mismatch, offline profile edit timestamps and deferred-state unit persistence. Regression coverage is part of `npm run verify`.
- Audited live DE/EN App Store draft, added subscription/terms/privacy disclosures, and corrected the banana screenshot's 252 g calculation. No App Review submission or new binary is implied. Current release gates and evidence: `release/app-store-audit/28_REMEDIATION_METADATA_REVIEW.md`.

## Build 8 feedback, 2026-09-05

- [x] US onboarding/profile weight stepper uses 0.1 lb and no intermediate 0.1 kg rounding. Regression sweeps lb inputs and database precision; native rapid-touch/hold behavior remains a physical-device gate.

- [x] Reject incomplete scanned-meal nutrition instead of showing zero placeholders; exact BLS ingredient fallback and USDA food-identity gate prevent dried dates matching dried lotus seeds. Existing stored meals are not automatically rewritten; recognition of arbitrary photos remains a device/evaluation gate.

- [x] Exact decimal weight entry in both onboarding and profile plan editing: comma/point, explicit save/cancel, existing bounds, 0.1 kg steps and no unit-switch rounding of stored weight. Native decimal-keyboard layout remains part of the next iPhone pass.

- [x] Build 11 feedback: reproduce honeydew energy 0 against USDA Foundation 2710816; map Atwater energy fields and preserve correction precision. Hosted text regression now returns 329 kcal for an explicit 1000 g edible portion. Existing incorrectly saved meals are not silently rewritten.
- [x] Prevent retained scan navigation stacks; verify 30 cycles with the actual navigation reducer. Restrict camera to focused/foreground screen and bound iOS acquisition resolution.
- [ ] Obtain and inspect the reported iPhone crash/Jetsam log and repeat at least 15 physical photo cycles in a replacement native build. Browser/reducer tests do not certify native camera stability.

- [x] Follow-up QA: midnight refresh, privacy-safe analytics event, eligibility-gated trial copy, localized demo ingredients, consent contrast and stepper accessibility units. Full browser QA evidence is in `release/app-store-audit/22_FULL_APP_QA.md`.
- [x] Landing/app consistency: guest account, guardian requirement, photo retry retention and recipe scope clarified; waitlist network timeouts recover with localized feedback.

- [x] Build 9 billing follow-up: reproduce active Apple sandbox receipt denied by server because the v2 entitlement is unexpanded; accept allowlisted subscription product + active entitlement without requiring nested products. Regression covers real response shape and retains wrong-store/product/entitlement rejection. On-device restore confirmation remains required.

- [x] Reject empty scan confirmation/save; suppress empty confidence; use two-row ingredient controls on narrow screens; hide result recommendations below the same 150 kcal threshold as Today/Plan; remove adult caps/floors from adolescent maintenance calculation.
- [ ] Local native simulator pass blocked: only Command Line Tools installed, no discoverable Xcode or simctl. Install full Xcode and an iOS runtime before claiming a simulator pass.

- [x] Replace search slide with fade/Reduce Motion; direct detail-row gram entry preserves 110.3 g; independently assert target arithmetic for the adult profile test matrix.

- [x] Replace stacked search/portion modals; keep amount editor close/save reachable.
- [x] Recognized piece count, count stepper, estimated per-piece calories, and correction round-trip regression.
- [x] Light first-launch default, persisted profile appearance switch, dynamic palettes and corrected dark-mode foregrounds.
- [x] Plain pancakes before compound variants; invalidate outdated search responses immediately.
- [x] Full verify gate plus live model text test: 3 pancakes / 240 g returns 80 g per piece.
- [ ] Verify a replacement native candidate on a physical iPhone: decimal keyboard close/save, search add, real photo count correction, touch targets, appearance persistence. Build 8 itself is unchanged.
- [ ] Preserve household-unit metadata when restoring logged meal history from cloud (current active scan/search correction does retain it).

## Current status: Day 4 app work complete; native TestFlight and legal gates remain

- [x] Kandro name, mark, app icon, and exact brand tokens
- [x] German product UI
- [x] Six-step personalized onboarding with visible wellness guardrails
- [x] Persist onboarding completion, calculate real targets from the entered profile, and apply saved preferences to recommendations
- [x] Today dashboard with derived calories and macros
- [x] Central full-screen camera flow with permission and demo states
- [x] Staged analyzing state
- [x] Detected-food confirmation with one-tap meal sizing and optional gram correction
- [x] Result sequence with estimate count-up, remaining count-down, confidence, and reduced-motion support
- [x] Zuhause, Supermarkt, and Unterwegs recommendation contexts
- [x] Exactly three suggestions per context
- [x] Progress and profile screens
- [x] Replace placeholder progress metrics with saved weight entries and actual meal history
- [x] Transparent mock paywall
- [x] Expo Go compatibility on SDK 54
- [x] TypeScript, Expo Doctor, web export, and iOS bundle checks
- [x] Typed service contracts for analysis, nutrition lookup, persistence, retry, and recommendations
- [x] Real Describe and camera Barcode fallbacks plus lifetime three-free-analysis enforcement
- [x] Credentialed real-photo smoke test on an iPhone with OpenRouter and USDA

## Day 2: real meal intelligence

Priority order:

1. [x] Add image resizing/compression and a temporary-upload boundary.
2. [x] Return structured detected foods, portions, and confidence from a multimodal model.
3. [x] Resolve normalized nutrition through USDA FoodData Central for fresh food.
4. [x] Add Open Food Facts as the packaged-food and barcode source.
   - [x] Add the user-facing Expo Camera barcode mode and 100-g correction handoff.
   - [x] Add a structured meal-description fallback through the same USDA boundary.
5. [x] Preserve the existing confirmation UI as the correction layer.
6. [x] Save the confirmed meal and reload Today from the repository.
7. [x] Add a local-first retry queue plus unclear-image and multiple-dish error states.
8. [x] Seed 45 curated German/English meal-planning estimates and rank exactly three deterministically by context, remaining macros, and preferences.

The code path, mock path, gateway health endpoint, Open Food Facts lookup, catalog validator, TypeScript, Expo Doctor, exports, and one credentialed real-photo iPhone smoke test are complete.

Acceptance criteria:

- A real photo produces editable structured ingredients rather than a single calorie guess.
- Nutrition values identify their source and remain explicitly estimated.
- The original image is deleted after local compression; confirmed meals never retain a photo.
- Corrections change totals before persistence.
- A saved meal survives an application restart.
- The current mock service remains available for deterministic previews and development.
- Recommendation nutrition comes from the verified catalog, never from generated prose.

## Day 3: real Autopilot and accounts

- [x] Optional Supabase client with persisted React Native session and anonymous authenticated bootstrap
- [x] Postgres profile, target, meal, item, recommendation, and feedback migration
- [x] RLS, least-privilege grants, constraints, and user/date indexes on every exposed table
- [x] Local-first confirmed-meal persistence with background cloud synchronization
- [x] Remaining macro calculation from cloud-hydrated targets and meals
- [x] Sync the actual onboarding profile, target, and preferences instead of display-only defaults
- [x] Exactly three deterministic catalog recommendations from the persisted daily state
- [x] Structured recommendation impressions plus acceptance/rejection feedback adapter
- [x] Create the dedicated Kandro Supabase project, enable anonymous auth, apply the migration, and run live RLS tests
- [x] Link an authorized Supabase CLI profile and reconcile the dashboard-applied migration with CLI migration history
- [x] Deploy the authenticated Supabase `nutrition` gateway with server-only provider secrets, a private per-user daily quota, and live barcode/text/photo security smoke tests
- [x] Run the cloud-hydration smoke test in Expo Go and verify the persisted anonymous session after an app restart
- [x] Add permanent account linking with verified email and password recovery; Apple remains optional after MVP validation
- [x] Expand the validated bilingual catalog from 45 to 200 meals after live schema and ranking validation
- [x] Add the complete 7,140-entry bilingual BLS 4.0 food search snapshot with localized German/English names and representative everyday ranking for German, US, UK, Turkish, and Asian foods
- [ ] RevenueCat subscription and restore flow
  - [x] Expo Go-safe Test Store adapter, Supabase identity, live Offering prices, entitlement check, purchase, cancellation, and restore UI
  - [x] Create RevenueCat project, `kandro_pro` entitlement, current annual/monthly Offering, and run a Test Store purchase/restore smoke test
  - [ ] Configure App Store Connect products and run a native StoreKit sandbox purchase in a development/TestFlight build
- [ ] PostHog product events and Sentry error reporting
  - [x] Add an Expo Go-compatible PostHog adapter with typed event allowlist, anonymous-only profiles, GeoIP/session replay/autocapture disabled, persisted opt-out, and scrubbed JavaScript error reporting
  - [x] Create the EU PostHog project, enable local collection, and run a live funnel/error smoke test
  - [ ] Add the native Sentry SDK, DSN, release source maps, and a live crash test in the first development/TestFlight build

## Day 4: launch quality

- [x] Deterministic 30-case regression matrix: 25 representative German meals plus poor light, blur, partial plate, multiple dishes, and unknown-food handling
- [x] Add 64 weighed German BLS 4.0 reference meals, exact source attribution, GPT-4.1-mini structured matching, portion ranges, and ambiguity-safe USDA caching
- [ ] Review at least 30 real iPhone meal photos against confirmed foods and portions before external beta distribution
- [x] Local-first no-network queue and explicit retry/unclear/multiple-dish states
- [x] Portion selector and gram correction browser smoke test
- [x] Semantic accessibility pass, meaningful labels/states, and Reduce Motion handling for navigation and analysis/result sequences
- [ ] Native VoiceOver, Dynamic Type, contrast, camera-permission, and offline retry pass on a physical iPhone
- [x] RevenueCat Test Store purchase, entitlement, and restore smoke test
- [ ] App Store Connect products plus native StoreKit sandbox purchase/restore in the TestFlight build
- [x] Versioned explicit AI/wellness consent, in-app withdrawal, server enforcement, bilingual privacy/terms, non-medical guardrails, and live Supabase account-deletion test
- [x] 14+ access with server-enforced guardian email confirmation for ages 14–15, adolescent growth-aware energy balance for 14–17, and analytics disabled for minors
- [x] Add legal controller/contact details, public support/privacy URLs, provider/transfer disclosure and ZDR configuration
- [x] Responsive Kandro landing page with private deployment plus privacy and terms routes
- [x] Publish the landing page and generated bilingual legal pages at getkandro.com
- [x] EAS production/preview configuration and App Store metadata/screenshot handoff
- [x] Create and link the Expo EAS project `@hewad/kandro`, and configure public preview environment values
- [x] Configure public Supabase values for production and keep the local analysis override absent from Preview and Production
- [x] Developer enrollment/paid contracts active; owner-authorized production Build 15 built and uploaded to App Store Connect on 2026-09-06 (final-pass report records processing/readiness status)
- [x] Owner confirmed Build 15 real photo, ingredient correction, save once, relaunch and matching daily balance; active restore after account recreation also confirmed without USB.
- [x] Fix maximum Dynamic Type paywall overflow; native DE/EN normal/max text, plan selection, terms/privacy navigation and live font-size changes retested locally; full verify passed.
- [x] Owner authorized one additional free build; Build16 with the verified paywall fix built, package checked and uploaded.
- [x] Apple processed Build16; selected and submitted with subscription group/monthly/annual on 2026-09-06 at 14:28 Europe/Berlin. All four items Waiting for Review; manual release remains. Evidence: `release/app-store-audit/final-pass/20260906-045638/EVIDENCE/core-release/apple-review-submission.json`.
- [ ] Continue remaining physical lifecycle/accessibility evidence and resolve EU DSA verification; unverified cases remain separate from passed core checks.
- [x] Final-pass preferred-language/region, bounded gateway networking and JPEG input regressions; nutrition v51 deployed and live-tested
- [ ] Complete weighed photo corpus, full manual accessibility/language matrix and regional legal/processor evidence before declaring release GO
- [ ] Re-check the current transitive Expo/Metro npm advisories during an isolated SDK upgrade; do not force-upgrade this Expo Go branch to SDK 57

The full core-plus-33-section audit is maintained in `docs/PLAN_34_AUDIT.md`. The source plan contains no fifth build day.

## Explicitly out of scope for v0.1

Workout tracking, steps, Apple Health, social feeds, friends, challenges, water tracking, AI chat, seven-day meal planning, grocery shopping, wearables, community, restaurant databases, and large recipe catalogs.


## 2026-09-18 UX follow-up — local implementation, not released

- [x] Visible onboarding weight input, decimal validation, ±1 kg/lb controls, DE/EN formatting and unit conversion.
- [x] First-run transition to Today with a five-step, dismissible navigation introduction; replay from Profile.
- [x] Explain the existing Pro boundary in the introduction without imposing a new paywall on recommendations.
- [x] Up to 60 sourced search results with progressive disclosure; basic bread/milk/yogurt queries show ordinary foods first.
- [x] Full configured verify; DE/EN web walkthrough, narrow layouts, extended-result selection through confirmation to daily totals.
- [ ] Native iPhone/simulator walkthrough (simulator launch blocked during this session), including keyboard and VoiceOver.
- [ ] Ship the reviewed gateway change and mobile candidate after native/release checks. Neither was deployed in this session.
- [ ] Implement save/sync integrity fixes and one canonical, deduplicated event for a successfully stored meal.
- [ ] Clarify whether the owner wants a NEW Pro feature for additional meal suggestions; the current three-per-context suggestions remain free. Collect concrete missing food examples for further catalogue work.

### 2026-09-18 native verification and TestFlight candidate

- Native iPhone 17 Pro / iOS 26.5 simulator: weight entry (90, 90.5, invalid/empty, ±1, unit conversions), setup-to-introduction, all five introduction steps/replay/back/scan handoff, DE/EN, search 15→30 of 60 and reset on a new query, 50 g food correction, one saved meal and persistence after process restart passed.
- Fixed keyboard-obscured Done with an iOS keyboard accessory; verified visible validation and dismissal natively.
- Version 1.0.1 prepared for a single free-quota production build and TestFlight upload. Completion is recorded separately in the workspace current-status report, not assumed here.
- Physical TestFlight camera/purchase/restore checks, sync failure/retry scenarios, canonical saved-meal analytics, and deployment of the expanded search gateway remain separate work. No App Review submission is part of this run.

## Release A, 2026-09-25: local audit remediation

- [x] Reproduce K01–K08 against the current local source; preserve prior dirty work.
- [x] K03–K05: atomic whole-meal RPC, version/conflict checks, retry receipts,
  deletion protection and complete portion/reference metadata.
- [x] Local pending edits survive reload/hydration; account-switch guards and
  visible local/cloud distinction with explicit conflict choices.
- [x] K02: shared OFF completeness/precision boundary and synthetic adapter tests.
- [x] K01: shared requested/applied target arithmetic and bilingual explanations.
- [x] K08: explicit weighing/reference state for all 67 recipes, matching source
  corrections, recalculated bilingual catalogues and preference regressions.
- [x] Real isolated PostgreSQL transaction/concurrency/access tests and local
  Supabase CLI database advisors. No production data used or changed.
- [ ] Full native view/interaction QA on the final local candidate (Mac lock
  interrupted the simulator inspection; current evidence is in workspace Release-A-2026-09-25).
- [ ] Authorized read-only inventory of existing production inconsistencies and
  separate decision about repairs; migration deployment is not a data repair.
- [ ] Authorized gateway/schema rollout and matching new build, then physical
  TestFlight camera, persistence/network/account switch and purchase/restore QA.
- [ ] A4 real opted-in adult/test-labelled public-build analytics verification.
  Existing consent/minor gates remain; no silent tracking or purchase was added.

K07 (repeat the same food today) remains Release B. K06 (historical daily target
assessment) remains Release C. Neither is claimed fixed by Release A.

## 01.10.2026 – Lebensmittel-Erfassung repariert, Modell-/Releasegate offen

Kurze Lebensmittelbegriffe, gezielte Synonyme, explizite Zehntelgramm-Mengen, korrekte Massen-/Volumengrenze, stabile Rundung, valide Erfolgs-/Teilantworten und persistente Capture-Replays sind lokal umgesetzt. Neue Regressionen ergänzen die bestehende Suite; PostgreSQL- und native Bildaufbereitung wurden getrennt geprüft. Gemini und die begrenzte KI-Suchhilfe bleiben deaktiviert, bis Route/Consent und tatsächliche Ergebnisqualität belegt sind.

Nächster Schritt ist die begrenzte Live-/Geräteabnahme dieses konkreten Kandidaten. Keine neue allgemeine Auditrunde oder Featureausweitung. DE-Suche/Text/Korrektur/Speichern/Neustart inzwischen nativ nachgetestet; weitere Gerätefälle sind nach erneuten Aufnahmefehlern offen. Google Clouds Unter-18-Vertragsbeschränkung verhindert ohne dokumentierte Ausnahme die Gemini-Aktivierung. Der bedingt freigegebene A/B/C-Vergleich bleibt offen. Sieben aktuelle Auth/JWT/PostgREST-Gruppen auf eigener lokaler Datenbankkopie sind bestanden; OpenRouter-Konto/ZDR/Guthaben sind lesend geprüft, ohne die Vertragsblockade aufzuheben. [Datierter Abschluss und konkreter Freigabevorschlag](qa/ERFASSUNG-GEMINI-2026-10-01.md).

## 02.10.2026 – ausdrücklich erweiterter Erfassungskandidat

- [x] Weitere belegte Suchfehler bei Zubereitung, Wortreihenfolge und DE/EN-Pluralformen repariert, einschließlich Fehlern aus zwei unbenutzten kleinen Testsätzen. Gegenproben erhalten ausdrücklich zusammengesetzte Produkte; keine erfundene unabhängige Erfolgsquote nach Anpassung.
- [x] Optionale lokale Erinnerung nach der Ersteinrichtung, granulare OS-Statusbehandlung, Profilverwaltung und sichere Erfassungstaps implementiert; alte Präferenzen erhalten.
- [x] Native Reviewanfrage mit echten lokalen Save-Ereignissen, neutralen Nutzungsschwellen, gerätebezogenen Grenzen und gemeinsamer Präsentationssperre implementiert.
- [x] Native Homescreen-/Lock-Screen-Widgets, private App-Group-Bridge, Opt-in und SDK-54-CNG-Plugin implementiert. Zweifacher privater Prebuild idempotent; Host und tatsächliche Extension lokal kompiliert und im Simulator installiert. Echter App-Snapshot aus bewusster Freigabe gelesen.
- [x] Reale öffentliche OFF-Produktabfrage und unbekannter Code geprüft; kein optischer Kamera-Nachweis daraus.
- [ ] Vollständige neue Onboarding-/Reminder-Touchwege, Widgetgalerie/Taps/Darstellungsvarianten sowie physischer Upgrade- und Erfassungsdurchlauf. macOS-Aufnahmefehler begrenzen die aktuellen UI-Nachweise; manuelle Beobachtung angefragt.
- [ ] Modell-/Fotovergleich mit nutzbarem sicherem Zugang, realen Referenzfotos und zulässiger Route. Bestehende Freigabe unverändert: höchstens 112 Aufrufe/10 €, bisher 0/0 €. Gemini und KI-Suchhilfe bleiben gesperrt.
- [ ] Apple-Capabilities/Profile, fehlende kompatible Backendänderungen, ein nachweislich kostenloser Storebuild, ein TestFlight-Upload und gegebenenfalls Review erst im ausdrücklich freigegebenen Umfang. Keine Remoteaktion aus dieser lokalen Implementierung ableiten.

Einziger laufender Ergebnisbericht mit finalem Manifest und offenen Gates: [Erfassung und Widgets](qa/ERFASSUNG-GEMINI-2026-10-01.md).


02.10.2026, freigegebene Fortsetzung: Beide Faktor-/Capture-Migrationen remote angewendet, Retention/Rechte geprüft; nutrition 55 ACTIVE/JWT nach realem Gratis-Smoke. Drei echte GPT-4.1-mini/Azure-Textfälle erhalten alle expliziten Mengen. Der daraus bestätigte USDA-Pluralfehler potatoes→potatoe ist behoben, Cacheversion 10, rote/grüne Regression und vollständiges Verify bestanden. Originalfehler bleibt im Nenner, kein Gemini-/Fotoqualitätsnachweis. Alle vier Medium-Widgetlinks tatsächlich nativ geöffnet. Sprach-/Warmstart-Entwurfsfehler repariert und nachgetestet. Apple-Anmeldung/Signierung und physische Pflichtfälle bleiben offen, kein Cloudbuild/Upload/Submit; genaue Ergebnisse/Budget im laufenden Erfassungsbericht.


### 02.10.2026 – Erfassungskandidat 1.0.3, echter Textvergleich

34 begrenzte echte Azure-Modellaufrufe einschließlich Ausgangs-/Nachtests; kein Gemini. Belegte Mengenbindungsfehler bei gezählten Eiern und Fettprozentformatierung behoben, Rot-Grün-Regressionen, gespeicherte Antworten replayt und vier gezielte neue Livefälle bestanden. Identität/Masse getrennt von Referenz-/Fotoqualität dokumentiert. `nutrition` 56 ACTIVE/JWT kompatibel veröffentlicht und kostenlos live nachgeprüft. Kompletter Verify-Gate und nativer Simulator-Host/Widget-Build 1.0.3 bestanden. EAS-Apple-Anmeldung/Store-Signierung, physische Pflichtfälle und Gemini-/Suchhilfeabnahme bleiben offen; kein Cloudbuild/Upload/Submit. Kosten, Quellmanifest und tatsächliche Grenzen im bestehenden `docs/qa/ERFASSUNG-GEMINI-2026-10-01.md`.


### 02.10.2026 – Store-Build 20: Privacy-Dateizuordnung korrigiert

Apple-Profile/App Group für Host und Widgets sind eingerichtet und direkt geprüft. Genau ein Store-Build 1.0.3 (20) erfolgreich kompiliert, aber vor TestFlight gesperrt: Bei frischem CNG griff React Natives Privacy-Aggregation für den Host auf die vorhandene Widget-Dateireferenz zurück. Im echten IPA fehlen dadurch die aggregierten Required-Reason-API-Angaben der Hauptapp. Der frühere wiederverwendete Simulator-Projektbaum enthielt bereits eine korrekte Hostreferenz und deckte diesen Fehler nicht ab.

`ios.privacyManifests` in `app.json` erzeugt jetzt durch das vorhandene SDK-54-Plugin vor CocoaPods eine eigene Hostdatei mit eigener Ressourcenreferenz. Keine SDK-/Anbieteränderung. `scripts/validate-widget-native-project.mjs <private-ios-dir> [--aggregated]` prüft tatsächliche Target-/Ressourcenreferenzen, getrennte Dateien, Duplikate und nach Pod-Installation die vier erforderlichen API-Kategorien. Regression am frischen alten Projekt rot; nach Reparatur mit zweimaligem Prebuild und echtem Pod-Install grün. Vollständiger Verify bestanden. Ein zusätzlicher Store-Build ist von der bisherigen Ein-Build-Freigabe noch nicht gedeckt; kein TestFlight-Upload oder Review. Frischer nativer Host-/Extension-Nachbuild jetzt ebenfalls bestanden; tatsächliche gebaute Manifeste getrennt und exakt geprüft. Ersatzkandidat `KANDRO-1.0.3-20261002-PRIVACY-FIX`; konkreter Ersatzvorschlag im bestehenden Kandidatenbericht.


### 03.10.2026 – Aktueller Folgeauftrag (ersetzt frühere Zwischenstände oben)

- [x] Konservativer stabiler A/B-Zugang nur für geeignete freiwillig verknüpfte Neunutzer, öffentlich weiterhin aus; Bestandsrechte erhalten.
- [x] Gemeinsame Soft-/Hard-Paywall, Konto/Recht/Altmahlzeiten, serverseitiger Zugriff und begrenzte Pending-Save-Belege; passende Regressionen und neun reale lokale Auth/JWT/PostgREST-Testgruppen.
- [x] Widget-Redesign und getrennte Onboarding-Mitteilungsentscheidung; kompletter Verify und frischer nativer Host/Widget-Build. Neue Galerie-/Homescreenansichten im Simulator beobachtet.
- [x] Additive Experimentmigration und nutrition 57 bereitgestellt; eigene synthetische A/B-Konten extern geprüft. Signierung erneut geprüft. Monatsprodukt: Apple-Einführungsangebot sieben Tage konfiguriert, reguläre Preise unverändert. Tatsächliche StoreKit-Antwort und Kauf bleiben Gerätepflichtfälle.
- [x] Genau ein neuer kostenloser Storebuild 1.0.3 (21), signierte IPA und interner Upload geprüft; Apple VALID/IN_BETA_TESTING, Kandro Internal/hewaddo28@icloud.com bestätigt. Build20 bleibt gesperrt.
- [ ] Nachgelagerte DE-Rechtstextzuordnung korrigiert (Datenschutz → Aboabschnitt), Rot/Grün und Verify bestanden; korrigiertes Binary benötigt eine zusätzliche begrenzte Build-/Uploadfreigabe. Build21 bleibt testbar, ist nicht der vorgeschlagene Reviewkandidat.
- [ ] Physischer Upgrade-, Kauf-/Restore-, Widget- und Erfassungsdurchlauf vor Reviewbestätigung. Öffentlicher Experimentstart nur zusammen mit gesondert bestätigtem Kundenrelease.
- [ ] Gemini und KI-Suchhilfe bleiben ohne zulässige Route/Qualitätsnachweis aus. Modellbudget unverändert 34/112 Aufrufe, ca. 0,0245082 USD; reale gewogene Fotoqualität weiterhin offen.

Maßgeblich bleiben der fortgeführte Erfassungsbericht und der einzige lokale Releaseplan dieses Kandidaten.


### 2026-10-03 — Beta22 blocker repaired; next binary pending

The actual reminder crash and description milk-volume rejection supersede prior Build22 review readiness. Native local navigation, amount correction/save/restart, full verification and bounded live text cases now pass; nutrition58 is deployed with unchanged access/model release gates. A separate Build23 candidate is prepared, requiring the explicit additional-build approval prescribed by the task. Physical TestFlight retest, real-photo quality and StoreKit/device gates remain open. See the continuing capture QA report and the single private release plan.

### 2026-10-03 — Build23 available; focused capture quality follow-up

Build23 was subsequently explicitly authorized, built and uploaded internally;
Apple confirmed VALID/IN_BETA_TESTING. Follow-up description/photo checks found
and repaired quantity binding, excluded/omitted ingredients and two exact reference
wording failures. The unchanged mobile binary can use these shared backend repairs.
The full current verification/deployment evidence is in the continuing capture QA
report and single private release plan. Physical TestFlight, real weighed photos
and StoreKit gates remain open; no universal recognition guarantee, Gemini
activation, public experiment start or review submission follows from these tests.

The requested hands-on native follow-up confirmed corrected description/photo
save totals and exposed a mounted-tab return losing its description. That client
path is repaired locally and requires a separately authorized replacement binary.
Additional explicit per-piece binding and weighed-oil warning fixes are live as
nutrition60; a new app build is not implied by that backend deployment. Current
native, full-suite and replacement-candidate evidence remains in the same QA report
and release plan. No second general audit or extra feature package was started.


## Beta-24-Feedback, 04.10.2026 (lokal)

- [x] „3l Milch und 2 Toast“: Toast wird erkannt; Suche zeigt gewöhnlichen Toast zuerst; Ein-Tipp-Vorschlag für unaufgelöste Zutaten.
- [x] Beschreibung blockiert nicht mehr bei unklaren Mengen; Getränke in ml/l.
- [x] Harte Paywall (B) für alle Neuinstallationen 50/50 vorbereitet; Rechtstexte 1.9.
- [x] Mahlzeiten-Erinnerungen zum Antippen; Demo-Mahlzeit wird nicht gespeichert; Suche ohne Return.
- [ ] Freigabe: Migration `20261004120000` + `nutrition`-Gateway deployen, danach Experiment per `enable_paywall_experiment.sql` einschalten.
- [ ] Freigabe: neuer Store-Build 1.0.3 (25) und physischer TestFlight-Test (Beschreibung, Foto, Erinnerungen, B-Paywall mit Sandbox-Trial).

## Sofort-Erfassung und Masteraudit, 04.10.2026 (lokal)

- [x] Offline-Sofortvorschläge, „Zuletzt gegessen“, direkt hinzufügen, Selbst eintragen, lokale Beschreibung; Verify grün.
- [ ] Eigentümerentscheidung F02 (Paywall-Testumfang) vor jedem Deploy.
- [ ] Release 1.0.4 „Erfassung“: Migrationen + Gateway (Freigabe), ein Build, Gerätetest.
- [ ] Onboarding mit Zielgewicht/-datum, Verlauf als Fortschritt, Pro-Wochenrückblick (Masteraudit D.2–D.5).

### 04.10.2026 (Abend) – Eigentümerentscheidung: offene Testgruppe, Designdurchgang, Build 27

- **Entscheidung (Eigentümer, ausdrücklich bestätigt):** `paywall_access_v1` ist für alle neuen erwachsenen Installationen offen, auch anonym. Ausgeschlossen bleiben bestehende Konten, Minderjährige, Vorabnutzung, aktive Abos und fehlende Trial-Berechtigung. Migration `20261004160156_reopen_paywall_new_installs` ersetzt die konservative Wiederherstellung `20261004145423`. Nicht erneut auf „nur verknüpfte Konten“ zurückdrehen ohne neue Eigentümeranweisung.
- Experiment aktiv seit 04.10.2026 16:39 UTC (`public_enabled = true`). End-to-End im Simulator geprüft: anonyme Neuinstallation → `eligible` → Variante B → harte Paywall.
- Rechtstexte 2.1 live (getkandro.com) passend zur offenen Regel.
- Design: Onboarding ohne Tippfelder für Wunschziel (Stepper, Datums-Chips), kompakte Messzeilen, Plan mit Makros; Erinnerungsseite; Heute mit „gegessen · übrig · Ziel“ und Makrofarben; Verlauf (Kalorien → Gewicht → Protein); kompakte Suche; Profil-Reihenfolge; Paywall ohne Einwilligungsblock (bleibt unter Du).
- Store-Build 1.0.3 (27) mit automatischem TestFlight-Upload, 0 € Zusatzkosten. Keine App-Review-Einreichung ohne Eigentümerfreigabe.


## Apple sign-in candidate — 5 October 2026

- Existing voluntary account linking gains native Apple access for both guest and email accounts without replacing their user ID. Existing-account replacement remains explicit.
- Added authenticated authorization-code storage, encrypted server-only refresh-token retention and deletion-time revocation; no web OAuth flow or mandatory registration.
- Targeted local checks cover cancellation, account preservation/recovery, token validation/encryption and real local Auth/JWT/PostgREST access restrictions. Native CNG includes the entitlement and preserves build 37 permission strings and widgets.
- Release gates: provision the dedicated Apple key after required creation confirmation, deploy only the tested additive backend package, complete the final candidate gate, authorize one further zero-cost build/upload, and test actual Apple sign-in on an iPhone. App Review still requires the user's exact build-specific approval.
