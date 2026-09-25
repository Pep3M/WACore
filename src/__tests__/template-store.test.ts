import { describe, expect, it } from 'bun:test';
import { InMemoryTemplateStore, DuplicateTemplateNameError } from '../storage/template-store';

describe('InMemoryTemplateStore', () => {
  it('creates and retrieves a template', async () => {
    const store = new InMemoryTemplateStore();
    const t = await store.create('s1', { name: 'welcome', body: 'Hola {{n}}' });
    expect(t.id).toBeTruthy();
    expect(t.name).toBe('welcome');
    expect(t.media).toBeNull();
    const got = await store.get('s1', t.id);
    expect(got?.body).toBe('Hola {{n}}');
  });

  it('rejects duplicate names case-insensitive within a session', async () => {
    const store = new InMemoryTemplateStore();
    await store.create('s1', { name: 'Welcome', body: 'a' });
    await expect(store.create('s1', { name: 'welcome', body: 'b' })).rejects.toBeInstanceOf(DuplicateTemplateNameError);
  });

  it('allows same name in different sessions', async () => {
    const store = new InMemoryTemplateStore();
    await store.create('s1', { name: 'welcome', body: 'a' });
    const t2 = await store.create('s2', { name: 'welcome', body: 'b' });
    expect(t2.id).toBeTruthy();
  });

  it('list sorts by name and isolates by session', async () => {
    const store = new InMemoryTemplateStore();
    await store.create('s1', { name: 'zeta', body: 'z' });
    await store.create('s1', { name: 'alfa', body: 'a' });
    await store.create('s2', { name: 'other', body: 'x' });
    const items = await store.list('s1');
    expect(items.map(t => t.name)).toEqual(['alfa', 'zeta']);
    expect((await store.list('s2')).length).toBe(1);
  });

  it('update patches selected fields and refreshes updatedAt', async () => {
    const store = new InMemoryTemplateStore();
    const t = await store.create('s1', { name: 'a', body: 'x' });
    const before = t.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    const updated = await store.update('s1', t.id, { body: 'y' });
    expect(updated?.body).toBe('y');
    expect(updated?.name).toBe('a');
    expect(updated?.updatedAt).not.toBe(before);
  });

  it('update to duplicate name throws', async () => {
    const store = new InMemoryTemplateStore();
    await store.create('s1', { name: 'one', body: 'x' });
    const two = await store.create('s1', { name: 'two', body: 'y' });
    await expect(store.update('s1', two.id, { name: 'ONE' })).rejects.toBeInstanceOf(DuplicateTemplateNameError);
  });

  it('update media set / clear', async () => {
    const store = new InMemoryTemplateStore();
    const t = await store.create('s1', { name: 'a', body: 'x' });
    const withMedia = await store.update('s1', t.id, {
      media: { type: 'image', url: 'https://example.com/a.png' },
    });
    expect(withMedia?.media?.type).toBe('image');
    const cleared = await store.update('s1', t.id, { media: null });
    expect(cleared?.media).toBeNull();
  });

  it('update returns null for unknown id', async () => {
    const store = new InMemoryTemplateStore();
    expect(await store.update('s1', 'nope', { body: 'x' })).toBeNull();
  });

  it('delete returns true only on removal', async () => {
    const store = new InMemoryTemplateStore();
    const t = await store.create('s1', { name: 'a', body: 'x' });
    expect(await store.delete('s1', t.id)).toBe(true);
    expect(await store.delete('s1', t.id)).toBe(false);
    expect(await store.get('s1', t.id)).toBeNull();
  });
});
