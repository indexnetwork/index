import Container, { ContainerProps } from "layout/base/Grid/Container";
import React from "react";
import cc from "classcat";
import cm from "./style.module.scss";

export interface PageContainerProps extends ContainerProps { }

const PageContainer: React.FC<PageContainerProps> = ({ children, className, ...containerProps }) => (
	<Container
		className={cc([cm.pageContainer, className || ""])}
		{...containerProps}
	>
		{children}
	</Container>);

export default PageContainer;
