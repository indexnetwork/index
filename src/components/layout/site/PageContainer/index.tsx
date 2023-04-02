import Container, { ContainerProps } from "components/layout/base/Grid/Container";
import React from "react";
import cc from "classcat";
import cm from "./style.module.scss";

export interface PageContainerProps extends ContainerProps { }

const PageContainer = (
	{
		children,
		className,
		...containerProps
	}: PageContainerProps,
) => (<Container
	className={cc([cm.pageContainer, className || ""])}
	{...containerProps}
>
	{children}
</Container>);

export default PageContainer;
