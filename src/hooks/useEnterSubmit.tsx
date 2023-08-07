import { useRef, type RefObject } from "react";

export function useEnterSubmit(): {
	formRef: RefObject<HTMLFormElement>
	onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
	} {
	const formRef = useRef<HTMLFormElement>(null);

	const handleKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement>,
	): void => {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing
		) {
			formRef.current?.requestSubmit();
			event.preventDefault();
		}
	};

	return { formRef, onKeyDown: handleKeyDown };
}
