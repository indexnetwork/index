import React, {
	ReactElement, useCallback,
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
							return tabKey === activeKey ? renderItem(child, true) : null;
						}
						return tabKey === activeKey ? renderItem(child, true) : renderItem(child, false);
					})
				}
			</>
		);
	}, [children, activeKey]);

	const handleTabChange = (tabKey: string) => {
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
						const {
							title, total, enabled, tabKey,
						} = child.props;
						return (
							<div
								className={cc([
									"tabs-list-item",
									tabKey === activeKey ? "tabs-list-item-active" : "",
									enabled ? "" : "tabs-list-item-disabled",
								])}
								onClick={() => {
									enabled && handleTabChange(tabKey);
								}}
							>
								<Text
									size="md"
									theme={tabKey === activeKey ? "primary" : "disabled"}
								>
									{title}
								</Text>
								{(total || (total === 0)) && <Text
									size="md"
									fontWeight={300}
									theme={tabKey === activeKey ? "primary" : "disabled"}
								> ({total})</Text>}
								{theme === "classic" && tabKey === activeKey && <div className="tabs-list-item-bottom"></div>}
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
