import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Text from "components/base/Text";
import React, { useState } from "react";
import Button from "components/base/Button";
import IconTag from "components/base/Icon/IconTag";
import IconContextMenu from "components/base/Icon/IconContextMenu";
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
import { useIndex } from "hooks/useIndex";
import cm from "./style.module.scss";

// TODO: data prop will be Index object
export interface LinkItemProps {
	index_link: IndexLink;
	onChange?(val: IndexLink[]): void;
	search?: boolean;
}

const LinkItem: React.VFC<LinkItemProps> = ({
	index_link,
	search = false,
	onChange,
}) => {
	const breakpoint = useBreakpoint(BREAKPOINTS, true);
	const [toggleNewTag, setToggleNewTag] = useState<boolean>(false);
	const { links, setLinks } = useLinks();
	const { pkpCeramic, roles } = useIndex();
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
	const handleRemove = async () => {
		setLinks(links?.filter((l) => l.id !== index_link.id!));
		const currentLink = await pkpCeramic.removeIndexLink(index_link);
		// onChange && onChange(doc?.content?.links || []);
	};

	const handleRemoveTag = async (val: string) => {
		const currentLink = await personalCeramic.removeTag(index_link.linkId!, val) as Link;
		const newState = links.map((l) => (l.linkId === index_link.linkId ? { ...l, link: currentLink } : l));
		setLinks(newState);
	};
	return (
		<div className="index-detail-list-item-wrapper">
			<FlexRow className="py-3 index-detail-list-item">
				<Col xs={12}>
					<FlexRow wrap={false}>
						<Col className="idxflex-grow-1" >
							<a target="_blank" rel="noreferrer" href={link?.url}>
								<Text className={cm.title} fontWeight={700} dangerouslySetInnerHTML={{ __html: sanitize((index_link.highlight && index_link.highlight["link.title"]) ? index_link.highlight["link.title"] : link?.title as string) }}></Text>
							</a>
						</Col>
						{
							!search && roles.creator() && (
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
						<img
							className="mr-3"
							src={link?.favicon || "/images/globe.svg"}
							alt="favicon"
							width={16}
							height={16}
							onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
								const target = e.target as HTMLImageElement;
								target.onerror = null; // Prevents infinite loop in case fallback image also fails
								target.src = "/images/globe.svg";
							}}
							style={{
								verticalAlign: "middle",
							}} />
						<Text size="sm" theme="disabled">{link?.url?.substring(0, 80)} • {link?.updatedAt ? moment(link?.updatedAt).format("MMM D") : ""}</Text>
					</ a>
				</Col>
				{
					search && index_link.highlight && index_link.highlight["link.content"] && (
						<Col className="mt-5">
							<Text className="listItem" theme="secondary" dangerouslySetInnerHTML={{ __html: sanitize(index_link.highlight["link.content"]) }}></Text>
						</Col>
					)
				}
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
