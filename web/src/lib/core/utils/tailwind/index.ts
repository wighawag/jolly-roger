import {clsx, type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes intelligently.
 * Combines clsx for conditional class management and tailwind-merge
 * for resolving Tailwind class conflicts.
 *
 * @example
 * cn('bg-white p-4', 'bg-red-500') // => 'p-4 bg-red-500' (bg-white merged away)
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
