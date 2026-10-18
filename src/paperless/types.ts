/** A document as returned by `GET /api/documents/`, limited to the fields this plugin reads. */
export interface PaperlessDocument {
	id: number;
	title: string;
	correspondent: number | null;
	document_type: number | null;
	storage_path: number | null;
	tags: number[];
	/** A date (`2024-01-15`) since API version 9, a datetime before that. */
	created: string | null;
	added: string | null;
	/** A datetime. */
	modified?: string | null;
	archive_serial_number: number | null;
	custom_fields?: PaperlessCustomFieldValue[];
	content?: string;
	/** Only requested if notes are synced. */
	notes?: PaperlessNote[];
}

/** A note written on a document in Paperless-ngx. */
export interface PaperlessNote {
	id: number;
	note: string;
	created: string | null;
	/** A user object on current servers, a user ID on older ones. */
	user?: number | { id: number; username?: string } | null;
}

/** A document found by the full text search, limited to the fields the search shows. */
export interface SearchHit {
	id: number;
	title: string;
	created: string | null;
	correspondent: number | null;
	tags: number[];
}

export interface PaperlessCustomFieldValue {
	field: number;
	value: unknown;
}

export interface NamedItem {
	id: number;
	name: string;
}

export interface CustomFieldDefinition extends NamedItem {
	data_type: string;
	extra_data?: { select_options?: unknown[] | null } | null;
}

export interface Paginated<T> {
	count: number;
	next: string | null;
	results: T[];
}

export type LookupKind =
	| 'tags'
	| 'correspondents'
	| 'documentTypes'
	| 'storagePaths'
	| 'customFields';

/** Names of the objects that documents only reference by ID. */
export interface Lookups {
	tags: Map<number, string>;
	correspondents: Map<number, string>;
	documentTypes: Map<number, string>;
	storagePaths: Map<number, string>;
	customFields: Map<number, CustomFieldDefinition>;
	/** Lists the API user is not allowed to read. Their maps are empty. */
	unavailable: Set<LookupKind>;
}

export interface ServerInfo {
	/** Highest API version the server supports, if it reported one. */
	apiVersion: number | null;
	/** Paperless-ngx version, if the server reported one. */
	serverVersion: string | null;
	documentCount: number;
}

export interface DocumentListing {
	documents: PaperlessDocument[];
	/** False if the server reported more documents than could be fetched. */
	complete: boolean;
}
