CREATE TABLE "wacore_templates" (
	"session_id" text NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"media_type" text,
	"media_url" text,
	"media_mimetype" text,
	"media_filename" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("session_id", "template_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wacore_templates_name_uniq" ON "wacore_templates" ("session_id", lower("name"));
--> statement-breakpoint
CREATE INDEX "wacore_templates_session_idx" ON "wacore_templates" ("session_id");
