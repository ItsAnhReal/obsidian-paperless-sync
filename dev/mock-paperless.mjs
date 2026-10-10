// Minimal stand-in for the Paperless-ngx REST API, for trying the plugin without a real server.
//
//   npm run mock            -> http://127.0.0.1:8765, API token "dev-token"
//
// The data file is read on every request, so you can edit it while the server runs.
// Environment: MOCK_PORT, MOCK_DATA (path to a JSON file shaped like dev/mock-data.json).

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.MOCK_PORT ?? 8765);
const DATA_FILE = process.env.MOCK_DATA ?? fileURLToPath(new URL('./mock-data.json', import.meta.url));
const TOKEN = 'dev-token';
const API_VERSION = 10;

const COLLECTIONS = {
	'/api/documents/': 'documents',
	'/api/tags/': 'tags',
	'/api/correspondents/': 'correspondents',
	'/api/document_types/': 'document_types',
	'/api/storage_paths/': 'storage_paths',
	'/api/custom_fields/': 'custom_fields',
};

const server = createServer((request, response) => {
	const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
	const send = (status, body) => {
		response.writeHead(status, {
			'Content-Type': 'application/json',
			'X-Api-Version': String(API_VERSION),
			'X-Version': '2.20.0-mock',
		});
		response.end(JSON.stringify(body));
	};
	console.log(`${request.method} ${url.pathname}${url.search}`);

	if (request.method !== 'GET') return send(405, { detail: 'This mock is read-only.' });
	if (request.headers.authorization !== `Token ${TOKEN}`) {
		return send(401, { detail: 'Invalid token.' });
	}
	const version = /version=(\d+)/.exec(request.headers.accept ?? '')?.[1];
	if (version !== undefined && Number(version) > API_VERSION) {
		return send(406, { detail: 'Could not satisfy the request Accept header.' });
	}

	const collection = COLLECTIONS[url.pathname];
	if (collection === undefined) return send(404, { detail: 'Not found.' });

	const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
	let items = data[collection] ?? [];
	if (url.searchParams.get('ordering') === 'id') {
		items = [...items].sort((a, b) => a.id - b.id);
	}
	const page = Number(url.searchParams.get('page') ?? '1');
	const pageSize = Number(url.searchParams.get('page_size') ?? '25');
	const start = (page - 1) * pageSize;
	const fields = url.searchParams.get('fields')?.split(',');
	const results = items
		.slice(start, start + pageSize)
		.map((item) =>
			fields === undefined
				? item
				: Object.fromEntries(Object.entries(item).filter(([key]) => fields.includes(key))),
		);
	// Like a real server behind a reverse proxy, `next` points to an internal host.
	const next =
		start + pageSize < items.length
			? `http://paperless-internal:8000${url.pathname}?page=${page + 1}`
			: null;
	return send(200, { count: items.length, next, previous: null, results });
});

server.listen(PORT, '127.0.0.1', () => {
	console.log(`Mock Paperless-ngx API on http://127.0.0.1:${PORT} (token: ${TOKEN})`);
	console.log(`Data: ${DATA_FILE}`);
});
