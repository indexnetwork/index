import * as React from "react";

const IconSearch: React.FC<React.SVGProps<SVGSVGElement>> = ({
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
    <path
      d="M8.69713 14.7644C12.1664 14.7644 14.9787 11.998 14.9787 8.58557C14.9787 5.17309 12.1664 2.40674 8.69713 2.40674C5.2279 2.40674 2.41553 5.17309 2.41553 8.58557C2.41553 11.998 5.2279 14.7644 8.69713 14.7644Z"
      stroke="#7F7F7F"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M14.0922 12.3608L17.2168 15.4343C17.4545 15.6729 17.5877 15.9936 17.5877 16.3276C17.5877 16.6616 17.4545 16.9825 17.2168 17.221V17.221C16.9742 17.4549 16.6482 17.5858 16.3086 17.5858C15.969 17.5858 15.6429 17.4549 15.4004 17.221L12.2759 14.1475"
      stroke="#7F7F7F"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

export default IconSearch;
