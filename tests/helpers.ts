import type { HttpGet, HttpResponse } from '../src/paperless/client';
import type {
	CustomFieldDefinition,
	Lookups,
	NamedItem,
	PaperlessDocument,
} from '../src/paperless/types';
import type { NoteRef, SyncOptions, VaultPort } from '../src/sync/engine';
import type { Properties } from '../src/sync/properties';

export const TOKEN = 'test-token';
export const SERVER = 'https://paperless.test';

export function makeDocument(
	overrides: Partial<PaperlessDocument> & { id: number },
): PaperlessDocument {
	return {
		title: `Document ${overrides.id}`,
		correspondent: null,
		document_type: null,
		storage_path: null,
		tags: [],
		created: '2024-01-15',
		added: '2024-01-16T09:30:00+01:00',
		archive_serial_number: null,
		custom_fields: [],
		...overrides,
	};
}

export function makeLookups(overrides: Partial<Lookups> = {}): Lookups {
	return {
		tags: new Map(),
		correspondents: new Map(),
		documentTypes: new Map(),
		storagePaths: new Map(),
		customFields: new Map(),
		...overrides,
	};
}

export const DEFAULT_OPTIONS: SyncOptions = {
	folder: 'Paperless',
	fileNameTemplate: '{{created}} {{title}}',
	noteTemplate: '[Open in Paperless]({{url}})\n',
	linkBaseUrl: SERVER,
	linkMetadata: false,
	includeCustomFields: true,
};

export interface FakeServerState {
	documents: PaperlessDocument[];
	tags: NamedItem[];
	correspondents: NamedItem[];
	documentTypes: NamedItem[];
	storagePaths: NamedItem[];
	customFields: CustomFieldDefinition[];
	/** Highest API version the server supports; `null` omits the header. */
	apiVersion: number | null;
	/** Reported instead of the real document count, to simulate a truncated listing. */
	reportedDocumentCount?: number;
}

export interface FakeServer {
	state: FakeServerState;
	httpGet: HttpGet;
	requests: { url: URL; headers: Record<string, string> }[];
}

export function createFakeServer(initial: Partial<FakeServerState> = {}): FakeServer {
	const state: FakeServerState = {
		documents: [],
		tags: [],
		correspondents: [],
		documentTypes: [],
		storagePaths: [],
		customFields: [],
		apiVersion: 10,
		...initial,
	};
	const requests: FakeServer['requests'] = [];

	const json = (status: number, body: unknown): HttpResponse => ({
		status,
		headers: {
			'content-type': 'application/json',
			...(state.apiVersion === null
				? {}
				: { 'x-api-version': String(state.apiVersion), 'x-version': '2.20.0' }),
		},
		text: JSON.stringify(body),
	});

	const httpGet: HttpGet = (rawUrl, headers) => {
		const url = new URL(rawUrl);
		requests.push({ url, headers });
		if (headers.Authorization !== `Token ${TOKEN}`) {
			return Promise.resolve(json(401, { detail: 'Invalid token.' }));
		}
		const version = /version=(\d+)/.exec(headers.Accept ?? '')?.[1];
		if (
			version !== undefined &&
			(state.apiVersion === null || Number(version) > state.apiVersion)
		) {
			return Promise.resolve(json(406, { detail: 'Not acceptable.' }));
		}

		const collections: Record<string, unknown[]> = {
			'/api/documents/': [...state.documents].sort((a, b) => a.id - b.id),
			'/api/tags/': state.tags,
			'/api/correspondents/': state.correspondents,
			'/api/document_types/': state.documentTypes,
			'/api/storage_paths/': state.storagePaths,
			'/api/custom_fields/': state.customFields,
		};
		const items = collections[url.pathname];
		if (items === undefined) {
			return Promise.resolve(json(404, { detail: 'Not found.' }));
		}

		const page = Number(url.searchParams.get('page') ?? '1');
		const pageSize = Number(url.searchParams.get('page_size') ?? '25');
		const start = (page - 1) * pageSize;
		let results: unknown[] = items.slice(start, start + pageSize);
		const fields = url.searchParams.get('fields')?.split(',');
		if (fields !== undefined) {
			results = results.map((item) =>
				Object.fromEntries(
					Object.entries(item as Record<string, unknown>).filter(([key]) =>
						fields.includes(key),
					),
				),
			);
		}
		const isDocuments = url.pathname === '/api/documents/';
		return Promise.resolve(
			json(200, {
				count:
					isDocuments && state.reportedDocumentCount !== undefined
						? state.reportedDocumentCount
						: items.length,
				next: start + pageSize < items.length ? `${rawUrl}&next` : null,
				previous: null,
				results,
			}),
		);
	};

	return { state, httpGet, requests };
}

export interface FakeNote {
	properties: Record<string, unknown>;
	body: string;
}

/** In-memory vault that round-trips properties through JSON like a YAML layer would. */
export class FakeVault implements VaultPort {
	notes = new Map<string, FakeNote>();
	writes = 0;
	failCreateFor: (path: string) => boolean = () => false;

	listDocumentNotes(): Promise<NoteRef[]> {
		const refs: NoteRef[] = [];
		for (const [path, note] of this.notes) {
			if (note.properties.paperless_id === undefined) continue;
			refs.push({ path, properties: clone(note.properties) });
		}
		return Promise.resolve(refs);
	}

	exists(path: string): boolean {
		return this.notes.has(path);
	}

	createNote(path: string, properties: Properties, body: string): Promise<void> {
		if (this.failCreateFor(path)) {
			return Promise.reject(new Error(`Cannot create ${path}`));
		}
		if (this.notes.has(path)) {
			return Promise.reject(new Error('File already exists.'));
		}
		this.notes.set(path, { properties: clone(properties), body });
		this.writes++;
		return Promise.resolve();
	}

	updateProperties(
		path: string,
		update: (properties: Record<string, unknown>) => void,
	): Promise<void> {
		const note = this.notes.get(path);
		if (note === undefined) return Promise.reject(new Error(`No note at ${path}`));
		update(note.properties);
		this.writes++;
		return Promise.resolve();
	}

	move(from: string, to: string): void {
		const note = this.notes.get(from);
		if (note === undefined) throw new Error(`No note at ${from}`);
		this.notes.delete(from);
		this.notes.set(to, note);
	}

	get(path: string): FakeNote {
		const note = this.notes.get(path);
		if (note === undefined) throw new Error(`No note at ${path}`);
		return note;
	}
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
