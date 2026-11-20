# Google Sheet sync: staged Contacts and Follow-ups integration

## What ships

- `/demo/admin/sync` remains an isolated fictional two-way sandbox. It never calls Google or Supabase.
- `/admin/sync` is admin-only and **off by default**. Once separately provisioned, it can show a read-only preview or apply selected Google Sheet changes to linked CRM records. **No production path writes to Google Sheets.** This is not a completed two-way rollout.
- In the linked-edit step, only existing explicitly linked Contacts and Follow-ups participate. Unlinked rows are counted, not imported. Nothing is automatically linked, added, deleted, or recreated.
- Keep the existing Sheet authoritative until the owner accepts a staged cutover. This code does not migrate contact data.

### Demo

Run `npm ci`, then `npm run dev -- --host 127.0.0.1`, and open `/demo/admin/sync`. Try independent edits, a same-field conflict, cancel/repreview, and a stale preview. Only fictional sample records are used.

## Direct Google import (separately enabled)

Open **Sync from Google Sheet** in the signed-in admin navigation (`/admin/sync/import`). Step 1 reads both Contacts and Follow-ups directly from the one server-configured private workbook. No CSV download is required. Preview all projected rows and omitted header names, then **Confirm and create records**. New contacts/follow-ups and stable links are created together by the existing bootstrap transaction. Existing linked rows are explicitly marked unchanged. Potential duplicate-name/task matches block the entire creation preview; IDs are never matched by name automatically.

Step 2, **Review linked edits**, opens `/admin/sync` for an independent fresh preview and confirmation using the existing sync coordinator. These are two separate operations, not one atomic create-and-update operation. Completing step 1 does not apply linked edits. Step 2 can be unavailable while step 1 is enabled. Repeated direct imports can add later new records while preserving existing links. No background work, messages or Google writes occur.

The direct reader uses metadata, a header-only request, then column ranges restricted to:

- Contacts: Contact ID, Name, First Met / How, Next Action, Follow-up Due.
- Follow-ups: Task ID, Contact ID, Action, Due Date.

Only the supported projection reaches the database or browser. Omitted column **names**, not values, are shown. A row blank across all supported columns is ignored; content exclusively in omitted columns is never fetched or imported. Both exact tab names and all required headers must exist, including an empty Follow-ups tab's headers. At least one contact is required. IDs must be unique literal text; all task Contact IDs must be present in Contacts. Duplicate normalized task titles for the same Contact ID in one input are rejected. Dates must be blank or literal ISO dates; native serial dates, formulas, derived cells and rich cells in supported columns fail closed. Current bounds are 200 total projected records, 1,000 grid rows and 26 grid columns per tab. The reader streams a bounded response and refuses oversized grids instead of truncating them.

Confirmation re-reads the projected source and rejects changed supported values before the database apply. The transaction independently rechecks CRM duplicate eligibility and serializes against linked sync. An encrypted, authenticated ten-minute token binds the hidden preview UUID and source digest to the authenticated admin and configured workbook. The CSV endpoint cannot use this token to bypass the source check. Tokens are not persisted in the browser. Rotating the existing Supabase server secret invalidates outstanding direct-import tokens; no additional secret is required.

Google and Postgres cannot share an atomic transaction. An edit after the last Google read can still occur; the app creates the explicitly reviewed snapshot, never writes Google, and subsequent linked-edit review can reconcile later changes. Work during a quiet editing window. Retrying the same token with unchanged source returns the existing count-only receipt without duplicating records. If Google is unavailable, the source changed, the token expired, or the server secret rotated after a lost acknowledgement, check the CRM before starting a fresh preview; this path cannot retrieve a receipt without a valid token and fresh matching source. It never blindly retries a different operation.

### Deployment and configuration requirements

This change requires **no new migration or data migration**. Deploy the reviewed code only after approval; deployment alone leaves direct import off. Existing staged sync and bootstrap migrations (`20261120134129_crm_sheets_sync.sql`, `20261120163709_crm_sheets_bootstrap.sql`) and the already-provisioned singleton connection must exist. Reuse the connection and links established by CSV bootstrap; do not reseed or remap production data.

Server-only settings:

| Setting | Required value / purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Existing backend credentials for the intended CRM project |
| `CRM_SHEETS_SYNC_ID` | Exactly the same approved private workbook used for existing connection/links |
| `CRM_SHEETS_SYNC_ACCOUNT`, `CRM_SHEETS_SYNC_KEY` | Dedicated service-account email and PKCS#8 PEM; Google Sheets API enabled; workbook shared **Viewer** only; no domain-wide delegation or Drive scope |
| `CRM_SHEETS_GOOGLE_IMPORT_ENABLED` | `1` explicitly enables direct preview **and confirmed app creation**; default `0` |
| `CRM_SHEETS_BOOTSTRAP_CONNECTION` | Optional existing lowercase SHA-256 workbook-ID pin; if present must match `CRM_SHEETS_SYNC_ID` and database singleton |
| `CRM_SHEETS_SYNC_MODE` | `off`/unset, `preview`, or `sheet_to_app`; controls linked edits independently. `preview` does not disable confirmed creation when the independent Google-import flag is `1`. Unknown modes block direct import. |
| `CRM_SHEETS_BOOTSTRAP_ENABLED` | Existing CSV fallback flag; CSV remains available only with linked-sync mode off/unset |

Disable `CRM_SHEETS_GOOGLE_IMPORT_ENABLED` to stop direct reads/creates; `CRM_SHEETS_SYNC_MODE=off` alone only stops linked sync. Set both flags to off/0 to stop both paths, and disable `CRM_SHEETS_BOOTSTRAP_ENABLED` to stop CSV too. Do not put secrets in `VITE_*`, commit them, or copy workbook values into support logs. Credential/access readiness is a separate operator task. This implementation was tested only with fictional fixtures and local PGlite, never a real workbook or production credentials.

Engineering references checked November 20, 2026: [Google GET field masks/ranges](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get), [read-only Sheets scope](https://developers.google.com/workspace/sheets/api/scopes), [Supabase server-verified getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase changelog](https://supabase.com/changelog.md), and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). The relevant latest changelog entries do not require changes to the existing getUser/admin-membership/RPC design; no CLI upgrade or production branch/migration operation is used.

## First import using CSV exports (separately enabled)

Use **Sync from Google Sheet > CSV fallback: import downloaded exports** in the signed-in live CRM. You'll recognize it by the site address and admin sign-in, not the public demo. Open the approved Google Sheet and download the Contacts tab and (optionally) Follow-ups tab as separate CSVs. Select the two matching exports, preview each proposed record and its source ID, and confirm once. Do not upload the files elsewhere or copy private values into a support message. CSV has no trusted source identity metadata: choose only exports from the operator-approved workbook. The raw files stay in the browser. Only the explicitly mapped projection is sent to the CRM. Review normalized values before creating records, especially date format. A date must be blank or `YYYY-MM-DD`; if necessary, normalize values in a private working copy, not in the authoritative workbook.

This is a one-time creation path, **not** a Google connection or update tool. It preserves Contact ID and Task ID in the same stable link table used by later sync. It imports Contact Name as supplied (outer whitespace trimmed; no first/last guessing), location/source, next action and follow-up date; it imports a follow-up's title, optional due date and validated link to an included Contact ID. New contacts use stage New and new follow-ups are open. Name is stored unsplit in the required CRM name field. Rich Contact Details, status, relationship type, email, phone, private notes, priority and task/follow-up notes are not imported. No outreach or account invitations are sent.

A previously linked ID is left unchanged even if the CSV value changed. An exact normalized name match, or an exact normalized follow-up Action match for its already-linked contact, is a duplicate warning, never an automatic match. Blocked rows keep the whole preview from applying; review existing matches through the CRM operator or exclude them from both working exports before re-previewing. A fresh import is atomic: contacts, follow-ups and links either all commit or all roll back. A lost acknowledgement can be checked with the same review button and preview ID; don't start a new operation until you've checked the CRM. Open previews expire after ten minutes. Submitting a newer preview prunes expired rows; completed receipts keep counts rather than personal contents. Browser demo has no upload or write controls for this path.

Setup must be separate from deploying dormant code. Rehearse with synthetic CSVs on an isolated database first. Verify migration history and apply the staged sync migration and the CSV bootstrap migration in sequence only to the intended project. With live sync off, privately seed the authoritative singleton with the lowercase SHA-256 digest of the approved workbook ID. Configure server bindings `CRM_SHEETS_BOOTSTRAP_ENABLED=1` and `CRM_SHEETS_BOOTSTRAP_CONNECTION` (that same digest); the existing server-only `CRM_SHEETS_SYNC_ID` can supply the digest instead. Configuring both requires them to match. No Google account, key or permission is needed. Keep `CRM_SHEETS_SYNC_MODE=off`. The project must use its own verified Supabase server credentials. Disabling the bootstrap flag stops further imports; it does not undo saved CRM records. Do not roll back by deleting imported data or mappings without a separate operator review.

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
5. Set `CRM_SHEETS_SYNC_MODE=sheet_to_app` **only for the separately approved environment and first-run window**. Apply reviewed synthetic edits, confirm repeated apply is idempotent, verify unlinked records and unsupported fields are unchanged, and test a normal concurrent CRM edit. Revert to `off` to disable linked-sync requests (disable the independent Google-import flag separately); any unrecognized mode (including `two_way`) is off.
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
