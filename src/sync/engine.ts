import type { PaperlessClient } from '../paperless/client';
import type { LookupKind, Lookups, PaperlessDocument, ServerInfo } from '../paperless/types';
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
}

export interface SyncOptions {
	folder: string;
	fileNameTemplate: string;
	/** Body of newly created notes. Existing note bodies are never changed. */
	noteTemplate: string;
	linkBaseUrl: string;
	linkMetadata: boolean;
	includeCustomFields: boolean;
}

export interface SyncFailure {
	documentId: number;
	message: string;
}

export interface SyncResult {
	server: ServerInfo;
	documents: number;
	created: number;
	updated: number;
	unchanged: number;
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
 */
export async function runSync(
	client: PaperlessClient,
	vault: VaultPort,
	options: SyncOptions,
): Promise<SyncResult> {
	const server = await client.connect();
	const lookups = await client.fetchLookups(options.includeCustomFields);
	const listing = await client.listDocuments({
		includeCustomFields: options.includeCustomFields,
	});

	const notesById = new Map<number, NoteRef[]>();
	for (const note of await vault.listDocumentNotes()) {
		const id = readDocumentId(note.properties);
		if (id === null) continue;
		const notes = notesById.get(id) ?? [];
		notes.push(note);
		notesById.set(id, notes);
	}

	const result: SyncResult = {
		server,
		documents: listing.documents.length,
		created: 0,
		updated: 0,
		unchanged: 0,
		missing: 0,
		duplicateIds: [],
		failures: [],
		complete: listing.complete,
		unavailable: [...lookups.unavailable],
	};

	// The document text only goes into new notes, so it is fetched for those alone.
	const contents = templateUses(options.noteTemplate, 'content')
		? await client.fetchContents(
				listing.documents
					.filter((document) => !notesById.has(document.id))
					.map((document) => document.id),
			)
		: new Map<number, string>();
	const isUnknown = unknownKeys(lookups.unavailable);

	const seen = new Set<number>();
	for (const document of listing.documents) {
		seen.add(document.id);
		const notes = notesById.get(document.id);
		try {
			const desired = buildProperties(document, lookups, options);
			if (notes === undefined) {
				const content = contents.get(document.id) ?? document.content;
				await createNote(vault, { ...document, content }, lookups, desired, options);
				result.created++;
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
	options: SyncOptions,
): Promise<void> {
	const variables = templateVariables(
		document,
		lookups,
		documentUrl(options.linkBaseUrl, document.id),
	);
	const rendered = renderTemplate(options.noteTemplate, variables);
	const body = rendered === '' || rendered.endsWith('\n') ? rendered : `${rendered}\n`;

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
			return;
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
