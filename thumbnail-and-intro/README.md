# Video-Thumbnail & Intro

Agentitos-Skill für ein **videospezifisches Thumbnail plus ein passendes, 3–5 Sekunden langes Intro**, mit Farben, Schriften und Logo aus dem Brand-Kit-Skill (`DESIGN.md`). Die Hierarchie orientiert sich an Storritos wiederkehrender Tutorial-Serie; die Marke wird nicht fest einprogrammiert.

## Was diese erste Version kann

- Quelle: lokales Video oder ein ausgewähltes Themenbild/Screenshot.
- Brand-Kit: YAML-Tokens, aufgelöste Referenzen, originale lokale Logos, Google Fonts oder lokale Fontdateien.
- Ein funktionierendes Basislayout: große Headline, Brand-Verlauf, thematischer Screenshot und Pfeil. Hochformat ist eigenständig angeordnet, nicht aus Querformat beschnitten.
- PNG-Thumbnail und dazu passendes animiertes MP4, ohne Ton.
- Format aus Videoausrichtung oder explizit: 16:9 bzw. 9:16.
- Lokale Assets, Manifest mit Quellen, Checks auf fehlende Fonts/Bilder und Textüberlauf.
- Kein Überschreiben bestehender Builds/Exporte, kein Veröffentlichen und keine Änderung am Ursprungsvideo.

**Die inhaltliche Auswahl trifft der Agent:** Er liest Briefing/Skript, prüft Bilder und bestimmt Aufmacher und Frame. Das CLI analysiert den Videoinhalt nicht automatisch und transkribiert nicht. Es besitzt derzeit einen Layout-Renderer, keine Preset-Bibliothek und kein KI-Freistellwerkzeug.

## Einrichtung

Node ≥22.12, ein vorhandener HyperFrames-CLI und ein lokaler Chrome sind erforderlich. Für Videoframes zusätzlich ffmpeg und ffprobe. Das Setup lädt nur die Node-Abhängigkeiten dieses Ordners:

```bash
npm ci --ignore-scripts
```

Chrome: `CHROME`, `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH` oder `PRODUCER_HEADLESS_SHELL_PATH`; alternativ vorhandener Puppeteer-Headless-Cache oder Chrome/Chromium auf PATH. HyperFrames: PATH oder `HYPERFRAMES_BIN` mit absolutem Pfad. Kein Browserdownload oder systemweiter Installationsschritt durch diesen Skill.

## Verwendung

`SKILL.md` ist der Agenten-Workflow. Werkzeuge:

```bash
node tools/package.mjs prepare /absolut/job.json /absolut/neuer-build
node tools/package.mjs render /absolut/neuer-build
```

Beispiel `job.json`:

```json
{
  "brand": "brand",
  "video": "mein-video.mp4",
  "headline": "Stories endlich automatisch planen",
  "frameTime": 12.4,
  "layout": "landscape",
  "duration": 4,
  "imageFit": "contain"
}
```

Alle Eingabepfade sind relativ zu `job.json`, der Zielordner relativ zum aktuellen Arbeitsordner. Ohne `video` ist `image` erforderlich. Eine explizite `image` hat Vorrang vor Frame-Extraktion. Ohne `frameTime` wird technisch eine frühe Stelle gewählt; das ist **keine Auswahl des besten Moments**. Der Agent soll einen geeigneten Frame bestimmen. Headline: 3–8 Wörter. Optional: `subtitle`, `focus: {x: 0.5, y: 0.5}`, `imageFit: "cover"` für Fotos. Bei UI ist `contain` der sichere Standard.

Ohne `layout` wird die angezeigte Videoausrichtung einschließlich Rotationsmetadaten verwendet. Ohne Video standardmäßig Querformat. Nur `portrait`/`landscape` werden unterstützt, keine beliebigen Seitenverhältnisse.

| Ausgabe | Querformat | Hochformat |
|---|---|---|
| Thumbnail | 1280 × 720 PNG | 1080 × 1920 PNG |
| Intro | 1920 × 1080 MP4, 30 fps | 1080 × 1920 MP4, 30 fps |
| Länge | 3–5 s, Standard 4 s | 3–5 s, Standard 4 s |

Der Intro-Endzustand entspricht der Thumbnail-Komposition. Unterschiedliche Auflösungen/Video-Kompression können kleine Pixelabweichungen verursachen. Keine Originalvideo-Verknüpfung, Tonspur oder Veröffentlichung. Der Upload von Hochformat-Covern hängt von der jeweiligen Plattform ab.

## Brand-Kit-Vertrag

Minimal:

```yaml
---
name: Meine Marke
colors:
  primary: "#143878"
  secondary: "#542285"
  on-primary: "#FFFFFF"
typography:
  headline-display:
    fontFamily: Inter
    fontWeight: 800
  body-md:
    fontFamily: Inter
    fontWeight: 400
fonts:
  Inter: google
logo:
  primary: logo.svg
---
```

Das Beispiel ist eine Schema-Erklärung, keine Palette für reale Aufträge. Immer das zugehörige bestehende Kit verwenden.

- `colors.primary` und `headline-display` oder `headline-lg` sind erforderlich.
- Opaque `#RGB`/`#RRGGBB` werden unterstützt. `white`/`black` ebenfalls. Keine HSL-/OKLCH-/Alpha-Farben.
- Referenzen wie `{colors.primary}` oder `{typography.headline-lg.fontFamily}` funktionieren; Zyklen führen zu Fehlern.
- `body-md` und `label-md` optional; fehlen sie, wird derselbe Brand-Headline-Token mit Warnung wiederverwendet, keine fremde Schrift erfunden.
- Einzelne Fontfamilie, numerisches exaktes Gewicht. `lineHeight` als einheitenloses Verhältnis von .8 bis 2 oder weglassen. `letterSpacing` als Zahl/em/px/rem. Keine CSS-Fontstacks.
- `fonts: {Inter: google}` oder lokale Listen `Inter: [{file: inter-800.ttf, weight: 800}]`. Das benötigte Gewicht muss vorhanden sein. Keine stille Systemschrift als Ersatz. Explizites `system-ui` ist erlaubt und wird als hostabhängig protokolliert.
- Google Fonts werden bei Vorbereitung lokal gespeichert. Lizenzangaben bei Weitergabe beachten; die Lizenzverantwortung für bereitgestellte Fonts bleibt beim Kit-Eigentümer. Vorhandene lokale OFL/LICENSE-Dateien werden mitkopiert.
- `logo.primary` optional. Logo unverändert auf weißem Träger, niemals gestreckt oder umgefärbt. SVG nur mit eigenständigen Vektorpfaden: kein Text, Script oder eingebettetes Bild. PNG/JPG/WebP ebenfalls möglich.
- Fehlende Sekundärfarbe ergibt einen einfarbigen Primärhintergrund. Weiß/Schwarz sind ausschließlich neutrale Hilfen für Lesbarkeit, Bild-/Logo-Träger und Schatten; im Manifest dokumentiert.
- Bei unzureichendem Textkontrast wird eine minimale schwarze Abdunklung ermittelt und dokumentiert. Es wird keine zusätzliche Brand-Farbe erfunden. Branding-Vorgaben aus dem Kit-Prosa-Teil beurteilt der Agent; der Renderer interpretiert diese nicht automatisch.

## Ergebnisse und Revisionen

Im neuen Build liegen:

```text
manifest.json
composition/index.html
composition/assets/*
thumbnail.png
intro.mp4
```

`prepare` verweigert jeden bestehenden Zielordner. Fehlgeschlagene Vorbereitungen hinterlassen ggf. `PREPARE_INCOMPLETE.txt`; für Wiederholung einen neuen Zielordner wählen. `render` verweigert vorhandene Exporte und nutzt eine exklusive Sperre. Den Bild- und MP4-Output tatsächlich ansehen: technische Checks ersetzen keine Art Direction.

Schrift- und Bilddateien sind beim Rendern lokal. GSAP 3.14.2 wird per festgelegtem CDN geladen; vollständiger Offlinebetrieb ist derzeit nicht enthalten. Downloads, KI-Bildgenerierung, automatische Szenenwahl, Freistellen und mehrere Layoutvarianten sind kein Bestandteil des CLI.

## Tests

```bash
npm test
```

13 automatisierte Tests prüfen u. a. Brand-Referenzen, Pflichtfelder, Bildquellen, Google-/lokale Fonts, Hochformat, Frame-Extraktion, bestehende Ergebnisse und lokale Dateiauslieferung. Zusätzlich wurden im Entwicklungsumfeld reale Quer- und Hochformat-PNG/MP4-Exporte mit einem **unbestätigten, vom Brand-Kit-Skill extrahierten Storrito-Kit-Entwurf** gerendert. Das bestätigt die technische Integration, nicht die Freigabe dieses Kit-Entwurfs oder die Eignung für ein noch unbekanntes konkretes Video.

## Installation als Skill

Diesen ganzen Ordner neben die übrigen Agentitos-Skills legen und die `SKILL.md` in der Agenten-Umgebung verfügbar machen. Der Export registriert sich nicht automatisch bei einem Dienst. Es wurden keine bestehenden Skills oder der zentrale Repository-Stand verändert.
