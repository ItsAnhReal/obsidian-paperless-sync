export interface PaperlessSyncSettings {
	serverUrl: string;
	/** Name of the secret in Obsidian's secret storage that holds the API token. */
	tokenSecret: string;
	folder: string;
	fileNameTemplate: string;
	noteTemplate: string;
	linkMetadata: boolean;
	includeCustomFields: boolean;
	/** Minutes between automatic syncs; 0 syncs at startup only. */
	syncIntervalMinutes: number;
	/** Base URL for document links, if it differs from the server URL. */
	linkBaseUrl: string;
	/** Tag that opts a document into syncing its text into the note. Empty turns it off. */
	contentTag: string;
}

export const DEFAULT_SETTINGS: PaperlessSyncSettings = {
	serverUrl: '',
	tokenSecret: '',
	folder: 'Paperless',
	fileNameTemplate: '{{created}} {{title}}',
	noteTemplate: '[Open in Paperless]({{url}})\n',
	linkMetadata: false,
	includeCustomFields: true,
	syncIntervalMinutes: 60,
	linkBaseUrl: '',
	contentTag: '',
};

export const MIN_SYNC_INTERVAL_MINUTES = 5;

export function isSettingKey(key: string): key is keyof PaperlessSyncSettings {
	return Object.keys(DEFAULT_SETTINGS).includes(key);
}

/**
 * Merges stored settings with the defaults. A value of the wrong type, for example from a
 * hand-edited data.json, falls back to its default instead of breaking the sync.
 */
export function normalizeSettings(stored: unknown): PaperlessSyncSettings {
	const settings: PaperlessSyncSettings = { ...DEFAULT_SETTINGS };
	if (typeof stored !== 'object' || stored === null) return settings;
	for (const [key, value] of Object.entries(stored)) {
		if (!isSettingKey(key) || typeof value !== typeof DEFAULT_SETTINGS[key]) continue;
		if (typeof value === 'number' && !Number.isFinite(value)) continue;
		Object.assign(settings, { [key]: value as unknown });
	}
	return settings;
}
