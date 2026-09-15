# Private — compact workspace prototype, revision 4

## Shared human + AI chat
Family now defaults to Chat, with People as a second tab. Clearly labeled illustrative human/AI messages, visible AI participants, agent recipient selection, local message preview, participant add/remove, mention-only or reviewed-suggestions settings. Agent participation never grants source access. Draft agents remain disconnected. No real message, model call or attachment upload occurs. `verify-chat.cjs` verifies composer above fold, targeting, local messages and participant changes at 1440x900, 390x844, 375x667, 320x568. Images: `v4-chat-*`.


## Agent builder added
Visible Create agent on Home and Family AI; Chat / Agent builder navigation; Instructions, Sources & access, Review tabs. Agent name, purpose and system prompt are editable. Photos, Documents, Files, Google Drive, Family collection and My Vault each have independent default-off selection. Planned selections are text descriptions, not connected file pickers. Drafts can be saved, reopened and edited within the browser session. No real training, source access, file upload, OAuth, model call or agent activation occurs.

Builder smoke tests: `verify-builder.cjs`, same LD_LIBRARY_PATH as below; validates desktop 1440 and mobile 390/320 widths, required fields, prompt preservation, all source controls, default-deny, draft save/reopen and no overflow. Revision-2 core smoke tests also pass. `v3-instructions-*` / `v3-sources-*` are current builder screenshots.


Open `private-family-preview.html` in a browser. All images/styles/interactions are embedded; no server or install required. Editable source: `index.html` and local `assets/`.

## User-approved direction correction
Large banners are removed. Prioritize tidy, visible main areas and first-fold navigation on desktop and mobile. Family AI is a first-class destination, not hidden under settings. This supersedes the earlier proposal to make AI settings-only.

## Included
- Five persistent navigation destinations: Home, Family AI, Memories, Family, My Vault.
- Compact Home: area shortcuts, Family AI question field/suggested tasks/access, recent memory rows, family profiles. No hero banner.
- AI workspace: visible agent selector, question preview, suggested tasks, agent templates and explicit source-access selection. My Vault is excluded by default.
- Memories search/filter/browse/timeline, Family overview, private collection, item detail, capture/review/success.
- Safe preview behavior: no actual model calls, uploads, messaging, access grants or persisted saves. All content is illustrative. Changes reset on refresh.

## Verification
Linux Chromium, viewport sizes 1440x900, 1280x720, 834x1112, 390x844, 375x667, 320x568: no horizontal page overflow on all five destinations; main Home shortcuts and AI panel above fold; AI composer above fold. Recent Home memory checked above fold at widths 375 and up. Smallest height may require scrolling for secondary content.

Interactions tested: question transfers Home -> Family AI, preview-only response, vault opt-in, agent selection, detail/Escape, capture with private default, review/back retaining values, preview save, private/shared collection separation, search empty/recovery, timeline. Zero uncaught JS errors. Desktop and mobile screenshots visually inspected. Source and standalone HTML both exercised. Not physical-device, Windows, Safari or Firefox verification; not a full accessibility audit.

Run:
`LD_LIBRARY_PATH=/data/workspace/browser-libs/root/usr/lib/x86_64-linux-gnu node design-preview/verify-v2.cjs`
For standalone: prefix the above with `STANDALONE=1`.
Test runner uses this environment's cached Playwright 1.63.0 path.

Public hosting remains unavailable: last Vercel check reported logged out. No temporary deployment used. Downloadable prototype is not a hosted public URL. Production app and database remain unchanged.

Screenshots prefixed `v2-` represent the current design; other screenshots are superseded.
Images: Unsplash IDs photo-1516483638261-f4dbaf036963, photo-1464822759023-fed622ff2c3b, photo-1414235077428-338989a2e8c0. Illustrative stock, not family photos.
