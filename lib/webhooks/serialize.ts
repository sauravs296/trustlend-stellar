import type { WebhookEndpoint } from "@/lib/db/schema";

/** Wire format (snake_case) shared by the admin API and scripts/webhook-listener.ts. */
export function serializeWebhook(row: WebhookEndpoint) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    platform: row.platform,
    topic: row.topic,
    is_active: row.isActive,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
