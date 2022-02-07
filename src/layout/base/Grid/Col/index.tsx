import React from "react";
import cc from "classcat";

export type GridItemSize = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";

export interface ColProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	xs?: GridItemSize;
	sm?: GridItemSize;
	md?: GridItemSize;
	lg?: GridItemSize;
	xsPull?: GridItemSize;
	smPull?: GridItemSize;
	mdPull?: GridItemSize;
	lgPull?: GridItemSize;
	xsPush?: GridItemSize;
	smPush?: GridItemSize;
	mdPush?: GridItemSize;
	lgPush?: GridItemSize;
	xsOffset?: GridItemSize;
	smOffset?: GridItemSize;
	mdOffset?: GridItemSize;
	lgOffset?: GridItemSize;
	pullRight?: boolean;
	pullLeft?: boolean;
	centerBlock?: boolean;
	clearfix?: boolean;
	show?: boolean;
	hidden?: boolean;
	invisible?: boolean;
	textHide?: boolean;
}

const Col: React.FC<ColProps> = ({
	children,
	className,
	sm,
	md,
	lg,
	xsPull,
	smPull,
	mdPull,
	lgPull,
	xsPush,
	smPush,
	mdPush,
	lgPush,
	xsOffset,
	smOffset,
	mdOffset,
	lgOffset,
	pullRight,
	pullLeft,
	centerBlock,
	clearfix,
	show,
	hidden,
	invisible,
	textHide,
	xs = "12",
	...divProps
}) => (
	<div
		className={cc([
			`col-xs-${xs}`,
			sm ? `col-sm-${sm}` : "",
			md ? `col-md-${md}` : "",
			lg ? `col-lg-${lg}` : "",
			xsPull ? `col-xs-pull-${xsPull}` : "",
			smPull ? `col-sm-pull-${smPull}` : "",
			mdPull ? `col-md-pull-${mdPull}` : "",
			lgPull ? `col-lg-pull-${lgPull}` : "",
			xsPush ? `col-xs-push-${xsPush}` : "",
			smPush ? `col-sm-push-${smPush}` : "",
			mdPush ? `col-md-push-${mdPush}` : "",
			lgPush ? `col-lg-push-${lgPush}` : "",
			xsOffset ? `col-xs-offset-${xsOffset}` : "",
			smOffset ? `col-sm-offset-${smOffset}` : "",
			mdOffset ? `col-md-offset-${mdOffset}` : "",
			lgOffset ? `col-lg-offset-${lgOffset}` : "",
			pullRight ? "pull-right" : "",
			pullLeft ? "pull-left" : "",
			centerBlock ? "center-block" : "",
			clearfix ? "clearfix" : "",
			show ? "show" : "",
			hidden ? "hidden" : "",
			invisible ? "invisible" : "",
			textHide ? "textHide" : "",
			className || ""])}
		{...divProps}
	>
		{children}
	</div>);

export default Col;
