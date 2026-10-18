import type { PaperlessNote } from '../paperless/types';
import { CONTENT_START } from './content';
import { applySection, quoteLines, type SectionMarkers } from './sections';
import { toDate } from './properties';

export const NOTES_START = '%% paperless-notes start %%';
export const NOTES_END = '%% paperless-notes end %%';
export const NOTES_MARKERS: SectionMarkers = { start: NOTES_START, end: NOTES_END };

const CALLOUT_HEADER = '> [!note]- Paperless notes';

/**
 * The notes written on a document in Paperless-ngx, oldest first, as a collapsed callout
 * between the markers, or `null` if there are none.
 */
export function renderNotesSection(notes: readonly PaperlessNote[]): string | null {
	const entries = notes
		.map((note) => ({ ...note, text: (note.note ?? '').replace(/\r\n?/g, '\n').trim() }))
		.filter((note) => note.text !== '')
		.sort((a, b) => (a.created ?? '').localeCompare(b.created ?? '') || a.id - b.id);
	if (entries.length === 0) return null;
	const lines = [NOTES_START, CALLOUT_HEADER];
	entries.forEach((note, index) => {
		if (index > 0) lines.push('>');
		const heading = [toDate(note.created), userName(note.user)]
			.filter((part) => part !== undefined)
			.join(', ');
		if (heading !== '') lines.push(`> **${heading}**`);
		lines.push(...quoteLines(note.text));
	});
	lines.push(NOTES_END);
	return lines.join('\n');
}

/** Like `applyContentSection`. A new notes section goes in front of the document text. */
export function applyNotesSection(text: string, section: string | null): string {
	return applySection(text, NOTES_MARKERS, section, CONTENT_START);
}

function userName(user: PaperlessNote['user']): string | undefined {
	if (typeof user !== 'object' || user === null) return undefined;
	const name = user.username?.trim();
	return name === undefined || name === '' ? undefined : name;
}
