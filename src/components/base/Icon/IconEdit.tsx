import * as React from "react";

const IconEdit: React.FC<React.SVGProps<SVGSVGElement>> = ({
  stroke = "var(--main)",
  strokeWidth = "1.2",
  ...props
}) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g clip-path="url(#clip0_9695_50485)">
      <path
        d="M10 2.80742L1.53308 11.2743L1 15L4.72565 14.4669L13.1926 6M10 2.80742L11.1128 1.69465C11.679 1.10459 12.52 0.866804 13.3114 1.07303C14.1027 1.27926 14.7207 1.89726 14.927 2.68862C15.1332 3.47999 14.8954 4.32101 14.3053 4.88723L13.1926 6M10 2.80742L13.1926 6"
        stroke="white"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_9695_50485">
        <rect width="16" height="16" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

export default IconEdit;
