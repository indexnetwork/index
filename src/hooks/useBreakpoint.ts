import { useEffect, useState } from "react";
import { isSSR } from "utils/helper";

export function useBreakpoint<T extends { [key: string]: number }>(
	breakpoints: T,
) {
	const [breakpoint, setBreakPoint] = useState<keyof T>();
	useEffect(() => {
		if (isSSR()) return;

		function calculateBreakpoint() {
			const bps = Object.keys(breakpoints);

			for (let i = 0; i <= bps.length; i++) {
				if (window.innerWidth <= breakpoints[bps[i]]) {
					setBreakPoint(bps[i] as any);
					return;
				}

				if (i === bps.length - 1) {
					setBreakPoint(bps[i] as any);
				}
			}
		}
		window.addEventListener("resize", calculateBreakpoint);
		calculateBreakpoint();

		return () => window.removeEventListener("resize", calculateBreakpoint);
	}, []);

	return breakpoint;
}
