ALTER TABLE "users" ADD COLUMN "password_reset_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_expires" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_users_password_reset_token" ON "users" USING btree ("password_reset_token") WHERE "users"."password_reset_token" is not null;