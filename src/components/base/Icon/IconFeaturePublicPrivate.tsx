import * as React from "react";

const IconFeaturePublicPrivate: React.FC<React.SVGProps<SVGSVGElement>> = ({ fill = "var(--main)", ...props }) => (
	<svg
		width={24}
		height={24}
		viewBox="0 0 24 24"
		fill={fill}
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path
			d="M12 6A6 6 0 1 0 0 6a6 6 0 0 0 12 0ZM24 0H12v12h12V0Z"
		/>
		<path
			d="M0 12v12h12V12H0ZM12 18a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z"
		/>
	</svg>
);

export default IconFeaturePublicPrivate;
