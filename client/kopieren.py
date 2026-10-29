"""Board von einem Whiteboard-Server auf einen anderen kopieren (z. B. lokale Vorschau -> Produktion).
Die Quelle wird nur GELESEN. Token der Quelle aus der Umgebung (KOPIE_QUELLE_TOKEN), nie als Argument, nie ausgeben."""
import collections
import os
import sys
import urllib.parse

import requests

import import_board
import wb


class WBQuelle(import_board.Quelle):
    """Quelle ist selbst ein Whiteboard (Board-API /v2). Bilder: aus --quelle-assets (lokaler Ordner),
    sonst per Download der imageUrl mit Bearer (Assets brauchen auf dem Server sonst eine Sitzung)."""

    def __init__(self, url, token, assets_dir=None):
        self._tok = token
        self._base = url.rstrip("/") + "/v2"
        self._assets = assets_dir
        self._items = {}

    def get(self, path, raw_url=None, stream=False):
        return requests.get(raw_url or self._base + path, headers={"Authorization": f"Bearer {self._tok}"},
                            timeout=60, stream=stream)

    def board_name(self, board_id):
        return self.json(f"/boards/{urllib.parse.quote(board_id, safe='')}").get("name") or board_id

    def items(self, board_id):
        out, cursor = [], None
        b = urllib.parse.quote(board_id, safe="")
        while True:
            d = self.json(f"/boards/{b}/items?limit=50" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else ""))
            out += d.get("data", [])
            cursor = d.get("cursor")
            if not cursor or not d.get("data"):
                break
        self._items = {i["id"]: i for i in out}
        return out

    def image_bytes(self, board_id, item_id):
        data = (self._items.get(item_id) or {}).get("data") or {}
        url = data.get("imageUrl") or data.get("url")
        if not url:
            raise wb.WBError(f"Bild {item_id}: keine imageUrl")
        name = os.path.basename(urllib.parse.urlparse(url).path)
        if self._assets:
            p = os.path.join(self._assets, name)
            if not os.path.isfile(p):
                raise wb.WBError(f"Bild {item_id}: {name} nicht im Assets-Ordner")
            with open(p, "rb") as f:
                blob = f.read()
            ct = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
                  "gif": "image/gif"}.get(name.rsplit(".", 1)[-1].lower(), "")
            return blob, ct
        r = self.get("", raw_url=url if url.startswith("http") else self._base[:-3] + url)
        if r.status_code >= 300:
            raise wb.WBError(f"Bild {item_id}: Download HTTP {r.status_code} (--quelle-assets nutzen)")
        return r.content, r.headers.get("Content-Type", "")


def zaehlung(its):
    return dict(collections.Counter(i["type"] for i in its))


def run(quell_url, quell_board, ziel_board=None, assets_dir=None, mapping_path=None, out=sys.stdout, token=None):
    token = token or os.environ.get("KOPIE_QUELLE_TOKEN")
    if not token:
        raise wb.WBError("KOPIE_QUELLE_TOKEN ist nicht gesetzt")
    q = WBQuelle(quell_url, token, assets_dir)
    if not ziel_board:
        b = wb.board_create(q.board_name(quell_board))
        ziel_board = b["id"]
        print(f"Ziel-Board angelegt: {ziel_board}\nAdmin-Link:  {b.get('viewLink')}\nGastlink:    {b.get('shareLink')}", file=out)
    import_board.run(quell_board, ziel_board, mapping_path or f"kopie_mapping_{quell_board}.json", quelle=q, out=out)
    quelle_n = zaehlung(q.items(quell_board))
    ziel_n = zaehlung(wb.items(ziel_board))
    ok = quelle_n == ziel_n
    print(f"Zählung Quelle: {quelle_n}\nZählung Ziel:   {ziel_n}\n{'GLEICH' if ok else 'ABWEICHUNG'}", file=out)
    if not ok:
        raise wb.WBError("Zählung Quelle/Ziel weicht ab")
    return ziel_board
