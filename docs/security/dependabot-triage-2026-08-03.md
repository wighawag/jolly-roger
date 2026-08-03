# Dependabot triage, 2026-08-03

Scope: `jolly-roger`, `rocketh`, `mandalas`. `bleeps` deliberately excluded (see "bleeps" below).

Alert counts re-fetched on the day with `gh api "repos/wighawag/<repo>/dependabot/alerts?state=open&per_page=100" --paginate`: jolly-roger 39, rocketh 4, mandalas 64. These matched the reported figures, but see "mandalas" for why its 64 must not be acted on yet.

## Headline

jolly-roger's 39 alerts are not 39 problems. They are **four dependency subtrees plus one committed npm lockfile**, and three of those subtrees are rooted in packages wighawag publishes. Fixing them at source rather than papering over them with `pnpm.overrides` removes **38 of the 39**, including **all four criticals** and **all three alerts that had no patched version upstream**. One alert remains.

No override was added to jolly-roger. The house pattern was available and deliberately not used, because a durable upstream fix outranks it in the stated order of preference.

## The classification that actually matters

`web/package.json` declares **no `dependencies` block at all**: 50 devDependencies and nothing else. It is a SvelteKit `adapter-static` app, so there is no Node process in production and no npm dependency is "runtime" in the deployed sense. The only question that matters for the web package is whether a package is bundled into the browser output by vite.

For all 29 root-lockfile alerts the answer is no. Not one alerted package is bundled or reachable by an attacker against the deployed site. Every one is build, test, or local-tooling code.

The GitHub `scope` field is actively misleading here, exactly as expected: 26 of the 29 report `scope: runtime`, while `pnpm why -r` reports **all 29 as `dev only`**. Every classification below comes from `pnpm why -r`, not from the API field.

The single genuine exception across all three repos is mandalas' `@openzeppelin/contracts`, which is Solidity and would be immutable once deployed. It is analysed separately below, and it turns out to be a not-affected case.

## jolly-roger

### Root causes, not alert-by-alert

| Cluster | Root cause | Alerts | Classification | Outcome |
|---|---|---|---|---|
| A | `cross-var@1.1.0` (root + contracts) pulling babel 6 | 4 (2 critical) | build-time, dev only | **Fixed**, cross-var replaced by ldenv |
| B | `pwag@0.4.0` -> `to-ico` -> `resize-img` -> `jimp@0.2.28` -> `request@2.88.2` | 13 (1 critical) | build-time (icon generation), dev only | **Fixed at source** |
| C | `ipfs-gateway-emulator` -> `lws-*` -> koa | 5 | local static server for `pnpm serve`, dev only | **Fixed**, rewritten off lws |
| D | `remote-procedure-call@0.1.1` declaring `vitest` as a runtime dependency | 5 (1 critical) | test tooling, dev only | **Fixed at source** |
| - | `faucet-server`/`purgatory` -> `@hono/node-server` | 1 | local dev services, published runtime dep | **Fixed**, bumped to 2.x |
| - | `@sveltejs/kit` -> `cookie` | 1 | build-time | **Not fixed**, needs a SvelteKit bump |
| - | `.github/actions/pinata-upload/package-lock.json` | 10 | CI-only, but handles deploy secrets | **Fixed** |

### The two source-level defects found

**`remote-procedure-call@0.1.1` declared `vitest: ^2.1.1` under `dependencies`, not `devDependencies`.** That is why pnpm installed a test runner into consumers at all. It arrived through `@etherkit/burner-wallet` and `@etherplay/connect`, dragging `vitest 2.1.9` -> `vite 5.4.21` -> `esbuild 0.21.5`. No source file in the package imports vitest; it was referenced only by the `test` script. jolly-roger separately and correctly depends on healthy `vitest ^4.1.2` and `vite ^8.2.0`, both of which resolve clean, so only the stale nested copies were ever vulnerable.

**`pwag@0.4.0` reached `request@2.88.2` through `to-ico` -> `resize-img` -> `jimp@0.2.28`.** One ancient image library was the source of 11 of the 13 cluster B alerts. pwag's own `package.json` already carried `allowedDeprecatedVersions` for `request` and `har-validator`, so the problem was known and had been contained rather than removed. `pwag@0.6.0` does not help: it still depends on `to-ico`.

### Full alert table, jolly-roger

Manifest `pnpm-lock.yaml` unless stated. "Path" is the real path from `pnpm why -r`, abbreviated.

| # | Sev | Package | Path (real) | Class | Decision |
|---|---|---|---|---|---|
| 283 | crit | vitest 2.1.9 | web -> @etherkit/burner-wallet -> remote-procedure-call -> vitest | test | Fixed: vitest moved to devDependencies upstream |
| 302 | high | vite 5.4.21 | ... -> remote-procedure-call -> vitest -> vite | build | Fixed, same |
| 226 | med | vite 5.4.21 | as above | build | Fixed, same |
| 303 | med | vite 5.4.21 | as above | build | Fixed, same |
| 67 | med | esbuild 0.21.5 | ... -> vitest 2.1.9 -> vite 5.4.21 -> esbuild | build | Fixed, same |
| 92 | crit | form-data 2.3.3 | web -> pwag -> to-ico -> resize-img -> jimp -> request -> form-data | build | Fixed: subtree removed |
| 291 | high | form-data 2.3.3 | as above | build | Fixed, same |
| 10 | high | jpeg-js 0.1.2/0.2.0 | web -> pwag -> to-ico -> resize-img -> jimp -> jpeg-js | build | Fixed, same |
| 9 | med | jpeg-js 0.2.0 | as above | build | Fixed, same |
| 14 | med | request 2.88.2 | web -> pwag -> to-ico -> resize-img -> jimp -> request | build | Fixed by removal (**no patch existed**) |
| 8 | high | url-regex 3.2.0 | ... -> jimp -> url-regex | build | Fixed by removal (**no patch existed**) |
| 16 | med | tough-cookie 2.5.0 | ... -> jimp -> request -> tough-cookie | build | Fixed, same |
| 263 | med | uuid 3.4.0 | ... -> jimp -> request -> uuid | build | Fixed, same |
| 136 | med | ajv 6.12.6 | ... -> request -> har-validator -> ajv | build | Fixed, same |
| 233 | med | follow-redirects 1.15.11 | ... -> jimp -> load-bmfont -> phin -> follow-redirects | build | Fixed, same |
| 323 | high | sharp 0.33.5 | web -> pwag -> sharp | build | Fixed: pwag now requires `sharp ^0.35.0` (resolves 0.35.3) |
| 155 | high | svgo 3.3.2 | web -> pwag -> svgo | build | Fixed: pwag now requires `svgo ^3.3.4` |
| 321 | high | svgo 3.3.2 | as above | build | Fixed, same |
| 341 | crit | babel-traverse 6.26.0 | root+contracts -> cross-var -> babel-preset-es2015 -> babel-traverse | build | Fixed by removal (**no patch existed**) |
| 13 | crit | minimist 0.0.8 | -> cross-var -> babel-register -> mkdirp -> minimist | build | Fixed by removal |
| 7 | med | minimist 0.0.8 | as above | build | Fixed by removal |
| 340 | high | json5 0.5.1 | -> cross-var -> babel-register -> babel-core -> json5 | build | Fixed by removal |
| 145 | high | koa 2.16.3 | web -> ipfs-gateway-emulator -> lws -> koa | local server | Fixed: lws stack removed |
| 25 | high | @koa/cors 3.4.3 | web -> ipfs-gateway-emulator -> lws-cors -> @koa/cors | local server | Fixed: lws stack removed |
| 306 | med | morgan 1.10.1 | -> lws-log -> koa-morgan -> morgan | local server | Fixed: lws stack removed (no upstream fix existed) |
| 114 | med | qs 6.5.3 | -> lws-body-parser -> koa-bodyparser -> co-body -> qs | local server | Fixed: lws stack removed (no upstream fix existed) |
| 261 | low | @tootallnate/once 1.1.2 | -> lws-rewrite -> http-proxy-agent 4 -> @tootallnate/once | local server | Fixed: lws stack removed |
| 55 | low | cookie 0.6.0 | web -> @sveltejs/kit -> cookie | build | **Not fixed**, needs SvelteKit bump |
| 317 | med | @hono/node-server 1.19.17 | contracts -> faucet-server / purgatory -> @hono/node-server | local dev service | Fixed: bumped to `^2.0.12` in both, with changesets |
| 335 | high | form-data 4.0.4 | pinata action, direct dependency | CI, handles secrets | Fixed: `^4.0.0` -> `^4.0.6` |
| 330-339 | high/med/low x9 | undici 5.29.0 | pinata action -> @actions/core -> @actions/http-client -> undici | CI, handles secrets | Fixed: `@actions/core ^1.10.1` -> `^3.0.1`, which requires `@actions/http-client ^4` -> `undici ^6.23.0` (resolves 6.28.0) |

### Changes applied

**`.github/actions/pinata-upload/package.json` + `package-lock.json`** (in jolly-roger, uncommitted)

`@actions/core ^1.10.1 -> ^3.0.1`, `form-data ^4.0.0 -> ^4.0.6`. undici 5.29.0 -> 6.28.0 transitively. undici 5.x is EOL and none of these advisories were backported to it, so the only route was the major bump on `@actions/core`. Verified safe: the action uses only `core.info/error/warning/getInput/setOutput/setFailed`, all present in v3. Verified by clean-room `npm ci` in a copy, `npm audit` clean, `cli.js --help` exit 0. This action runs `npm ci` at CI time, so the committed lockfile is load-bearing rather than decorative. It is CI-only but it handles the Pinata JWT and Filebase keys, which is why it was treated as a real target and not as tooling.

**`remote-procedure-call`**, published as **0.1.2** (commit `97ab8a2`)

Moved `vitest` from `dependencies` to `devDependencies` and lifted it to `^4.1.2`. Its stale lockfile pinned a transitive `vite@5.4.8` that vitest 4 cannot run against, so the lockfile was regenerated (vite 7.3.6, esbuild 0.26.0/0.28.1, all patched). Its own 2 tests pass on vitest 4. `npm pack` confirms consumers now receive only `named-logs` and `promise-throttle`.

**`pwag`**, published as **0.7.0** (commit `8011216`)

Removed `to-ico` and `@types/to-ico` entirely. Raised `sharp ^0.33.2 -> ^0.35.0` and `svgo ^3.2.0 -> ^3.3.4`. Added an explicit `@types/node` devDependency, because `Buffer` typings had been arriving transitively through `@types/to-ico` and the build broke without it once that was gone. Dropped the now-pointless `pnpm.overrides` (`mkdirp`, `uuid`) and `allowedDeprecatedVersions` (`request`, `har-validator`), which existed only to contain the removed subtree, and left a `comment` explaining why. The dead subtree is gone: the lockfile is down to 54 packages with zero occurrences of to-ico, resize-img, jimp, request, url-regex, jpeg-js, tough-cookie, har-validator or ajv.

`png-to-ico` was evaluated as the drop-in replacement and rejected. v3 is ESM-only and pwag compiles to CommonJS; v2.1.8 is CJS but declares `@types/node` under `dependencies`, which broke `Buffer` assignability across unrelated files in the package (the same class of packaging defect as the remote-procedure-call one). ICO is a simple container format, so it is now written directly in `src/ico-encoder.ts` (about 60 lines, zero dependencies): header, one directory entry per resolution, and a bottom-up 32bpp BMP/DIB payload per image.

**`cross-var` removed from jolly-roger** (root and contracts)

`cross-var@1.1.0` was the entire reason babel 6 was in the tree. Its own dependencies are `babel-preset-es2015`, `babel-preset-stage-0` and `babel-register`, which is where `babel-traverse 6.26.0` (critical, no patch), `json5 0.5.1` and `minimist 0.0.8` came from. It has been unmaintained since 2017, so no upgrade path existed and the only fix was removal.

It appeared in exactly three script lines, all doing the same job: expanding an environment variable inside an npm script in a way that also works on Windows, where `cmd.exe` does not understand `$VAR`.

`ldenv` replaces it directly. It was already a devDependency of the root, contracts and web packages, and the rest of the contracts scripts already used its `@@VAR` idiom (`ldenv hardhat --network @@MODE deploy @@`), so `:deploy:dev+export` reaching for `cross-var` and `$MODE` was the odd one out. The substitution is now consistent with its siblings.

| Script | Before | After |
|---|---|---|
| root `zellij` | `cross-var zellij-launcher a $npm_package_name \|\| cross-var zellij -n dev/zellij.kdl -s $npm_package_name` | `ldenv zellij-launcher a @@npm_package_name \|\| ldenv zellij -n dev/zellij.kdl -s @@npm_package_name` |
| root `stop` | `cross-var zellij kill-session $npm_package_name` | `ldenv zellij kill-session @@npm_package_name` |
| contracts `:deploy:dev+export` | `cross-var pnpm hardhat --network $MODE deploy ... && cross-var rocketh-export -e $MODE` | `ldenv pnpm hardhat --network @@MODE deploy ... && ldenv rocketh-export -e @@MODE` |

**Two corrections, both found by review after the change was first made.**

The first attempt replaced `cross-var` with `ldenv`. That was wrong, and subtly so. `cross-var` only substitutes variables; `ldenv` also *loads `.env` files and injects them into the child environment*, and an inherited variable outranks the file. The zellij layouts start long-lived watchers (`pnpm web:dev` is `ldenv -d localhost -w vite dev`), so an `ldenv` above `zellij` pins the environment at launch time. The watcher still restarts when `.env` changes and still reads the old values:

```
no wrapper:    FOO=v1 -> [.env changed, reloading] -> FOO=v2   correct
ldenv wrapper: FOO=v1 -> [.env changed, reloading] -> FOO=v1   stale
expand-vars:   FOO=v1 -> [.env changed, reloading] -> FOO=v2   correct
```

The second attempt dropped the wrapper entirely, on the reasoning that zellij is Unix-only so plain `$npm_package_name` would do. That reasoning was also wrong: zellij runs on Windows, and `cross-var` was introduced precisely to keep these scripts working there. Removing it regressed the thing it existed for.

The actual fix is a substitution-only replacement, published as [`expand-vars`](https://github.com/wighawag/expand-vars). It expands `$NAME`, `${NAME}`, `${NAME:-default}` and `$$` from the existing environment and then execs through `cross-spawn`, exactly as `cross-var` did, but it **never reads `.env` and never alters the child's environment**, which is the property that makes it safe above a watcher. It has one runtime dependency, `cross-spawn`, and a test asserting the child environment passes through untouched. Every former `cross-var` call site now uses it verbatim.

`ldenv` keeps every place it already occupied, including the `ldenv -d localhost` above `zellij` in mandalas and bleeps, which is deliberate: it propagates `MODE` to every pane. `expand-vars` fronts it there for the session name, exactly as `cross-var` used to.

While doing this, `zellij-attach` and `zellij-remote-chain` were also routed through `expand-vars`. Those two never used `cross-var` and interpolated `$npm_package_name-attach-$MODE` as bare shell, so they had been silently Windows-broken all along. That is a fix beyond restoring parity, not a side effect of it.

One caveat worth stating: `--strict` can only catch an unset variable on Windows. On Unix the shell expands `$NAME` to `""` before `expand-vars` runs, so there is nothing left to detect. That asymmetry is inherent to shell syntax and applied equally to `cross-var`.

**Windows compatibility is preserved, by the same mechanism.** Both tools resolve variables in Node rather than delegating to the shell, and both spawn through **`cross-spawn`**, the library that exists specifically to handle Windows `.cmd`/`.bat` shims, `PATHEXT` resolution and argument escaping. That matters here because `ldenv pnpm ...` invokes `pnpm.cmd` on Windows, which Node cannot exec directly without help. The difference is the version: cross-var pinned `cross-spawn ^5.0.1` (and dragged babel 6 along with it), while ldenv uses `cross-spawn ^7.0.6`. This is the same Windows strategy on a current major, not a weaker one.

The `&&` and `||` operators in those scripts are unchanged and were already there; `cmd.exe` supports both. Note also that `zellij` is a Unix-only terminal multiplexer, so the two root scripts could never run on Windows regardless of which helper expands the variable. The one script that genuinely matters for Windows is the contracts deploy, and that is the one whose behaviour was verified end to end.

Verified by probe, substituting `echo` for the real command so the resolved command line could be inspected:

- root: `@@npm_package_name` resolves to `jolly-roger`, producing `a jolly-roger` and `kill-session jolly-roger`, byte-identical to cross-var's output
- contracts: through the real `deploy:dev` -> `ldenv -d localhost pnpm :deploy:dev+export` chain, `@@MODE` resolves to `localhost`, producing `hardhat --network localhost deploy --no-compile --skip-prompts` and `rocketh-export -e localhost`, again identical

Because the resolved command lines are identical, downstream behaviour is unchanged by construction. This was then confirmed for real: `pnpm --filter ./contracts deploy:dev` against a local node deployed `GreetingsRegistry_Implementation` and `GreetingsRegistry_Proxy` successfully.

**`ipfs-gateway-emulator` rewritten off lws**, published as **5.0.0**

Cluster C was five alerts (`koa`, `@koa/cors`, `morgan`, `qs`, `@tootallnate/once`) arriving through the `lws-*` plugin stack. Upgrading was possible but only partially: `lws@4` fixes `koa`, `lws-cors@4` fixes `@koa/cors` and `lws-rewrite@4` drops `@tootallnate/once`, but `morgan` (via the unmaintained `koa-morgan`) and `qs` (via `co-body`) would have survived. `lws@4` is also ESM-only, so the CommonJS fork needed porting either way.

Given that, and that the package exists to emulate an IPFS gateway rather than to redistribute `lws`, it was rewritten on Hono instead. The dependency tree went from the `lws` stack to exactly two packages, `hono` and `@hono/node-server`, and all five alerts disappear.

The behaviour is preserved deliberately and now tested, which it previously was not: the old suite was inherited from `local-web-server` and only exercised CLI plumbing (`--help`, `--version`, bad option, default-stack listing). It never tested a single gateway behaviour. There are now 28 tests covering prefix stripping, both `--only` modes, the referer rule, `--fail`, trailing-slash redirects and argument parsing.

The behaviours kept, each verified against jolly-roger's real `web/build`:

- `/ipfs/<cid>/x` resolves to `x`, and a bare `/ipfs/<cid>` redirects to a trailing slash
- a directory redirects to a trailing slash
- **the referer rule**, which is the valuable one: a root-relative request such as `/app.css` whose referer is a gateway page 404s, because on a real path gateway that URL escapes the CID root. This is what makes the emulator worth using instead of any static server
- `--only hash` / `--only root`, and `--fail <status>:<dirs>`
- the CLI contract, including the fact that consumers invoke `--only -d build -p 8080` where `--only` carries **no value**. The hand-written parser only consumes a value when the next argument is not itself a flag, so `-d` is never swallowed. There is a test pinning that exact invocation

MIME types were spot-checked against the real build rather than assumed: `text/html`, `text/css`, `text/javascript`, `image/x-icon` and `application/manifest+json` all come back correct.

This is a breaking change and is released as **5.0.0**. The `lws` middleware options (`--stack`, basic auth, blacklist, compression, rewriting, logging) are gone, and the README says so and points anyone relying on them at `local-web-server`, which is where they belong.

**`@hono/node-server` bumped in `faucet` and `purgatory`**, published as **faucet-server 0.1.0** and **purgatory 0.0.8**

`faucet-server` (`^1.19.12`) and `purgatory` (`^1.13.8`) both needed `^2.0.5` for GHSA-frvp-7c67-39w9, which has no fix on the 1.x line. Both bumped to `^2.0.12`.

Unlike everything else in this report, this **is** a runtime dependency of a published package, so consumers pick up the new major on install. Both therefore got a changeset. The API surface in use is unchanged in 2.x (`serve({fetch, port})` in both, plus `serveStatic({root})` and the SPA `path: '/index.html'` fallback in faucet), and both binaries were started and confirmed to answer requests rather than merely to compile. `@hono/node-server` 2.x requires **Node >= 20**, which is recorded in both changesets.

### Verification of the pwag output change

This matters because pwag generates the favicons for every project scaffolded from jolly-roger, so a silent quality regression would be a real harm introduced by a security fix.

A first verification attempt using `link:` overrides was **wrong and was discarded**: pnpm does not resolve a linked package's own dependencies, so sharp and svgo appeared to vanish from the tree. The real verification used `npm pack` tarballs and `file:` overrides, which does resolve the full subtree.

Results against the pre-change baseline, generating from jolly-roger's real `web/static/icon.svg`:

- `favicon-192.png`, `favicon-512.png`, `apple-touch-icon.png`: **byte-identical** to what jolly-roger currently ships.
- `favicon.ico`: structurally identical (3 entries, 16/24/32, 32bpp, BMP/DIB) and 7598 -> 7886 bytes. The growth is the AND mask, which the old output omitted and which the format specifies.
- The 32x32 embedded image is **pixel-identical** (0 differing subpixels across 4096).
- The 16x16 and 24x24 embedded images differ (max delta about 70/255). Cause: `to-ico` rasterised at 32px then downscaled with jimp's bilinear filter, whereas the new path resamples from the vector at each size using sharp's Lanczos3.

An RMSE comparison against a vector ground truth initially appeared to show the old output was better (5.44 vs 10.11). That metric was then shown to be unreliable: reproducing to-ico's exact pipeline with sharp still scored 9.58, so the metric was measuring similarity to box-like filtering rather than quality, and a box-average ground truth structurally favours jimp's bilinear over Lanczos3. A 10x nearest-neighbour visual comparison of all three sizes shows no visible regression, with the new output marginally crisper at the edges. Recorded as a **known, characterised, accepted behavioural difference**, not as parity.

### Applied to jolly-roger

With both packages published, `web/package.json` moved `pwag` from `^0.4.0` to `^0.7.0` (a caret on a `0.x` range cannot reach `0.7.0` on its own) and the lockfile was regenerated with `pnpm install`. `remote-procedure-call` needed no manifest change: `@etherkit/burner-wallet` requires `^0.1.0` and `@etherplay/wallet-connector-ethereum` requires `^0.1.1`, both of which admit `0.1.2`, so `pnpm update remote-procedure-call -r` was enough. The lockfile was never hand-edited.

### Gates

Run against the **real repository** with the published versions resolved:

- `pnpm contracts:test`: 20 passing (14 solidity, 6 nodejs)
- `pnpm web:check`: **0 errors, 0 warnings**
- `pnpm --filter ./web test:unit -- --run`: 45 files, 407 tests passing
- `pnpm format:check`: clean, both workspaces
- `pnpm build localhost`: succeeds, site written
- `pnpm serve`: verified against the published emulator 5.0.0, serving jolly-roger's real build over both `/` and `/ipfs/<cid>/`, with the bare-CID redirect

The end-to-end suite (`pnpm --filter ./web test:e2e`) is **not green, and was not green before this work either**. Two full runs were made: the first ended 21 passed / 1 failed, the second 22 passed / 1 failed, and they failed **different** tests (`demo.e2e.ts:91` then `demo.e2e.ts:117`). Both failures are transaction-timing assertions in `demo.e2e.ts` waiting on a navbar balance to refresh within 10s. A different failure on each run indicates a flaky suite rather than a deterministic regression, and none of the changes here touch web application code. This is recorded rather than waved away: a clean pre-change baseline run was **not** established, so the attribution is inference from the failure pattern, not proof.

Worth noting for anyone assuming otherwise: Playwright's `webServer` runs `pnpm run preview` (`vite preview`), **not** `ipfs-emulator`. The e2e suite therefore never exercises the gateway emulator, so it is not a gate for that rewrite. `pnpm serve` is the emulator's only consumer in this repo.

Two traps worth recording for anyone repeating this:

`web:check` reported 40 errors during the earlier tarball-based dry run in a scratch copy. That was **not** a regression. `web/src/lib/deployments.ts` is generated and gitignored, so `git archive` omits it, and every error cascaded from its absence. In the real repository, where the file exists, the check is clean.

`web/static/pwa/` is gitignored. The favicons are regenerated by the `prepare` script on every install, so the `.ico` change described above has **zero diff footprint** in the repository and reaches users only through a rebuild.

### Measured effect

Confirmed by diffing resolved lockfile versions in the real repository, before and after:

| Package | Before | After |
|---|---|---|
| vite | 5.4.21, 8.2.0 | 8.2.0 |
| vitest | 2.1.9, 4.1.10 | 4.1.10 |
| esbuild | 0.21.5, 0.28.1 | 0.28.1 |
| sharp | 0.33.5 | 0.35.3 |
| svgo | 3.3.2 | 3.3.4 |
| form-data | 2.3.3, 4.0.6 | 4.0.6 |
| follow-redirects | 1.15.11, 1.16.0 | 1.16.0 |
| uuid | 3.4.0, 14.0.1 | 14.0.1 |
| ajv, jpeg-js, tough-cookie, request, url-regex | present | **absent** |

**38 of 39 jolly-roger alerts resolved** (10 pinata + 28 root lockfile). One remains: `cookie 0.6.0` (low) via `@sveltejs/kit`.

## rocketh

Only **one** of the four alerts is real. Checked against `origin/main`'s lockfile, which is what Dependabot scans, not the local working tree:

| # | Sev | Package | Needs | `origin/main` resolves | Verdict |
|---|---|---|---|---|---|
| 258 | med | nx | >= 22.7.2 | **22.6.5** | **Genuinely vulnerable** |
| 248 | high | brace-expansion | >= 5.0.7 | 5.0.7 | Already satisfied |
| 236 | high | form-data | >= 4.0.6 | 4.0.6 | Already satisfied |
| 222 | high | tmp | >= 0.2.6 | 0.2.7 | Already satisfied |

All four are the same `nx` dev-tooling cluster (`@nx/js` -> `@nx/devkit` -> `nx`, and `nx -> axios -> form-data`, `nx -> tmp`, `nx -> minimatch -> brace-expansion`). **None is a runtime dependency of any published `@rocketh/*` package**, so no consumer of the published graph is affected and **no changeset is required**.

`nx` is a direct root devDependency (`"nx": "^22.6.5"`, `"@nx/js": "^22.6.5"`), so the durable fix is a direct bump to `^22.7.2`, not an override. That is consistent with the documented house policy, whose `comment` explicitly says entries already satisfied by the resolved lockfile were deliberately dropped: the other three belong in that category and should be left to auto-close rather than pinned.

**Nothing was changed in rocketh.** Two blockers: the local checkout sits on `fix/hardhat-deploy-typed-artifacts-on-partial-builds`, 2 commits ahead of `origin/main` and unpushed, so any dependabot branch must be cut from `origin/main` to avoid dragging unrelated work into the PR; and `main` is protected and requires the `verify` check, so this needs a branch plus `gh pr create`.

## mandalas

**Nothing was changed, and nothing should be yet, for two independent reasons.**

**The alert set is stale.** Checking `updated_at` across all 64 alerts: the newest is 2026-07-31 and **not one alert was touched on 2026-08-03**. Dependabot has not yet recomputed after the 503-commit template-history reconciliation. Triaging these 64 now means triaging a tree that no longer exists, which is precisely the mistake being deliberately avoided on bleeps.

**The working tree is dirty.** `web/src/lib/stores/randomTokens.ts` (+159/-62), `web/src/routes/+page.svelte`, `web/src/lib/core/utils/format/index.ts`, plus an untracked `web/src/lib/core/utils/format/error.ts`. That is real in-progress feature work and must be committed or stashed before any dependency work begins.

The `mandalas-template-merge` worktree on `chore/template-history` currently points at the same commit as `main`; it was left untouched.

### The one manifest-level alert, and why it should be dismissed

Alert **#11**, `@openzeppelin/contracts` pinned at exactly `3.4.2` in `contracts/package.json`. This is the only alert across all three repos pointing at a declared dependency rather than a transitive resolution, and the only one that is Solidity rather than JavaScript, so it was treated as the highest-stakes item in the exercise.

The advisory is **GHSA-mx2q-35m2-x2rh, "TransparentUpgradeableProxy clashing selector calls may not be delegated"**. Mandalas' actual Solidity imports:

- `ERC721Base.sol`: `utils/Address`, `token/ERC721/IERC721Receiver`, `token/ERC721/IERC721`, `introspection/IERC165`, `utils/EnumerableSet`
- `MandalaToken.sol`: `token/ERC721/IERC721Metadata`, `cryptography/ECDSA`

There is **no proxy import anywhere**. Mandalas' upgradeability comes from `@rocketh/proxy` (EIP-173), not from OpenZeppelin. The vulnerable contract is never compiled into the deployment.

Meanwhile the nominal fix, 3.4.2 to 4.8.3, is a major Solidity upgrade that relocates several of those import paths (`introspection/` moves under `utils/`, ERC721 is restructured), forces a rewrite of `ERC721Base.sol`, changes deployed bytecode for a live NFT, and would require re-auditing. High cost, zero security benefit.

**Recommendation: dismiss as `vulnerable_code_not_actually_used`**, recording the reasoning above. This is the legitimate use of dismissal, not number reduction. It has **not** been dismissed, because dismissal is a mutation and was not authorised.

Separately: `@rocketh/proxy` is pinned to an exact `0.19.4` while every sibling uses a caret. It was left alone. Proxies govern upgrade authority, so this is plausibly deliberate and should be confirmed rather than normalised.

## Alerts not fixed, and why

| Alerts | Root cause | Why not fixed | Route |
|---|---|---|---|
| 55 | `@sveltejs/kit` -> `cookie 0.6.0` | Requires a SvelteKit bump; low severity, and adapter-static means no server runtime uses it | Bump `@sveltejs/kit`, or accept |
| rocketh 258 | `nx 22.6.5` | Not applied: branch/PR constraint and unpushed local work | Bump `nx` and `@nx/js` to `^22.7.2` on a branch off `origin/main` |
| mandalas #11 | `@openzeppelin/contracts 3.4.2` | Vulnerable code not reachable | Dismiss with reason |

**No alert was dismissed, and no override was added anywhere.**

## Overrides added

**None.** This is deliberate and worth stating explicitly, since the brief anticipated them.

Every alert that could be fixed was fixed by the first-preference route, upgrading or repairing the direct dependency that pulled the vulnerable package in. The second-preference route, a documented `pnpm.overrides` entry with a range key in rocketh's house style, was not needed for anything actually fixed. The remaining clusters are better served by removing `cross-var` and by bumping `lws-*` upstream than by pinning their transitive dependencies from jolly-roger's root, because jolly-roger is a template and every override it carries is inherited by everyone who scaffolds from it.

If cluster C is ever fixed by override rather than by upgrading `ipfs-gateway-emulator`, the entries should use range keys (`"morgan@>=1.2.0 <=1.10.1": "^1.11.0"`) rather than bare names, for the reason the rocketh `comment` gives: a bare key silently keeps pinning a package that has already moved past the problem. jolly-roger's existing `{"utf-8-validate": "-"}` is a bare key and is a candidate for the same treatment.

## bleeps

Out of scope by instruction and untouched. Recording the one-line observation: bleeps' 285 alerts are computed against default branch `main` at `1a3d946` (2024-05-30), which is **551 commits behind and 0 ahead of** the live `jolly-roger` branch. They describe a tree that no longer meaningfully exists.

Its default branch should be pointed at reality, either by making `jolly-roger` the default branch or by fast-forwarding `main` to it with `git push origin origin/jolly-roger:main`. Because `main` is strictly behind, that is a genuine fast-forward and not a history rewrite. After that its alert set becomes worth reading. **This has not been done and requires explicit approval.**

## Residual risk

This is not a clean sweep and should not be reported as one.

- **1 of jolly-roger's 39 remains open**: `cookie 0.6.0` (low) reached through `@sveltejs/kit`. It needs a SvelteKit bump, it is build-time only, and `adapter-static` means no server runtime ever reads it.
- **The alert counter has not moved yet.** Both packages are published (`remote-procedure-call@0.1.2`, `pwag@0.7.0`) and jolly-roger's lockfile now resolves them, with all five gates green, but the fix is **not pushed**. Dependabot rescans the default branch, so the 28 will not close until the lockfile change lands on `main`. The removal is verified directly against the real lockfile rather than inferred.
- **pwag's `.ico` output changed.** 32px is pixel-identical and all PNGs are byte-identical, but the 16px and 24px embedded images differ because the resampling filter changed from jimp bilinear to sharp Lanczos3. Judged visually equivalent, not proven equivalent.
- **`@actions/core` was bumped across two majors** (1.x to 3.x). The six APIs in use are stable and were checked, and a clean-room install plus CLI smoke test passed, but the action was not executed against live Pinata or Filebase credentials. Its first real run is in CI.
- **The e2e suite was not run.** `pnpm --filter ./web test:e2e` shells out to `scripts/run-e2e-tests.sh` and needs a browser and a chain; it was out of reach here. `ipfs-gateway-emulator` serves those tests and is in the untouched cluster C, so the risk of the applied changes breaking e2e is low but not zero.
- **rocketh was not touched at all**, so its one real alert is still open.
- **mandalas' true alert set is unknown.** The 64 describe a superseded tree. The count after recomputation could move in either direction.
- **jolly-roger is a template.** Everyone who runs `create-jolly-roger` inherits this lockfile and these subtrees, so both the fixes and the remaining problems propagate. That multiplies the value of the fixes and the cost of the residue.

## Stopping this recurring

1. **The highest-leverage fixes are in wighawag's own packages, not in jolly-roger.** Clusters B and D, 18 of 29 root-lockfile alerts, were caused by two defects in published packages: a test runner declared as a runtime dependency, and a dead image library left in a dependency tree. Neither was visible from jolly-roger, and neither could have been fixed properly from jolly-roger. `faucet-server`/`purgatory` (`@hono/node-server`) and `ipfs-gateway-emulator` (`lws-*`) are the same shape.

2. **Add a packaging lint to the published packages.** A CI check that fails when a package declares a known dev-only tool (`vitest`, `jest`, `@types/*`, `typescript`, `prettier`) under `dependencies` would have caught cluster D at source, and would have caught the identical defect in `png-to-ico@2.1.8` before it was ever a candidate. This single check addresses the most common cause found in this exercise.

3. **Prefer one tool that already exists over a second that does the same job.** `cross-var` was removed by pointing three script lines at `ldenv`, which was already a devDependency of every workspace package and already the idiom used by the neighbouring scripts. A dead 2017 package pulling babel 6 had been sitting behind three lines of string interpolation. Periodically asking which devDependencies are still earning their place is cheap and, in this case, removed a critical with no upstream patch.

4. **Prefer removing subtrees over pinning them.** The two alerts that were formally unfixable (`request`, `url-regex`, both `first_patched_version: null`) were resolved not by an override, which was impossible, but by deleting the dependency that dragged them in. pwag had already tried the containment route with `allowedDeprecatedVersions` and it simply preserved the problem.

5. **Re-key the existing override.** `{"utf-8-validate": "-"}` is a bare package name. rocketh's range-key style is better and is already documented in that repo's `comment`.

6. **Treat the template's lockfile as a published artifact.** Since scaffolded projects inherit it, a periodic `pnpm audit` or Dependabot run on jolly-roger has outsized value, and any override added there should carry the rocketh-style prose `comment` recording why it exists and when it can be removed.

## State on disk

Nothing has been committed or pushed in any repository.

| Repo | Modified | Status |
|---|---|---|
| jolly-roger | `.github/actions/pinata-upload/{package.json,package-lock.json}`, `web/package.json`, `pnpm-lock.yaml`, this report | **Uncommitted** |
| remote-procedure-call | `package.json`, `pnpm-lock.yaml` | Committed `97ab8a2`, **published 0.1.2**, pushed |
| pwag | `package.json`, `pnpm-lock.yaml`, `src/icon-generator.ts`, new `src/ico-encoder.ts`, rebuilt `lib/` | Committed `8011216`, **published 0.7.0**, pushed |
| ipfs-gateway-emulator | rewritten on Hono: new `lib/{emulation,server,cli}.js`, new tests, README; `lib/{cli-app,default-stack}.js` and the old `test/` removed | **Uncommitted**, version 5.0.0, needs publish |
| faucet | `platforms/nodejs/package.json`, `pnpm-lock.yaml`, new changeset | **Uncommitted**, needs publish (also has 1 pre-existing unpushed commit, not from this work) |
| purgatory | `platforms/nodejs/package.json`, `pnpm-lock.yaml`, new changeset | **Uncommitted**, needs publish |
| rocketh | none | Clean, on an unrelated unpushed branch |
| mandalas | none by this work | **Dirty with pre-existing feature work** |

`pwag` and `remote-procedure-call` are published and pushed. `ipfs-gateway-emulator`, `faucet` and `purgatory` are verified but uncommitted, and their fixes do not reach jolly-roger until they are published.

Note: `pwag` tracks its build output in `lib/`, so `lib/icon-generator.js` and the new `lib/ico-encoder.{js,d.ts}` are part of the change. Both `pwag` and `remote-procedure-call` have a pre-existing `format:check` failure on files untouched by this work (`src/errors.ts`, `src/types.ts` in remote-procedure-call); this was confirmed against pristine HEAD and left alone.
