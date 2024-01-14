import { useEffect } from "react";

function useBackdropClick<T extends HTMLElement>(ref: React.RefObject<T>, callback: () => void, enabled: boolean = false) {
	useEffect(() => {
		function checkClick(e: any) {
			if (ref.current && !ref.current!.contains(e.target! as any)) {
				callback();
			}
		}

		if (enabled) {
			window.addEventListener("click", checkClick, {
				capture: true,
				passive: false,
			});
			window.addEventListener("touchstart", checkClick, {
				capture: true,
				passive: false,
			});
		} else {
			window.removeEventListener("click", checkClick);
			window.removeEventListener("touchstart", checkClick);
		}

		return () => {
			window.removeEventListener("click", checkClick);
			window.removeEventListener("touchstart", checkClick);
		};
	}, [ref, enabled, callback]);
}

export default useBackdropClick;
