import { useIntersectionObserver } from "hooks/useIntersectionObserver";
import React, { useRef, useState } from "react";

export interface LazyLoadProps {
	options?: IntersectionObserverInit;
	height?: React.CSSProperties["height"];
	children: React.ReactNode;
}

const LazyLoad = (
	{
		children,
		options,
		height = 93,
	}: LazyLoadProps,
) => {
	const divRef = useRef<HTMLDivElement>(null);
	const [load, setLoad] = useState(false);

	function handleIntersection(o: IntersectionObserver) {
		setLoad(true);
		o.disconnect();
	}

	useIntersectionObserver(divRef, handleIntersection, options);

	return <div
		ref={divRef}
		style={{
			height: "auto",
			minHeight: height,
		}}
	>
		{load ? children : null}
	</div>;
};

export default LazyLoad;
