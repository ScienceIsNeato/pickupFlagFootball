CREATE TYPE "public"."chat_email_pref" AS ENUM('off', 'each', 'hourly', 'daily');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "chat_email_pref" "chat_email_pref" DEFAULT 'hourly' NOT NULL;