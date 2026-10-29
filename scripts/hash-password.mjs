#!/usr/bin/env node
// Turns a password from stdin into the value for WHITEBOARD_ADMIN_PASSWORD_HASH.
// Prints only the hash, never the password. Format: scrypt:N:r:p:salt:hash (base64url).
// Usage:  read -rs PW && printf %s "$PW" | node scripts/hash-password.mjs
import crypto from "node:crypto"

const N = 32768, r = 8, p = 1, keylen = 32
const chunks = []
for await (const c of process.stdin) chunks.push(c)
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "")
if (password.length < 12) {
    console.error("Password too short (at least 12 characters).")
    process.exit(1)
}
const salt = crypto.randomBytes(16)
const key = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem: 256 * N * r })
console.log(`scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${key.toString("base64url")}`)
