export type ModalCancelationMode = 'clickOutside' | 'esc';
export type ModalSettings =
	| {
			element: HTMLElement;
			response?: (r: any, mode?: ModalCancelationMode) => boolean;
	  }
	| {
			content: ModalContentSettings;
			response?: (r: any, mode?: ModalCancelationMode) => boolean;
	  };

export type ModalContentSettings =
	| {
			type: 'info';
			title?: string;
			message: string;
	  }
	| {
			type: 'confirm';
			title?: string;
			message: string;
	  };

export type ModalCancellationOptions = {button: boolean; clickOutside?: boolean} | {cancelable: false};

export type ModalResponseCallback = (response: boolean) => boolean | undefined | void;
