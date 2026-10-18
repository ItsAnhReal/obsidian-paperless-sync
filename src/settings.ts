import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import type PaperlessSyncPlugin from './main';
import {
	DEFAULT_SETTINGS,
	isSettingKey,
	MIN_SYNC_INTERVAL_MINUTES,
	type PaperlessSyncSettings,
} from './config';
import { normalizeServerUrl } from './paperless/client';

/** Not part of the synced settings: automatic sync is switched on per device. */
const AUTO_SYNC_KEY = 'autoSync';

type SettingKey = keyof PaperlessSyncSettings | typeof AUTO_SYNC_KEY;

const validateUrl = (value: string): string | undefined =>
	value.trim() === '' || normalizeServerUrl(value) !== null
		? undefined
		: 'Enter an address that starts with http:// or https://.';

export class PaperlessSyncSettingTab extends PluginSettingTab {
	private readonly plugin: PaperlessSyncPlugin;

	constructor(app: App, plugin: PaperlessSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name: 'Server address',
				desc: 'Address of your Paperless-ngx instance.',
				control: {
					type: 'text',
					key: 'serverUrl',
					placeholder: 'https://paperless.example.com',
					validate: validateUrl,
				},
			},
			{
				name: 'API token',
				desc: 'Stored in the secret storage of this device, not in your vault. You find the token in Paperless-ngx under "My profile".',
				control: { type: 'secret', key: 'tokenSecret' },
			},
			{
				name: 'Connection',
				desc: 'Check the server address and the API token.',
				render: (setting) => {
					setting.addButton((button) =>
						button.setButtonText('Test connection').onClick(() => {
							void this.plugin.testConnection();
						}),
					);
				},
			},
			{
				type: 'group',
				heading: 'Notes',
				items: [
					{
						name: 'Folder',
						desc: 'Where new notes are created. Existing notes are found by their properties, so you can move or rename them freely.',
						control: {
							type: 'folder',
							key: 'folder',
							includeRoot: true,
							placeholder: DEFAULT_SETTINGS.folder,
						},
					},
					{
						name: 'File name',
						desc: 'Template for new notes. Variables: {{title}}, {{id}}, {{created}}, {{created_year}}, {{created_month}}, {{correspondent}}, {{document_type}}, {{storage_path}}, {{asn}}. Use a slash for subfolders.',
						control: {
							type: 'text',
							key: 'fileNameTemplate',
							placeholder: DEFAULT_SETTINGS.fileNameTemplate,
							validate: (value) =>
								value.trim() === '' ? 'The file name cannot be empty.' : undefined,
						},
					},
					{
						name: 'Note text',
						desc: 'Template for the text of new notes. Supports the file name variables plus {{url}} and {{content}} for the document text. The text of existing notes is never changed, apart from the document text section below.',
						control: { type: 'textarea', key: 'noteTemplate', rows: 4 },
					},
					{
						name: 'Link correspondents and document types',
						desc: 'Write them as links, so that each one can have its own note with backlinks to its documents.',
						control: { type: 'toggle', key: 'linkMetadata' },
					},
					{
						name: 'Document text tag',
						desc: 'Documents with this Paperless-ngx tag get their text in a collapsed section at the end of their note. The section is updated on every sync and removed when the tag is removed from the document. Leave empty to keep all document text out of your vault.',
						control: { type: 'text', key: 'contentTag', placeholder: 'obs-sync' },
					},
					{
						name: 'Include custom fields',
						desc: 'Add the custom fields of each document as properties.',
						control: { type: 'toggle', key: 'includeCustomFields' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Sync',
				items: [
					{
						name: 'Sync automatically on this device',
						desc: 'Sync at startup and at the interval below. If your vault is shared between devices, enable this on one device only, so that two devices never create the same note at once.',
						control: { type: 'toggle', key: AUTO_SYNC_KEY },
					},
					{
						name: 'Sync interval',
						desc: `Minutes between automatic syncs, at least ${MIN_SYNC_INTERVAL_MINUTES}. Enter 0 to sync at startup only.`,
						control: {
							type: 'number',
							key: 'syncIntervalMinutes',
							min: 0,
							max: 1440,
							step: 1,
							validate: (value) =>
								value === 0 || value >= MIN_SYNC_INTERVAL_MINUTES
									? undefined
									: `Enter 0 or at least ${MIN_SYNC_INTERVAL_MINUTES}.`,
						},
					},
					{
						name: 'Sync now',
						desc: 'Create notes for new documents and update the properties of existing ones.',
						render: (setting) => {
							setting.addButton((button) =>
								button
									.setButtonText('Sync now')
									.setCta()
									.onClick(() => {
										void this.plugin.sync(true);
									}),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Advanced',
				items: [
					{
						name: 'Address for links',
						desc: 'Base address for the links to your documents, if it differs from the server address.',
						control: {
							type: 'text',
							key: 'linkBaseUrl',
							placeholder: 'Same as server address',
							validate: validateUrl,
						},
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === AUTO_SYNC_KEY) return this.plugin.autoSync;
		return isSettingKey(key) ? this.plugin.settings[key] : undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === AUTO_SYNC_KEY) {
			this.plugin.setAutoSync(value === true);
			return;
		}
		if (!isSettingKey(key) || typeof value !== typeof DEFAULT_SETTINGS[key]) return;
		Object.assign(this.plugin.settings, { [key]: value });
		await this.plugin.saveSettings();
	}
}
