# Contributing to Paperless Sync

Thanks for taking the time to help. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/ItsAnhReal/obsidian-paperless-sync/issues) and include:

- your Obsidian version, operating system and Paperless-ngx version,
- what you did, what you expected and what happened instead,
- the message the sync showed, if any.

Please leave out your API token, server address and document contents. If a document triggers the problem, describe its metadata (for example "a document without a correspondent") instead of sharing it.

## Suggesting a feature

Open an issue that describes the problem you want to solve. The plugin is deliberately one-way and read-only: it never changes anything in Paperless-ngx and never deletes notes. Ideas that keep those two promises fit best.

## Development setup

You need Node.js 22 or newer.

```bash
npm install
npm run dev        # build in watch mode
npm run mock       # mock Paperless-ngx API on http://127.0.0.1:8765, token "dev-token"
```

Copy `main.js` and `manifest.json` to `<vault>/.obsidian/plugins/paperless-sync/` in a test vault and point the plugin at the mock server. It serves `dev/mock-data.json` and rereads it on every request, so you can change documents while Obsidian is running.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused on one thing.
3. Add or update tests in `tests/` for changed behaviour.
4. Run `npm run validate` (lint, tests and build). CI runs the same check.
5. Update `README.md` if settings or behaviour change.
6. Describe what changes for users in the pull request.

Please follow Obsidian's [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines). In particular, use `requestUrl` for network requests and don't add new network destinations: the plugin talks only to the configured Paperless-ngx server.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
