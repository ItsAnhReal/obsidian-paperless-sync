import { Notice, Platform, Plugin, setTooltip } from 'obsidian';
import { httpGet } from './obsidian/http';
import { ObsidianVault } from './obsidian/vault';
import { normalizeServerUrl, PaperlessClient, PaperlessError } from './paperless/client';
import {
	DEFAULT_SETTINGS,
	MIN_SYNC_INTERVAL_MINUTES,
	PaperlessSyncSettingTab,
	type PaperlessSyncSettings,
} from './settings';
import { runSync, type SyncOptions, type SyncResult } from './sync/engine';

const AUTO_SYNC_STORAGE_KEY = 'paperless-sync-auto';
const STARTUP_DELAY_MS = 10_000;

export default class PaperlessSyncPlugin extends Plugin {
	settings: PaperlessSyncSettings = { ...DEFAULT_SETTINGS };
	private syncing = false;
	private statusBarEl: HTMLElement | null = null;
	private intervalId: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.hide();

		this.addCommand({
			id: 'sync',
			name: 'Sync now',
			callback: () => {
				void this.sync(true);
			},
		});

		this.addSettingTab(new PaperlessSyncSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.scheduleAutoSync();
			if (!this.autoSync) return;
			const timer = window.setTimeout(() => {
				void this.sync(false);
			}, STARTUP_DELAY_MS);
			this.register(() => window.clearTimeout(timer));
		});
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.scheduleAutoSync();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<PaperlessSyncSettings> | null,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.scheduleAutoSync();
	}

	/**
	 * Automatic sync is a per-device choice, so it is kept out of the synced settings.
	 * Stored as a string because Obsidian's local storage clears an entry set to `false`.
	 */
	get autoSync(): boolean {
		const stored: unknown = this.app.loadLocalStorage(AUTO_SYNC_STORAGE_KEY);
		if (stored === 'on') return true;
		if (stored === 'off') return false;
		return !Platform.isMobile;
	}

	setAutoSync(enabled: boolean): void {
		this.app.saveLocalStorage(AUTO_SYNC_STORAGE_KEY, enabled ? 'on' : 'off');
		this.scheduleAutoSync();
	}

	/**
	 * Runs a sync. A manual sync always reports its outcome; an automatic one stays quiet
	 * unless there is something to see, so that being offline never interrupts the user.
	 */
	async sync(manual: boolean): Promise<SyncResult | null> {
		if (this.syncing) {
			if (manual) new Notice('Paperless sync is already running.');
			return null;
		}

		let client: PaperlessClient;
		try {
			client = this.createClient();
		} catch (error) {
			if (manual) new Notice(describeError(error));
			return null;
		}

		this.syncing = true;
		this.setStatus('Paperless: syncing…', 'Paperless sync is running.');
		try {
			const result = await runSync(client, new ObsidianVault(this.app), this.syncOptions());
			const summary = summarize(result);
			this.setStatus(`Paperless: ${currentTime()}`, summary);
			const noteworthy =
				result.created > 0 ||
				result.missing > 0 ||
				result.failures.length > 0 ||
				result.duplicateIds.length > 0;
			if (manual || noteworthy) new Notice(summary);
			return result;
		} catch (error) {
			const message = describeError(error);
			this.setStatus('Paperless: sync failed', message);
			if (manual) new Notice(message);
			if (!(error instanceof PaperlessError)) console.error(error);
			return null;
		} finally {
			this.syncing = false;
		}
	}

	async testConnection(): Promise<void> {
		try {
			const server = await this.createClient().connect();
			const version = server.serverVersion === null ? '' : ` ${server.serverVersion}`;
			new Notice(
				`Connected to Paperless-ngx${version}. ${count(server.documentCount, 'document')} found.`,
			);
		} catch (error) {
			new Notice(describeError(error));
		}
	}

	private createClient(): PaperlessClient {
		if (this.settings.serverUrl.trim() === '') {
			throw new PaperlessError('config', 'Enter the server address in the Paperless Sync settings first.');
		}
		const token =
			this.settings.tokenSecret === ''
				? null
				: this.app.secretStorage.getSecret(this.settings.tokenSecret);
		if (token === null || token.trim() === '') {
			throw new PaperlessError(
				'config',
				'Select an API token in the Paperless Sync settings on this device first.',
			);
		}
		return new PaperlessClient(this.settings.serverUrl, token, httpGet);
	}

	private syncOptions(): SyncOptions {
		return {
			folder: this.settings.folder,
			fileNameTemplate:
				this.settings.fileNameTemplate.trim() === ''
					? DEFAULT_SETTINGS.fileNameTemplate
					: this.settings.fileNameTemplate,
			noteTemplate: this.settings.noteTemplate,
			linkBaseUrl:
				normalizeServerUrl(this.settings.linkBaseUrl) ??
				normalizeServerUrl(this.settings.serverUrl) ??
				'',
			linkMetadata: this.settings.linkMetadata,
			includeCustomFields: this.settings.includeCustomFields,
		};
	}

	private scheduleAutoSync(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
		const minutes = this.settings.syncIntervalMinutes;
		if (!this.autoSync || !Number.isFinite(minutes) || minutes <= 0) return;
		this.intervalId = window.setInterval(
			() => {
				void this.sync(false);
			},
			Math.max(minutes, MIN_SYNC_INTERVAL_MINUTES) * 60_000,
		);
		this.registerInterval(this.intervalId);
	}

	private setStatus(text: string, tooltip: string): void {
		if (this.statusBarEl === null) return;
		this.statusBarEl.setText(text);
		setTooltip(this.statusBarEl, tooltip, { placement: 'top' });
		this.statusBarEl.show();
	}
}

function summarize(result: SyncResult): string {
	const parts = [
		`${result.created} created`,
		`${result.updated} updated`,
		`${result.unchanged} unchanged`,
	];
	if (result.missing > 0) {
		parts.push(`${result.missing} no longer in Paperless-ngx`);
	}
	let summary = `Paperless sync: ${parts.join(', ')}.`;
	if (result.failures.length > 0) {
		const first = result.failures[0];
		summary += ` ${count(result.failures.length, 'document')} failed`;
		summary += first === undefined ? '.' : `, first: ${first.message}`;
	}
	if (result.duplicateIds.length > 0) {
		summary += ` More than one note exists for document ${result.duplicateIds.slice(0, 5).join(', ')}.`;
	}
	if (!result.complete) {
		summary += ' The document list was incomplete, so removed documents were not checked.';
	}
	return summary;
}

function count(value: number, noun: string): string {
	return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function currentTime(): string {
	return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function describeError(error: unknown): string {
	if (error instanceof PaperlessError) return error.message;
	return `Paperless sync failed: ${error instanceof Error ? error.message : String(error)}`;
}
