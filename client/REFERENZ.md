# Whiteboard-Werkzeug: Referenz

Nachschlagewerk für den Client in `client/` (Python-Bibliothek `wb` und Befehl `./wb`). Ziel: ein Board bauen, ohne Code zu lesen. Das Board bietet eine REST API (`<URL>/v2`). Kurzüberblick und Tests stehen im [README](README.md). Alle Angaben sind aus Server-Code (`backend/src/board-api`, `frontend/src`) und Tests belegt; Punkte, die nur aus einem echten Lauf stammen, sind als Praxis-Beobachtung markiert.

Inhalt: 1 Einrichtung · 2 Koordinaten · 3 Bibliothek (Funktionen) · 4 Objekttypen, Farben, Schrift · 5 Layout-Regeln · 6 Sichtprüfung · 7 Beispielskript · 8 Befehl `wb` · 9 Fehler · 10 Änderungsprotokoll und Rollback

## 1. Einrichtung

| Variable | Bedeutung | Standard |
|---|---|---|
| `WHITEBOARD_URL` | Basis-URL ohne `/v2` | `http://127.0.0.1:1337` |
| `WHITEBOARD_API_TOKEN` | Bearer-Token | keiner (Pflicht, nur aus der Umgebung) |
| `IMPORT_QUELLE_API` | nur für `import`/`inventar.py`: Basis-URL der Quell-API inkl. `/v2`, Pflicht | keiner (Abbruch) |
| `WHITEBOARD_LOG` | Pfad des Änderungsprotokolls | `./whiteboard_changes.jsonl` |
| `WB_RETRIES` / `WB_RETRY_WAIT` | Versuche / Basiswartezeit in Sekunden (verdoppelt sich je Versuch) | `4` / `1.5` |

Token: Er kommt nur aus der Umgebung (`WHITEBOARD_API_TOKEN`). `verbinden()` und `./wb` geben ihn nie aus (Fehlermeldungen enthalten ihn nie). Den Token nie als Argument, in Dateien oder im Log ablegen. Nur Python 3 mit `requests` (`pip install -r requirements.txt`).

### Standard-Einstieg für Skripte

```python
import sys; sys.path.insert(0, "/pfad/zu/client")
import wb
wb.verbinden()
```

## 2. Koordinaten-System (belegt)

- **`position.x/y` ist die MITTE des Elements**, nicht die linke obere Ecke. Beleg: `toOurboardXY` in `board-api/convert.ts` rechnet `x_ecke = Ursprung + cx/40 - Breite_em/2`; beim Lesen liefert `itemToApi` `position.origin = "center"`. Die Praxis (Pfeil bei `x = Mitte ± Breite/2` trifft den Rand) stimmt damit überein.
- **Einheit:** API-Pixel. Intern rechnet der Server in `em`, 1 em = 40 API-Pixel (`SCALE`). Breite, Höhe, Position, Schriftgröße und Linienpunkte sind alle in API-Pixeln.
- **Ursprung:** (0, 0) ist die Boardmitte (`relativeTo: "canvas_center"`); x wächst nach rechts, y nach unten, negative Werte sind erlaubt. Innerhalb eines Frames (`parent`) ist (0, 0) die linke obere Ecke des Frames (`relativeTo: "parent_top_left"`), die Position bleibt auch dort die Mitte des Kindes.
- **Breite/Höhe (`geometry`):** Shapes: Standard 200 × 200. Texte: Breite Standard 400, Höhe wird aus Text und Schrift geschätzt (`ceil(Zeichen/Zeile) * size * 1.4 + size * 0.4`, Zeichen je Zeile = `Breite / (size * 0.55)`), nicht beim Rendern angepasst. Frames: Standard 1000 × 1000. Bilder: nur Breite angeben, Höhe folgt dem Seitenverhältnis.
- **Höhe bei Shapes bleibt fest.** Die Form wird nie an den Text angepasst. Ist der Text länger als der Kasten, läuft er über den Rand hinaus (siehe Abschnitt 5). Höhe vorher selbst festlegen (`hinweis()` schätzt sie).
- Beim Ändern per `update` mit nur `geometry` bleibt die MITTE erhalten; mit nur `position` bleibt die Größe erhalten. Das Verschieben eines Frames verschiebt seine Kinder mit.
- Kästen verbinden: Pfeil horizontal von `x1 = Mitte_a + Breite_a/2` zu `x2 = Mitte_b - Breite_b/2`, y = Mitte (oder `pfeil_kasten`).

## 3. Bibliothek `wb` (Funktionen)

Alle Funktionen, die ein Board brauchen, akzeptieren `board=None` (Standard: das mit `use()` gewählte). Fehler sind immer `wb.WBError` (Abschnitt 9). `x, y` immer MITTE, alle Maße in API-Pixeln.

### Einrichtung und Konfiguration

- **`verbinden() -> str`** setzt `WHITEBOARD_URL` auf `http://127.0.0.1:1337`, falls nicht gesetzt, und prüft, dass `WHITEBOARD_API_TOKEN` in der Umgebung steht. Rückgabe: die URL, nie der Token. Fehler: `WBError`, wenn der Token fehlt.
- **`use(board_id: str) -> str`** setzt das Standard-Board. Rückgabe: die ID.
- **`set_log(path: str) -> None`** setzt den Pfad des Änderungsprotokolls. `log_path() -> str` liefert den gültigen Pfad.
- **`request(method, path, json_body=None, files=None, stream=False, raw_url=None, auth=True) -> requests.Response`** HTTP mit Retry bei 5xx, 429 und Netzwerkfehlern; liefert die Antwort auch bei 4xx. Für Sonderfälle; Normalbetrieb braucht es nicht.

### Boards

- **`board_create(name: str) -> dict`** legt ein Board an (immer mit Rich-Text-Unterstützung) und erzeugt den Gastlink. Rückgabe: `{"id", "name", "viewLink", "shareLink", "createdAt", "modifiedAt", "archived", "neueKundenkommentare", "type": "board"}`. `viewLink` ist der Admin-Link (Login), `shareLink` der Gastlink (kein Login). Fehler: HTTP 400 bei leerem Namen.
- **`boards() -> list[dict]`** alle Boards (paginiert), jedes Element wie bei `board_create`.
- **`board_get(board=None) -> dict`** ein Board, gleiches Format.
- **`board_update(board=None, **felder) -> dict`** `name="..."` (nicht leer, höchstens 200 Zeichen) und/oder `archived=True|False`. Archivieren löscht nichts. Alt und neu kommen ins Änderungsprotokoll. Fehler 400, wenn weder `name` noch `archived` oder ungültige Werte.
- **`share_rotate(board=None) -> dict`** erzeugt einen neuen Gastlink, der alte wird ungültig. Rückgabe `{"shareLink": "..."}`.

### Elemente anlegen

Alle liefern die ID (`str`) des neuen Elements.

- **`panel(x, y, w, h, fill, title, parts, board=None, size=18) -> str`** beschrifteter Kasten (`round_rectangle`, Rand `#dde2e8`, Text `#1a1a1a`, links/oben ausgerichtet). `fill`: Farbe (Abschnitt 4). `title`: fetter erster Absatz. `parts`: Liste von Zeilen, Markdown-artig (siehe `html`). `size`: Schriftgröße in API-Pixeln. Empfehlung: 26.
  ```python
  wb.panel(0, 0, 560, 300, "#e6f6ee", "Schritt 1", ["## Ziel", "- Punkt A", "Fließtext"], size=26)
  ```
- **`hinweis(x, y, w, title, parts, fill="#fff9b1", size=26, h=None, board=None) -> str`** Hinweis-Kasten statt Haftnotiz: ein `panel` mit Schrift 26 und aus dem Text geschätzter Höhe (`h` überschreibt). Für längere Texte immer diesen oder `panel` nehmen.
  ```python
  wb.hinweis(0, 400, 560, "Achtung", ["Gast muss vorher freigeben."])
  ```
- **`schaetze_hoehe(title, parts, w, size) -> int`** die Höhe, die `hinweis` verwendet (grobe Schätzung: Zeilen aus Zeichenzahl, `Zeilen * size * 1.4 + 40`). Nach dem Bauen per Sichtprüfung gegenprüfen.
- **`text(x, y, w, content, size, board=None) -> str`** freier Text ohne Kasten, links ausgerichtet. `content`: HTML (`<p>..</p>`, `<strong>`, `<em>`, `<u>`, `<s>`, `<a href>`, `<br>`; erlaubte Link-Schemata http, https, mailto, tel). `size` wird als Schriftgröße in API-Pixeln gesetzt (Titel 48 bis 72, Fließtext 26). Höhe wird geschätzt, Breite fest.
- **`sticky(x, y, content, color="light_yellow", width=320, board=None) -> str`** Haftnotiz (`shape: rectangle`). `color`: Farbname (Abschnitt 4). Höhe = 1,146 × Breite, Schrift = 10 % der Breite. Nur für ganz kurze Zettel (ein bis drei Wörter), siehe Abschnitt 5.
- **`frame(x, y, w, h, title, fill="#ffffff", board=None) -> str`** Rahmen mit Titel. Frames können keinen `parent` haben. Kinder zuordnen: per `wb.update(kind, id, parent={"id": frame_id})` (dann wird `position` relativ zur Frame-Ecke).
- **`image(x, y, w, path, title="", board=None, parent=None) -> str`** lädt eine Datei hoch (PNG, JPEG, GIF, WebP; SVG und anderes wird abgelehnt; höchstens 25 MB). Breite `w`, Höhe nach Seitenverhältnis. `parent`: Frame-ID. Format: multipart mit Teil `resource` (Datei) und Teil `data` (JSON).
- **`image_bytes(x, y, w, filename, blob, title="", board=None, parent=None) -> str`** wie `image`, aber mit Bytes im Speicher; `filename` bestimmt den MIME-Typ.
- **`linie(x1, y1, x2, y2, farbe="#1a1a1a", staerke=4, pfeil=False, board=None) -> str`** gerade Linie, mit `pfeil=True` mit Pfeilspitze am Ende. Start und Ende sind absolute Punkte (Mitte-Koordinaten des Boards). Stärke: größer 0, höchstens 64. Linien haben keinen `parent`.
- **`pfeil(x1, y1, x2, y2, farbe="#1a1a1a", staerke=4, board=None) -> str`** = `linie(..., pfeil=True)`.
- **`pfeil_kasten(von, nach, farbe="#1a1a1a", staerke=4, board=None) -> str`** Pfeil von Rand zu Rand. `von`/`nach`: Tupel `(x_mitte, y_mitte, breite, höhe)`. Überwiegt der horizontale Abstand: rechte Kante zu linker Kante (bzw. umgekehrt), sonst untere zu oberer Kante (bzw. umgekehrt).
  ```python
  a = (0, 0, 560, 300); b = (620, 0, 560, 300)
  wb.pfeil_kasten(a, b)   # von (280, 0) nach (340, 0)
  ```
- **`freihand(punkte, farbe="#1a1a1a", staerke=4, board=None) -> str`** Freihand-Strich; `punkte = [(x, y), ...]`, 2 bis 600 Punkte; Koordinaten höchstens ±1.000.000.
- **`post(kind, body, board=None) -> str`** Rohzugriff: `kind` einer von `shapes, texts, sticky_notes, frames, drawings, connectors`, `body` im API-Format. Nur nutzen, wenn eine Funktion oben fehlt (z. B. Form `circle` oder `rhombus`, Rand, Ausrichtung):
  ```python
  wb.post("shapes", {"data": {"shape": "circle", "content": wb.html("Ja", [])},
                     "style": {"fillColor": "#ffe0b2", "fontSize": "26", "textAlign": "center", "textAlignVertical": "middle"},
                     "geometry": {"width": 200, "height": 200}, "position": {"x": 0, "y": 0}})
  ```
- **`html(title: str, parts: list[str]) -> str`** erzeugt den Rich-Text: erster Absatz fett (`title`), danach je Eintrag in `parts`: `""` = Leerzeile, `"## X"` = fetter Absatz, `"- X"` = Absatz mit Punkt `· X`, sonst normaler Absatz. Text wird nicht maskiert: `<`, `&` in Inhalten selbst als `&lt;`, `&amp;` schreiben.

### Lesen, ändern, löschen

- **`items(board=None, type=None, limit=50) -> list[dict]`** alle Elemente (paginiert). `type`: ein Typ oder Kommaliste aus `shape, text, sticky_note, frame, image, drawing, connector`; unbekannt = HTTP 400. Element: `{"id", "type", "position": {"x","y","origin":"center","relativeTo"}, "geometry": {"width","height","rotation"}, "data", "style", "parent"?, "createdBy": {"id","type"}, "createdAt", "modifiedAt"}`. `createdBy.type` ist `api`, `admin` oder `customer`. Bei `connector` stehen `startItem.position`/`endItem.position` und `data.shape` (`arrow`/`line`) statt `geometry`-Mitte, bei `drawing` die Punkte in `data.points`.
- **`get_item(item_id, board=None) -> dict`** ein Element (gleiches Format). Fehler 404 `itemNotFound`.
- **`update(kind, item_id, board=None, **felder) -> dict`** Teiländerung. `kind` ist der Pfad (`shapes, texts, sticky_notes, frames, images, drawings, connectors`) und muss zum Typ passen (sonst 404). Felder: `data=`, `style=`, `geometry=`, `position=`, `parent=` (`{"id": ...}` oder `None`), bei Linien auch `startItem=`/`endItem=`. Liest vorher den alten Stand und protokolliert alt und neu. Rückgabe: das geänderte Element.
  ```python
  wb.update("shapes", sid, style={"fontSize": "26"}, geometry={"height": 420})   # Mitte bleibt
  wb.update("connectors", cid, endItem={"position": {"x": 400, "y": 0}})
  ```
- **`delete(item_id, board=None) -> None`** löscht ein Element (jeder Typ). Löscht nur, wenn der alte Stand lesbar war; das komplette Objekt wird vorher ins Protokoll geschrieben.

## 4. Objekttypen, Farben, Schrift

| API-Typ | Pfad | Anlegen mit | `data` | Wichtige Felder |
|---|---|---|---|---|
| `shape` | `shapes` | `panel`, `hinweis`, `post` | `content` (HTML), `shape` | `style`, `geometry`, `position`, `parent` |
| `text` | `texts` | `text` | `content` (HTML) | `style.fontSize`, `geometry.width`, `position` |
| `sticky_note` | `sticky_notes` | `sticky` | `content`, `shape` (`rectangle` = 1:1,146, sonst quadratisch) | `style.fillColor` (Name) |
| `frame` | `frames` | `frame` | `title` | `style.fillColor`, `geometry` |
| `image` | `images` | `image`, `image_bytes` | `title` | `geometry.width`, `parent` |
| `drawing` | `drawings` | `freihand` | `points` | `style.strokeColor`, `strokeWidth` |
| `connector` | `connectors` | `linie`, `pfeil` | `shape` (`line`/`arrow`) | `startItem`, `endItem` |

- **Shape-Formen** (`data.shape`): `rectangle` (Standard, auch für Unbekanntes), `round_rectangle`, `circle`, `rhombus`. Alles andere wird still als `rectangle` behandelt.
- **Farben** (`fillColor`, `color`, `borderColor`, `strokeColor`): Hex `#rgb`, `#rrggbb`, `#rrggbbaa` oder einer dieser Namen: `gray #d5d6db`, `light_yellow #fff9b1`, `yellow #f5d128`, `orange #ff9d48`, `light_green #d5f692`, `green #c9df56`, `dark_green #93d275`, `cyan #6cd8fa`, `light_pink #ffcee0`, `pink #f16c7f`, `violet #ca64ea`, `red #f24726`, `light_blue #a6ccf5`, `blue #2d9bf0`, `dark_blue #414bb2`, `black #1a1a1a`, `white #ffffff`, `transparent`. Ungültig = HTTP 400 `unbekannte Farbe`. Haftnotizen werden beim Lesen mit dem Farbnamen zurückgegeben.
- **Stil (`style`)** für Shapes: `fillColor`, `color` (Textfarbe), `borderColor`, `borderWidth` (Zahl, Standard 2), `fontSize` (Zahl oder String, größer 0, API-Pixel), `textAlign` (`left`, `center`, `right`, `justify`), `textAlignVertical` (`top`, `middle`, `bottom`). Texte: `fontSize`, `color`, `fillColor`, `textAlign`. Linien: `strokeColor` (oder `color`), `strokeWidth`; `endStrokeCap: "none"` macht aus einem Pfeil eine Linie.
- **Schriftgröße (`fontSize`):** API-Pixel (intern `fontSize / 40` em), auf dem Board literal, also **keine automatische Anpassung an die Kastengröße**. Standard: Shape 14, Text 14, Haftnotiz 10 % der Breite, Frame-Titel 24 (0,6 em, fest).

## 5. Layout-Regeln

**Schriftgröße:** Praxis-Beobachtung aus einem echten Lauf (18.10.2026): `fontSize` 18 in 560 px breiten Kästen ist in der Gesamtansicht viel zu klein; **26 ist gut lesbar**. Deshalb `size=26` (Standard von `hinweis`; bei `panel` per `size=26` angeben, der Standardwert 18 bleibt aus Kompatibilität). Titel als `text` 48 bis 72.

**Raster:** Spaltenbreite 560, Abstand 60, also Mitten bei x = 0, 620, 1240, 1860 ... Pfeile von Rand zu Rand (`pfeil_kasten`). Zeilenabstand: Kastenhöhe + 60.

**Haftnotizen (tatsächliche Regel, aus dem Code):**
- Die Breite wird übernommen (`geometry.width`, `sticky()` sendet 320). Sie wird *nicht* ignoriert.
- Die Höhe ist fest 1,146 × Breite (bei `rectangle`), also 320 breit = rund 367 hoch. Stickies im Raster mit Annahme „quadratisch" überlappen deshalb vertikal.
- Die Schrift ist fest 10 % der Breite (320 breit = 32 px) und passt sich dem Text nicht an. Der Textblock hat keine Höhenbegrenzung (`overflow: visible`, Höhe `fit-content`, im Kasten mittig ausgerichtet): Zu langer Text läuft oben und unten über die Notiz hinaus und in die Nachbarn. Praxis-Beobachtung: der Text wirkte, als würde die Breite nicht beachtet.
- Regel: Stickies nur für kurze Zettel. Alles ab etwa 40 Zeichen: `panel` bzw. `hinweis` (Form `round_rectangle`) mit eigener Höhe und `size=26`. Wer Stickies nutzt, plant Zeilenabstand = 1,146 × Breite + Reserve und setzt `style.fontSize` selbst.

**Texte in Kästen:** Kasten innen etwa 40 px Rand; pro Zeile passen ca. `(Breite − 40) / (size × 0,55)` Zeichen; Höhe ≈ `Zeilen × size × 1,4 + 40` (= `schaetze_hoehe`). Ist die Schätzung knapp, 20 % Reserve geben und per Sichtprüfung gegenprüfen.

## 6. Pflicht-Sichtprüfung nach dem Bauen

Nach jedem Bauen das Board über den **Gastlink** (`shareLink`, kein Login) im Browser öffnen oder per Screenshot-Werkzeug festhalten. Zweck: Überlappungen und Textüberlauf finden, nicht Bedienung testen. Prüfen: Text innerhalb der Kästen, keine überlappenden Kästen, Pfeile treffen Ränder. Bei Fehlern per `wb.update` Höhe/Schrift anpassen und erneut prüfen.

## 7. Beispielskript

```python
import os, sys
sys.path.insert(0, "/pfad/zu/client")
import wb

wb.verbinden()
b = wb.board_create("Ablauf Beispiel")
wb.use(b["id"])
wb.set_log("/pfad/zum/projekt/whiteboard_changes.jsonl")

wb.text(930, -260, 2000, "<p><strong>Ablauf in vier Schritten</strong></p>", 64)

W, H, GAP = 560, 360, 60
schritte = [
    ("1 Anfrage", ["Gast meldet sich", "- Briefing klären"], "#e6f6ee"),
    ("2 Konzept", ["Entwurf erstellen", "- Freigabe holen"], "#e3f0ff"),
    ("3 Umsetzung", ["Bauen und prüfen"], "#fff3d6"),
    ("4 Livegang", ["Nach Freigabe live"], "#fde3e3"),
]
kaesten = []
for i, (titel, zeilen, farbe) in enumerate(schritte):
    x = i * (W + GAP)
    wb.panel(x, 0, W, H, farbe, titel, zeilen, size=26)
    kaesten.append((x, 0, W, H))
for a, c in zip(kaesten, kaesten[1:]):
    wb.pfeil_kasten(a, c)

print(b["shareLink"])   # Gastlink: Board öffnen, Überlappung/Überlauf prüfen
print(b["viewLink"])
```
Das Board wird auf dem echten Server angelegt: nur ausführen, wenn es gewollt ist (zum Üben `WHITEBOARD_URL` auf einen lokalen Server setzen).

## 8. Befehl `wb`

`./wb <befehl>` (im Ordner `client`). Konfiguration per Umgebung (`WHITEBOARD_URL`, `WHITEBOARD_API_TOKEN`). Fehler: Ausgabe `Fehler: <Text>` auf stderr, Exit-Code 1; falsche Argumente: Exit-Code 2 (Hilfe mit `-h`).

| Befehl | Argumente | Wirkung / Ausgabe |
|---|---|---|
| `board neu <name>` | `name`: Boardname | Zeilen `Board-ID:`, `Admin-Link:`, `Gastlink:` |
| `board liste [--alle]` | `--alle`: auch archivierte | je Board `id \| name \| geändert [\| archiviert] [\| N neue Gästekommentare]` |
| `board archivieren <id> [--wiederherstellen]` | `id`; Flag entfernt das Archiv-Flag | setzt `archived`, löscht nichts |
| `board umbenennen <id> <name>` | `id`, `name` | `Board heißt jetzt: ...` |
| `board link <id>` | `id` | Admin- und Gastlink |
| `board link-erneuern <id>` | `id` | neuer Gastlink, alter ungültig |
| `lesen <id> [--nur-gast] [--seit ISO]` | `--nur-gast`: nur von Gästen angelegte Elemente; `--seit`: ISO-8601-Zeitpunkt | je Element `[typ] id von <ersteller>, <zeit> @(x,y)` plus Text; Anzahl auf stderr |
| `export <id> <ordner>` | Zielordner (wird angelegt) | `items.json` (Board + Elemente) und Bilder `<id>.<ext>`; Zusammenfassung |
| `import --quelle-board <id> <wb_id> [--mapping datei]` | Quell-Board einer fremden REST-API-Quelle (v2), Ziel-Board, Mapping-Pfad (Standard `import_mapping_<quell-board>.json`) | liest die Quelle nur per GET (Token aus der Umgebung `IMPORT_QUELLE_TOKEN`; Basis-URL der Quell-API inkl. `/v2` Pflicht in der Umgebung `IMPORT_QUELLE_API`, ohne sie Abbruch mit klarer Meldung), legt Frames zuerst an, dann Kinder, Bilder im Original; andere Typen werden übersprungen und gezählt; schreibt Mapping `quell_id -> wb_id` |
| `kopieren <quell-url> --quelle-board <id> [--ziel-id <id>] [--quelle-assets <ordner>] [--mapping datei]` | Quell-Server, Quell-Board, optional vorhandenes Ziel, lokaler Assets-Ordner | Quell-Token aus der Umgebung `KOPIE_QUELLE_TOKEN`; legt ohne `--ziel-id` ein neues Board mit dem Namen der Quelle an; überträgt Frames, Shapes, Texte, Stickies, Bilder; vergleicht am Ende die Anzahl je Typ (Abweichung = Fehler) |

Hilfsskript: `python3 inventar.py [<quell_id>]` zählt Typen und Bildgrößen einer Quelle (ohne Id: Boardliste), nur lesend.

Beispiel:
```bash
./wb board neu "Workshop Ablauf"
./wb lesen <id> --nur-gast --seit 2026-10-18T00:00:00Z
```

## 9. Fehler

Die Bibliothek wirft `wb.WBError` mit Text, nie mit Token. Typische Fälle:

| Meldung | Ursache | Abhilfe |
|---|---|---|
| `WHITEBOARD_API_TOKEN ist nicht gesetzt` | Token fehlt in der Umgebung | Variable setzen (nie als Argument oder Datei) |
| `Kein Board gewählt` | `use()` vergessen | `wb.use(id)` oder `board=` |
| `HTTP 400 ... invalidParameter` | ungültige Farbe, Form, Zahl, zu viele Punkte, Frame mit Parent | Meldungstext nennt das Feld |
| `HTTP 401` | Token falsch | Token prüfen |
| `HTTP 404 boardNotFound / itemNotFound` | falsche ID oder falscher Pfad für den Typ | ID und `kind` prüfen |
| `IMPORT_QUELLE_API ist nicht gesetzt` | `import`/`inventar.py` ohne Quell-URL | Umgebungsvariable `IMPORT_QUELLE_API` setzen |
| `HTTP 413` | Bild über 25 MB | verkleinern |
| `<Methode> <Pfad>: HTTP 5xx nach N Versuchen` | Server nicht erreichbar | später erneut |

## 10. Änderungsprotokoll und Rollback

Jede Änderung über `update`, `delete` und `board_update` wird als JSON-Zeile in das Protokoll geschrieben: `{zeit, board, id, aktion, alt, neu, status}`. `update` liest vorher den alten Stand; `delete` löscht nur, wenn er lesbar war, und schreibt das ganze Objekt. Anlegen (`panel`, `pfeil` usw.) wird nicht protokolliert; neu angelegte Elemente wieder entfernen mit `wb.delete(id)` (IDs aus der Rückgabe merken). Rollback = alte Werte aus `alt` per `update` zurückspielen; für gelöschte Elemente das protokollierte Objekt neu anlegen. Protokoll mit ins Projekt-Git. Änderungen am Werkzeug selbst: `git revert` des PRs, nichts kopieren.
