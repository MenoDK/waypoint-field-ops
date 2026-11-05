/* German overlay. Text only: the keys mirror the shape of content.js, and anything missing falls back to English. */
(window.SITE_I18N ||= {}).de = {
  title: 'waypoint-field-ops · ein Flotten-Backend für Telefone, die das Signal verlieren',
  loading: {
    context: 'Flottenbetrieb',
    title: 'Flotte wird geortet',
    text: 'Letzte Positionen, Straßen-Router und Uhr werden gelesen.',
    foot: 'Lokale Demo · simulierte Telefone auf diesem Rechner',
  },
  lab: { cta: 'Ins Labor' },
  hero: {
    eyebrow: 'Außendienst · offlinetauglich, ehrlich darüber, was es weiß',
    lead: 'Wissen, wo jedes Fahrzeug ist',
    soft: 'und wie sicher man sich ist.',
    text: 'Ein Flotten-Backend für Telefone, die durch Tunnel fahren, eine Stunde Positionen auf einmal senden und manchmal die falsche Uhrzeit haben. Messwerte werden geprüft und genau einmal gespeichert, ETAs sagen, wie sie entstanden sind, Schweigen löst einen Alarm aus, und eine Warteschlange lässt nie mehr Personen einsteigen, als das Fahrzeug fasst. Simulierte Telefone fahren auf Ihrem Laptop durch eine erfundene Region.',
    primary: { label: 'Labor öffnen' },
    secondary: { label: 'So funktioniert es' },
    pilot: 'Läuft auf Ihrem Laptop · Telefone und Straßen-Router sind simuliert, keine Konten',
    proof: [
      { a: 'Positionen werden einmal gespeichert', b: 'egal wie oft sie gesendet werden' },
      { a: 'Jede Garantie hat einen Test', b: 'der versucht, sie zu brechen' },
    ],
    top: ['WAYPOINT', 'Positionen, die man vertreten kann.'],
    status: {
      small: 'Letzter Alarm',
      strong: 'Seit 4 Min. kein Signal. Vom Worker geöffnet, von der nächsten Position geschlossen.',
    },
  },
  principles: {
    lead: ['Gebaut für', 'die Funklöcher.'],
    items: [
      [null, 'Speichert einmal'],
      [null, 'Nennt seine Methode'],
      [null, 'Alarm bei Schweigen'],
      [null, 'Zählt Personen'],
    ],
  },
  tour: {
    eyebrow: 'Ein Rundgang durch das Ganze',
    title: ['Fünf Dinge, die unterwegs', 'schiefgehen.'],
    text: 'Wählen Sie einen Tab. Die Ausgabe darunter wurde mit fiktiven Daten aus der laufenden Anwendung aufgezeichnet; ein Test schlägt fehl, sobald sie nicht mehr stimmt.',
    tag: 'Aufgezeichnete Ausgabe',
    tabs: [
      {
        label: 'Aufnahme',
        title: 'Eine Stunde im Tunnel kommt als ein Stapel an und wird einmal gespeichert.',
        text: 'Ein Messwert ohne GPS-Fix oder mit falscher Uhr wird für sich abgelehnt; die guten im selben Stapel bleiben erhalten. Den Stapel erneut zu senden ändert nichts, und ein alter Messwert bewegt das Fahrzeug nie rückwärts.',
      },
      {
        label: 'Ankunft',
        title: 'Für die Ankunft braucht es zwei gute Fixes, und sie wird einmal geschrieben.',
        text: 'Ein Fix im Radius kann GPS-Rauschen sein. Ein Fix, der seine eigene Fehlertoleranz zugibt, ist zu ungenau, um zu zählen. Die Ankunft wird mit einem bedingten Update gestempelt, sodass zwei gleichzeitige Stapel sie nicht beide beanspruchen können.',
      },
      {
        label: 'Alarme',
        title: 'Schweigen löst einen Alarm aus. Eine Position schließt ihn.',
        text: 'Alarme sind Zustand, keine Ereignisse: Ein partieller eindeutiger Index erlaubt einen offenen Alarm pro Fahrzeug und Art, und ein geplanter Auswerter gleicht sie ab. Zweimal oder auf drei Workern ausgeführt, kommt dasselbe heraus.',
      },
      {
        label: 'Warteschlange',
        title: 'Die Einheit nimmt nie mehr Personen auf, als sie fasst.',
        text: 'Die Kapazität zählt Personen. Eine einzige Regel entscheidet, wie viele aufgerufen werden dürfen, bei „die nächsten fünf aufrufen“ wie bei „diese aufrufen“, und die Zeile der Einheit ist dabei gesperrt.',
      },
      {
        label: 'Grenzen',
        title: 'Die Fahrt einer anderen Flotte existiert nicht. Einem schlechten Router wird nicht geglaubt.',
        text: 'Alles ist durch die Flotte im Token eingegrenzt, daher antwortet die ID einer anderen Flotte mit 404, nicht 403. Eine feindliche Router-Antwort wird abgelehnt, und die ETA sagt, dass sie auf die Luftlinie zurückgefallen ist.',
      },
    ],
    modulesTitle: 'Alles, was in der Box steckt.',
    modulesNote: 'Jedes Teil hat eine Testdatei und einen Platz im Labor',
    modules: [
      [
        null,
        'Nur anhängender Verlauf',
        'Tagespartitionen, Primärschlüssel aus Fahrer und Erfassungszeit, ON CONFLICT DO NOTHING und Aufbewahrung durch Löschen einer Partition statt einzelner Zeilen.',
      ],
      [
        null,
        'Upsert der letzten Position',
        'Die neuere Erfassung gewinnt, eine ältere bleibt im Verlauf, bewegt das Fahrzeug aber nie, und der Zeitpunkt der letzten echten Bewegung wird gesondert geführt.',
      ],
      [
        null,
        'ETA mit Methode',
        'Straße oder Luftlinie, gemessene oder Standardgeschwindigkeit, und die Antwort sagt, welche. Ein Circuit Breaker und ein Cache stehen vor dem Router.',
      ],
      [
        null,
        'Alarme als Zustand',
        'Kein Signal, langer Halt, bald am Ziel. Ein geplanter Auswerter gleicht sie mit den Fakten ab; ein partieller eindeutiger Index hält je einen offen.',
      ],
      [
        null,
        'Kapazitätsbewusste Warteschlange',
        'Eine Zulassungsregel für beide Arten des Aufrufens, FOR UPDATE auf der Einheit und eine Warnung, wenn die Personen an Bord das Limit überschreiten.',
      ],
      [
        null,
        'Echtzeit über die Datenbank',
        'pg_notify innerhalb der Transaktion, eine eigene LISTEN-Verbindung, die sich neu verbindet, und Räume aus dem geprüften Token, nie aus einer Nachricht.',
      ],
    ],
    transparency: {
      strong: 'Ehrlich zur Demo.',
      text: 'Die Telefone und der Straßen-Router sind simulierte Programme, die per HTTP mit der echten API sprechen; nichts davon lief gegen echte Geräte oder eine echte Routing-Engine. Die Region ist erfunden. Die Liste der Einschränkungen in der README ist vollständig.',
    },
  },
  challenges: {
    eyebrow: 'Die schwierigen Teile',
    title: ['Los,', 'versuchen Sie, es zu brechen.'],
    text: 'Das sind die sieben Dinge, die sich leicht behaupten und schwer richtig machen lassen. Jedes hat ein Rezept, was Sie sehen sollten, und eine Schaltfläche, die das Labor genau auf diesem Tab öffnet.',
    items: [
      {
        label: 'Durch einen Tunnel fahren',
        title: 'Ein Telefon offline nehmen, weiterfahren lassen und dann zurückholen.',
        text: 'Telefone verlieren das Signal. Der Server darf die Stunde nicht verlieren.',
      },
      {
        label: 'Einen schlechten Stapel senden',
        title: 'Gute Messwerte mit Null Island, einer Uhr aus der Zukunft und einem alten mischen.',
        text: 'Ein schlechter Messwert darf die übrigen nicht kosten.',
      },
      {
        label: 'Auf der Linie stehen',
        title: 'Ein Telefon am Rand des Ziels zittern lassen.',
        text: 'Ankommen ist eine Entscheidung, keine Koordinate.',
      },
      {
        label: 'Verstummen',
        title: 'Das Signal eines Telefons kappen und auf den Alarm warten.',
        text: 'Niemand meldet, dass er nicht mehr meldet.',
      },
      {
        label: 'Den Transporter überbuchen',
        title: 'Mehr Personen aufrufen, als die Einheit fasst, auf zwei verschiedene Arten.',
        text: 'Eine Kapazitätsregel, der nur ein Weg folgt, ist keine Regel.',
      },
      {
        label: 'Den Router brechen',
        title: 'Den Straßen-Router lügen, hängen und verschwinden lassen.',
        text: 'Eine Abhängigkeit, die Ihnen nicht gehört, ist eine Eingabe, keine Tatsache.',
      },
      {
        label: 'In eine andere Flotte spähen',
        title: 'Eine Flotte nach Fahrt, Socket und Blatt einer anderen Flotte fragen.',
        text: 'Geprüfte Trennung kann vergessen werden. Strukturelle nicht.',
      },
    ],
  },
  run: {
    eyebrow: 'In einer Minute gestartet',
    title: ['Ein Befehl.', 'Eine Flotte auf localhost.'],
    text: 'Sie brauchen Docker. Keine API-Schlüssel, keine Konten, und nichts verlässt Ihren Rechner.',
    steps: [
      [null, 'Klonen', 'git clone, dann in den Ordner wechseln.'],
      [
        null,
        'Starten',
        'make demo baut das Image, migriert die Datenbank und startet API, Worker und das simulierte Feld, jeweils nach Health-Check.',
      ],
      [
        null,
        'Öffnen',
        'http://localhost:8400 ist diese Seite. Klicken Sie auf „Ins Labor“: Die Fahrzeuge sind schon unterwegs.',
      ],
      [
        null,
        'Brechen',
        'Nutzen Sie die schwierigen Teile oben, oder führen Sie make e2e für die Browser-Suite aus.',
      ],
    ],
  },
  under: {
    eyebrow: 'Unter der Haube',
    title: ['Eine kleine Oberfläche,', 'ernste Kanten.'],
    text: 'Der interessante Code ist absichtlich kurz. Die Entscheidungen dahinter sind aufgeschrieben, samt den Alternativen, die verloren haben.',
    stackTitle: 'Womit es gebaut ist',
    proofTitle: 'Was gemessen wird, und die Aufzeichnungen dahinter',
    numbers: [
      [null, 'Tests: 215 Unit-Tests und 151 gegen ein echtes PostGIS mit lauschender Anwendung'],
      [null, 'absichtlich gebrochene Regeln, von einem Test erkannt, keine übrig'],
      [null, 'Entscheidungsprotokolle, jedes mit verworfenen Alternativen'],
      [null, 'Fehler unter tsc --strict'],
    ],
    decisions: [
      [
        'Jeden Messwert prüfen, nicht die Anfrage',
        'ADR 0002: warum eine schlechte Koordinate nicht die anderen 299 kosten darf.',
      ],
      [
        'Ein Verlauf, dem man nur anhängt',
        'ADR 0003: Partitionen, idempotente Schreibvorgänge und Aufbewahrung ohne DELETE.',
      ],
      ['Alarme sind Zustand', 'ADR 0004: warum ein Abgleicher einen Event-Handler schlägt.'],
      ['Eine Zulassungsregel', 'ADR 0005: wie die Kapazität bei gleichzeitigen Aufrufen stimmt.'],
      [
        'Eine ETA, die ihre Methode nennt',
        'ADR 0006: ehrliche Rückfälle und ein Router, dem man nicht traut.',
      ],
      ['Echtzeit über die Datenbank', 'ADR 0007: pg_notify in der Transaktion und Räume aus dem Token.'],
      [
        'Ein Labor, das die Produktion nicht erreicht',
        'ADR 0008: drei Schichten halten die Schalter dort, wo sie hingehören.',
      ],
      [
        'Fahrten per Tabelle, Links per Signatur',
        'ADR 0009: Compare-and-Set-Übergänge und Links, die ihre Berechtigung selbst tragen.',
      ],
      [
        'Grenzen durch Konstruktion',
        'ADR 0010: die Flotte aus dem Token, standardmäßig verweigern, eine kleine Datenbankrolle.',
      ],
    ],
    measuredOn:
      'Gemessen am 2026-11-05. Die Zahlen stammen aus den Befehlen der README, nicht aus dem Gedächtnis.',
    future: [
      ['Eine echte Routing-Engine', 'hinter demselben abgesicherten Adapter, mit eigenen Verkehrsdaten.'],
      ['Push für Fahrer', 'statt Abfragen, über dieselben Räume.'],
      [
        'Aufbewahrung je Flotte',
        'weil die Dauer, wie lange Positionen gespeichert werden dürfen, eine Vertragsfrage ist.',
      ],
    ],
  },
  about: {
    why: 'Waypoint ist die Außendienst-Seite meiner Arbeit: Telefone, von denen man nicht erwarten kann, dass sie online sind, die richtige Uhrzeit haben oder Dinge nur einmal senden, und die Bildschirme speisen, an denen Menschen Entscheidungen treffen. Die Ideen stammen aus Systemen, die ich gebaut und betrieben habe; der Code in diesem Repository ist neu geschrieben und getestet.',
  },
  faq: [
    [
      'Gibt es eine echte Registrierung?',
      'Nein, absichtlich. Die Demo hat zwei erfundene Flotten mit je einer Disposition und Fahrern; das Labor meldet Sie als beliebigen von ihnen an. Die echte Anmeldung (scrypt, Ratenbegrenzung, festgelegtes JWT) ist in der API vorhanden und getestet.',
    ],
    [
      'Warum PostGIS und nicht nur Spalten für Breite und Länge?',
      'Entfernungen, Radien und Spuren sind Geografieprobleme. PostGIS löst sie korrekt auf der Kugel, indiziert sie und hält die Geofence-Prüfungen an einer Stelle.',
    ],
    [
      'Warum den Verlauf nach Tagen partitionieren?',
      'Weil das billigste Mittel, personenbezogene Daten planmäßig zu vergessen, das Löschen einer Partition ist. Die Anwendungsrolle darf nicht einmal DELETE auf den Verlauf ausführen; eine kontrollierte Funktion löscht Partitionen.',
    ],
    [
      'Was, wenn zwei Worker gleichzeitig Alarme auswerten?',
      'Nichts geht kaputt. Der Auswerter vergleicht Fakten mit den offenen Alarmen, und ein partieller eindeutiger Index verhindert Duplikate, also liefern ein Worker oder drei dasselbe Ergebnis.',
    ],
    [
      'Kann der Labormodus die Produktion erreichen?',
      'Nein. Die Konfiguration lehnt LAB_MODE und ein Demo-Passwort ab, wenn NODE_ENV production ist, ein Test hält das fest, und die Labor-Routen antworten mit 404, solange das Labor nicht aktiv ist, und weisen jeden nicht lokalen Host ab.',
    ],
    [
      'Ist es produktionsreif?',
      'Es ist nach diesem Anspruch gebaut und getestet: strikte Typen, Tests gegen eine echte Datenbank, Mutationsprüfungen. Es hat noch keinen echten Verkehr getragen, und was fehlt, steht in den Einschränkungen der README.',
    ],
  ],
  closing: {
    eyebrow: 'Sie sind dran',
    title: [
      'Versuchen Sie, den Server dazu zu bringen,',
      'eine Position zu glauben, die er nicht glauben sollte.',
    ],
    button: 'Labor öffnen',
    fine: 'Nur lokal · fiktive Daten · nichts wird irgendwohin gesendet',
  },
};
