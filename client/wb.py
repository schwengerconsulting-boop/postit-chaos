"""Whiteboard-Bibliothek (Board-API, REST API v2, Teilmenge).

Konfiguration per Env: WHITEBOARD_URL, WHITEBOARD_API_TOKEN.
Optional: WHITEBOARD_LOG (Pfad Änderungsprotokoll, Default ./whiteboard_changes.jsonl),
WB_RETRIES (Default 4), WB_RETRY_WAIT (Sekunden Basis-Wartezeit, Default 1.5).

Typischer Gebrauch (wie die bisherigen Board-Skripte):
    import wb
    wb.use("<board_id>")
    wb.panel(280, 700, 560, 760, "#e6f6ee", "Titel", ["## Abschnitt", "- Punkt"])
"""
import datetime
import json
import mimetypes
import os
import time
import urllib.parse

import requests

_board = None
_log_path = None

STANDARD_URL = "http://127.0.0.1:1337"  # Standard für WHITEBOARD_URL


class WBError(Exception):
    """Fehler ohne Secret-Werte (Token wird nie in Meldungen aufgenommen)."""


# ---------- Konfiguration ----------
def verbinden():
    """Standard-Einstieg für Skripte: setzt WHITEBOARD_URL (Standard http://127.0.0.1:1337, falls nicht gesetzt)
    und prüft, dass WHITEBOARD_API_TOKEN in der Umgebung steht. Gibt die URL zurück, nie den Token."""
    os.environ.setdefault("WHITEBOARD_URL", STANDARD_URL)
    if not os.environ.get("WHITEBOARD_API_TOKEN"):
        raise WBError("WHITEBOARD_API_TOKEN ist nicht gesetzt")
    return os.environ["WHITEBOARD_URL"]


def use(board_id):
    """Setzt das Standard-Board für post/panel/text/... """
    global _board
    _board = board_id
    return board_id


def set_log(path):
    global _log_path
    _log_path = path


def log_path():
    return _log_path or os.environ.get("WHITEBOARD_LOG") or os.path.join(os.getcwd(), "whiteboard_changes.jsonl")


def _base():
    url = os.environ.get("WHITEBOARD_URL", STANDARD_URL).rstrip("/")
    return url + "/v2"


def _headers():
    tok = os.environ.get("WHITEBOARD_API_TOKEN")
    if not tok:
        raise WBError("WHITEBOARD_API_TOKEN ist nicht gesetzt")
    return {"Authorization": f"Bearer {tok}", "Accept": "application/json"}


def _bid(board):
    b = board or _board
    if not b:
        raise WBError("Kein Board gewählt (wb.use(<id>) oder board=...)")
    return urllib.parse.quote(str(b), safe="")


# ---------- HTTP mit Retry ----------
def request(method, path, json_body=None, files=None, stream=False, raw_url=None, auth=True):
    """Gibt das requests-Response zurück. Retries bei 5xx, 429 und Netzwerkfehlern."""
    tries = int(os.environ.get("WB_RETRIES", "4"))
    wait = float(os.environ.get("WB_RETRY_WAIT", "1.5"))
    url = raw_url or (_base() + path)
    last = None
    for i in range(tries):
        try:
            hdr = _headers() if auth else {}
            r = requests.request(method, url, headers=hdr, json=json_body, files=files,
                                 timeout=60, stream=stream)
            if r.status_code < 500 and r.status_code != 429:
                return r
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = f"Netzwerkfehler ({type(e).__name__})"
        if i < tries - 1:
            time.sleep(wait * (2 ** i))
    raise WBError(f"{method} {path or raw_url}: {last} nach {tries} Versuchen")


def _check(r, what):
    if r.status_code >= 300:
        raise WBError(f"{what}: HTTP {r.status_code} {r.text[:300]}")
    try:
        return r.json() if r.content else {}
    except ValueError:
        raise WBError(f"{what}: keine JSON-Antwort")


# ---------- Boards ----------
def board_create(name):
    return _check(request("POST", "/boards", {"name": name}), "Board anlegen")


def boards():
    out, cursor = [], None
    while True:
        q = "/boards?limit=50" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        d = _check(request("GET", q), "Boardliste")
        out += d.get("data", [])
        cursor = d.get("cursor")
        if not cursor or not d.get("data"):
            return out


def board_get(board=None):
    return _check(request("GET", f"/boards/{_bid(board)}"), "Board lesen")


def board_update(board=None, **felder):
    """Board ändern (name=, archived=). Archivieren löscht nichts. Alt/neu kommen ins Änderungsprotokoll."""
    b = _bid(board)
    alt = None
    try:
        alt = board_get(b)
    except WBError as e:
        alt = {"lesefehler": str(e)}
    status = "fehler"
    try:
        r = request("PATCH", f"/boards/{b}", felder)
        status = f"HTTP {r.status_code}"
        res = _check(r, "Board ändern")
        status = "ok"
        return res
    finally:
        _log({"zeit": _now(), "board": b, "id": b, "aktion": "board_update",
              "alt": {k: (alt or {}).get(k) for k in felder}, "neu": felder, "status": status})


def share_rotate(board=None):
    return _check(request("POST", f"/boards/{_bid(board)}/share/rotate"), "Gastlink erneuern")


# ---------- Items anlegen ----------
def post(kind, body, board=None):
    """Legt ein Item an (kind: shapes, texts, sticky_notes, frames, drawings, connectors) und gibt die ID zurück."""
    d = _check(request("POST", f"/boards/{_bid(board)}/{kind}", body), kind)
    return d["id"]


def freihand(punkte, farbe="#1a1a1a", staerke=4, board=None):
    """Freihand-Strich; punkte = [(x, y), ...] in API-Pixeln (Ursprung Boardmitte), höchstens 600."""
    return post("drawings", {"data": {"points": [{"x": x, "y": y} for x, y in punkte]},
                             "style": {"strokeColor": farbe, "strokeWidth": staerke}}, board)


def linie(x1, y1, x2, y2, farbe="#1a1a1a", staerke=4, pfeil=False, board=None):
    """Gerade Linie, mit pfeil=True mit Pfeilspitze am Ende. Spätere Änderung: update("connectors", id, ...)."""
    return post("connectors", {"data": {"shape": "arrow" if pfeil else "line"},
                               "startItem": {"position": {"x": x1, "y": y1}},
                               "endItem": {"position": {"x": x2, "y": y2}},
                               "style": {"strokeColor": farbe, "strokeWidth": staerke}}, board)


def pfeil(x1, y1, x2, y2, farbe="#1a1a1a", staerke=4, board=None):
    return linie(x1, y1, x2, y2, farbe, staerke, pfeil=True, board=board)


def html(title, parts):
    """Markdown-artige Zeilen -> Rich-Text-HTML (Markdown-artig)."""
    out = [f"<p><strong>{title}</strong></p><p></p>"]
    for p in parts:
        if p == "":
            out.append("<p></p>")
        elif p.startswith("## "):
            out.append(f"<p><strong>{p[3:]}</strong></p>")
        elif p.startswith("- "):
            out.append(f"<p>· {p[2:]}</p>")
        else:
            out.append(f"<p>{p}</p>")
    return "".join(out)


def panel(x, y, w, h, fill, title, parts, board=None, size=18):
    """Beschrifteter Kasten (round_rectangle). x, y = MITTE. size = Schriftgröße in API-Pixeln (Gesamtansicht: 26)."""
    return post("shapes", {
        "data": {"shape": "round_rectangle", "content": html(title, parts)},
        "style": {"fillColor": fill, "fontSize": str(size), "color": "#1a1a1a", "borderColor": "#dde2e8",
                  "borderWidth": "1.0", "textAlign": "left", "textAlignVertical": "top"},
        "geometry": {"width": w, "height": h}, "position": {"x": x, "y": y}}, board)


def schaetze_hoehe(title, parts, w, size):
    """Geschätzte Kastenhöhe in API-Pixeln für html(title, parts) bei Breite w und Schrift size."""
    pro_zeile = max(1, int((w - 40) / (size * 0.55)))
    zeilen = 2  # Titel + Leerzeile
    for p in parts:
        zeilen += max(1, -(-len(p) // pro_zeile))
    return int(zeilen * size * 1.4 + 40)


def hinweis(x, y, w, title, parts, fill="#fff9b1", size=26, h=None, board=None):
    """Hinweis-Kasten statt Haftnotiz: panel mit Schrift 26 und geschätzter Höhe (h überschreibt)."""
    return panel(x, y, w, h or schaetze_hoehe(title, parts, w, size), fill, title, parts, board, size)


def pfeil_kasten(von, nach, farbe="#1a1a1a", staerke=4, board=None):
    """Pfeil von Rand zu Rand zweier Kästen; Kasten = (x_mitte, y_mitte, breite, höhe). Ist der Abstand
    horizontal größer, von rechter zu linker Kante (bzw. umgekehrt), sonst von unterer zu oberer Kante (bzw. umgekehrt)."""
    ax, ay, aw, ah = von
    bx, by, bw, bh = nach
    if abs(bx - ax) >= abs(by - ay):
        s = 1 if bx >= ax else -1
        return pfeil(ax + s * aw / 2, ay, bx - s * bw / 2, by, farbe, staerke, board)
    s = 1 if by >= ay else -1
    return pfeil(ax, ay + s * ah / 2, bx, by - s * bh / 2, farbe, staerke, board)


def text(x, y, w, content, size, board=None):
    return post("texts", {"data": {"content": content}, "style": {"fontSize": str(size), "textAlign": "left"},
                          "geometry": {"width": w}, "position": {"x": x, "y": y}}, board)


def sticky(x, y, content, color="light_yellow", width=320, board=None):
    return post("sticky_notes", {"data": {"content": content, "shape": "rectangle"},
                                 "style": {"fillColor": color}, "position": {"x": x, "y": y},
                                 "geometry": {"width": width}}, board)


def frame(x, y, w, h, title, fill="#ffffff", board=None):
    return post("frames", {"data": {"title": title, "format": "custom"}, "style": {"fillColor": fill},
                           "geometry": {"width": w, "height": h}, "position": {"x": x, "y": y}}, board)


def image(x, y, w, path, title="", board=None, parent=None):
    """Bild-Upload multipart wie in der v2-API: Teil 'resource' (Datei) + Teil 'data' (JSON)."""
    with open(path, "rb") as f:
        blob = f.read()
    return image_bytes(x, y, w, os.path.basename(path), blob, title, board, parent)


def image_bytes(x, y, w, filename, blob, title="", board=None, parent=None):
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    data = {"title": title or filename, "position": {"x": x, "y": y}, "geometry": {"width": w}}
    if parent:
        data["parent"] = {"id": parent}
    files = {"resource": (filename, blob, mime), "data": (None, json.dumps(data), "application/json")}
    d = _check(request("POST", f"/boards/{_bid(board)}/images", files=files), "image")
    return d["id"]


# ---------- Lesen ----------
def items(board=None, type=None, limit=50):
    """Alle Items (paginiert über cursor)."""
    out, cursor = [], None
    while True:
        q = f"/boards/{_bid(board)}/items?limit={limit}"
        if type:
            q += "&type=" + urllib.parse.quote(type)
        if cursor:
            q += "&cursor=" + urllib.parse.quote(cursor)
        d = _check(request("GET", q), "Items lesen")
        out += d.get("data", [])
        cursor = d.get("cursor")
        if not cursor or not d.get("data"):
            return out


def get_item(item_id, board=None):
    return _check(request("GET", f"/boards/{_bid(board)}/items/{urllib.parse.quote(str(item_id), safe='')}"),
                  "Item lesen")


# ---------- Protokoll ----------
def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def _log(entry):
    with open(log_path(), "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ---------- Ändern / Löschen (mit Protokoll) ----------
def update(kind, item_id, board=None, **felder):
    """Teilupdate (data=, style=, geometry=, position=, parent=). Liest vorher den alten Stand
    und protokolliert {zeit, board, id, alt, neu, status}."""
    b = board or _board
    alt = None
    try:
        alt = get_item(item_id, b)
    except WBError as e:
        alt = {"lesefehler": str(e)}
    status = "fehler"
    try:
        r = request("PATCH", f"/boards/{_bid(b)}/{kind}/{urllib.parse.quote(str(item_id), safe='')}", felder)
        status = f"HTTP {r.status_code}"
        res = _check(r, f"update {kind}")
        status = "ok"
        return res
    finally:
        _log({"zeit": _now(), "board": b, "id": item_id, "aktion": "update", "alt": alt, "neu": felder,
              "status": status})


def delete(item_id, board=None):
    """Löscht ein Item; das komplette alte Objekt wird vorher protokolliert."""
    b = board or _board
    alt = get_item(item_id, b)  # ohne lesbaren Stand kein Löschen
    _log({"zeit": _now(), "board": b, "id": item_id, "aktion": "delete", "alt": alt, "neu": None,
          "status": "angefordert"})
    status = "fehler"
    try:
        r = request("DELETE", f"/boards/{_bid(b)}/items/{urllib.parse.quote(str(item_id), safe='')}")
        status = f"HTTP {r.status_code}"
        if r.status_code >= 300:
            raise WBError(f"delete: HTTP {r.status_code} {r.text[:300]}")
        status = "ok"
    finally:
        _log({"zeit": _now(), "board": b, "id": item_id, "aktion": "delete", "alt": None, "neu": None,
              "status": status})
