import { describe, expect, it } from 'bun:test';
import { renderTemplate, extractVariables } from '../services/template-renderer';

describe('renderTemplate', () => {
  it('replaces simple placeholders', () => {
    const { text, missing } = renderTemplate('Hola {{name}}', { name: 'Juan' });
    expect(text).toBe('Hola Juan');
    expect(missing).toEqual([]);
  });

  it('replaces multiple occurrences of the same key', () => {
    const { text, missing } = renderTemplate('{{x}} y {{x}}', { x: 'A' });
    expect(text).toBe('A y A');
    expect(missing).toEqual([]);
  });

  it('reports missing variables and leaves placeholder intact', () => {
    const { text, missing } = renderTemplate('{{a}} {{b}} {{a}}', { a: '1' });
    expect(text).toBe('1 {{b}} 1');
    expect(missing).toEqual(['b']);
  });

  it('tolerates whitespace inside braces', () => {
    const { text, missing } = renderTemplate('Hola {{  name  }}', { name: 'Ana' });
    expect(text).toBe('Hola Ana');
    expect(missing).toEqual([]);
  });

  it('supports keys with dot / underscore / dash', () => {
    const { text, missing } = renderTemplate('{{user.first_name}}-{{co-id}}', {
      'user.first_name': 'Ana',
      'co-id': 'X',
    });
    expect(text).toBe('Ana-X');
    expect(missing).toEqual([]);
  });

  it('does not re-render substituted content', () => {
    const { text } = renderTemplate('{{a}}', { a: '{{b}}', b: 'nope' });
    expect(text).toBe('{{b}}');
  });

  it('deduplicates missing keys', () => {
    const { missing } = renderTemplate('{{a}} {{a}} {{b}}', {});
    expect(missing).toEqual(['a', 'b']);
  });

  it('empty vars object leaves all placeholders as missing', () => {
    const { text, missing } = renderTemplate('Hola {{name}}', {});
    expect(text).toBe('Hola {{name}}');
    expect(missing).toEqual(['name']);
  });
});

describe('extractVariables', () => {
  it('returns unique keys in first-seen order', () => {
    expect(extractVariables('{{a}} {{b}} {{a}} {{c}}')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array when no placeholders', () => {
    expect(extractVariables('sin variables')).toEqual([]);
  });
});
