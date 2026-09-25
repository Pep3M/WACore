-- La agenda de contactos, separada por línea.
--
-- `wacore_contacts` era una sola tabla para todo el servicio con el `jid` como clave: con varias
-- líneas conectadas, pedir la agenda de una devolvía la de todas —también las de otras
-- empresas— y cada línea pisaba el nombre y la marca de «guardado» de las demás. Aquí la clave
-- es `(session_id, jid)`, igual que en `wacore_labels`.
--
-- Los nombres van en dos columnas porque son dos cosas distintas y la mezcla era el otro fallo:
--
-- `book_name`  el nombre con que el dueño de la línea tiene guardado al contacto. Solo lo trae la
--              agenda del teléfono, y es lo que hace que esté «en la agenda».
-- `push_name`  el que se pone cada uno en su WhatsApp. Lo trae cualquier mensaje.
--
-- `phone` son los dígitos del número, o NULL cuando WhatsApp solo ha dado el LID: con un LID no
-- se le puede escribir a nadie, así que no se guardan sus dígitos como si fueran un teléfono.
--
-- No se copia nada de `wacore_contacts`: sus filas no dicen de qué línea son. La agenda de cada
-- línea se rellena con el volcado al emparejar o, en las ya conectadas, con
-- `POST /api/contacts/resync`. La tabla vieja se queda sin usar para poder volver atrás; se
-- borrará en una versión posterior.
CREATE TABLE IF NOT EXISTS "wacore_session_contacts" (
	"session_id" text NOT NULL,
	"jid" text NOT NULL,
	"phone" text,
	"lid" text,
	"book_name" text,
	"push_name" text,
	"verified_name" text,
	"profile_pic_url" text,
	"is_business" boolean NOT NULL DEFAULT false,
	"in_address_book" boolean NOT NULL DEFAULT false,
	"is_group" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("session_id", "jid")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wacore_session_contacts_phone_idx" ON "wacore_session_contacts" ("session_id", "phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wacore_session_contacts_lid_idx" ON "wacore_session_contacts" ("session_id", "lid");
