export type LabelAssociationType = 'chat' | 'message';

/**
 * Quién puso el dato.
 *
 * `wa` lo contó WhatsApp por `labels.edit` / `labels.association`; `local` lo escribimos
 * nosotros y WhatsApp aún no lo ha confirmado. La distinción no es cosmética: las cuentas
 * Business modernas no disparan esos eventos nunca, así que sin escribir en local un `POST`
 * con 200 dejaría el listado vacío.
 */
export type LabelSource = 'local' | 'wa';

/** WhatsApp solo admite estos veinte. Un color fuera de rango es un patch mal formado. */
export const MAX_LABEL_COLOR = 19;

export interface LabelPublic {
  id: string;
  name: string;
  color: number;
  deleted: boolean;
  predefinedId: string | null;
  source: LabelSource;
}

export interface LabelChatAssociation {
  chatJid: string;
}

export interface LabelMessageAssociation {
  chatJid: string;
  messageId: string;
}

export interface LabelAssociationsPublic {
  chats: string[];
  messages: LabelMessageAssociation[];
}

export interface UpsertLabel {
  id: string;
  name: string;
  color: number;
  deleted?: boolean;
  predefinedId?: string | null;
  source?: LabelSource;
}

export interface UpsertLabelAssociation {
  labelId: string;
  type: LabelAssociationType;
  chatJid: string;
  messageId?: string | null;
}

export interface ListLabelsOpts {
  includeDeleted?: boolean;
}
