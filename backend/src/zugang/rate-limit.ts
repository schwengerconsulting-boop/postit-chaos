// Einfaches Fenster-Limit im Speicher: max. `limit` Fehlversuche je Schlüssel in `windowMs`.
export class FailureLimiter {
    private failures = new Map<string, number[]>()
    constructor(
        private limit: number,
        private windowMs: number,
        private now: () => number = Date.now,
    ) {}

    private recent(key: string): number[] {
        const t = this.now()
        const list = (this.failures.get(key) ?? []).filter((ts) => t - ts < this.windowMs)
        if (list.length) this.failures.set(key, list)
        else this.failures.delete(key)
        return list
    }
    isBlocked(key: string): boolean {
        return this.recent(key).length >= this.limit
    }
    fail(key: string) {
        const list = this.recent(key)
        list.push(this.now())
        this.failures.set(key, list)
    }
    reset(key: string) {
        this.failures.delete(key)
    }
}
