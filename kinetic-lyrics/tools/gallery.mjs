// Pages to scroll through what the engine can do, each demo a small HyperFrames project in its
// own HyperFrames player: the word effects and exits, the backgrounds (worlds and moods), and
// the accents (notes, marker, charts, layouts, concepts with their world motif).
//
//   node tools/gallery.mjs [--port 8092] [--rebuild] [--no-serve]
//
// Builds gallery/<id>/ for each demo (again only when the engine or the tools changed
// since, or with --rebuild), writes the pages into gallery/ and serves them with the
// HyperFrames runtime and player of the `hyperframes` on the PATH. A player is only
// mounted while its card is on screen: every demo runs its own world.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "gallery");
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const PORT = Number(argv[argv.indexOf("--port") + 1]) || (flag("--port") ? 0 : 8092);

// A demo: [id, name, what it does, the line (the word in [brackets] carries it), how it is set].
// set: fx, concept, note, viz (on that word, in the transcript); mark, chart, world, mood,
// layout, exit, minor: false (in the staging; by default every other word is minor, so the
// one word stands out); preset; still (seconds after the word to rest on); tail (seconds after
// the last word: 2, an exit demo 1.2).
const AFTER = "Und weiter geht's";
const fx = (name, what, text, set = {}) => [name, name, what, text, { fx: name, ...set }];

const WORDS = [
  fx("rise", "Die Buchstaben steigen wie losgelassene Ballons auf, jeder in seinem Tempo, leicht schwankend", "Ballons [schweben] davon"),
  fx("drop", "Die Buchstaben fallen schwer von oben und federn beim Aufprall nach", "Dann [fällt] der Groschen"),
  fx("flicker", "Die Buchstaben fangen von unten Feuer und züngeln warm weiter", "Wir sitzen am [Lagerfeuer]"),
  fx("glow", "Helles Aufleuchten, das abklingt", "Eine [brillante] Idee"),
  fx("sparkle", "Buchstaben ploppen mit kleinen Sternen auf", "Das war einfach [magisch]"),
  fx("fog", "Große Buchstaben tauchen einzeln aus treibendem Nebel auf, erst grau", "Alles liegt im [Nebel]"),
  fx("whisper", "Klein, leise, kursiv: die Buchstaben werden nacheinander eingehaucht, ohne Glühen", "Sie [flüstert] mir zu"),
  fx("slam", "Riesiger Einschlag mit Wackeln", "Und dann der [Knall]"),
  fx("glitch", "Digitales Zittern, RGB-Versatz", "Das System ist [abgestürzt]"),
  fx("wave", "Eine Welle läuft immer wieder durch das Wort", "Die [Wellen] am Meer"),
  fx("spin", "3D-Drehung", "Alles [dreht] sich"),
  fx("pulse", "Herzschlag", "Mein [Herz] rast"),
  fx("shatter", "Buchstaben zerspringen", "Der Spiegel [zerbricht]"),
  fx("flash", "Neonröhren zünden stotternd, Buchstabe für Buchstabe; später summt einer kurz aus", "Dann geht das [Licht] an"),
  fx("streak", "Schießt mit Bewegungsunschärfe herein", "Sie rennt [blitzschnell] los"),
  fx("count", "Die Zahl zählt hoch (Zahlwörter)", "Das kostet [500] Euro"),
  fx("blink", "Öffnet sich wie ein Auge und blinzelt einmal", "Ich [sehe] alles"),
  fx("redact", "Erscheint unter einem Zensurbalken, der weggezogen wird", "Das ist streng [geheim]"),
  fx("bounce", "Die Buchstaben springen nacheinander von der Linie hoch und landen gestaucht; ab und zu hüpft einer nach", "Der Welpe [hüpft] herum"),
  fx("depth", "Steigt flach liegend aus der Tiefe auf und richtet sich auf", "Aus der [Tiefe] des Raums"),
  fx("blur", "Wird aus starker Unschärfe scharf", "Langsam wird es [klar]"),
  fx("grow", "Wächst aus einem Keim an der Grundlinie auf volle Größe und wächst langsam weiter (auch das Konzept growth)", "Unser Umsatz [wächst] weiter"),
  fx("shrink", "Erscheint in voller Größe und schrumpft in zwei Stufen zusammen", "Die Kosten [schrumpfen] jedes Jahr"),
  fx("type", "Wird Buchstabe für Buchstabe hinter einem blinkenden Cursor getippt", "Ich schreibe eine [Nachricht]"),
  fx("scramble", "Zufällige Zeichen rattern durch jeden Buchstaben, bis er von links nach rechts einrastet", "Das [Passwort] ist geknackt"),
  fx("tremble", "Die Buchstaben zittern dauerhaft, jeder für sich", "Ich hatte richtig [Angst]"),
  fx("assemble", "Die Buchstaben fliegen von überall her zusammen und rasten mit einem kleinen Klick ein", "Wir sind ein [Team]"),
  fx("freeze", "Frost kriecht über das Wort: die Buchstaben werden eisig, Kristalle wachsen an den Rändern, ein kurzes Knacken", "Mir ist [eiskalt] geworden", { still: 1.3 }),
  fx("echo", "Blasse Kopien des Worts hallen nach und verklingen, immer wieder", "Und das [immer] wieder"),
  fx("window", "Das Wort teilt sich beim nächsten Wort in der Mitte und schwingt wie zwei Fensterflügel auf, Licht fällt durch den Spalt", "Ich mache das [Fenster] auf", { still: 1.3 }),
];
// what the engine sets by itself: the plain entrance and the one for no time
const ENGINE = [
  fx("mask", "Standard für jedes Wort ohne eigenen Effekt: die Buchstaben gleiten aus einer Maske herein", "Die [Worte] gleiten herein"),
  fx("snap", "Sehr schneller, kurzer Einstieg", "[Zack], und fertig"),
];
// the first phrase leaves with the exit, the second shows what follows
const exit = (name, what, text) => [`exit-${name}`, name, what, text, { exit: name }];
const EXITS = [
  exit("lift", "Standard: die Buchstaben steigen nach oben hinaus", "Die Worte steigen hinaus"),
  exit("zoom", "Fliegt durch die Kamera", "Mitten durch die Kamera"),
  exit("blur", "Löst sich in Unschärfe auf", "Und alles löst sich auf"),
  exit("scatter", "Die Wörter treiben auseinander", "Alles treibt auseinander"),
  exit("burn", "Eine Lunte läuft durch die Buchstaben: sie glühen, verkohlen, zerfallen zu Asche, Glut steigt auf", "Alle Brücken sind verbrannt"),
  exit("fall", "Die Schwerkraft übernimmt: die Buchstaben fallen einzeln und trudelnd aus dem Bild", "Und dann ist alles eingestürzt"),
  exit("mow", "Ein Rasenmäher mäht die Buchstaben bis auf die Stoppeln ab, Zeile für Zeile", "Wer will den Rasen mähen?"),
];

const world = (name, what, text) => [`world-${name}`, name, what, text, { world: name }];
const WORLDS = [
  world("cosmos", "Nachthimmel, Nebel und Sterne: Träume, Sehnsucht, Nacht, Weltraum, große Gefühle", "Wir sind aus [Sternenstaub]"),
  world("aurora", "Fließende, kräftige Farbfelder, weiches Licht: Lifestyle, Motivation, gute Laune", "Heute fängt etwas [Neues] an"),
  world("editorial", "Papier und Tinte, heller Grund, dunkle Schrift: Business, Bildung, Interviews, Analyse", "Die Zahlen sprechen [Klartext]"),
  world("geometry", "Helles Studio mit matten Formen und weichen Schatten: Tech, Produkt, Design, Erklärungen", "So funktioniert das [Produkt]"),
  world("bokeh", "Warme, unscharfe Lichter im Dunkeln, filmisch: Menschen, Beziehungen, Gesundheit, Comedy", "Ein Abend mit [Freunden]"),
  world("neon", "Leuchtendes Perspektivraster mit Lichtstreifen: Tech, Gaming, Sport, Geschwindigkeit, Zukunft", "Volle Kraft [voraus]"),
  world("noir", "Dunkler Raum, schräges Licht durch Jalousien, Staub im Licht: Krimi, Geheimnisse, Geschichte, Psychologie", "Niemand kannte die [Wahrheit]"),
];
const mood = (name, what, text) => [`mood-${name}`, name, what, text, { mood: name }];
const MOODS = [
  mood("night", "Tiefes, neutrales Blau", "Spät in der [Nacht]"),
  mood("dark", "Entsättigtes Grau", "Alles ist so [grau]"),
  mood("dawn", "Pfirsich und Violett, Hoffnung", "Ein neuer [Morgen]"),
  mood("electric", "Cyan und Magenta, Energie", "Volle [Energie]"),
  mood("cool", "Eisiges Blau, Traurigkeit", "Kalt und [traurig]"),
  mood("ocean", "Petrol, Ruhe", "Ruhig wie das [Meer]"),
  mood("violet", "Verträumt, Zeit", "Zeit zum [Träumen]"),
  mood("rose", "Liebe, Zärtlichkeit", "Ich [liebe] dich"),
  mood("ember", "Feuer, Wut, Leidenschaft", "Voller [Wut]"),
  mood("gold", "Licht, Triumph", "Wir haben [gewonnen]"),
];

const NOTES = [
  ["note-circle", "circle", "Von Hand eingekreist: der Schlüsselbegriff, das überraschende Wort", "Das ist der [Schlüssel]", { note: "circle" }],
  ["note-underline", "underline", "Von Hand unterstrichen: eine Aussage, die hängen bleiben soll", "Das ändert [alles]", { note: "underline" }],
  ["note-strike", "strike", "Durchgestrichen: nur was der Sprecher ausdrücklich verwirft", "Nicht [Glück], sondern Arbeit", { note: "strike" }],
  ["mark", "mark", "Marker: ein Leuchtstift-Balken fährt beim Sprechen unter das Wort (Podcast und Social)", "Das ist der [entscheidende] Punkt", { mark: true, preset: "podcast" }],
];
const chart = (name, what, text, c, id = `chart-${name}`) => [id, name, what, text, { chart: { kind: name, value: 0, ...c }, still: 1.6, tail: 3 }];
const P2 = (a, b) => [{ label: a, value: 0 }, { label: b, value: 0 }];
const CHARTS = [
  chart("gauge", "Ein Anteil füllt einen Balken", "Wir sparen [40%] unserer Woche", { value: 40 }),
  chart("compare", "Vorher-nachher-Balken mit dem Faktor", "Der Umsatz hat sich [verdreifacht]", { value: 3 }),
  chart("growth", "Eine Kurve, die sich über die Zeit nach oben biegt, gegen die gerade Linie", "Nach dreißig Jahren sind es [200.000] Euro", { value: 200000, base: 60000, label: "30 Jahre", unit: "€" }),
  chart("split", "Ein Balken, in die Teile eines Ganzen geteilt", "Davon sind [140.000] Euro Zinsen", { value: 140000, parts: [{ label: "eingezahlt", value: 60000 }, { label: "Zinsen", value: 140000 }], focus: 1 }),
  ["units-person", "units", "Piktogramme für kleine Mengen: Menschen, Tage, Minuten", "Wir waren ein Team aus [sechs] Leuten", { viz: { kind: "units", value: 6, icon: "person" }, still: 1.6, tail: 3 }],
  chart("clock", "Ein Zifferblatt, die Zeiger drehen sich auf die Uhrzeit", "Der Wecker klingelt [halb] sechs", { value: 5.5 }),
  chart("clock", "Mit Einheit min oder h eine Dauer: ein Stück des Zifferblatts füllt sich", "Ich trainiere [45] Minuten", { value: 45, unit: "min" }, "chart-clock-duration"),
  chart("calendar", "Ein Kalenderblatt, die Zahl blättert hoch, das letzte Blatt reißt ab", "Seit [dreißig] Tagen kein Zucker", { value: 30, label: "Tage" }),
  chart("countdown", "Ein Ring läuft um die Zahl herum ab", "Nur noch [drei] Tage", { value: 3, unit: "Tage" }),
  chart("timeline", "Eine Zeitleiste, die Jahre setzen nacheinander ihre Punkte", "[2015] gegründet, 2020 verkauft", { parts: [{ label: "gegründet", value: 2015 }, { label: "verkauft", value: 2020 }], focus: 0 }),
  chart("timeline", "Bis zu fünf Stationen: die Linie läuft durch, jede Station setzt ihren Punkt, die besprochene leuchtet", "Von der Garage bis zum [Börsengang]", { parts: [{ label: "Garage", value: 2004 }, { label: "Erste Kunden", value: 2007 }, { label: "Weltweit", value: 2012 }, { label: "Börsengang", value: 2019 }], focus: 3 }, "chart-timeline-4"),
  chart("route", "Eine Linie von Ort zu Ort, ein Punkt reist mit, die Entfernung zählt mit", "Von Berlin nach [München]", { value: 585, unit: "km", parts: P2("Berlin", "München") }),
  chart("speed", "Ein Tacho, die Nadel schnellt auf den Wert und zittert nach", "Mit [200] Sachen über die Autobahn", { value: 200, base: 260, unit: "km/h" }),
  chart("temperature", "Ein Thermometer steigt, kalt blau, heiß rot", "Draußen sind [40] Grad", { value: 40 }),
  chart("temperature", "Kalt: unter 5 °C bleibt die Säule blau", "Heute Nacht [minus] zehn Grad", { value: -10 }, "chart-temperature-cold"),
  chart("temperature", "Fahrenheit mit unit F: angezeigt in °F, Füllstand und Farbe nach Celsius", "In Texas sind es [100] Grad Fahrenheit", { value: 100, unit: "F" }, "chart-temperature-f"),
  chart("rank", "Ein Treppchen baut sich auf, der Platz leuchtet", "Wir sind auf Platz [zwei]", { value: 2, label: "Wir" }),
  chart("rank", "Ab Platz 4 eine Rangliste: sie rollt bis zum Platz und bleibt hervorgehoben stehen", "Am Ende wurden wir [Zehnter]", { value: 10, label: "Wir" }, "chart-rank-10"),
  chart("ratio", "Eine Reihe Menschen, einige leuchten auf", "[Jeder] Fünfte hört auf", { value: 1, base: 5 }),
  chart("ratio", "Anteilig: bei 2,5 von 10 ist die dritte Person halb gefüllt", "Nur [zweieinhalb] von zehn Bewerbern", { value: 2.5, base: 10 }, "chart-ratio-part"),
  chart("rating", "Sterne füllen sich, auch zum Teil", "Vier Komma [acht] Sterne", { value: 4.8, base: 5 }),
  chart("trend", "Ein Pfeil schießt nach oben (oder unten), die Prozentzahl dazu", "Der Umsatz ist um [20] Prozent gestiegen", { value: 20 }),
  chart("battery", "Eine Batterie lädt oder läuft leer, die letzte Zelle blinkt rot", "Mein Akku ist [leer]", { value: 10 }),
  chart("pie", "Ein Ring füllt sich auf den Anteil", "Ein [Drittel] aller Kunden", { value: 33 }),
];
const TOPICS = [
  chart("versus", "Zwei Begriffe fliegen von links und rechts herein, dazwischen knallt ein VS", "Angestellt oder [selbstständig]?", { parts: P2("Angestellt", "Selbstständig") }),
  chart("cause", "Ein Pfeil zieht sich von der Ursache zur Folge, die Folge schlägt auf", "Zu wenig Schlaf macht [krank]", { parts: P2("Wenig Schlaf", "Krank") }),
  chart("cycle", "Begriffe auf einem Kreis, Pfeile führen von einem zum nächsten, ein Punkt läuft immer weiter", "Stress, schlechter Schlaf, noch mehr [Stress]", { parts: [{ label: "Stress", value: 0 }, { label: "Schlechter Schlaf", value: 0 }, { label: "Müdigkeit", value: 0 }] }),
  chart("steps", "Stufen bauen sich auf, ein Punkt hüpft bis zur Stufe, um die es geht", "Erst lernen, dann üben, dann [können]", { parts: [{ label: "Lernen", value: 0 }, { label: "Üben", value: 0 }, { label: "Können", value: 0 }], focus: 2 }),
  chart("balance", "Eine Waage pendelt und neigt sich zur schwereren Seite", "Arbeit und Leben in [Balance]", { parts: [{ label: "Arbeit", value: 3 }, { label: "Leben", value: 2 }] }),
  chart("overlap", "Zwei Kreise gleiten ineinander, die Schnittmenge leuchtet", "Wo Talent auf Fleiß [trifft]", { parts: P2("Talent", "Fleiß"), label: "Erfolg" }),
  chart("fork", "Ein Weg teilt sich, der gewählte leuchtet", "Ich stand am [Scheideweg]", { parts: P2("Bleiben", "Gehen"), focus: 1 }),
  chart("said", "Eine Sprechblase ploppt auf, darunter wer es gesagt hat", "Mein Chef [meinte] nur", { label: "Mach einfach", unit: "Chef" }),
  chart("thought", "Eine Gedankenblase steigt auf", "Ich dachte mir [insgeheim]", { label: "Das schaffe ich" }),
  chart("verdict", "Ein großes Häkchen (value 1) oder Kreuz (value 0) wie ein Stempel", "Das ist ein [Mythos]", { value: 0, label: "Mythos" }),
  chart("warning", "Ein Warndreieck blinkt zweimal auf", "[Vorsicht] bei solchen Angeboten", { label: "Achtung" }),
  chart("notify", "Eine Handy-Benachrichtigung rutscht herein und vibriert", "Dann kam die [Nachricht]", { unit: "Chef", label: "Können wir kurz reden?" }),
  chart("target", "Ein Pfeil trifft die Mitte der Zielscheibe", "Wir haben unser [Ziel] getroffen", { label: "Ziel" }),
  chart("lock", "Ein Schloss schnappt zu (value 1) oder springt auf (value 0)", "Deine Daten sind [sicher]", { value: 1, label: "Sicher" }),
  chart("search", "Eine Suchleiste, der Suchbegriff wird eingetippt", "Ich habe das [gegoogelt]", { label: "Rasen mähen Sonntag" }),
  chart("puzzle", "Zwei Puzzleteile schieben sich zusammen und rasten ein", "Endlich passt alles [zusammen]", { parts: P2("Idee", "Team") }),
  chart("summit", "Ein Berg zeichnet sich, oben geht eine Fahne hoch", "Wir haben es [geschafft]", { label: "Geschafft" }),
  chart("place", "Ein Pin fällt auf die Karte, eine Welle läuft aus", "Das war in [Berlin]", { label: "Berlin" }),
];
// every word a content word here: split needs two of them
const layout = (name, what, text, set = {}) => [`layout-${name}`, name, what, text, { layout: name, minor: false, ...set }];
const LAYOUTS = [
  layout("hero", "Ein riesiges Wort, der Rest klein darum", "Das ist [unglaublich] gut"),
  layout("block", "Gestapelte Zeilen im Blocksatz", "Wir haben das [ganze] Team umgebaut"),
  layout("cascade", "Treppenförmig versetzte Zeilen", "Es ging Stufe für Stufe [bergab]"),
  layout("inline", "Eine oder zwei Zeilen, für längere Phrasen (im Hochformat bis vier Wörter)", "Die beste [Entscheidung] überhaupt"),
  layout("split", "Zwei Hälften in gegenüberliegenden Ecken", "Vorher [langsam] nachher schnell"),
  layout("list", "Eine Checkliste: jeder Punkt bekommt eine Zeile und ein Häkchen, wenn er gesprochen wird", "Berichte, Tickets, erste [Entwürfe]", { still: 1.4 }),
];
const motif = (concept, motifName, what, text) => [`motif-${concept}`, concept, `${what} – Weltmotiv: ${motifName}`, text, { concept }];
const MOTIFS = [
  motif("rise", "aufsteigende Teilchen", "Aufsteigen, fliegen, schweben", "Wir [steigen] auf"),
  motif("rain", "Regenschlieren", "Regen, Sturm, weinen", "Draußen [regnet] es"),
  motif("fire", "Glut", "Feuer, brennen, Hitze", "Alles [brennt]"),
  motif("light", "Sonne mit Strahlen", "Licht, Sonne, hell", "Die [Sonne] geht auf"),
  motif("stars", "Sternenfeld", "Sterne, Weltall, Kosmos", "Ein Meer aus [Sternen]"),
  motif("dark", "Nebel, entsättigt", "Dunkel, Nacht, allein, leer", "Allein in der [Dunkelheit]"),
  motif("loud", "Druckwelle, Kamerawackeln", "Laut, schreien, riesig", "Ein lauter [Schrei]"),
  motif("electric", "Blitze", "Strom, Energie, Donner", "Voller [Energie]"),
  motif("water", "Ozean aus Punkten", "Wasser, Meer, Fluss", "Das weite [Meer]"),
  motif("time", "Ringe wie ein Gyroskop", "Zeit, Uhr, immer wieder", "Die [Zeit] läuft"),
  motif("world", "Planet aus Punkten", "Welt, Erde, Zuhause", "Die ganze [Welt]"),
  motif("love", "doppelte Pulsringe", "Liebe, Herz, zusammen", "Mein [Herz] gehört dir"),
  motif("break", "Glassplitter", "Brechen, Scherben, kaputt", "Das Glas [zerbricht]"),
  motif("city", "Neonraster und Skyline", "Stadt, Straße, Lichter", "Die [Stadt] bei Nacht"),
  motif("speed", "Warp-Streifen", "Schnell, rennen, Tempo", "Mit voller [Geschwindigkeit]"),
  motif("growth", "Kurve", "Wachstum, mehr, steigern", "Das Geschäft [wächst]"),
  motif("tech", "Netzwerk", "Daten, Software, Code, Maschinen", "Die [Software] lernt"),
  motif("sky", "Wolken", "Himmel, Wolken, Wind, frei", "Über den [Wolken]"),
];

// the same graphics with long words: how they hold up
const LONG = [
  chart("search", "Ein langer Suchbegriff", "Ich habe das [gegoogelt]", { label: "Darf man in Deutschland am Sonntag eigentlich Rasen mähen" }, "long-search"),
  chart("said", "Ein langes Zitat", "Mein Chef [meinte] nur", { label: "Das machen wir jetzt einfach mal so und schauen dann", unit: "Chef" }, "long-said"),
  chart("thought", "Ein langer Gedanke", "Ich dachte mir [insgeheim]", { label: "Das schaffe ich niemals bis Freitag" }, "long-thought"),
  chart("notify", "Eine lange Nachricht", "Dann kam die [Nachricht]", { unit: "Personalabteilung", label: "Bitte kommen Sie morgen um neun Uhr in mein Büro" }, "long-notify"),
  chart("versus", "Lange Begriffe gegeneinander", "[Festanstellung] oder Selbstständigkeit?", { parts: P2("Unbefristete Festanstellung", "Selbstständigkeit") }, "long-versus"),
  chart("steps", "Lange Stufen", "Vom Praktikum zur [Geschäftsführung]", { parts: [{ label: "Praktikum", value: 0 }, { label: "Projektleitung", value: 0 }, { label: "Abteilungsleitung", value: 0 }, { label: "Geschäftsführung", value: 0 }], focus: 3 }, "long-steps"),
  chart("place", "Ein langer Ortsname", "Das war in [Garmisch-Partenkirchen]", { label: "Garmisch-Partenkirchen" }, "long-place"),
  chart("timeline", "Lange Stationen", "Von der Gründung bis zum [Börsengang]", { parts: [{ label: "Gründung in der Garage", value: 2004 }, { label: "Internationale Expansion", value: 2012 }, { label: "Börsengang in New York", value: 2019 }], focus: 2 }, "long-timeline"),
];

const PAGES = [
  { file: "index.html", nav: "Wörter", title: "Wort-Effekte und Abgänge", sections: [
    { title: "Wort-Effekte", note: "Die Regie (und der Chat-Agent) wählt sie im Staging als fx.", demos: WORDS },
    { title: "Nur in der Engine", note: "Die Engine setzt sie selbst: mask ist der normale Einstieg, snap die Notlösung, wenn für einen Effekt keine Zeit bleibt.", demos: ENGINE },
    { title: "Abgänge", note: "Wie eine ganze Phrase geht: exit im Staging.", demos: EXITS },
  ] },
  { file: "welten.html", nav: "Hintergründe", title: "Welten und Stimmungen", sections: [
    { title: "Welten", note: "Die Bühne des ganzen Videos: world im Staging, eine pro Video. Über Footage werden helle Welten ersetzt (editorial durch bokeh, geometry durch neon).", demos: WORLDS },
    { title: "Stimmungen", note: "Die Farbpalette einer Phrase: mood im Staging. Hier alle in der Welt aurora.", demos: MOODS },
  ] },
  { file: "akzente.html", nav: "Akzente", title: "Anmerkungen, Grafiken, Layouts, Konzepte", sections: [
    { title: "Anmerkungen und Marker", note: "Von Hand gezeichnet auf ein Wort: notes im Staging; der Marker (mark) nur in den Presets podcast und social.", demos: NOTES },
    { title: "Grafiken: Zahlen", note: "Eine Grafik unter der Phrase, die zeigt, was eine Zahl bedeutet: charts im Staging; Prozente, Faktoren und kleine Mengen erkennt die Engine auch selbst.", demos: CHARTS },
    { title: "Grafiken: Themen", note: "Bilder für den Aufbau eines Arguments, Momente im Gespräch und Sinnbilder: ebenfalls charts im Staging, value 0 wo keine Zahl gemeint ist.", demos: TOPICS },
    { title: "Lange Texte", note: "Dieselben Grafiken mit langen Begriffen: wie sie damit umgehen.", demos: LONG },
    { title: "Layouts", note: "Wie eine Phrase gesetzt wird: layout im Staging.", demos: LAYOUTS },
    { title: "Konzepte", note: "Ein Konzept auf einem Wort bringt seinen Wort-Effekt und ein Motiv in die Welt: concept im Staging.", demos: MOTIFS },
  ] },
];

const STEP = 0.38, WORD = 0.32, START = 0.4;

function timed(texts, t0) {
  return texts.map((text, k) => ({ text, start: +(t0 + k * STEP).toFixed(3), end: +(t0 + k * STEP + WORD).toFixed(3), concept: null }));
}

const heroOf = (text) => Math.max(0, text.split(" ").findIndex((w) => w.startsWith("[")));

// transcript and staging of one demo
function demo([, , , text, set]) {
  const a = text.split(" ").map((w) => w.replace(/[[\]]/g, ""));
  const hero = set.exit ? a.length - 1 : heroOf(text);
  const words = [...timed(a, START), ...(set.exit ? timed(AFTER.split(" "), START + a.length * STEP + 1.4) : [])];
  Object.assign(words[hero], { emphasis: 0.9, hero: true });
  for (const k of ["fx", "concept", "note", "viz"]) if (set[k]) words[hero][k] = set[k];
  if (set.mark) words[hero].fx = "mask"; // the marker alone, without the staged word's effect
  const phrase = (first, last, h, exit, lay = "inline") => ({
    first, last, hero: h, minor: set.minor === false ? [] : [...Array(last - first + 1).keys()].map((k) => first + k).filter((i) => i !== h),
    mood: set.mood || "dawn", layout: lay, exit,
  });
  const phrases = [phrase(0, a.length - 1, hero, set.exit || "lift", set.layout)];
  if (set.exit) phrases.push(phrase(a.length, words.length - 1, words.length - 1, "lift"));
  const staging = {
    hook: "", world: set.world || "aurora", phrases,
    words: set.mark ? [{ i: hero, concept: "idea", fx: "glow", emphasis: 0.9, mark: true }] : [],
    notes: [], quotes: [],
    charts: set.chart ? [{ i: hero, base: null, parts: [], focus: null, label: "", unit: "", ...set.chart }] : [],
  };
  return { words, staging };
}

// the moment a card shows while it is not played: the effect done, the phrase still there
function still([, , , text, set]) {
  const n = text.split(" ").length;
  if (set.exit) return +(START + (n - 1) * STEP + 0.6).toFixed(2);
  return +(START + heroOf(text) * STEP + (set.still ?? 1.0)).toFixed(2);
}

// ---------------------------------------------------------------- build
function newest(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
    const p = path.join(dir, e.name);
    return Math.max(m, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }, 0);
}

async function buildAll() {
  const sources = Math.max(newest(path.join(ROOT, "engine")), newest(path.join(ROOT, "tools")));
  const jobs = [];
  for (const d of PAGES.flatMap((p) => p.sections.flatMap((s) => s.demos))) {
    const [id, , , , set] = d;
    const dir = path.join(OUT, id);
    const done = path.join(dir, "index.html");
    if (!flag("--rebuild") && fs.existsSync(done) && fs.statSync(done).mtimeMs > sources) continue;
    const src = path.join(dir, "source");
    fs.mkdirSync(src, { recursive: true });
    const { words, staging } = demo(d);
    fs.writeFileSync(path.join(src, "transcript.json"), JSON.stringify(words, null, 1));
    fs.writeFileSync(path.join(src, "staging.json"), JSON.stringify(staging, null, 1));
    jobs.push({ name: id, args: [path.join(ROOT, "tools", "build.mjs"), path.join(src, "transcript.json"),
      ...(set.preset ? ["--preset", set.preset] : []),
      "--aspect", "9:16", "--size", "720x1280", "--tail", String(set.tail ?? (set.exit ? 1.2 : 2)), "--staging", path.join(src, "staging.json"), "--out", dir] });
  }
  if (!jobs.length) return console.log("gallery: every demo is up to date");
  console.log(`gallery: building ${jobs.length} demos`);
  let failed = 0;
  const run = ({ name, args }) => new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("close", (code) => {
      if (code) { failed++; console.log(`  ✗ ${name}\n${log.trim().split("\n").slice(-6).join("\n")}`); }
      else console.log(`  ✓ ${name}`);
      resolve();
    });
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
  if (failed) process.exitCode = 1;
}

// ---------------------------------------------------------------- page
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(pg) {
  const card = (d) => {
    const [id, name, what, text, set] = d;
    const line = set.exit
      ? `<b>${esc(text)}</b> → ${esc(AFTER)}`
      : esc(text).replace(/\[([^\]]+)\]/, "<b>$1</b>");
    return `<article class="card" id="${id}">
      <div class="stage" data-src="${id}/index.html" data-still="${still(d)}"><span class="hint">${esc(name)}</span></div>
      <h3><code>${esc(name)}</code></h3><p>${esc(what)}</p><p class="ex">„${line}“</p></article>`;
  };
  const tabs = PAGES.map((p) => `<a href="${p.file === "index.html" ? "./" : p.file}"${p === pg ? ' aria-current="page"' : ""}>${p.nav}</a>`).join("");
  const nav = pg.sections.flatMap((s) => s.demos.map(([id, name]) => `<a href="#${id}">${esc(name)}</a>`)).join("");
  const sections = pg.sections.map((s) => `<section><h2>${s.title}</h2><p class="note">${s.note}</p>
    <div class="grid">${s.demos.map(card).join("")}</div></section>`).join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kinetic ${pg.nav}</title>
<style>
:root { --bg: #0d0f14; --card: #161a22; --line: #262c38; --ink: #eef1f6; --dim: #9aa3b2; --accent: #ffd27a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line); padding: 12px 16px; }
header .top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; margin-bottom: 8px; }
header h1 { margin: 0; font-size: 18px; }
header small { color: var(--dim); font-size: 13px; }
.tabs { display: flex; gap: 4px; }
.tabs a { color: var(--dim); text-decoration: none; font-size: 14px; padding: 3px 10px; border-radius: 8px; }
.tabs a:hover { color: var(--ink); background: var(--card); }
.tabs a[aria-current] { color: var(--bg); background: var(--accent); font-weight: 600; }
nav { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
nav a { flex: none; color: var(--dim); text-decoration: none; font: 12px ui-monospace, monospace; padding: 3px 8px; border: 1px solid var(--line); border-radius: 99px; }
nav a:hover { color: var(--ink); border-color: var(--dim); }
main { max-width: 1400px; margin: 0 auto; padding: 8px 16px 64px; }
h2 { margin: 28px 0 2px; font-size: 20px; }
.note { margin: 0 0 14px; color: var(--dim); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; scroll-margin-top: 110px; }
.card:target { outline: 2px solid var(--accent); }
.stage { position: relative; aspect-ratio: 9 / 16; background: #000; display: grid; place-items: center; }
.stage hyperframes-player { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
.card { cursor: pointer; transition: border-color .15s; }
.card.playing { border-color: var(--accent); }
.hint { color: #333a48; font: 600 22px ui-monospace, monospace; }
.card h3 { margin: 10px 12px 2px; font-size: 16px; }
.card h3 code { color: var(--accent); }
.card p { margin: 0 12px 4px; color: var(--dim); font-size: 13px; }
.card p.ex { margin-bottom: 12px; color: var(--ink); }
</style>
<script src="vendor/hyperframes-player.js"></script></head><body>
<header><div class="top"><h1>Kinetic – ${pg.title}</h1><div class="tabs">${tabs}</div><small>Maus über eine Karte spielt sie ab</small></div><nav>${nav}</nav></header>
<main>${sections}</main>
<script>
// a player only while its card is near the screen: each demo runs its own world.
// It rests on its still frame and plays from the start while the pointer is over the card.
const show = (stage) => {
  const p = stage.querySelector("hyperframes-player");
  if (!p || !p.dataset.ready) return;
  if (stage.closest(".card").classList.contains("playing")) { p.seek(0); p.play(); }
  else { p.pause(); p.seek(Number(stage.dataset.still)); }
};
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const stage = e.target, player = stage.querySelector("hyperframes-player");
    if (e.isIntersecting && !player) {
      const p = document.createElement("hyperframes-player");
      for (const a of ["loop", "muted"]) p.setAttribute(a, "");
      p.addEventListener("ready", () => { p.dataset.ready = "1"; show(stage); }, { once: true });
      p.setAttribute("src", stage.dataset.src);
      stage.append(p);
    } else if (!e.isIntersecting && player) player.remove();
  }
}, { rootMargin: "150px 0px" });
for (const card of document.querySelectorAll(".card")) {
  const stage = card.querySelector(".stage");
  io.observe(stage);
  const set = (on) => { card.classList.toggle("playing", on); show(stage); };
  card.addEventListener("mouseenter", () => set(true));
  card.addEventListener("mouseleave", () => set(false));
  // touch screens have no hover: a tap plays, the next one stops
  card.addEventListener("click", (ev) => { if (ev.pointerType !== "mouse") set(!card.classList.contains("playing")); });
}
</script></body></html>`;
}

// ---------------------------------------------------------------- serve
function hyperframesModules() {
  const bin = spawnSync("sh", ["-c", "readlink -f \"$(command -v hyperframes)\""], { encoding: "utf8" }).stdout.trim();
  for (let d = bin; d && d !== path.dirname(d); d = path.dirname(d)) if (path.basename(d) === "node_modules") return d;
  return null;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
  ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg" };

// the composition page for the player: the timeline registry and the runtime in the head
const withRuntime = (html) => html.includes("hyperframes-runtime.js") ? html
  : html.replace(/<head[^>]*>/i, (m) => `${m}<script>window.__timelines = window.__timelines || {};</script><script src="/vendor/hyperframes-runtime.js"></script>`);

const PAGE_FILES = new Set(PAGES.map((p) => p.file));

function serve() {
  const nm = hyperframesModules();
  if (!nm) console.log("gallery: hyperframes is not on the PATH – the players need its runtime");
  const vendor = nm && {
    "/vendor/hyperframes-player.js": path.join(nm, "@hyperframes/player/dist/hyperframes-player.global.js"),
    "/vendor/hyperframes-runtime.js": path.join(nm, "hyperframes/dist/hyperframe.runtime.iife.js"),
  };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = vendor?.[url] ?? path.join(OUT, url === "/" ? "index.html" : url);
    if (!vendor?.[url] && !file.startsWith(OUT + path.sep)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404).end("not found"); return; }
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-cache");
    if (type.startsWith("text/html") && !PAGE_FILES.has(path.relative(OUT, file))) { res.end(withRuntime(fs.readFileSync(file, "utf8"))); return; }
    fs.createReadStream(file).pipe(res);
  });
  server.listen(PORT, () => console.log(`gallery on http://localhost:${server.address().port}`));
}

await buildAll();
for (const p of PAGES) fs.writeFileSync(path.join(OUT, p.file), page(p));
if (!flag("--no-serve")) serve();
