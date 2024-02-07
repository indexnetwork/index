import { useRouter } from "next/router";
import { useEffect } from "react";

function useScrollRestoration() {
	const router = useRouter();

	function saveScroll() {
		const scrollPosition = window.document.documentElement.scrollTop;

		const record = {
			pathname: router.pathname,
			position: scrollPosition,
		};
		sessionStorage.setItem("scrollPosition", JSON.stringify(record));
	}

	function loadScroll() {
		const isWindowExist = typeof window !== "undefined";
		const record = isWindowExist
			&& window.sessionStorage ? JSON.parse(window.sessionStorage.getItem("scrollPosition") || "undefined") : null;
		if (isWindowExist && router.pathname === record.pathname) {
			window.scrollTo(0, parseInt(record.position));
		}
	}

	if (typeof window !== "undefined") {
		window.addEventListener("beforeunload", saveScroll);
	}

	useEffect(() => {
		loadScroll();
	}, []);

	useEffect(() => {
		router.events.on("routeChangeStart", saveScroll);

		return () => router.events.off("routeChangeStart", saveScroll);
	}, [router.events]);

	() => {
		window.removeEventListener("beforeunload", saveScroll);
	};
}

export default useScrollRestoration;
