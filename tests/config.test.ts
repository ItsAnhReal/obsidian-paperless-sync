import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/config';

describe('normalizeSettings', () => {
	it('uses the defaults when nothing is stored', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings('broken')).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps stored values of the right type', () => {
		const settings = normalizeSettings({ serverUrl: 'https://p.test', linkMetadata: true, syncIntervalMinutes: 0 });
		expect(settings).toMatchObject({ serverUrl: 'https://p.test', linkMetadata: true, syncIntervalMinutes: 0 });
	});

	it('replaces values of the wrong type and drops unknown keys', () => {
		const settings = normalizeSettings({
			folder: null,
			syncIntervalMinutes: null,
			includeCustomFields: 'yes',
			toString: 'x',
			unknown: 1,
		});
		expect(settings).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps a valid document text mode and replaces an unknown one', () => {
		expect(normalizeSettings({ contentMode: 'all' }).contentMode).toBe('all');
		expect(normalizeSettings({ contentMode: 'some' }).contentMode).toBe('off');
	});

	it('turns a tag set in version 0.1.0 into the tagged mode', () => {
		expect(normalizeSettings({ contentTag: 'obs-sync' })).toMatchObject({ contentMode: 'tagged', contentTag: 'obs-sync' });
		expect(normalizeSettings({ contentTag: '' }).contentMode).toBe('off');
		expect(normalizeSettings({ contentMode: 'off', contentTag: 'obs-sync' }).contentMode).toBe('off');
	});
});
