import Container from "layout/base/Grid/Container";
import React from "react";
import cc from "classcat";
import cm from "./style.module.scss";

export interface LandingSectionProps {
	dark?: boolean;
}
const LandingSection: React.FC<LandingSectionProps> = ({ dark, children }) => (
	<Container
		fluid
		className={cc(["idx-m-0", cm.container, dark ? cm.dark : cm.light])}
	>
		<Container>
			{children}
		</Container>
	</Container>
);

export default LandingSection;
