"use server";

/**
 * Admin KYC verification actions
 * Only admins can verify/reject user identity documents
 */

import { desc, eq, inArray, sql } from "drizzle-orm";
import { requireApiAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { profiles, reputationSnapshots } from "@/lib/db/schema";

export async function verifyKYCDocument(
  userId: string,
  approved: boolean,
  rejectionReason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    try {
      await requireApiAdmin();
    } catch {
      return { success: false, error: "Unauthorized: Admin access required" };
    }
    const db = getDb();
    if (!db) {
      return { success: false, error: "Database not available" };
    }

    await db
      .update(profiles)
      .set(
        approved
          ? { kycStatus: "verified", kycVerifiedAt: new Date(), kycRejectionReason: null }
          : {
              kycStatus: "rejected",
              kycRejectionReason: rejectionReason || "Document does not meet requirements",
            },
      )
      .where(eq(profiles.id, userId));

    // When KYC is approved, seed an initial reputation score from real profile fields.
    if (approved) {
      const [userProfile] = await db
        .select({ fullName: profiles.fullName, phone: profiles.phone, countryCode: profiles.countryCode })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      let initialScore = 70;
      if (userProfile?.fullName?.trim()) initialScore += 15;
      if (userProfile?.phone?.trim()) initialScore += 15;
      if (userProfile?.countryCode?.trim()) initialScore += 10;
      const clamped = Math.max(0, Math.min(750, initialScore));

      await db
        .insert(reputationSnapshots)
        .values({ userId, scoreTotal: clamped })
        .onConflictDoUpdate({
          target: reputationSnapshots.userId,
          set: { scoreTotal: clamped, updatedAt: sql`now()` },
        });

      console.log(`[TrustLend] Reputation snapshot seeded for ${userId}: score=${clamped}`);
    }

    console.log(`[TrustLend] KYC ${approved ? "approved" : "rejected"} for user ${userId}`);
    return { success: true };
  } catch (error) {
    console.error("[TrustLend] KYC verification failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

export interface PendingKycDocument {
  id: string;
  email: string;
  full_name: string;
  kyc_status: string;
  government_id_url: string;
  submitted_at: string;
}

export async function getPendingKYCDocuments(): Promise<PendingKycDocument[] | null> {
  try {
    try {
      await requireApiAdmin();
    } catch {
      return null;
    }
    const db = getDb();
    if (!db) return null;

    const rows = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        kycStatus: profiles.kycStatus,
        documentPath: profiles.governmentIdIpfsHash,
        kycSubmittedAt: profiles.kycSubmittedAt,
      })
      .from(profiles)
      .where(inArray(profiles.kycStatus, ["submitted", "verified", "rejected"]))
      .orderBy(desc(profiles.kycSubmittedAt));

    return rows.map((doc) => ({
      id: doc.id,
      email: "hidden",
      full_name: doc.fullName,
      kyc_status: doc.kycStatus,
      // Documents are private; admins view them through the streaming route.
      government_id_url: doc.documentPath
        ? `/api/admin/kyc/document?path=${encodeURIComponent(doc.documentPath)}`
        : "",
      submitted_at: doc.kycSubmittedAt ? doc.kycSubmittedAt.toISOString() : "",
    }));
  } catch (error) {
    console.error("[TrustLend] Failed to fetch KYC documents:", error);
    return null;
  }
}
