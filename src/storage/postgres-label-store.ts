import { createConnection } from './postgres-db';
import type { LabelStore } from './label-store';
import type {
  LabelPublic,
  LabelAssociationsPublic,
  LabelSource,
  ListLabelsOpts,
  UpsertLabel,
  UpsertLabelAssociation,
} from '../types/label';

interface LabelRow {
  label_id: string;
  name: string;
  color: number;
  deleted: boolean;
  predefined_id: string | null;
  source: LabelSource;
}

interface AssocRow {
  label_id: string;
  assoc_type: string;
  chat_jid: string;
  message_id: string;
}

function dbToPublic(row: LabelRow): LabelPublic {
  return {
    id: row.label_id,
    name: row.name,
    color: row.color,
    deleted: row.deleted,
    predefinedId: row.predefined_id,
    source: row.source,
  };
}

export class PostgresLabelStore implements LabelStore {
  private readonly sql: ReturnType<typeof createConnection>['sql'];

  constructor(databaseUrl: string) {
    const conn = createConnection(databaseUrl);
    this.sql = conn.sql;
  }

  async upsertLabel(sessionId: string, label: UpsertLabel): Promise<void> {
    await this.sql`
      INSERT INTO wacore_labels
        (session_id, label_id, name, color, deleted, predefined_id, source)
      VALUES
        (${sessionId}, ${label.id}, ${label.name}, ${label.color}, ${label.deleted ?? false}, ${label.predefinedId ?? null}, ${label.source ?? 'wa'})
      ON CONFLICT (session_id, label_id) DO UPDATE SET
        name          = EXCLUDED.name,
        color         = EXCLUDED.color,
        deleted       = EXCLUDED.deleted,
        predefined_id = COALESCE(EXCLUDED.predefined_id, wacore_labels.predefined_id),
        -- Una confirmacion de WhatsApp asciende la fila a wa; una escritura local nuestra
        -- no la degrada de vuelta, o cada retoque borraria que WhatsApp ya la conocia.
        source        = CASE WHEN EXCLUDED.source = 'wa' THEN 'wa' ELSE wacore_labels.source END,
        updated_at    = NOW()
    `;
  }

  async listLabels(sessionId: string, opts: ListLabelsOpts = {}): Promise<LabelPublic[]> {
    const includeDeleted = opts.includeDeleted ?? false;
    const rows = includeDeleted
      ? await this.sql<LabelRow[]>`
          SELECT label_id, name, color, deleted, predefined_id, source
          FROM wacore_labels
          WHERE session_id = ${sessionId}
          ORDER BY lower(name), label_id
        `
      : await this.sql<LabelRow[]>`
          SELECT label_id, name, color, deleted, predefined_id, source
          FROM wacore_labels
          WHERE session_id = ${sessionId} AND deleted = false
          ORDER BY lower(name), label_id
        `;
    return rows.map(dbToPublic);
  }

  async getLabel(sessionId: string, labelId: string): Promise<LabelPublic | null> {
    const [row] = await this.sql<LabelRow[]>`
      SELECT label_id, name, color, deleted, predefined_id, source
      FROM wacore_labels
      WHERE session_id = ${sessionId} AND label_id = ${labelId}
      LIMIT 1
    `;
    return row ? dbToPublic(row) : null;
  }

  async addAssociation(sessionId: string, assoc: UpsertLabelAssociation): Promise<void> {
    const messageId = assoc.messageId ?? '';
    await this.sql`
      INSERT INTO wacore_label_associations
        (session_id, label_id, assoc_type, chat_jid, message_id)
      VALUES
        (${sessionId}, ${assoc.labelId}, ${assoc.type}, ${assoc.chatJid}, ${messageId})
      ON CONFLICT DO NOTHING
    `;
  }

  async removeAssociation(sessionId: string, assoc: UpsertLabelAssociation): Promise<void> {
    const messageId = assoc.messageId ?? '';
    await this.sql`
      DELETE FROM wacore_label_associations
      WHERE session_id = ${sessionId}
        AND label_id = ${assoc.labelId}
        AND assoc_type = ${assoc.type}
        AND chat_jid = ${assoc.chatJid}
        AND message_id = ${messageId}
    `;
  }

  async getAssociations(sessionId: string, labelId: string): Promise<LabelAssociationsPublic> {
    const rows = await this.sql<AssocRow[]>`
      SELECT label_id, assoc_type, chat_jid, message_id
      FROM wacore_label_associations
      WHERE session_id = ${sessionId} AND label_id = ${labelId}
      ORDER BY assoc_type, chat_jid, message_id
    `;
    const chats = new Set<string>();
    const messages: Array<{ chatJid: string; messageId: string }> = [];
    for (const row of rows) {
      if (row.assoc_type === 'chat') {
        chats.add(row.chat_jid);
      } else if (row.assoc_type === 'message' && row.message_id) {
        messages.push({ chatJid: row.chat_jid, messageId: row.message_id });
      }
    }
    return { chats: Array.from(chats), messages };
  }
}
