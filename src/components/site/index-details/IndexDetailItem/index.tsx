import Col from "layout/base/Grid/Col";
import FlexRow from "layout/base/Grid/FlexRow";
import Text from "components/base/Text";
import React, { useState } from "react";
import Button from "components/base/Button";
import IconTag from "components/base/Icon/IconTag";
import IconStar from "components/base/Icon/IconStar";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import LogoMini from "components/base/Logo/LogoMini";
import { DraggableProvided, DraggableStateSnapshot } from "react-beautiful-dnd";
import IconDrag from "components/base/Icon/IconDrag";
import Flex from "layout/base/Grid/Flex";
import { useBreakpoint } from "hooks/useBreakpoint";
import { BREAKPOINTS } from "utils/constants";
import TagIndexDetailItem from "components/site/tag/TagIndexDetailItem";
import Tooltip from "components/base/Tooltip";
import IndexDetailItemPopup from "components/site/popup/IndexDetailItemPopup";
// TODO: data prop will be Index object
export interface IndexDetailsItemProps {
	favicon?: string;
	title?: string;
	provided: DraggableProvided;
	snapshot?: DraggableStateSnapshot;
}

const IndexDetailsItem: React.VFC<IndexDetailsItemProps> = ({
	provided,
	snapshot,
	title,
}) => {
	const breakpoint = useBreakpoint(BREAKPOINTS, true);
	const [tags, setTags] = useState<string[]>(["Deneme"]);
	const [newTag, setNewTag] = useState<boolean>(false);

	const handleToggleNewTag = () => {
		setNewTag((oldVal) => !oldVal);
	};

	const handleNewTagEdit = (val?: string | null) => {
		if (val) {
			setTags((oldVal) => [...oldVal, val]);
		}
		setNewTag(false);
	};

	return (
		<div
			className="index-detail-list-item-wrapper"
			{...(breakpoint === "xs" || breakpoint === "sm" ? provided.dragHandleProps : undefined)}
		>
			<FlexRow className="idx-py-6 index-detail-list-item">
				{
					!(breakpoint === "xs" || breakpoint === "sm") && (
						<div {...provided.dragHandleProps}>
							<Flex className="index-detail-list-item-drag-handle">
								<IconDrag
									stroke="#000" fill="#000" />
							</Flex>
						</div>
					)
				}
				<Col xs={12}>
					<FlexRow
						wrap={false}
					>
						<Col
							className="idx-flex-grow-1"
						>
							<Text fontWeight={600}>Figma in {title}: Auto Layout</Text>
						</Col>
						<Col className="idx-flex-shrink-0 idx-ml-3 index-detail-list-item-buttons">
							<FlexRow>
								<Col>
									<Tooltip content="Add Tag">
										<Button
											size="xs"
											iconButton
											theme="clear"
											borderless
											onClick={handleToggleNewTag}
										>
											<IconTag />
										</Button>
									</Tooltip>
								</Col>
								<Col>
									<Tooltip content="Favorite">
										<Button size="xs" iconButton theme="clear" borderless><IconStar /></Button>
									</Tooltip>
								</Col>
								<Col>
									<IndexDetailItemPopup>
										<Button size="xs" iconButton theme="clear" borderless><IconContextMenu /></Button>
									</IndexDetailItemPopup>
								</Col>
							</FlexRow>
						</Col>
					</FlexRow>
				</Col>
				<Col xs={12} className="idx-mt-3">
					{<LogoMini
						className="idx-mr-3"
						width={16}
						height={16}
						style={{
							verticalAlign: "middle",
						}} />}<Text size="sm" theme="disabled">youtube.com • May 3</Text>
				</Col>
				{
					tags?.length > 0 && (
						<Col xs={12} className="idx-mt-3 idx-flex idx-flex-gap-3 idx-flex-wrap">
							{
								tags.map((t, ind) => <TagIndexDetailItem key={ind} text={t} removable />)
							}
							{
								newTag && <TagIndexDetailItem
									theme="clear"
									text=""
									placeholder="New Tag"
									editable={true}
									inputActive
									onEdit={handleNewTagEdit}
								/>
							}
						</Col>
					)
				}
			</FlexRow>
		</div>
	);
};
export default IndexDetailsItem;
