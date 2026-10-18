import { describe, expect, it } from 'vitest';
import { applyContentSection, renderContentSection } from '../src/sync/content';
import { applyNotesSection, NOTES_END, NOTES_START, renderNotesSection } from '../src/sync/notes';

describe('renderNotesSection', () => {
	it('lists the notes oldest first with date and author', () => {
		const section = renderNotesSection([
			{ id: 2, note: 'Bezahlt am 3.4.', created: '2024-04-03T10:00:00Z', user: { id: 1, username: 'anh' } },
			{ id: 1, note: 'Frist beachten\n\nWichtig', created: '2024-03-01T08:00:00Z', user: 3 },
		]);
		expect(section).toBe(
			[
				NOTES_START,
				'> [!note]- Paperless notes',
				'> **2024-03-01**',
				'> Frist beachten',
				'>',
				'> Wichtig',
				'>',
				'> **2024-04-03, anh**',
				'> Bezahlt am 3.4.',
				NOTES_END,
			].join('\n'),
		);
	});

	it('returns null without notes', () => {
		expect(renderNotesSection([])).toBeNull();
		expect(renderNotesSection([{ id: 1, note: '  ', created: null }])).toBeNull();
	});
});

describe('applyNotesSection', () => {
	const notes = renderNotesSection([{ id: 1, note: 'Notiz', created: '2024-03-01' }]) ?? '';
	const content = renderContentSection('Text') ?? '';

	it('goes in front of the document text section', () => {
		const text = applyContentSection('Mine\n', content);
		const withNotes = applyNotesSection(text, notes);
		expect(withNotes).toBe(`Mine\n\n${notes}\n\n${content}\n`);
		expect(applyNotesSection(withNotes, null)).toBe(text);
	});

	it('goes in front of a document text section that carries a modification time', () => {
		const stamped = renderContentSection('Text', '2024-03-16T09:30:00+01:00') ?? '';
		const text = applyContentSection('Mine\n', stamped);
		expect(applyNotesSection(text, notes)).toBe(`Mine\n\n${notes}\n\n${stamped}\n`);
	});

	it('goes at the end without a document text section', () => {
		expect(applyNotesSection('Mine\n', notes)).toBe(`Mine\n\n${notes}\n`);
		expect(applyNotesSection(`Mine\n\n${notes}\n`, null)).toBe('Mine\n');
	});

	it('removes a section at the start of the note with the blank line after it', () => {
		const text = applyNotesSection(`${content}\n`, notes);
		expect(text).toBe(`${notes}\n\n${content}\n`);
		expect(applyNotesSection(text, null)).toBe(`${content}\n`);
	});
});
