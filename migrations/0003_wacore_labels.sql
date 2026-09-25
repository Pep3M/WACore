CREATE TABLE "wacore_labels" (
	"session_id" text NOT NULL,
	"label_id" text NOT NULL,
	"name" text NOT NULL,
	"color" integer NOT NULL DEFAULT 0,
	"deleted" boolean NOT NULL DEFAULT false,
	"predefined_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("session_id", "label_id")
);
--> statement-breakpoint
CREATE INDEX "wacore_labels_session_idx" ON "wacore_labels" ("session_id");
--> statement-breakpoint
CREATE TABLE "wacore_label_associations" (
	"session_id" text NOT NULL,
	"label_id" text NOT NULL,
	"assoc_type" text NOT NULL,
	"chat_jid" text NOT NULL,
	"message_id" text NOT NULL DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("session_id", "label_id", "assoc_type", "chat_jid", "message_id")
);
--> statement-breakpoint
CREATE INDEX "wacore_label_assoc_label_idx" ON "wacore_label_associations" ("session_id", "label_id");
--> statement-breakpoint
CREATE INDEX "wacore_label_assoc_chat_idx" ON "wacore_label_associations" ("session_id", "chat_jid");
