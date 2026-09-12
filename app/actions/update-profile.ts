"use server";

/**
 * Server Actions: profile self-service.
 *
 * Every action resolves the caller from the session cookie and only ever
 * writes the caller's own `profiles` row.
 */

import { eq } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";

const profileSchema = z.object({
  full_name: z.string().min(2, "Full legal name must be at least 2 characters."),
  phone: z.string().min(7, "Please enter a valid phone number."),
  date_of_birth: z.string().optional().refine((val) => {
    if (!val || val.trim() === "") return true;
    const dob = new Date(val);
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    return !isNaN(dob.getTime()) && dob <= eighteenYearsAgo;
  }, "You must be at least 18 years old and provide a valid date."),
});

// Helper for sanitizing strings
function sanitize(input: string) {
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  });
}

interface ProfileUpdatePayload {
  full_name: string;
  phone: string;
  date_of_birth?: string;
}

interface ProfileUpdateResult {
  success: boolean;
  error?: string;
}

export async function updateUserProfile(
  payload: ProfileUpdatePayload
): Promise<ProfileUpdateResult> {
  try {
    const user = await getSessionUser();
    if (!user) {
      return { success: false, error: "You must be logged in to update your profile." };
    }
    const db = getDb();
    if (!db) {
      return { success: false, error: "Database unavailable." };
    }

    const validationResult = profileSchema.safeParse(payload);
    if (!validationResult.success) {
      return {
        success: false,
        error: validationResult.error.issues[0]?.message || "Invalid input data.",
      };
    }
    const validatedData = validationResult.data;

    const updates: Partial<typeof profiles.$inferInsert> = {
      fullName: sanitize(validatedData.full_name.trim()),
      phone: sanitize(validatedData.phone.trim()),
    };
    if (validatedData.date_of_birth && validatedData.date_of_birth.trim() !== "") {
      updates.dateOfBirth = sanitize(validatedData.date_of_birth.trim());
    }

    await db.update(profiles).set(updates).where(eq(profiles.id, user.id));

    console.log(`[TrustLend] Profile updated for user ${user.id}`);
    return { success: true };
  } catch (err) {
    console.error("[TrustLend] updateUserProfile unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}

/**
 * Persist the wallet the user connected in the dashboard. `null` disconnects.
 * The sign-in wallet on `users` is never changed here — that is the identity.
 */
export async function updateWalletAddress(
  nextAddress: string | null,
): Promise<ProfileUpdateResult> {
  try {
    const user = await getSessionUser();
    if (!user) {
      return { success: false, error: "Not authenticated." };
    }
    const db = getDb();
    if (!db) {
      return { success: false, error: "Database unavailable." };
    }
    if (nextAddress !== null && !/^G[A-Z2-7]{55}$/.test(nextAddress)) {
      return { success: false, error: "Invalid Stellar address." };
    }

    await db
      .update(profiles)
      .set({ walletAddress: nextAddress })
      .where(eq(profiles.id, user.id));

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
