/** The folder removed documents are moved to: the setting, or `Removed` in the notes folder. */
export function resolveArchiveFolder(archiveFolder: string, notesFolder: string): string {
	const clean = (folder: string): string =>
		folder
			.split('/')
			.map((segment) => segment.trim())
			.filter((segment) => segment !== '')
			.join('/');
	const archive = clean(archiveFolder);
	if (archive !== '') return archive;
	const notes = clean(notesFolder);
	return notes === '' ? 'Removed' : `${notes}/Removed`;
}

export function isInFolder(path: string, folder: string): boolean {
	return folder === '' || path.startsWith(`${folder}/`);
}

/**
 * A free path for a note moved into the folder. A taken name gets a number, like
 * `Invoice 2.md`, so that moving never replaces another note.
 */
export function archivePath(
	folder: string,
	fileName: string,
	exists: (path: string) => boolean,
): string {
	const dot = fileName.lastIndexOf('.');
	const base = dot > 0 ? fileName.slice(0, dot) : fileName;
	const extension = dot > 0 ? fileName.slice(dot) : '';
	const prefix = folder === '' ? '' : `${folder}/`;
	let path = `${prefix}${fileName}`;
	for (let number = 2; exists(path); number++) {
		path = `${prefix}${base} ${number}${extension}`;
	}
	return path;
}
