# Whiteboard-Terminalwerkzeug

Ein gemeinsamer Client für das Whiteboard (Board-API, REST API v2, Teilmenge) statt einer Helferkopie pro Projekt.
Nur Python-Standardbibliothek plus `requests`.

Vollständige Referenz (Signaturen, Koordinaten, Layout-Regeln, Beispiel): [REFERENZ.md](REFERENZ.md). Skripte starten mit `import wb; wb.verbinden()`.

## Konfiguration
- `WHITEBOARD_URL` (Standard `http://127.0.0.1:1337`), `WHITEBOARD_API_TOKEN` (Pflicht, nur aus der Umgebung, nie als Argument oder Datei). Installation: `pip install -r requirements.txt`.
- optional `WHITEBOARD_LOG` (Änderungsprotokoll, Default `./whiteboard_changes.jsonl`)

## Befehle
```
./wb board neu "Name"            # Board-ID, Admin-Link, Gastlink
./wb board liste [--alle]        # mit Hinweis "N neue Gästekommentare"; archivierte nur mit --alle
./wb board archivieren <id> [--wiederherstellen]   # Flag, nichts wird gelöscht
./wb board umbenennen <id> "Neuer Name"
./wb board link <id>             # Links anzeigen
./wb board link-erneuern <id>    # alter Gastlink wird ungültig
./wb lesen <id> [--nur-gast] [--seit ISO]   # Gästekommentare als Text zurücklesen
./wb export <id> <ordner>        # items.json + Bilder (für Git)
./wb kopieren <quell-url> --quelle-board <id> [--ziel-id <id>] [--quelle-assets <ordner>]   # Board von einem anderen Whiteboard-Server kopieren
./wb import --quelle-board <id> <wb_id> [--mapping datei.json]
```
`import` liest das Quell-Board nur per GET (Quell-Token aus der Umgebung `IMPORT_QUELLE_TOKEN`, Wert wird nie ausgegeben), legt Frames zuerst an, dann Kinder mit parent-Mapping, lädt Bilder im Original nach. Connectors und andere Typen werden übersprungen und gezählt. Ergebnis: Mapping `quell_id -> wb_id` als JSON. Bestandsaufnahme ohne Schreiben: `python3 inventar.py <quell_id>`.

`kopieren` liest die Quelle nur per GET (Quell-Token in der Umgebung `KOPIE_QUELLE_TOKEN`), legt ohne `--ziel-id` ein neues Board mit dem Namen der Quelle an, überträgt Frames, Shapes, Texte, Stickies und Bilder (Bilder aus `--quelle-assets`, weil Assets eine Sitzung brauchen) und vergleicht am Ende die Anzahl je Typ (Abweichung = Fehler).

## Bibliothek (wie die bisherigen Board-Skripte)
```python
import wb
wb.verbinden()   # URL (Standard) + Token aus der Umgebung, gibt den Token nie aus
wb.use(board_id)
wb.panel(x, y, w, h, "#e6f6ee", "Titel", ["## Abschnitt", "- Punkt", "Text"])
wb.text(...); wb.sticky(...); wb.frame(...); wb.image(x, y, w, "bild.png", "Titel")
wb.freihand([(0, 0), (40, 30), (90, 10)], "#e53935", 6)   # Freihand; Punkte in API-Pixeln
wb.linie(0, 0, 200, 0); wb.pfeil(0, 0, 200, 100, "#1e88e5")   # Linie / Pfeil (connectors)
wb.update("sticky_notes", item_id, data={"content": "neu"})   # protokolliert alt/neu
wb.items(type="sticky_note")   # paginiert
wb.delete(item_id)             # protokolliert das komplette alte Objekt
```
Retries bei 5xx, 429 und Netzwerkfehlern (`WB_RETRIES`, `WB_RETRY_WAIT`). Fehlermeldungen enthalten nie den Token.

## Änderungsprotokoll
JSON-Lines `{zeit, board, id, aktion, alt, neu, status}`. `update` liest vorher den alten Stand, `delete` löscht nur, wenn der alte Stand lesbar war, und schreibt das ganze Objekt ins Protokoll. Rollback = alte Werte aus dem Protokoll zurückspielen; Protokoll mit ins Projekt-Git.

## Tests
`cd client && python3 -m unittest test_wb` (lokaler Fake-Server: Retry, Paginierung, Protokoll, Multipart, Import-Reihenfolge).
