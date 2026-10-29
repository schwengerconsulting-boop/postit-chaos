// harmaja 0.24 deklariert kein ElementChildrenAttribute. TypeScript prueft deshalb <>...</> gegen
// Fragment({ children }) ohne Kinder und meldet TS2741. Zur Laufzeit gibt es keinen Unterschied
// (die Kinder kommen als createElement-Argumente); nur der Typ-Check wird korrekt angebunden.
import "harmaja"

declare global {
    namespace JSX {
        interface ElementChildrenAttribute {
            children: {}
        }
    }
}
