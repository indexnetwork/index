import Container from "components/layout/base/Grid/Container";
import React from "react";
import cc from "classcat";
import cm from "./style.module.scss";
import FlexRow from "../../../layout/base/Grid/FlexRow";
import Col from "../../../layout/base/Grid/Col";

export interface LandingSectionProps {
	dark?: boolean;
	noContainer?: boolean;
	hasBgImage?: boolean;
	first?: boolean;
	children: React.ReactNode
}
const LandingSection = (
	{
		dark,
		hasBgImage = true,
		first = false,
		noContainer,
		children,
	}: LandingSectionProps,
) => (<div className={cc([first ? "mb-11" : "mb-12"])} ><Container
	fluid
	className={cc(["lnd-container", "my-0", hasBgImage ? cm.withBg : undefined, cm.container, dark ? cm.dark : cm.light, noContainer ? "pr-0" : undefined])}
>
	{
		noContainer ? (
			children
		) : (
			<FlexRow className={cc([dark ? "py-11" : ""])} fullWidth align={"center"}>
				<Col centerBlock xs={10}>
					{children}
				</Col>
			</FlexRow>
		)
	}
</Container></div>);

export default LandingSection;
