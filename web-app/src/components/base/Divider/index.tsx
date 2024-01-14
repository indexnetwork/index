import React from "react";
import cc from "classcat";

export interface DividerProps {
	className?: string;
	direction?: "horizontal" | "vertical";
}

const Divider: React.VFC<DividerProps> = ({ className, direction = "horizontal" }) => <div className={cc(["divider", `divider-${direction}`, className || ""])}></div>;

export default Divider;
