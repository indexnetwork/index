import { useEffect } from "react";

function useBackdropClick<T extends HTMLElement>(ref: React.RefObject<T>, callback: () => void, enabled: boolean = false) {
	useEffect(() => {
		function checkClick(e: MouseEvent) {
			if (ref.current && !ref.current!.contains(e.target! as any)) {
				callback();
			}
		}
		if (enabled) {
			window.addEventListener("click", checkClick);
		} else {
			window.removeEventListener("click", checkClick);
		}
		return () => window.removeEventListener("click", checkClick);
	}, [ref, enabled, callback]);
}

export default useBackdropClick;
