# Auftragsverarbeitungsvertrag (AVV) / Data Processing Agreement (DPA) - Template

> **DISCLAIMER (Deutsch)**
>
> Dieses Dokument ist **kein Rechtsrat** und ersetzt keine juristische Beratung. Es ist ein Arbeitsentwurf, der als Diskussionsgrundlage für individuelle Vertragsverhandlungen dient. Alle Platzhalter in eckigen Klammern `[...]` sind durch konkrete Angaben zu ersetzen. Die Eignung für einen konkreten Einsatzfall, die Vollständigkeit und die Vereinbarkeit mit dem jeweils anwendbaren Recht sind vor Abschluss durch einen Datenschutzbeauftragten (DSB), eine Rechtsabteilung oder einen Rechtsanwalt zu prüfen. Die Maintainer des Open-Source-Projekts AInonymous übernehmen keine Gewähr für die rechtliche Tragfähigkeit dieses Templates.
>
> **DISCLAIMER (English)**
>
> This document is **not legal advice** and does not replace professional counsel. It is a working draft intended as a starting point for individual contract negotiations. All placeholders in square brackets `[...]` must be replaced with specific values. Suitability for a concrete use case, completeness, and compatibility with the applicable law must be reviewed by a Data Protection Officer (DPO), a legal department, or an attorney before signing. The maintainers of the open-source project AInonymous make no warranty as to the legal sufficiency of this template.

---

## Kontext-Klarstellung zur Rolle von AInonymous

AInonymous ist ein unter der MIT-Lizenz veröffentlichtes Open-Source-Werkzeug. Es wird lokal beim Betreiber (Verantwortlicher oder Auftragsverarbeiter) installiert und verarbeitet Daten ausschließlich auf dessen Infrastruktur. Die Maintainer des Projekts haben zu keinem Zeitpunkt Zugriff auf Daten, die mit dem Werkzeug verarbeitet werden, und sind **weder Auftragsverarbeiter im Sinne des Art. 28 DSGVO noch Unter-Auftragsverarbeiter**.

Dieses Template deckt zwei Konstellationen ab, in denen ein DPA erforderlich wird:

- **Szenario A (häufig)**: Ein Unternehmen nutzt AInonymous auf eigenen Systemen und verbindet den Proxy direkt mit einem externen LLM-Anbieter (z. B. Anthropic, OpenAI). Der LLM-Anbieter ist in diesem Fall der Auftragsverarbeiter. Das DPA wird **mit dem LLM-Anbieter** geschlossen; dieses Template ist dafür nicht geeignet.

- **Szenario B (seltener)**: Ein Dienstleister betreibt eine auf AInonymous basierende Anonymisierungslösung als Managed Service für einen Kunden. Der Dienstleister verarbeitet dabei personenbezogene Daten des Kunden. Für dieses Szenario ist das vorliegende Template gedacht.

Wird AInonymous rein lokal ohne Dritten betrieben, liegt keine Auftragsverarbeitung im Sinne von Art. 28 DSGVO vor und ein DPA ist für die Nutzung des Werkzeugs selbst nicht erforderlich.

---

## Vertragsparteien

**Verantwortlicher** (Controller / im Folgenden "Auftraggeber"):

- Firma: `[Auftraggeber GmbH]`
- Anschrift: `[Straße, PLZ, Ort, Land]`
- Vertreten durch: `[Name, Funktion]`
- Umsatzsteuer-Identifikationsnummer: `[DE123456789]`
- Datenschutzbeauftragter: `[Name, E-Mail]`

**Auftragsverarbeiter** (Processor / im Folgenden "Auftragnehmer"):

- Firma: `[Dienstleister GmbH]`
- Anschrift: `[Straße, PLZ, Ort, Land]`
- Vertreten durch: `[Name, Funktion]`
- Umsatzsteuer-Identifikationsnummer: `[DE987654321]`
- Datenschutzbeauftragter: `[Name, E-Mail]`

Die Parteien schließen den folgenden Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.

---

## 1. Gegenstand und Dauer der Verarbeitung

### 1.1 Gegenstand

Der Auftragnehmer betreibt für den Auftraggeber einen auf dem Open-Source-Projekt AInonymous basierenden Anonymisierungsdienst, der ausgehende Anfragen an Large-Language-Model-APIs (LLM-APIs) vor Weiterleitung pseudonymisiert und eingehende Antworten entsprechend rehydriert. Die technischen Details der Verarbeitung sind in Ziffer 2 sowie in Anhang 1 beschrieben.

### 1.2 Dauer

Der Vertrag beginnt am `[Datum]` und läuft auf unbestimmte Zeit, längstens jedoch bis zur Beendigung des zugrundeliegenden Hauptvertrags (`[Bezeichnung des Hauptvertrags, Datum]`). Die Kündigungsregelungen in Ziffer 11 bleiben unberührt.

---

## 2. Art und Zweck der Verarbeitung

### 2.1 Art der Verarbeitung

Die Verarbeitung umfasst insbesondere:

- Entgegennahme von Klartext-Anfragen des Auftraggebers über einen lokalen HTTP-Endpunkt
- Erkennung und Ersetzung personenbezogener sowie unternehmensinterner Bezeichner durch Pseudonyme (Layer "Identity")
- Permanente Unkenntlichmachung von Secrets wie API-Schlüsseln, Passwörtern und Tokens (Layer "Secrets")
- Umbenennung domänenspezifischer Bezeichner in Quellcode mittels Tree-sitter-AST-Analyse (Layer "Code-Semantik")
- Weiterleitung der anonymisierten Nutzlast an einen vom Auftraggeber konfigurierten LLM-Anbieter
- Rehydrierung der Antwort anhand einer in-memory geführten Session Map
- Protokollierung der Verarbeitung in einem hash-verketteten Audit-Log

### 2.2 Zweck

Zweck der Verarbeitung ist die Reduktion des Risikos einer unbeabsichtigten Offenlegung personenbezogener Daten und Betriebsgeheimnisse des Auftraggebers gegenüber externen LLM-Anbietern im Rahmen der produktiven Nutzung von KI-gestützten Entwicklungs- und Textverarbeitungswerkzeugen.

### 2.3 Ausdrückliche Nicht-Zwecke

Der Auftragnehmer verarbeitet die übermittelten Daten ausschließlich zu den in 2.2 genannten Zwecken. Eine Verarbeitung zu Trainings-, Profiling-, Analyse- oder Marketingzwecken findet nicht statt. Eine Weitergabe an Dritte erfolgt nur im Rahmen der in Anhang 2 aufgeführten Unter-Auftragsverarbeiter.

---

## 3. Art der personenbezogenen Daten und Kategorien Betroffener

### 3.1 Datenkategorien

Gegenstand der Verarbeitung sind die folgenden Kategorien personenbezogener Daten, soweit sie in den vom Auftraggeber übermittelten Inhalten enthalten sind:

- Identifikationsdaten (Namen, Benutzernamen, E-Mail-Adressen)
- Kontaktdaten (Telefonnummern, Postanschriften)
- Technische Kennungen (IP-Adressen, MAC-Adressen, UUIDs, Session-IDs)
- Inhalte aus Quellcode (Klassen-, Methoden- und Variablenbezeichner, Kommentare, Pfadangaben)
- Interne Unternehmensbezeichnungen (Projektnamen, interne Domains, Produktcodes)
- Regulatorische Identifikatoren je nach aktivierter Compliance-Voreinstellung (z. B. Sozialversicherungsnummer, Personalausweisnummer, NHS-Number)
- Ggf. Geschäftsgeheimnisse und vertrauliche technische Informationen

### 3.2 Kategorien Betroffener

Die Verarbeitung kann folgende Personengruppen betreffen:

- Beschäftigte des Auftraggebers
- Kunden des Auftraggebers
- Lieferanten und Geschäftspartner des Auftraggebers
- Weitere in Quellcode, Konfigurationsdateien oder Texten namentlich genannte natürliche Personen

### 3.3 Besondere Kategorien

Eine gezielte Verarbeitung besonderer Kategorien personenbezogener Daten nach Art. 9 DSGVO (u. a. Gesundheits-, Religions- oder biometrische Daten) ist **nicht vorgesehen**. Der Auftraggeber trägt die Verantwortung dafür, solche Daten nicht in den Eingabestrom einzuspeisen. Wird dies nicht ausgeschlossen, ist eine gesonderte Vereinbarung nach Art. 9 Abs. 2 DSGVO erforderlich.

---

## 4. Pflichten des Auftragnehmers (Art. 28 Abs. 3 DSGVO)

Der Auftragnehmer verpflichtet sich, die Verarbeitung ausschließlich nach den Weisungen und für die Zwecke des Auftraggebers durchzuführen. Im Einzelnen:

### 4.1 Weisungsgebundenheit

Die Verarbeitung erfolgt ausschließlich auf dokumentierte Weisung des Auftraggebers. Dieser Vertrag und seine Anhänge gelten als Grunddokumentation der Weisungen. Ist der Auftragnehmer der Auffassung, dass eine Weisung gegen Datenschutzrecht verstößt, hat er dies dem Auftraggeber unverzüglich mitzuteilen.

### 4.2 Vertraulichkeit

Der Auftragnehmer stellt sicher, dass sämtliche mit der Verarbeitung befassten Personen zur Vertraulichkeit verpflichtet sind oder einer entsprechenden gesetzlichen Verschwiegenheitspflicht unterliegen (Art. 28 Abs. 3 lit. b DSGVO). Die Verpflichtung besteht auch nach Beendigung der Tätigkeit fort.

### 4.3 Technische und organisatorische Maßnahmen

Der Auftragnehmer trifft und hält die in Anhang 1 beschriebenen technischen und organisatorischen Maßnahmen (TOMs) zur Sicherstellung eines dem Risiko angemessenen Schutzniveaus nach Art. 32 DSGVO vor. Änderungen an den TOMs, die zu einer Absenkung des Schutzniveaus führen, bedürfen der vorherigen Zustimmung des Auftraggebers.

### 4.4 Unterstützung bei Betroffenenrechten

Der Auftragnehmer unterstützt den Auftraggeber durch geeignete technische und organisatorische Maßnahmen bei der Erfüllung der Rechte Betroffener (Art. 12 bis 22 DSGVO). Näheres regelt Anhang 3.

### 4.5 Unterstützung bei weiteren Controller-Pflichten

Der Auftragnehmer unterstützt den Auftraggeber bei der Einhaltung der Pflichten aus Art. 32 bis 36 DSGVO (Sicherheit, Meldung von Datenschutzverletzungen, Datenschutz-Folgenabschätzung, vorherige Konsultation), soweit dies unter Berücksichtigung der Art der Verarbeitung und der ihm zur Verfügung stehenden Informationen notwendig und zumutbar ist.

### 4.6 Unter-Auftragsverarbeiter

Der Einsatz weiterer Auftragsverarbeiter richtet sich nach Ziffer 6 und Anhang 2.

### 4.7 Meldung von Datenschutzverletzungen

Der Auftragnehmer meldet dem Auftraggeber jede Verletzung des Schutzes personenbezogener Daten unverzüglich, spätestens jedoch innerhalb von 24 Stunden nach Kenntniserlangung. Die Meldung erfolgt nach dem in Anhang 4 beschriebenen Verfahren.

### 4.8 Löschung oder Rückgabe

Nach Beendigung der Verarbeitung löscht der Auftragnehmer sämtliche personenbezogenen Daten, soweit nicht nach Unionsrecht oder dem Recht der Mitgliedstaaten eine Aufbewahrungspflicht besteht. Auf Wunsch des Auftraggebers gibt er die Daten stattdessen in einem gängigen Format zurück. Die Löschung ist dem Auftraggeber schriftlich zu bestätigen. Die Session Map von AInonymous wird prozessweise im Arbeitsspeicher geführt und ist mit dem Ende des Prozesses automatisch gelöscht; Audit-Log-Dateien sind gesondert nach Ziffer 7 bzw. dem Löschkonzept des Auftragnehmers zu behandeln.

### 4.9 Nachweispflicht

Der Auftragnehmer stellt dem Auftraggeber alle zum Nachweis der Einhaltung der Pflichten aus Art. 28 DSGVO erforderlichen Informationen zur Verfügung und ermöglicht Überprüfungen nach Ziffer 9.

---

## 5. Weisungsrecht des Auftraggebers

### 5.1 Umfang der Weisungen

Weisungen werden grundsätzlich in Textform oder elektronisch erteilt. Mündliche Weisungen sind unverzüglich schriftlich zu bestätigen.

### 5.2 Weisungsberechtigte Personen

Weisungsberechtigt auf Seiten des Auftraggebers sind:

- `[Name, Funktion, E-Mail]`
- `[Name, Funktion, E-Mail]`

Weisungsempfänger auf Seiten des Auftragnehmers sind:

- `[Name, Funktion, E-Mail]`
- `[Name, Funktion, E-Mail]`

Änderungen sind der jeweils anderen Partei unverzüglich mitzuteilen.

---

## 6. Unter-Auftragsverarbeiter

### 6.1 Allgemeine Genehmigung

Der Auftraggeber genehmigt den Einsatz der in Anhang 2 aufgeführten Unter-Auftragsverarbeiter. Der Auftragnehmer verpflichtet diese vertraglich zu Pflichten, die den in diesem Vertrag vereinbarten Pflichten gleichwertig sind.

### 6.2 Informationspflicht bei Änderungen

Beabsichtigte Änderungen hinsichtlich der Hinzuziehung oder der Ersetzung von Unter-Auftragsverarbeitern teilt der Auftragnehmer dem Auftraggeber mindestens 30 Tage vor Wirksamwerden in Textform mit. Der Auftraggeber kann der Änderung innerhalb von 14 Tagen widersprechen; im Falle eines Widerspruchs sind Alternativen zu verhandeln. Bleibt eine Einigung aus, steht dem Auftraggeber ein außerordentliches Kündigungsrecht hinsichtlich der betroffenen Leistung zu.

### 6.3 Liste

Die aktuelle Liste der Unter-Auftragsverarbeiter wird in Anhang 2 geführt und vom Auftragnehmer fortlaufend aktualisiert.

---

## 7. Technische und organisatorische Maßnahmen

Die technischen und organisatorischen Maßnahmen sind in Anhang 1 dokumentiert. Der Auftragnehmer überprüft die Wirksamkeit der Maßnahmen mindestens einmal jährlich und passt sie bei Bedarf an den Stand der Technik an.

---

## 8. Datenschutzverletzungen

### 8.1 Meldepflicht

Im Falle einer Verletzung des Schutzes personenbezogener Daten meldet der Auftragnehmer den Vorfall unverzüglich, spätestens jedoch innerhalb von 24 Stunden nach Kenntniserlangung an den Auftraggeber. Das Meldeverfahren und die inhaltlichen Mindestangaben sind in Anhang 4 geregelt.

### 8.2 Dokumentation

Der Auftragnehmer dokumentiert alle Datenschutzverletzungen einschließlich ihrer Ursachen, Auswirkungen und der ergriffenen Abhilfemaßnahmen nach Art. 33 Abs. 5 DSGVO und stellt die Dokumentation dem Auftraggeber auf Anforderung zur Verfügung.

### 8.3 Zusammenarbeit

Die Parteien arbeiten bei der Aufklärung und Bewältigung von Datenschutzverletzungen nach Treu und Glauben zusammen. Eigene Meldungen des Auftragnehmers an Aufsichtsbehörden oder Betroffene erfolgen nur nach vorheriger Abstimmung mit dem Auftraggeber, es sei denn, eine gesetzliche Pflicht des Auftragnehmers steht dem entgegen.

---

## 9. Kontroll- und Prüfungsrechte

### 9.1 Nachweise

Der Auftragnehmer weist die Einhaltung der in diesem Vertrag festgelegten Pflichten durch geeignete Mittel nach. Hierzu zählen insbesondere:

- aktuelle Zertifikate anerkannter Standards (z. B. ISO/IEC 27001, SOC 2 Typ II, BSI C5)
- Berichte unabhängiger Wirtschafts- oder IT-Prüfer
- interne Prüfberichte und Ergebnisse von Datenschutz-Folgenabschätzungen

### 9.2 Prüfungen vor Ort

Reichen die unter 9.1 genannten Nachweise nicht aus, kann der Auftraggeber nach angemessener Vorankündigung (mindestens 14 Tage) und zu üblichen Geschäftszeiten Prüfungen in den Räumlichkeiten des Auftragnehmers durchführen oder durch einen zur Verschwiegenheit verpflichteten Prüfer durchführen lassen. Ein mit dem Auftragnehmer in Wettbewerb stehender Prüfer ist unzulässig.

### 9.3 Kosten

Die Kosten üblicher jährlicher Prüfungen trägt jede Partei selbst. Kosten außerordentlicher Prüfungen, die aufgrund begründeten Verdachts einer Pflichtverletzung stattfinden und bei denen sich der Verdacht bestätigt, trägt der Auftragnehmer.

---

## 10. Haftung

Die Haftung der Parteien richtet sich nach den gesetzlichen Vorschriften, insbesondere Art. 82 DSGVO. Darüber hinausgehende Haftungsbeschränkungen sind im Hauptvertrag geregelt und gelten sinngemäß, soweit sie mit zwingendem Datenschutzrecht vereinbar sind. Der Auftragnehmer unterhält eine angemessene Betriebshaftpflicht- und Cyber-Versicherung mit folgenden Mindestdeckungssummen:

- Vermögensschäden: `[Betrag]`
- Personen- und Sachschäden: `[Betrag]`
- Cyber-Risiken inklusive Datenschutzverletzungen: `[Betrag]`

Ein aktueller Versicherungsnachweis ist auf Verlangen vorzulegen.

---

## 11. Laufzeit und Kündigung

### 11.1 Laufzeit

Der Vertrag läuft parallel zum Hauptvertrag. Er endet automatisch mit der Beendigung des Hauptvertrags.

### 11.2 Außerordentliche Kündigung

Beide Parteien können den Vertrag aus wichtigem Grund außerordentlich kündigen. Als wichtiger Grund gilt insbesondere:

- eine wesentliche Verletzung dieses Vertrags oder datenschutzrechtlicher Pflichten, die nach schriftlicher Abmahnung nicht innerhalb einer angemessenen Frist abgestellt wird
- eine behördliche Anordnung, die die vertragsgemäße Verarbeitung unmöglich macht
- ein fehlgeschlagener Einigungsversuch im Sinne von Ziffer 6.2

### 11.3 Rechtsfolgen

Mit Beendigung des Vertrags gilt Ziffer 4.8 (Löschung oder Rückgabe).

---

## 12. Schlussbestimmungen

### 12.1 Schriftform

Änderungen und Ergänzungen dieses Vertrags bedürfen der Textform. Dies gilt auch für den Verzicht auf das Textformerfordernis selbst.

### 12.2 Rangfolge

Bei Widersprüchen zwischen diesem Vertrag und dem Hauptvertrag gehen die Regelungen dieses Vertrags in allen datenschutzrechtlichen Fragen vor.

### 12.3 Salvatorische Klausel

Sollten einzelne Bestimmungen dieses Vertrags unwirksam sein oder werden, berührt dies die Wirksamkeit der übrigen Bestimmungen nicht. Die Parteien werden eine unwirksame Bestimmung durch eine wirksame Regelung ersetzen, die dem wirtschaftlichen Zweck der ursprünglichen Bestimmung am nächsten kommt.

### 12.4 Anwendbares Recht und Gerichtsstand

Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts. Ausschließlicher Gerichtsstand für alle Streitigkeiten aus diesem Vertrag ist `[Ort]`, soweit zwingendes Recht nichts Abweichendes vorschreibt.

---

Ort, Datum: `[Ort, Datum]`

Für den Auftraggeber:

---

`[Name, Funktion]`

Für den Auftragnehmer:

---

`[Name, Funktion]`

---

# Anhang 1: Technische und organisatorische Maßnahmen (TOMs)

Die folgenden Maßnahmen sind nach Art. 32 DSGVO sowie in Anlehnung an die Schutzziele der Vertraulichkeit, Integrität, Verfügbarkeit und Belastbarkeit strukturiert. Maßnahmen, die sich unmittelbar aus dem Einsatz von AInonymous ergeben, sind als solche kenntlich gemacht.

## A1.1 Zutrittskontrolle

- Serverräume und Rechenzentren mit Zutrittsausweissystem, Vereinzelungsanlagen und 24/7-Videoüberwachung
- Besucherregistrierung mit Begleitpflicht
- Dokumentation und regelmäßige Überprüfung der Zutrittsberechtigungen

## A1.2 Zugangskontrolle

- Authentifizierung über Einzel-Accounts mit starken Passwörtern und Multi-Faktor-Authentifizierung für administrative Zugänge
- **AInonymous-spezifisch**: Der Shutdown-Endpunkt des Proxys (`/shutdown`) verwendet einen pro Prozess generierten Einmal-Token mit zeitkonstantem Vergleich; der Token wird im Betriebssystem-Temp-Verzeichnis mit restriktiven Dateirechten (POSIX-Modus 0600) abgelegt.
- **AInonymous-spezifisch**: Die Management-Endpunkte `/metrics`, `/dashboard` und `/events` sind standardmäßig ausschließlich über die Loopback-Adresse (`127.0.0.1`) erreichbar. Wird der Proxy in einem Container- oder Kubernetes-Kontext auf externen Interfaces gebunden, wird die Netzwerkebene über eine `NetworkPolicy` isoliert (siehe OPERATIONS.md, Abschnitt "Kubernetes").
- Regelmäßige Überprüfung inaktiver Accounts und automatische Deaktivierung nach `[Frist]` Tagen
- Least-Privilege-Prinzip für alle Systemzugänge

## A1.3 Zugriffskontrolle

- Rollenbasiertes Berechtigungskonzept (RBAC) mit Dokumentation der Rollen und Berechtigungsmatrix
- Protokollierung administrativer Zugriffe
- Trennung von Entwicklungs-, Test- und Produktivumgebungen
- Verschlüsselung mobiler Datenträger und Notebooks

## A1.4 Weitergabekontrolle

- Verschlüsselung der Datenübertragung mit TLS 1.3 (Fallback 1.2) für alle externen Verbindungen
- **AInonymous-spezifisch**: Die Upstream-Verbindung zum konfigurierten LLM-Anbieter erfolgt ausschließlich über HTTPS; Zertifikatsprüfung ist aktiv.
- **AInonymous-spezifisch**: Die Session Map, die Pseudonyme auf Originalwerte abbildet, wird mit AES-256-GCM verschlüsselt. Der Schlüssel wird pro Prozess frisch und zufällig erzeugt und verbleibt ausschließlich im Arbeitsspeicher, sofern die optionale Persistenz (`session.persist: false`) nicht aktiviert ist. Der Zugriff auf die Forward-Map erfolgt über SHA-256-gehashte Keys.
- **AInonymous-spezifisch (opt-in-Persistenz)**: Wird `session.persist: true` gesetzt, so werden die verschlüsselten Session-Map-Einträge zusätzlich in einer lokalen SQLite-Datei (`ainonymous-session.db`, Standardpfad im Arbeitsverzeichnis) abgelegt, damit Pseudonyme über Prozess-Neustarts hinweg rehydrierbar bleiben. In diesem Modus muss der Schlüssel über `AINONYMOUS_SESSION_KEY` stabil bereitgestellt werden. Die Datei enthält ausschließlich Ciphertext (AES-256-GCM pro Zeile); sie ist in das Sicherheitskonzept der Arbeitsstation / des Hosts einzubeziehen (Festplattenverschlüsselung, Zugriffsrechte `0600`).
- **AInonymous-spezifisch**: Secrets (API-Schlüssel, Passwörter, Tokens) werden permanent durch `***REDACTED***` ersetzt und nicht rehydriert.
- Protokollierung des ausgehenden Datenverkehrs auf Netzwerkebene
- Kryptographisch signierte Releases (siehe Anhang zu Supply-Chain-Maßnahmen)

## A1.5 Eingabekontrolle und Auditierbarkeit

- **AInonymous-spezifisch**: Jede Verarbeitung wird in einem hash-verketteten JSONL-Audit-Log protokolliert (`ainonymous-audit-YYYY-MM-DD.jsonl`), das die Felder `seq`, `prevHash`, `hash`, `type`, `ts` enthält. Das Log ist über `verifyAuditChain` auf Manipulationen prüfbar und ist SIEM-konform.
- **AInonymous-spezifisch**: Das Audit-Log enthält ausschließlich SHA-256-Hashes der Originalwerte, nicht die Klartexte. Eine Reidentifikation aus dem Audit-Log ist ohne Kenntnis des Originalwerts nicht möglich.
- Externe Checkpoints (Append-only-Storage) für die periodische Sicherung des letzten Hash-Werts zur Erkennung nachträglicher Manipulation auch der letzten Einträge
- Aufbewahrungsfrist der Audit-Logs: `[30/60/90]` Tage, anschließend automatisierte Löschung per Cron-Job (siehe OPERATIONS.md)

## A1.6 Verfügbarkeitskontrolle

- Redundante Auslegung kritischer Systeme (`[n+1]` / `[n+2]`)
- Unterbrechungsfreie Stromversorgung (USV) und Notstromversorgung
- Tägliche Backups mit `[Frist]`-Aufbewahrung, monatlicher Restore-Test
- Dokumentiertes Notfallhandbuch und Wiederanlaufpläne (RTO / RPO: `[Zeitangaben]`)
- **AInonymous-spezifisch**: Upstream-Anfragen haben einen Timeout von 30 Sekunden, Antworten werden bei Überschreitung von 50 MB verworfen (Denial-of-Service-Schutz). Die HTTPS-Keep-Alive-Verbindung umfasst maximal 50 Sockets je Upstream.

## A1.7 Trennungskontrolle

- Mandantentrennung auf Ebene von `[Datenbank / Namespace / Kubernetes-Namespace / Prozess]`
- **AInonymous-spezifisch**: Session Maps werden prozessweise geführt. Zwischen Prozessen besteht keine gemeinsame Datenhaltung, sofern die optionale Persistenz (`session.persist: true`) nicht aktiviert ist. Bei aktivierter Persistenz wird die gemeinsame SQLite-Datei pro Deployment (nicht pro Mandant) geführt; Mandantentrennung ist in diesem Modus über separate Prozess- / Container-Instanzen mit jeweils eigener Datei und eigenem `AINONYMOUS_SESSION_KEY` sicherzustellen.
- Trennung produktiver Daten von Test- und Entwicklungsdaten; Produktionsdaten werden nicht in nichtproduktive Umgebungen übernommen.

## A1.8 Pseudonymisierung und Verschlüsselung (Art. 32 Abs. 1 lit. a DSGVO)

- **AInonymous-spezifisch**: Die Kernfunktion des Dienstes besteht in der Pseudonymisierung personenbezogener Daten in ausgehenden LLM-Anfragen. Die Drei-Layer-Pipeline (Secrets, Identity, Code-Semantik) bildet konsistente Pseudonyme, die pro Session wiederverwendbar sind.
- **AInonymous-spezifisch**: Compliance-Voreinstellungen (GDPR, HIPAA, CCPA, PCI-DSS, Finance, Healthcare) aktivieren spezifische Detektoren. Die Aktivierung einer Voreinstellung bedeutet **nicht** automatisch, dass das Gesamtsystem mit der jeweiligen Regulierung konform ist; sie stellt lediglich geeignete Erkennungsmuster bereit.
- Verschlüsselung ruhender Daten (at rest) auf allen Systemen mit personenbezogenen Daten (AES-256 oder gleichwertig)

## A1.9 Belastbarkeit und Wiederherstellbarkeit

- Regelmäßige Lasttests und Kapazitätsplanung
- Dokumentierte Wiederherstellungsverfahren mit definierten RTO / RPO
- Monatliche Übung der Wiederherstellungsverfahren in einer produktionsnahen Testumgebung

## A1.10 Evaluierung der Wirksamkeit (PDCA-Zyklus)

- Jährliche interne Überprüfung aller TOMs durch den Datenschutzbeauftragten
- Laufende Überwachung und Auswertung sicherheitsrelevanter Ereignisse (SIEM)
- Regelmäßige Mitarbeiterschulungen zu Datenschutz und Informationssicherheit (mindestens einmal jährlich)
- Versionierte Dokumentation aller Änderungen an den TOMs

## A1.11 Supply-Chain-Maßnahmen

- **AInonymous-spezifisch**: Nachvollziehbare Software-Lieferkette durch Software Bill of Materials (SBOM, CycloneDX) je Release
- **AInonymous-spezifisch**: Abhängigkeiten werden regelmäßig gegen bekannte Schwachstellen geprüft (`npm audit`, Dependency-Tracking)
- **AInonymous-spezifisch**: Releases werden kryptographisch signiert (sofern aktiviert) und vor dem Einsatz verifiziert
- Dokumentierte Freigabeprozesse für neue Versionen einschließlich Sicherheits-Review

---

# Anhang 2: Liste der Unter-Auftragsverarbeiter

Stand: `[Datum]`

| Unter-Auftragsverarbeiter | Sitz               | Ort der Verarbeitung  | Zweck                   | Rechtsgrundlage Drittland                          |
| ------------------------- | ------------------ | --------------------- | ----------------------- | -------------------------------------------------- |
| Anthropic PBC             | San Francisco, USA | USA, ggf. EU-Regionen | LLM-API (Claude)        | SCC 2021/914, Modul 2; ggf. Data Privacy Framework |
| OpenAI, L.L.C.            | San Francisco, USA | USA                   | LLM-API (GPT)           | SCC 2021/914, Modul 2; ggf. Data Privacy Framework |
| `[Hosting-Provider]`      | `[Sitz]`           | `[Ort]`               | Infrastruktur / Hosting | `[SCC / Angemessenheitsbeschluss / n. zutr.]`      |
| `[Monitoring-Provider]`   | `[Sitz]`           | `[Ort]`               | Betrieb / SIEM          | `[SCC / Angemessenheitsbeschluss / n. zutr.]`      |
| `[Backup-Provider]`       | `[Sitz]`           | `[Ort]`               | Datensicherung          | `[SCC / Angemessenheitsbeschluss / n. zutr.]`      |

## Drittland-Transfer

Übermittlungen in Drittländer erfolgen nur auf Grundlage der Standardvertragsklauseln der EU-Kommission (Durchführungsbeschluss 2021/914), ergänzt durch eine dokumentierte Transfer Impact Assessment (TIA). Für die USA wird zusätzlich geprüft, ob der jeweilige Empfänger unter dem EU-US Data Privacy Framework zertifiziert ist; bei Entfall oder Außerkraftsetzung wird auf SCC zurückgefallen.

Der Auftragnehmer stellt dem Auftraggeber die einschlägigen SCC und TIA auf Anforderung zur Verfügung.

---

# Anhang 3: Unterstützung bei Betroffenenrechten

## A3.1 Anwendungsbereich

Der Auftragnehmer unterstützt den Auftraggeber bei der Bearbeitung von Anfragen Betroffener nach Art. 12 bis 22 DSGVO:

- Art. 15 DSGVO - Auskunftsrecht
- Art. 16 DSGVO - Recht auf Berichtigung
- Art. 17 DSGVO - Recht auf Löschung ("Recht auf Vergessenwerden")
- Art. 18 DSGVO - Recht auf Einschränkung der Verarbeitung
- Art. 20 DSGVO - Recht auf Datenübertragbarkeit
- Art. 21 DSGVO - Widerspruchsrecht
- Art. 22 DSGVO - Recht auf keine automatisierte Entscheidung

## A3.2 Verfahren

1. Der Auftraggeber leitet Anfragen Betroffener, die den Auftragnehmer betreffen, an die in Ziffer 5.2 benannten Weisungsempfänger weiter.
2. Der Auftragnehmer antwortet innerhalb von fünf Werktagen mit einer ersten Einschätzung und den erforderlichen Daten.
3. Die endgültige Beantwortung gegenüber dem Betroffenen erfolgt durch den Auftraggeber.

## A3.3 Besonderheit AInonymous

Die von AInonymous geführte Session Map wird nicht persistiert und endet mit dem Prozess; sie ist daher für Auskunfts- oder Löschanfragen nicht relevant. Audit-Logs enthalten ausschließlich Hashes und keine Klartexte; eine Suche nach einem konkreten Betroffenen ist dadurch regelmäßig nicht möglich. Auskunfts- und Löschpflichten beziehen sich daher primär auf Systeme, in denen der Auftraggeber die Originaldaten selbst speichert.

---

# Anhang 4: Meldeverfahren bei Datenschutzverletzungen

## A4.1 Meldeweg

Die Meldung erfolgt per E-Mail an `[incident@auftraggeber.tld]` mit Kopie an den Datenschutzbeauftragten des Auftraggebers. Ergänzend erfolgt ein telefonischer Hinweis unter `[+49 ...]` bei Vorfällen mit hoher Schwere.

## A4.2 Mindestinhalt der Meldung

Die Meldung enthält, soweit im Zeitpunkt der Meldung bereits bekannt:

- Zeitpunkt und Dauer der Verletzung
- Art der Verletzung (z. B. unbefugter Zugriff, Verlust, Offenlegung)
- Betroffene Datenkategorien und ungefähre Anzahl Betroffener
- Wahrscheinliche Folgen der Verletzung
- Bereits ergriffene und geplante Abhilfemaßnahmen
- Kontaktdaten einer Ansprechperson beim Auftragnehmer
- Bei AInonymous-spezifischen Vorfällen zusätzlich: Version des eingesetzten Werkzeugs, betroffene Session-IDs (soweit ohne Reidentifikationsrisiko angebbar), Auszug aus dem Audit-Log mit Verifikationsergebnis der Hash-Kette

## A4.3 Folgemeldungen

Fehlende Informationen werden innerhalb von 72 Stunden nach der Erstmeldung nachgereicht. Weitere Aktualisierungen erfolgen bis zum Abschluss der Untersuchung mindestens wöchentlich.

## A4.4 Dokumentation

Sämtliche Meldungen, Folgemeldungen und die dazugehörigen Untersuchungsberichte werden beim Auftragnehmer für mindestens drei Jahre aufbewahrt und dem Auftraggeber auf Anforderung zur Verfügung gestellt.
