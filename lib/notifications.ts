import { getDb } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";

export async function createNotification({
  userId,
  title,
  message,
  type,
}: {
  userId: string;
  title: string;
  message: string;
  type: string;
}) {
  const db = getDb();
  if (!db) return null;

  try {
    await db.insert(notifications).values({ userId, title, message, type });
  } catch (err) {
    console.error("Error creating notification", err);
  }
}
