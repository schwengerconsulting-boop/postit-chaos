"""Nur-Lesen-Bestandsaufnahme eines Quell-Boards: Anzahl je Typ, Bildgrößen (Pixel/Bytes)."""
import sys
import import_board as mi

if __name__ == "__main__":
    m = mi.Quelle()
    if len(sys.argv) < 2:
        for b in m.boards():
            print(b["id"], "|", b["name"], "|", b.get("modifiedAt"))
        sys.exit()
    bid = sys.argv[1]
    its = m.items(bid)
    print("Typen:", mi.inventory(its))
    for it in its:
        if it["type"] == "image":
            try:
                blob, ct = m.image_bytes(bid, it["id"])
                print("Bild", it["id"], (it.get("geometry") or {}).get("width"), "x", (it.get("geometry") or {}).get("height"), ct, len(blob), "Bytes")
            except Exception as e:
                print("Bild", it["id"], "Fehler:", e)
