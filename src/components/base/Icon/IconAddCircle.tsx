import * as React from "react";

const IconAdd: React.FC<React.SVGProps<SVGSVGElement>> = ({
  stroke = "var(--gray-4)",
  strokeWidth = "1.2",
  ...props
}) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g clip-path="url(#clip0_9695_50821)">
      <path
        d="M18.4168 10.0046C18.4168 14.653 14.6486 18.4212 10.0002 18.4212C5.35177 18.4212 1.5835 14.653 1.5835 10.0046C1.5835 5.35616 5.35177 1.58789 10.0002 1.58789C14.6486 1.58789 18.4168 5.35616 18.4168 10.0046Z"
        stroke="#3F3F3F"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M10.5002 5.00488C10.5002 4.72874 10.2764 4.50488 10.0002 4.50488C9.7241 4.50488 9.50024 4.72874 9.50024 5.00488V15.0049C9.50024 15.281 9.7241 15.5049 10.0002 15.5049C10.2764 15.5049 10.5002 15.281 10.5002 15.0049V5.00488Z"
        stroke="#3F3F3F"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M15.0002 10.5049C15.2764 10.5049 15.5002 10.281 15.5002 10.0049C15.5002 9.72874 15.2764 9.50488 15.0002 9.50488H5.00024C4.7241 9.50488 4.50024 9.72874 4.50024 10.0049C4.50024 10.281 4.7241 10.5049 5.00024 10.5049H15.0002Z"
        stroke="#3F3F3F"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_9695_50821">
        <rect width="20" height="20" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

export default IconAdd;
