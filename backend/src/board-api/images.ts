import crypto from "crypto"
import fs from "fs"
import path from "path"
import { getConfig } from "../config"
import { ApiError, ImageInfo } from "./convert"

export type ParsedImage = { ext: string; width: number; height: number }

/** Erkennt PNG, JPEG, GIF, WebP an den Magic Bytes und liest die Pixelgröße. SVG und alles andere wird abgelehnt. */
export function sniffImage(buf: Buffer): ParsedImage | null {
    if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { ext: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (buf.length > 10 && buf.subarray(0, 3).toString("latin1") === "GIF") {
        return { ext: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2
        while (i + 9 < buf.length) {
            if (buf[i] !== 0xff) {
                i++
                continue
            }
            const marker = buf[i + 1]
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                return { ext: "jpg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
            }
            i += 2 + buf.readUInt16BE(i + 2)
        }
        return null
    }
    if (buf.length > 30 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
        const kind = buf.subarray(12, 16).toString("latin1")
        if (kind === "VP8X") return { ext: "webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
        if (kind === "VP8 ") return { ext: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
        if (kind === "VP8L") {
            const b = buf.readUInt32LE(21)
            return { ext: "webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
        }
    }
    return null
}

/** Schreibt das Bild in ASSETS_DIR (lokales Dateisystem). Asset-ID = Hash + Endung, gleiche Datei = gleiche ID. */
export async function storeImage(buf: Buffer): Promise<ImageInfo> {
    const parsed = sniffImage(buf)
    if (!parsed || !parsed.width || !parsed.height) {
        throw new ApiError(400, "invalidParameter", "Only PNG, JPEG, GIF or WebP allowed")
    }
    const storage = getConfig().storageBackend
    if (storage.type !== "LOCAL") throw new ApiError(501, "notImplemented", "Image upload only with a local ASSETS_DIR")
    const assetId = `${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32)}.${parsed.ext}`
    await fs.promises.writeFile(path.join(storage.directory, assetId), buf)
    return { assetId, width: parsed.width, height: parsed.height }
}
