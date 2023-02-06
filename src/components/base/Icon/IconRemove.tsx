import * as React from "react";

const IconRemove: React.FC<React.SVGProps<SVGSVGElement>> = ({
  stroke = "var(--main)",
  strokeWidth = ".3",
  ...props
}) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g clip-path="url(#clip0_9695_50842)">
      <path
        d="M18.4168 10.0041C18.4168 14.6525 14.6486 18.4207 10.0002 18.4207C5.35177 18.4207 1.5835 14.6525 1.5835 10.0041C1.5835 5.35567 5.35177 1.5874 10.0002 1.5874C14.6486 1.5874 18.4168 5.35567 18.4168 10.0041Z"
        stroke="#3F3F3F"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M15 10H5"
        stroke="#2A2A2A"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_9695_50842">
        <rect width="20" height="20" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

export default IconRemove;
