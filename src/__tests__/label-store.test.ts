import { describe, expect, it } from 'bun:test';
import { InMemoryLabelStore } from '../storage/label-store';

describe('InMemoryLabelStore', () => {
  it('upsert is idempotent and updates fields', async () => {
    const store = new InMemoryLabelStore();
    await store.upsertLabel('s1', { id: '1', name: 'Cliente', color: 3 });
    await store.upsertLabel('s1', { id: '1', name: 'Cliente nuevo', color: 5 });
    const l = await store.getLabel('s1', '1');
    expect(l).not.toBeNull();
    expect(l!.name).toBe('Cliente nuevo');
    expect(l!.color).toBe(5);
    expect(l!.deleted).toBe(false);
  });

  it('list filters deleted by default and returns sorted by name', async () => {
    const store = new InMemoryLabelStore();
    await store.upsertLabel('s1', { id: '1', name: 'Zeta', color: 0 });
    await store.upsertLabel('s1', { id: '2', name: 'Alfa', color: 0 });
    await store.upsertLabel('s1', { id: '3', name: 'Borrada', color: 0, deleted: true });

    const active = await store.listLabels('s1');
    expect(active.map(l => l.id)).toEqual(['2', '1']);

    const all = await store.listLabels('s1', { includeDeleted: true });
    expect(all.length).toBe(3);
  });

  it('isolates labels by sessionId', async () => {
    const store = new InMemoryLabelStore();
    await store.upsertLabel('s1', { id: '1', name: 'A', color: 0 });
    await store.upsertLabel('s2', { id: '1', name: 'B', color: 0 });
    const s1 = await store.getLabel('s1', '1');
    const s2 = await store.getLabel('s2', '1');
    expect(s1!.name).toBe('A');
    expect(s2!.name).toBe('B');
    expect((await store.listLabels('s1')).length).toBe(1);
  });

  it('addAssociation / removeAssociation and getAssociations group chats and messages', async () => {
    const store = new InMemoryLabelStore();
    await store.addAssociation('s1', { labelId: '1', type: 'chat', chatJid: 'a@s.whatsapp.net' });
    await store.addAssociation('s1', { labelId: '1', type: 'chat', chatJid: 'a@s.whatsapp.net' }); // dedup
    await store.addAssociation('s1', { labelId: '1', type: 'chat', chatJid: 'b@s.whatsapp.net' });
    await store.addAssociation('s1', { labelId: '1', type: 'message', chatJid: 'a@s.whatsapp.net', messageId: 'ID1' });

    let res = await store.getAssociations('s1', '1');
    expect(res.chats.sort()).toEqual(['a@s.whatsapp.net', 'b@s.whatsapp.net']);
    expect(res.messages).toEqual([{ chatJid: 'a@s.whatsapp.net', messageId: 'ID1' }]);

    await store.removeAssociation('s1', { labelId: '1', type: 'chat', chatJid: 'a@s.whatsapp.net' });
    res = await store.getAssociations('s1', '1');
    expect(res.chats).toEqual(['b@s.whatsapp.net']);
  });

  it('associations are scoped by sessionId', async () => {
    const store = new InMemoryLabelStore();
    await store.addAssociation('s1', { labelId: '1', type: 'chat', chatJid: 'a@s.whatsapp.net' });
    await store.addAssociation('s2', { labelId: '1', type: 'chat', chatJid: 'z@s.whatsapp.net' });
    const s1 = await store.getAssociations('s1', '1');
    const s2 = await store.getAssociations('s2', '1');
    expect(s1.chats).toEqual(['a@s.whatsapp.net']);
    expect(s2.chats).toEqual(['z@s.whatsapp.net']);
  });
});
