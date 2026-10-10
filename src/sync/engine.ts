import type { PaperlessClient } from '../paperless/client';
import type { Lookups, PaperlessDocument, ServerInfo } from '../paperless/types';
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
	/** False if the document list was incomplete; missing documents are not flagged then. */
	complete: boolean;
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
		includeContent: templateUses(options.noteTemplate, 'content'),
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
	};

	const seen = new Set<number>();
	for (const document of listing.documents) {
		seen.add(document.id);
		const notes = notesById.get(document.id);
		const desired = buildProperties(document, lookups, options);
		try {
			if (notes === undefined) {
				await createNote(vault, document, lookups, desired, options);
				result.created++;
				continue;
			}
			if (notes.length > 1) result.duplicateIds.push(document.id);
			let changed = false;
			for (const note of notes) {
				if (!propertiesDiffer(note.properties, desired)) continue;
				await vault.updateProperties(note.path, (properties) =>
					applyProperties(properties, desired),
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
		for (const [id, notes] of notesById) {
			if (seen.has(id)) continue;
			for (const note of notes) {
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

function failure(documentId: number, error: unknown): SyncFailure {
	return {
		documentId,
		message: error instanceof Error ? error.message : String(error),
	};
}
