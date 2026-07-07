CREATE TYPE "public"."area_status" AS ENUM('DORMANT', 'PRIMED', 'IN_FORMATION', 'SCHEDULED', 'STALLED');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('OPEN', 'CONFIRMED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."donation_status" AS ENUM('unset', 'subscribed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('push', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('GAME_PROPOSED', 'GAME_ON', 'STALLED_NOTICE', 'POLL_ASK', 'WEEK_ON', 'WEEK_OFF');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('pending', 'polling', 'tallying', 'scheduled', 'skipped', 'notifying', 'awaiting_game', 'played', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."series_status" AS ENUM('active', 'paused', 'retired');--> statement-breakpoint
CREATE TABLE "activity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"n_spark" integer DEFAULT 8 NOT NULL,
	"n_warm" integer DEFAULT 5 NOT NULL,
	"p_min" integer DEFAULT 6 NOT NULL,
	"s_min" integer DEFAULT 1 NOT NULL,
	"options_cap" integer DEFAULT 6 NOT NULL,
	"suggest_window" interval DEFAULT '48 hours' NOT NULL,
	"avail_window" interval DEFAULT '48 hours' NOT NULL,
	"restall_interest" integer DEFAULT 3 NOT NULL,
	"restall_days" integer DEFAULT 14 NOT NULL,
	"max_time_retries" integer DEFAULT 2 NOT NULL,
	"per_user_weekly_cap" integer DEFAULT 2 NOT NULL,
	"ignore_decay_windows" integer DEFAULT 3 NOT NULL,
	"base_h3_res" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_types_slug_unique" UNIQUE("slug"),
	CONSTRAINT "chk_activity_s_min" CHECK ("activity_types"."s_min" > 0),
	CONSTRAINT "activity_types_check" CHECK ("activity_types"."n_spark" > 0 and "activity_types"."n_warm" >= 0 and "activity_types"."p_min" > 0 and "activity_types"."options_cap" > 0 and "activity_types"."restall_interest" >= 0 and "activity_types"."restall_days" >= 0 and "activity_types"."max_time_retries" >= 0 and "activity_types"."base_h3_res" between 0 and 15 and "activity_types"."per_user_weekly_cap" >= 0 and "activity_types"."ignore_decay_windows" >= 0)
);
--> statement-breakpoint
CREATE TABLE "area_captains" (
	"area_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"became_captain_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "area_captains_area_id_user_id_pk" PRIMARY KEY("area_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "area_optouts" (
	"area_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "area_optouts_area_id_user_id_pk" PRIMARY KEY("area_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_type_id" uuid NOT NULL,
	"h3_cell" bigint NOT NULL,
	"display_city" text,
	"display_zip" text,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"status" "area_status" DEFAULT 'DORMANT' NOT NULL,
	"stall_count" integer DEFAULT 0 NOT NULL,
	"last_round_at" timestamp with time zone,
	"next_trigger_at" timestamp with time zone,
	"next_trigger_interest" integer,
	"n_spark_override" integer,
	"p_min_override" integer,
	"min_players_to_schedule" integer DEFAULT 6 NOT NULL,
	"polling_window_length" interval DEFAULT '24 hours' NOT NULL,
	"polling_start_offset" interval DEFAULT '48 hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "areas_check" CHECK ("areas"."center_lat" between -90 and 90 and "areas"."center_lng" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "attempt_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"interested" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_type_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "attempt_status" DEFAULT 'OPEN' NOT NULL,
	"proposer_id" uuid NOT NULL,
	"place_text" text NOT NULL,
	"place_lat" double precision,
	"place_lng" double precision,
	"proposed_start" timestamp with time zone NOT NULL,
	"recur_dow" integer,
	"recur_time" time,
	"catchment_cells" bigint[] DEFAULT '{}' NOT NULL,
	"cohort_user_ids" uuid[] DEFAULT '{}' NOT NULL,
	"interest_closes_at" timestamp with time zone NOT NULL,
	"scheduled_game_id" uuid,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_attendance" (
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_attendance_game_id_user_id_occurrence_date_pk" PRIMARY KEY("game_id","user_id","occurrence_date"),
	CONSTRAINT "game_attendance_status_check" CHECK ("game_attendance"."status" in ('in','out'))
);
--> statement-breakpoint
CREATE TABLE "game_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"status" "occurrence_status" DEFAULT 'pending' NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"poll_opens_at" timestamp with time zone NOT NULL,
	"poll_closes_at" timestamp with time zone NOT NULL,
	"in_count" integer DEFAULT 0 NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_roster" (
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'soft_promise' NOT NULL,
	"default_status" text DEFAULT 'in' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_roster_game_id_user_id_pk" PRIMARY KEY("game_id","user_id"),
	CONSTRAINT "game_roster_default_status_check" CHECK ("game_roster"."default_status" in ('in','out'))
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_type_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"origin_attempt_id" uuid,
	"place_text" text NOT NULL,
	"place_lat" double precision,
	"place_lng" double precision,
	"scheduled_start" timestamp with time zone NOT NULL,
	"status" "series_status" DEFAULT 'active' NOT NULL,
	"confirmed_count" integer DEFAULT 0 NOT NULL,
	"min_players" integer,
	"color" text,
	"is_standing" boolean DEFAULT false NOT NULL,
	"recur_dow" integer,
	"recur_time" time,
	"paused_until" date,
	"pause_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_min_players_range" CHECK ("games"."min_players" is null or "games"."min_players" between 2 and 60),
	CONSTRAINT "games_recur_dow_check" CHECK ("games"."recur_dow" is null or "games"."recur_dow" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "interest_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_type_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"h3_base" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"consecutive_ignored" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_aggregates" (
	"activity_type_id" uuid NOT NULL,
	"resolution" integer NOT NULL,
	"h3_cell" bigint NOT NULL,
	"interest_count" integer DEFAULT 0 NOT NULL,
	"has_game" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_aggregates_activity_type_id_resolution_h3_cell_pk" PRIMARY KEY("activity_type_id","resolution","h3_cell")
);
--> statement-breakpoint
CREATE TABLE "notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_id" uuid,
	"occurrence_id" uuid,
	"game_id" uuid,
	"kind" "notification_kind" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "notif_one_parent" CHECK (("notifications_sent"."attempt_id" is not null) <> ("notifications_sent"."occurrence_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip" text NOT NULL,
	"home_lat" double precision NOT NULL,
	"home_lng" double precision NOT NULL,
	"max_travel_km" double precision DEFAULT 24.14 NOT NULL,
	"h3_r5" bigint,
	"h3_r6" bigint,
	"h3_r7" bigint,
	"h3_r8" bigint,
	"h3_r9" bigint,
	"timezone" text,
	"password_hash" text,
	"email_verified" timestamp with time zone,
	"verification_token" text,
	"push_subscription" jsonb,
	"email_opt_in" boolean DEFAULT true NOT NULL,
	"donation_status" "donation_status" DEFAULT 'unset' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "chk_users_max_travel_km" CHECK ("users"."max_travel_km" > 0),
	CONSTRAINT "users_home_lat_check" CHECK ("users"."home_lat" between -90 and 90),
	CONSTRAINT "users_home_lng_check" CHECK ("users"."home_lng" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "zip_centroids" (
	"zip" text PRIMARY KEY NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "area_captains" ADD CONSTRAINT "area_captains_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_captains" ADD CONSTRAINT "area_captains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_optouts" ADD CONSTRAINT "area_optouts_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_optouts" ADD CONSTRAINT "area_optouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_interest" ADD CONSTRAINT "attempt_interest_attempt_id_formation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."formation_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_interest" ADD CONSTRAINT "attempt_interest_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formation_attempts" ADD CONSTRAINT "formation_attempts_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formation_attempts" ADD CONSTRAINT "formation_attempts_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formation_attempts" ADD CONSTRAINT "formation_attempts_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attendance" ADD CONSTRAINT "game_attendance_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attendance" ADD CONSTRAINT "game_attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_occurrences" ADD CONSTRAINT "game_occurrences_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_roster" ADD CONSTRAINT "game_roster_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_roster" ADD CONSTRAINT "game_roster_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_signals" ADD CONSTRAINT "interest_signals_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_signals" ADD CONSTRAINT "interest_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_signals" ADD CONSTRAINT "interest_signals_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_aggregates" ADD CONSTRAINT "map_aggregates_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_attempt_id_formation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."formation_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_occurrence_id_game_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."game_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_area_optouts_user" ON "area_optouts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_areas_activity_cell" ON "areas" USING btree ("activity_type_id","h3_cell");--> statement-breakpoint
CREATE INDEX "idx_areas_status" ON "areas" USING btree ("activity_type_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attempt_interest" ON "attempt_interest" USING btree ("attempt_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_attempt_area_number" ON "formation_attempts" USING btree ("area_id","attempt_number");--> statement-breakpoint
CREATE INDEX "idx_attempt_open_close" ON "formation_attempts" USING btree ("status","interest_closes_at");--> statement-breakpoint
CREATE INDEX "idx_attempt_catchment" ON "formation_attempts" USING gin ("catchment_cells");--> statement-breakpoint
CREATE INDEX "idx_game_attendance_occurrence" ON "game_attendance" USING btree ("game_id","occurrence_date") WHERE "game_attendance"."status" = 'in';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_occurrence_game_date" ON "game_occurrences" USING btree ("game_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "idx_occurrences_poll_open" ON "game_occurrences" USING btree ("status","poll_opens_at");--> statement-breakpoint
CREATE INDEX "idx_occurrences_poll_close" ON "game_occurrences" USING btree ("status","poll_closes_at");--> statement-breakpoint
CREATE INDEX "idx_occurrences_kickoff" ON "game_occurrences" USING btree ("status","kickoff_at");--> statement-breakpoint
CREATE INDEX "idx_games_area" ON "games" USING btree ("activity_type_id","area_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_interest_user_area" ON "interest_signals" USING btree ("activity_type_id","user_id","area_id");--> statement-breakpoint
CREATE INDEX "idx_interest_area_active" ON "interest_signals" USING btree ("area_id") WHERE "interest_signals"."active";--> statement-breakpoint
CREATE INDEX "idx_interest_ring" ON "interest_signals" USING btree ("activity_type_id","h3_base") WHERE "interest_signals"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notif_attempt" ON "notifications_sent" USING btree ("user_id","attempt_id","kind","channel") WHERE "notifications_sent"."attempt_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notif_occurrence" ON "notifications_sent" USING btree ("user_id","occurrence_id","kind","channel") WHERE "notifications_sent"."occurrence_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_notif_unsent" ON "notifications_sent" USING btree ("sent_at") WHERE "notifications_sent"."emailed_at" is null and "notifications_sent"."channel" = 'email';--> statement-breakpoint
CREATE INDEX "idx_notif_user_week" ON "notifications_sent" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_stripe_customer" ON "users" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "idx_users_h3_r7" ON "users" USING btree ("h3_r7");--> statement-breakpoint
CREATE INDEX "idx_users_h3_r8" ON "users" USING btree ("h3_r8");--> statement-breakpoint
CREATE INDEX "idx_users_zip" ON "users" USING btree ("zip");--> statement-breakpoint
CREATE INDEX "idx_users_verification_token" ON "users" USING btree ("verification_token") WHERE "users"."verification_token" is not null;