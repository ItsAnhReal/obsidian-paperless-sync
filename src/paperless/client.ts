import type {
	CustomFieldDefinition,
	DocumentListing,
	LookupKind,
	Lookups,
	NamedItem,
	Paginated,
	PaperlessDocument,
	SearchHit,
	ServerInfo,
} from './types';

export interface HttpResponse {
	status: number;
	/** Header names must be lower-case. */
	headers: Record<string, string>;
	text: string;
}

/** Performs a GET request. Rejects only if no response was received. */
export type HttpGet = (
	url: string,
	headers: Record<string, string>,
) => Promise<HttpResponse>;

export type PaperlessErrorKind =
	| 'config'
	| 'network'
	| 'auth'
	| 'not-found'
	| 'http'
	| 'invalid-response';

export class PaperlessError extends Error {
	readonly kind: PaperlessErrorKind;

	constructor(kind: PaperlessErrorKind, message: string) {
		super(message);
		this.name = 'PaperlessError';
		this.kind = kind;
	}
}

/** Newest API version this plugin has been written against. */
export const MAX_API_VERSION = 10;

const PAGE_SIZE = 100;
const MAX_PAGES = 10000;

const DOCUMENT_FIELDS = [
	'id',
	'title',
	'correspondent',
	'document_type',
	'storage_path',
	'tags',
	'created',
	'added',
	'modified',
	'archive_serial_number',
];

const SEARCH_FIELDS = 'id,title,created,correspondent,tags';

export interface DocumentListOptions {
	includeCustomFields: boolean;
	includeNotes: boolean;
}

function documentFields(options: DocumentListOptions): string {
	const fields = [...DOCUMENT_FIELDS];
	if (options.includeCustomFields) fields.push('custom_fields');
	if (options.includeNotes) fields.push('notes');
	return fields.join(',');
}

/** Trims the URL and removes trailing slashes. Returns `null` if it isn't an http(s) URL. */
export function normalizeServerUrl(url: string): string | null {
	const trimmed = url.trim().replace(/\/+$/, '');
	return /^https?:\/\/[^/\s]+/i.test(trimmed) ? trimmed : null;
}

/** Read-only client for the Paperless-ngx REST API. */
export class PaperlessClient {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly httpGet: HttpGet;
	private apiVersion: number | null = null;

	constructor(serverUrl: string, token: string, httpGet: HttpGet) {
		const baseUrl = normalizeServerUrl(serverUrl);
		if (baseUrl === null) {
			throw new PaperlessError(
				'config',
				'The server address must start with http:// or https://.',
			);
		}
		if (token.trim() === '') {
			throw new PaperlessError('config', 'The API token is missing.');
		}
		this.baseUrl = baseUrl;
		this.token = token.trim();
		this.httpGet = httpGet;
	}

	/**
	 * Checks the connection and picks the API version for all later requests:
	 * the newest version that both the server and this plugin know.
	 */
	async connect(): Promise<ServerInfo> {
		this.apiVersion = null;
		const { body, headers } = await this.get<Paginated<{ id: number }>>(
			'/api/documents/',
			{ page: '1', page_size: '1', fields: 'id' },
		);
		const reported = Number.parseInt(headers['x-api-version'] ?? '', 10);
		const apiVersion = Number.isFinite(reported) ? reported : null;
		this.apiVersion =
			apiVersion === null ? null : Math.min(apiVersion, MAX_API_VERSION);
		return {
			apiVersion,
			serverVersion: headers['x-version'] ?? null,
			documentCount: body.count,
		};
	}

	async listDocuments(options: DocumentListOptions): Promise<DocumentListing> {
		const { items, count } = await this.listAll<PaperlessDocument>(
			'/api/documents/',
			{ ordering: 'id', fields: documentFields(options) },
		);
		const byId = new Map<number, PaperlessDocument>();
		for (const document of items) byId.set(document.id, document);
		const documents = [...byId.values()].sort((a, b) => a.id - b.id);
		return { documents, complete: documents.length >= count };
	}

	/** Fetches the given documents, sorted by ID. Documents that no longer exist are left out. */
	async fetchDocuments(
		ids: readonly number[],
		options: DocumentListOptions,
	): Promise<PaperlessDocument[]> {
		const documents = await this.listByIds<PaperlessDocument>(ids, documentFields(options));
		return documents.sort((a, b) => a.id - b.id);
	}

	/** Runs the Paperless-ngx full text search and returns the best matches. */
	async search(query: string, limit: number): Promise<SearchHit[]> {
		const { body } = await this.get<Paginated<SearchHit>>('/api/documents/', {
			query,
			page: '1',
			page_size: String(limit),
			fields: SEARCH_FIELDS,
		});
		return body.results;
	}

	/** Fetches the text of the given documents. Documents that no longer exist are left out. */
	async fetchContents(ids: readonly number[]): Promise<Map<number, string>> {
		const documents = await this.listByIds<{ id: number; content?: string }>(
			ids,
			'id,content',
		);
		return new Map(documents.map((document) => [document.id, document.content ?? '']));
	}

	/** Returns which of the given document IDs exist on the server. */
	async existingIds(ids: readonly number[]): Promise<Set<number>> {
		const documents = await this.listByIds<{ id: number }>(ids, 'id');
		return new Set(documents.map((document) => document.id));
	}

	async fetchLookups(includeCustomFields: boolean): Promise<Lookups> {
		const unavailable = new Set<LookupKind>();
		const load = async <T>(kind: LookupKind, path: string): Promise<T[]> => {
			try {
				return (await this.listAll<T>(path, {})).items;
			} catch (error) {
				// A user may be allowed to see documents but not, for example, storage paths.
				if (error instanceof PaperlessError && error.kind === 'auth') {
					unavailable.add(kind);
					return [];
				}
				throw error;
			}
		};
		const names = (items: NamedItem[]): Map<number, string> =>
			new Map(items.map((item) => [item.id, item.name]));

		const [tags, correspondents, documentTypes, storagePaths, customFields] =
			await Promise.all([
				load<NamedItem>('tags', '/api/tags/'),
				load<NamedItem>('correspondents', '/api/correspondents/'),
				load<NamedItem>('documentTypes', '/api/document_types/'),
				load<NamedItem>('storagePaths', '/api/storage_paths/'),
				includeCustomFields
					? load<CustomFieldDefinition>('customFields', '/api/custom_fields/')
					: Promise.resolve([]),
			]);
		return {
			tags: names(tags),
			correspondents: names(correspondents),
			documentTypes: names(documentTypes),
			storagePaths: names(storagePaths),
			customFields: new Map(customFields.map((field) => [field.id, field])),
			unavailable,
		};
	}

	private async listByIds<T>(ids: readonly number[], fields: string): Promise<T[]> {
		const items: T[] = [];
		for (let start = 0; start < ids.length; start += PAGE_SIZE) {
			const chunk = ids.slice(start, start + PAGE_SIZE);
			const page = await this.listAll<T>('/api/documents/', {
				id__in: chunk.join(','),
				fields,
			});
			items.push(...page.items);
		}
		return items;
	}

	/**
	 * Fetches every page of a list endpoint. Pages are requested by number instead of
	 * following `next`, because `next` can point to an internal host behind a reverse proxy.
	 */
	private async listAll<T>(
		path: string,
		params: Record<string, string>,
	): Promise<{ items: T[]; count: number }> {
		const items: T[] = [];
		let count = 0;
		for (let page = 1; page <= MAX_PAGES; page++) {
			let body: Paginated<T>;
			try {
				({ body } = await this.get<Paginated<T>>(path, {
					...params,
					page: String(page),
					page_size: String(PAGE_SIZE),
				}));
			} catch (error) {
				// Paperless-ngx answers 404 for a page past the end, which happens when
				// documents are deleted while the list is fetched. The count shows the gap.
				if (page > 1 && error instanceof PaperlessError && error.kind === 'not-found') break;
				throw error;
			}
			if (page === 1) count = body.count;
			items.push(...body.results);
			if (body.next === null || body.results.length === 0) break;
		}
		return { items, count };
	}

	private async get<T>(
		path: string,
		params: Record<string, string>,
	): Promise<{ body: T; headers: Record<string, string> }> {
		const query = Object.entries(params)
			.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
			.join('&');
		const url = `${this.baseUrl}${path}${query === '' ? '' : `?${query}`}`;
		const accept =
			this.apiVersion === null
				? 'application/json'
				: `application/json; version=${this.apiVersion}`;

		let response: HttpResponse;
		try {
			response = await this.httpGet(url, {
				Authorization: `Token ${this.token}`,
				Accept: accept,
			});
		} catch (error) {
			const detail = error instanceof Error ? ` (${error.message})` : '';
			throw new PaperlessError(
				'network',
				`Could not reach Paperless-ngx at ${this.baseUrl}${detail}.`,
			);
		}

		if (response.status === 401 || response.status === 403) {
			throw new PaperlessError(
				'auth',
				`Paperless-ngx rejected the API token or the user lacks permission for ${path} (HTTP ${response.status}).`,
			);
		}
		if (response.status === 404) {
			throw new PaperlessError(
				'not-found',
				`${path} was not found on ${this.baseUrl}. Check the server address.`,
			);
		}
		if (response.status < 200 || response.status >= 300) {
			throw new PaperlessError(
				'http',
				`Paperless-ngx answered ${path} with HTTP ${response.status}.`,
			);
		}

		let body: unknown;
		try {
			body = JSON.parse(response.text);
		} catch {
			body = null;
		}
		if (!isPaginated(body)) {
			throw new PaperlessError(
				'invalid-response',
				`${this.baseUrl} did not answer like a Paperless-ngx server. Check the server address.`,
			);
		}
		return { body: body as T, headers: response.headers };
	}
}

function isPaginated(body: unknown): body is Paginated<unknown> {
	if (typeof body !== 'object' || body === null) return false;
	const candidate = body as Record<string, unknown>;
	return typeof candidate.count === 'number' && Array.isArray(candidate.results);
}
