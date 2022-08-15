import * as React from "react";

const IconInvisible: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--gray-4)", strokeWidth = "1.2", ...props }) => (
	<svg className="icon"
		width={16}
		height={16}
		viewBox="0 0 16 16"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		stroke={stroke}
		strokeWidth={strokeWidth}
		{...props}
	>
		<path
			d="M13.511 2.25 2.489 13.272M7.999 9.957a1.979 1.979 0 0 0 1.978-1.979M7.999 6A1.978 1.978 0 0 0 6.02 7.979"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M9.198 4.429A5.765 5.765 0 0 0 8 4.3c-3.144 0-5.773 2.743-6.43 3.489a.283.283 0 0 0 0 .37A13.015 13.015 0 0 0 3.591 10M12 5.665a12.889 12.889 0 0 1 2.43 2.124.283.283 0 0 1 0 .37c-.657.747-3.286 3.49-6.43 3.49a5.887 5.887 0 0 1-1.5-.2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export default IconInvisible;
