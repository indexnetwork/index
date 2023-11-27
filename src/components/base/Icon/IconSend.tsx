import * as React from "react";

const IconSend = (
	{
		fill = "var(--gray-2)",
		...props
	}: React.SVGProps<SVGSVGElement>,
) => (<svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    {...props}
  >
    <path
      fill={fill}
      d="m14.435 7.222-.005-.002L1.973 2.053a.687.687 0 0 0-.648.063.719.719 0 0 0-.325.6v3.305a.7.7 0 0 0 .57.688l6.794 1.256a.117.117 0 0 1 0 .23L1.57 9.45a.7.7 0 0 0-.57.687v3.305a.688.688 0 0 0 .309.574.699.699 0 0 0 .663.06L14.43 8.94l.005-.002a.934.934 0 0 0 0-1.716Z"
    />
  </svg>
);

export default IconSend;
