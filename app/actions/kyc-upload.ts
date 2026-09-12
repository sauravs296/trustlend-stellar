"use server";

/**
 * Server Action: Handle KYC document upload
 * Validates the caller, stores the file in Vercel Blob (private), and records
 * the reference on the caller's profile.
 */

import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";

const VALID_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function uploadKYCDocument(formData: FormData): Promise<{
  success: boolean;
  path?: string;
  error?: string;
}> {
  try {
    const user = await getSessionUser();
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }
    const db = getDb();
    if (!db) {
      return { success: false, error: "Database unavailable" };
    }

    const file = formData.get("government_id") as File | null;
    if (!file) {
      return { success: false, error: "No file provided" };
    }
    if (!VALID_TYPES.includes(file.type)) {
      return {
        success: false,
        error: "Invalid file type. Please upload JPG, PNG, WebP, or PDF.",
      };
    }
    if (file.size > MAX_BYTES) {
      return { success: false, error: "File too large. Maximum 10MB allowed." };
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return {
        success: false,
        error: "Document storage is not configured yet (BLOB_READ_WRITE_TOKEN missing).",
      };
    }

    // Object key: kyc/{userId}/government_id_{timestamp}_{random}.{ext}
    const ext = file.name.includes(".") ? file.name.split(".").pop() : undefined;
    const filename = `government_id_${Date.now()}_${Math.random().toString(36).substring(7)}${ext ? `.${ext}` : ""}`;
    const filepath = `kyc/${user.id}/${filename}`;

    const blob = await put(filepath, file, {
      access: "private",
      contentType: file.type,
      addRandomSuffix: false,
    });

    await db
      .update(profiles)
      .set({
        governmentIdIpfsHash: blob.pathname,
        governmentIdUrl: blob.url,
        kycStatus: "submitted",
        kycSubmittedAt: new Date(),
      })
      .where(eq(profiles.id, user.id));

    console.log(`[TrustLend] KYC document uploaded for user ${user.id}: ${blob.pathname}`);

    return { success: true, path: blob.pathname };
  } catch (error) {
    console.error("[TrustLend] KYC upload failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}
