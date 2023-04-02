import React from "react";

export interface TabPaneProps {
	tabKey: string;
	title: string;
	enabled?: boolean;
	children?: React.ReactNode;
}

const TabPane = (
	{
		children,
	}: TabPaneProps,
) => (<div>{children}</div>);

export default TabPane;
