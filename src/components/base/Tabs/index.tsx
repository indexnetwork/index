import React, {
	ReactElement, useCallback, useEffect, useState,
} from "react";
import cc from "classcat";
import { v4 as uuidv4 } from "uuid";
import { TabPaneProps } from "./TabPane";
import Text from "../Text";

export interface TabsProps {
	children: ReactElement<TabPaneProps>[];
	activeKey?: string;
	destroyInactiveTabPane?: boolean;
	onTabChange?(activeTabKey: string): void;
	theme?: "classic" | "rounded";
}

export const Tabs = (
	{
		children,
		activeKey,
		destroyInactiveTabPane = true,
		onTabChange,
		theme = "classic",
	}: TabsProps,
) => {
	const getActiveTab = () => {
		if (activeKey) return activeKey;

		return children && children.length > 0 ? children[0].props.tabKey : undefined;
	};

	const [activeTab, setActiveTab] = useState<string | undefined>(() => getActiveTab());

	useEffect(() => {
		if (activeKey) {
			setActiveTab(activeKey);
		}
	}, [activeKey]);

	const renderTabContent = useCallback(() => {
		function renderItem(child: React.ReactNode, visible: boolean) {
			return (
				<div
					key={uuidv4()}
					className={cc([
						"tabs-contents-item",
						!visible ? "tabs-contents-item-invisible" : "",
					])}
				>
					{child}
				</div>
			);
		}

		return (
			<>
				{
					children.map((child: React.ReactElement<TabPaneProps>) => {
						const { tabKey } = child.props;
						if (destroyInactiveTabPane) {
							return tabKey === activeTab ? renderItem(child, true) : null;
						}
						return tabKey === activeTab ? renderItem(child, true) : renderItem(child, false);
					})
				}
			</>
		);
	}, [children, activeTab]);

	const handleTabChange = (tabKey: string) => {
		setActiveTab(tabKey);
		onTabChange && onTabChange(tabKey);
	};

	return (
		<div
			className={cc(["tabs", theme])}
		>
			<div className="tabs-list">
				{
					React.Children.map(children || [], (
						child: React.ReactElement<TabPaneProps>,
					) => {
						const { title, total, enabled, tabKey } = child.props;

						return (
							<div
								className={cc([
									"tabs-list-item",
									tabKey === activeTab ? "tabs-list-item-active" : "",
									enabled ? "" : "tabs-list-item-disabled",
								])}
								onClick={() => {
									enabled && handleTabChange(tabKey);
								}}
							>
								<Text
									size="md"
									theme={tabKey === activeTab ? "primary" : "disabled"}
								>
									{title}
								</Text>
								{total && <Text
									size="md"
									fontWeight={300}
									theme={tabKey === activeTab ? "primary" : "disabled"}
								> ({total})</Text>}
								{theme === "classic" && tabKey === activeTab && <div className="tabs-list-item-bottom"></div>}
							</div>
						);
					})
				}
			</div>
			<div className="tabs-contents">
				{renderTabContent()}
			</div>
		</div>
	);
};
