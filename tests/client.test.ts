import { describe, expect, it } from 'vitest';
import {
	normalizeServerUrl,
	PaperlessClient,
	PaperlessError,
	type HttpGet,
} from '../src/paperless/client';
import { createFakeServer, makeDocument, SERVER, TOKEN } from './helpers';

const LIST_OPTIONS = { includeCustomFields: false, includeContent: false };

async function kindOf(action: Promise<unknown>): Promise<string> {
	try {
		await action;
	} catch (error) {
		if (error instanceof PaperlessError) return error.kind;
		throw error;
	}
	return 'no error';
}

describe('normalizeServerUrl', () => {
	it('trims and removes trailing slashes', () => {
		expect(normalizeServerUrl(' https://paperless.test/ ')).toBe('https://paperless.test');
		expect(normalizeServerUrl('http://host:8000/paperless//')).toBe('http://host:8000/paperless');
	});

	it('rejects values that are not http(s) URLs', () => {
		expect(normalizeServerUrl('paperless.test')).toBeNull();
		expect(normalizeServerUrl('ftp://paperless.test')).toBeNull();
		expect(normalizeServerUrl('')).toBeNull();
	});
});

describe('PaperlessClient', () => {
	it('rejects an invalid configuration before any request', () => {
		const server = createFakeServer();
		expect(() => new PaperlessClient('paperless.test', TOKEN, server.httpGet)).toThrow(PaperlessError);
		expect(() => new PaperlessClient(SERVER, '  ', server.httpGet)).toThrow(PaperlessError);
		expect(server.requests).toHaveLength(0);
	});

	it('reports server information on connect', async () => {
		const server = createFakeServer({ documents: [makeDocument({ id: 1 }), makeDocument({ id: 2 })] });
		const client = new PaperlessClient(`${SERVER}/`, TOKEN, server.httpGet);
		expect(await client.connect()).toEqual({ apiVersion: 10, serverVersion: '2.20.0', documentCount: 2 });
		expect(server.requests[0]?.headers.Accept).toBe('application/json');
	});

	it.each([
		{ supported: 9, expected: 'application/json; version=9' },
		{ supported: 12, expected: 'application/json; version=10' },
		{ supported: null, expected: 'application/json' },
	])('uses API version header "$expected" when the server supports $supported', async ({ supported, expected }) => {
		const server = createFakeServer({ apiVersion: supported });
		const client = new PaperlessClient(SERVER, TOKEN, server.httpGet);
		await client.connect();
		await client.listDocuments(LIST_OPTIONS);
		expect(server.requests.at(-1)?.headers.Accept).toBe(expected);
	});

	it('fetches all pages in ID order and only the fields it needs', async () => {
		const documents = Array.from({ length: 250 }, (_, index) =>
			makeDocument({ id: 250 - index, content: 'secret text' }),
		);
		const server = createFakeServer({ documents });
		const client = new PaperlessClient(SERVER, TOKEN, server.httpGet);
		const listing = await client.listDocuments(LIST_OPTIONS);

		expect(listing.complete).toBe(true);
		expect(listing.documents.map((document) => document.id)).toEqual(
			Array.from({ length: 250 }, (_, index) => index + 1),
		);
		expect(listing.documents[0]).not.toHaveProperty('content');
		expect(server.requests).toHaveLength(3);
		const params = server.requests[0]?.url.searchParams;
		expect(params?.get('ordering')).toBe('id');
		expect(params?.get('page_size')).toBe('100');
		expect(params?.get('fields')).toBe(
			'id,title,correspondent,document_type,storage_path,tags,created,added,archive_serial_number',
		);
	});

	it('requests content and custom fields only when asked', async () => {
		const server = createFakeServer({ documents: [makeDocument({ id: 1, content: 'text' })] });
		const client = new PaperlessClient(SERVER, TOKEN, server.httpGet);
		const listing = await client.listDocuments({ includeCustomFields: true, includeContent: true });
		expect(server.requests[0]?.url.searchParams.get('fields')).toMatch(/,custom_fields,content$/);
		expect(listing.documents[0]?.content).toBe('text');
	});

	it('marks the listing incomplete when the server reports more documents than it returned', async () => {
		const server = createFakeServer({
			documents: [makeDocument({ id: 1 }), makeDocument({ id: 2 })],
			reportedDocumentCount: 5,
		});
		const client = new PaperlessClient(SERVER, TOKEN, server.httpGet);
		expect((await client.listDocuments(LIST_OPTIONS)).complete).toBe(false);
	});

	it('resolves names and skips custom fields unless requested', async () => {
		const server = createFakeServer({
			tags: [{ id: 1, name: 'Steuer' }],
			correspondents: [{ id: 5, name: 'Finanzamt' }],
			documentTypes: [{ id: 3, name: 'Bescheid' }],
			storagePaths: [{ id: 4, name: 'Archiv' }],
			customFields: [{ id: 1, name: 'Betrag', data_type: 'monetary' }],
		});
		const client = new PaperlessClient(SERVER, TOKEN, server.httpGet);

		const without = await client.fetchLookups(false);
		expect(without.tags.get(1)).toBe('Steuer');
		expect(without.correspondents.get(5)).toBe('Finanzamt');
		expect(without.documentTypes.get(3)).toBe('Bescheid');
		expect(without.storagePaths.get(4)).toBe('Archiv');
		expect(without.customFields.size).toBe(0);
		expect(server.requests.some((request) => request.url.pathname === '/api/custom_fields/')).toBe(false);

		const withFields = await client.fetchLookups(true);
		expect(withFields.customFields.get(1)?.name).toBe('Betrag');
	});

	it('classifies failures', async () => {
		const server = createFakeServer();
		expect(await kindOf(new PaperlessClient(SERVER, 'wrong', server.httpGet).connect())).toBe('auth');

		const respond =
			(status: number, text: string): HttpGet =>
			() =>
				Promise.resolve({ status, headers: {}, text });
		expect(await kindOf(new PaperlessClient(SERVER, TOKEN, respond(404, 'Not found')).connect())).toBe('not-found');
		expect(await kindOf(new PaperlessClient(SERVER, TOKEN, respond(503, '{}')).connect())).toBe('http');
		expect(
			await kindOf(new PaperlessClient(SERVER, TOKEN, respond(200, '<html>Login</html>')).connect()),
		).toBe('invalid-response');
		expect(await kindOf(new PaperlessClient(SERVER, TOKEN, respond(200, '{"ok":false}')).connect())).toBe(
			'invalid-response',
		);

		const offline: HttpGet = () => Promise.reject(new Error('net::ERR_CONNECTION_REFUSED'));
		expect(await kindOf(new PaperlessClient(SERVER, TOKEN, offline).connect())).toBe('network');
	});

	it('never puts the token into an error message', async () => {
		const offline: HttpGet = () => Promise.reject(new Error('boom'));
		const error = await new PaperlessClient(SERVER, 'super-secret', offline).connect().catch((e: unknown) => e);
		expect(String(error)).not.toContain('super-secret');
	});
});
