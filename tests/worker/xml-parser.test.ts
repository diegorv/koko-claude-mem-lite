import { describe, it, expect } from 'vitest';
import { parseObservationXml, parseSummaryXml } from '../../src/worker/xml-parser.js';

describe('parseObservationXml', () => {
  const validXml = `<observation>
  <type>feature</type>
  <title>Added user auth</title>
  <facts>
    <fact>OAuth2 with PKCE flow implemented</fact>
    <fact>Tokens stored in httpOnly cookies</fact>
  </facts>
  <narrative>Implemented full OAuth2 authentication flow.</narrative>
  <files_read>
    <file>src/auth.ts</file>
  </files_read>
  <files_modified>
    <file>src/routes/login.ts</file>
    <file>src/middleware/auth.ts</file>
  </files_modified>
</observation>`;

  it('parses complete valid XML with all fields', () => {
    const result = parseObservationXml(validXml);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('feature');
    expect(result!.title).toBe('Added user auth');
    expect(result!.facts).toEqual(['OAuth2 with PKCE flow implemented', 'Tokens stored in httpOnly cookies']);
    expect(result!.narrative).toBe('Implemented full OAuth2 authentication flow.');
    expect(result!.files_read).toEqual(['src/auth.ts']);
    expect(result!.files_modified).toEqual(['src/routes/login.ts', 'src/middleware/auth.ts']);
  });

  it('returns null for text with no <observation> tag', () => {
    expect(parseObservationXml('just some text')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseObservationXml('')).toBeNull();
  });

  it('handles missing optional fields', () => {
    const xml = '<observation><type>discovery</type></observation>';
    const result = parseObservationXml(xml);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('discovery');
    expect(result!.title).toBeNull();
    expect(result!.narrative).toBeNull();
    expect(result!.facts).toEqual([]);
    expect(result!.files_read).toEqual([]);
    expect(result!.files_modified).toEqual([]);
  });

  it('handles empty <facts> block', () => {
    const xml = '<observation><type>change</type><facts></facts></observation>';
    const result = parseObservationXml(xml);
    expect(result!.facts).toEqual([]);
  });

  it('defaults unknown type to discovery', () => {
    const xml = '<observation><type>unknown_type</type><title>Test</title></observation>';
    const result = parseObservationXml(xml);
    expect(result!.type).toBe('discovery');
  });

  it('defaults missing type to discovery', () => {
    const xml = '<observation><title>No type</title></observation>';
    const result = parseObservationXml(xml);
    expect(result!.type).toBe('discovery');
  });

  it.each(['bugfix', 'feature', 'refactor', 'discovery', 'decision', 'change', 'skip'])(
    'accepts valid type: %s',
    (type) => {
      const xml = `<observation><type>${type}</type></observation>`;
      const result = parseObservationXml(xml);
      expect(result!.type).toBe(type);
    }
  );

  it('trims whitespace from extracted fields', () => {
    const xml = '<observation><type>  feature  </type><title>  spaced  </title></observation>';
    const result = parseObservationXml(xml);
    expect(result!.type).toBe('feature');
    expect(result!.title).toBe('spaced');
  });

  it('handles XML embedded in surrounding text', () => {
    const text = 'Some prefix text\n<observation><type>bugfix</type><title>Fix crash</title></observation>\nSuffix.';
    const result = parseObservationXml(text);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('bugfix');
    expect(result!.title).toBe('Fix crash');
  });
});

describe('parseSummaryXml', () => {
  const validXml = `<summary>
  <request>Add dark mode</request>
  <investigated>Checked CSS variables and theme system</investigated>
  <learned>The app uses CSS custom properties for theming</learned>
  <completed>Dark mode toggle with CSS variable switching</completed>
  <next_steps>Add system preference detection</next_steps>
</summary>`;

  it('parses complete valid summary XML', () => {
    const result = parseSummaryXml(validXml);
    expect(result).not.toBeNull();
    expect(result!.request).toBe('Add dark mode');
    expect(result!.investigated).toBe('Checked CSS variables and theme system');
    expect(result!.learned).toBe('The app uses CSS custom properties for theming');
    expect(result!.completed).toBe('Dark mode toggle with CSS variable switching');
    expect(result!.next_steps).toBe('Add system preference detection');
  });

  it('returns null for text with no <summary> tag', () => {
    expect(parseSummaryXml('just text')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSummaryXml('')).toBeNull();
  });

  it('handles missing optional fields', () => {
    const xml = '<summary><request>Fix bug</request></summary>';
    const result = parseSummaryXml(xml);
    expect(result).not.toBeNull();
    expect(result!.request).toBe('Fix bug');
    expect(result!.investigated).toBeNull();
    expect(result!.learned).toBeNull();
    expect(result!.completed).toBeNull();
    expect(result!.next_steps).toBeNull();
  });

  it('handles XML embedded in surrounding text', () => {
    const text = 'Prefix\n<summary><request>Do X</request></summary>\nSuffix';
    const result = parseSummaryXml(text);
    expect(result!.request).toBe('Do X');
  });
});
