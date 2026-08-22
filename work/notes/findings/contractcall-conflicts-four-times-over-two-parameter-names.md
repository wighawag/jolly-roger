---
title: contractCall.ts has conflicted four times over two parameter names, and the fix is free
type: finding
status: spotted
created: 2026-08-22
source: `git diff main with/local-signer -- web/src/routes/contracts/lib/contractCall.ts`, read in full against the replayed conflict count
---

# A rename, upstream, deletes a recurring conflict

`web/src/routes/contracts/lib/contractCall.ts` is the joint-second most conflicted file in the tree: **four conflicts across the forty-four merges `with/local-signer` carries and `main` does not**, matched only by `setGreeting.ts` and beaten only by `context/index.ts`.

Unlike `setGreeting.ts`, whose divergence is real (the variant sends `setMessageFor` through a registered delegate, which is the whole point of that variant), the entire divergence in `contractCall.ts` is two parameter names.

`main`:

```ts
export async function executeContractWrite(params: {
	connection: AnyConnectionStore<UnderlyingEthereumProvider>;
	accountExecutor: ExecutorStore;
	/** Balance of the account that executor sends from, which is what pays. */
	accountBalance: BalanceStore;
	...
```

`with/local-signer`:

```ts
export async function executeContractWrite(params: {
	connection: AnyConnectionStore<UnderlyingEthereumProvider>;
	/**
	 * Which account to send from. The contracts page is a developer tool for
	 * calling arbitrary functions, so the caller names the executor rather than
	 * this guessing one, and passes the balance that executor spends.
	 */
	executor: ExecutorStore;
	balance: BalanceStore;
	...
```

That is it. The rest of the diff is the same rename propagating through the body: `$accountExecutor` becomes `$executor`, `{balance: accountBalance, sender: ...}` becomes `{balance, sender: ...}`. No behaviour changes on either side. The function was already parameterised over which executor pays; only the parameter's NAME presumed there is one.

## Why it conflicts four times rather than once

Because the rename touches nine lines spread through a function `main` keeps editing for unrelated reasons (the refusal split, the stopped-waiting handling, the per-call balance check, the error-chain change). Every one of those upstream edits lands inside or beside a renamed line. A rename is the perfect conflict generator: maximum textual overlap, zero semantic content.

## What it costs and who pays

Four hand-resolutions so far, paid by whoever cascaded, each one requiring the resolver to read enough of the function to confirm that `accountExecutor` and `executor` are the same store under two names. That is exactly the kind of resolution where taking a whole side with `--theirs` looks safe and silently drops the upstream change, which the reconciliation skill warns about by name.

It will keep costing, because the contracts page is a developer tool that keeps growing.

## The fix

Apply the variant's rename to `main`, verbatim, including the doc comment. It is a pure rename with one call site (`routes/contracts/components/ContractFunction.svelte`, which passes `accountExecutor` and `accountBalance` from the context and would pass them as `executor` and `balance`). The comment is even MORE true on `main` than on the variant: the contracts page is a developer tool for calling arbitrary functions, so naming the executor at the call site is the right interface whether or not a second executor exists.

Price: fifteen minutes, one file plus one call site plus `test/routes/contracts/*`. Verify with `pnpm check` and `pnpm test:unit` (684 tests).

Cascade: this is a **convergence**, not a change. After it lands, the next main-into-local-signer merge sees the two sides agree on those nine lines and the file stops conflicting, permanently. It is the rarest thing in this audit: a fix whose cascade cost is negative.

`ContractFunction.svelte` itself conflicts twice and `routes/contracts/+page.svelte` twice; both are partly the same rename propagating. Backporting the rename should take those down too, though not necessarily to zero (the variant also adds an executor picker to the page, which is genuine specialisation).

## The general shape worth watching for

The variant's rename was a **generalisation, landed below its home**. Nothing about "let the caller name the executor" depends on having a local signer; it is better naming for a developer tool, full stop. `offshoot-fanout drift` exists precisely to surface these, and it would have shown this one. The reconciliation skill's rule is that a change belongs at the highest level where it is still meaningful, and a rename that makes a parameter honest is meaningful at the root. Worth a pass over the other conflict-hot files with the same question: is this side's version simply BETTER, rather than different?
