import { describe, expect, it } from 'vitest';
import { archivePath, isInFolder, resolveArchiveFolder } from '../src/sync/archive';

describe('resolveArchiveFolder', () => {
	it('uses the setting, or Removed inside the notes folder', () => {
		expect(resolveArchiveFolder(' Archiv/Alt/ ', 'Paperless')).toBe('Archiv/Alt');
		expect(resolveArchiveFolder('', 'Paperless/')).toBe('Paperless/Removed');
		expect(resolveArchiveFolder('', '')).toBe('Removed');
	});
});

describe('isInFolder', () => {
	it('matches whole folder names only', () => {
		expect(isInFolder('Paperless/Removed/a.md', 'Paperless/Removed')).toBe(true);
		expect(isInFolder('Paperless/Removed old/a.md', 'Paperless/Removed')).toBe(false);
	});
});

describe('archivePath', () => {
	it('numbers the name if it is taken', () => {
		const taken = new Set(['Removed/Brief.md', 'Removed/Brief 2.md']);
		expect(archivePath('Removed', 'Brief.md', (path) => taken.has(path))).toBe('Removed/Brief 3.md');
		expect(archivePath('Removed', 'Neu.md', (path) => taken.has(path))).toBe('Removed/Neu.md');
	});
});
