import * as React from "react";

const IconFeatureAddLink = ({ fill = "var(--main)", ...props }) => (
	<svg
		width={24}
		height={24}
		viewBox="0 0 24 24"
		fill={fill}
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path
			d="M0 6a6 6 0 1 0 12 0A6 6 0 0 0 0 6ZM24 6a6 6 0 1 0-12 0 6 6 0 0 0 12 0Z"
		/>
		<path
			d="M0 18a6 6 0 1 0 12 0 6 6 0 0 0-12 0ZM12 18a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z"
		/>
	</svg>
);

export default IconFeatureAddLink;
