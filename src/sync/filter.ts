import type { Lookups } from '../paperless/types';

/** Splits a comma separated list of tag names. A leading `#` is ignored. */
export function parseTagList(value: string): string[] {
	return value
		.split(',')
		.map((name) => name.trim().replace(/^#/, '').trim().toLowerCase())
		.filter((name) => name !== '');
}

/** The IDs of the tags with one of the given names, matched without regard to case. */
export function tagIdsByName(names: readonly string[], tags: Map<number, string>): Set<number> {
	const wanted = new Set(names);
	const ids = new Set<number>();
	for (const [id, name] of tags) {
		if (wanted.has(name.trim().toLowerCase())) ids.add(id);
	}
	return ids;
}

export interface TagFilterOptions {
	/** Comma separated tag names. If set, only documents with one of these tags are synced. */
	includeTags: string;
	/** Comma separated tag names. Documents with one of these tags are never synced. */
	excludeTags: string;
}

/**
 * Returns whether a document with the given tags is synced. Throws if a filter is set but
 * the API user may not read tags, because then it is unknown which documents it allows.
 */
export function buildTagFilter(
	options: TagFilterOptions,
	lookups: Lookups,
): (tags: readonly number[] | undefined) => boolean {
	const include = parseTagList(options.includeTags);
	const exclude = parseTagList(options.excludeTags);
	if (include.length === 0 && exclude.length === 0) return () => true;
	if (lookups.unavailable.has('tags')) {
		throw new Error(
			'The API user may not read tags, so the tag filters cannot be applied. Nothing was synced.',
		);
	}
	const included = tagIdsByName(include, lookups.tags);
	const excluded = tagIdsByName(exclude, lookups.tags);
	return (tags) => {
		const ids = tags ?? [];
		if (ids.some((id) => excluded.has(id))) return false;
		return include.length === 0 || ids.some((id) => included.has(id));
	};
}
