import { describe, expect, it } from 'vitest';
import {
	applyContentSection,
	CONTENT_END,
	CONTENT_START,
	contentTagIds,
	renderContentSection,
} from '../src/sync/content';
import { makeLookups } from './helpers';

const SECTION = renderContentSection('Erste Zeile\n\nZweite Zeile') ?? '';

describe('contentTagIds', () => {
	it('matches the tag name without regard to case and spaces', () => {
		const lookups = makeLookups({
			tags: new Map([
				[1, 'OBS-Sync '],
				[2, 'Inbox'],
			]),
		});
		expect(contentTagIds('obs-sync', lookups)).toEqual(new Set([1]));
		expect(contentTagIds('#obs-sync', lookups)).toEqual(new Set([1]));
		expect(contentTagIds('missing', lookups)).toEqual(new Set());
	});

	it('returns null if the tags cannot be read', () => {
		expect(contentTagIds('obs-sync', makeLookups({ unavailable: new Set(['tags']) }))).toBeNull();
	});
});

describe('renderContentSection', () => {
	it('quotes every line in a collapsed callout between the markers', () => {
		expect(renderContentSection('Erste Zeile\r\n\r\nZweite Zeile  \n')).toBe(
			[CONTENT_START, '> [!quote]- Document text', '> Erste Zeile', '>', '> Zweite Zeile', CONTENT_END].join('\n'),
		);
	});

	it('returns null for empty text', () => {
		expect(renderContentSection('  \n')).toBeNull();
		expect(renderContentSection(undefined)).toBeNull();
	});

	it('quotes a line of the text that looks like a marker', () => {
		expect(renderContentSection(CONTENT_END)?.split('\n').filter((line) => line === CONTENT_END)).toHaveLength(1);
	});
});

describe('applyContentSection', () => {
	it('appends the section after a blank line', () => {
		expect(applyContentSection('[Open](url)\n', SECTION)).toBe(`[Open](url)\n\n${SECTION}\n`);
		expect(applyContentSection('', SECTION)).toBe(`${SECTION}\n`);
	});

	it('replaces an existing section and keeps the text around it', () => {
		const text = `Mine\n\n${SECTION}\nMore of mine\n`;
		const updated = renderContentSection('Neu') ?? '';
		expect(applyContentSection(text, updated)).toBe(`Mine\n\n${updated}\nMore of mine\n`);
	});

	it('removes the section and the blank line in front of it', () => {
		expect(applyContentSection(`Mine\n\n${SECTION}\n`, null)).toBe('Mine\n');
		expect(applyContentSection(`${SECTION}\n`, null)).toBe('');
		expect(applyContentSection('Mine\n', null)).toBe('Mine\n');
	});

	it('round-trips without changes', () => {
		const text = applyContentSection('Mine\n', SECTION);
		expect(applyContentSection(text, SECTION)).toBe(text);
		expect(applyContentSection(text, null)).toBe('Mine\n');
	});

	it('refuses a section without an end marker', () => {
		expect(() => applyContentSection(`Mine\n${CONTENT_START}\n> text\n`, SECTION)).toThrow(/without/);
	});
});
