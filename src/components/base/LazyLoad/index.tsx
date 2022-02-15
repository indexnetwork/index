import { useIntersectionObserver } from "hooks/useIntersectionObserver";
import React, { useRef, useState } from "react";

export interface LazyLoadProps {
	options?: IntersectionObserverInit;
	height: number;
}

const LazyLoad: React.FC<LazyLoadProps> = ({
	children,
	options,
	height,
}) => {
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
			height: 100,
		}}
	>
		{load ? children : null}
	</div>;
};

export default LazyLoad;
