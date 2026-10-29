"""Tests mit lokalem Fake-Server: python3 -m unittest test_wb  (im Ordner client)"""
import io
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import wb
import wb_cli


class Fake(BaseHTTPRequestHandler):
    state = {}

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n)

    def do_ANY(self, m):
        S = Fake.state
        S.setdefault("calls", []).append((m, self.path, self.headers.get("Authorization"), self.headers.get("Content-Type")))
        raw = self._body()
        S["last_raw"] = raw
        if m == "POST" and self.path.endswith("/images"):
            S["image_raw"] = raw
        if S.get("fail", 0) > 0 and self.path.endswith("/shapes"):
            S["fail"] -= 1
            return self._send(503, {"message": "down"})
        if m == "POST" and self.path.endswith("/shapes"):
            return self._send(201, {"id": "s1"})
        if m == "POST" and self.path.rsplit("/", 1)[-1] in ("frames", "texts", "sticky_notes", "drawings", "connectors"):
            return self._send(201, {"id": "f1"})
        if m == "POST" and self.path.endswith("/images"):
            return self._send(201, {"id": "img1"})
        if self.path.endswith("/boards/B1") and m == "GET":
            return self._send(200, {"id": "B1", "name": "Alt", "archived": S.get("archived", False)})
        if self.path.endswith("/boards/B1") and m == "PATCH":
            body = json.loads(raw)
            S["patched_board"] = body
            S["archived"] = body.get("archived", S.get("archived", False))
            return self._send(200, {"id": "B1", "name": body.get("name", "Alt"), "archived": S["archived"]})
        if m == "GET" and "/boards?" in self.path:
            return self._send(200, {"data": [
                {"id": "B1", "name": "Aktiv", "neueKundenkommentare": 2, "archived": False},
                {"id": "B2", "name": "Alt-Board", "neueKundenkommentare": 0, "archived": True}]})
        if m == "GET" and "/items?" in self.path:
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            c = int(q.get("cursor", ["0"])[0])
            data = S["items"][c:c + 2]
            out = {"data": data, "total": len(S["items"])}
            if c + 2 < len(S["items"]):
                out["cursor"] = str(c + 2)
            return self._send(200, out)
        if m == "GET" and "/items/" in self.path:
            return self._send(200, {"id": "i1", "type": "sticky_note", "data": {"content": "alt"}})
        if m == "PATCH":
            S["patched"] = json.loads(raw)
            return self._send(200, {"id": "i1", "data": {"content": "neu"}})
        if m == "DELETE":
            return self._send(204 if not S.get("del_fail") else 500, {})
        self._send(404, {})

    do_GET = lambda s: s.do_ANY("GET")
    do_POST = lambda s: s.do_ANY("POST")
    do_PATCH = lambda s: s.do_ANY("PATCH")
    do_DELETE = lambda s: s.do_ANY("DELETE")


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        os.environ["WHITEBOARD_URL"] = f"http://127.0.0.1:{cls.srv.server_port}"
        os.environ["WHITEBOARD_API_TOKEN"] = "dummy-token-xyz"
        os.environ["WB_RETRY_WAIT"] = "0.01"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        Fake.state = {"items": [{"id": str(i), "type": "text"} for i in range(5)]}
        self.tmp = tempfile.mkdtemp()
        wb.set_log(os.path.join(self.tmp, "log.jsonl"))
        wb.use("B1")

    def lines(self):
        with open(wb.log_path()) as f:
            return [json.loads(l) for l in f]

    def test_retry_bei_5xx(self):
        Fake.state["fail"] = 2
        self.assertEqual(wb.post("shapes", {"data": {}}), "s1")
        self.assertEqual(sum(1 for c in Fake.state["calls"] if c[1].endswith("/shapes")), 3)
        self.assertEqual(Fake.state["calls"][0][2], "Bearer dummy-token-xyz")

    def test_retry_gibt_auf_ohne_secret_in_meldung(self):
        Fake.state["fail"] = 99
        with self.assertRaises(wb.WBError) as cm:
            wb.post("shapes", {})
        self.assertIn("503", str(cm.exception))
        self.assertNotIn("dummy-token-xyz", str(cm.exception))

    def test_paginierung(self):
        its = wb.items()
        self.assertEqual([i["id"] for i in its], ["0", "1", "2", "3", "4"])

    def test_update_protokolliert_alt_und_neu(self):
        wb.update("sticky_notes", "i1", data={"content": "neu"})
        self.assertEqual(Fake.state["patched"], {"data": {"content": "neu"}})
        e = self.lines()[0]
        self.assertEqual(e["alt"]["data"]["content"], "alt")
        self.assertEqual(e["neu"], {"data": {"content": "neu"}})
        self.assertEqual((e["board"], e["id"], e["status"]), ("B1", "i1", "ok"))
        self.assertTrue(e["zeit"])

    def test_zeichnungen_freihand_linie_pfeil(self):
        self.assertEqual(wb.freihand([(0, 0), (10, 5)], "#ff0000", 6), "f1")
        self.assertTrue(Fake.state["calls"][-1][1].endswith("/drawings"))
        self.assertEqual(json.loads(Fake.state["last_raw"]), {"data": {"points": [{"x": 0, "y": 0}, {"x": 10, "y": 5}]},
                                                                "style": {"strokeColor": "#ff0000", "strokeWidth": 6}})
        wb.pfeil(0, 0, 100, 50)
        self.assertTrue(Fake.state["calls"][-1][1].endswith("/connectors"))
        b = json.loads(Fake.state["last_raw"])
        self.assertEqual((b["data"]["shape"], b["endItem"]["position"]), ("arrow", {"x": 100, "y": 50}))
        wb.linie(0, 0, 1, 1)
        self.assertEqual(json.loads(Fake.state["last_raw"])["data"]["shape"], "line")
        wb.update("connectors", "i1", endItem={"position": {"x": 5, "y": 5}})
        e = self.lines()[0]
        self.assertEqual(e["neu"], {"endItem": {"position": {"x": 5, "y": 5}}})

    def test_delete_protokolliert_komplettes_objekt(self):
        wb.delete("i1")
        l = self.lines()
        self.assertEqual(l[0]["aktion"], "delete")
        self.assertEqual(l[0]["alt"]["type"], "sticky_note")
        self.assertEqual(l[-1]["status"], "ok")

    def test_delete_fehler_wird_protokolliert(self):
        Fake.state["del_fail"] = True
        with self.assertRaises(wb.WBError):
            wb.delete("i1")
        self.assertEqual(self.lines()[0]["alt"]["id"], "i1")
        self.assertNotEqual(self.lines()[-1]["status"], "ok")

    def _cli(self, *args):
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            wb_cli.main(list(args))
        return buf.getvalue()

    def test_board_archivieren_und_wiederherstellen(self):
        out = self._cli("board", "archivieren", "B1")
        self.assertEqual(Fake.state["patched_board"], {"archived": True})
        self.assertIn("nichts gelöscht", out)
        self.assertFalse(any(c[0] == "DELETE" for c in Fake.state["calls"]))
        e = self.lines()[-1]
        self.assertEqual((e["aktion"], e["alt"], e["neu"], e["status"]), ("board_update", {"archived": False}, {"archived": True}, "ok"))
        self._cli("board", "archivieren", "B1", "--wiederherstellen")
        self.assertEqual(Fake.state["patched_board"], {"archived": False})

    def test_board_umbenennen(self):
        out = self._cli("board", "umbenennen", "B1", "Neuer Name")
        self.assertEqual(Fake.state["patched_board"], {"name": "Neuer Name"})
        self.assertIn("Neuer Name", out)
        self.assertEqual(self.lines()[-1]["alt"], {"name": "Alt"})

    def test_board_liste_archiv_und_kommentare(self):
        out = self._cli("board", "liste")
        self.assertIn("2 neue Gästekommentare", out)
        self.assertNotIn("Alt-Board", out)
        self.assertIn("archiviert", self._cli("board", "liste", "--alle"))

    def test_multipart_format_wie_v2(self):
        p = os.path.join(self.tmp, "bild.png")
        open(p, "wb").write(b"\x89PNGfake")
        self.assertEqual(wb.image(10, 20, 300, p, "Titel"), "img1")
        ct = [c for c in Fake.state["calls"] if c[1].endswith("/images")][0][3]
        self.assertTrue(ct.startswith("multipart/form-data"))
        raw = Fake.state["last_raw"]
        self.assertIn(b'name="resource"; filename="bild.png"', raw)
        self.assertIn(b"image/png", raw)
        self.assertIn(b'name="data"', raw)
        self.assertIn(b'"position": {"x": 10, "y": 20}', raw)
        self.assertIn(b'"geometry": {"width": 300}', raw)

    def test_html_markdown_artig(self):
        h = wb.html("T", ["## A", "- p", "", "z"])
        self.assertEqual(h, "<p><strong>T</strong></p><p></p><p><strong>A</strong></p><p>· p</p><p></p><p>z</p>")

    def test_lesen_nur_gast(self):
        Fake.state["items"] = [
            {"id": "a", "type": "sticky_note", "createdBy": {"type": "api"}, "data": {"content": "<p>x</p>"}},
            {"id": "b", "type": "sticky_note", "createdBy": {"type": "customer"}, "data": {"content": "<p>Hallo</p><p>Welt</p>"}}]
        buf = io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(buf):
            wb_cli.main(["lesen", "B1", "--nur-gast"])
        out = buf.getvalue()
        self.assertIn("Hallo", out)
        self.assertIn("Welt", out)
        self.assertNotIn(" a ", out)

    def test_fehlende_env(self):
        old = os.environ.pop("WHITEBOARD_API_TOKEN")
        try:
            with self.assertRaises(wb.WBError):
                wb.boards()
        finally:
            os.environ["WHITEBOARD_API_TOKEN"] = old

    def test_import_reihenfolge_und_mapping(self):
        import import_board

        class M:
            def items(self, b):
                return [
                    {"id": "m2", "type": "shape", "parent": {"id": "m1"}, "data": {"shape": "round_rectangle", "content": "x"},
                     "position": {"x": 1, "y": 2}, "geometry": {"width": 5, "height": 6}, "style": {}},
                    {"id": "m1", "type": "frame", "data": {"title": "F"}, "position": {"x": 0, "y": 0}, "geometry": {"width": 9, "height": 9}},
                    {"id": "m3", "type": "image", "data": {}, "position": {"x": 0, "y": 0}, "geometry": {"width": 10}},
                    {"id": "m4", "type": "card", "data": {}}]

            def image_bytes(self, b, i):
                return b"\x89PNGx", "image/png"

        Fake.state["items"] = []
        out = io.StringIO()
        mp = os.path.join(self.tmp, "map.json")
        import_board.run("QB", "B1", mp, quelle=M(), out=out)
        posts = [c for c in Fake.state["calls"] if c[0] == "POST"]
        self.assertTrue(posts[0][1].endswith("/frames"))
        res = json.load(open(mp))
        self.assertEqual(set(res["mapping"]), {"m1", "m2", "m3"})
        self.assertEqual(res["uebersprungen"], {"card": 1})

    def _quelle_server(self, items, assets):
        class Q(BaseHTTPRequestHandler):
            seen = []

            def log_message(self, *a):
                pass

            def do_GET(self):
                Q.seen.append((self.path, self.headers.get("Authorization")))
                if self.headers.get("Authorization") != "Bearer quell-token":
                    return self._s(401, {})
                if self.path.startswith("/v2/boards/Q1/items"):
                    return self._s(200, {"data": items, "total": len(items)})
                if self.path == "/v2/boards/Q1":
                    return self._s(200, {"id": "Q1", "name": "Quell-Board"})
                self._s(404, {})

            def _s(self, code, obj):
                b = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)
        srv = HTTPServer(("127.0.0.1", 0), Q)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        return srv, Q

    def test_kopieren_aus_whiteboard_quelle(self):
        import kopieren
        assets = os.path.join(self.tmp, "assets")
        os.makedirs(assets)
        open(os.path.join(assets, "abc.png"), "wb").write(b"\x89PNGquelle")
        src = [
            {"id": "q1", "type": "frame", "data": {"title": "F"}, "position": {"x": 0, "y": 0}, "geometry": {"width": 9, "height": 9}},
            {"id": "q2", "type": "shape", "parent": {"id": "q1"}, "data": {"shape": "rectangle", "content": "<p>Hallo</p>"},
             "position": {"x": 1, "y": 2}, "geometry": {"width": 5, "height": 6}, "style": {"fillColor": "#fff"}},
            {"id": "q3", "type": "image", "data": {"title": "B", "imageUrl": "http://x/assets/abc.png"},
             "position": {"x": 0, "y": 0}, "geometry": {"width": 10}}]
        srv, Q = self._quelle_server(src, assets)
        url = f"http://127.0.0.1:{srv.server_port}"
        Fake.state["items"] = [{"id": "z1", "type": "frame"}, {"id": "z2", "type": "shape"}, {"id": "z3", "type": "image"}]
        out = io.StringIO()
        ziel = kopieren.run(url, "Q1", "B1", assets, os.path.join(self.tmp, "m.json"), out=out, token="quell-token")
        self.assertEqual(ziel, "B1")
        self.assertIn("GLEICH", out.getvalue())
        posts = [c for c in Fake.state["calls"] if c[0] == "POST"]
        self.assertEqual([c[1].rsplit("/", 1)[-1] for c in posts], ["frames", "shapes", "images"])
        self.assertIn(b"\x89PNGquelle", Fake.state["image_raw"])
        self.assertTrue(all(a == "Bearer quell-token" for _, a in Q.seen))
        self.assertNotIn("quell-token", out.getvalue())

    def test_kopieren_zaehlung_weicht_ab(self):
        import kopieren
        src = [{"id": "q1", "type": "text", "data": {"content": "x"}, "position": {"x": 0, "y": 0}, "geometry": {"width": 5}}]
        srv, _ = self._quelle_server(src, None)
        Fake.state["items"] = []  # Ziel hat nach dem Kopieren weniger Elemente als die Quelle
        with self.assertRaises(wb.WBError) as cm:
            kopieren.run(f"http://127.0.0.1:{srv.server_port}", "Q1", "B1", None, os.path.join(self.tmp, "m.json"),
                         out=io.StringIO(), token="quell-token")
        self.assertIn("Zählung", str(cm.exception))

    def test_kopieren_ohne_token(self):
        import kopieren
        old = os.environ.pop("KOPIE_QUELLE_TOKEN", None)
        try:
            with self.assertRaises(wb.WBError):
                kopieren.run("http://127.0.0.1:1", "Q1", "B1")
        finally:
            if old:
                os.environ["KOPIE_QUELLE_TOKEN"] = old


    # ---------- verbinden / hinweis / pfeil_kasten ----------
    def test_verbinden_setzt_standard_url_und_verlangt_token_aus_umgebung(self):
        import contextlib
        old = {k: os.environ.pop(k, None) for k in ("WHITEBOARD_URL", "WHITEBOARD_API_TOKEN")}
        buf = io.StringIO()
        try:
            with self.assertRaises(wb.WBError) as cm:
                wb.verbinden()
            self.assertIn("WHITEBOARD_API_TOKEN", str(cm.exception))
            os.environ["WHITEBOARD_API_TOKEN"] = "geheim-123"
            with contextlib.redirect_stdout(buf):
                url = wb.verbinden()
            self.assertEqual(url, "http://127.0.0.1:1337")
            self.assertEqual(os.environ["WHITEBOARD_URL"], url)
            self.assertNotIn("geheim-123", buf.getvalue() + str(url))
            os.environ["WHITEBOARD_URL"] = "http://x:1"
            self.assertEqual(wb.verbinden(), "http://x:1")  # vorhandene URL bleibt
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_basis_url_standard_ohne_umgebung(self):
        old = os.environ.pop("WHITEBOARD_URL", None)
        try:
            self.assertEqual(wb._base(), "http://127.0.0.1:1337/v2")
        finally:
            if old is not None:
                os.environ["WHITEBOARD_URL"] = old

    def test_panel_schriftgroesse_parameter(self):
        wb.panel(0, 0, 560, 300, "#fff", "T", ["x"])
        self.assertEqual(json.loads(Fake.state["last_raw"])["style"]["fontSize"], "18")
        wb.panel(0, 0, 560, 300, "#fff", "T", ["x"], size=26)
        self.assertEqual(json.loads(Fake.state["last_raw"])["style"]["fontSize"], "26")

    def test_hinweis_ist_panel_mit_geschaetzter_hoehe(self):
        wb.hinweis(0, 0, 560, "Hinweis", ["Zeile"] * 3)
        b = json.loads(Fake.state["last_raw"])
        self.assertTrue(Fake.state["calls"][-1][1].endswith("/shapes"))
        self.assertEqual(b["data"]["shape"], "round_rectangle")
        self.assertEqual(b["style"]["fontSize"], "26")
        self.assertEqual(b["geometry"]["width"], 560)
        self.assertGreater(b["geometry"]["height"], 3 * 26)
        wb.hinweis(0, 0, 560, "Hinweis", ["Zeile"], h=123)
        self.assertEqual(json.loads(Fake.state["last_raw"])["geometry"]["height"], 123)

    def test_pfeil_kasten_rand_zu_rand(self):
        a, b = (0, 0, 560, 200), (620, 0, 560, 200)  # (Mitte x, Mitte y, Breite, Höhe)
        wb.pfeil_kasten(a, b)
        d = json.loads(Fake.state["last_raw"])
        self.assertEqual((d["startItem"]["position"], d["endItem"]["position"]),
                         ({"x": 280, "y": 0}, {"x": 340, "y": 0}))
        wb.pfeil_kasten((0, 0, 560, 200), (0, 260, 560, 200))
        d = json.loads(Fake.state["last_raw"])
        self.assertEqual((d["startItem"]["position"], d["endItem"]["position"]),
                         ({"x": 0, "y": 100}, {"x": 0, "y": 160}))

    def test_import_quelle_api_aus_umgebung_sonst_abbruch(self):
        import import_board
        old = os.environ.pop("IMPORT_QUELLE_API", None)
        try:
            with self.assertRaises(wb.WBError) as cm:
                import_board.Quelle(token="t").get("/boards")
            self.assertIn("IMPORT_QUELLE_API", str(cm.exception))
            os.environ["IMPORT_QUELLE_API"] = "http://quelle.test/v2/"
            self.assertEqual(import_board.quell_api(), "http://quelle.test/v2")
        finally:
            os.environ.pop("IMPORT_QUELLE_API", None)
            if old is not None:
                os.environ["IMPORT_QUELLE_API"] = old


if __name__ == "__main__":
    unittest.main()
