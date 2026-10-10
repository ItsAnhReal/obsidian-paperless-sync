import { describe, expect, it } from 'vitest';
import {
	applyProperties,
	buildProperties,
	customFieldKeys,
	propertiesDiffer,
	readDocumentId,
	toWikilink,
} from '../src/sync/properties';
import type { CustomFieldDefinition } from '../src/paperless/types';
import { makeDocument, makeLookups, SERVER } from './helpers';

const OPTIONS = { linkBaseUrl: SERVER, linkMetadata: false };

const lookups = makeLookups({
	tags: new Map([
		[1, 'Steuer'],
		[2, 'Auto'],
	]),
	correspondents: new Map([[5, 'Finanzamt']]),
	documentTypes: new Map([[3, 'Bescheid']]),
	storagePaths: new Map([[4, 'Archiv']]),
});

describe('buildProperties', () => {
	it('maps a full document in a fixed key order', () => {
		const properties = buildProperties(
			makeDocument({
				id: 42,
				title: 'Steuerbescheid 2023',
				correspondent: 5,
				document_type: 3,
				storage_path: 4,
				tags: [1, 2],
				created: '2024-03-01',
				added: '2024-03-05T08:00:00+01:00',
				archive_serial_number: 17,
			}),
			lookups,
			OPTIONS,
		);
		expect(properties).toEqual({
			paperless_id: 42,
			paperless_title: 'Steuerbescheid 2023',
			paperless_url: 'https://paperless.test/documents/42/details',
			paperless_correspondent: 'Finanzamt',
			paperless_document_type: 'Bescheid',
			paperless_tags: ['Auto', 'Steuer'],
			paperless_created: '2024-03-01',
			paperless_added: '2024-03-05',
			paperless_asn: 17,
			paperless_storage_path: 'Archiv',
		});
		expect(Object.keys(properties).slice(0, 3)).toEqual([
			'paperless_id',
			'paperless_title',
			'paperless_url',
		]);
	});

	it('omits empty values and unknown references', () => {
		const properties = buildProperties(
			makeDocument({ id: 1, correspondent: 99, tags: [99], created: null, added: null }),
			lookups,
			OPTIONS,
		);
		expect(properties).toEqual({
			paperless_id: 1,
			paperless_title: 'Document 1',
			paperless_url: 'https://paperless.test/documents/1/details',
		});
	});

	it('reads the date from a datetime of older API versions', () => {
		const properties = buildProperties(
			makeDocument({ id: 1, created: '2023-12-31T00:00:00+01:00' }),
			lookups,
			OPTIONS,
		);
		expect(properties.paperless_created).toBe('2023-12-31');
	});

	it('writes correspondent and document type as links when enabled', () => {
		const properties = buildProperties(
			makeDocument({ id: 1, correspondent: 5, document_type: 3, tags: [1] }),
			lookups,
			{ ...OPTIONS, linkMetadata: true },
		);
		expect(properties.paperless_correspondent).toBe('[[Finanzamt]]');
		expect(properties.paperless_document_type).toBe('[[Bescheid]]');
		expect(properties.paperless_tags).toEqual(['Steuer']);
	});

	it('maps custom fields by type', () => {
		const definitions: CustomFieldDefinition[] = [
			{ id: 1, name: 'Betrag', data_type: 'monetary' },
			{ id: 2, name: 'Fällig am', data_type: 'date' },
			{ id: 3, name: 'Bezahlt', data_type: 'boolean' },
			{ id: 4, name: 'Seiten', data_type: 'integer' },
			{
				id: 5,
				name: 'Status',
				data_type: 'select',
				extra_data: { select_options: [{ id: 'abc', label: 'Offen' }, { id: 'def', label: 'Erledigt' }] },
			},
			{ id: 6, name: 'Priorität', data_type: 'select', extra_data: { select_options: ['Hoch', 'Niedrig'] } },
			{ id: 7, name: 'Siehe auch', data_type: 'documentlink' },
			{ id: 8, name: 'Notiz', data_type: 'string' },
		];
		const properties = buildProperties(
			makeDocument({
				id: 1,
				custom_fields: [
					{ field: 1, value: 'EUR123.45' },
					{ field: 2, value: '2024-04-30' },
					{ field: 3, value: false },
					{ field: 4, value: 3 },
					{ field: 5, value: 'def' },
					{ field: 6, value: 1 },
					{ field: 7, value: [12, 13] },
					{ field: 8, value: '' },
					{ field: 99, value: 'unknown field' },
				],
			}),
			makeLookups({ customFields: new Map(definitions.map((d) => [d.id, d])) }),
			OPTIONS,
		);
		expect(properties).toMatchObject({
			paperless_field_betrag: 'EUR123.45',
			paperless_field_fallig_am: '2024-04-30',
			paperless_field_bezahlt: false,
			paperless_field_seiten: 3,
			paperless_field_status: 'Erledigt',
			paperless_field_prioritat: 'Niedrig',
			paperless_field_siehe_auch: [12, 13],
		});
		expect(properties).not.toHaveProperty('paperless_field_notiz');
		const fieldKeys = Object.keys(properties).filter((key) => key.startsWith('paperless_field_'));
		expect(fieldKeys).toEqual([...fieldKeys].sort());
	});
});

describe('customFieldKeys', () => {
	it('keeps keys unique and stable when names collide or are empty', () => {
		const keys = customFieldKeys(
			new Map<number, CustomFieldDefinition>([
				[3, { id: 3, name: 'Due date', data_type: 'date' }],
				[1, { id: 1, name: 'due-date', data_type: 'date' }],
				[2, { id: 2, name: '!!!', data_type: 'string' }],
				[4, { id: 4, name: 'Straße', data_type: 'string' }],
			]),
		);
		expect(Object.fromEntries(keys)).toEqual({
			1: 'paperless_field_due_date',
			2: 'paperless_field_2',
			3: 'paperless_field_due_date_3',
			4: 'paperless_field_strasse',
		});
	});
});

describe('propertiesDiffer', () => {
	const desired = buildProperties(
		makeDocument({ id: 42, title: '2024', tags: [1, 2], archive_serial_number: 17 }),
		lookups,
		OPTIONS,
	);

	it('is false for identical values and ignores properties of the user', () => {
		expect(propertiesDiffer({ ...desired, status: 'done', tags: ['inbox'] }, desired)).toBe(false);
	});

	it('tolerates scalar types changed by the YAML layer', () => {
		expect(
			propertiesDiffer({ ...desired, paperless_id: '42', paperless_title: 2024, paperless_asn: '17' }, desired),
		).toBe(false);
	});

	it('detects changed, missing and stale managed properties', () => {
		expect(propertiesDiffer({ ...desired, paperless_title: 'Old' }, desired)).toBe(true);
		expect(propertiesDiffer({ ...desired, paperless_tags: ['Auto'] }, desired)).toBe(true);
		expect(propertiesDiffer({ ...desired, paperless_tags: 'Auto' }, desired)).toBe(true);
		expect(propertiesDiffer({ ...desired, paperless_created: null }, desired)).toBe(true);
		expect(propertiesDiffer({ ...desired, paperless_missing: true }, desired)).toBe(true);
		expect(propertiesDiffer({ ...desired, paperless_field_old: 'x' }, desired)).toBe(true);
	});
});

describe('applyProperties', () => {
	it('updates managed properties and keeps everything else', () => {
		const target: Record<string, unknown> = {
			status: 'done',
			paperless_id: 42,
			paperless_title: 'Old',
			paperless_correspondent: 'Gone',
			paperless_missing: true,
			paperless_field_old: 'x',
		};
		applyProperties(target, { paperless_id: 42, paperless_title: 'New' });
		expect(target).toEqual({ status: 'done', paperless_id: 42, paperless_title: 'New' });
		expect(Object.keys(target)[0]).toBe('status');
	});
});

describe('readDocumentId', () => {
	it('accepts numbers and numeric strings only', () => {
		expect(readDocumentId({ paperless_id: 42 })).toBe(42);
		expect(readDocumentId({ paperless_id: ' 42 ' })).toBe(42);
		expect(readDocumentId({ paperless_id: 'abc' })).toBeNull();
		expect(readDocumentId({ paperless_id: 0 })).toBeNull();
		expect(readDocumentId({ paperless_id: 1.5 })).toBeNull();
		expect(readDocumentId({})).toBeNull();
		expect(readDocumentId(null)).toBeNull();
	});
});

describe('toWikilink', () => {
	it('removes characters that would break the link', () => {
		expect(toWikilink('A|B [C] #1')).toBe('[[A B C 1]]');
		expect(toWikilink('###')).toBe('###');
	});
});
