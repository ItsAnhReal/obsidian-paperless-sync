import { MarkdownView, Notice, Platform, Plugin, setTooltip, type TFile } from 'obsidian';
import { httpGet } from './obsidian/http';
import { RemovedDocumentsModal } from './obsidian/removed-modal';
import { PaperlessSearchModal, type SearchContext } from './obsidian/search-modal';
import { ObsidianVault } from './obsidian/vault';
import { normalizeServerUrl, PaperlessClient, PaperlessError } from './paperless/client';
import {
	DEFAULT_SETTINGS,
	MIN_SYNC_INTERVAL_MINUTES,
	normalizeSettings,
	type PaperlessSyncSettings,
} from './config';
import type { LookupKind } from './paperless/types';
import { PaperlessSyncSettingTab } from './settings';
import { resolveArchiveFolder } from './sync/archive';
import { runSync, type SyncOptions, type SyncResult, type SyncScope } from './sync/engine';
import type { TagFilterOptions } from './sync/filter';
import { documentUrl, PROPERTY, readDocumentId } from './sync/properties';

const AUTO_SYNC_STORAGE_KEY = 'paperless-sync-auto';
const STARTUP_DELAY_MS = 10_000;

const LOOKUP_NAMES: Record<LookupKind, string> = {
	tags: 'tags',
	correspondents: 'correspondents',
	documentTypes: 'document types',
	storagePaths: 'storage paths',
	customFields: 'custom fields',
};

export default class PaperlessSyncPlugin extends Plugin {
	settings: PaperlessSyncSettings = { ...DEFAULT_SETTINGS };
	private syncing = false;
	private statusBarEl: HTMLElement | null = null;
	private intervalId: number | null = null;
	/** Problems the last sync reported, so that automatic syncs do not repeat them. */
	private lastProblems = '';

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

		this.addCommand({
			id: 'open-in-paperless',
			name: 'Open document in Paperless-ngx',
			checkCallback: (checking) => {
				const id = this.activeDocumentId();
				if (id === null) return false;
				if (!checking) this.openInPaperless(id);
				return true;
			},
		});

		this.addCommand({
			id: 'sync-current-note',
			name: 'Sync this note',
			checkCallback: (checking) => {
				const id = this.activeDocumentId();
				if (id === null) return false;
				if (!checking) void this.sync(true, { ids: [id] });
				return true;
			},
		});

		this.addCommand({
			id: 'search',
			name: 'Search documents',
			callback: () => {
				new PaperlessSearchModal(this.app, this.searchContext(), (file) => {
					void this.app.workspace.getLeaf(false).openFile(file);
				}).open();
			},
		});

		this.addCommand({
			id: 'insert-link',
			name: 'Insert link to document',
			editorCallback: (editor, view) => {
				const sourcePath = view.file?.path ?? '';
				new PaperlessSearchModal(this.app, this.searchContext(), (file) => {
					editor.replaceSelection(this.app.fileManager.generateMarkdownLink(file, sourcePath));
				}).open();
			},
		});

		this.addCommand({
			id: 'show-removed',
			name: 'Show notes of removed documents',
			callback: () => {
				new RemovedDocumentsModal(this.app, this.removedNotes(), this.archiveFolder()).open();
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
		this.settings = normalizeSettings(await this.loadData());
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
	 * A scope limits the sync to some documents.
	 */
	async sync(manual: boolean, scope?: SyncScope): Promise<SyncResult | null> {
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
		if (scope === undefined) this.setStatus('Paperless: syncing…', 'Paperless sync is running.');
		try {
			const result = await runSync(
				client,
				new ObsidianVault(this.app),
				this.syncOptions(),
				scope,
			);
			const summary = summarize(result);
			if (scope !== undefined) {
				if (manual) new Notice(summary);
				return result;
			}
			this.setStatus(`Paperless: ${currentTime()}`, summary);
			const problems = problemKey(result);
			const noteworthy =
				result.created > 0 ||
				result.missing > 0 ||
				(problems !== '' && problems !== this.lastProblems);
			this.lastProblems = problems;
			if (manual || noteworthy) new Notice(summary);
			return result;
		} catch (error) {
			const message = describeError(error);
			if (scope === undefined) this.setStatus('Paperless: sync failed', message);
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

	/** The note of the document, created by syncing the document if there is none yet. */
	async noteForDocument(id: number): Promise<TFile | null> {
		const existing = this.findNote(id);
		if (existing !== null) return existing;
		// A manual sync reports why no note was created, for example a tag filter.
		const result = await this.sync(true, { ids: [id] });
		const path = result?.createdPaths[0];
		return (path === undefined ? null : this.app.vault.getFileByPath(path)) ?? this.findNote(id);
	}

	/** The note of a document, preferring one that is not flagged as removed. */
	findNote(id: number): TFile | null {
		let found: TFile | null = null;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const properties = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (readDocumentId(properties) !== id) continue;
			if (properties?.[PROPERTY.missing] !== true) return file;
			found ??= file;
		}
		return found;
	}

	private removedNotes(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((file) => {
			const properties = this.app.metadataCache.getFileCache(file)?.frontmatter;
			return readDocumentId(properties) !== null && properties?.[PROPERTY.missing] === true;
		});
	}

	private archiveFolder(): string {
		return resolveArchiveFolder(this.settings.archiveFolder, this.settings.folder);
	}

	private activeDocumentId(): number | null {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
		if (file === null) return null;
		return readDocumentId(this.app.metadataCache.getFileCache(file)?.frontmatter);
	}

	private openInPaperless(id: number): void {
		const base = this.linkBaseUrl();
		if (base === '') {
			new Notice('Enter the server address in the plugin settings first.');
			return;
		}
		window.open(documentUrl(base, id));
	}

	private searchContext(): SearchContext {
		return {
			createClient: () => this.createClient(),
			filterOptions: (): TagFilterOptions => ({
				includeTags: this.settings.includeTags,
				excludeTags: this.settings.excludeTags,
			}),
			findNote: (id) => this.findNote(id),
			noteForDocument: (id) => this.noteForDocument(id),
			describeError,
		};
	}

	private linkBaseUrl(): string {
		return (
			normalizeServerUrl(this.settings.linkBaseUrl) ??
			normalizeServerUrl(this.settings.serverUrl) ??
			''
		);
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
			linkBaseUrl: this.linkBaseUrl(),
			linkMetadata: this.settings.linkMetadata,
			includeCustomFields: this.settings.includeCustomFields,
			contentMode: this.settings.contentMode,
			contentTag: this.settings.contentTag,
			includeNotes: this.settings.includeNotes,
			includeTags: this.settings.includeTags,
			excludeTags: this.settings.excludeTags,
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
	if (result.excluded > 0) {
		parts.push(`${result.excluded} skipped by the tag filters`);
	}
	if (result.missing > 0) {
		parts.push(`${result.missing} no longer in Paperless-ngx`);
	}
	let summary = `Paperless sync: ${parts.join(', ')}.`;
	if (result.unknownFilterTags.length > 0) {
		summary += ` The tag filters name tags that do not exist in Paperless-ngx: ${result.unknownFilterTags.join(', ')}.`;
	}
	if (result.missing > 0) {
		summary += ' Run "Show notes of removed documents" to review them.';
	}
	if (result.failures.length > 0) {
		const first = result.failures[0];
		summary += ` ${count(result.failures.length, 'document')} failed`;
		summary +=
			first === undefined ? '.' : `, first: document ${first.documentId}: ${first.message}`;
	}
	if (result.duplicateIds.length > 0) {
		summary += ` More than one note exists for document ${result.duplicateIds.slice(0, 5).join(', ')}.`;
	}
	if (result.unavailable.length > 0) {
		const names = result.unavailable.map((kind) => LOOKUP_NAMES[kind]).join(', ');
		summary += ` The API user may not read ${names}, so those properties were left as they are.`;
	}
	if (!result.complete) {
		summary += ' The document list was incomplete, so removed documents were not checked.';
	}
	return summary;
}

/** Identifies the problems of a sync result; empty if there are none. */
function problemKey(result: SyncResult): string {
	const ids = result.failures.map((failure) => failure.documentId);
	if (
		ids.length === 0 &&
		result.duplicateIds.length === 0 &&
		result.unknownFilterTags.length === 0 &&
		result.unavailable.length === 0 &&
		result.complete
	) {
		return '';
	}
	return JSON.stringify([
		ids,
		result.duplicateIds,
		result.unavailable,
		result.complete,
		result.unknownFilterTags,
	]);
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
