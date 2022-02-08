import * as React from "react";

const IconFeatureFilterTag: React.FC<React.SVGProps<SVGSVGElement>> = ({ fill = "var(--main)", ...props }) => (
	<svg className="idx-icon"
		width={24}
		height={24}
		viewBox="0 0 24 24"
		fill={fill}
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path
			d="M0 12A12 12 0 0 1 12 0v12H0ZM24 0v12H12c0-3.181 1.264-6.232 3.514-8.483A12.011 12.011 0 0 1 24 0ZM12 12v12H0a12 12 0 0 1 12-12ZM12 24a12 12 0 0 1 12-12v12H12Z"
		/>
	</svg>
);

export default IconFeatureFilterTag;
