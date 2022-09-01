import Container from "components/layout/base/Grid/Container";
import React from "react";
import cc from "classcat";
import cm from "./style.module.scss";

export interface LandingSectionProps {
	dark?: boolean;
	noContainer?: boolean;
	hasBgImage?: boolean;
}
const LandingSection: React.FC<LandingSectionProps> = ({
	dark, hasBgImage = true, noContainer, children,
}) => (
	<Container
		fluid
		className={cc(["lnd-container", "m-0", hasBgImage ? cm.withBg : undefined, cm.container, dark ? cm.dark : cm.light, noContainer ? "pr-0" : undefined])}
	>
		{
			noContainer ? (
				children
			) : (
				<Container>
					{children}
				</Container>
			)
		}
	</Container>
);

export default LandingSection;
