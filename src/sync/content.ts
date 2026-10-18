import type { Lookups } from '../paperless/types';
import { applySection, quoteLines, type SectionMarkers } from './sections';

/**
 * The document text section is the only part of a note's text that the sync changes after
 * the note was created. These lines mark where it starts and ends. Obsidian hides `%%`
 * comments in reading view. The start line also carries the document's modification time,
 * so the text is only downloaded again when the document changed.
 */
export const CONTENT_START = '%% paperless-content start';
export const CONTENT_END = '%% paperless-content end %%';
/** A start line, with or without the modification time. */
export const CONTENT_START_LINE = /^%% paperless-content start(?: ([^\s%]+))? %%$/;
export const CONTENT_MARKERS: SectionMarkers = {
	start: CONTENT_START_LINE,
	end: CONTENT_END,
	label: `${CONTENT_START} %%`,
};

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
	const start = stamp === '' ? `${CONTENT_START} %%` : `${CONTENT_START} ${stamp} %%`;
	return [start, CALLOUT_HEADER, ...quoteLines(text), CONTENT_END].join('\n');
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
		const match = CONTENT_START_LINE.exec(line);
		if (match !== null) return match[1] ?? '';
	}
	return null;
}

/**
 * Puts the section into the note text, replacing an existing one, or removes it if
 * `section` is `null`. See `applySection`.
 */
export function applyContentSection(text: string, section: string | null): string {
	return applySection(text, CONTENT_MARKERS, section);
}
