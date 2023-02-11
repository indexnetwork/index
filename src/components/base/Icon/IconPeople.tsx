import * as React from "react";

const IconPeople: React.FC<React.SVGProps<SVGSVGElement>> = ({
	stroke = "var(--main)",
	strokeWidth = ".3",
	...props
}) => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			d="M11.1998 5.3001C11.1998 7.06741 9.76712 8.5001 7.9998 8.5001C6.23249 8.5001 4.7998 7.06741 4.7998 5.3001C4.7998 3.53279 6.23249 2.1001 7.9998 2.1001C9.76712 2.1001 11.1998 3.53279 11.1998 5.3001Z"
			fill="#3F3F3F"
		/>
		<path
			d="M1.59961 12.7284V14.8805H14.3996V12.7284C14.3996 12.198 14.1942 11.6815 13.7668 11.3672C12.6477 10.5442 10.5847 9.5 7.99961 9.5C5.41453 9.5 3.35153 10.5442 2.23237 11.3672C1.80505 11.6815 1.59961 12.198 1.59961 12.7284Z"
			fill="#3F3F3F"
		/>
	</svg>
);

export default IconPeople;
