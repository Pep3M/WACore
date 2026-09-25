import { createConnection } from './postgres-db';
import { MAX_LIMIT, digitsOfJid, displayName } from './contact-store';
import type { ContactStore } from './contact-store';
import type { ContactPublic, ListContactsOpts, ListContactsResult, UpsertContact } from '../types/contact';

const CHUNK_SIZE = 100;

interface DbRow {
  jid: string;
  phone: string | null;
  lid: string | null;
  book_name: string | null;
  push_name: string | null;
  verified_name: string | null;
  profile_pic_url: string | null;
  is_business: boolean;
  in_address_book: boolean;
  is_group: boolean;
}

function dbToPublic(row: DbRow): ContactPublic {
  return {
    jid: row.jid,
    phone: row.phone,
    name: displayName({
      bookName: row.book_name,
      verifiedName: row.verified_name,
      pushName: row.push_name,
      phone: row.phone,
      jid: row.jid,
    }),
    avatar: row.profile_pic_url,
    isBusiness: row.is_business,
    isMyContact: row.in_address_book,
    isGroup: row.is_group,
    lid: row.lid,
    pushName: row.push_name,
    inAddressBook: row.in_address_book,
  };
}

/**
 * Junta los contactos repetidos de una misma tanda antes de mandarla.
 *
 * Postgres rechaza un `INSERT … ON CONFLICT DO UPDATE` que toque dos veces la misma fila
 * («cannot affect row a second time»), y un volcado de WhatsApp trae al mismo contacto varias
 * veces —por su conversación y por su pushName—. Sin esto, la tanda entera se perdía.
 */
function collapse(cs: UpsertContact[]): UpsertContact[] {
  const byJid = new Map<string, UpsertContact>();

  for (const c of cs) {
    const prev = byJid.get(c.jid);
    byJid.set(c.jid, prev
      ? {
          jid: c.jid,
          phone: c.phone ?? prev.phone ?? null,
          lid: c.lid ?? prev.lid ?? null,
          bookName: c.bookName ?? prev.bookName ?? null,
          pushName: c.pushName ?? prev.pushName ?? null,
          verifiedName: c.verifiedName ?? prev.verifiedName ?? null,
          profilePicUrl: c.profilePicUrl ?? prev.profilePicUrl ?? null,
          isBusiness: (prev.isBusiness ?? false) || (c.isBusiness ?? false),
          inAddressBook: (prev.inAddressBook ?? false) || (c.inAddressBook ?? false),
          isGroup: (prev.isGroup ?? false) || (c.isGroup ?? false),
        }
      : c);
  }

  return Array.from(byJid.values());
}

export class PostgresContactStore implements ContactStore {
  private readonly sql: ReturnType<typeof createConnection>['sql'];

  constructor(databaseUrl: string) {
    const conn = createConnection(databaseUrl);
    this.sql = conn.sql;
  }

  async upsert(sessionId: string, c: UpsertContact): Promise<void> {
    await this.upsertMany(sessionId, [c]);
  }

  async upsertMany(sessionId: string, cs: UpsertContact[]): Promise<void> {
    if (cs.length === 0) return;

    const contactos = collapse(cs);

    for (let i = 0; i < contactos.length; i += CHUNK_SIZE) {
      const chunk = contactos.slice(i, i + CHUNK_SIZE);
      const rows = chunk.map(c => ({
        session_id: sessionId,
        jid: c.jid,
        phone: c.phone ?? null,
        lid: c.lid ?? null,
        book_name: c.bookName ?? null,
        push_name: c.pushName ?? null,
        verified_name: c.verifiedName ?? null,
        profile_pic_url: c.profilePicUrl ?? null,
        is_business: c.isBusiness ?? false,
        in_address_book: c.inAddressBook ?? false,
        is_group: c.isGroup ?? false,
      }));

      // Un campo que no viene no borra lo que había, y las marcas solo suben: la agenda llega
      // por partes —el volcado, la agenda del teléfono, cada mensaje— y ninguna trae todo.
      await this.sql`
        INSERT INTO wacore_session_contacts
          ${this.sql(rows, 'session_id', 'jid', 'phone', 'lid', 'book_name', 'push_name', 'verified_name', 'profile_pic_url', 'is_business', 'in_address_book', 'is_group')}
        ON CONFLICT (session_id, jid) DO UPDATE SET
          phone           = COALESCE(EXCLUDED.phone, wacore_session_contacts.phone),
          lid             = COALESCE(EXCLUDED.lid, wacore_session_contacts.lid),
          book_name       = COALESCE(EXCLUDED.book_name, wacore_session_contacts.book_name),
          push_name       = COALESCE(EXCLUDED.push_name, wacore_session_contacts.push_name),
          verified_name   = COALESCE(EXCLUDED.verified_name, wacore_session_contacts.verified_name),
          profile_pic_url = COALESCE(EXCLUDED.profile_pic_url, wacore_session_contacts.profile_pic_url),
          is_business     = wacore_session_contacts.is_business OR EXCLUDED.is_business,
          in_address_book = wacore_session_contacts.in_address_book OR EXCLUDED.in_address_book,
          is_group        = wacore_session_contacts.is_group OR EXCLUDED.is_group,
          updated_at      = NOW()
      `;

      const pares = chunk.filter(c => c.lid && c.lid !== c.jid);
      if (pares.length > 0) {
        await this.fold(sessionId, pares.map(c => c.lid as string), pares.map(c => c.jid));
      }
    }
  }

  async mergeLid(sessionId: string, lidJid: string, pnJid: string): Promise<void> {
    if (lidJid === pnJid) return;

    // Si del teléfono todavía no hay fila, la del LID se convierte en ella.
    await this.sql`
      UPDATE wacore_session_contacts
      SET jid = ${pnJid}, phone = ${digitsOfJid(pnJid)}, lid = ${lidJid}, updated_at = NOW()
      WHERE session_id = ${sessionId} AND jid = ${lidJid}
        AND NOT EXISTS (
          SELECT 1 FROM wacore_session_contacts
          WHERE session_id = ${sessionId} AND jid = ${pnJid}
        )
    `;

    await this.fold(sessionId, [lidJid], [pnJid]);
  }

  /**
   * Vuelca en la fila del teléfono lo que había en la del LID y borra esta. Lo del teléfono
   * manda; lo del LID solo rellena huecos.
   */
  private async fold(sessionId: string, lids: string[], pns: string[]): Promise<void> {
    await this.sql`
      WITH pares AS (
        SELECT * FROM unnest(${lids}::text[], ${pns}::text[]) AS p(lid, pn)
      ), fusionados AS (
        UPDATE wacore_session_contacts AS d SET
          lid             = COALESCE(d.lid, o.jid),
          book_name       = COALESCE(d.book_name, o.book_name),
          push_name       = COALESCE(d.push_name, o.push_name),
          verified_name   = COALESCE(d.verified_name, o.verified_name),
          profile_pic_url = COALESCE(d.profile_pic_url, o.profile_pic_url),
          is_business     = d.is_business OR o.is_business,
          in_address_book = d.in_address_book OR o.in_address_book,
          updated_at      = NOW()
        FROM pares p
        JOIN wacore_session_contacts o ON o.session_id = ${sessionId} AND o.jid = p.lid
        WHERE d.session_id = ${sessionId} AND d.jid = p.pn
        RETURNING p.lid
      )
      DELETE FROM wacore_session_contacts
      WHERE session_id = ${sessionId} AND jid IN (SELECT lid FROM fusionados)
    `;
  }

  async list(sessionId: string, opts: ListContactsOpts = {}): Promise<ListContactsResult> {
    const limit = Math.min(opts.limit ?? 100, MAX_LIMIT);
    const offset = opts.offset ?? 0;

    const conditions: ReturnType<typeof this.sql>[] = [this.sql`session_id = ${sessionId}`];

    if (!opts.includeGroups) {
      conditions.push(this.sql`is_group = false`);
    }
    if (opts.onlyMyContacts) {
      conditions.push(this.sql`in_address_book = true`);
    }
    if (opts.q) {
      const escaped = opts.q.toLowerCase().replace(/[%_\\]/g, '\\$&');
      const q = `%${escaped}%`;
      conditions.push(this.sql`(
        lower(COALESCE(book_name, verified_name, push_name, '')) LIKE ${q} ESCAPE '\\'
        OR lower(COALESCE(push_name, '')) LIKE ${q} ESCAPE '\\'
        OR COALESCE(phone, '') LIKE ${q} ESCAPE '\\'
      )`);
    }

    const where = conditions.reduce((acc, cond) => this.sql`${acc} AND ${cond}`);

    const orderCol = opts.orderBy === 'updated_at'
      ? this.sql`updated_at DESC, jid`
      : this.sql`lower(COALESCE(book_name, verified_name, push_name, phone, jid)), jid`;

    const [countRow] = await this.sql<[{ count: number }]>`
      SELECT COUNT(*)::int AS count FROM wacore_session_contacts WHERE ${where}
    `;

    const dbRows = await this.sql<DbRow[]>`
      SELECT jid, phone, lid, book_name, push_name, verified_name, profile_pic_url,
             is_business, in_address_book, is_group
      FROM wacore_session_contacts
      WHERE ${where}
      ORDER BY ${orderCol}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return {
      items: dbRows.map(dbToPublic),
      total: Number(countRow!.count),
    };
  }

  async setProfilePic(sessionId: string, jid: string, url: string | null): Promise<void> {
    await this.sql`
      UPDATE wacore_session_contacts
      SET profile_pic_url = ${url}, updated_at = NOW()
      WHERE session_id = ${sessionId} AND jid = ${jid}
    `;
  }

  async purgeSession(sessionId: string): Promise<void> {
    await this.sql`DELETE FROM wacore_session_contacts WHERE session_id = ${sessionId}`;
  }
}
