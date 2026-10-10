import type {
	CustomFieldDefinition,
	Lookups,
	PaperlessDocument,
} from '../paperless/types';

export type PropertyValue = string | number | boolean | string[] | number[];
export type Properties = Record<string, PropertyValue>;

/** The properties this plugin owns. Everything else in a note belongs to the user. */
export const PROPERTY = {
	id: 'paperless_id',
	title: 'paperless_title',
	url: 'paperless_url',
	correspondent: 'paperless_correspondent',
	documentType: 'paperless_document_type',
	tags: 'paperless_tags',
	created: 'paperless_created',
	added: 'paperless_added',
	asn: 'paperless_asn',
	storagePath: 'paperless_storage_path',
	missing: 'paperless_missing',
} as const;

export const CUSTOM_FIELD_PREFIX = 'paperless_field_';

const FIXED_KEYS = new Set<string>(Object.values(PROPERTY));

export interface PropertyOptions {
	/** Base URL used for links to documents, without a trailing slash. */
	linkBaseUrl: string;
	/** Write correspondent and document type as `[[wikilinks]]`. */
	linkMetadata: boolean;
}

export function isManagedKey(key: string): boolean {
	return FIXED_KEYS.has(key) || key.startsWith(CUSTOM_FIELD_PREFIX);
}

export function documentUrl(linkBaseUrl: string, id: number): string {
	return `${linkBaseUrl}/documents/${id}/details`;
}

/** Returns the `YYYY-MM-DD` part of a date or datetime string. */
export function toDate(value: string | null | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
}

export function toWikilink(name: string): string {
	const target = name
		.replace(/[[\]|#^\\/:]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return target === '' ? name : `[[${target}]]`;
}

/** Reads the document ID from a note's properties, or `null` if there is none. */
export function readDocumentId(
	properties: Record<string, unknown> | null | undefined,
): number | null {
	const value = properties?.[PROPERTY.id];
	const id =
		typeof value === 'number'
			? value
			: typeof value === 'string' && /^\d+$/.test(value.trim())
				? Number(value.trim())
				: Number.NaN;
	return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Builds the managed properties for a document. The result depends only on the
 * server data, so every device that syncs the same vault writes identical values.
 */
export function buildProperties(
	document: PaperlessDocument,
	lookups: Lookups,
	options: PropertyOptions,
): Properties {
	const properties: Properties = {
		[PROPERTY.id]: document.id,
		[PROPERTY.title]: document.title,
		[PROPERTY.url]: documentUrl(options.linkBaseUrl, document.id),
	};
	const named = (name: string | undefined): string | undefined =>
		name !== undefined && options.linkMetadata ? toWikilink(name) : name;
	const set = (key: string, value: PropertyValue | undefined): void => {
		if (value !== undefined) properties[key] = value;
	};

	set(
		PROPERTY.correspondent,
		named(lookupName(lookups.correspondents, document.correspondent)),
	);
	set(
		PROPERTY.documentType,
		named(lookupName(lookups.documentTypes, document.document_type)),
	);
	const tags = (document.tags ?? [])
		.map((id) => lookups.tags.get(id))
		.filter((name): name is string => name !== undefined)
		.sort();
	set(PROPERTY.tags, tags.length > 0 ? tags : undefined);
	set(PROPERTY.created, toDate(document.created));
	set(PROPERTY.added, toDate(document.added));
	set(PROPERTY.asn, document.archive_serial_number ?? undefined);
	set(
		PROPERTY.storagePath,
		lookupName(lookups.storagePaths, document.storage_path),
	);

	const keys = customFieldKeys(lookups.customFields);
	const fields: [string, PropertyValue][] = [];
	for (const entry of document.custom_fields ?? []) {
		const definition = lookups.customFields.get(entry.field);
		const key = keys.get(entry.field);
		if (definition === undefined || key === undefined) continue;
		const value = customFieldValue(definition, entry.value);
		if (value !== undefined) fields.push([key, value]);
	}
	fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	for (const [key, value] of fields) properties[key] = value;

	return properties;
}

/** True if a note's managed properties are not exactly the desired ones. */
export function propertiesDiffer(
	current: Record<string, unknown>,
	desired: Properties,
): boolean {
	for (const [key, value] of Object.entries(desired)) {
		if (!sameValue(current[key], value)) return true;
	}
	for (const key of Object.keys(current)) {
		if (isManagedKey(key) && !(key in desired)) return true;
	}
	return false;
}

/** Sets the desired properties and removes managed ones that no longer apply. */
export function applyProperties(
	target: Record<string, unknown>,
	desired: Properties,
): void {
	for (const key of Object.keys(target)) {
		if (isManagedKey(key) && !(key in desired)) delete target[key];
	}
	for (const [key, value] of Object.entries(desired)) target[key] = value;
}

/** Property key per custom field ID. Fields are processed by ID so the result is stable. */
export function customFieldKeys(
	definitions: Map<number, CustomFieldDefinition>,
): Map<number, string> {
	const keys = new Map<number, string>();
	const used = new Set<string>();
	const sorted = [...definitions.values()].sort((a, b) => a.id - b.id);
	for (const definition of sorted) {
		const slug = slugify(definition.name);
		let key = `${CUSTOM_FIELD_PREFIX}${slug === '' ? definition.id : slug}`;
		if (used.has(key)) key = `${key}_${definition.id}`;
		used.add(key);
		keys.set(definition.id, key);
	}
	return keys;
}

function slugify(name: string): string {
	return name
		.replace(/ß/g, 'ss')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function lookupName(
	names: Map<number, string>,
	id: number | null | undefined,
): string | undefined {
	return typeof id === 'number' ? names.get(id) : undefined;
}

function customFieldValue(
	definition: CustomFieldDefinition,
	value: unknown,
): PropertyValue | undefined {
	if (value === null || value === undefined || value === '') return undefined;
	switch (definition.data_type) {
		case 'select':
			return selectLabel(definition, value);
		case 'documentlink': {
			if (!Array.isArray(value)) return undefined;
			const ids = value.filter(
				(id): id is number => typeof id === 'number',
			);
			return ids.length > 0 ? ids : undefined;
		}
		case 'integer':
		case 'float': {
			const number = typeof value === 'number' ? value : Number(value);
			return Number.isFinite(number) ? number : undefined;
		}
		case 'date':
			return typeof value === 'string' ? (toDate(value) ?? value) : undefined;
		default:
			return isScalar(value) ? value : undefined;
	}
}

/**
 * Select options are a list of `{ id, label }` objects on current servers (the value is
 * the option ID) and a list of plain strings on older ones (the value is the index).
 */
function selectLabel(
	definition: CustomFieldDefinition,
	value: unknown,
): string | undefined {
	const options = definition.extra_data?.select_options ?? [];
	for (const option of options) {
		if (typeof option !== 'object' || option === null) continue;
		const candidate = option as { id?: unknown; label?: unknown };
		if (candidate.id === value && typeof candidate.label === 'string') {
			return candidate.label;
		}
	}
	if (typeof value === 'number' && typeof options[value] === 'string') {
		return options[value];
	}
	return isScalar(value) ? String(value) : undefined;
}

function isScalar(value: unknown): value is string | number | boolean {
	return (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	);
}

/**
 * Compares by string form, so a value that the YAML layer reads back with a different
 * type (for example the title `2024` as a number) is not rewritten on every sync.
 */
function sameValue(current: unknown, desired: PropertyValue): boolean {
	if (current === null || current === undefined) return false;
	if (Array.isArray(desired)) {
		const items: readonly unknown[] = desired;
		return (
			Array.isArray(current) &&
			current.length === items.length &&
			current.every((item, index) => String(item) === String(items[index]))
		);
	}
	return !Array.isArray(current) && isScalar(current) && String(current) === String(desired);
}
