import { CUSTOMER_COLOR } from "../../../common/src/colors"
import { PersistableBoardItemEvent } from "../../../common/src/domain"

/**
 * Spiegelt die Server-Regeln für Kunden (backend/src/zugang/ws-guard.ts): neue Elemente bekommen createdBy=customer,
 * die gewählte Farbe bleibt (nur ein Post-it ganz ohne Farbe bekommt die Kundenfarbe), createdBy lässt sich nicht
 * ändern. Fremde Elemente umzufärben verwirft der Server; das hier sorgt nur dafür, dass der Kunde es sofort sieht.
 */
export function applyCustomerRules<E extends PersistableBoardItemEvent>(event: E): E {
    if (event.action === "item.add") {
        return {
            ...event,
            items: event.items.map((i) => ({
                ...i,
                createdBy: "customer" as const,
                ...(i.type === "note" && !i.color ? { color: CUSTOMER_COLOR } : {}),
            })),
        }
    }
    if (event.action === "item.update") {
        return {
            ...event,
            items: event.items.map((i) => {
                const { createdBy, ...rest } = i as any
                return rest
            }),
        }
    }
    return event
}
