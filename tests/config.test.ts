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
});
