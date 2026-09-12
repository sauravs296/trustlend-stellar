import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { enforceRouteRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRouteRateLimit(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete all notifications for this user
    await db.delete(notifications).where(eq(notifications.userId, user.id));

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
