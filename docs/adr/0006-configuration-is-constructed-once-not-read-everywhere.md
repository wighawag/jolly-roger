---
status: proposed
created: 2026-08-22
---

# Configuration is constructed once at a boundary, not read wherever it is needed

`$env/static/public` is imported by exactly one module, which parses and validates every `PUBLIC_*` name and exports one frozen object. Everything else imports that object, or receives the slice it needs as a parameter. A boundary test in the shape of `framework-boundary.test.ts` holds the single-import-site rule. This is done for testability and for having one place that answers "what configures this app", NOT for framework portability, which is a benefit but not the reason.

## The pressure that produced this

Three separate symptoms with one cause.

**ADR-0001's stated consequence is already false, in the two components it names.** It says core UI components "no longer import the `$lib` app barrel; their component tests need no `$env` mocks". The first clause is true. The second is contradicted by `test/lib/core/ui/ethereum/Address.svelte.test.ts:7` and `TransactionHash.svelte.test.ts:7`, both of which begin with `vi.mock('$env/static/public', ...)`. Neither component imports `$env`; both import `blockExplorer.ts`, which does. The coupling is transitive and invisible from the component, so a test author discovers it by failure. `test/lib/context/fatal.test.ts` pays a worse version, needing `vi.doMock`/`vi.doUnmock` and a comment explaining that the module is inlined at build time.

**And that test is the one piece of evidence here that costs measurable time rather than tidiness.** Because `$env/static/public` is inlined at build, the only way to vary configuration is `vi.resetModules()` plus a fresh `await import('$lib/context/index')`, which drags in the entire app barrel: route handler, notifications, service-worker registration, the connection stack, the account store. The file carries a bespoke `IMPORT_TIMEOUT = 30_000` for exactly this, and it still times out roughly one run in eleven (`work/notes/observations/fatal-test-cold-import-timeout.md`). With configuration constructed rather than read, those three cases build three config literals and call `createContext(config)` with no `resetModules`, no `doMock` and no cold import. The flake is not mitigated, it is structurally absent. That matters more now that `pnpm --filter ./web test:unit` runs as part of the tree's `verify` command, where a one-in-ten unit flake eventually fails a cascade and sends someone hunting a merge that was fine.

**Nothing says what configures this app.** Thirteen `PUBLIC_*` names are read at nine call sites; twelve are declared in `.env`; the README's "Environment Variables" section documents four variables and all four belong to the contracts package. An adopter configuring a deployment has to grep the source to find out what to set, and a misconfiguration surfaces wherever the reader happens to be rather than at one boundary.

**A three-line identity constant has cost `website` four hand-merges.** Its entire divergence in `+layout.svelte` is `repoURL="https://github.com/wighawag/jolly-roger"` passed to `Navbar`. The prop exists, so the extension point is fine; what is wrong is that the only place to FILL it is inside the file `main` churns hardest. Configuration that has nowhere to live ends up hard-coded in a hot file.

The template already believes in this decision for half its configuration. `web/src/web-config.json` holds name, title, description, canonical URL, theme colour and icon, is read by `DefaultHead.svelte` and `+page.svelte`, and the README calls it "the single place to rebrand". Environment variables are the other half of the same story and never got the same treatment.

## This one has no home upstream, and that was checked

The stem chain (`template-svelte` -> `-tailwind` -> `-shadcn`) is ours to change too, so the home question was asked rather than assumed. Every parent imports `$env/static/public` in exactly **one** file, `routes/+layout.ts`, for exactly one variable (`PUBLIC_ENABLE_SW_IN_DEV`). That is a route, which is the framework's own surface and outside every rule here. The nine importers, the thirteen variables and the transitive test mocks are all jolly-roger's, grown here. So this decision belongs here, unlike the `core/` framework seam, whose home is the root (see ADR-0005's sequencing note).

## Considered options

- **Leave it alone; `$env/static/public` is fine.** The serious option, and it nearly wins. It is build-time inlined, tree-shakeable, type-checked by SvelteKit's generated declarations, and three mocks across 62 test files is not a crisis. Rejected on the accumulation: it is the last framework import inside `core/`, it makes a written ADR consequence false, it is the reason there is no answer to "what configures this app", and the same absence is what put a URL literal in `+layout.svelte`. Any one of those is ignorable. Together they are a seam.

- **Seal it for portability, as the `$app/*` seam was sealed.** Rejected as the JUSTIFICATION, though the shape is the same. Nobody is moving this app off SvelteKit, and a seam sold on a benefit nobody will collect gets un-sealed the first time it is inconvenient. Sealed for testability and for a single configuration manifest, it keeps paying from the first day. Portability is a side effect and should be described as one.

- **Seal every remaining framework surface for symmetry.** Explicitly rejected, and the rejections matter as much as the decision. `import.meta.env` (10 files) is **Vite**, not SvelteKit, and available in any Vite-based tool; wrapping it adds a name and an indirection to insulate the app from a dependency it will not drop, and all ten uses gate a dev warning or an HMR cleanup. Route conventions are the framework's own surface, which `kit/README.md` already argues correctly. `svelte.config.js` is not coupling but the deployment decision itself (static output, 404 SPA fallback, relative paths for IPFS, split bundles against throttled connections), and there is nothing to abstract, only something to document, which its comments already do. `$service-worker` has one importer, in a SvelteKit-designated entry file, and the interesting half is already seamed behind `ServiceWorkerEnvironment`.

- **A runtime-fetched config file (`config.json`) instead of build-time env.** Rejected: it trades a build-time constant for a network request on boot, which ADR-0002 would then have to accommodate as another async-at-construction problem, and this app deploys to IPFS where a second fetch is not free. Build-time inlining is the right mechanism; the problem is the number of places that touch it.

- **Fold the `PUBLIC_*` values into `web-config.json`.** Rejected: they are per-deployment secrets-adjacent values (node URLs, wallet host, impersonation addresses) that differ between `.env`, `.env.localhost` and CI, while `web-config.json` is committed branding that is the same everywhere. Merging them would put deployment configuration into a file every fork edits for its name and logo. They should sit side by side and be documented together, not become one file.

## Consequences

- **`$env/static/public` appears once.** That is what makes the rule enforceable in the existing style: a tracked-file list, an allow-list of one path, a stale-entry check, and a non-empty-list guard so a wrong cwd cannot make it pass vacuously.

- **Config is constructed, not read**, so a test builds an object literal and hands it over. The three `vi.mock` calls go away, `fatal.test.ts` stops needing `doMock`/`doUnmock`, and ADR-0001's sentence becomes true rather than aspirational.

- **The `kit/README.md` correction should be written once, here, rather than twice.** That README currently claims the app's behaviour does "not name SvelteKit at all", which is false while nine files import `$env`. Fixing it before this ADR lands and again after is two edits to the same sentence in the same hot file across two branches. Write it once, in the form that stays true either way: the enforced rule is that `$app/*` lives only in `$lib/kit`, configuration enters through the single module named by this ADR, and `%sveltekit.env.*%` in `app.html` is a documented exception to both.

- **`core/` loses its last framework import**, which is a real simplification of the story ADR-0005 tells, though the two decisions are independent and can land in either order.

- **Validation happens once, at construction**, so a bad value produces one message naming the variable instead of an `undefined` threading into a caller. This composes with ADR-0002's fatal-store pattern: env-derived failures resolve at construction and therefore also appear in prerendered HTML, which is exactly what that ADR says it wants.

- **`repoURL` moves into configuration**, and `website`'s only recurring conflict disappears. This is the smallest piece of the change and the one with the best return.

- **The seam cannot be total, and pretending otherwise would be the failure mode.** `PUBLIC_ERUDA_PLUGINS` is consumed by `src/app.html` through SvelteKit's `%sveltekit.env.PUBLIC_*%` placeholder, which is an HTML substitution resolved at build time and has no module to route through. It stays where it is, and the rule's allow-list has to say so out loud rather than quietly not covering it. One documented exception is fine; an exception nobody wrote down is how a rule stops meaning anything.

- **The consequence I like least: this is the only recommendation in the audit with a real cascade bill.** `with/local-signer` reads its own `PUBLIC_*` names for the signer, credits and hosted-wallet configuration, and `web/.env` has already conflicted twice. The variant has to extend the same config object rather than adding fresh direct reads, and that resolution lands in `context/index.ts`, which is already the most-conflicted file in the tree. Budget a day upstream and half a day resolving at `with/local-signer`; free at `with/hosted-account` and `website`.

- **Second thing I like least: it adds a layer of names for values that were already named.** `PUBLIC_NODE_URL` becomes `config.nodeUrl`, and a reader now has two vocabularies for one thing. That is a genuine cost and the mitigation is discipline rather than cleverness: keep the field names mechanically derived from the variable names, and let the config module's doc comment be the documentation the README currently lacks.

- **If the boundary test does not land with the change, do not make the change.** Centralising configuration without a rule that keeps it centralised buys one tidy afternoon and then decays back, one convenient direct import at a time. This repo has written down twice, in two test files, that a rule nothing checks is a wish.
