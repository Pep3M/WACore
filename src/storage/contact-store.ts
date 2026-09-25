import type { ContactPublic, ListContactsOpts, ListContactsResult, UpsertContact } from '../types/contact';

/**
 * La agenda de contactos, **separada por línea**.
 *
 * Hasta la v1.2.x era una sola tabla para todo el servicio, con el `jid` como clave. Con varias
 * líneas conectadas —de la misma empresa o de empresas distintas— cualquiera que pidiera su agenda
 * recibía la de todas, y cada línea pisaba el nombre y la marca de «guardado» de las demás. Por eso
 * todo pasa ahora por el `sessionId`, igual que las etiquetas.
 */
export interface ContactStore {
  upsert(sessionId: string, c: UpsertContact): Promise<void>;
  upsertMany(sessionId: string, cs: UpsertContact[]): Promise<void>;
  list(sessionId: string, opts?: ListContactsOpts): Promise<ListContactsResult>;
  setProfilePic(sessionId: string, jid: string, url: string | null): Promise<void>;
  /**
   * Junta en la fila del teléfono lo que se sabía de un contacto por su LID.
   *
   * WhatsApp identifica a mucha gente primero por el LID y más tarde revela el número. Sin esta
   * fusión el mismo contacto quedaba dos veces: una con el nombre de la agenda y sin teléfono, y
   * otra con el teléfono y sin nombre.
   */
  mergeLid(sessionId: string, lidJid: string, pnJid: string): Promise<void>;
  /** Olvida la agenda entera de una línea: al cerrar sesión deja de ser de nadie. */
  purgeSession(sessionId: string): Promise<void>;
}

export const MAX_LIMIT = 500;

/** Los dígitos del usuario de un JID, sin dominio ni dispositivo: `34600:12@s.whatsapp.net` → `34600`. */
export function digitsOfJid(jid: string): string {
  return (jid.split('@')[0] ?? '').split(':')[0] ?? '';
}

/**
 * El nombre que se enseña: el de la agenda manda sobre el que se pone cada uno, porque es como
 * el dueño de la línea reconoce a esa persona.
 */
export function displayName(row: {
  bookName: string | null;
  verifiedName: string | null;
  pushName: string | null;
  phone: string | null;
  jid: string;
}): string {
  return row.bookName || row.verifiedName || row.pushName || row.phone || digitsOfJid(row.jid);
}

// ─── In-memory implementation (default when sessionStore != postgres) ──────────

interface InMemoryRow {
  jid: string;
  phone: string | null;
  lid: string | null;
  bookName: string | null;
  pushName: string | null;
  verifiedName: string | null;
  profilePicUrl: string | null;
  isBusiness: boolean;
  inAddressBook: boolean;
  isGroup: boolean;
  updatedAt: Date;
}

function toPublic(row: InMemoryRow): ContactPublic {
  return {
    jid: row.jid,
    phone: row.phone,
    name: displayName(row),
    avatar: row.profilePicUrl,
    isBusiness: row.isBusiness,
    isMyContact: row.inAddressBook,
    isGroup: row.isGroup,
    lid: row.lid,
    pushName: row.pushName,
    inAddressBook: row.inAddressBook,
  };
}

/**
 * Cómo se combina lo nuevo con lo que ya había. Es la misma regla que el `ON CONFLICT` de
 * Postgres, y tiene que seguir siéndolo: un campo ausente no borra nada, y las marcas solo suben.
 */
function mergeRow(existing: InMemoryRow | undefined, c: UpsertContact): InMemoryRow {
  return {
    jid: c.jid,
    phone: c.phone ?? existing?.phone ?? null,
    lid: c.lid ?? existing?.lid ?? null,
    bookName: c.bookName ?? existing?.bookName ?? null,
    pushName: c.pushName ?? existing?.pushName ?? null,
    verifiedName: c.verifiedName ?? existing?.verifiedName ?? null,
    profilePicUrl: c.profilePicUrl ?? existing?.profilePicUrl ?? null,
    isBusiness: (existing?.isBusiness ?? false) || (c.isBusiness ?? false),
    inAddressBook: (existing?.inAddressBook ?? false) || (c.inAddressBook ?? false),
    isGroup: (existing?.isGroup ?? false) || (c.isGroup ?? false),
    updatedAt: new Date(),
  };
}

export class InMemoryContactStore implements ContactStore {
  private readonly sessions = new Map<string, Map<string, InMemoryRow>>();

  private rowsOf(sessionId: string): Map<string, InMemoryRow> {
    let rows = this.sessions.get(sessionId);
    if (!rows) {
      rows = new Map();
      this.sessions.set(sessionId, rows);
    }
    return rows;
  }

  async upsert(sessionId: string, c: UpsertContact): Promise<void> {
    await this.upsertMany(sessionId, [c]);
  }

  async upsertMany(sessionId: string, cs: UpsertContact[]): Promise<void> {
    const rows = this.rowsOf(sessionId);

    for (const c of cs) {
      rows.set(c.jid, mergeRow(rows.get(c.jid), c));
    }

    for (const c of cs) {
      if (c.lid && c.lid !== c.jid) {
        await this.mergeLid(sessionId, c.lid, c.jid);
      }
    }
  }

  async mergeLid(sessionId: string, lidJid: string, pnJid: string): Promise<void> {
    const rows = this.rowsOf(sessionId);
    const deLid = rows.get(lidJid);
    if (!deLid || lidJid === pnJid) return;

    const deTelefono = rows.get(pnJid);

    rows.set(pnJid, mergeRow(deTelefono, {
      jid: pnJid,
      phone: deTelefono?.phone ?? digitsOfJid(pnJid),
      lid: deTelefono?.lid ?? lidJid,
      // Lo del teléfono manda; lo del LID solo rellena huecos.
      bookName: deTelefono?.bookName ?? deLid.bookName,
      pushName: deTelefono?.pushName ?? deLid.pushName,
      verifiedName: deTelefono?.verifiedName ?? deLid.verifiedName,
      profilePicUrl: deTelefono?.profilePicUrl ?? deLid.profilePicUrl,
      isBusiness: deLid.isBusiness,
      inAddressBook: deLid.inAddressBook,
      isGroup: deLid.isGroup,
    }));
    rows.delete(lidJid);
  }

  async list(sessionId: string, opts: ListContactsOpts = {}): Promise<ListContactsResult> {
    const limit = Math.min(opts.limit ?? 100, MAX_LIMIT);
    const offset = opts.offset ?? 0;
    const q = opts.q?.toLowerCase();

    let items = Array.from(this.rowsOf(sessionId).values());

    if (!opts.includeGroups) {
      items = items.filter(r => !r.isGroup);
    }
    if (opts.onlyMyContacts) {
      items = items.filter(r => r.inAddressBook);
    }
    if (q) {
      items = items.filter(r =>
        displayName(r).toLowerCase().includes(q)
        || (r.pushName ?? '').toLowerCase().includes(q)
        || (r.phone ?? '').includes(q),
      );
    }

    if (opts.orderBy === 'updated_at') {
      items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    } else {
      items.sort((a, b) => displayName(a).toLowerCase().localeCompare(displayName(b).toLowerCase()));
    }

    const total = items.length;
    const page = items.slice(offset, offset + limit);

    return { items: page.map(toPublic), total };
  }

  async setProfilePic(sessionId: string, jid: string, url: string | null): Promise<void> {
    const row = this.rowsOf(sessionId).get(jid);
    if (row) {
      row.profilePicUrl = url;
      row.updatedAt = new Date();
    }
  }

  async purgeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export async function createContactStore(
  sessionStore: string,
  databaseUrl: string | undefined,
): Promise<ContactStore> {
  if (sessionStore === 'postgres' && databaseUrl) {
    const { PostgresContactStore } = await import('./postgres-contact-store');
    return new PostgresContactStore(databaseUrl);
  }
  return new InMemoryContactStore();
}
