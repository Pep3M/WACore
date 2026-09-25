import { describe, expect, it } from 'bun:test';
import { createSentRegistry } from '../services/sent-registry';

const JID = '123456@s.whatsapp.net';

describe('SentRegistry', () => {
  it('reconoce la clave que se acaba de apuntar', () => {
    const reg = createSentRegistry({ ttlMs: 60_000, max: 100 });

    reg.remember(JID, 'msg-001');

    expect(reg.has(JID, 'msg-001')).toBe(true);
  });

  it('no reconoce lo que nunca salió por la API', () => {
    const reg = createSentRegistry({ ttlMs: 60_000, max: 100 });

    reg.remember(JID, 'msg-001');

    expect(reg.has(JID, 'msg-999')).toBe(false);
  });

  it('distingue el mismo id en conversaciones distintas', () => {
    const reg = createSentRegistry({ ttlMs: 60_000, max: 100 });

    reg.remember(JID, 'msg-001');

    expect(reg.has('999999@s.whatsapp.net', 'msg-001')).toBe(false);
  });

  it('consultar no consume: el eco puede repetirse tras una reconexión', () => {
    const reg = createSentRegistry({ ttlMs: 60_000, max: 100 });

    reg.remember(JID, 'msg-001');

    expect(reg.has(JID, 'msg-001')).toBe(true);
    expect(reg.has(JID, 'msg-001')).toBe(true);
    expect(reg.has(JID, 'msg-001')).toBe(true);
  });

  it('olvida al cumplirse el plazo', async () => {
    const reg = createSentRegistry({ ttlMs: 20, max: 100 });

    reg.remember(JID, 'msg-001');
    await new Promise(r => setTimeout(r, 40));

    expect(reg.has(JID, 'msg-001')).toBe(false);
    expect(reg.size()).toBe(0);
  });

  it('desaloja lo más viejo al llenarse', () => {
    const reg = createSentRegistry({ ttlMs: 60_000, max: 3 });

    reg.remember(JID, 'a');
    reg.remember(JID, 'b');
    reg.remember(JID, 'c');
    reg.remember(JID, 'd');

    expect(reg.size()).toBe(3);
    expect(reg.has(JID, 'a')).toBe(false);
    expect(reg.has(JID, 'd')).toBe(true);
  });

  it('reapuntar una clave la rejuvenece frente al desalojo', () => {
    const reg = createSentRegistry({ ttlMs: 60_000, max: 3 });

    reg.remember(JID, 'a');
    reg.remember(JID, 'b');
    reg.remember(JID, 'c');
    reg.remember(JID, 'a');
    reg.remember(JID, 'd');

    // 'b' era la más vieja tras rejuvenecer 'a'
    expect(reg.has(JID, 'b')).toBe(false);
    expect(reg.has(JID, 'a')).toBe(true);
  });

  it('ignora las claves incompletas en lugar de guardar basura', () => {
    const reg = createSentRegistry({ ttlMs: 60_000, max: 100 });

    reg.remember('', 'msg-001');
    reg.remember(JID, '');

    expect(reg.size()).toBe(0);
    expect(reg.has('', 'msg-001')).toBe(false);
    expect(reg.has(JID, '')).toBe(false);
  });

  it('clear() lo vacía', () => {
    const reg = createSentRegistry({ ttlMs: 60_000, max: 100 });

    reg.remember(JID, 'msg-001');
    reg.clear();

    expect(reg.size()).toBe(0);
  });
});
