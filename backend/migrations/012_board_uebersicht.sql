-- Board-Übersicht: Archiv-Flag (Archivieren löscht nichts) und Zeitpunkt des letzten Admin-Besuchs je Board
-- (Grundlage für "N neue Kundenkommentare").
ALTER TABLE board ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE board ADD COLUMN IF NOT EXISTS admin_last_opened timestamptz NULL;
