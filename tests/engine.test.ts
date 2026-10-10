import { describe, expect, it } from 'vitest';
import { PaperlessClient } from '../src/paperless/client';
import { runSync, type SyncOptions, type SyncResult } from '../src/sync/engine';
import {
	createFakeServer,
	DEFAULT_OPTIONS,
	FakeVault,
	makeDocument,
	SERVER,
	TOKEN,
	type FakeServer,
} from './helpers';

function setup(): { server: FakeServer; vault: FakeVault; sync: (options?: Partial<SyncOptions>) => Promise<SyncResult> } {
	const server = createFakeServer({
		documents: [
			makeDocument({ id: 1, title: 'Mietvertrag', correspondent: 5, tags: [1] }),
			makeDocument({ id: 2, title: 'Stromrechnung', created: '2024-02-01' }),
		],
		tags: [{ id: 1, name: 'Wohnung' }],
		correspondents: [{ id: 5, name: 'Hausverwaltung' }],
	});
	const vault = new FakeVault();
	const sync = (options: Partial<SyncOptions> = {}) =>
		runSync(new PaperlessClient(SERVER, TOKEN, server.httpGet), vault, { ...DEFAULT_OPTIONS, ...options });
	return { server, vault, sync };
}

describe('runSync', () => {
	it('creates one note per document', async () => {
		const { vault, sync } = setup();
		const result = await sync();

		expect(result).toMatchObject({ documents: 2, created: 2, updated: 0, unchanged: 0, missing: 0, complete: true });
		expect(result.failures).toEqual([]);
		expect([...vault.notes.keys()]).toEqual([
			'Paperless/2024-01-15 Mietvertrag.md',
			'Paperless/2024-02-01 Stromrechnung.md',
		]);
		const note = vault.get('Paperless/2024-01-15 Mietvertrag.md');
		expect(note.properties).toEqual({
			paperless_id: 1,
			paperless_title: 'Mietvertrag',
			paperless_url: 'https://paperless.test/documents/1/details',
			paperless_correspondent: 'Hausverwaltung',
			paperless_tags: ['Wohnung'],
			paperless_created: '2024-01-15',
			paperless_added: '2024-01-16',
		});
		expect(note.body).toBe('[Open in Paperless](https://paperless.test/documents/1/details)\n');
	});

	it('writes nothing when nothing changed', async () => {
		const { vault, sync } = setup();
		await sync();
		const writes = vault.writes;
		const result = await sync();

		expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 2, missing: 0 });
		expect(vault.writes).toBe(writes);
	});

	it('updates properties but keeps path, body and properties of the user', async () => {
		const { server, vault, sync } = setup();
		await sync();
		const path = 'Paperless/2024-01-15 Mietvertrag.md';
		const note = vault.get(path);
		note.body = 'My own notes.\n';
		note.properties.status = 'reviewed';

		server.state.documents[0] = makeDocument({ id: 1, title: 'Mietvertrag Hauptstraße', tags: [1] });
		server.state.tags[0] = { id: 1, name: 'Wohnen' };
		const result = await sync();

		expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
		expect(vault.get(path).body).toBe('My own notes.\n');
		expect(vault.get(path).properties).toMatchObject({
			status: 'reviewed',
			paperless_title: 'Mietvertrag Hauptstraße',
			paperless_tags: ['Wohnen'],
		});
		expect(vault.get(path).properties).not.toHaveProperty('paperless_correspondent');
	});

	it('finds notes by ID after they were moved or renamed', async () => {
		const { server, vault, sync } = setup();
		await sync();
		vault.move('Paperless/2024-01-15 Mietvertrag.md', 'Wohnung/Vertrag.md');
		server.state.documents[0] = makeDocument({ id: 1, title: 'Neuer Titel' });
		const result = await sync();

		expect(result).toMatchObject({ created: 0, updated: 1 });
		expect(vault.notes.size).toBe(2);
		expect(vault.get('Wohnung/Vertrag.md').properties.paperless_title).toBe('Neuer Titel');
	});

	it('flags notes of removed documents once and clears the flag when they return', async () => {
		const { server, vault, sync } = setup();
		await sync();
		const removed = server.state.documents.shift();
		const path = 'Paperless/2024-01-15 Mietvertrag.md';

		expect(await sync()).toMatchObject({ documents: 1, missing: 1, updated: 0 });
		expect(vault.get(path).properties.paperless_missing).toBe(true);
		expect(vault.notes.size).toBe(2);

		const writes = vault.writes;
		expect(await sync()).toMatchObject({ missing: 0 });
		expect(vault.writes).toBe(writes);

		if (removed !== undefined) server.state.documents.push(removed);
		expect(await sync()).toMatchObject({ updated: 1, missing: 0 });
		expect(vault.get(path).properties).not.toHaveProperty('paperless_missing');
	});

	it('does not flag anything when the document list is incomplete', async () => {
		const { server, vault, sync } = setup();
		await sync();
		server.state.documents.shift();
		server.state.reportedDocumentCount = 2;
		const result = await sync();

		expect(result).toMatchObject({ complete: false, missing: 0 });
		expect(vault.get('Paperless/2024-01-15 Mietvertrag.md').properties).not.toHaveProperty('paperless_missing');
	});

	it('appends the document ID when the file name is taken', async () => {
		const { server, vault, sync } = setup();
		server.state.documents.push(makeDocument({ id: 3, title: 'Mietvertrag' }));
		vault.notes.set('Paperless/2024-02-01 Stromrechnung.md', { properties: {}, body: 'Unrelated note.\n' });
		const result = await sync();

		expect(result.created).toBe(3);
		expect([...vault.notes.keys()].sort()).toEqual([
			'Paperless/2024-01-15 Mietvertrag (3).md',
			'Paperless/2024-01-15 Mietvertrag.md',
			'Paperless/2024-02-01 Stromrechnung (2).md',
			'Paperless/2024-02-01 Stromrechnung.md',
		]);
		expect(vault.get('Paperless/2024-02-01 Stromrechnung.md').body).toBe('Unrelated note.\n');
	});

	it('reports duplicate notes and keeps all of them up to date', async () => {
		const { server, vault, sync } = setup();
		await sync();
		vault.notes.set('Copy.md', { properties: { paperless_id: 1, paperless_title: 'stale' }, body: '' });
		server.state.documents[0] = makeDocument({ id: 1, title: 'Changed' });
		const result = await sync();

		expect(result.duplicateIds).toEqual([1]);
		expect(result.updated).toBe(1);
		expect(vault.get('Copy.md').properties.paperless_title).toBe('Changed');
		expect(vault.get('Paperless/2024-01-15 Mietvertrag.md').properties.paperless_title).toBe('Changed');
	});

	it('records a failed document and continues with the rest', async () => {
		const { vault, sync } = setup();
		vault.failCreateFor = (path) => path.includes('Mietvertrag');
		const result = await sync();

		expect(result.created).toBe(1);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]?.documentId).toBe(1);
		expect(vault.notes.size).toBe(1);
	});

	it('requests document text only when the note template uses it', async () => {
		const { server, vault, sync } = setup();
		server.state.documents = [makeDocument({ id: 1, title: 'Brief', content: 'Sehr geehrte Damen und Herren' })];
		await sync();
		expect(server.requests.some((request) => request.url.searchParams.get('fields')?.includes('content'))).toBe(false);

		vault.notes.clear();
		await sync({ noteTemplate: '{{content}}' });
		expect(vault.get('Paperless/2024-01-15 Brief.md').body).toBe('Sehr geehrte Damen und Herren\n');
	});

	it('uses the configured folder, file name template and link options', async () => {
		const { vault, sync } = setup();
		await sync({
			folder: 'Archive/Docs',
			fileNameTemplate: '{{created_year}}/{{title}} ({{id}})',
			linkBaseUrl: 'https://docs.example.com',
			linkMetadata: true,
		});
		const note = vault.get('Archive/Docs/2024/Mietvertrag (1).md');
		expect(note.properties.paperless_url).toBe('https://docs.example.com/documents/1/details');
		expect(note.properties.paperless_correspondent).toBe('[[Hausverwaltung]]');
	});
});
