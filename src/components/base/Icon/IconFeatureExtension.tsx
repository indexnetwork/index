import * as React from "react";

const IconFeatureExtension: React.FC<React.SVGProps<SVGSVGElement>> = ({ fill = "var(--main)", ...props }) => (
	<svg className="idx-icon"
		width={24}
		height={24}
		viewBox="0 0 24 24"
		fill={fill}
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path
			d="M0 6a6 6 0 1 0 12 0A6 6 0 0 0 0 6ZM12 0h12v12h-5.113a6.879 6.879 0 0 1-6.88-6.879V0H12Z"
		/>
		<path
			d="M0 18a6 6 0 1 0 12 0 6 6 0 0 0-12 0ZM12 18a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z"
		/>
	</svg>
);

export default IconFeatureExtension;
