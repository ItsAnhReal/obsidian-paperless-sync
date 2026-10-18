import { SuggestModal, type App, type TFile } from 'obsidian';
import type { PaperlessClient } from '../paperless/client';
import type { Lookups, SearchHit } from '../paperless/types';
import { buildTagFilter, type TagFilterOptions } from '../sync/filter';
import { toDate } from '../sync/properties';

const SEARCH_LIMIT = 20;
/** More hits than shown are fetched, because the tag filters may leave some out. */
const FETCH_LIMIT = 50;
const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export interface SearchContext {
	createClient(): PaperlessClient;
	filterOptions(): TagFilterOptions;
	findNote(id: number): TFile | null;
	/** Returns the note for the document, creating it if there is none yet. */
	noteForDocument(id: number): Promise<TFile | null>;
	describeError(error: unknown): string;
}

interface SearchItem {
	hit: SearchHit;
	correspondent: string | undefined;
	note: TFile | null;
}

/** Searches the full text of Paperless-ngx and hands the note of the chosen document on. */
export class PaperlessSearchModal extends SuggestModal<SearchItem> {
	private readonly context: SearchContext;
	private readonly onChoose: (file: TFile) => void;
	private client: PaperlessClient | null = null;
	private lookups: Promise<Lookups> | null = null;
	private latestQuery = '';
	/** Results of the newest query, returned for older queries that finish later. */
	private latestItems: SearchItem[] = [];

	constructor(app: App, context: SearchContext, onChoose: (file: TFile) => void) {
		super(app);
		this.context = context;
		this.onChoose = onChoose;
		this.limit = SEARCH_LIMIT;
		this.setPlaceholder('Search your Paperless-ngx documents…');
		this.emptyStateText = 'Type to search.';
	}

	async getSuggestions(query: string): Promise<SearchItem[]> {
		const trimmed = query.trim();
		this.latestQuery = trimmed;
		if (trimmed.length < MIN_QUERY_LENGTH) {
			this.emptyStateText = 'Type to search.';
			this.latestItems = [];
			return [];
		}
		// Typing fast would otherwise send a request for every key.
		await sleep(DEBOUNCE_MS);
		if (this.latestQuery !== trimmed) return this.latestItems;
		try {
			const client = this.getClient();
			this.lookups ??= client.connect().then(() => client.fetchLookups(false));
			const lookups = await this.lookups;
			const isSynced = buildTagFilter(this.context.filterOptions(), lookups);
			const hits = await client.search(trimmed, FETCH_LIMIT);
			// A slow answer to an older query must not replace the results of a newer one.
			if (this.latestQuery !== trimmed) return this.latestItems;
			this.emptyStateText = 'No documents found.';
			this.latestItems = hits
				.filter((hit) => isSynced(hit.tags))
				.slice(0, SEARCH_LIMIT)
				.map((hit) => ({
					hit,
					correspondent:
						hit.correspondent === null
							? undefined
							: lookups.correspondents.get(hit.correspondent),
					note: this.context.findNote(hit.id),
				}));
			return this.latestItems;
		} catch (error) {
			this.lookups = null;
			if (this.latestQuery !== trimmed) return this.latestItems;
			this.emptyStateText = this.context.describeError(error);
			this.latestItems = [];
			return [];
		}
	}

	renderSuggestion(item: SearchItem, el: HTMLElement): void {
		el.createDiv({ text: item.hit.title });
		const details = [
			toDate(item.hit.created),
			item.correspondent,
			item.note === null ? 'No note yet' : undefined,
		].filter((part) => part !== undefined);
		if (details.length > 0) {
			el.createEl('small', { text: details.join(' · ')});
		}
	}

	onChooseSuggestion(item: SearchItem): void {
		if (item.note !== null) {
			this.onChoose(item.note);
			return;
		}
		void this.context.noteForDocument(item.hit.id).then((file) => {
			if (file !== null) this.onChoose(file);
		});
	}

	private getClient(): PaperlessClient {
		this.client ??= this.context.createClient();
		return this.client;
	}
}
