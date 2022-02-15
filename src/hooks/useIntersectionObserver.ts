import { useEffect } from "react";

export function useIntersectionObserver(
	ref: React.MutableRefObject<any>,
	onIntersectView: (o: IntersectionObserver) => void,
	options: IntersectionObserverInit = {
		root: null,
		rootMargin: "100px 0px 100px 0px",
		threshold: 0,
	},
) {
	useEffect(() => {
		const intersectionCallback: IntersectionObserverCallback = (entries, observer) => {
			const [entry] = entries;
			if (entry.isIntersecting) {
				onIntersectView(observer);
			}
		};
		const refCopy = ref.current;
		const observer = new IntersectionObserver(intersectionCallback, options);

		refCopy && observer.observe(refCopy);

		return () => {
			refCopy && observer.unobserve(refCopy);
		};
	}, [ref, onIntersectView, options]);
}
