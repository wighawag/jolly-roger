export function initEmitter<T>() {
	const callbacks: ((v: T) => void)[] = [];

	function off(func: (v: T) => void) {
		const index = callbacks.indexOf(func);
		if (index >= 0) {
			callbacks.splice(index, 1);
		}
	}
	function on(func: (v: T) => void): () => void {
		callbacks.push(func);
		return () => off(func);
	}

	return {
		on,
		off,
		emit(v: T) {
			for (const callback of callbacks) {
				callback(v);
			}
		},
	};
}
