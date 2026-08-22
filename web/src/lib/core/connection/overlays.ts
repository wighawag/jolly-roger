import {
	definePromptOverlay,
	type PromptOverlayDefinition,
} from '$lib/core/ui/overlay';

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
 *
 * ONE PER FLOW, which is what the key is for. An overlay's LABEL is its identity
 * in the registry, so two `ConnectionFlow` components sharing this definition
 * share one overlay INSTANCE: opening the hatch on one renders the confirmation
 * in both, and closing it in either closes the single instance. An app with a
 * second connection (a separate payment rail, say) renders a second flow, so the
 * definition has to be per flow rather than per module.
 *
 * Memoised, because the registry identifies an overlay by label and warns when
 * two different definition OBJECTS claim the same one. Asking twice for the same
 * key has to give back the same object.
 */
const prompts = new Map<string, PromptOverlayDefinition<void>>();

export function stopWaitingPromptFor(
	key: string,
): PromptOverlayDefinition<void> {
	const existing = prompts.get(key);
	if (existing) return existing;
	const prompt = definePromptOverlay(`${key}-stop-waiting`);
	prompts.set(key, prompt);
	return prompt;
}

/** The escape hatch for the app's main connection. */
export const stopWaitingPrompt = stopWaitingPromptFor('connection');
