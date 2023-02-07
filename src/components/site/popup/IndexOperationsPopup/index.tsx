import Dropdown from "components/base/Dropdown";
import Text from "components/base/Text";
import DropdownMenuItem from "components/base/Dropdown/DropdownMenuItem";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import IconCopy from "components/base/Icon/IconCopy";
import Button from "components/base/Button";
import api from "services/api-service";
import { useOwner } from "hooks/useOwner";
import { useCeramic } from "hooks/useCeramic";
import { useRouter } from "next/router";
import { copyToClipboard } from "utils/helper";
import IconRemove from "components/base/Icon/IconRemove";

export interface IndexOperationsPopupProps {
	streamId: string;
	mode?: "indexes-page" | "index-detail-page";
	isOwner?: boolean;
	onDelete(streamId?: string): void;
	onClone?(streamId?: string): void;
}

const IndexOperationsPopup: React.VFC<IndexOperationsPopupProps> = ({
	streamId,
	mode = "indexes-page",
	onDelete,
	onClone,
}) => {
	const { isOwner, did } = useOwner();
	const ceramic = useCeramic();
	const router = useRouter();

	const handleDelete = async () => {
		const result = await api.deleteIndex(streamId);
		if (result) {
			onDelete && onDelete(streamId);
		}
	};

	const handleClone = async () => {
		/*
		const originalDoc = await ceramic.getIndexById(streamId!);

		const content = { ...originalDoc.content };
		content.clonedFrom = streamId!;
		content.did = did!;

		delete (content as any).did;
		delete (content as any).streamId;

		const doc = await ceramic.createIndex(content);
		onClone && onClone();
		if (doc != null) {
			router.push(`/${did}/${doc.streamId.toString()}`);
		}
		 */
	};

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
							<IconCopy width={20} height="100%" />
							<Text className="ml-3" element="span" size="md" > Copy Link</Text>
						</Flex>
					</DropdownMenuItem>
					{
						isOwner && <>
							<DropdownMenuItem divider />
							<DropdownMenuItem
								onClick={handleDelete}
							>
								<Flex alignItems="center">
									<IconRemove width={20} height="100%" className="icon-error" />
									<Text className="ml-3" element="span" size="md" >Remove</Text>
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
