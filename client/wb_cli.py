"""Kommandozeile `wb` für das Whiteboard."""
import argparse
import json
import os
import re
import sys

import wb


def _text(html):
    if not html:
        return ""
    t = re.sub(r"</p>\s*<p>|<br\s*/?>", "\n", str(html))
    t = re.sub(r"<[^>]+>", "", t)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"')):
        t = t.replace(a, b)
    return t.strip()


def item_text(it):
    d = it.get("data") or {}
    return _text(d.get("content") or d.get("title") or "")


def format_item(it):
    cb = (it.get("createdBy") or {}).get("type", "?")
    pos = it.get("position") or {}
    kopf = f"[{it.get('type')}] {it.get('id')} von {cb}, {it.get('modifiedAt') or it.get('createdAt') or ''}"
    kopf += f" @({pos.get('x')},{pos.get('y')})"
    t = item_text(it)
    return kopf + ("\n" + "\n".join("    " + z for z in t.splitlines()) if t else "")


def cmd_board_neu(a):
    b = wb.board_create(a.name)
    print(f"Board-ID:    {b['id']}")
    print(f"Admin-Link:  {b.get('viewLink')}")
    print(f"Gastlink:  {b.get('shareLink')}")


def cmd_board_liste(a):
    for b in wb.boards():
        if b.get("archived") and not a.alle:
            continue
        extra = (" | archiviert" if b.get("archived") else "")
        n = b.get("neueKundenkommentare") or 0
        extra += f" | {n} neue Gästekommentare" if n else ""
        print(f"{b['id']} | {b.get('name')} | {b.get('modifiedAt') or b.get('createdAt') or ''}{extra}")


def cmd_board_archivieren(a):
    wb.board_update(a.id, archived=not a.wiederherstellen)
    print("Board wiederhergestellt." if a.wiederherstellen else "Board archiviert (nichts gelöscht, Wiederherstellen mit --wiederherstellen).")


def cmd_board_umbenennen(a):
    b = wb.board_update(a.id, name=a.name)
    print(f"Board heißt jetzt: {b.get('name')}")


def cmd_board_link(a):
    b = wb.board_get(a.id)
    print(f"Admin-Link:  {b.get('viewLink')}")
    print(f"Gastlink:  {b.get('shareLink')}")


def cmd_board_link_erneuern(a):
    d = wb.share_rotate(a.id)
    print("Gastlink erneuert. Der alte Link ist ungültig.")
    print(f"Gastlink:  {d.get('shareLink') or wb.board_get(a.id).get('shareLink')}")


def cmd_lesen(a):
    its = wb.items(a.id)
    if a.nur_gast:
        its = [i for i in its if (i.get("createdBy") or {}).get("type") == "customer"]
    if a.seit:
        its = [i for i in its if (i.get("modifiedAt") or i.get("createdAt") or "") >= a.seit]
    for i in its:
        print(format_item(i))
    print(f"\n{len(its)} Elemente", file=sys.stderr)


def cmd_export(a):
    os.makedirs(a.ordner, exist_ok=True)
    its = wb.items(a.id)
    bilder = 0
    for it in its:
        url = (it.get("data") or {}).get("imageUrl") or (it.get("data") or {}).get("url")
        if it.get("type") == "image" and url:
            if url.startswith("/"):
                url = os.environ["WHITEBOARD_URL"].rstrip("/") + url
            same = url.startswith(os.environ.get("WHITEBOARD_URL", "\0").rstrip("/"))
            r = wb.request("GET", "", raw_url=url, auth=same)
            if r.status_code < 300:
                ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
                       "image/gif": ".gif"}.get(r.headers.get("Content-Type", "").split(";")[0], ".bin")
                fn = f"{it['id']}{ext}"
                with open(os.path.join(a.ordner, fn), "wb") as f:
                    f.write(r.content)
                it["_datei"] = fn
                bilder += 1
            else:
                print(f"Bild {it['id']}: HTTP {r.status_code}", file=sys.stderr)
    with open(os.path.join(a.ordner, "items.json"), "w", encoding="utf-8") as f:
        json.dump({"board": wb.board_get(a.id), "items": its}, f, ensure_ascii=False, indent=2)
    print(f"{len(its)} Elemente und {bilder} Bilder nach {a.ordner} exportiert")


def cmd_import(a):
    import import_board
    import_board.run(a.quelle_board, a.wb_id, a.mapping)


def cmd_kopieren(a):
    import kopieren
    kopieren.run(a.quelle_url, a.quelle_board, a.ziel_id, a.quelle_assets, a.mapping)


def build_parser():
    p = argparse.ArgumentParser(prog="wb", description="Whiteboard-Befehl: Boards anlegen, lesen, exportieren, aus einem anderen Board importieren")
    s = p.add_subparsers(dest="cmd", required=True)
    b = s.add_parser("board", help="Boards verwalten").add_subparsers(dest="sub", required=True)
    x = b.add_parser("neu", help="Neues Board anlegen"); x.add_argument("name", help="Name des Boards"); x.set_defaults(f=cmd_board_neu)
    x = b.add_parser("liste", help="Boards auflisten (archivierte nur mit --alle)"); x.add_argument("--alle", action="store_true", help="auch archivierte Boards"); x.set_defaults(f=cmd_board_liste)
    x = b.add_parser("archivieren", help="Board archivieren (Flag, nichts wird gelöscht)"); x.add_argument("id", help="Board-ID"); x.add_argument("--wiederherstellen", action="store_true", help="Archiv-Flag wieder entfernen"); x.set_defaults(f=cmd_board_archivieren)
    x = b.add_parser("umbenennen", help="Board umbenennen"); x.add_argument("id", help="Board-ID"); x.add_argument("name", help="Neuer Name"); x.set_defaults(f=cmd_board_umbenennen)
    x = b.add_parser("link", help="Admin- und Gastlink anzeigen"); x.add_argument("id", help="Board-ID"); x.set_defaults(f=cmd_board_link)
    x = b.add_parser("link-erneuern", help="Gastlink neu erzeugen (alter Link wird ungültig)"); x.add_argument("id", help="Board-ID"); x.set_defaults(f=cmd_board_link_erneuern)
    x = s.add_parser("lesen", help="Elemente eines Boards als Text ausgeben")
    x.add_argument("id", help="Board-ID")
    x.add_argument("--nur-gast", action="store_true", help="nur von Gästen angelegte Elemente")
    x.add_argument("--seit", metavar="ISO", help="nur Elemente, die seit diesem Zeitpunkt (ISO-8601) erstellt oder geändert wurden")
    x.set_defaults(f=cmd_lesen)
    x = s.add_parser("export", help="Items-JSON und Bilder in einen Ordner schreiben (für die Git-Ablage)")
    x.add_argument("id", help="Board-ID"); x.add_argument("ordner", help="Zielordner"); x.set_defaults(f=cmd_export)
    x = s.add_parser("import", help="Fremdes Board in ein Whiteboard-Board übernehmen (Quell-Token: Umgebung IMPORT_QUELLE_TOKEN)")
    x.add_argument("--quelle-board", required=True, metavar="ID", help="ID des Quell-Boards")
    x.add_argument("wb_id", help="Ziel-Board-ID im Whiteboard")
    x.add_argument("--mapping", help="Pfad für das Mapping quell_id -> wb_id (Default: import_mapping_<quell-board>.json)")
    x.set_defaults(f=cmd_import)
    x = s.add_parser("kopieren", help="Board von einem anderen Whiteboard-Server kopieren (Quell-Token: Umgebung KOPIE_QUELLE_TOKEN)")
    x.add_argument("quelle_url", help="Basis-URL des Quell-Servers, z. B. http://127.0.0.1:1340")
    x.add_argument("--quelle-board", required=True, metavar="ID", help="ID des Quell-Boards")
    x.add_argument("--ziel-id", help="vorhandenes Ziel-Board (sonst wird ein neues mit dem Namen der Quelle angelegt)")
    x.add_argument("--quelle-assets", metavar="ORDNER", help="lokaler Assets-Ordner der Quelle (Bilder von dort lesen)")
    x.add_argument("--mapping", help="Pfad für das Mapping quell_id -> ziel_id")
    x.set_defaults(f=cmd_kopieren)
    return p


def main(argv=None):
    a = build_parser().parse_args(argv)
    try:
        a.f(a)
    except wb.WBError as e:
        sys.exit(f"Fehler: {e}")


if __name__ == "__main__":
    main()
