import {definePromptOverlay} from '$lib/core/ui/overlay';

/**
 * The navbar drawer.
 *
 * A PROMPT overlay: temporary chrome, nothing to restore after a reload, and
 * nothing worth a link. Registering it here is what deletes the four
 * `showMenu = false` handlers this component used to carry on its nav links,
 * one per link and one forgotten link away from the bug this system exists to
 * remove. See ADR-0004 (`work` branch).
 */
export const navbarMenuPrompt = definePromptOverlay('navbar-menu');
