import { legalProvider } from '@/constants/legal';

export type LegalCopy = {
  title: string;
  intro: string;
  sections: { title: string; paragraphs: string[] }[];
};

/**
 * The legal texts live here rather than in the screens because App Review
 * checks the privacy URL, and the wording on getkandro.com has to stay
 * identical to what the app shows. One source per language, two consumers.
 */
export type LegalCopySet = {
  privacy: LegalCopy;
  terms: LegalCopy;
  sources: LegalCopy;
  version: string;
};

/** Appends the country unless the configured address already names it. */
function withCountry(address: string, country: string) {
  return /deutschland|germany/i.test(address) ? address : `${address}, ${country}`;
}

function provider() {
  if (!legalProvider.name) {
    return 'Verantwortlich für Kandro ist der Anbieter der App.';
  }
  const parts = [legalProvider.name];
  // Name the country: a reader outside Germany cannot tell from a postcode
  // which supervisory authority and which law apply to them.
  if (legalProvider.address) parts.push(withCountry(legalProvider.address, 'Deutschland'));
  return `Verantwortlich für die Verarbeitung ist ${parts.join(', ')}.`;
}

function contact() {
  return legalProvider.email
    ? `Datenschutzanfragen und Support erreichst du unter ${legalProvider.email}.`
    : 'Support und Datenschutzanfragen erreichst du über die im App Store hinterlegte Support-Adresse.';
}

export const legalDe: LegalCopySet = {
  version: '2.6 · Stand 10. Oktober 2026',
  privacy: {
    title: 'Datenschutzhinweise',
    intro: 'Diese Hinweise erklären in klarer Sprache, welche Daten Kandro verarbeitet, warum, und wie du sie jederzeit wieder löschen kannst.',
    sections: [
      {
        title: '1. Verantwortlicher und Kontakt',
        paragraphs: [
          provider(),
          contact(),
        ],
      },
      {
        title: '2. Welche Daten verarbeitet werden',
        paragraphs: [
          'Für die Zugangssteuerung speichert Supabase an deiner Konto-ID einmalig, welcher Zugang für dich gilt oder warum du keiner Testvariante zugeordnet wirst, und den Zeitpunkt. Der frühere begrenzte Zugangstest für neue Installationen von Erwachsenen ohne bisherige Nutzung ist pausiert: Es werden keine neuen Varianten zugeordnet. Für Konten, die nach Einführung des aktuellen Zugangsmodells angelegt werden, speichert Supabase zusätzlich die ID und den Zeitpunkt der einen kostenlosen Mahlzeit, damit danach Kandro Pro gilt; dieser Eintrag wird mit dem Account gelöscht. Bestehende Zuordnungen bleiben bis zur Accountlöschung erhalten und werden bei Anmeldung oder Wiederherstellung nicht neu ausgelost. Einzelne Freigaben für bereits begonnene Mahlzeitenspeicherungen erhalten deren spätere Synchronisierung. Wird dir die Paywall angezeigt, speichert Supabase außerdem an deiner Konto-ID, in welchem Zusammenhang (zum Beispiel nach den kostenlosen Analysen) und wann sie zuerst erschienen ist, sowie jeweils einmal, ob und wann du einen Kauf gestartet, abgebrochen oder abgeschlossen hast (ohne Plan, Preis oder Zahlungsdaten); auch diese Einträge werden mit dem Account gelöscht. Freiwillige Analyseereignisse zur tatsächlich gezeigten Paywall bleiben an deine gesonderte Analytics-Einwilligung gebunden. Es gibt kein Geräte-Fingerprinting.',
          'Auf deinem Gerät verarbeitet Kandro dein Profil, Zielwerte, Gewichtseinträge, bestätigte Mahlzeiten und höchstens drei fehlgeschlagene, komprimierte Fotoscans für einen von dir ausgelösten Wiederholungsversuch.',
          'Optionale tägliche Erinnerungen werden lokal geplant und enthalten keine Ernährungswerte. Für Homescreen-Widgets kannst du unter Du die Freigabe deiner heutigen Kalorien, Proteinwerte und bestätigten Ziele auf diesem Gerät aktivieren. Ohne Freigabe und auf dem Sperrbildschirm bleiben nur Einstiege. Ein geschützter gemeinsamer App-Container enthält dazu einen kleinen zeitlich begrenzten Tagesstand ohne Namen, Mahlzeitentexte, Bilder oder Zugangsdaten. Beim Ausschalten wird dieser Stand geleert; iOS kann ein zuvor gerendertes Widgetbild noch kurz behalten. Lokale Nutzungs- und Anfragezähler begrenzen die optionale native Bewertungsanfrage; Kandro lädt diese Zähler nicht hoch.',
          'Wenn die Cloud aktiv ist, speichert Supabase in der EU eine zufällige Account-ID, dein Profil, deine aktuellen Zielwerte, bestätigte Mahlzeiten, Zutaten, Empfehlungen und Feedback. Gewichtseinträge bleiben auf deinem Gerät; eine E-Mail-Adresse wird nur gespeichert, wenn du deinen Gast-Account bewusst sicherst. Sicherst du ihn mit „Mit Apple anmelden“, übermittelt Apple eine Kennung deiner Apple-ID und eine E-Mail-Adresse, die Apple auf deinen Wunsch anonymisiert weiterleitet; Kandro erhält kein Apple-Passwort. Sprichst du eine Mahlzeit ein, wandelt Apples Spracherkennung sie in Text um – wenn möglich direkt auf dem Gerät, sonst über Apple. Kandro speichert keine Audioaufnahme, sondern nur den Text, den du absendest.',
          'Speicherst du ein Produkt als „Mein Produkt“ (aus einer fotografierten Nährwerttabelle oder selbst eingetragen), speichert Kandro dessen Namen, optional Marke und Barcode, die von dir bestätigten Nährwerte pro 100 g sowie Portions- und Packungsgröße auf deinem Gerät und, wenn die Cloud aktiv ist, in Supabase in der EU. Du kannst jedes Produkt einzeln löschen; alle werden mit deinem Account gelöscht.',
          'Damit USDA, Open Food Facts und RevenueCat nicht automatisiert überlastet werden, speichert Supabase providerspezifische Zähler mit Einweg-Pseudonymen der zufälligen Account-ID und des Ausgangsnetzwerks höchstens zwei Stunden nach ihrer letzten Nutzung. Suchbegriffe und Barcodes werden in diesen Zählern nicht gespeichert.',
          'Kandro ist ab 16 Jahren. Ältere App-Versionen boten 14- und 15-Jährigen an, ein Elternteil oder eine sorgeberechtigte Person per E-Mail-Link zustimmen zu lassen. Solange solche Anfragen noch eingehen, gilt: Die Eltern-E-Mail bleibt nur im Arbeitsspeicher der Versandfunktion und wird nicht in der Kandro-Datenbank gespeichert. Supabase speichert bis zur Bestätigung oder bis zum Ablauf nach 48 Stunden nur die ausstehende Anfrage mit einem Hash des Einmal-Tokens. Zur Abwehr automatisierten Missbrauchs von Eltern-E-Mails verbraucht jede Anfrage außerdem atomische Limits anhand getrennt gesalzener Hashwerte des App-Accounts, des Ausgangsnetzwerks und der Eltern-E-Mail. Die rohe Netzwerkadresse und Eltern-E-Mail werden dafür nicht gespeichert; diese separaten Limitdatensätze werden spätestens nach drei Stunden gelöscht. Bei erfolgreicher Bestätigung wird die Anfrage sofort gelöscht; Bestätigungszeitpunkt und Hinweisversion bleiben im geschützten Profil als Nachweis. Resend verarbeitet die Adresse und technische Zustelldaten für den Mailversand.',
          'Stürzt die App ab oder tritt ein schwerer technischer Fehler auf, sendet Kandro einen Fehlerbericht an Sentry (Functional Software, Inc.; Speicherung in der EU-Region Frankfurt). Er enthält den bereinigten Fehler mit Programmstelle, App-Version, Gerätemodell, Betriebssystem, eine zufällige Installationskennung sowie die letzten Bedienschritte ohne Eingaben. Ohne Fehler zählt Sentry nur Beginn und Ende von App-Sitzungen, um den Anteil absturzfreier Sitzungen zu messen, und kann bei einem kleinen Teil der Sitzungen technische Ladezeiten erfassen. Kandro sendet dabei keine Account-ID, E-Mail-Adresse, IP-Adresse, Fotos, Bildschirminhalte, Texteingaben, Lebensmittel, Kalorien oder Körperdaten. Rechtsgrundlage ist unser berechtigtes Interesse an einer stabilen, fehlerfreien App (Art. 6 Abs. 1 lit. f DSGVO); Fehlerberichte werden nach höchstens 90 Tagen gelöscht.',
          'Wenn du die optionale Nutzungsanalyse bewusst einschaltest, erhält PostHog eine zufällige, auf dem Gerät gespeicherte Distinct- beziehungsweise Geräte-ID, freigegebene Funktionsereignisse, bereinigte Fehler sowie technische Angaben zu App-Version, Betriebssystem und SDK. Fotos, E-Mail-Adressen, Lebensmittel, Kalorien, Makros und Supabase-IDs werden nicht an PostHog gesendet.',
          'Für die Aboverwaltung erhält RevenueCat die zufällige Supabase-Account-ID als Custom App User ID sowie Produkt-, Kauf-, Laufzeit- und Berechtigungsinformationen. Damit kann Kandro einen Kauf demselben Account zuordnen und wiederherstellen; RevenueCat erhält weder Mahlzeiten noch Körper- oder Ernährungsdaten.',
          "Nur mit deiner gesonderten, standardmäßig ausgeschalteten Einwilligung zur Auswertung des inzwischen pausierten Abo-Tests erhält RevenueCat zusätzlich die feste Experimentkennung, deine ursprüngliche A/B-Variante und die Einwilligungsversion. Diese Angaben werden dort mit deiner Konto-ID und Aboinformationen verknüpft. Apple prüft dafür die Installationsherkunft; Kandro gibt nur die Kategorie App Store, Test oder unbekannt an die App weiter, keine Belege, Transaktionsdaten oder Gerätekennungen. Test- und unklare Installationen werden nicht in diese Messung aufgenommen. Die frühere Zustimmung zur PostHog-Nutzungsanalyse gilt hierfür nicht.",
        ],
      },
      {
        title: '3. Fotoanalyse und Empfänger',
        paragraphs: [
          'Ein Foto wird auf dem Gerät verkleinert. Das Original wird danach verworfen. Die Arbeitskopie oder deine bewusst eingegebene Mahlzeitenbeschreibung wird an OpenRouter in den USA und von dort ausschließlich an Microsoft Azure übermittelt; dort läuft das OpenAI-Modell GPT-4.1 mini zur Erkennung von Lebensmitteln und Portionen. USDA FoodData Central wird anschließend nur mit Textsuchbegriffen abgefragt. Bei einem Barcode wird die Nummer über den Kandro-Analysezugang bei Open Food Facts nachgeschlagen.',
          'Bestätigte Mahlzeiten enthalten kein Foto. Die lokale Fehlerwarteschlange wird auf drei Scans begrenzt und nach erfolgreicher Analyse entfernt.',
          'Fotografierst du eine Nährwerttabelle (optional zusätzlich die Vorderseite der Packung), werden diese Fotos wie ein Mahlzeitenfoto auf dem Gerät verkleinert, nur zum Ablesen der Werte an dieselben Empfänger übertragen und danach verworfen; Kandro speichert sie nicht. Gespeichert werden nur die Werte, die du bestätigst. Öffentliche Produktdaten von Open Food Facts hält Kandro bis zu 30 Tage in einem gemeinsamen Zwischenspeicher, der keinen Bezug zu deinem Account hat.',
        ],
      },
      {
        title: '4. Zweck, Rechtsgrundlage und Speicherdauer',
        paragraphs: [
          'Ernährungs- und Zieldaten sind Gesundheitsdaten im Sinne von Art. 9 DSGVO. Rechtsgrundlage ist deine ausdrückliche Einwilligung nach Art. 9 Abs. 2 lit. a DSGVO, die du im Onboarding erteilst und unter „Du → Analyse & Datennutzung“ jederzeit für die Zukunft widerrufen kannst. Nach dem Widerruf sendet Kandro keine Analyse-, Körper- oder Ernährungsdaten mehr an die genannten Empfänger. Die Einwilligung wird mit Zeitstempel und Hinweisversion auf deinem Gerät und bei aktiver Cloud in deinem geschützten Profil gespeichert.',
          'Kandro ist ab 16 Jahren verfügbar; ab 16 kannst du in Deutschland nach Art. 8 DSGVO selbst einwilligen. Hat ein Elternteil über eine ältere App-Version zugestimmt, bestätigte es die offengelegten Empfänger und Zwecke über einen einmal verwendbaren Link, der nach 48 Stunden abläuft. Nach erfolgreicher Bestätigung wird die Anfrage samt Token-Hash sofort gelöscht; abgelaufene Anfragen entfernt ein täglicher Datenbankjob. Eine erteilte Erlaubnis kann über die oben genannte Kontaktadresse widerrufen werden; die künftige Verarbeitung lässt sich zusätzlich jederzeit in der App stoppen.',
          'Lokale Daten bleiben bis zur Löschung der App-Daten oder deines Accounts erhalten. Bestätigte Mahlzeiten werden lokal für den Verlauf gespeichert; die App lädt für den Cloud-Verlauf derzeit höchstens 90 Tage. Cloud-Daten bleiben bis zur Accountlöschung erhalten. Technisch notwendige Sicherungskopien können nach den Fristen des jeweiligen Auftragsverarbeiters auslaufen.',
          'Damit ein erfolgreiches Analyseergebnis nach einer unterbrochenen Antwort mit derselben Anfrage wiederhergestellt werden kann und Gratis- sowie Pro-Kontingente nicht doppelt zählen, speichert Supabase das strukturierte Nährwertergebnis mit einer zufälligen Anfrage-ID und deiner Account-ID. Foto, Base64-Arbeitskopie, Prompt und eingegebener Rohtext werden dafür nicht gespeichert. Ein stündlicher Job löscht das Ergebnis ab 22 Stunden. Danach bleiben Anfrage-ID, Status und Kontingentart höchstens 30 Tage zur Doppelaufruf- und Missbrauchsabwehr; RevenueCat-Webhook-IDs höchstens 90 Tage zur Entdoppelung. Bei Accountlöschung werden diese Kandro-Datensätze sofort mitgelöscht.',
          'Um zu verstehen, ob Kandro neuen Nutzern tatsächlich hilft und wo Analysen scheitern, werten wir auf dem Server Daten aus, die für den Betrieb ohnehin in Supabase liegen – ausschließlich zusammengefasst als Zählwerte je Anmeldetag. Gezählt wird zum Beispiel, wie viele neue Konten ein Profil angelegt, eine KI-Analyse versucht oder erfolgreich abgeschlossen, eine Mahlzeit gespeichert (am ersten Tag, ab dem zweiten oder ab dem achten Tag), die Paywall gesehen oder ein Trial oder Abo begonnen haben, wie viele davon volljährig sind und aus welchen technischen Gründen Analysen fehlschlagen. Für Mahlzeiten zählt nur, ob und wann gespeichert wurde, nicht was. Dafür werden keine zusätzlichen Daten erhoben, keine Nährwerte, Körperdaten oder Fotos ausgewertet, keine Profile einzelner Personen gebildet und nichts an Analysedienste oder andere Dritte weitergegeben; Zugriff hat nur der Anbieter über die geschützte Datenbank. Rechtsgrundlage ist unser berechtigtes Interesse, Kandro zu verbessern und Fehler zu finden (Art. 6 Abs. 1 lit. f DSGVO). Du kannst dieser Auswertung nach Art. 21 DSGVO über die oben genannte Kontaktadresse widersprechen.',
          'Freiwillig übermittelte PostHog-Ereignisse bleiben bis zum Ablauf der im EU-Projekt konfigurierten Aufbewahrung oder bis zu einer berechtigten Löschanfrage gespeichert. Das Ausschalten stoppt künftige Übermittlungen und löscht die zufällige lokale Analysekennung sowie wartende Ereignisse. PostHog erhält nie die Supabase-Account-ID; bereits gesendete Ereignisse können deshalb nicht mit dem gelöschten Kandro-Account zusammengeführt werden. Apple kann Kauf- und Abohistorie so lange aufbewahren, wie dies für Wiederherstellung, Abrechnung, Betrugsabwehr oder gesetzliche Pflichten erforderlich ist. OpenRouter bewahrt keine Prompt- oder Antwortinhalte auf, speichert aber inhaltsfreie Anfrage-Metadaten nach den eigenen Aufbewahrungskriterien.',
          "Die freiwillige Abo-Testauswertung kannst du unter Du oder auf der Paywall ausschalten. Neue Attributübertragungen stoppen sofort; bereits gesetzte eigene RevenueCat-Merkmale werden beim nächsten möglichen Abgleich entfernt. Die Aboverwaltung, Kaufrechte und funktionale Zugangszuordnung bleiben erhalten. Deine Auswahl und ein ausstehender Löschabgleich werden lokal je Konto gespeichert; Accountlöschung entfernt auch den RevenueCat-Kunden. Bereits zusammengefasste Berichte lassen sich dadurch nicht rückwirkend als gelöscht zusichern.",
        ],
      },
      {
        title: '5. Deine Rechte',
        paragraphs: [
          'Du kannst Auskunft, Berichtigung, Löschung, Einschränkung und, soweit anwendbar, Datenübertragbarkeit verlangen sowie Einwilligungen für die Zukunft widerrufen. Die pseudonyme Nutzungsanalyse lässt sich unter „Du“ jederzeit ausschalten.',
          'Unter „Du → Account und Daten löschen“ kannst du den Supabase-Account, die zugehörigen Kandro-Cloud-Daten, den verknüpften RevenueCat-Kunden sowie den lokalen Verlauf und lokale Kennungen löschen. Kandro lässt RevenueCat diese Löschung abschließen oder dauerhaft einreihen, bevor die verbindende Account-ID vernichtet wird. Ein Apple-Abo und die Apple-Kaufhistorie bleiben davon getrennt; das Abo muss zusätzlich in den Apple-Abonnementeinstellungen gekündigt werden. Bereits an PostHog übertragene Ereignisse bleiben bis zum Ablauf der konfigurierten Aufbewahrung oder einer berechtigten Löschanfrage pseudonym und unverknüpft mit dem Supabase-Account. Für weitergehende Löschrechte kannst du dich an die oben genannte Kontaktadresse wenden.',
          'Dir steht ein Beschwerderecht bei einer Aufsichtsbehörde zu, für Nordrhein-Westfalen bei der Landesbeauftragten für Datenschutz und Informationsfreiheit NRW.',
        ],
      },
      {
        title: '6. Auftragsverarbeiter und Übermittlung',
        paragraphs: [
          'Wir setzen Supabase (Datenbank und Konto, EU-Region), OpenRouter in den USA und Microsoft Azure mit dem OpenAI-Modell GPT-4.1 mini (Bild- und Textanalyse), USDA FoodData Central und Open Food Facts (Nährwertabgleich), RevenueCat (Aboverwaltung mit verknüpfter Account-ID und Kaufstatus), Resend (Eltern- und Wartelisten-E-Mails), Sentry (Absturzberichte ohne Account-ID oder Inhalte, EU-Region) sowie optional PostHog (pseudonyme Nutzungsanalyse, EU) ein. Für Nutzer unter 18 bleibt die optionale Nutzungsanalyse ausgeschaltet.',
          'Der KI-Datenweg ist auf OpenRouter und ZDR-fähige Microsoft-Azure-Endpunkte ohne Fallback begrenzt. Analyseanfragen sind mit „store: false“, untersagter Datensammlung und Zero Data Retention konfiguriert: Prompt-, Foto- und Antwortinhalte werden nicht zum Training verwendet und von OpenRouter oder dem ausgewählten Inferenz-Endpunkt nicht aufbewahrt. OpenRouter speichert getrennt davon inhaltsfreie Anfrage-Metadaten wie Zeitpunkt, verwendetes Modell, Tokenanzahl und Latenz für Abrechnung, Berichte und Modell-Ranking. Nach eigener Dokumentation kann OpenRouter eine kleine Zahl von Prompts vorübergehend durch ein ZDR-Modell anonym kategorisieren; gespeichert wird nur die nicht mit Account oder Nutzer-ID verknüpfte Kategorie, nicht der Prompt. Fotos werden ausschließlich für die Dauer der Analyse verarbeitet. OpenRouter und USDA FoodData Central verarbeiten Daten in den USA; USDA erhält nur normalisierte Lebensmittelbegriffe, keine Fotos, Account-ID oder Körperdaten.',
          // Verified 2026-10-10: OpenRouter's privacy policy (Section 9) relies on SCCs
          // (Art. 46 GDPR); no DPF certification. Sign OpenRouter's DPA (privacy@openrouter.ai).
          'Übermittlung in Drittländer: Analyseanfragen gehen an OpenRouter in den USA und von dort an Microsoft Azure; die Verarbeitung kann außerhalb der EU erfolgen. Auch Supabase, RevenueCat, Resend, Sentry und PostHog haben ihren Sitz in den USA; ein Zugriff von dort ist trotz Speicherung in der EU nicht ausgeschlossen. Wir stützen diese Übermittlungen auf den Angemessenheitsbeschluss der EU-Kommission zum EU-U.S. Data Privacy Framework (Art. 45 DSGVO), soweit der Empfänger danach zertifiziert ist, und andernfalls auf die EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO), die Teil des jeweiligen Auftragsverarbeitungsvertrags sind. OpenRouter ist nicht nach dem Data Privacy Framework zertifiziert; für OpenRouter gelten die EU-Standardvertragsklauseln. Eine Kopie dieser Garantien erhältst du über die oben genannte Kontaktadresse.',
          'RevenueCat verarbeitet die Supabase-Account-ID zusammen mit Produkt-, Kauf-, Abo- und Berechtigungsstatus. PostHog verarbeitet bei freiwilliger Aktivierung die pseudonyme Distinct-ID, freigegebene Produktinteraktionen, bereinigte Fehler und technische App-, Betriebssystem- und SDK-Angaben. Resend verarbeitet E-Mail-Adresse und technische Zustelldaten für die jeweilige Nachricht. Die Speicherfristen richten sich nach den oben beschriebenen Zwecken und den Aufbewahrungs- beziehungsweise Löschregeln des jeweiligen Auftragsverarbeiters; Details und Löschanfragen kannst du über die Kontaktadresse erhalten.',
        ],
      },
      {
        title: '7. Warteliste auf getkandro.com',
        paragraphs: [
          'Wer sich auf der Website für die Benachrichtigung zum Start einträgt, gibt eine E-Mail-Adresse an. Wir speichern sie zusammen mit der gewählten Sprache, einer optionalen Kampagnenquelle aus dem „ref“-Parameter sowie den Zeitpunkten von Anmeldung und Bestätigung. Die Website speichert deine Sprachwahl zusätzlich lokal im Browser. Rechtsgrundlage für die Warteliste ist deine Einwilligung, Art. 6 Abs. 1 lit. a DSGVO.',
          'Die Anmeldung läuft im Double-Opt-in: Nach dem Absenden erhältst du eine Bestätigungsmail, und erst der Klick darin trägt dich ein. Ohne diesen Klick verwenden wir die Adresse nicht. Für Bestätigung und Abmeldung speichern wir getrennte zufällige Token. Zur Abwehr automatisierter Massenanmeldungen speichern wir außerdem einen gesalzenen Hashwert der IP-Adresse, nicht die IP-Adresse selbst. Jeder Anmeldeversuch verbraucht zusätzlich ein atomisches Limit anhand getrennt gesalzener Hashwerte der IP- und E-Mail-Adresse. Diese separaten Limitdatensätze werden spätestens nach drei Stunden gelöscht.',
          'Die Adresse wird ausschließlich für die Benachrichtigung zum Start und für damit unmittelbar zusammenhängende Nachrichten verwendet, nicht für laufenden Newsletter-Versand. Jede Mail enthält einen Abmeldelink; nach dessen Bestätigung wird der gesamte Wartelisteneintrag sofort gelöscht. Unbestätigte Einträge werden nach 30 Tagen gelöscht. Bestätigte Einträge werden spätestens sechs Monate nach dem tatsächlich veröffentlichten und im System hinterlegten App-Start gelöscht. Ein täglicher Datenbankjob setzt diese Fristen um.',
          'Für den Versand setzen wir Resend ein; Resend verarbeitet die Adresse und technische Zustelldaten nach den eigenen Aufbewahrungskriterien. Die Wartelisteneinträge werden bis zu ihrer vorstehend beschriebenen Löschung bei Supabase in der EU gespeichert.',
          'Der Discord-Server ist ein Angebot von Discord. Wer beitritt, tut dies gegenüber Discord; wir erhalten dabei keine Daten von dir und haben auf die Verarbeitung durch Discord keinen Einfluss.',
        ],
      },
    ],
  },
  terms: {
    title: 'Nutzungsbedingungen',
    intro: 'Diese Bedingungen beschreiben, was Kandro leistet und was nicht. Die App bleibt bewusst bei allgemeiner Wellness-Unterstützung und transparenten Schätzungen.',
    sections: [
      {
        title: '1. Leistungsumfang',
        paragraphs: [
          'Kandro ist ein allgemeines Wellness- und Planungstool für Nutzer ab 16 Jahren. Die App strukturiert fotografierte oder beschriebene Lebensmittel beziehungsweise verpackte Produkte per Barcode, schätzt Nährwerte, berechnet einen Tagesrahmen und schlägt passende nächste Mahlzeiten aus einem kuratierten Katalog mit typischen Richtwerten vor.',
          'Alle Angaben sind Schätzungen. Du kannst erkannte Zutaten und Portionsgrößen vor dem Speichern korrigieren.',
          "Erwachsene können freiwillig ein Wunschgewicht und Wunschdatum im Profil speichern. Diese Angaben ändern die Kalorienberechnung nicht und sind keine Vorhersage. Der Wochenrückblick berechnet Vergleiche aus gespeicherten Mahlzeitenschätzungen; unvollständige oder fehlende Einträge begrenzen die Aussagekraft.",
        ],
      },
      {
        title: '2. Kein medizinischer Dienst',
        paragraphs: [
          'Kandro stellt keine Diagnose, behandelt keine Erkrankung und ersetzt keine medizinische oder ernährungstherapeutische Beratung. Triff keine medizinischen Entscheidungen allein auf Grundlage der App.',
          'Für 16- und 17-Jährige verwendet Kandro eine Jugend-Energiebilanz, die normales Wachstum berücksichtigt, und gibt weder Kaloriendefizit noch -überschuss vor. Ziele beeinflussen Mahlzeitenideen, nicht ein Gewichtsänderungstempo. Bei Sorgen um Gewicht oder Wachstum beziehe ein Elternteil ein und hole qualifizierten Rat ein.',
          'Bei Beschwerden, Schwangerschaft, Essstörungen, Stoffwechselerkrankungen oder einem medizinisch angeordneten Ernährungsplan hole bitte qualifizierten Rat ein, bevor du Ziele veränderst.',
        ],
      },
      {
        title: '3. Zulässige Nutzung',
        paragraphs: [
          'Du bist für die Prüfung deiner Eingaben und Schätzwerte verantwortlich. Nutze Kandro nicht für Notfälle, Medikamentendosierungen oder klinische Entscheidungen.',
          'Automatisierte Angriffe, die Umgehung technischer Schutzmaßnahmen und die Nutzung fremder Accounts sind nicht gestattet.',
        ],
      },
      {
        title: '4. Abonnements',
        paragraphs: [
          'Neue Konten (Einrichtung nach Einführung dieses Zugangsmodells) erhalten eine kostenlose Probe-Analyse per Foto, Sprache oder Text und können ihre erste Mahlzeit speichern. Danach brauchst du für weitere Mahlzeiten, Analysen, Plan und Tagesansicht Kandro Pro; ein von Apple bestätigter siebentägiger Trial zählt als Kandro Pro. Wer den ersten Scan überspringt, sieht direkt das Kandro-Pro-Angebot.',
          'Für Konten, die vorher angelegt wurden, ändert sich nichts: Kostenlos sind Lebensmittelsuche, Barcode, Tagesbilanz, Mahlzeitenvorschläge und Verlauf sowie drei erfolgreiche KI-Analysen per Foto, Sprache oder Text. Kandro Pro schaltet weitere Foto-, Sprach- und Textanalysen im Rahmen einer Fair-Use-Grenze (derzeit bis zu 60 pro Tag) und den Wochenrückblick frei. Ein früherer Test mit zwei Zugangsvarianten ist pausiert; seine Teilnehmer behalten den Zugang bestehender Konten. Bereits gespeicherte Daten, Datenschutz-Einstellungen, Kontolöschung sowie Konto- und Rechtsfunktionen bleiben immer zugänglich.',
          'Kandro Pro gibt es als Monats- und als Jahresabo. Beide können einen von Apple bestätigten siebentägigen Einführungs-Trial enthalten. Ob du den Trial erhalten kannst, entscheidet deine tatsächliche Apple-Berechtigung; der angezeigte Folgepreis und die Verlängerungsbedingungen gelten.',
          'Preise, Laufzeit, Testzeitraum und Verlängerung werden vor dem Kauf angezeigt. Abonnements verlängern sich automatisch um die gewählte Laufzeit, bis du sie kündigst. Die Abbuchung erfolgt über deine Apple-ID; kündigen kannst du jederzeit bis 24 Stunden vor Ablauf in den Einstellungen deiner Apple-ID.',
          'Käufe Minderjähriger brauchen die für ihre Apple-ID geltende Freigabe, etwa „Kaufanfrage“ oder die Zustimmung des Familienorganisators. Kandro umgeht Apples Kaufkontrollen nicht.',
          'Die Löschung des Kandro-Accounts beendet ein Apple-Abonnement nicht automatisch. Käufe können über die Paywall wiederhergestellt werden.',
          "Maßgeblich sind Angebot, Berechtigung und tatsächlicher Gesamtpreis im Kaufdialog; ein Monatsvergleich ändert die jährliche Abbuchung nicht. Apple gewährt je Abogruppe nur einen Einführungs-Trial, auch beim Wechsel zwischen Monats- und Jahresprodukt.",
        ],
      },
      {
        title: '5. Verfügbarkeit und Änderungen',
        paragraphs: [
          'Analyseanbieter und Nährwertdatenbanken können zeitweise nicht erreichbar sein. Kandro hält bei Netzfehlern höchstens drei komprimierte Scans lokal für einen manuellen Wiederholungsversuch bereit.',
          'Wesentliche Änderungen an Leistung, Datenschutz oder Preisen werden vor Inkrafttreten transparent angezeigt.',
        ],
      },
      {
        title: '6. Anbieter und anwendbares Recht',
        paragraphs: [
          `${provider()} ${contact()}`,
          'Es gilt deutsches Recht unter Wahrung der zwingenden Verbraucherschutzvorschriften deines Wohnsitzlandes. Für Abonnements, die über den App Store abgeschlossen werden, gelten zusätzlich die Bedingungen von Apple.',
        ],
      },
    ],
  },
  sources: {
    title: 'Datenquellen',
    intro: 'Erfasste Zutaten zeigen ihre Nährwertquelle. Kandro trennt Datenbankwerte, KI-gestützte Zuordnung und eigene typische Planungsrichtwerte sichtbar voneinander.',
    sections: [
      {
        title: 'Deutsche Gerichte · Bundeslebensmittelschlüssel',
        paragraphs: [
          'Für typische deutsche Gerichte verwendet Kandro geprüfte Referenzwerte aus dem Bundeslebensmittelschlüssel. Diese Werte werden nicht von der KI erzeugt, sondern sind Datenbank- und Durchschnittswerte. Die Zuordnung zum erkannten Gericht, die angenommene Zubereitung und die Skalierung auf die geschätzte Portion bleiben Schätzungen.',
          'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0',
          'Lizenz: Creative Commons Namensnennung 4.0 International (CC BY 4.0). Die Daten wurden für die Verwendung in Kandro ausgewählt und auf Portionsgrößen umgerechnet; das Max Rubner-Institut hat Kandro weder geprüft noch unterstützt.',
        ],
      },
      {
        title: 'Einzelne Zutaten · USDA FoodData Central',
        paragraphs: [
          'Zutaten außerhalb der deutschen Gerichtereferenz werden gegen USDA FoodData Central des U.S. Department of Agriculture abgeglichen. Diese Daten stehen gemeinfrei zur Verfügung.',
          'Die Zuordnung eines deutschen Lebensmittelnamens zu einem USDA-Eintrag ist eine Schätzung. Deshalb ist bei jeder Zutat sichtbar, woher der Wert kommt, und unsichere Treffer werden als zu prüfen markiert.',
        ],
      },
      {
        title: 'Verpackte Produkte · Open Food Facts',
        paragraphs: [
          'Barcodes werden bei Open Food Facts nachgeschlagen. Die Produktdatenbank steht unter der Open Database License (ODbL) und wird von Freiwilligen gepflegt.',
          'Nährwerte verpackter Produkte stammen damit von den Herstellerangaben und können unvollständig oder veraltet sein. Prüfe den Wert im Zweifel auf der Verpackung.',
        ],
      },
      {
        title: 'Kandro-Empfehlungskatalog',
        paragraphs: [
          'Die drei nächsten Mahlzeiten stammen aus einem von Kandro kuratierten Katalog. Kalorien und Makros darin sind typische, plausible Planungsrichtwerte für die beschriebene Standardportion und keine Messwerte einer einzelnen Zubereitung. In der App sind sie als „Kandro-Katalog · typischer Richtwert“ gekennzeichnet.',
          'Der Katalog wird deterministisch nach deinem verbleibenden Tagesrahmen, Kontext und deinen Präferenzen sortiert. Die KI erfindet keine Empfehlungskarten.',
        ],
      },
      {
        title: 'So entsteht eine Foto-Schätzung',
        paragraphs: [
          'GPT-4.1 mini erkennt Lebensmittel und schätzt sichtbare Grammangaben. Kandro übernimmt Nährwerte nicht vom Modell, sondern ordnet die erkannten Begriffe Referenzen aus BLS oder USDA zu. Unsichere Zuordnungen, versteckte Kalorien und breite Portionsspannen werden markiert.',
          'Vor dem Speichern zeigt Kandro jede Zutat, Grammangabe und Quelle zur Bestätigung. Du kannst Mengen verändern oder Zutaten abwählen. Diese Prüfung ist Teil jeder Foto- und Textanalyse.',
        ],
      },
      {
        title: 'Bildmaterial',
        paragraphs: [
          'Das Beispielfoto einer Mahlzeit stammt von Markus Winkler und wird unter der Unsplash-Lizenz verwendet. Es erscheint nur, solange du noch kein eigenes Foto aufgenommen hast.',
        ],
      },
      {
        title: 'Was das für deine Zahlen bedeutet',
        paragraphs: [
          'Alle Angaben in Kandro sind Schätzungen. Auch geprüfte Referenzwerte gelten für eine Standardzubereitung – Öl, Sauce und Portionsgröße schwanken in der Praxis erheblich. Deshalb kannst du jede Zutat und jede Portion vor dem Speichern korrigieren.',
        ],
      },
    ],
  },
};
