# Contactos — la agenda de cada línea

WACore guarda la agenda de contactos **de cada línea por separado**: en memoria (siempre) y en
PostgreSQL (cuando `SESSION_STORE=postgres`). Se rellena con los eventos de Baileys —la agenda del
teléfono, el volcado al emparejar y los mensajes que llegan— y se puede volver a pedir entera con
`POST /api/contacts/resync`.

Hasta la v1.2.x la agenda era **una sola para todo el servicio**: con varias líneas conectadas,
pedir la de una devolvía la de todas. Desde la v1.3.0 cada ruta resuelve la sesión que pregunta y
solo lee la suya.

---

## Autenticación

Todos los endpoints requieren `Authorization: Bearer <API_KEY>`. La agenda que se devuelve es la
de la sesión resuelta: la indicada en la cabecera opcional `X-Session-Id` o, sin ella, la sesión
`WA_INSTANCE_NAME`.

---

## Endpoints

### `GET /api/contacts` — Listar contactos de la línea

**Query params** (todos opcionales):

| Param | Tipo | Default | Descripción |
|---|---|---|---|
| `q` | string | — | Búsqueda sobre el nombre de agenda, el pushName y el teléfono (insensible a mayúsculas) |
| `limit` | int | 100 | Máximo de resultados. Rango: 1–500 |
| `offset` | int | 0 | Desplazamiento para paginación |
| `onlyMyContacts` | bool | false | Si `true`, solo los guardados en la agenda del teléfono |
| `includeGroups` | bool | false | Si `true`, incluye grupos de WhatsApp |
| `orderBy` | string | `name` | `name` (alfabético) o `updated_at` (más reciente primero) |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "contacts": [
      {
        "jid": "34600111222@s.whatsapp.net",
        "phone": "34600111222",
        "name": "Amy Iglesia",
        "avatar": null,
        "isBusiness": false,
        "isMyContact": true,
        "isGroup": false,
        "lid": "211617400811648@lid",
        "pushName": "amy",
        "inAddressBook": true
      }
    ],
    "total": 1,
    "limit": 100,
    "offset": 0
  }
}
```

| Campo | Qué es |
|---|---|
| `jid` | Identificador canónico: el JID de teléfono si se conoce; si no, el LID (`…@lid`) |
| `phone` | Dígitos del número. **`null`** si WhatsApp solo ha dado el LID y todavía no se sabe el número |
| `name` | El nombre de la agenda si lo hay; si no, el verificado (Business), el pushName o el número |
| `pushName` | El nombre que se ha puesto el propio contacto |
| `inAddressBook` | Guardado en la agenda del teléfono de la línea. Una vez `true`, se queda |
| `isMyContact` | Igual que `inAddressBook`. Se mantiene por compatibilidad |

### `POST /api/contacts/resync` — Volver a pedir la agenda entera

Borra la versión guardada de la colección de app-state `critical_unblock_low` —donde viajan los
contactos de la agenda— y llama a `resyncAppState`, igual que en el primer emparejamiento.
WhatsApp manda entonces cada contacto de la agenda con su nombre. La respuesta llega **cuando la
agenda ya está guardada**, con tope de 30 s.

Para qué sirve:

- importar la agenda de una línea que se acaba de emparejar y todavía la está recibiendo;
- rellenar la de una línea conectada antes de la v1.3.0, cuya agenda por línea nace vacía.

| Código | Cuándo |
|---|---|
| `200` | `{ "success": true, "data": { "total": 812, "inAddressBook": 640, "addressBookSynced": true, "skippedRecords": 0 } }` |
| `409` | La línea no está conectada |
| `500` | WhatsApp no contestó o falló el guardado |

`addressBookSynced` es **false** cuando WhatsApp no llegó a entregar la agenda: Baileys reintenta
el snapshot y **se rinde sin lanzar**, así que sin este dato un fallo de lectura es
indistinguible de una agenda vacía y quien llama acaba diciendo «0 contactos». `skippedRecords`
cuenta los registros del snapshot que no se pudieron decodificar y se saltaron: uno solo abortaba
antes la colección entera y dejaba la línea sin agenda.

Dos peticiones a la vez sobre la misma línea hacen un solo resync.

---

## De dónde sale cada dato

| Evento Baileys | Qué se guarda |
|---|---|
| `contacts.upsert` | La agenda del teléfono (`contactAction`). Trae `name` → nombre de agenda y `inAddressBook`. |
| `contacts.update` | Cambios parciales: nombre, foto. Solo se toca lo que viene. |
| `messaging-history.set` | Contactos del volcado inicial. Durante el emparejamiento Baileys funde aquí la agenda. |
| `lid-mapping.update` | WhatsApp revela el número de un LID: la fila del LID se funde con la del teléfono. |
| `messages.upsert` / `messages.update` | Quien escribe se apunta con su pushName, **nunca** como contacto de la agenda. |

Reglas de la mezcla, iguales en memoria y en Postgres:

- **Un campo que no viene no borra lo que había.** La agenda llega por partes y ninguna trae todo.
- **Las marcas solo suben.** Un mensaje entrante no saca a nadie de la agenda.
- En Baileys, `name` es como **tú** tienes guardado al contacto y `notify` como se llama **él**.
  Hasta la v1.2.x estaba al revés.
- El número de un contacto `@lid` sale de su `phoneNumber` o del mapeo LID→PN de la línea. Si no se
  conoce, `phone` queda `null`: no se guardan los dígitos del LID como si fueran un teléfono.
- `imgUrl: 'changed'` no es una URL y no se guarda como foto.

Cerrar la sesión de una línea (`logout` o volver a emparejar) borra su agenda: la siguiente puede
ser de otro teléfono.

---

## Persistencia

| `SESSION_STORE` | ContactStore | Al reiniciar |
|---|---|---|
| `file` / `redis` | `InMemoryContactStore` | Se vacía; se reconstruye con los eventos o con `resync`. |
| `postgres` | `PostgresContactStore` | Persiste. |

### Tabla `wacore_session_contacts` (Postgres, migración 0006)

```sql
CREATE TABLE wacore_session_contacts (
  session_id      TEXT NOT NULL,           -- id de la sesión (p. ej. WA_INSTANCE_NAME)
  jid             TEXT NOT NULL,           -- JID de teléfono si se conoce; si no, el LID
  phone           TEXT,                    -- dígitos, o NULL si solo se conoce el LID
  lid             TEXT,
  book_name       TEXT,                    -- nombre en la agenda del dueño de la línea
  push_name       TEXT,                    -- nombre que se pone el contacto
  verified_name   TEXT,
  profile_pic_url TEXT,
  is_business     BOOLEAN NOT NULL DEFAULT false,
  in_address_book BOOLEAN NOT NULL DEFAULT false,
  is_group        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, jid)
);
```

La tabla antigua `wacore_contacts` ya no se lee ni se escribe. Se conserva para poder volver a la
v1.2.x y se borrará en una versión posterior.
