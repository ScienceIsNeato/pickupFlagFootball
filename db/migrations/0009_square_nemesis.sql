CREATE TABLE "chat_email_state" (
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"last_emailed_seq" integer DEFAULT 0 NOT NULL,
	"last_emailed_at" timestamp with time zone,
	CONSTRAINT "chat_email_state_user_id_thread_id_pk" PRIMARY KEY("user_id","thread_id")
);
--> statement-breakpoint
ALTER TABLE "chat_email_state" ADD CONSTRAINT "chat_email_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_email_state" ADD CONSTRAINT "chat_email_state_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;