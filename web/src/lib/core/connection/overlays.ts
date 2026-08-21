import {definePromptOverlay} from '$lib/core/ui/overlay';

/**
 * The escape hatch's confirmation (ADR-0004, `work` branch).
 *
 * A PROMPT overlay: it asks about an action in flight, so it is never in the
 * URL and never restored. Restoring "your wallet still has this transaction,
 * stop waiting?" after a reload would be a question about a request the app is
 * no longer making, and the URL is shareable, which would turn it into a link.
 *
 * NESTED INSIDE A SYSTEM OVERLAY, which the model supports and which is the
 * whole reason the two kinds are separate: the connection flow's waiting modal
 * stays open because its condition (the wallet is holding a request) is still
 * true, while this one opens on top of it, pushes one history entry, and goes
 * away on back, ESC, a click outside, or an answer.
 *
 * No `onClose`: closing this question means "keep waiting", which is what the
 * app was already doing. Only the confirm button acts.
 */
export const stopWaitingPrompt = definePromptOverlay('connection-stop-waiting');
