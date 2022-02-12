import React, {
	ReactElement, useCallback, useEffect, useState,
} from "react";
import cc from "classcat";
import { uuid } from "uuidv4";
import { TabPaneProps } from "./TabPane";

export interface TabsProps {
	children: ReactElement<TabPaneProps>[];
	activeKey?: string;
	destroyInactiveTabPane?: boolean;
	onTabChange?(activeTabKey: string): void;
}

export const Tabs: React.FC<TabsProps> = ({
	children,
	activeKey,
	destroyInactiveTabPane = true,
	onTabChange,
}) => {
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
					key={uuid()}
					className={cc([
						"idx-tabs-contents-item",
						!visible ? "idx-tabs-contents-item-invisible" : "",
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
			className="idx-tabs"
		>
			<div className="idx-tabs-list">
				{
					React.Children.map(children || [], (
						child: React.ReactElement<TabPaneProps>,
					) => {
						const { title, enabled, tabKey } = child.props;

						return (
							<div
								className={cc([
									"idx-tabs-list-title",
									tabKey === activeKey ? "idx-tabs-list-item-active" : "",
									enabled ? "" : "idx-tabs-list-item-disabled",
								])}
								onClick={() => {
									enabled && handleTabChange(tabKey);
								}}
							>
								{title}
							</div>
						);
					})
				}
			</div>
			<div className="idx-tabs-contents">
				{renderTabContent()}
			</div>
		</div>
	);
};
