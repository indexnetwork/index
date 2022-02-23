import * as React from "react";

const IconClose: React.FC<React.SVGProps<SVGSVGElement>> = ({ stroke = "var(--gray-4)", strokeWidth = "1.2", ...props }) => (
	<svg className="idx-icon"
		width={16}
		height={16}
		viewBox="0 0 16 16"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		stroke={stroke}
		strokeWidth={strokeWidth}
		{...props}
	>
		<g
			clipPath="url(#idxCloseIcon)"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="m3 3 4.98 4.98L3 12.95M12.95 12.95 7.98 7.98 12.95 3" />
		</g>
		<defs>
			<clipPath id="idxCloseIcon">
				<path
					transform="translate(2.5 2.5)"
					d="M0 0h10.95v10.95H0z"
				/>
			</clipPath>
		</defs>
	</svg>
);

export default IconClose;
