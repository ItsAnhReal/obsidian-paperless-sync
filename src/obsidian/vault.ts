import {
	getFrontMatterInfo,
	normalizePath,
	parseYaml,
	stringifyYaml,
	type App,
	type TFile,
} from 'obsidian';
import type { NoteRef, VaultPort } from '../sync/engine';
import { readDocumentId, type Properties } from '../sync/properties';

/** `VaultPort` backed by the Obsidian vault. */
export class ObsidianVault implements VaultPort {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	async listDocumentNotes(): Promise<NoteRef[]> {
		const notes: NoteRef[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const properties = await this.readProperties(file);
			if (properties !== null && readDocumentId(properties) !== null) {
				notes.push({ path: file.path, properties });
			}
		}
		return notes;
	}

	exists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
	}

	async createNote(path: string, properties: Properties, body: string): Promise<void> {
		const normalized = normalizePath(path);
		await this.ensureParentFolders(normalized);
		await this.app.vault.create(
			normalized,
			`---\n${stringifyYaml(properties)}---\n${body}`,
		);
	}

	async updateProperties(
		path: string,
		update: (properties: Record<string, unknown>) => void,
	): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (file === null) throw new Error(`Note not found: ${path}`);
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => update(frontmatter),
		);
	}

	async updateText(path: string, update: (text: string) => string): Promise<boolean> {
		const file = this.app.vault.getFileByPath(path);
		if (file === null) throw new Error(`Note not found: ${path}`);
		// Most syncs change nothing, so the file is only written if the text differs.
		const current = await this.app.vault.cachedRead(file);
		if (update(current) === current) return false;
		await this.app.vault.process(file, update);
		return true;
	}

	private async readProperties(file: TFile): Promise<Record<string, unknown> | null> {
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache !== null) return cache.frontmatter ?? null;

		// The file is not indexed yet, for example right after startup. Reading it
		// directly keeps the sync from creating a second note for the same document.
		const info = getFrontMatterInfo(await this.app.vault.cachedRead(file));
		if (!info.exists) return null;
		try {
			const parsed: unknown = parseYaml(info.frontmatter);
			return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: null;
		} catch {
			return null;
		}
	}

	private async ensureParentFolders(path: string): Promise<void> {
		const segments = path.split('/').slice(0, -1);
		let current = '';
		for (const segment of segments) {
			current = current === '' ? segment : `${current}/${segment}`;
			if (this.app.vault.getAbstractFileByPath(current) !== null) continue;
			try {
				await this.app.vault.createFolder(current);
			} catch {
				// The folder appeared in the meantime; creating the note reports real problems.
			}
		}
	}
}
