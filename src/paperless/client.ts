import type {
	CustomFieldDefinition,
	DocumentListing,
	Lookups,
	NamedItem,
	Paginated,
	PaperlessDocument,
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
	'archive_serial_number',
];

export interface DocumentListOptions {
	includeCustomFields: boolean;
	includeContent: boolean;
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
		const fields = [...DOCUMENT_FIELDS];
		if (options.includeCustomFields) fields.push('custom_fields');
		if (options.includeContent) fields.push('content');
		const { items, count } = await this.listAll<PaperlessDocument>(
			'/api/documents/',
			{ ordering: 'id', fields: fields.join(',') },
		);
		const byId = new Map<number, PaperlessDocument>();
		for (const document of items) byId.set(document.id, document);
		const documents = [...byId.values()].sort((a, b) => a.id - b.id);
		return { documents, complete: documents.length >= count };
	}

	async fetchLookups(includeCustomFields: boolean): Promise<Lookups> {
		const names = async (path: string): Promise<Map<number, string>> => {
			const { items } = await this.listAll<NamedItem>(path, {});
			return new Map(items.map((item) => [item.id, item.name]));
		};
		const customFields = new Map<number, CustomFieldDefinition>();
		if (includeCustomFields) {
			const { items } = await this.listAll<CustomFieldDefinition>(
				'/api/custom_fields/',
				{},
			);
			for (const field of items) customFields.set(field.id, field);
		}
		return {
			tags: await names('/api/tags/'),
			correspondents: await names('/api/correspondents/'),
			documentTypes: await names('/api/document_types/'),
			storagePaths: await names('/api/storage_paths/'),
			customFields,
		};
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
			const { body } = await this.get<Paginated<T>>(path, {
				...params,
				page: String(page),
				page_size: String(PAGE_SIZE),
			});
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
