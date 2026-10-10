import { describe, expect, it } from 'vitest';
import {
	buildNotePath,
	renderTemplate,
	sanitizeFileName,
	templateUses,
	templateVariables,
} from '../src/sync/filename';
import { makeDocument, makeLookups } from './helpers';

describe('renderTemplate', () => {
	it('replaces known variables and tolerates spaces and case', () => {
		expect(renderTemplate('{{created}} {{ Title }}', { created: '2024-01-15', title: 'Invoice' })).toBe(
			'2024-01-15 Invoice',
		);
	});

	it('leaves unknown variables untouched', () => {
		expect(renderTemplate('{{nope}} {{title}}', { title: 'A' })).toBe('{{nope}} A');
	});

	it('does not interpret replacement patterns in values', () => {
		expect(renderTemplate('{{title}}', { title: '$& $1' })).toBe('$& $1');
	});
});

describe('templateUses', () => {
	it('detects a variable regardless of spacing', () => {
		expect(templateUses('Text: {{ content }}', 'content')).toBe(true);
		expect(templateUses('[Open]({{url}})', 'content')).toBe(false);
	});
});

describe('sanitizeFileName', () => {
	it('replaces characters that are invalid in file names or links', () => {
		expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n')).toBe('a b c d e f g h i j k l m n');
	});

	it('removes control characters, leading dots and trailing dots or spaces', () => {
		expect(sanitizeFileName('..hidden\tname. . ')).toBe('hidden name');
	});

	it('limits the length in characters and bytes', () => {
		expect(Array.from(sanitizeFileName('a'.repeat(500)))).toHaveLength(120);
		const wide = sanitizeFileName('漢'.repeat(500));
		expect(new TextEncoder().encode(wide).length).toBeLessThanOrEqual(200);
		expect(wide.length).toBeGreaterThan(0);
	});
});

describe('buildNotePath', () => {
	const variables = templateVariables(
		makeDocument({ id: 7, title: 'Rechnung 03/2024: Strom', correspondent: 1 }),
		makeLookups({ correspondents: new Map([[1, 'Stadtwerke']]) }),
		'https://paperless.test/documents/7/details',
	);

	it('builds the default path and keeps slashes in values out of the folder structure', () => {
		expect(buildNotePath('Paperless', '{{created}} {{title}}', variables, 7)).toBe(
			'Paperless/2024-01-15 Rechnung 03 2024 Strom.md',
		);
	});

	it('supports subfolders in the template', () => {
		expect(buildNotePath('Paperless', '{{created_year}}/{{correspondent}}/{{title}}', variables, 7)).toBe(
			'Paperless/2024/Stadtwerke/Rechnung 03 2024 Strom.md',
		);
	});

	it('appends the document ID on later attempts', () => {
		expect(buildNotePath('Paperless', '{{title}}', variables, 7, 1)).toBe(
			'Paperless/Rechnung 03 2024 Strom (7).md',
		);
		expect(buildNotePath('Paperless', '{{title}}', variables, 7, 2)).toBe(
			'Paperless/Rechnung 03 2024 Strom (7-2).md',
		);
	});

	it('falls back to the document ID when the name would be empty', () => {
		const empty = templateVariables(
			makeDocument({ id: 9, title: '???', created: null }),
			makeLookups(),
			'',
		);
		expect(buildNotePath('Paperless', '{{created}} {{title}}', empty, 9)).toBe('Paperless/Document 9.md');
		expect(buildNotePath('Paperless', '{{correspondent}}/{{title}}', { ...variables, title: '???' }, 9)).toBe(
			'Paperless/Stadtwerke/Document 9.md',
		);
	});

	it('drops subfolders that render empty and ignores empty template parts', () => {
		expect(buildNotePath('Paperless', '{{asn}}/{{title}}', { ...variables, asn: '' }, 7)).toBe(
			'Paperless/Rechnung 03 2024 Strom.md',
		);
		expect(buildNotePath('Paperless', '/{{id}}//', variables, 7)).toBe('Paperless/7.md');
	});

	it('normalizes the folder and allows the vault root', () => {
		expect(buildNotePath('/Archive//Scans/', '{{id}}', variables, 7)).toBe('Archive/Scans/7.md');
		expect(buildNotePath('', '{{id}}', variables, 7)).toBe('7.md');
	});
});
