import type { Lookups } from '../paperless/types';

/**
 * The document text section is the only part of a note's text that the sync changes after
 * the note was created. These lines mark where it starts and ends. Obsidian hides `%%`
 * comments in reading view. The start line also carries the document's modification time,
 * so the text is only downloaded again when the document changed.
 */
export const CONTENT_START = '%% paperless-content start';
export const CONTENT_END = '%% paperless-content end %%';

const START_LINE = /^%% paperless-content start(?: ([^\s%]+))? %%$/;

export type ContentMode = 'off' | 'tagged' | 'all';

export const CONTENT_MODES: readonly ContentMode[] = ['off', 'tagged', 'all'];

const CALLOUT_HEADER = '> [!quote]- Document text';

/**
 * The IDs of the tags that opt a document into syncing its text, matched by name without
 * regard to case. `null` means the tags could not be read, so it is unknown which documents
 * are opted in and note texts must be left as they are.
 */
export function contentTagIds(tagName: string, lookups: Lookups): Set<number> | null {
	if (lookups.unavailable.has('tags')) return null;
	const wanted = tagName.trim().replace(/^#/, '').toLowerCase();
	const ids = new Set<number>();
	for (const [id, name] of lookups.tags) {
		if (name.trim().toLowerCase() === wanted) ids.add(id);
	}
	return ids;
}

/**
 * The document text as a collapsed callout between the markers, or `null` if there is no
 * text. Every line is quoted, so no line of the text can be mistaken for a marker.
 */
export function renderContentSection(
	content: string | undefined,
	stamp = '',
): string | null {
	const text = (content ?? '').replace(/\r\n?/g, '\n').trim();
	if (text === '') return null;
	const quoted = text
		.split('\n')
		.map((line) => (line.trim() === '' ? '>' : `> ${line.trimEnd()}`));
	const start = stamp === '' ? `${CONTENT_START} %%` : `${CONTENT_START} ${stamp} %%`;
	return [start, CALLOUT_HEADER, ...quoted, CONTENT_END].join('\n');
}

/** The value a section stores for a document: its modification time, or '' if unknown. */
export function contentStamp(modified: string | null | undefined): string {
	return (modified ?? '').replace(/[\s%]/g, '');
}

/**
 * The stamp of the note's section, '' for a section without one, or `null` if the note has
 * no section.
 */
export function sectionStamp(text: string): string | null {
	for (const line of text.split('\n')) {
		const match = START_LINE.exec(line);
		if (match !== null) return match[1] ?? '';
	}
	return null;
}

/**
 * Puts the section into the note text, replacing an existing one, or removes it if
 * `section` is `null`. A new section goes at the end, after a blank line. Throws if the note
 * has a start marker without an end marker, because then it is unclear what to replace.
 */
export function applyContentSection(text: string, section: string | null): string {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => START_LINE.test(line));
	if (start === -1) {
		if (section === null) return text;
		const trimmed = text.replace(/\n+$/, '');
		return trimmed === '' ? `${section}\n` : `${trimmed}\n\n${section}\n`;
	}
	const end = lines.indexOf(CONTENT_END, start + 1);
	if (end === -1) {
		throw new Error(
			`The note has "${CONTENT_START}" without "${CONTENT_END}". Remove the document text section and sync again.`,
		);
	}
	if (section !== null) {
		return [...lines.slice(0, start), section, ...lines.slice(end + 1)].join('\n');
	}
	// Also remove the blank line that was added in front of the section.
	const from = start > 0 && lines[start - 1] === '' ? start - 1 : start;
	return [...lines.slice(0, from), ...lines.slice(end + 1)].join('\n');
}
