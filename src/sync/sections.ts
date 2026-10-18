/**
 * Managed sections are the only parts of a note's text that the sync changes after the note
 * was created. Each one sits between a start and an end marker line. Obsidian hides `%%`
 * comments in reading view.
 */
export interface SectionMarkers {
	start: string;
	end: string;
}

/**
 * Puts the section into the note text, replacing an existing one, or removes it if
 * `section` is `null`. A new section goes at the end, after a blank line, or in front of the
 * line `before` if the note has it. Throws if the note has a start marker without an end
 * marker, because then it is unclear what to replace.
 */
export function applySection(
	text: string,
	markers: SectionMarkers,
	section: string | null,
	before?: string,
): string {
	const lines = text.split('\n');
	const start = lines.indexOf(markers.start);
	if (start === -1) {
		if (section === null) return text;
		const at = before === undefined ? -1 : lines.indexOf(before);
		if (at !== -1) {
			const head = lines.slice(0, at).join('\n').replace(/\n+$/, '');
			const tail = lines.slice(at).join('\n');
			return head === '' ? `${section}\n\n${tail}` : `${head}\n\n${section}\n\n${tail}`;
		}
		const trimmed = text.replace(/\n+$/, '');
		return trimmed === '' ? `${section}\n` : `${trimmed}\n\n${section}\n`;
	}
	const end = lines.indexOf(markers.end, start + 1);
	if (end === -1) {
		throw new Error(
			`The note has "${markers.start}" without "${markers.end}". Remove that section and sync again.`,
		);
	}
	if (section !== null) {
		return [...lines.slice(0, start), section, ...lines.slice(end + 1)].join('\n');
	}
	// Also remove the blank line that was added in front of the section, and the one after
	// it if the section was put in front of another one.
	const from = start > 0 && lines[start - 1] === '' ? start - 1 : start;
	const to = from === start && lines[end + 1] === '' ? end + 2 : end + 1;
	return [...lines.slice(0, from), ...lines.slice(to)].join('\n');
}

/** Quotes every line, so that no line of the text can be mistaken for a marker. */
export function quoteLines(text: string): string[] {
	return text.split('\n').map((line) => (line.trim() === '' ? '>' : `> ${line.trimEnd()}`));
}
