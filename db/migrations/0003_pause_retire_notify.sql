ALTER TYPE "public"."notification_kind" ADD VALUE 'SERIES_PAUSED';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'SERIES_RETIRED';--> statement-breakpoint
ALTER TABLE "notifications_sent" DROP CONSTRAINT "notif_one_parent";--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notif_one_parent" CHECK (num_nonnulls("notifications_sent"."attempt_id", "notifications_sent"."occurrence_id") <= 1 and num_nonnulls("notifications_sent"."attempt_id", "notifications_sent"."occurrence_id", "notifications_sent"."game_id") >= 1);