CREATE TABLE "wacore_sessions" (
	"instance_name" text PRIMARY KEY NOT NULL,
	"creds" jsonb NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
