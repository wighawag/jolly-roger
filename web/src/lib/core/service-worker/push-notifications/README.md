# Push notifications: shipped, wired to nothing, and that is deliberate

This directory (329 lines across `index.ts` and `utils.ts`) implements the browser half of Web Push: asking permission, subscribing against a VAPID key, registering that subscription with a server, and modelling the whole thing as a store you can render.

**Nothing imports it.** Not here, not in any template that descends from this one, not at any point in this repository's history. That is not an oversight, and this file exists so nobody has to spend an afternoon working out whether it is.

This is the "PWA ready" template. A service worker without a push story is a service worker that does half the job, and the fiddly half of Web Push is not the server, it is exactly what is in here: `urlB64ToUint8Array`, the permission states, the difference between "denied" and "not subscribed yet", re-registering a subscription the browser silently rotated. Reconstructing that from the specs is a bad day. Deleting it and needing it later is a worse one. So it ships, unwired, documented.

## What is here

`createPushNotificationService({serverPublicKey, serverEndpoint, domain, account, serviceWorker})` returns a readable store of `PushNotificationsState`, plus the actions to subscribe and unsubscribe.

The state is a discriminated union, and the discriminant is `settled`. Unsettled means the service is still working out where it stands (`loading`). Settled means it knows, and splits three ways: permission was `denied`, or there is a `subscription`, or there is not and `subscribing` says whether one is being obtained. Rendering it is a matter of switching on those, and no state is "unknown but pretend it is fine", which is the failure mode this shape exists to prevent.

`DeclarativePushNotification` and `NotificationAction` describe the payload the server is expected to send, including the action a user can press.

## What wiring it actually needs

Four things, and the third is the one people underestimate.

1. **A VAPID key pair.** The public half becomes `serverPublicKey`. Generate with `npx web-push generate-vapid-keys`.

2. **A push server** at `serverEndpoint`, answering three routes this code calls: `POST /register` (store a subscription), `GET /registered/:account/:domain/:endpoint` (has this subscription been stored), and `POST /push` (send one). The private VAPID key lives there and must never reach the browser.

3. **An account with a signer.** `params.account` is a `Readable<{signer: {address, privateKey}} | undefined>`. Subscriptions are registered per account, and this template has no account concept at all, which is the main reason the service sits unused here rather than merely unrendered. A descendant that has accounts (jolly-roger and its variants do) has the piece that is missing; a descendant that does not needs to decide what identity a subscription belongs to before this means anything.

4. **A component.** Nothing renders the store. `core/service-worker/VersionAndInstallNotfications.svelte` is the nearest example of the shape: subscribe, switch on the state, offer the action.

The service worker side (receiving a push and showing it) is already handled: `core/service-worker/index.ts` adapts a push into the generic notification shape, and its `navigateTo` binding follows the URL when the user presses the action.

## Removing it, in about ten minutes

If you know you do not want push, deleting this is clean, because the dependency runs one way and nothing points into it.

1. Delete this directory.
2. That is the whole of it. There is no importer to update anywhere in `src/`, no route to remove, no config key to drop, and no test to delete.

Confirm before and after with:

```sh
git grep -n "push-notifications" -- 'web/src/**' | grep -v 'push-notifications/'
```

which should print nothing both times. If it prints something, somebody wired it up and this paragraph is out of date.

**Delete it at the level that owns it, which is this repo.** Deleting it in a descendant makes every future merge from here a modify/delete conflict, forever, paid by whoever is cascading something unrelated. If you do not want it, remove it here and let the cascade carry the removal down.
