import { useEffect, useState } from "react";

export function useYOffSet(enable: boolean = false) {
	const [yOffset, setYOffSet] = useState<number>(0);

	useEffect(() => {
		function handeScroll() {
			setYOffSet(window.pageYOffset);
		}
		if (enable) {
			window.addEventListener("scroll", handeScroll);

			return () => window.removeEventListener("scroll", handeScroll);
		}
	}, [enable]);

	return yOffset;
}
