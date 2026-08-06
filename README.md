# template-svelte-shadcn

A SvelteKit template that adds the [shadcn-svelte](https://shadcn-svelte.com/) UI kit on top of `template-svelte-tailwind`.

## Where this sits

```
template-svelte                    plain scoped CSS, no tailwind
 └─ template-svelte-tailwind       CSS replaced with tailwind
     ├─ template-svelte-tailwind-blog
     │   ├─ ronan-eth
     │   └─ conquest-website-2
     └─ template-svelte-shadcn     <- you are here: tailwind + shadcn kit
         └─ jolly-roger            adds the onchain/web3 layer
             ├─ conquest-v1
             └─ template-commit-reveal
```

Each tier owns one concern. The shared core services (`route()` and its `globalQueryParams`, the notifications service, the service worker) live upstream and are identical all the way down. What changes per tier is only how they are *presented*:

- `template-svelte` renders notifications with a scoped `<style>` block of plain CSS.
- `template-svelte-tailwind` renders the same thing with tailwind utility classes.
- `template-svelte-shadcn` renders it with shadcn `Card` and `Button`, via `NotificationCard` / `NotificationOverlay`.

## What this tier adds

- `src/lib/shadcn/` the vendored shadcn-svelte kit (`ui/` components plus `utils.ts` exporting `cn`).
- `components.json` so the `shadcn-svelte` CLI can add further components into `$lib/shadcn`.
- `src/lib/core/utils/tailwind/index.ts` a second `cn` entry point, kept so downstream code that imports it kept working.
- The shadcn theme layer in `src/app.css`: the `dark` custom variant, the `:root` / `.dark` token sets, `@theme inline`, and the base layer.
- The shadcn presentation of the notification components, and of `VersionAndInstallNotfications`.

## Adding components

```bash
cd web
npx shadcn-svelte@latest add <component>
```

They land in `src/lib/shadcn/ui/` per the aliases in `components.json`.

## Developing

```bash
pnpm install
pnpm -F web dev
```
