CREATE TABLE "wacore_contacts" (
	"jid" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"notify" text,
	"verified_name" text,
	"profile_pic_url" text,
	"is_business" boolean NOT NULL DEFAULT false,
	"is_my_contact" boolean NOT NULL DEFAULT false,
	"is_group" boolean NOT NULL DEFAULT false,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "wacore_contacts_phone_idx" ON "wacore_contacts" ("phone");
--> statement-breakpoint
CREATE INDEX "wacore_contacts_name_idx" ON "wacore_contacts" (lower("name"));
