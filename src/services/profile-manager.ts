import { jidNormalizedUser } from 'baileys';
import type { WABusinessProfile } from 'baileys';
import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';

export interface ProfileMeSnapshot {
  jid: string;
  phone: string;
  name: string | null;
  status: string | null;
  picture: string | null;
}

export interface ContactProfileSnapshot {
  jid: string;
  exists: boolean;
  picture: string | null;
  status: string | null;
  businessProfile: WABusinessProfile | null;
}

export type ProfilePictureType = 'preview' | 'image';

export interface NumberCheck {
  /** El número tal y como lo pidió el llamante, para que pueda cruzarlo con su lista. */
  input: string;
  /** El JID canónico que devuelve WhatsApp, o null si el número no está en la red. */
  jid: string | null;
  exists: boolean;
}

export interface ProfileManager {
  getMe(): Promise<ProfileMeSnapshot>;
  getContact(jid: string): Promise<ContactProfileSnapshot>;
  checkNumbers(numbers: string[]): Promise<NumberCheck[]>;
  getPictureUrl(jid: string, type: ProfilePictureType): Promise<string | null>;
  updateName(name: string): Promise<void>;
  updateStatus(status: string): Promise<void>;
  updatePicture(image: Buffer | { url: string }): Promise<void>;
  removePicture(): Promise<void>;
}

function normalizeUserJid(jid: string): string {
  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
}

/** Por debajo de esto no es un teléfono, y preguntarlo solo gasta cuota. */
const MIN_CHECK_DIGITS = 6;

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

function isPrivacyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('item-not-found') || msg.includes('not-authorized') || msg.includes('forbidden');
}

export function createProfileManager(client: BaileysClient, logger: Logger): ProfileManager {
  function requireSocket() {
    if (!client.socket) throw new Error('WhatsApp socket not connected');
    return client.socket;
  }

  async function safePicture(sock: ReturnType<typeof requireSocket>, jid: string, type: ProfilePictureType): Promise<string | null> {
    try {
      const url = await sock.profilePictureUrl(jid, type);
      return url ?? null;
    } catch (err) {
      if (isPrivacyError(err)) return null;
      throw err;
    }
  }

  async function safeStatus(sock: ReturnType<typeof requireSocket>, jid: string): Promise<string | null> {
    try {
      const results = await sock.fetchStatus(jid);
      if (!results || results.length === 0) return null;
      // fetchStatus returns USyncQueryResultList; each entry carries a "status" field
      const first = results[0] as { status?: { status?: string | null } | null } | undefined;
      return first?.status?.status ?? null;
    } catch (err) {
      if (isPrivacyError(err)) return null;
      throw err;
    }
  }

  /**
   * `onWhatsApp` es variádico y **filtra de la respuesta los números que no
   * existen**, así que la lista que vuelve no se corresponde ni en orden ni en
   * tamaño con la que se pidió. Además puede devolver `undefined`. Aquí se
   * normaliza a un mapa «dígitos pedidos → JID canónico».
   */
  async function consultarLote(
    sock: ReturnType<typeof requireSocket>,
    digitos: string[],
  ): Promise<Map<string, string>> {
    const salida = new Map<string, string>();
    if (digitos.length === 0) return salida;

    const respuesta = await sock.onWhatsApp(...digitos);
    for (const fila of respuesta ?? []) {
      if (!fila || !fila.exists || typeof fila.jid !== 'string') continue;
      salida.set(soloDigitos(fila.jid.split('@')[0] ?? ''), fila.jid);
    }
    return salida;
  }

  return {
    async getMe() {
      const sock = requireSocket();
      const userId = sock.user?.id;
      if (!userId) throw new Error('WhatsApp session has no authenticated user yet');
      const jid = jidNormalizedUser(userId);
      const phone = jid.split('@')[0]?.split(':')[0] ?? '';
      const name = sock.user?.name ?? null;

      const [status, picture] = await Promise.all([
        safeStatus(sock, jid),
        safePicture(sock, jid, 'image'),
      ]);

      return { jid, phone, name, status, picture };
    },

    async getContact(jid) {
      const sock = requireSocket();
      const normalized = normalizeUserJid(jid);
      logger.debug('Fetching contact profile', { jid: normalized });

      const [existsResult, picture, status, business] = await Promise.all([
        sock.onWhatsApp(normalized).catch((): { jid: string; exists: boolean }[] => []),
        safePicture(sock, normalized, 'image'),
        safeStatus(sock, normalized),
        sock.getBusinessProfile(normalized).catch(() => null as WABusinessProfile | null | void),
      ]);

      const existsList = existsResult ?? [];
      const exists = existsList.length > 0 ? Boolean(existsList[0]?.exists) : false;
      const businessProfile: WABusinessProfile | null = business && typeof business === 'object' ? (business as WABusinessProfile) : null;

      return { jid: normalized, exists, picture, status, businessProfile };
    },

    async checkNumbers(numbers) {
      const sock = requireSocket();
      const entradas = numbers.map((n) => ({ input: n, digits: soloDigitos(n) }));

      // Se consulta una sola vez cada número distinto, y solo los que pueden
      // serlo: la lista de una campaña trae repetidos y basura.
      const consultables = [...new Set(
        entradas.filter((e) => e.digits.length >= MIN_CHECK_DIGITS).map((e) => e.digits),
      )];

      logger.debug('Checking numbers on WhatsApp', { asked: numbers.length, unique: consultables.length });
      const canonico = await consultarLote(sock, consultables);

      // Los que no vuelven son de dos clases indistinguibles en una consulta por
      // lote: los que no tienen WhatsApp y aquellos cuyo JID canónico no coincide
      // con lo que pedimos (México inserta un «1», Brasil el noveno dígito). Como
      // la respuesta viene filtrada, ni el orden ni el recuento permiten
      // separarlos. Se repreguntan de uno en uno, donde la correspondencia es
      // inequívoca: cuesta una consulta extra por número no encontrado, y a cambio
      // no se marca «sin WhatsApp» a un cliente real. Ese falso negativo es el
      // error caro, porque lo excluiría de todas las campañas siguientes.
      for (const digitos of consultables) {
        if (canonico.has(digitos)) continue;
        const suelto = await consultarLote(sock, [digitos]);
        const primero = suelto.values().next().value;
        if (primero) canonico.set(digitos, primero);
      }

      return entradas.map(({ input, digits }) => {
        const jid = canonico.get(digits) ?? null;
        return { input, jid, exists: jid !== null };
      });
    },

    async getPictureUrl(jid, type) {
      const sock = requireSocket();
      const normalized = jid.includes('@') ? jid : normalizeUserJid(jid);
      return safePicture(sock, normalized, type);
    },

    async updateName(name) {
      const sock = requireSocket();
      await sock.updateProfileName(name);
    },

    async updateStatus(status) {
      const sock = requireSocket();
      await sock.updateProfileStatus(status);
    },

    async updatePicture(image) {
      const sock = requireSocket();
      const userId = sock.user?.id;
      if (!userId) throw new Error('WhatsApp session has no authenticated user yet');
      const jid = jidNormalizedUser(userId);
      await sock.updateProfilePicture(jid, image);
    },

    async removePicture() {
      const sock = requireSocket();
      const userId = sock.user?.id;
      if (!userId) throw new Error('WhatsApp session has no authenticated user yet');
      const jid = jidNormalizedUser(userId);
      await sock.removeProfilePicture(jid);
    },
  };
}
