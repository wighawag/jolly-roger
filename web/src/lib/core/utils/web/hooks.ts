export function onDocumentLoaded(callback: () => void) {
	if (typeof document !== 'undefined') {
		if (
			// Non-standard: 'ready' is not in TypeScript's DocumentReadyState type
			(document as any).readyState === 'ready' ||
			document.readyState === 'interactive' ||
			document.readyState === 'complete'
		) {
			callback();
		} else {
			document.addEventListener(
				'load',
				function () {
					callback();
				},
				{
					once: true,
				},
			);
		}
	}
}
