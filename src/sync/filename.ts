import type { Lookups, PaperlessDocument } from '../paperless/types';
import { toDate } from './properties';

export type TemplateVariables = Record<string, string>;

const MAX_NAME_CHARS = 120;
const MAX_NAME_BYTES = 200;

/** Characters that are invalid in file names or break links in Obsidian. */
const ILLEGAL_CHARS = new Set('\\/:*?"<>|#^[]');

/** Variables available in the file name and note templates. */
export function templateVariables(
	document: PaperlessDocument,
	lookups: Lookups,
	url: string,
): TemplateVariables {
	const created = toDate(document.created) ?? '';
	const name = (names: Map<number, string>, id: number | null): string =>
		typeof id === 'number' ? (names.get(id) ?? '') : '';
	return {
		id: String(document.id),
		title: document.title,
		created,
		created_year: created.slice(0, 4),
		created_month: created.slice(5, 7),
		correspondent: name(lookups.correspondents, document.correspondent),
		document_type: name(lookups.documentTypes, document.document_type),
		storage_path: name(lookups.storagePaths, document.storage_path),
		asn:
			document.archive_serial_number === null ||
			document.archive_serial_number === undefined
				? ''
				: String(document.archive_serial_number),
		url,
		content: document.content ?? '',
	};
}

/** Replaces `{{name}}` placeholders. Unknown names are left as they are. */
export function renderTemplate(
	template: string,
	variables: TemplateVariables,
): string {
	return template.replace(
		/\{\{\s*([a-z_]+)\s*\}\}/gi,
		(match: string, name: string) => variables[name.toLowerCase()] ?? match,
	);
}

export function templateUses(template: string, name: string): boolean {
	return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'i').test(template);
}

/** Makes a string safe to use as a single file or folder name. */
export function sanitizeFileName(name: string): string {
	let cleaned = '';
	for (const char of name) {
		const code = char.codePointAt(0) ?? 0;
		cleaned += ILLEGAL_CHARS.has(char) || code < 32 || code === 127 ? ' ' : char;
	}
	cleaned = cleaned
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.replace(/[. ]+$/, '')
		.trim();
	return truncate(cleaned);
}

/**
 * Builds the vault path for a new note. `attempt` 0 is the plain name; higher attempts
 * append the document ID so that a taken name never blocks a document.
 */
export function buildNotePath(
	folder: string,
	template: string,
	variables: TemplateVariables,
	id: number,
	attempt = 0,
): string {
	const safe: TemplateVariables = {};
	for (const [key, value] of Object.entries(variables)) {
		safe[key] = sanitizeFileName(value);
	}
	// The last part of the template is the file name, the parts before it are subfolders.
	// A part that renders empty drops its subfolder; an empty file name falls back to the ID.
	const parts = template.split('/').filter((part) => part.trim() !== '');
	const render = (part: string): string => sanitizeFileName(renderTemplate(part, safe));
	const segments = parts.slice(0, -1).map(render).filter((segment) => segment !== '');
	const last = parts[parts.length - 1];
	const rendered = last === undefined ? '' : render(last);
	let name = rendered === '' ? `Document ${id}` : rendered;
	if (attempt === 1) name = `${name} (${id})`;
	if (attempt > 1) name = `${name} (${id}-${attempt})`;

	const folders = folder
		.split('/')
		.map((segment) => segment.trim())
		.filter((segment) => segment !== '');
	return [...folders, ...segments, `${name}.md`].join('/');
}

function truncate(name: string): string {
	const chars = Array.from(name).slice(0, MAX_NAME_CHARS);
	const encoder = new TextEncoder();
	while (encoder.encode(chars.join('')).length > MAX_NAME_BYTES) chars.pop();
	return chars.join('').trim();
}
