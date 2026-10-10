import { requestUrl } from 'obsidian';
import type { HttpGet } from '../paperless/client';

const TIMEOUT_MS = 30_000;

/** `HttpGet` backed by Obsidian's `requestUrl`, which works on mobile and is not subject to CORS. */
export const httpGet: HttpGet = async (url, headers) => {
	const response = await withTimeout(
		requestUrl({ url, method: 'GET', headers, throw: false }),
		TIMEOUT_MS,
	);
	const lowerCased: Record<string, string> = {};
	for (const [name, value] of Object.entries(response.headers)) {
		lowerCased[name.toLowerCase()] = value;
	}
	return { status: response.status, headers: lowerCased, text: response.text };
};

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(
			() => reject(new Error(`no answer within ${ms / 1000} seconds`)),
			ms,
		);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}
