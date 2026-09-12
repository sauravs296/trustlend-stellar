import { NextRequest, NextResponse } from "next/server";
import { enforceRouteRateLimit } from "@/lib/rate-limit";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { reputationEvents } from "@/lib/db/schema";

/**
 * POST /api/tasks/complete
 * Marks a platform task as completed and awards trust score points.
 *
 * Body: { taskId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRouteRateLimit(request);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { taskId } = await request.json() as { taskId: string };
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    // Find the platform task definition
    const PLATFORM_TASKS = getPlatformTasks();
    const task = PLATFORM_TASKS.find((t) => t.id === taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Each task can only be claimed once per user.
    const [existing] = await db
      .select({ id: reputationEvents.id })
      .from(reputationEvents)
      .where(
        and(
          eq(reputationEvents.userId, user.id),
          eq(reputationEvents.sourceType, "task_completion"),
          eq(reputationEvents.sourceKey, taskId),
        ),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "Task already completed. Each task can only be claimed once." },
        { status: 409 },
      );
    }

    // The reputation_snapshots trigger folds this into the user's score.
    await db.insert(reputationEvents).values({
      userId: user.id,
      sourceType: "task_completion",
      sourceKey: taskId,
      pointsDelta: task.points,
      reason: `Completed: ${task.title}`,
    });

    const pointsAwarded = task.points;

    return NextResponse.json({
      taskId,
      pointsAwarded,
      message: `+${pointsAwarded} trust points awarded for completing "${task.title}"`,
    });
  } catch (err) {
    console.error("Task complete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Canonical list of platform tasks. Server-side source of truth. */
export function getPlatformTasks() {
  return [
    {
      id:         "task_stellar_basics",
      title:      "Learn: How Stellar Payments Work",
      description:
        "Read TrustLend's guide on how Stellar (XLM) enables fast, low-cost cross-border payments " +
        "and how it's used to fund and repay loans on this platform.",
      category:   "Financial Literacy",
      points:     30,
      difficulty: "Easy",
      cta:        "Mark as Read",
      learnUrl:   "https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts",
    },
    {
      id:         "task_credit_score",
      title:      "Learn: How Your Trust Score Is Calculated",
      description:
        "Understand the 5 factors that build your TrustLend trust score: KYC verification, " +
        "on-time repayment, task completion, account age, and transaction history.",
      category:   "Platform Knowledge",
      points:     25,
      difficulty: "Easy",
      cta:        "I've Read This",
      learnUrl:   null, // inline content shown in UI
    },
    {
      id:         "task_defi_lending",
      title:      "Learn: DeFi Lending vs Traditional Banking",
      description:
        "Explore the key differences between decentralised P2P lending (like TrustLend) and " +
        "traditional bank loans — including how interest, collateral, and transparency work on-chain.",
      category:   "Financial Literacy",
      points:     35,
      difficulty: "Medium",
      cta:        "Mark as Completed",
      learnUrl:   "https://stellar.org/learn/the-basics",
    },
  ] as const;
}
