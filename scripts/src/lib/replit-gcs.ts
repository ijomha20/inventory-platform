/**
 * Replit GCS Sidecar Storage helper.
 *
 * Replit injects GCS credentials via a local HTTP sidecar at 127.0.0.1:1106
 * rather than via the standard ADC (application default credentials) flow.
 * Using `new Storage()` directly will throw "Could not load default credentials"
 * inside Replit. This helper builds a Storage client wired to the sidecar,
 * mirroring the pattern in artifacts/api-server/src/lib/bbObjectStore.ts.
 *
 * Used by all backup/restore scripts that touch the workspace bucket.
 */
import { Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";

export function makeReplitStorage(): Storage {
  return new Storage({
    credentials: {
      audience:           "replit",
      subject_token_type: "access_token",
      token_url:          `${SIDECAR}/token`,
      type:               "external_account",
      credential_source: {
        url:    `${SIDECAR}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    } as any,
    projectId: "",
  });
}

export function getRequiredBucketId(): string {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is required");
  return id;
}
