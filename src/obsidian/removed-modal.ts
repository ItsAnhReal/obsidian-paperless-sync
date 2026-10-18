import { Modal, Notice, Setting, type App, type TFile } from 'obsidian';
import { archivePath, isInFolder } from '../sync/archive';

/** Lists the notes of documents that were removed from Paperless-ngx. */
export class RemovedDocumentsModal extends Modal {
	private readonly files: TFile[];
	private readonly archiveFolder: string;

	constructor(app: App, files: TFile[], archiveFolder: string) {
		super(app);
		this.files = [...files].sort((a, b) => a.path.localeCompare(b.path));
		this.archiveFolder = archiveFolder;
		this.setTitle('Notes of removed documents');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (this.files.length === 0) {
			contentEl.createEl('p', {
				text: 'No note belongs to a document that was removed from Paperless-ngx.',
			});
			return;
		}
		contentEl.createEl('p', {
			text: `${this.files.length} ${this.files.length === 1 ? 'note belongs' : 'notes belong'} to documents that are no longer in Paperless-ngx. The notes are never deleted. If a document comes back, its note is updated again.`,
		});
		const list = contentEl.createEl('ul');
		for (const file of this.files) {
			const link = list.createEl('li').createEl('a', { text: file.path, href: '#' });
			link.addEventListener('click', (event) => {
				event.preventDefault();
				this.close();
				void this.app.workspace.getLeaf(false).openFile(file);
			});
		}

		const toMove = this.files.filter((file) => !isInFolder(file.path, this.archiveFolder));
		new Setting(contentEl)
			.setName(`Move to ${this.archiveFolder}`)
			.setDesc(
				toMove.length === 0
					? 'All of these notes are already in that folder.'
					: `Moves ${toMove.length === 1 ? 'the note' : `${toMove.length} notes`} there. Links to them are updated.`,
			)
			.addButton((button) =>
				button
					.setButtonText('Move')
					.setDisabled(toMove.length === 0)
					.onClick(() => {
						button.setDisabled(true);
						void this.moveAll(toMove);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async moveAll(files: TFile[]): Promise<void> {
		const vault = this.app.vault;
		let moved = 0;
		try {
			await ensureFolder(this.app, this.archiveFolder);
			for (const file of files) {
				const target = archivePath(
					this.archiveFolder,
					file.name,
					(path) => vault.getAbstractFileByPath(path) !== null,
				);
				await this.app.fileManager.renameFile(file, target);
				moved++;
			}
			new Notice(`Moved ${moved} ${moved === 1 ? 'note' : 'notes'} to ${this.archiveFolder}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Moved ${moved} of ${files.length} notes. ${message}`);
		}
		this.close();
	}
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	let current = '';
	for (const segment of folder.split('/')) {
		current = current === '' ? segment : `${current}/${segment}`;
		if (app.vault.getAbstractFileByPath(current) === null) await app.vault.createFolder(current);
	}
}
