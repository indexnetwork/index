import * as React from "react";

const IconGreenAdd: React.FC<React.SVGProps<SVGSVGElement>> = ({
	stroke = "var(--main)",
	strokeWidth = "1.2",
	...props
}) => (
	<svg
		width="24"
		height="24"
		viewBox="0 0 24 24"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			d="M12 6.50488V18.5049"
			stroke="#89CF58"
			strokeWidth="1.2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M18 12.5049H6"
			stroke="#89CF58"
			strokeWidth="1.2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconGreenAdd;
