import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Text from "components/base/Text";
import React, { useState } from "react";
import Button from "components/base/Button";
import IconTag from "components/base/Icon/IconTag";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import { DraggableProvided, DraggableStateSnapshot } from "react-beautiful-dnd";
import IconDrag from "components/base/Icon/IconDrag";
import Flex from "components/layout/base/Grid/Flex";
import { useBreakpoint } from "hooks/useBreakpoint";
import { BREAKPOINTS } from "utils/constants";
import TagIndexDetailItem from "components/site/tag/TagIndexDetailItem";
import Tooltip from "components/base/Tooltip";
import IndexDetailItemPopup from "components/site/popup/IndexDetailItemPopup";
import { Links } from "types/entity";
import moment from "moment";
import { useRouter } from "next/router";
import { useCeramic } from "hooks/useCeramic";
import { useLinks } from "hooks/useLinks";
import sanitize from "sanitize-html";
import LogoLink from "components/base/Logo/LogoLink";
import cm from "./style.module.scss";

// TODO: data prop will be Index object
export interface IndexDetailsItemProps extends Links {
	favicon?: string;
	provided?: DraggableProvided;
	snapshot?: DraggableStateSnapshot;
	onChange?(val: Links[]): void;
	search?: boolean;
	isOwner?: boolean;
}

const IndexDetailsItem: React.VFC<IndexDetailsItemProps> = ({
	provided,
	snapshot,
	isOwner,
	id,
	title,
	highlight,
	url,
	updated_at,
	content,
	favorite,
	tags = [],
	favicon,
	search = false,
	onChange,
}) => {
	const breakpoint = useBreakpoint(BREAKPOINTS, true);
	const [toggleNewTag, setToggleNewTag] = useState<boolean>(false);
	const { links, setLinks } = useLinks();

	const router = useRouter();

	const { indexId } = router.query;

	const ceramic = useCeramic();

	const handleToggleNewTag = () => {
		setToggleNewTag((oldVal) => !oldVal);
	};

	const handleNewTagEdit = async (val?: string | null) => {
		if (val) {
			const link = await ceramic.addTag(id!, val) as Links;
			const newState = links.map((l) => (l.id === id ? link : l));
			setLinks(newState);
		}
		setToggleNewTag(false);
		setTimeout(() => {
			handleToggleNewTag();
		}, 0);
	};
	const handleCloseTag = () => {
		setToggleNewTag(false);
	};

	const handleSetFavorite = async () => {

	};

	const handleRemove = async () => {
		setLinks(links?.filter((l) => l.id !== id!));
		const link = await ceramic.removeLinkFromIndex(indexId as string, id!);
		// onChange && onChange(doc?.content?.links || []);
	};

	const handleRemoveTag = async (val: string) => {
		const link = await ceramic.removeTag(id!, val) as Links;
		const newState = links.map((l) => (l.id === id ? link : l));
		setLinks(newState);
	};
	return (
		<div
			className="index-detail-list-item-wrapper"
			{...(breakpoint === "xs" || breakpoint === "sm" ? (provided && provided.dragHandleProps) : undefined)}
		>
			<FlexRow className="py-6 index-detail-list-item">
				{
					!search && isOwner && !(breakpoint === "xs" || breakpoint === "sm") && (
						<div {...(provided ? provided.dragHandleProps : undefined)}>
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
							className="idxflex-grow-1"
						>
							<a target="_blank" rel="noreferrer" href={url}>
								<Text className={cm.title} fontWeight={700} dangerouslySetInnerHTML={{ __html: sanitize((highlight?.title ? highlight.title : title) || "") }}></Text>
							</a>
						</Col>
						{
							!search && isOwner && (
								<Col className="idxflex-shrink-0 ml-3 index-detail-list-item-buttons">
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
										{/* <Col>
											<Tooltip content="Favorite">
												<Button
													size="xs"
													iconButton
													theme="clear"
													borderless
													onClick={handleSetFavorite}
												>
													<IconStar fill={favorite ? "var(--blue)" : "none"} stroke={favorite ? "var(--blue)" : undefined}/>
												</Button>
											</Tooltip>
										</Col> */}
										<Col>
											<IndexDetailItemPopup onDelete={handleRemove}>
												<Button
													size="xs"
													iconButton
													theme="clear"
													borderless><IconContextMenu /></Button>
											</IndexDetailItemPopup>
										</Col>
									</FlexRow>
								</Col>
							)
						}
					</FlexRow>
				</Col>
				<Col xs={12} className="mt-2">
					<a target="_blank" rel="noreferrer" href={url}>
						{favicon ?
							<img
								className="mr-3"
								src={favicon}
								alt="favicon"
								width={16}
								height={16}
								style={{
									verticalAlign: "middle",
								}} /> :
							<LogoLink
								className="mr-3"
								width={16}
								height={16}
								style={{
									verticalAlign: "middle",
								}} />}<Text size="sm" theme="disabled">{url?.substring(0, 80)} • {updated_at ? moment(updated_at).format("MMM D") : ""}</Text>
					</ a>
				</Col>
				{
					search && highlight && highlight.content && (
						<Col className="mt-5">
							<Text className="listItem" theme="secondary" dangerouslySetInnerHTML={{ __html: sanitize(highlight.content) }}></Text>
						</Col>
					)
				}
				<Col>
				</Col>
				{
					!search && <Col xs={12} className="mt-3 idxflex idxflex-gap-3 idxflex-wrap">
						{
							tags.map((t, ind) => (
								<TagIndexDetailItem
									key={ind}
									text={t}
									removable
									onRemove={handleRemoveTag}
								/>))
						}
						{
							toggleNewTag && <TagIndexDetailItem
								theme="clear"
								text=""
								placeholder="New Tag"
								editable={true}
								inputActive
								onEdit={handleNewTagEdit}
								onBlur={handleToggleNewTag}
							/>
						}

					</Col>
				}
			</FlexRow>
		</div>
	);
};
export default IndexDetailsItem;
