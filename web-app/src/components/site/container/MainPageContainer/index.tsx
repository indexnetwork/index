import Container from "components/layout/base/Grid/Container";
import React from "react";

const MainPageContainer = ({
	children,
} : any) => <Container className="my-3 my-lg-8">
	{children}
</Container>;

export default MainPageContainer;
