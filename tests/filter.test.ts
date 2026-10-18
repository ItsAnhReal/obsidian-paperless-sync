import { describe, expect, it } from 'vitest';
import { buildTagFilter, parseTagList, unknownFilterTags } from '../src/sync/filter';
import { makeLookups } from './helpers';

const lookups = makeLookups({
	tags: new Map([
		[1, 'Privat'],
		[2, 'Steuer'],
		[3, 'Inbox'],
	]),
});

describe('parseTagList', () => {
	it('splits, trims and lower-cases tag names', () => {
		expect(parseTagList(' Privat, #Steuer ,,')).toEqual(['privat', 'steuer']);
		expect(parseTagList('')).toEqual([]);
	});
});

describe('unknownFilterTags', () => {
	it('names filter tags that do not exist', () => {
		expect(unknownFilterTags({ includeTags: 'Steuer, Stuer', excludeTags: 'privat, geheim' }, lookups)).toEqual([
			'stuer',
			'geheim',
		]);
		expect(unknownFilterTags({ includeTags: 'x', excludeTags: '' }, makeLookups({ unavailable: new Set(['tags']) }))).toEqual([]);
	});
});

describe('buildTagFilter', () => {
	it('syncs everything without filters', () => {
		const isSynced = buildTagFilter({ includeTags: '', excludeTags: '' }, lookups);
		expect(isSynced([])).toBe(true);
		expect(isSynced(undefined)).toBe(true);
	});

	it('skips documents with an excluded tag', () => {
		const isSynced = buildTagFilter({ includeTags: '', excludeTags: 'privat' }, lookups);
		expect(isSynced([1, 2])).toBe(false);
		expect(isSynced([2])).toBe(true);
	});

	it('only syncs documents with an included tag, and exclusion wins', () => {
		const isSynced = buildTagFilter({ includeTags: 'Steuer, Inbox', excludeTags: 'Privat' }, lookups);
		expect(isSynced([2])).toBe(true);
		expect(isSynced([3])).toBe(true);
		expect(isSynced([])).toBe(false);
		expect(isSynced([2, 1])).toBe(false);
	});

	it('syncs nothing if no included tag exists', () => {
		const isSynced = buildTagFilter({ includeTags: 'unknown', excludeTags: '' }, lookups);
		expect(isSynced([1, 2, 3])).toBe(false);
	});

	it('refuses to guess when the tags cannot be read', () => {
		const unreadable = makeLookups({ unavailable: new Set(['tags']) });
		expect(() => buildTagFilter({ includeTags: '', excludeTags: 'privat' }, unreadable)).toThrow(/tags/);
		expect(buildTagFilter({ includeTags: '', excludeTags: '' }, unreadable)([1])).toBe(true);
	});
});
