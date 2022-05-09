import Container from "layout/base/Grid/Container";
import React from "react";

const MainPageContainer: React.FC = ({
	children,
}) => <Container className="idx-my-3 idx-my-lg-8">
	{children}
</Container>;

export default MainPageContainer;
