import * as React from "react";

const IconContextMenu: React.FC<React.SVGProps<SVGSVGElement>> = ({
  stroke = "var(--gray-4)",
  fill = "var(--gray-4)",
  strokeWidth = ".1",
  ...props
}) => (
  <svg
    width="24"
    height="25"
    viewBox="0 0 24 25"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g clip-path="url(#clip0_9699_2972)">
      <path
        d="M5.4999 14.5374C6.62518 14.5374 7.5374 13.6252 7.5374 12.4999C7.5374 11.3746 6.62518 10.4624 5.4999 10.4624C4.37462 10.4624 3.4624 11.3746 3.4624 12.4999C3.4624 13.6252 4.37462 14.5374 5.4999 14.5374Z"
        fill="#2A2A2A"
      />
      <path
        d="M11.9999 14.5374C13.1252 14.5374 14.0374 13.6252 14.0374 12.4999C14.0374 11.3746 13.1252 10.4624 11.9999 10.4624C10.8746 10.4624 9.9624 11.3746 9.9624 12.4999C9.9624 13.6252 10.8746 14.5374 11.9999 14.5374Z"
        fill="#2A2A2A"
      />
      <path
        d="M18.4999 14.5374C19.6252 14.5374 20.5374 13.6252 20.5374 12.4999C20.5374 11.3746 19.6252 10.4624 18.4999 10.4624C17.3746 10.4624 16.4624 11.3746 16.4624 12.4999C16.4624 13.6252 17.3746 14.5374 18.4999 14.5374Z"
        fill="#2A2A2A"
      />
    </g>
    <defs>
      <clipPath id="clip0_9699_2972">
        <rect
          width="17.075"
          height="4.075"
          fill="white"
          transform="translate(3.4624 10.4624)"
        />
      </clipPath>
    </defs>
  </svg>
);

export default IconContextMenu;
