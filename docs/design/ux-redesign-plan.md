# Private Family OS — UX and frontend redesign proposal

## Superseding revision: compact workspace + first-class AI
User review rejected large banners and AI hidden in settings. Current prototype uses five primary destinations: Home, Family AI, Memories, Family and My Vault. Both desktop and mobile prioritize first-fold main sections, compact recent rows and visible AI access. Advanced provider settings remain secondary, but agent selection, questions and access controls are directly reachable. This correction supersedes conflicting information-architecture and visual statements below. See `design-preview/README.md` and the revision-2 prototype/tests.

Status: proposed; approval required before implementation. Scope: full information architecture, interaction design and responsive frontend. No backend permissions or existing data are to be changed by this design work.

## Evidence and limitations
Reviewed README.md, app/page.jsx, app/page.css, package.json and prior household-onboarding session. This is a source-code audit, not a live visual or authenticated end-to-end audit.

- Supabase authentication and household creation have real integrations.
- Family content, chat, agents and much of their behavior are seeded/local React state, not durable production functionality.
- Seven top-level destinations overlap: Today, Family Space, My Vault, People, Timeline, Library, Agent Studio.
- At <=600px the sidebar disappears without replacement navigation; search input also disappears.
- My Vault currently receives the same query-filtered mixed seed dataset as Library, rather than a vault-specific dataset. This is a prototype presentation flaw, not evidence of a database access breach.
- The home screen leads with AI setup and technical explanations rather than family content.
- Some controls only display toasts or have no handlers; simulated source connections say Connected.
- Household lookup errors still render the create-household form. The redesign must distinguish lookup failure from a verified absence of membership.
- The account identity and family profiles are hardcoded. Do not infer actual members or access from seed content.

## Product intent
A calm place to save, find and share family memories, with private personal storage and optional, explicitly permissioned AI assistance. Primary repeated tasks: save something; find something; share with the intended people. Do not turn this memory product into an unrelated household task manager.

## Proposed information architecture
Four persistent primary destinations:
1. Home: relevant family updates, recent memories and one contextual next action. Empty households receive a first-memory action, not sample activity. Reminders only appear when backed by real data.
2. Memories: combine Library and Timeline. Toggle browse/timeline; search and filter by person, type or date. Scope clearly identifies the accessible shared collection.
3. Family: shared conversation, members and person profiles. Access management is contextual; membership and space access remain distinct.
4. My Vault: visibly separate private personal collection, explicitly queried by authorized private space. Sharing opens a recipient/space review, never silently changes visibility.

Account/settings: profile, household, privacy/access, notifications and Family AI. Agent Studio becomes advanced AI settings rather than a competing everyday destination. AI can also be reached contextually from an item or approved collection.

Mobile: labeled bottom navigation, reachable Add action, accessible search. Tablet/desktop: restrained labeled sidebar, same terminology and content hierarchy. Do not hide essential capabilities at small widths.

## Core flows
### Entry
Welcome -> sign in/create account -> email confirmation if required -> check household -> existing household or focused household creation -> first-memory invitation.
Separate loading, network failure, retry and genuinely empty membership states. Preserve submitted values. Show actual completion rather than an invented step counter. Add password recovery as a separately implemented auth flow.

### Save
Add -> select photo/video/file, record voice, or write a note -> review -> save.
Review makes destination and actual audience prominent. Default global capture to My Vault; capture from Family shows that shared destination explicitly. Person tags describe content, never grant access. Optional metadata is collapsed. AI suggestions require review and genuine backend support; saving without AI remains possible. Confirm success only after durable persistence; pending uploads show progress, retry and cancellation. Do not label mock connections or in-memory state as saved/connected.

### Find
Memories or My Vault -> search/filter -> item detail. Preserve query and scroll position on return. Item detail includes original content, date, people, source and audience; edit/share actions are contextual.

### Share/invite
Select content or space -> select intended recipients and supported access -> review exact audience -> confirm -> show actual resulting access. No private adult vault access by inheritance, relationship or person tag. Invitation sending requires its backend module; do not imply implementation through a frontend-only confirmation.

### AI
Offer relevant assistance after the user has useful content. Explain requested sources, intended purpose and destination. Consent is granular and revocable. Separate suggested, approved, processing and completed states. Show sources for AI outputs. Hide provider routing and agent configuration in advanced settings. Do not collect provider secrets in an unconnected frontend form.

## Visual direction: quiet, personal, Apple-inspired
- Use Apple app interaction principles, not a copy of Apple's marketing website or identity.
- Soft off-white backgrounds, white content surfaces, near-black typography and a restrained blue action accent. Family photos provide warmth rather than decorative gradients.
- System font stack: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif. Large clear headings, readable body text and subtle secondary labels; no editorial serif or tiny uppercase label overload.
- Starting tokens: background #F5F5F7, surface #FFFFFF, text #1D1D1F, secondary #626268, action #0066CC. Verify actual color combinations in rendered states before approval.
- Consistent rounded surfaces; restrained shadows; thin separators and generous spacing. Prefer simple lists to a card around every piece of content.
- Use a coherent licensed SVG icon set, not miscellaneous Unicode symbols. Retain text labels for primary destinations.
- Subtle translucent material only on navigation/toolbars or floating controls, with opaque fallbacks. Do not apply glass to the content layer.
- Minimum 44px web touch targets; visible keyboard focus; sufficient text contrast; accessible dialogs; reduced-motion support; no hover-only actions. Target WCAG 2.2 AA.
- Small purposeful transitions with immediate interaction feedback. Never delay a task for decorative animation.

References consulted:
https://developer.apple.com/design/human-interface-guidelines
https://developer.apple.com/design/human-interface-guidelines/materials
Apply the ux-design-laws skill and its full 20-law standard throughout.

## Phased delivery after approval
### 1. Design approval
Create isolated mobile and desktop visual prototypes for Home, Memories, item detail and Add/review, plus the navigation map and token specification. Clearly label illustrative content. Validate rendering and interaction layout before requesting visual sign-off. Do not replace the working application yet.
### 2. Foundation and connected entry flows
Refactor app/page.jsx into focused components; introduce app/components/ui, app/components/navigation, app/components/auth and app/components/onboarding. Consolidate tokens and reset in app/globals.css; replace app/page.css incrementally. Implement responsive navigation and routed destinations with refresh/back/deep-link support. Preserve lib/supabase/client.js and app/auth/callback/route.js contracts. Fix membership lookup failure UI. Verify existing auth/onboarding behavior without altering database policy.
### 3. Everyday product screens
Implement Home, Memories, Family, My Vault, item detail and capture components. Reuse one accessible item-list/detail system with explicit space scoping. Separate demo data from real authenticated use. Backend-dependent uploads, messaging, invitations and AI are separately scoped integration work; unfinished operations must not pretend to succeed.
### 4. Secondary flows and accessibility
Privacy/access, AI settings, account, empty/loading/error/success/destructive/recovery states. Keyboard navigation, dialog focus trap/return, responsive text, reduced motion, upload interruption and preserved form state.
### 5. Verification and review delivery
Run npm run lint, npm run typecheck, npm test and npm run build. Add behavior tests for navigation, capture review/audience, private/shared separation and error recovery. Check real authenticated flows with an authorized test account; no production invitations or family-data mutations without permission. Test mobile widths, tablet and desktop; verify iPad Chrome and Windows Chrome/Firefox where environments are available, explicitly report anything not tested. Publish only after authorized deployment, read back the deployed target and verify the stable preview before claiming it works.

## Design review acceptance gates
- Every screen/section has one clear primary purpose and action.
- Navigation, wording and components are familiar and consistent across devices.
- Information is grouped with clear hierarchy and restrained visual noise.
- Controls have adequate hit areas, spacing, labels and contextual placement.
- Loading, empty, success, errors, destructive actions and recovery are designed.
- Multi-step flows show real progress and preserve/resume work safely.
- Completion confirms what actually happened and supplies a clear next step.
- All four main destinations are reachable on mobile; search remains available.
- Audience is visible before every save/share; tags never imply permission.
- No sample family activity, simulated AI output or client-only save is represented as live behavior.

These are proposed gates, not passed test results. App implementation and visual prototypes have not started.
