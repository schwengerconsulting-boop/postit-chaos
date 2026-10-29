import Cookies from "cookies"
import { IncomingMessage } from "http"

// Ourboards eigene Benutzeranmeldung (JWT-Cookie "user") ist entfernt. Zugang: siehe ./zugang/.
// Das Cookie "sessionId" setzt das Frontend nach dem Beitritt (Socket-ID) und dient nur der Zuordnung der Yjs-Verbindung.
export function getSessionIdFromCookies(req: IncomingMessage): string | null {
    return new Cookies(req, null as any).get("sessionId") ?? null
}
