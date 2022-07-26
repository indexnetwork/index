import Dropdown from "components/base/Dropdown";
import Text from "components/base/Text";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import Flex from "layout/base/Grid/Flex";
import React from "react";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import IconEmbed from "components/base/Icon/IconEmbed";
import IconCopy from "components/base/Icon/IconCopy";
import IconLink1 from "components/base/Icon/IconLink1";
import IconTrash from "components/base/Icon/IconTrash";
import Button from "components/base/Button";
import api from "services/api-service";

export interface IndexOperationsPopupProps {
	streamId: string;
	mode?: "indexes-page" | "index-detail-page";
	isOwner?: boolean;
	onDelete(streamId?: string): void;
}

const IndexOperationsPopup: React.VFC<IndexOperationsPopupProps> = ({
	streamId,
	mode = "indexes-page",
	isOwner = false,
	onDelete,
}) => {
	const handleDelete = async () => {
		const result = await api.deleteIndex(streamId);
		if (result) {
			onDelete && onDelete(streamId);
		}
	};

	return (
		<Dropdown
			menuClass="index-list-item-menu idx-ml-6"
			position="bottom-right"
			menuItems={
				<>
					{/* {
					mode === "indexes-page" && (
						<DropdownMenuItem>
							<Flex alignItems="center">
								<IconPeople width={12} height="100%" />
								<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Share</Text>
							</Flex>
						</DropdownMenuItem>
					)
				} */}
					{/* <DropdownMenuItem>
					<Flex alignItems="center">
						<IconIntegration width={12} height="100%" />
						<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Integrations</Text>
					</Flex>
				</DropdownMenuItem> */}
					<DropdownMenuItem>
						<Flex alignItems="center">
							<IconEmbed width={12} height="100%" />
							<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Embed</Text>
						</Flex>
					</DropdownMenuItem>
					<DropdownMenuItem>
						<Flex alignItems="center">
							<IconCopy width={12} height="100%" />
							<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Clone</Text>
						</Flex>
					</DropdownMenuItem>
					<DropdownMenuItem>
						<Flex alignItems="center">
							<IconLink1 width={12} height="100%" />
							<Text className="idx-ml-3" element="span" size="sm" theme="secondary"> Copy Link</Text>
						</Flex>
					</DropdownMenuItem>
					{
						isOwner && <>
							<DropdownMenuItem divider />
							<DropdownMenuItem
								onClick={handleDelete}
							>
								<Flex alignItems="center">
									<IconTrash width={12} height="100%" className="idx-icon-error" />
									<Text className="idx-ml-3" element="span" size="sm" theme="error"> Delete</Text>
								</Flex>
							</DropdownMenuItem>
						</>
					}

				</>
			}
		>
			{
				mode === "indexes-page" ? (
					<IconContextMenu width={20} height={20} className="index-list-item-menu-btn" />
				) : (
					<Button iconButton theme="clear" size="sm">
						<IconContextMenu
							width={16}
							height={16}
						/>
					</Button>
				)
			}
		</Dropdown >
	);
};

export default IndexOperationsPopup;
