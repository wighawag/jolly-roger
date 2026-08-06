/**
 * Classes that can be customized on notification components
 * Use with the `classes` prop to style specific elements
 */
export interface NotificationClasses {
	/** Root container of the notification */
	root?: string;
	/** Icon wrapper */
	icon?: string;
	/** Title text */
	title?: string;
	/** Body/description text */
	body?: string;
	/** Actions container */
	actions?: string;
	/** Default buttons (ok/dismiss) */
	button?: string;
	/** Primary action button (e.g., "Reload") */
	primaryButton?: string;
}
