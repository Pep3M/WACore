import { describe, expect, it, beforeEach } from 'bun:test';
import { InMemoryContactStore } from '../storage/contact-store';

const LINEA = 'cuenta-a:1';
const OTRA_LINEA = 'cuenta-b:2';

describe('InMemoryContactStore', () => {
  let store: InMemoryContactStore;

  beforeEach(() => {
    store = new InMemoryContactStore();
  });

  it('upserts a contact and retrieves it via list', async () => {
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice' });
    const result = await store.list(LINEA);
    expect(result.total).toBe(1);
    expect(result.items[0]!.name).toBe('Alice');
    expect(result.items[0]!.phone).toBe('1');
    expect(result.items[0]!.jid).toBe('1@s.whatsapp.net');
    expect(result.items[0]!.avatar).toBeNull();
    expect(result.items[0]!.isBusiness).toBe(false);
    expect(result.items[0]!.isMyContact).toBe(false);
    expect(result.items[0]!.isGroup).toBe(false);
  });

  it('upsertMany inserts multiple contacts', async () => {
    await store.upsertMany(LINEA, [
      { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice' },
      { jid: '2@s.whatsapp.net', phone: '2', bookName: 'Bob' },
      { jid: '3@g.us', bookName: 'Group Chat', isGroup: true },
    ]);
    const result = await store.list(LINEA, { includeGroups: true });
    expect(result.total).toBe(3);
  });

  it('is idempotent: upserting same jid updates the entry', async () => {
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice' });
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice Updated', inAddressBook: true });
    const result = await store.list(LINEA);
    expect(result.total).toBe(1);
    expect(result.items[0]!.name).toBe('Alice Updated');
    expect(result.items[0]!.isMyContact).toBe(true);
  });

  it('preserves existing optional fields when new upsert has nulls', async () => {
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice', profilePicUrl: 'https://pic.url' });
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1' });
    const result = await store.list(LINEA);
    expect(result.items[0]!.avatar).toBe('https://pic.url');
    expect(result.items[0]!.name).toBe('Alice');
  });

  it('filters out groups by default', async () => {
    await store.upsertMany(LINEA, [
      { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice' },
      { jid: '2@g.us', bookName: 'My Group', isGroup: true },
    ]);
    const result = await store.list(LINEA);
    expect(result.total).toBe(1);
    expect(result.items[0]!.name).toBe('Alice');
  });

  it('includes groups when includeGroups=true', async () => {
    await store.upsertMany(LINEA, [
      { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice' },
      { jid: '2@g.us', bookName: 'My Group', isGroup: true },
    ]);
    const result = await store.list(LINEA, { includeGroups: true });
    expect(result.total).toBe(2);
  });

  it('filters by onlyMyContacts', async () => {
    await store.upsertMany(LINEA, [
      { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice', inAddressBook: true },
      { jid: '2@s.whatsapp.net', phone: '2', pushName: 'Bob' },
    ]);
    const result = await store.list(LINEA, { onlyMyContacts: true });
    expect(result.total).toBe(1);
    expect(result.items[0]!.name).toBe('Alice');
  });

  it('searches by name (case-insensitive)', async () => {
    await store.upsertMany(LINEA, [
      { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice Wonderland' },
      { jid: '2@s.whatsapp.net', phone: '2', bookName: 'Bob Smith' },
    ]);
    const result = await store.list(LINEA, { q: 'alice' });
    expect(result.total).toBe(1);
    expect(result.items[0]!.name).toBe('Alice Wonderland');
  });

  it('searches by phone', async () => {
    await store.upsertMany(LINEA, [
      { jid: '34123456789@s.whatsapp.net', phone: '34123456789', bookName: 'Alice' },
      { jid: '34999999999@s.whatsapp.net', phone: '34999999999', bookName: 'Bob' },
    ]);
    const result = await store.list(LINEA, { q: '34123' });
    expect(result.total).toBe(1);
    expect(result.items[0]!.phone).toBe('34123456789');
  });

  it('paginates correctly', async () => {
    for (let i = 0; i < 10; i++) {
      await store.upsert(LINEA, { jid: `${i}@s.whatsapp.net`, phone: `${i}`, bookName: `Contact ${i}` });
    }
    const page1 = await store.list(LINEA, { limit: 3, offset: 0 });
    expect(page1.items.length).toBe(3);
    expect(page1.total).toBe(10);

    const page2 = await store.list(LINEA, { limit: 3, offset: 3 });
    expect(page2.items.length).toBe(3);
    expect(page1.items[0]!.jid).not.toBe(page2.items[0]!.jid);
  });

  it('limits to max 500', async () => {
    const result = await store.list(LINEA, { limit: 9999 });
    expect(result.total).toBe(0);
  });

  it('orders by name by default', async () => {
    await store.upsertMany(LINEA, [
      { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Zara' },
      { jid: '2@s.whatsapp.net', phone: '2', bookName: 'Alice' },
      { jid: '3@s.whatsapp.net', phone: '3', bookName: 'Miguel' },
    ]);
    const result = await store.list(LINEA, { orderBy: 'name' });
    expect(result.items.map(c => c.name)).toEqual(['Alice', 'Miguel', 'Zara']);
  });

  it('orders by updated_at descending', async () => {
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', bookName: 'First' });
    await new Promise(r => setTimeout(r, 5));
    await store.upsert(LINEA, { jid: '2@s.whatsapp.net', phone: '2', bookName: 'Second' });
    const result = await store.list(LINEA, { orderBy: 'updated_at' });
    expect(result.items[0]!.name).toBe('Second');
  });

  it('setProfilePic updates avatar', async () => {
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice' });
    await store.setProfilePic(LINEA, '1@s.whatsapp.net', 'https://new-pic.url');
    const result = await store.list(LINEA);
    expect(result.items[0]!.avatar).toBe('https://new-pic.url');
  });

  it('setProfilePic with null clears avatar', async () => {
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice', profilePicUrl: 'https://pic.url' });
    await store.setProfilePic(LINEA, '1@s.whatsapp.net', null);
    const result = await store.list(LINEA);
    expect(result.items[0]!.avatar).toBeNull();
  });

  it('returns empty result when no contacts', async () => {
    const result = await store.list(LINEA);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});

/**
 * Lo que rompía la importación al consumidor: la agenda era una sola para todo el servicio y cada
 * mensaje entrante sacaba al contacto de la agenda.
 */
describe('InMemoryContactStore — la agenda es de cada línea', () => {
  let store: InMemoryContactStore;

  beforeEach(() => {
    store = new InMemoryContactStore();
  });

  it('una línea no ve los contactos de otra', async () => {
    await store.upsert(LINEA, { jid: '34600111222@s.whatsapp.net', phone: '34600111222', bookName: 'Amy', inAddressBook: true });
    await store.upsert(OTRA_LINEA, { jid: '34699999999@s.whatsapp.net', phone: '34699999999', bookName: 'De otra empresa', inAddressBook: true });

    const deUna = await store.list(LINEA);
    const deOtra = await store.list(OTRA_LINEA);

    expect(deUna.items.map(c => c.name)).toEqual(['Amy']);
    expect(deOtra.items.map(c => c.name)).toEqual(['De otra empresa']);
  });

  it('el mismo número en dos líneas guarda nombre y marca propios en cada una', async () => {
    const jid = '34600111222@s.whatsapp.net';
    await store.upsert(LINEA, { jid, phone: '34600111222', bookName: 'Amy Iglesia', inAddressBook: true });
    await store.upsert(OTRA_LINEA, { jid, phone: '34600111222', pushName: 'Amy' });

    expect((await store.list(LINEA)).items[0]).toMatchObject({ name: 'Amy Iglesia', inAddressBook: true });
    expect((await store.list(OTRA_LINEA)).items[0]).toMatchObject({ name: 'Amy', inAddressBook: false });
  });

  it('un pushName posterior no borra el nombre de la agenda ni la saca de ella', async () => {
    const jid = '34600111222@s.whatsapp.net';
    await store.upsert(LINEA, { jid, phone: '34600111222', bookName: 'Amy Iglesia', inAddressBook: true });
    await store.upsert(LINEA, { jid, phone: '34600111222', pushName: 'amy 🌸' });

    const [amy] = (await store.list(LINEA, { onlyMyContacts: true })).items;
    expect(amy).toMatchObject({ name: 'Amy Iglesia', pushName: 'amy 🌸', inAddressBook: true, isMyContact: true });
  });

  it('el nombre que se enseña prefiere la agenda al pushName', async () => {
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', pushName: 'Como se llama él' });
    expect((await store.list(LINEA)).items[0]!.name).toBe('Como se llama él');

    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', bookName: 'Como lo guardé yo' });
    expect((await store.list(LINEA)).items[0]!.name).toBe('Como lo guardé yo');
  });

  it('un contacto solo conocido por su LID no tiene teléfono', async () => {
    await store.upsert(LINEA, { jid: '211617400811648@lid', phone: null, lid: '211617400811648@lid', bookName: 'Sin número' });
    const [c] = (await store.list(LINEA)).items;
    expect(c!.phone).toBeNull();
    expect(c!.lid).toBe('211617400811648@lid');
  });

  it('mergeLid convierte la fila del LID en la del teléfono si esta no existe', async () => {
    await store.upsert(LINEA, { jid: '211617400811648@lid', lid: '211617400811648@lid', bookName: 'Amy', inAddressBook: true });
    await store.mergeLid(LINEA, '211617400811648@lid', '34600111222@s.whatsapp.net');

    const { items, total } = await store.list(LINEA);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      jid: '34600111222@s.whatsapp.net',
      phone: '34600111222',
      lid: '211617400811648@lid',
      name: 'Amy',
      inAddressBook: true,
    });
  });

  it('mergeLid funde las dos filas: lo del teléfono manda y lo del LID rellena huecos', async () => {
    await store.upsert(LINEA, { jid: '211617400811648@lid', lid: '211617400811648@lid', bookName: 'Amy Iglesia', inAddressBook: true });
    await store.upsert(LINEA, { jid: '34600111222@s.whatsapp.net', phone: '34600111222', pushName: 'amy' });

    await store.mergeLid(LINEA, '211617400811648@lid', '34600111222@s.whatsapp.net');

    const { items, total } = await store.list(LINEA);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ phone: '34600111222', name: 'Amy Iglesia', pushName: 'amy', inAddressBook: true });
  });

  it('un contacto que llega con teléfono y LID absorbe la fila del LID', async () => {
    await store.upsert(LINEA, { jid: '211617400811648@lid', lid: '211617400811648@lid', pushName: 'amy' });
    await store.upsert(LINEA, {
      jid: '34600111222@s.whatsapp.net',
      phone: '34600111222',
      lid: '211617400811648@lid',
      bookName: 'Amy Iglesia',
      inAddressBook: true,
    });

    const { items, total } = await store.list(LINEA);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ jid: '34600111222@s.whatsapp.net', name: 'Amy Iglesia', pushName: 'amy' });
  });

  it('purgeSession borra la agenda de esa línea y solo de esa', async () => {
    await store.upsert(LINEA, { jid: '1@s.whatsapp.net', phone: '1', bookName: 'Alice' });
    await store.upsert(OTRA_LINEA, { jid: '2@s.whatsapp.net', phone: '2', bookName: 'Bob' });

    await store.purgeSession(LINEA);

    expect((await store.list(LINEA)).total).toBe(0);
    expect((await store.list(OTRA_LINEA)).total).toBe(1);
  });
});
