# Paperless Sync

An [Obsidian](https://obsidian.md) plugin that keeps one note for every document in your [Paperless-ngx](https://docs.paperless-ngx.com) instance. Each note carries the document's metadata as properties and links back to the document, so you can link, tag and query your paperwork like any other note. The files themselves stay in Paperless-ngx.

```yaml
---
paperless_id: 2
paperless_title: "Stromrechnung 03/2024: Abschlag"
paperless_url: https://paperless.example.com/documents/2/details
paperless_correspondent: Stadtwerke
paperless_document_type: Rechnung
paperless_tags:
  - Inbox
  - Wohnung
paperless_created: 2024-03-15
paperless_added: 2024-03-16
paperless_field_betrag: EUR84.50
---
[Open in Paperless](https://paperless.example.com/documents/2/details)
```

## How it works

- **One-way and read-only.** The plugin only sends `GET` requests. It never changes anything in Paperless-ngx.
- **Notes are matched by `paperless_id`, not by path.** Rename and move the notes as you like.
- **Only the `paperless_*` properties are managed.** The note text and your own properties are never touched after a note is created. The one exception is the opt-in document text section described below.
- **Document text stays in Paperless-ngx unless you opt in.** Only documents with the tag you set as **Document text tag** get their text into the vault.
- **Nothing is deleted.** When a document disappears from Paperless-ngx, its note gets `paperless_missing: true`. The flag is removed if the document comes back.
- **Writes only when something changed.** A sync that finds no differences does not touch any file, which keeps file sync services quiet.

## Setup

Requires Obsidian 1.13.2 or newer.

1. Install and enable the plugin.
2. In Paperless-ngx, open **My Profile** and copy the API token. A dedicated user with view-only permissions is a good idea: give it **View** for documents, tags, correspondents, document types, storage paths and custom fields. If one of the lists other than documents is not readable, the sync still runs and leaves the properties that come from that list as they are.
3. In Obsidian, open **Settings → Paperless Sync** and enter the server address, for example `https://paperless.example.com`.
4. Under **API token**, create a secret that holds the token.
5. Select **Test connection**, then **Sync now**.

The token is kept in Obsidian's secret storage on the device. It is not written to the vault, so it is not synced. Enter it once on every device that should sync.

## Settings

| Setting | Description |
| --- | --- |
| Server address | Address of your Paperless-ngx instance. |
| API token | The secret that holds your API token. |
| Folder | Where new notes are created. Default: `Paperless`. |
| File name | Template for new notes. Default: `{{created}} {{title}}`. Use `/` for subfolders. |
| Note text | Template for the text of new notes. |
| Link correspondents and document types | Writes them as `[[links]]`, so each can have its own note with backlinks. |
| Document text tag | Documents with this tag get their text in a collapsed section at the end of their note. Empty by default, which keeps all document text out of the vault. |
| Include custom fields | Adds custom fields as `paperless_field_<name>` properties. |
| Sync automatically on this device | Syncs at startup and at the interval. Stored per device. On by default on desktop, off on mobile. |
| Sync interval | Minutes between automatic syncs. `0` syncs at startup only. |
| Address for links | Base address for document links, if it differs from the server address. |

Template variables: `{{title}}`, `{{id}}`, `{{created}}`, `{{created_year}}`, `{{created_month}}`, `{{correspondent}}`, `{{document_type}}`, `{{storage_path}}`, `{{asn}}`. The note text also supports `{{url}}` and `{{content}}` (the document text).

The command **Paperless Sync: Sync now** runs a sync from the command palette.

## Document text for selected documents

Most paperwork does not belong in a vault that is synced to the cloud or read by other tools. So the document text is left out unless you opt in per document: set **Document text tag**, for example to `obs-sync`, and give that tag to the documents you want in Paperless-ngx. Their notes get a section at the end:

```markdown
%% paperless-content start %%
> [!quote]- Document text
> Ihr Abschlag für März 2024 beträgt 84,50 EUR.
%% paperless-content end %%
```

- The section is updated on every sync, so edits inside it are replaced. Write your own notes above or below it.
- When you remove the tag from a document, the next sync removes the section from its note.
- If the API user may not read tags, sections are left as they are.
- Clearing the setting stops the sync from touching note texts. Sections that already exist stay; remove the tag from those documents first to have them removed.

## Using a vault on several devices

If your vault is synced between devices, enable **Sync automatically on this device** on one device only. Two devices that create the note for the same new document at the same moment can end up with a duplicate, depending on your file sync service. If that happens, the sync result names the affected document; delete one of the two notes.

## Network use

The plugin connects only to the Paperless-ngx server you configure, to read document metadata and, for documents you opt in, their text. It contacts no other service and collects no telemetry.

## Limitations

- File names are set when a note is created and are not changed when the document title changes later. The current title is always in `paperless_title`.
- `{{content}}` in the note text is filled in when the note is created and is not updated afterwards. Use the document text tag for text that stays up to date.
- Links in the note text, such as the default `[Open in Paperless]({{url}})`, are not updated when the server address or the address for links changes. `paperless_url` always has the current link.
- Document links in custom fields are written as document IDs.

## Development

```bash
npm install
npm run dev        # build in watch mode
npm run validate   # lint, test and build
npm run mock       # mock Paperless-ngx API on http://127.0.0.1:8765, token "dev-token"
```

Copy `main.js` and `manifest.json` to `<vault>/.obsidian/plugins/paperless-sync/` to try a build. The mock server serves `dev/mock-data.json` and rereads it on every request.

## License

[MIT](LICENSE). This project is not affiliated with Obsidian or Paperless-ngx.
