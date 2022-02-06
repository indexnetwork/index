import * as React from "react";

const IconFeatureSearch = ({ fill = "var(--main)", ...props }) => (
	<svg
		width={24}
		height={24}
		viewBox="0 0 24 24"
		fill={fill}
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path d="M12 12.01v12a12 12 0 0 1-12-12h12Z" />
		<path
			d="M6 .01a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM18 24a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"

		/>
		<path d="M24 12H12V0a12 12 0 0 1 12 12Z" />
	</svg>
);

export default IconFeatureSearch;
