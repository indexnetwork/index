import Col from "layout/base/Grid/Col";
import FlexRow from "layout/base/Grid/FlexRow";
import Text from "components/base/Text";
import React, { useEffect } from "react";
import Button from "components/base/Button";
import IconTag from "components/base/Icon/IconTag";
import IconStar from "components/base/Icon/IconStar";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import LogoMini from "components/base/Logo/LogoMini";
import { DraggableProvided } from "react-beautiful-dnd";
import IconDrag from "components/base/Icon/IconDrag";
import Flex from "layout/base/Grid/Flex";
import { useBreakpoint } from "hooks/useBreakpoint";
import { BREAKPOINTS } from "utils/constants";
// TODO: data prop will be Index object
export interface IndexDetailsListItemProps {
	favicon?: string;
	title?: string;
	provided: DraggableProvided;
}

const IndexDetailsListItem: React.VFC<IndexDetailsListItemProps> = ({
	provided,
	title,
}) => {
	const breakpoint = useBreakpoint(BREAKPOINTS, true);
	useEffect(() => {
		console.log(provided);
	}, [provided]);
	return (
		<div
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
									<Button size="xs" iconButton theme="clear" borderless><IconTag /></Button>
								</Col>
								<Col>
									<Button size="xs" iconButton theme="clear" borderless><IconStar /></Button>
								</Col>
								<Col>
									<Button size="xs" iconButton theme="clear" borderless><IconContextMenu /></Button>
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
			</FlexRow>
		</div>
	);
};
export default IndexDetailsListItem;
