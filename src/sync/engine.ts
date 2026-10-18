import type { PaperlessClient } from '../paperless/client';
import type { LookupKind, Lookups, PaperlessDocument, ServerInfo } from '../paperless/types';
import { applyContentSection, contentTagIds, renderContentSection } from './content';
import { buildTagFilter, unknownFilterTags } from './filter';
import { applyNotesSection, renderNotesSection } from './notes';
import {
	buildNotePath,
	renderTemplate,
	templateUses,
	templateVariables,
} from './filename';
import {
	applyProperties,
	buildProperties,
	documentUrl,
	PROPERTY,
	propertiesDiffer,
	readDocumentId,
	unknownKeys,
	type Properties,
} from './properties';

export interface NoteRef {
	path: string;
	properties: Record<string, unknown>;
}

/** The vault operations the sync needs. Implemented with the Obsidian API in the plugin. */
export interface VaultPort {
	/** All notes whose properties contain a Paperless document ID. */
	listDocumentNotes(): Promise<NoteRef[]>;
	exists(path: string): boolean;
	/** Creates the note and any missing parent folders. Rejects if the path is taken. */
	createNote(path: string, properties: Properties, body: string): Promise<void>;
	updateProperties(
		path: string,
		update: (properties: Record<string, unknown>) => void,
	): Promise<void>;
	/** Changes the note's text, frontmatter included. Resolves to false if nothing changed. */
	updateText(path: string, update: (text: string) => string): Promise<boolean>;
}

export interface SyncOptions {
	folder: string;
	fileNameTemplate: string;
	/** Body of newly created notes. Existing note bodies are never changed. */
	noteTemplate: string;
	linkBaseUrl: string;
	linkMetadata: boolean;
	includeCustomFields: boolean;
	/**
	 * Documents with this tag get their text in a managed section of their note, which is
	 * kept up to date and removed when the tag is. Empty turns this off.
	 */
	contentTag: string;
	/** Keep the notes written on each document in Paperless-ngx in a managed section. */
	includeNotes: boolean;
	/** Comma separated tag names. If set, only documents with one of them are synced. */
	includeTags: string;
	/** Comma separated tag names. Documents with one of them are not synced. */
	excludeTags: string;
}

/** Limits a sync to some documents, for example to the note that is open. */
export interface SyncScope {
	ids: readonly number[];
}

export interface SyncFailure {
	documentId: number;
	message: string;
}

export interface SyncResult {
	server: ServerInfo;
	documents: number;
	created: number;
	/** Paths of the notes created by this sync. */
	createdPaths: string[];
	updated: number;
	unchanged: number;
	/** Documents left out by the tag filters. Their notes are neither updated nor flagged. */
	excluded: number;
	/** Names in the tag filters that match no tag in Paperless-ngx. */
	unknownFilterTags: string[];
	/** Notes newly flagged because their document is no longer on the server. */
	missing: number;
	/** Documents that have more than one note. */
	duplicateIds: number[];
	failures: SyncFailure[];
	/**
	 * False if the document list was incomplete or removed documents could not be checked;
	 * missing documents are not flagged then.
	 */
	complete: boolean;
	/** Lists the API user may not read; the properties that come from them were kept. */
	unavailable: LookupKind[];
}

const MAX_NAME_ATTEMPTS = 5;

/**
 * One-way sync from Paperless-ngx into the vault: creates a note for every new document,
 * updates the managed properties of existing notes and flags notes of removed documents.
 * Notes are matched by their `paperless_id` property, never by path, and never deleted.
 * With a scope, only the documents in it are synced and checked for removal.
 */
export async function runSync(
	client: PaperlessClient,
	vault: VaultPort,
	options: SyncOptions,
	scope?: SyncScope,
): Promise<SyncResult> {
	const server = await client.connect();
	const lookups = await client.fetchLookups(options.includeCustomFields);
	const isSynced = buildTagFilter(options, lookups);
	const listOptions = {
		includeCustomFields: options.includeCustomFields,
		includeNotes: options.includeNotes,
	};
	const listing =
		scope === undefined
			? await client.listDocuments(listOptions)
			: { documents: await client.fetchDocuments(scope.ids, listOptions), complete: true };
	const inScope = scope === undefined ? null : new Set(scope.ids);

	const notesById = new Map<number, NoteRef[]>();
	for (const note of await vault.listDocumentNotes()) {
		const id = readDocumentId(note.properties);
		if (id === null || (inScope !== null && !inScope.has(id))) continue;
		const notes = notesById.get(id) ?? [];
		notes.push(note);
		notesById.set(id, notes);
	}

	const result: SyncResult = {
		server,
		documents: listing.documents.length,
		created: 0,
		createdPaths: [],
		updated: 0,
		unchanged: 0,
		excluded: 0,
		unknownFilterTags: unknownFilterTags(options, lookups),
		missing: 0,
		duplicateIds: [],
		failures: [],
		complete: listing.complete,
		// Sorted, because the lists are fetched in parallel and fail in any order.
		unavailable: [...lookups.unavailable].sort(),
	};

	// Without the setting, note texts are never read. Without the tags list, it is unknown
	// which documents are opted in, so their sections are left as they are.
	const tagIds =
		options.contentTag.trim() === '' ? null : contentTagIds(options.contentTag, lookups);
	const hasContentTag = (document: PaperlessDocument): boolean =>
		tagIds !== null && (document.tags ?? []).some((id) => tagIds.has(id));

	// The text is fetched for opted-in documents and, if the note template uses it, for new
	// notes, because the template is only rendered when a note is created.
	const templateContent = templateUses(options.noteTemplate, 'content');
	const contentIds = listing.documents
		.filter(
			(document) =>
				isSynced(document.tags) &&
				(hasContentTag(document) || (templateContent && !notesById.has(document.id))),
		)
		.map((document) => document.id);
	const contents =
		contentIds.length > 0
			? await client.fetchContents(contentIds)
			: new Map<number, string>();
	const isUnknown = unknownKeys(lookups.unavailable);

	const seen = new Set<number>();
	for (const document of listing.documents) {
		seen.add(document.id);
		if (!isSynced(document.tags)) {
			result.excluded++;
			continue;
		}
		const notes = notesById.get(document.id);
		// Turned off, notes sections are removed. Without the notes field, for example on an
		// old server, they are left as they are.
		const syncNotes = !options.includeNotes || document.notes !== undefined;
		const notesSection = options.includeNotes ? renderNotesSection(document.notes ?? []) : null;
		try {
			const desired = buildProperties(document, lookups, options);
			if (notes === undefined) {
				const content = contents.get(document.id) ?? document.content;
				const section = hasContentTag(document) ? renderContentSection(content) : null;
				const path = await createNote(
					vault,
					{ ...document, content },
					lookups,
					desired,
					{ content: section, notes: notesSection },
					options,
				);
				result.created++;
				result.createdPaths.push(path);
				continue;
			}
			if (notes.length > 1) result.duplicateIds.push(document.id);
			let changed = false;
			for (const note of notes) {
				if (!propertiesDiffer(note.properties, desired, isUnknown)) continue;
				await vault.updateProperties(note.path, (properties) =>
					applyProperties(properties, desired, isUnknown),
				);
				changed = true;
			}
			// Reading every note is cheap: a note is only written if its text changes.
			if (tagIds !== null || syncNotes) {
				const contentSection = hasContentTag(document)
					? renderContentSection(contents.get(document.id))
					: null;
				const update = (text: string): string => {
					let updated = tagIds === null ? text : applyContentSection(text, contentSection);
					if (syncNotes) updated = applyNotesSection(updated, notesSection);
					return updated;
				};
				for (const note of notes) {
					const textChanged = await vault.updateText(note.path, update);
					changed ||= textChanged;
				}
			}
			if (changed) result.updated++;
			else result.unchanged++;
		} catch (error) {
			result.failures.push(failure(document.id, error));
		}
	}

	if (listing.complete) {
		const gone = [...notesById]
			.filter(
				([id, notes]) =>
					!seen.has(id) &&
					notes.some((note) => note.properties[PROPERTY.missing] !== true),
			)
			.map(([id]) => id);
		const confirmed = await confirmGone(client, gone);
		if (confirmed === null) result.complete = false;
		for (const id of confirmed ?? []) {
			for (const note of notesById.get(id) ?? []) {
				if (note.properties[PROPERTY.missing] === true) continue;
				try {
					await vault.updateProperties(note.path, (properties) => {
						properties[PROPERTY.missing] = true;
					});
					result.missing++;
				} catch (error) {
					result.failures.push(failure(id, error));
				}
			}
		}
	}

	return result;
}

async function createNote(
	vault: VaultPort,
	document: PaperlessDocument,
	lookups: Lookups,
	properties: Properties,
	sections: { content: string | null; notes: string | null },
	options: SyncOptions,
): Promise<string> {
	const variables = templateVariables(
		document,
		lookups,
		documentUrl(options.linkBaseUrl, document.id),
	);
	const rendered = renderTemplate(options.noteTemplate, variables);
	const text = rendered === '' || rendered.endsWith('\n') ? rendered : `${rendered}\n`;
	const body = applyNotesSection(applyContentSection(text, sections.content), sections.notes);

	let lastError: unknown = null;
	for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
		const path = buildNotePath(
			options.folder,
			options.fileNameTemplate,
			variables,
			document.id,
			attempt,
		);
		if (vault.exists(path)) continue;
		try {
			await vault.createNote(path, properties, body);
			return path;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error('No free file name was found.');
}

/**
 * Returns the IDs the server no longer knows, or `null` if it could not be asked. The
 * document list can shift while it is fetched page by page, so a document that seems to be
 * gone is checked once more before its notes are flagged.
 */
async function confirmGone(
	client: PaperlessClient,
	ids: number[],
): Promise<number[] | null> {
	try {
		const existing = await client.existingIds(ids);
		return ids.filter((id) => !existing.has(id));
	} catch {
		return null;
	}
}

function failure(documentId: number, error: unknown): SyncFailure {
	return {
		documentId,
		message: error instanceof Error ? error.message : String(error),
	};
}
