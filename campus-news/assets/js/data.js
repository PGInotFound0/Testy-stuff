/* Campus News — Demo-Datenbestand (PoC).
 *
 * ALLE Artikel sind FIKTIVE PLATZHALTER für einen Prototyp. Nicht redaktionell
 * geprüft, keine echten Meldungen, keine echten Personen.
 *
 * In einem echten System ersetzt diese Datei eine API, z. B.:
 *   GET /api/articles            -> Liste
 *   GET /api/articles/:slug      -> Einzelartikel
 * Feldstruktur entspricht dem, was man aus einem CMS (Sanity/Payload/Strapi)
 * oder einer SQL-Tabelle problemlos 1:1 rausgeben kann.
 */

window.CAMPUS_NEWS = {
  meta: {
    school: "Campus Technicus Bernburg",
    city: "Bernburg (Saale)",
    updated: "2026-09-18",
    disclaimer: "Fiktive Demo-Inhalte einer Machbarkeitsstudie."
  },

  categories: [
    { id: "alle",      label: "Alle" },
    { id: "schule",    label: "Schule" },
    { id: "technik",   label: "Technik" },
    { id: "projekte",  label: "Projekte" },
    { id: "sport",     label: "Sport" },
    { id: "kultur",    label: "Kultur" },
    { id: "stadt",     label: "Bernburg" }
  ],

  articles: [
    {
      slug: "robotik-ag-startet",
      title: "Robotik-AG startet im Werkstattgebäude — 24 Plätze, restlos voll",
      teaser: "Ab nächster Woche schrauben zwei Kurse an Liniensensoren und Greifern. Die Warteliste ist länger als die Teilnehmerliste.",
      category: "technik",
      kicker: "MINT",
      date: "2026-09-18",
      author: "Demo-Redaktion",
      readingMinutes: 3,
      featured: true,
      breaking: true,
      tags: ["Robotik", "Werkstatt", "AG"],
      body: [
        "Mit Beginn der nächsten Woche fällt im Werkstattgebäude der Startschuss für die neue Robotik-AG. Zwei Kurse à zwölf Plätze sind nach zwei Tagen Anmeldefenster vollständig belegt — eine dritte Gruppe ist laut Fachbereich derzeit nur eine Frage der Betreuung.",
        "Auf dem Programm stehen Liniensensoren, Greifarme und der erste eigene Fahralgorithmus. Wer die Basics beherrscht, arbeitet anschließend an einer Aufgabe, die in der Region tatsächlich vorkommt: Bauteile erkennen, sortieren, ablegen — also genau das, was in der Produktion an der Saale seit Jahren automatisiert wird.",
        "Das Material stammt teils aus dem Fundus der Berufsbildungs-Kooperation, teils aus einer Spende. Ein Punkt, den die AG-Leitung offen anspricht: dauerhaft braucht das Projekt ein eigenes Budget, sonst endet es mit dem ersten defekten Controller.",
        "Ein Vorführtermin für Eltern und Klassen ist für das Ende des ersten Halbjahres geplant. Ob vorher offene Werkstatt-Tage für Fünft- und Sechstklässler möglich sind, hängt an der Aufsicht — nicht am Interesse."
      ]
    },
    {
      slug: "tag-der-offenen-tuer",
      title: "Tag der offenen Tür: Ein Nachmittag, zwei Standorte, viele Fragen",
      teaser: "Käthe-Kollwitz-Straße und Leipziger Straße öffnen gleichzeitig. Wer beides sehen will, braucht einen Plan.",
      category: "schule",
      kicker: "Veranstaltung",
      date: "2026-09-17",
      author: "Demo-Redaktion",
      readingMinutes: 4,
      featured: true,
      breaking: false,
      tags: ["Anmeldung", "Standorte", "Eltern"],
      body: [
        "Der Campus Technicus lädt zum Tag der offenen Tür an beide Standorte. In der Käthe-Kollwitz-Straße stehen Werkstätten, Fachkabinette und die Mensa offen, in der sanierten Heine-Schule an der Leipziger Straße dreht sich alles um Sport, Medien und Kreativbereiche.",
        "Für Grundschuleltern ist vor allem eine Frage zentral: Was passiert in Klasse 5 und 6, wenn ein Kind noch gar nicht weiß, wohin es später will? Genau dafür gibt es an diesem Nachmittag Stationen statt Vorträge — ausprobieren ist der eigentliche Teil der Führung.",
        "Die Fachbereiche zeigen Kurzprojekte im 20-Minuten-Takt, damit ein Rundgang durch beide Häuser realistisch bleibt. Für die Wege zwischen den Standorten soll es eine verdichtete Taktung geben; die genauen Zeiten hängen an der Kapazität der Buslinie.",
        "Wer konkrete Fragen zu Aufnahme, Nachmittagsbetreuung oder Ganztagsangeboten hat, sollte sie schriftlich mitbringen. Am Infostand ist der Andrang erfahrungsgemäß größer als die Zeit für Einzelgespräche."
      ]
    },
    {
      slug: "schule-ohne-handy",
      title: "Handyverbot in der Schule: Was die Forschungslage hergibt — und was nicht",
      teaser: "Eine Pauschallösung existiert nicht. Ein Überblick über Studien, Ausnahmen im Schulgesetz und Erfahrungen aus anderen Ländern.",
      category: "schule",
      kicker: "Hintergrund",
      date: "2026-09-16",
      author: "Demo-Redaktion",
      readingMinutes: 6,
      featured: false,
      breaking: false,
      tags: ["Medienbildung", "Schulgesetz", "Debatte"],
      body: [
        "Kaum ein Thema wird an Schulen so emotional verhandelt wie private Smartphones. Dabei ist die Datenlage differenzierter als beide Lager behaupten: Verboten werden in der Regel Handys, gemeint ist aber meistens Aufmerksamkeit, Pausenkultur und Gruppendynamik.",
        "Untersuchungen aus Ländern mit landesweiten Regelungen finden kleine, aber messbare Effekte auf die Lernleistung — und deutlich stärkere Effekte auf das Pausenverhalten. Wer in der Pause weniger scrollt, spricht messbar mehr miteinander. Das ist wenig überraschend und trotzdem die wichtigste Zahl.",
        "Der rechtliche Rahmen in Sachsen-Anhalt erlaubt Schulordnungen mit klaren Regeln, verlangt aber Verhältnismäßigkeit und Ausnahmen — etwa für dienstliche Nutzung, Notfälle oder medizinische Erfordernisse. Ein komplettes Verbot ohne Ausnahmekatalog ist rechtlich angreifbar.",
        "Für den Schulalltag heißt das: Nutzung während des Unterrichts, der Pausen und in bestimmten Bereichen regeln, Verwahrung sauber beschreiben, Ausnahmen schriftlich festhalten. Und dann vor allem — konsequent, aber nachvollziehbar durchsetzen. Ein Verbot, das nicht erklärt wird, produziert nur kreative Umgehungen.",
        "Die interessantere Frage steht ohnehin daneben: Wie viele Unterrichtsstunden Medienbildung sind im Schuljahr fest verankert? Solange die Antwort schwammig bleibt, bleibt auch die Handy-Debatte eine Symboldiskussion."
      ]
    },
    {
      slug: "heine-schule-sanierung",
      title: "Heine-Schule: Was der nächste Bauabschnitt bedeutet",
      teaser: "Ein denkmalgeschütztes Haus saniert man nicht en passant. Ein Blick auf Zeitplan, Ausweichräume und Lärmphasen.",
      category: "stadt",
      kicker: "Bauen",
      date: "2026-09-15",
      author: "Demo-Redaktion",
      readingMinutes: 4,
      featured: false,
      breaking: false,
      tags: ["Sanierung", "Standort", "Denkmalschutz"],
      body: [
        "Die 1883 errichtete Heine-Schule ist der zweite Standort des Campus Technicus und wird seit Jahren abschnittsweise saniert. Das Vorgehen in Etappen ist dem Bestand geschuldet: Ein komplett leerstehendes Haus gibt es nicht, also wird bei laufendem Betrieb gearbeitet.",
        "Der nächste Abschnitt betrifft vor allem Flure, Sanitärbereiche und die Anbindung der modernen Ergänzungsbauten an den Altbau. Für den Unterricht heißt das: Ausweichräume, verlegte Fachkabinette und einzelne Wochen mit deutlich hörbarer Bauakustik.",
        "Wer in dieser Zeit praktische Fächer unterrichtet, spürt es zuerst — Maschinen und Baustellenlärm vertragen sich schlecht. Die Fachbereiche planen deshalb mit Blocktagen statt Einzelstunden.",
        "Kritisch bleibt die Frage der Außenanlagen und der Sporthalle: Modernisierung und Sanierung sind das eine, die Nutzung in den Pausen und im Sportunterricht das andere. Ein Bauabschnitt, der den Sportbetrieb einschränkt, wird am Standort schnell zum Thema."
      ]
    },
    {
      slug: "schulbasketball-derby",
      title: "Basketball: Zwei Punkte Vorsprung im Stadtderby",
      teaser: "Ein Spiel, das in der letzten Minute kippt. Und ein Publikum, das mehr Lärm gemacht hat als jede Ansage.",
      category: "sport",
      kicker: "Spielbericht",
      date: "2026-09-14",
      author: "Demo-Redaktion",
      readingMinutes: 2,
      featured: false,
      breaking: false,
      tags: ["Basketball", "Turnier"],
      body: [
        "Das Derby der Schulmannschaften in der Zweifeldsporthalle endete mit zwei Punkten Unterschied — nach einem letzten Angriff, der genauso gut hätte danebengehen können.",
        "Über das Spiel selbst ist schnell erzählt: Der Campus lag zur Halbzeit hinten, kam über die Defensive zurück und hielt im letzten Viertel die Nerven. Entscheidend waren zwei Offensiv-Rebounds und eine Freiwurfquote, die diesmal tatsächlich über dem Trainingsmittel lag.",
        "Sportlich wichtiger als das Ergebnis ist die Kadertiefe. Mit drei Ausfällen in der Startaufstellung war das Team gezwungen, jüngere Jahrgänge früh einzusetzen — und die haben geliefert. Für die Rückserie ist der Kader damit deutlich breiter.",
        "Das nächste Heimspiel steht im Oktober an. Anpfiff ist nach der letzten Stunde, die Halle bleibt im Anschluss offen für Trainingsgruppen."
      ]
    },
    {
      slug: "schuelerfirma-insektenhotels",
      title: "Schülerfirma verkauft Insektenhotels — und lernt Buchhaltung dabei",
      teaser: "Produktidee gut, Kalkulation ernüchternd. Wie ein Kurs aus einer Werkstattaufgabe ein echtes Mini-Unternehmen macht.",
      category: "projekte",
      kicker: "Wirtschaft",
      date: "2026-09-12",
      author: "Demo-Redaktion",
      readingMinutes: 4,
      featured: true,
      breaking: false,
      tags: ["Schülerfirma", "Nachhaltigkeit", "Praxis"],
      body: [
        "Aus einer Werkstattaufgabe wurde ein Kurs, aus dem Kurs wurde eine Schülerfirma. Gebaut werden Insektenhotels aus Restholz — handwerklich anspruchsvoller, als das Ergebnis aussieht, denn es geht um Bohrlochdurchmesser, Tiefe und Splitterfreiheit.",
        "Die eigentliche Lektion kam nach dem Bauen. Materialkosten pro Stück, Arbeitszeit, Verpackung, ein Verkaufspreis, der im Schulumfeld akzeptiert wird: Die erste Kalkulation ging schief, das zweite Modell war zu teuer, die dritte Version trägt sich.",
        "Für die Schule hat das Projekt einen doppelten Effekt. Zum einen ein echtes Produkt, das es draußen auf den Markt schafft. Zum anderen Übungsfeld für Rechnungen, Lager, Gewährleistung und die unangenehme Frage, was passiert, wenn ein Kunde reklamiert.",
        "Ein Teil des Erlöses soll in die Werkstatt zurückfließen, ein Teil an ein regionales Naturschutzprojekt. Über die Aufteilung entscheidet der Kurs selbst — per Abstimmung, nicht per Ansage."
      ]
    },
    {
      slug: "mensa-veganes-angebot",
      title: "Mensa: Mehr vegane Linien, kürzere Wartezeiten",
      teaser: "Ab Oktober wird der Speiseplan umgestellt. Was sich ändert, was bleibt und was es kostet.",
      category: "schule",
      kicker: "Alltag",
      date: "2026-09-11",
      author: "Demo-Redaktion",
      readingMinutes: 3,
      featured: false,
      breaking: false,
      tags: ["Mensa", "Ernährung", "Preise"],
      body: [
        "Der Speiseplan bekommt eine feste vegane Linie an jedem Tag. Bislang war das Angebot tagesabhängig und damit unzuverlässig — ein Punkt, der vor allem von älteren Jahrgängen regelmäßig genannt wurde.",
        "Um die Wartezeiten zu verkürzen, wird die Ausgabe neu geordnet: zwei parallele Linien, eine Vorbestell-Option über die Klassen und ein Zeitfenster für die fünften und sechsten Klassen direkt nach der Doppelstunde.",
        "Preise bleiben in der Grundstufe stabil; für das vegane Gericht wird der gleiche Satz berechnet. Was teurer wird, sind einzelne Zusatzposten wie Getränke.",
        "Offen ist die Frage der Rückläufe. Eine Umstellung, die niemand misst, wird gern nach einem Halbjahr wieder zurückgedreht — deshalb soll quartalsweise ausgewertet werden, was tatsächlich gekauft wird."
      ]
    },
    {
      slug: "berufsdetektive-unterwegs",
      title: "Berufsdetektive wieder in der Stadt unterwegs",
      teaser: "Fünft- und Sechstklässler erkunden Betriebe in Bernburg — mit Auftrag, Notizblock und Erkennungszeichen.",
      category: "projekte",
      kicker: "Berufsorientierung",
      date: "2026-09-10",
      author: "Demo-Redaktion",
      readingMinutes: 3,
      featured: false,
      breaking: false,
      tags: ["Beruf", "Ganztag", "Region"],
      body: [
        "Berufsorientierung funktioniert selten am Whiteboard. Deshalb gehen die jüngsten Jahrgänge hinaus: Betriebe erkunden, Fragen stellen, Ergebnisse festhalten — und das Präsentieren üben.",
        "Der Ansatz ist bewusst niedrigschwellig. Es geht nicht darum, mit elf Jahren eine Berufsentscheidung zu treffen, sondern eine Vorstellung zu entwickeln, was Arbeit überhaupt bedeutet. Handwerk, Pflege, Logistik, Verwaltung, Industrie: Die Bandbreite in der Region ist größer, als die meisten erwarten.",
        "Rückmeldungen aus früheren Jahren zeigen vor allem einen Effekt: Die Hemmschwelle, fremde Erwachsene anzusprechen, sinkt spürbar. Das ist eine Fähigkeit, die im Praktikum drei Jahre später gebraucht wird.",
        "Für die beteiligten Betriebe ist der Aufwand real — eine Stunde Betreuung pro Gruppe. Genau deshalb funktioniert das Projekt nur, solange die Kooperationen gepflegt werden."
      ]
    },
    {
      slug: "kulturabend-aula",
      title: "Kulturabend: Musik, Theater und ein zu voller Aulatrakt",
      teaser: "Zwei Stunden Programm, drei Zugaben, ein Publikum, das stehen musste.",
      category: "kultur",
      kicker: "Bühne",
      date: "2026-09-09",
      author: "Demo-Redaktion",
      readingMinutes: 3,
      featured: false,
      breaking: false,
      tags: ["Musik", "Theater", "Aula"],
      body: [
        "Der Kulturabend hat in diesem Jahr mehr Menschen angezogen als Stühle vorhanden waren. Ein gutes Problem — mit einem klaren Fingerzeig auf die nächste Auflage: Einlass zwei Etappen, Programm um fünfzehn Minuten gestrafft.",
        "Geboten wurden Bläserklasse, Chor, eine Theater-Improvisation und zwei Solobeiträge aus der Oberstufe. Besonders die Improvisation zeigte, was passiert, wenn man Zwölfjährige ohne Text auf die Bühne lässt: Es funktioniert.",
        "Technisch lief es überraschend stabil. Licht und Ton kamen aus einer freiwilligen Technik-AG, die während der Generalprobe noch ein Mikrofonproblem gelöst hat — etwa zehn Minuten vor Einlass.",
        "Für das nächste Halbjahr ist ein kleineres Format im Gespräch: ein Abend mit drei Bühnen in verschiedenen Räumen, damit die Besucher sich bewegen statt stehen."
      ]
    },
    {
      slug: "tablet-pilotprojekt",
      title: "Tablets statt Kreide: Was ein Pilotprojekt in zwei Klassen zeigt",
      teaser: "Nach einem Halbjahr: klare Gewinne in Organisation, offene Fragen bei Konzentration und Ersatzgeräten.",
      category: "technik",
      kicker: "Digitalisierung",
      date: "2026-09-08",
      author: "Demo-Redaktion",
      readingMinutes: 5,
      featured: false,
      breaking: false,
      tags: ["Digital", "Unterricht", "Ausstattung"],
      body: [
        "Zwei Klassen arbeiten ein Halbjahr lang mit Leihgeräten. Das Ergebnis ist kein Wunder und keine Katastrophe, sondern ein Muster: Organisation profitiert, Aufmerksamkeit wird schwieriger.",
        "Deutlich besser geworden sind Abläufe — Aufgabenverteilung, Materialzugriff, Rückmeldung. Was früher per Kopie und Heft lief, ist jetzt ein Link. Bei Aufgaben mit selbstständigem Arbeiten fällt das am stärksten auf.",
        "Schwieriger ist die Aufmerksamkeit. Nicht weil die Geräte per se ablenken, sondern weil die Grenzen unklar waren: Wann darf das Tablet als Notizblock dienen, wann ist es Freizeitgerät? Regelklarheit schlägt technische Sperre.",
        "Der teuerste Punkt hat nichts mit Unterricht zu tun: Ersatz. Ein gebrochenes Display bedeutet Ausfall, wenn kein Pool existiert. Ohne Ersatzgeräte und eine kurze Reparaturkette bleibt jedes 1:1-Projekt eine halbe Lösung.",
        "Empfehlung des Pilotteams: vor einem Flächenrollout erst Support, Ladeinfrastruktur und Fortbildung klären — in dieser Reihenfolge."
      ]
    },
    {
      slug: "bibliothek-oeffnungszeiten",
      title: "Bibliothek öffnet länger — und sortiert neu",
      teaser: "Zwei zusätzliche Nachmittage und ein Bestand, der endlich wieder auffindbar ist.",
      category: "schule",
      kicker: "Service",
      date: "2026-09-05",
      author: "Demo-Redaktion",
      readingMinutes: 2,
      featured: false,
      breaking: false,
      tags: ["Bibliothek", "Lesen"],
      body: [
        "Die Schülerbibliothek öffnet künftig an zwei Nachmittagen zusätzlich. Die Ausleihe läuft weiter über die Klassen, Rückgaben sind aber auch direkt möglich.",
        "Parallel wurde der Bestand neu sortiert. Der Effekt klingt banal, ist aber der wichtigste: Was gefunden wird, wird gelesen. Vorher verschwanden ganze Regale in der Unübersichtlichkeit.",
        "Neu im Bestand sind außerdem Comics, Graphic Novels und ein Sachbuchregal für Referatsthemen. Wer Wünsche hat, kann sie auf einem Zettel im Aushang hinterlassen — das funktioniert erfahrungsgemäß."
      ]
    },
    {
      slug: "jugend-forscht-regionalrunde",
      title: "Jugend forscht: Vier Projekte für die Regionalrunde",
      teaser: "Von Wasserqualität in der Saale bis zu einem Bewässerungssensor aus Restteilen.",
      category: "technik",
      kicker: "Wettbewerb",
      date: "2026-09-03",
      author: "Demo-Redaktion",
      readingMinutes: 4,
      featured: false,
      breaking: true,
      tags: ["Wettbewerb", "Forschung", "MINT"],
      body: [
        "Vier Arbeiten gehen in die Regionalrunde. Thematisch reicht das Feld von einer Messreihe zur Wasserqualität an der Saale über einen Bewässerungssensor aus Restteilen bis zu einer Auswertung von Pausenzeiten.",
        "Auffällig ist die Qualität der Dokumentation. Genau da scheitern viele Wettbewerbsbeiträge: Die Idee ist stark, die Darstellung leider nicht. Dieses Jahr wurde die Schreibwerkstatt vorher verpflichtend verankert — der Unterschied ist sichtbar.",
        "Die Betreuung läuft über Fachlehrerinnen und Fachlehrer plus zwei externe Mentorinnen. Für die Vorbereitung gibt es feste Termine am Nachmittag, weil ein Wettbewerbsbeitrag ohne Zeitfenster in der Woche nicht fertig wird.",
        "Die Regionalrunde findet im Frühjahr statt. Wer mitfahren will, sollte sich früh anmelden: Die Plätze für die Betreuung sind begrenzt, nicht das Interesse."
      ]
    }
  ]
};
