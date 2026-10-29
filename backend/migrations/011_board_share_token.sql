-- Geheimer Kundenlink pro Board (Zugang-PR). Genau ein aktiver Token pro Board.
-- token_hash = sha256(token) hex, dient dem Lookup; der Token selbst wird in konstanter Zeit verglichen.
CREATE TABLE IF NOT EXISTS board_share_token (
    board_id text PRIMARY KEY REFERENCES board(id),
    token text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    created_at timestamp NOT NULL DEFAULT now()
);
