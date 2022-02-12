import React from "react";

export interface TabPaneProps {
	tabKey: string;
	title: string;
	enabled?: boolean;
}

const TabPane: React.FC<TabPaneProps> = ({
	children,
}) => (
	<div>{children}</div>
);

export default TabPane;
