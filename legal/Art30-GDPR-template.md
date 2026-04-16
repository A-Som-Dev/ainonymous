# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO) - Template

> **DISCLAIMER**: Dieses Template ist kein Rechtsrat. Es dient als Ausfüllhilfe für das eigene Verarbeitungsverzeichnis nach Art. 30 DSGVO. Die Pflicht zur Führung eines Verzeichnisses trifft Verantwortliche (Abs. 1) und Auftragsverarbeiter (Abs. 2), mit den Ausnahmen nach Abs. 5. Vor Inbetriebnahme Datenschutzbeauftragten und Rechtsabteilung konsultieren.

> **DISCLAIMER (EN)**: This template is NOT legal advice. Consult your Data Protection Officer and legal counsel before relying on it.

---

## Anwendbarkeit (Art. 30 Abs. 5)

Die Verzeichnispflicht entfällt für Unternehmen und Einrichtungen mit weniger als 250 Mitarbeitern, es sei denn, mindestens eine der folgenden Bedingungen ist erfüllt:

- Die Verarbeitung birgt ein Risiko für die Rechte und Freiheiten der betroffenen Personen.
- Die Verarbeitung erfolgt nicht nur gelegentlich.
- Die Verarbeitung umfasst besondere Kategorien personenbezogener Daten nach Art. 9 Abs. 1 oder personenbezogene Daten über strafrechtliche Verurteilungen und Straftaten nach Art. 10.

**Hinweis zur Praxis**: Bei dauerhafter Nutzung von LLM-Diensten im Rahmen der Softwareentwicklung, Analyse oder Kundenkommunikation, auch wenn die Übermittlung anonymisiert via AInonymity-Proxy erfolgt, liegt regelmäßig eine nicht nur gelegentliche Verarbeitung vor. Die Verzeichnispflicht besteht in diesen Fällen unabhängig von der Mitarbeiterzahl.

---

## Eintrag: _[Bezeichnung der Verarbeitung, z.B. "LLM-gestützte Code-Analyse via AInonymity-Proxy"]_

### 1. Name und Kontaktdaten des Verantwortlichen

- Organisation: _[Name der juristischen Person]_
- Anschrift: _[Straße, Hausnummer, PLZ, Ort, Land]_
- Telefon / E-Mail: _[...]_
- Gesetzlicher Vertreter: _[Geschäftsführung / Vorstand]_
- Ggf. Vertreter nach Art. 27 (bei Sitz außerhalb EU): _[...]_
- Datenschutzbeauftragter (sofern benannt nach Art. 37): _[Name, Kontakt]_
- Gemeinsam Verantwortliche nach Art. 26 (sofern einschlägig): _[...]_

### 2. Zwecke der Verarbeitung

- **Primärzweck**: _[z.B. "Unterstützung der Softwareentwicklung durch LLM-gestützte Code-Vorschläge und Code-Reviews"]_
- **Ggf. Sekundärzweck**: _[z.B. "Erstellung technischer Dokumentation aus Quellcode-Kontext"]_

**Rechtsgrundlage** (Art. 6 Abs. 1):

- [ ] lit. a - Einwilligung der betroffenen Person
- [ ] lit. b - Erfüllung eines Vertrags (z.B. mit Mitarbeitern im Rahmen des Arbeitsvertrags, ggf. in Verbindung mit Betriebsvereinbarung)
- [ ] lit. c - rechtliche Verpflichtung
- [ ] lit. d - lebenswichtige Interessen
- [ ] lit. e - Wahrnehmung einer Aufgabe im öffentlichen Interesse
- [ ] lit. f - berechtigte Interessen des Verantwortlichen (z.B. Produktivitätssteigerung, Code-Qualität)

**Interessenabwägung** (bei lit. f erforderlich): Dokumentiert in _[Verweis auf internes Dokument oder Anhang]_. Ergebnis: _[Ja / Nein]_.

**Besondere Kategorien** (Art. 9 Abs. 2, sofern einschlägig): Rechtsgrundlage _[...]_.

### 3. Kategorien betroffener Personen

- [ ] Mitarbeiter (Urheber von Code, Kommentaren, Commit-Messages)
- [ ] Kunden (sofern Kundendaten im Verarbeitungskontext enthalten sind)
- [ ] Lieferanten und externe Dienstleister (sofern deren Daten im Kontext erscheinen)
- [ ] Dritte (z.B. Personen in Logdateien, Support-Tickets, Fehlerberichten)
- [ ] Bewerber (bei Nutzung im Rahmen von Rekrutierung)
- [ ] Sonstige: _[...]_

### 4. Kategorien personenbezogener Daten

- [ ] Stammdaten (Name, E-Mail-Adresse, beruflicher Kontakt, Organisationseinheit)
- [ ] Identifier (Benutzernamen, Git-Author, digitale Signaturen, Account-IDs)
- [ ] Technische Identifier (IP-Adresse, User-Agent, Session-IDs; in der Regel außerhalb des Scopes der LLM-Übermittlung)
- [ ] Inhaltsdaten (Quellcode, Kommentare, Prompts, Konversationsverläufe)
- [ ] Metadaten (Zeitstempel, Dateipfade, Commit-Historie)
- [ ] **Besondere Kategorien nach Art. 9**: Gesundheitsdaten, religiöse Überzeugung, politische Meinung, Gewerkschaftszugehörigkeit, biometrische oder genetische Daten, Daten zu Sexualleben/Orientierung, rassische oder ethnische Herkunft. Solche Daten sollen vor Übermittlung durch AInonymity eliminiert oder anonymisiert werden. Restrisiko dokumentieren.
- [ ] Daten zu strafrechtlichen Verurteilungen (Art. 10)

### 5. Kategorien von Empfängern

**Innerhalb EU/EWR**:

- _[Interne Abteilungen, Konzerngesellschaften, Dienstleister mit Sitz in EU/EWR]_

**Drittland (Art. 44 ff.)**:

- _[z.B. Anthropic PBC, San Francisco, USA; OpenAI L.L.C., San Francisco, USA; Google LLC, Mountain View, USA]_
- **Rechtsgrundlage für Drittland-Transfer**:
  - [ ] Angemessenheitsbeschluss nach Art. 45 (z.B. EU-US Data Privacy Framework, Vereinigtes Königreich, Schweiz)
  - [ ] Standardvertragsklauseln nach Art. 46 Abs. 2 lit. c (Durchführungsbeschluss 2021/914)
  - [ ] Verbindliche interne Datenschutzvorschriften (BCR, Art. 47)
  - [ ] Ausnahmen nach Art. 49 (restriktiv)
- **Zusätzliche Schutzmaßnahmen** (Transfer Impact Assessment nach Schrems II): Anonymisierung und Pseudonymisierung durch AInonymity vor Transfer; Entfernung von Secrets (API-Keys, Tokens, Passwörter); konfigurierbare Retention-Policies beim Empfänger.

### 6. Vorgesehene Fristen für die Löschung der verschiedenen Datenkategorien (Art. 30 Abs. 1 lit. f)

| Datenkategorie | Speicherdauer | Begründung |
|----------------|---------------|------------|
| Request- und Response-Logs (AInonymity) | _[z.B. 30 Tage]_ | Fehleranalyse, Missbrauchserkennung |
| Audit-Log (SHA-256-Hash-Chain) | _[z.B. 12 Monate]_ | Nachweis nach Art. 5 Abs. 2, anschließend anonymisierte Archivierung |
| Session-Map (Pseudonym-Mapping) | Prozess-Ende; bei Persistenz (optional ab v1.1) gemäß _[...]_ | Rehydration notwendig während aktiver Session |
| Prompts und Responses beim LLM-Anbieter | Gemäß DPA des Anbieters, z.B. _[Anthropic: Details siehe Auftragsverarbeitungsvertrag]_ | Vertraglich vereinbart |
| Nutzungsmetriken (aggregiert, anonym) | _[z.B. unbegrenzt]_ | Statistische Auswertung |

Verfahren zur Löschung: _[Automatisiert / manuell, Verweis auf Löschkonzept]_.

### 7. Allgemeine Beschreibung der technischen und organisatorischen Maßnahmen (Art. 32)

Verweis auf das TOM-Dokument bzw. Anhang. Die folgenden Maßnahmen sind bei Einsatz von AInonymity mindestens zu adressieren:

**Pseudonymisierung und Anonymisierung**:
- AInonymity 3-Layer-Pipeline: Secrets-Redaction, Identity-Pseudonymisierung, Code-Semantik-Pseudonymisierung
- Bidirektionale Session-Map für konsistente Pseudonyme pro Session
- Domain-aware Pseudonymisierung (strukturelle Teile bleiben, Domain-Teile werden ersetzt)

**Verschlüsselung**:
- AES-256-GCM für persistierte Session-Maps (sofern aktiviert)
- TLS 1.3 für Transport zum LLM-Upstream
- Verschlüsselung ruhender Daten auf Anwendungsservern: _[...]_

**Vertraulichkeit**:
- Zugangsbeschränkung zum Proxy (Bind auf 127.0.0.1 standardmäßig)
- Authentifizierung der API-Nutzer: _[...]_
- Rollen- und Berechtigungskonzept: _[Verweis]_

**Integrität**:
- Audit-Log mit SHA-256-Hash-Chain (Manipulationserkennung)
- Versionskontrolle der Konfiguration
- Code-Signierung: _[sofern eingesetzt]_

**Verfügbarkeit und Belastbarkeit**:
- Backup-Strategie: _[...]_
- Wiederherstellungszeit: _[RTO, RPO]_
- Redundanz: _[...]_

**Verfahren zur regelmäßigen Überprüfung, Bewertung und Evaluierung**:
- PDCA-Zyklus: _[Intervalle]_
- Penetrationstests: _[Frequenz]_
- Datenschutz-Folgenabschätzung nach Art. 35 (sofern erforderlich): _[Status]_
- Review der Pipeline-Regeln und Glossare: _[Intervall]_

---

## Beispiel-Eintrag: AInonymity für Code-Review-Unterstützung

### Bezeichnung
LLM-gestützte Code-Analyse und Code-Review-Unterstützung via AInonymity-Proxy.

### Zweck
Unterstützung der Softwareentwicklungsabteilung bei Code-Reviews, Refactoring-Vorschlägen und Fehleranalyse durch Nutzung eines kommerziellen LLM-Dienstes. Die Übermittlung an den Drittland-Anbieter erfolgt ausschließlich über den AInonymity-Proxy, der Quellcode-Identifier, Secrets und Identitätsdaten vor der Übermittlung pseudonymisiert bzw. redaktiert.

### Rechtsgrundlage
Art. 6 Abs. 1 lit. f DSGVO - berechtigtes Interesse des Verantwortlichen an Produktivitätssteigerung, Code-Qualität und Fehlerprävention. Interessenabwägung dokumentiert; die berechtigten Interessen überwiegen die Interessen der betroffenen Personen, weil:
- Namen, E-Mail-Adressen und Identifier werden durch AInonymity vor der Übermittlung pseudonymisiert.
- Secrets werden redaktiert und nie übermittelt.
- Keine besonderen Kategorien nach Art. 9 werden verarbeitet.
- Kein automatisiertes Entscheiden mit rechtlicher Wirkung nach Art. 22.
- Mitarbeiter wurden im Rahmen der Betriebsvereinbarung _[...]_ informiert; Widerspruchsrecht nach Art. 21 besteht.

### Kategorien Betroffener
- Software-Entwicklerinnen und -Entwickler (intern)
- Ggf. Autoren historischer Commits (bei Git-Blame-Analyse)
- Kunden und Dritte, sofern deren Daten in Kommentaren oder Testdaten vorkommen (Restrisiko, Schulungen nach _[...]_ adressieren dies)

### Datenkategorien
- Benutzernamen (git config user.name) - pseudonymisiert
- E-Mail-Adressen (git config user.email) - pseudonymisiert
- Quellcode-Identifier (Klassen, Variablen, Funktionsnamen, Dateinamen) - teilweise pseudonymisiert nach Policy
- Inhaltliche Kommentare - je nach Policy redaktiert oder pseudonymisiert
- Secrets (API-Keys, Tokens, Credentials) - vor Übermittlung redaktiert, nie rehydriert

### Empfänger
- Anthropic PBC, San Francisco, CA, USA (Claude API)
- Transfer-Grundlage: Standardvertragsklauseln der EU-Kommission 2021/914 (Modul 2, Controller-to-Processor), ergänzt durch Anonymisierung und Pseudonymisierung vor Übermittlung als zusätzliche Schutzmaßnahme im Sinne der EDSA-Empfehlungen 01/2020.
- Auftragsverarbeitungsvertrag nach Art. 28 abgeschlossen am _[Datum]_, hinterlegt unter _[Verweis]_.

### Löschfristen
- AInonymity Session-Map: bei Prozess-Ende (flüchtig im Arbeitsspeicher).
- AInonymity Audit-Log: 90 Tage rolling, anschließend anonymisierte Archivierung.
- Request-/Response-Logs beim LLM-Anbieter: gemäß Anthropic DPA und Retention-Policy, typischerweise 30 Tage für Abuse-Monitoring; keine Nutzung zum Modelltraining bei Enterprise-Tier.

### Technische und organisatorische Maßnahmen
Siehe zentrales TOM-Dokument, ergänzt durch die AInonymity-Betriebsdokumentation (SECURITY.md, THREAT_MODEL.md). Kernpunkte:
- 3-Layer-Pipeline mit deterministischer Pseudonymisierung
- AES-256-GCM für persistierte Mappings
- SHA-256-Hash-Chain im Audit-Log
- Proxy-Bind auf Loopback-Interface
- Regelmäßige Review der Detection-Regeln (OpenRedaction) und projektspezifischen Glossare

---

## Einträge für Auftragsverarbeiter (Art. 30 Abs. 2)

Auftragsverarbeiter führen ein eigenes Verzeichnis mit folgenden Angaben:

### 1. Name und Kontaktdaten des Auftragsverarbeiters
- Organisation, Anschrift, Vertreter, Datenschutzbeauftragter: analog Art. 30 Abs. 1 Nr. 1.

### 2. Name und Kontaktdaten jedes Verantwortlichen, in dessen Auftrag verarbeitet wird
- Pro Auftraggeber ein Eintrag: _[...]_

### 3. Kategorien von Verarbeitungen im Auftrag
- _[z.B. Bereitstellung der AInonymity-Instanz als Managed Service]_

### 4. Drittlandtransfers
- Analog Art. 30 Abs. 1 Nr. 5 einschließlich Dokumentation geeigneter Garantien.

### 5. Allgemeine Beschreibung der TOMs
- Verweis auf TOM-Dokument analog Art. 30 Abs. 1 Nr. 7.

### Unterauftragsverarbeiter
Für jeden Unterauftragsverarbeiter (Sub-Processor):
- Name und Kontaktdaten
- Verarbeitungsumfang
- Standort (EU/EWR oder Drittland mit Garantien)
- Informations- oder Zustimmungspflicht gegenüber dem Verantwortlichen nach Art. 28 Abs. 2 und Abs. 4

---

## Hinweise zur Pflege des Verzeichnisses

- Das Verzeichnis ist schriftlich oder elektronisch zu führen (Art. 30 Abs. 3).
- Auf Anfrage ist es der Aufsichtsbehörde zur Verfügung zu stellen (Art. 30 Abs. 4).
- Änderungen in Verarbeitungszwecken, Empfängern, Drittlandtransfers oder TOMs sind zeitnah einzupflegen.
- Eine jährliche Review wird empfohlen; bei wesentlichen Änderungen an AInonymity (Version-Upgrades, neue Detection-Module, geänderte Pipeline) zusätzliche Ad-hoc-Prüfung.

---

_Stand der Vorlage: siehe Git-Historie dieses Dokuments._
