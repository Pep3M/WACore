import { createConnection } from './postgres-db';
import { DuplicateTemplateNameError } from './template-store';
import type { TemplateStore } from './template-store';
import type {
  TemplatePublic,
  TemplateMedia,
  TemplateMediaType,
  CreateTemplateInput,
  UpdateTemplateInput,
} from '../types/template';

interface TemplateRow {
  template_id: string;
  name: string;
  body: string;
  media_type: string | null;
  media_url: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

const MEDIA_TYPES: TemplateMediaType[] = ['image', 'video', 'document', 'audio'];

function toPublic(row: TemplateRow): TemplatePublic {
  let media: TemplateMedia | null = null;
  if (row.media_type && row.media_url && MEDIA_TYPES.includes(row.media_type as TemplateMediaType)) {
    media = {
      type: row.media_type as TemplateMediaType,
      url: row.media_url,
      ...(row.media_mimetype ? { mimetype: row.media_mimetype } : {}),
      ...(row.media_filename ? { filename: row.media_filename } : {}),
    };
  }
  return {
    id: row.template_id,
    name: row.name,
    body: row.body,
    media,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export class PostgresTemplateStore implements TemplateStore {
  private readonly sql: ReturnType<typeof createConnection>['sql'];

  constructor(databaseUrl: string) {
    const conn = createConnection(databaseUrl);
    this.sql = conn.sql;
  }

  async create(sessionId: string, input: CreateTemplateInput): Promise<TemplatePublic> {
    const id = crypto.randomUUID();
    const media = input.media ?? null;
    try {
      const [row] = await this.sql<TemplateRow[]>`
        INSERT INTO wacore_templates
          (session_id, template_id, name, body, media_type, media_url, media_mimetype, media_filename)
        VALUES
          (${sessionId}, ${id}, ${input.name}, ${input.body},
           ${media?.type ?? null}, ${media?.url ?? null}, ${media?.mimetype ?? null}, ${media?.filename ?? null})
        RETURNING template_id, name, body, media_type, media_url, media_mimetype, media_filename, created_at, updated_at
      `;
      if (!row) throw new Error('INSERT returned no row');
      return toPublic(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateTemplateNameError(input.name);
      throw err;
    }
  }

  async list(sessionId: string): Promise<TemplatePublic[]> {
    const rows = await this.sql<TemplateRow[]>`
      SELECT template_id, name, body, media_type, media_url, media_mimetype, media_filename, created_at, updated_at
      FROM wacore_templates
      WHERE session_id = ${sessionId}
      ORDER BY lower(name), template_id
    `;
    return rows.map(toPublic);
  }

  async get(sessionId: string, templateId: string): Promise<TemplatePublic | null> {
    const [row] = await this.sql<TemplateRow[]>`
      SELECT template_id, name, body, media_type, media_url, media_mimetype, media_filename, created_at, updated_at
      FROM wacore_templates
      WHERE session_id = ${sessionId} AND template_id = ${templateId}
      LIMIT 1
    `;
    return row ? toPublic(row) : null;
  }

  async update(sessionId: string, templateId: string, patch: UpdateTemplateInput): Promise<TemplatePublic | null> {
    const hasMediaKey = patch.media !== undefined;
    const nextMedia: TemplateMedia | null = hasMediaKey ? (patch.media ?? null) : null;

    // Un solo UPDATE atómico: COALESCE para name/body, y cuando `media` no viene en el patch
    // conservamos las columnas actuales (evita lost-updates de otro request concurrente).
    try {
      const [row] = hasMediaKey
        ? await this.sql<TemplateRow[]>`
            UPDATE wacore_templates SET
              name = COALESCE(${patch.name ?? null}, name),
              body = COALESCE(${patch.body ?? null}, body),
              media_type = ${nextMedia?.type ?? null},
              media_url = ${nextMedia?.url ?? null},
              media_mimetype = ${nextMedia?.mimetype ?? null},
              media_filename = ${nextMedia?.filename ?? null},
              updated_at = NOW()
            WHERE session_id = ${sessionId} AND template_id = ${templateId}
            RETURNING template_id, name, body, media_type, media_url, media_mimetype, media_filename, created_at, updated_at
          `
        : await this.sql<TemplateRow[]>`
            UPDATE wacore_templates SET
              name = COALESCE(${patch.name ?? null}, name),
              body = COALESCE(${patch.body ?? null}, body),
              updated_at = NOW()
            WHERE session_id = ${sessionId} AND template_id = ${templateId}
            RETURNING template_id, name, body, media_type, media_url, media_mimetype, media_filename, created_at, updated_at
          `;
      return row ? toPublic(row) : null;
    } catch (err) {
      if (isUniqueViolation(err) && patch.name) throw new DuplicateTemplateNameError(patch.name);
      throw err;
    }
  }

  async delete(sessionId: string, templateId: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM wacore_templates
      WHERE session_id = ${sessionId} AND template_id = ${templateId}
    `;
    return (result.count ?? 0) > 0;
  }
}
