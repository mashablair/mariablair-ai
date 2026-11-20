# Google Sheet sync: staged Contacts and Follow-ups integration

## What ships

- `/demo/admin/sync` remains an isolated fictional two-way sandbox. It never calls Google or Supabase.
- `/admin/sync` is admin-only and **off by default**. Once separately provisioned, it can show a read-only preview or apply selected Google Sheet changes to linked CRM records. **No production path writes to Google Sheets.** This is not a completed two-way rollout.
- Only existing explicitly linked Contacts and Follow-ups participate. Unlinked rows are counted, not imported. Nothing is automatically linked, added, deleted, or recreated.
- Keep the existing Sheet authoritative until the owner accepts a staged cutover. This code does not migrate contact data.

### Demo

Run `npm ci`, then `npm run dev -- --host 127.0.0.1`, and open `/demo/admin/sync`. Try independent edits, a same-field conflict, cancel/repreview, and a stale preview. Only fictional sample records are used.

## Mapping and first-link review

| Tab | Stable identity | Fields eligible for Sheet → app |
| --- | --- | --- |
| Contacts | Contact ID → explicitly linked app UUID | First Met / How → source, Next Action → next action, Follow-up Due → follow-up date |
| Follow-ups | Task ID → explicitly linked app UUID | Action → title, Due Date → due date |

The Follow-ups **Contact ID** is read for identity validation only; it must match the paired CRM task's linked contact. IDs are never guessed from names, email addresses, dates, or row positions, and sync never moves a follow-up to a different contact. Have the operator independently verify both identities before seeding a mapping.

Name, Relationship Type, free-form Contact Status/history, combined contact details, company/role, profile notes, follow-up Status, Priority and Last Update / Notes stay untouched. App stage and task completion time are not mapped. App-private notes, assessments, sessions, payments, and emails are never selected or copied. The preview reports unmapped header names and counts only for unlinked rows, not their contents.

Use ID text without leading/trailing spaces and plain-text sync values. Due dates must be blank or valid literal ISO calendar dates (`YYYY-MM-DD`); native numeric date cells, formulas, derived values, and rich text/chips cannot be interpreted as sync inputs. A linked follow-up Action cannot be blank. Duplicate IDs, missing linked rows, invalid mappings and unsupported linked cells stop the preview rather than guess or delete. Current bounds are 200 linked records, 1,000 rows and 26 columns per tab; use a reviewed expansion rather than silently truncating. A populated row with no ID is skipped and counted as unlinked.

## Server setup and rollout

**Do not apply a migration or change environment/Google permissions merely to deploy the dormant code.** Without setup, the new sync API remains off and ordinary app routes do not require sync tables.

1. Start with an isolated database and a dedicated private synthetic workbook with the two exact tab names and headers. Apply repository migrations to that isolated database and verify the app still works with sync off. Do not run `db:push` against an ambiguous linked project.
2. With sync off, provision the singleton `public.crm_sheets_sync_connection` as a database operator. The connection key is the lowercase SHA-256 hex of the server-pinned spreadsheet ID, not the ID itself. Seed independently reviewed mappings in `public.crm_sheets_sync_links(connection_key, kind, external_id, app_id)`, with `contacts` or `tasks`. One target and one mapping per external ID/app UUID are permitted. The app service role cannot change link mappings. Mappings are append-only; a remap requires an explicitly reviewed offline procedure, not a silent row replacement.
3. Configure the backend only: `CRM_SHEETS_SYNC_ID`, `CRM_SHEETS_SYNC_ACCOUNT`, `CRM_SHEETS_SYNC_KEY` (PKCS#8 PEM) and `CRM_SHEETS_SYNC_MODE=preview`. Only set actual credentials in the server secret store, not in git, browser variables, code, screenshots, or logs. Use a dedicated Google service account shared as **Viewer** only to the intended workbook, no domain-wide delegation, and no additional Drive scopes. Do not upgrade it to Editor. The code requests the read-only Sheets scope and pins Google's token and Sheets API endpoints. Configuration and credentials are separate from deploying this PR.
4. In the synthetic environment, verify linked/omitted counts and fields, look for unknown IDs/date formats, and check that preview mode cannot apply even through a direct authenticated API call. Confirm anonymous and ordinary users cannot access sync. Check supported edits in the same admin session while the workbook is quiet.
5. Set `CRM_SHEETS_SYNC_MODE=sheet_to_app` **only for the separately approved environment and first-run window**. Apply reviewed synthetic edits, confirm repeated apply is idempotent, verify unlinked records and unsupported fields are unchanged, and test a normal concurrent CRM edit. Revert to `off` to disable all sync requests; any unrecognized mode (including `two_way`) is off.
6. Before any use with real data, repeat the review with the workbook owner, confirm exact database and spreadsheet targets and reviewed link list, agree who can edit during the apply window, and check the first real preview without applying automatically. There is no background task.

## Planning, concurrency, and recovery

Every route requires a Supabase-verified bearer user and matching `admins.user_id`. Browser route guards are not authorization. Preview values are returned only to the signed-in admin, marked `Cache-Control: no-store`, and never appear in logs, public pages or analytics. The mapping and journal tables have RLS and are unavailable to browser roles including authenticated app admins. The database service-role RPC is invoker-security and explicitly revoked from public, anon and authenticated. Google credentials never leave the backend except for the signed assertion to Google.

A preview lasts ten minutes and is bound to its owner and exact snapshots/link digest. No timestamp heuristic or global winner is used. A field changed only on the Sheet goes to the app; different edits to the same field require review. An app-only change appears as deferred and is not exported, nor treated as reconciled. First-time differing fields are conflicts even if one side is blank; only identical new linked records become baselined. Apply accepts only a preview UUID and conflict choices, not destination, values, or write instructions.

Before touching CRM data the coordinator acquires a durable lease, rereads both sides, checks the preview, and persists a receipt. Postgres locks the linked CRM rows and atomically compares the expected allowlisted values and identities, writes only reviewed fields, and records the app-write acknowledgement. It commits the common baseline and completion receipt together only after a separate verification read. Mapping insertion is blocked during a lease or pending operation. Ordinary CRM edits that commit before the compare-and-set are not overwritten. A Google source edit that lands after the source read cannot be atomically prevented by Postgres: it does not change the source Sheet, it can make verification fail, and it requires reconciliation rather than advancing the baseline silently.

A network failure can leave an operation uncertain. A prepared or needs-review receipt blocks subsequent operations across requests and restarts. **Check previous sync** is verification-only with respect to CRM and Google: it can complete metadata if both sides already match, but it never replays a write. Same preview ID is the operation ID. If mismatched, stop and have the operator inspect the private before/target/current values before releasing the blocked connection. Don't clear the barrier, retry writes, or revert anyone's edits automatically. If the original admin cannot access the receipt, a database operator must handle recovery; the API never exposes another admin's preview. The expired preview/receipt limits are bounded (32 unexpired previews, 256 receipts, completed receipts pruned after 30 days on later prepare; unresolved receipts are not automatically pruned).

### Why no outbound Google writes are enabled

Google's value update API cannot compare-and-swap a cell or coordinate a transaction with Postgres. Fresh read, single cell-level RAW batch, and re-read still cannot prevent a human edit or row move in the intervening window. The standalone outbound adapter is covered with synthetic tests and **not wired into the production factory**, which has only a read-only token. A later outbound iteration should use a separate changes/review area with no replacement of editable CRM cells, or a deliberately exclusive, verified editing window with additional audit controls. Test genuine conflict/reorder behavior on a synthetic workbook before proposing any real outbound path.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Tests use fictional fixtures, PGlite (Postgres compiled to WASM), mocked Google HTTP responses, and synthetic signed credentials generated in memory. They cover admin denial, off/preview apply gating, owner/stale previews, lock fencing, stable links, compare-and-set against ordinary app edits, privacy allowlist, no write replay, receipt/baseline completion and targeted RAW adapter behavior. Production Google permissions, deployment config, live accounts, and real spreadsheets are not tested or changed by these commands.

Official references: [Google service-account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account), [Google Sheets authorization scopes](https://developers.google.com/workspace/sheets/api/scopes), [targeted value updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
