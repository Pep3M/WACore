export interface Contact {
  jid: string;
  phone: string;
  name: string;
}

/**
 * Un contacto de la agenda de **una** línea, tal como se entrega por la API.
 *
 * La agenda es por línea y no global: el mismo número puede estar guardado con un nombre en una
 * línea y con otro en la de al lado, o no estar guardado en absoluto, y lo que devuelve la API es
 * siempre lo que sabe **esa** línea.
 */
export interface ContactPublic {
  jid: string;
  /**
   * Dígitos del teléfono. `null` cuando WhatsApp solo ha dado el LID y todavía no se sabe a qué
   * número corresponde: con un LID no se puede escribir a nadie desde fuera, así que no se inventa.
   */
  phone: string | null;
  name: string;
  avatar: string | null;
  isBusiness: boolean;
  /** Lo mismo que `inAddressBook`. Se mantiene con este nombre porque es el que lee el consumidor. */
  isMyContact: boolean;
  isGroup: boolean;
  lid: string | null;
  pushName: string | null;
  inAddressBook: boolean;
}

export interface ListContactsOpts {
  q?: string;
  onlyMyContacts?: boolean;
  includeGroups?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'name' | 'updated_at';
}

export interface ListContactsResult {
  items: ContactPublic[];
  total: number;
}

/**
 * Lo que se sabe de un contacto en un momento dado. Cada campo que falta **no borra** lo que ya
 * estaba guardado: los eventos de WhatsApp traen cada vez una parte distinta del contacto.
 */
export interface UpsertContact {
  /** Identificador canónico: el JID de teléfono si se conoce; si no, el LID. */
  jid: string;
  phone?: string | null;
  lid?: string | null;
  /** Nombre con el que el dueño de la línea lo tiene guardado. Solo lo trae la agenda. */
  bookName?: string | null;
  /** Nombre que se ha puesto el propio contacto en su WhatsApp. */
  pushName?: string | null;
  verifiedName?: string | null;
  profilePicUrl?: string | null;
  isBusiness?: boolean;
  /** Una vez en la agenda, se queda: un mensaje entrante no puede sacarlo de ella. */
  inAddressBook?: boolean;
  isGroup?: boolean;
}
