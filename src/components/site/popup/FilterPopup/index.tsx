import Button from "components/base/Button";
import Checkbox from "components/base/Checkbox";
import Collapse from "components/base/Collapse";
import IconSearch from "components/base/Icon/IconSearch";
import Input from "components/base/Input";
import Popup, { PopupHandles } from "components/base/Popup";
import RadioGroup from "components/base/RadioGroup";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { useTranslation } from "next-i18next";
import React, { useRef } from "react";

export interface FilterPopupProps { }

const FilterPopup: React.FC<FilterPopupProps> = ({ children }) => {
	const { t } = useTranslation(["common", "components"]);

	const popup = useRef<PopupHandles>(null);

	const handleApply = () => {
		popup.current && popup.current.close();
	};

	const handleClear = () => {

	};

	return (
		<Popup
			ref={popup}
			popupClass="filter-popup-wrapper"
			menuClass="filter-popup-menu"
			closeOnMenuClick={false}
			position="bottom-right"
			content={
				<FlexRow
					className="px-4 py-6"
					rowSpacing={3}
					colSpacing={2}
				>
					<Col xs={12}>
						<Collapse
							title={t("components:filterMenu.menuTypeTtl")}
							key="type"
						>
							<FlexRow>
								<Col xs={6}><Checkbox title={t("components:filterMenu.optArticle")} /></Col>
								<Col xs={6}><Checkbox title={t("components:filterMenu.optVideo")} /></Col>
								<Col xs={6}><Checkbox title={t("components:filterMenu.optImage")} /></Col>
								<Col xs={6}><Checkbox title={t("components:filterMenu.optCustom")} /></Col>
							</FlexRow>
						</Collapse>
					</Col>
					<Col xs={12}>
						<Collapse
							title={t("components:filterMenu.menuPublishTtl")}
							key="publish"
							collapsed
						>
							<RadioGroup
								items={[
									{
										value: "today",
										title: t("common:today"),
									},
									{
										value: "week",
										title: t("common:thisWeek"),
									},
									{
										value: "month",
										title: t("common:thisMonth"),
									},
									{
										value: "year",
										title: t("common:thisYear"),
									},
								]}
							/>
						</Collapse>
					</Col>
					<Col xs={12}>
						<Collapse
							title={t("components:filterMenu.menuUploadTtl")}
							key="upload"
						>
							<RadioGroup
								items={[
									{
										value: "today",
										title: t("common:today"),
									},
									{
										value: "week",
										title: t("common:thisWeek"),
									},
									{
										value: "month",
										title: t("common:thisMonth"),
									},
									{
										value: "year",
										title: t("common:thisYear"),
									},
								]}
							/>
						</Collapse>
					</Col>
					<Col xs={12} className="mb-3">
						<Collapse
							title={t("components:filterMenu.menuTagTtl")}
							key="tag"
						>
							<Flex
								flexDirection="column"
							>
								<Input
									inputSize="xs"
									addOnBefore={<IconSearch />}
									placeholder="Search in tags"
									className="mb-3"
								/>
								<RadioGroup
									showTags
									multiselect
									items={[
										{
											value: "today",
											title: "Today",
										},
										{
											value: "week",
											title: "This Week",
										},
										{
											value: "month",
											title: "This Month",
										},
										{
											value: "year",
											title: "This Year",
										},
									]}
								/>
							</Flex>
						</Collapse>
					</Col>
					<Col
						xs={6}
					>
						<Button
							size="xs"
							block theme="clear"
							onClick={handleClear}
						>{t("common:clear")}</Button>
					</Col>
					<Col
						xs={6}
					>
						<Button
							size="xs"
							block
							onClick={handleApply}
						>{t("common:apply")}</Button>
					</Col>
				</FlexRow>
			}
		>
			{children}
		</Popup>
	);
};

export default FilterPopup;
