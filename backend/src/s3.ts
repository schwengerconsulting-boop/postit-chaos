import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

let s3Instance: S3Client | null = null

export const s3 = () => {
    s3Instance = s3Instance || new S3Client({ region: process.env.S3_REGION })
    return s3Instance
}

// Bucket und Region kommen aus S3_BUCKET und S3_REGION.
// Hinweis: getSignedUrl ist in SDK v3 asynchron.
export function getSignedPutUrl(Key: string): Promise<string> {
    const signedUrlExpireSeconds = 60 * 5
    const Bucket = process.env.S3_BUCKET
    if (!Bucket) throw new Error("S3_BUCKET is not set")
    return getSignedUrl(s3(), new PutObjectCommand({ Bucket, Key }), {
        expiresIn: signedUrlExpireSeconds,
    })
}
