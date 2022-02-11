import { useEffect } from "react";

export function useIntersectionObserver(ref: React.MutableRefObject<any>, onIntersectView: (o: IntersectionObserver) => void) {
	const intersectionCallback: IntersectionObserverCallback = (entries, observer) => {
		const [entry] = entries;
		if (entry.isIntersecting) {
			onIntersectView(observer);
		}
	};

	useEffect(() => {
		const observer = new IntersectionObserver(intersectionCallback, {
			root: null,
			rootMargin: "0px",
			threshold: 1.0,
		});

		ref.current && observer.observe(ref.current);

		return () => {
			ref.current && observer.unobserve(ref.current);
		};
	}, []);
}
