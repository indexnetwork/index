import * as React from "react";

const IconPeople: React.FC<React.SVGProps<SVGSVGElement>> = ({
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
    <path
      d="M14 6C14 8.20914 12.2091 10 10 10C7.79086 10 6 8.20914 6 6C6 3.79086 7.79086 2 10 2C12.2091 2 14 3.79086 14 6Z"
      fill="#3F3F3F"
    />
    <path
      d="M2 15.0784V17.9756H18V15.0784C18 14.548 17.7944 14.0323 17.3744 13.7085C16.0194 12.6639 13.3632 11.25 10 11.25C6.63681 11.25 3.98056 12.6639 2.62564 13.7085C2.20556 14.0323 2 14.548 2 15.0784Z"
      fill="#3F3F3F"
    />
  </svg>
);

export default IconPeople;
