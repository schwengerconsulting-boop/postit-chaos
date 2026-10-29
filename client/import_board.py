"""Import aus einem fremden Board in das Whiteboard. Die Quelle wird nur GELESEN (GET). Token aus der Umgebung (IMPORT_QUELLE_TOKEN), nie ausgeben."""
import json
import os
import sys
import time
import urllib.parse

import requests

import wb

TYPES_IMPORTED = ("frame", "shape", "text", "sticky_note", "image")


def quell_api():
    """Basis-URL der Quell-API (REST API v2, inkl. /v2) aus IMPORT_QUELLE_API; ohne Wert Abbruch."""
    url = os.environ.get("IMPORT_QUELLE_API", "").strip().rstrip("/")
    if not url:
        raise wb.WBError("IMPORT_QUELLE_API ist nicht gesetzt (Basis-URL der Quell-API inkl. /v2)")
    return url


def quell_token():
    if os.environ.get("IMPORT_TOKEN_TEST"):  # nur für Tests mit Fake-Server
        return os.environ["IMPORT_TOKEN_TEST"]
    v = os.environ.get("IMPORT_QUELLE_TOKEN", "").strip()
    if not v:
        raise wb.WBError("IMPORT_QUELLE_TOKEN ist nicht gesetzt")
    return v


class Quelle:
    def __init__(self, token=None):
        self._tok = token or quell_token()

    def get(self, path, raw_url=None, stream=False):
        url = raw_url or quell_api() + path
        last = None
        for i in range(4):
            try:
                r = requests.get(url, headers={"Authorization": f"Bearer {self._tok}"}, timeout=60, stream=stream)
                if r.status_code < 500 and r.status_code != 429:
                    return r
                last = f"HTTP {r.status_code}"
            except requests.RequestException as e:
                last = f"Netzwerkfehler ({type(e).__name__})"
            time.sleep(float(os.environ.get("WB_RETRY_WAIT", "1.5")) * (2 ** i))
        raise wb.WBError(f"Quelle GET {path}: {last}")

    def json(self, path):
        r = self.get(path)
        if r.status_code == 403:
            raise wb.WBError(f"Quelle 403 für {path.split('?')[0]} (Free-Plan/Berechtigung, wird nicht umgangen)")
        if r.status_code >= 300:
            raise wb.WBError(f"Quelle GET {path.split('?')[0]}: HTTP {r.status_code} {r.text[:200]}")
        return r.json()

    def boards(self):
        out, off = [], 0
        while True:
            d = self.json(f"/boards?limit=50&offset={off}")
            out += d.get("data", [])
            off += len(d.get("data", []))
            if not d.get("data") or off >= d.get("total", 0):
                return out

    def items(self, board_id):
        b = urllib.parse.quote(board_id, safe="")
        out, cursor = [], None
        while True:
            q = f"/boards/{b}/items?limit=50" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
            d = self.json(q)
            out += d.get("data", [])
            cursor = d.get("cursor")
            if not cursor or not d.get("data"):
                return out

    def image_bytes(self, board_id, item_id):
        """Original-Bild über die Image-Resource-URL. Gibt (bytes, content_type) zurück."""
        b = urllib.parse.quote(board_id, safe="")
        d = self.json(f"/boards/{b}/images/{item_id}?format=original")
        url = (d.get("data") or {}).get("imageUrl")
        if not url:
            raise wb.WBError(f"Bild {item_id}: keine imageUrl")
        url = url.replace("format=preview", "format=original")  # Item-GET liefert nur die Vorschau-URL
        r = self.get("", raw_url=url)
        # Die Quelle liefert hier meist erst JSON {"url": ...}; dann zweiter Abruf der eigentlichen Datei
        if r.status_code < 300 and "json" in r.headers.get("Content-Type", ""):
            url2 = r.json().get("url")
            if not url2:
                raise wb.WBError(f"Bild {item_id}: Antwort ohne url")
            r = self.get("", raw_url=url2)
        if r.status_code >= 300:
            raise wb.WBError(f"Bild {item_id}: Download HTTP {r.status_code}")
        return r.content, r.headers.get("Content-Type", "")


def _clean(d, keys):
    return {k: d[k] for k in keys if d.get(k) is not None}


def _body(it):
    t = it["type"]
    data, style = it.get("data") or {}, it.get("style") or {}
    body = {"position": _clean(it.get("position") or {}, ("x", "y")),
            "geometry": _clean(it.get("geometry") or {}, ("width", "height")),
            "style": style}
    if t == "frame":
        body["data"] = {"title": data.get("title", ""), "format": "custom"}
    elif t == "shape":
        body["data"] = {"shape": data.get("shape", "rectangle"), "content": data.get("content", "")}
    elif t == "text":
        body["data"] = {"content": data.get("content", "")}
        body["geometry"] = _clean(body["geometry"], ("width",))
    elif t == "sticky_note":
        body["data"] = {"content": data.get("content", ""), "shape": data.get("shape", "square")}
        body["geometry"] = _clean(body["geometry"], ("width",))
    return body


KIND = {"frame": "frames", "shape": "shapes", "text": "texts", "sticky_note": "sticky_notes"}


def inventory(its):
    cnt = {}
    for it in its:
        cnt[it["type"]] = cnt.get(it["type"], 0) + 1
    return cnt


def run(quell_board, wb_board, mapping_path=None, quelle=None, out=sys.stdout):
    quelle = quelle or Quelle()
    its = quelle.items(quell_board)
    cnt = inventory(its)
    skipped = {t: n for t, n in cnt.items() if t not in TYPES_IMPORTED}
    print(f"Quelle: {len(its)} Items {cnt}", file=out)
    mapping = {}
    # Frames zuerst, dann alle anderen; Kinder nach ihren Eltern (Frames können nicht verschachtelt sein)
    ordered = [i for i in its if i["type"] == "frame"] + [i for i in its if i["type"] != "frame"]
    fehler = []
    for it in ordered:
        t = it["type"]
        if t not in TYPES_IMPORTED:
            continue
        try:
            parent = (it.get("parent") or {}).get("id")
            wp = mapping.get(parent) if parent else None
            if t == "image":
                blob, ct = quelle.image_bytes(quell_board, it["id"])
                ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(
                    ct.split(";")[0], ".png")
                title = (it.get("data") or {}).get("title") or it["id"]
                pos, geo = it.get("position") or {}, it.get("geometry") or {}
                new = wb.image_bytes(pos.get("x", 0), pos.get("y", 0), geo.get("width", 400),
                                     f"{it['id']}{ext}", blob, title, wb_board, wp)
            else:
                body = _body(it)
                if wp:
                    body["parent"] = {"id": wp}
                new = wb.post(KIND[t], body, wb_board)
            mapping[it["id"]] = new
        except wb.WBError as e:
            fehler.append({"quell_id": it["id"], "typ": t, "fehler": str(e)})
    path = mapping_path or f"import_mapping_{quell_board}.json".replace("=", "")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"quell_board": quell_board, "wb_board": wb_board, "mapping": mapping,
                   "uebersprungen": skipped, "fehler": fehler}, f, ensure_ascii=False, indent=2)
    print(f"Importiert: {len(mapping)}; übersprungen {skipped or 0}; Fehler: {len(fehler)}; Mapping: {path}", file=out)
    return mapping
