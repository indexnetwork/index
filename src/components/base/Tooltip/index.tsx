import React, { useRef, useState } from "react";
import cc from "classcat";

export interface TooltipProps {
	position?: "bottom-left" | "bottom-right" | "bottom-center" | "top-left" | "top-right" | "top-center";
	delay?: number;
	wrapperClass?: string;
	tooltipClass?: string;
	content: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({
	content, children, wrapperClass, position = "bottom-center", delay = 500,
}) => {
	const [visible, setVisible] = useState(false);

	const div = useRef(null);
	const timeout = useRef<NodeJS.Timeout>();

	const handleMouseEnter = () => {
		timeout.current = setTimeout(() => {
			setVisible(true);
		}, delay);
	};

	const handleMouseLeave = () => {
		if (timeout.current) {
			clearTimeout(timeout.current);
			timeout.current = undefined;
		}
		setVisible(false);
	};

	return (
		<div
			ref={div}
			className={cc(["idx-tooltip", wrapperClass || ""])}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			{children}
			{
				visible &&
				<div className={cc(["idx-tooltip-tip", `idx-tooltip-${position}`, wrapperClass || ""])}>
					{content}
				</div>
			}
		</div>
	);
};

export default Tooltip;
