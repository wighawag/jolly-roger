import {defineCapability} from './define';
import type {NavigationService} from '$lib/core/navigation';

/**
 * Where the app is, and the history entries it owns (ADR-0004).
 *
 * Optional, like ENS: a component that wants to know about navigation stays
 * renderable in isolation and simply does nothing when no app provided one. The
 * app root provides the service the context holds, wired to the framework by
 * `$lib/kit`.
 */
const navigationCapability = defineCapability<NavigationService>('navigation');

export const provideNavigation = navigationCapability.provide;
export const useNavigation = navigationCapability.use;
