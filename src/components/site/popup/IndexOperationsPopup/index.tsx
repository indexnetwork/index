import Dropdown from "components/base/Dropdown";
import Text from "components/base/Text";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import IconCopy from "components/base/Icon/IconCopy";
import Button from "components/base/Button";
import { useOwner } from "hooks/useOwner";
import { copyToClipboard } from "utils/helper";
import IconRemove from "components/base/Icon/IconRemove";

export interface IndexOperationsPopupProps {
	is_in_my_indexes: boolean,
	streamId: string;
	mode?: "indexes-page" | "index-detail-page";
	isOwner?: boolean;
	userIndexToggle(index_id: string, type: string, op: string): void;
}

const IndexOperationsPopup: React.VFC<IndexOperationsPopupProps> = ({
	streamId,
	is_in_my_indexes = false,
	mode = "indexes-page",
	userIndexToggle,
}) => {
	const { isOwner } = useOwner();
	return (
		<Dropdown
			menuClass="index-list-item-menu ml-6"
			position="bottom-right"
			menuItems={
				<>
					{/* {
					mode === "indexes-page" && (
						<DropdownMenuItem>
							<Flex alignItems="center">
								<IconPeople width={12} height="100%" />
								<Text className="ml-3" element="span" size="sm" theme="secondary"> Share</Text>
							</Flex>
						</DropdownMenuItem>
					)
				} */}
					{/* <DropdownMenuItem>
					<Flex alignItems="center">
						<IconIntegration width={12} height="100%" />
						<Text className="ml-3" element="span" size="sm" theme="secondary"> Integrations</Text>
					</Flex>
				</DropdownMenuItem> */}
					{/* <DropdownMenuItem>
						<Flex alignItems="center">
							<IconEmbed width={16} height="100%" />
							<Text className="ml-3" element="span" size="md" theme="primary"> Embed</Text>
						</Flex>
					</DropdownMenuItem>

					<DropdownMenuItem
						onClick={handleClone}
					>
						<Flex alignItems="center">
							<IconCopy width={16} height="100%" />
							<Text className="ml-3" element="span" size="md" theme="primary"> Clone</Text>
						</Flex>
					</DropdownMenuItem>
					*/}
					<DropdownMenuItem onClick={() => {
						copyToClipboard(`${window.location.href}`);
					}}>
						<Flex alignItems="center">
							<IconCopy />
							<Text className="ml-3" element="span" size="md" > Copy Link</Text>
						</Flex>
					</DropdownMenuItem>
					{
						isOwner && (
							is_in_my_indexes ? (
								<>
									<DropdownMenuItem divider />
									<DropdownMenuItem
										onClick={() => userIndexToggle(streamId, "my_indexes", "remove")}
									>
										<Flex alignItems="center">
											<IconRemove />
											<Text className="ml-3" element="span" size="md" >Remove from my indexes</Text>
										</Flex>
									</DropdownMenuItem>
								</>
							) : (
								<>
									<DropdownMenuItem divider />
									<DropdownMenuItem
										onClick={() => userIndexToggle(streamId, "my_indexes", "add")}
									>
										<Flex alignItems="center">
											<IconRemove />
											<Text className="ml-3" element="span" size="md" >Add to my indexes</Text>
										</Flex>
									</DropdownMenuItem>
								</>
							)
						)
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
