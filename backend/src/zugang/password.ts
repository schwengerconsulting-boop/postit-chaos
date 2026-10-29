import crypto from "crypto"

// Format: scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>  (keine "$", damit .env/systemd nichts expandieren)
const DEFAULT = { N: 32768, r: 8, p: 1, keylen: 32 }

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
            err ? reject(err) : resolve(key),
        )
    })
}

export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16)
    const { N, r, p, keylen } = DEFAULT
    const key = await scryptAsync(password, salt, N, r, p, keylen)
    return `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${key.toString("base64url")}`
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
    // Auch ohne gültigen Hash gleiche Arbeit leisten, damit kein Zeitunterschied entsteht.
    const parts = (stored ?? "").split(":")
    const valid = parts.length === 6 && parts[0] === "scrypt"
    const [N, r, p] = valid ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : [DEFAULT.N, DEFAULT.r, DEFAULT.p]
    if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20 || r > 32 || p > 16) return false
    const salt = valid ? Buffer.from(parts[4], "base64url") : Buffer.alloc(16)
    const expected = valid ? Buffer.from(parts[5], "base64url") : Buffer.alloc(DEFAULT.keylen)
    if (expected.length === 0) return false
    const actual = await scryptAsync(password, salt, N, r, p, expected.length)
    return crypto.timingSafeEqual(actual, expected) && valid
}
