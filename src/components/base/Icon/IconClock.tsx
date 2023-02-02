import * as React from "react";

const IconClock: React.FC<React.SVGProps<SVGSVGElement>> = ({
  stroke = "var(--main)",
  strokeWidth = "1.2",
  ...props
}) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M12 23.0049C18.0751 23.0049 23 18.08 23 12.0049C23 5.92975 18.0751 1.00488 12 1.00488C5.92487 1.00488 1 5.92975 1 12.0049C1 18.08 5.92487 23.0049 12 23.0049Z" fill="#EF9B0D" fill-opacity="0.2"/>
  <path d="M12.75 4.5V12.7105L7.5 12.75" stroke="#EF9B0D" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  
    
);

export default IconClock;
