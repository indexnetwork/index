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
import { IndexLink, Link } from "types/entity";
import moment from "moment";
import { useRouter } from "next/router";
import { useCeramic } from "hooks/useCeramic";
import { useLinks } from "hooks/useLinks";
import sanitize from "sanitize-html";
import LogoLink from "components/base/Logo/LogoLink";
import { useIndex } from "hooks/useIndex";
import cm from "./style.module.scss";

// TODO: data prop will be Index object
export interface LinkItemProps {
	index_link: IndexLink;
	provided?: DraggableProvided;
	snapshot?: DraggableStateSnapshot;
	onChange?(val: IndexLink[]): void;
	search?: boolean;
	isOwner?: boolean;
	highlight?: any;
}

const LinkItem: React.VFC<LinkItemProps> = ({
	index_link,
	provided,
	snapshot,
	highlight,
	isOwner,
	search = false,
	onChange,
}) => {
	const breakpoint = useBreakpoint(BREAKPOINTS, true);
	const [toggleNewTag, setToggleNewTag] = useState<boolean>(false);
	const { links, setLinks } = useLinks();
	const { pkpCeramic } = useIndex();
	const personalCeramic = useCeramic();

	const { link } = index_link;

	const router = useRouter();

	const { indexId } = router.query;

	const handleToggleNewTag = () => {
		setToggleNewTag((oldVal) => !oldVal);
	};

	const handleNewTagEdit = async (val?: string | null) => {
		if (val) {
			const currentLink = await personalCeramic.addTag(link?.id!, val) as Link;
			const newState = links.map((l) => (l.id === index_link.id ? { ...l, link: currentLink } : l));
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
		setLinks(links?.filter((l) => l.id !== index_link.id!));
		const currentLink = await pkpCeramic.removeIndexLink(index_link);
		// onChange && onChange(doc?.content?.links || []);
	};

	const handleRemoveTag = async (val: string) => {
		const currentLink = await personalCeramic.removeTag(index_link.id!, val) as Link;
		const newState = links.map((l) => (l.id === index_link.id ? currentLink : l));
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
							<a target="_blank" rel="noreferrer" href={link?.url}>
								<Text className={cm.title} fontWeight={700} dangerouslySetInnerHTML={{ __html: sanitize((highlight && highlight["link.title"]) ? highlight["link.title"] : link?.title) }}></Text>
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
					<a target="_blank" rel="noreferrer" href={link?.url}>
						{link?.favicon ?
							<img
								className="mr-3"
								src={link?.favicon}
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
								}} />}<Text size="sm" theme="disabled">{link?.url?.substring(0, 80)} • {link?.updatedAt ? moment(link?.updatedAt).format("MMM D") : ""}</Text>
					</ a>
				</Col>
				{
					search && highlight && highlight["link.content"] && (
						<Col className="mt-5">
							<Text className="listItem" theme="secondary" dangerouslySetInnerHTML={{ __html: sanitize(highlight["link.content"]) }}></Text>
						</Col>
					)
				}
				<Col>
				</Col>
				{
					!search && <Col xs={12} className="mt-3 idxflex idxflex-gap-3 idxflex-wrap">
						{
							link?.tags?.map((t, ind) => (
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
export default LinkItem;
