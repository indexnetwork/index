import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import Row from "layout/base/Grid/Row";
import React from "react";
import Col from "layout/base/Grid/Col";
import Header from "components/base/Header";
import Avatar from "components/base/Avatar";
import IconWorld from "components/base/Icon/IconWorld";
import Flex from "layout/base/Grid/Flex";
import SelectUserRight from "components/site/select/SelectUserRight";
import CopyInput from "components/base/CopyInput";
import Divider from "components/base/Divider";
import UserSearchInput from "components/site/input/UserSearchInput";
import UserCard from "components/site/card/UserCard";
import InviteByLink from "components/site/custom/InviteByLink";

export interface ShareModalProps extends Omit<ModalProps, "body" | "header" | "footer"> {
	data: any;
}

const ShareModal: React.VFC<ShareModalProps> = ({
	data,
	...modalProps
}) => {
	const test = 2;
	return <Modal
		{...modalProps}
		destroyOnClose
		body={(
			<Row>
				<Col xs={12}>
					<Text className="idx-mt-0 idx-mb-6" element="p" fontWeight={600}>Visibility</Text>
					<Flex
						alignItems="center"
						className="idx-mb-5"
					>
						<Avatar bgColor="var(--gray-2)"
							size={40}
						>
							<IconWorld
								width={30}
								height={30}
								style={{
									stroke: "var(--gray-5)",
									strokeWidth: "1",
									width: "2.5rem",
									height: "2.5rem",
								}} />
						</Avatar>
						<Flex flexDirection="column" flexWrap="wrap" flexGrow={1} className="idx-ml-6">
							<Text>Public</Text>
							<Text theme="secondary" size="sm">Anyone on the internet can find and access</Text>
						</Flex>
						<SelectUserRight value="view" />
					</Flex>
					<CopyInput
						value="https://asdaasdasdasdsasd.com" />
					<Divider className="idx-my-6" />
				</Col>
				<Col xs={12}>
					<Text className="idx-mt-0 idx-mb-6" element="p" fontWeight={600}>Invite collaborators by username or email</Text>
					<UserSearchInput />
				</Col>
				<Col xs={12}>
					<UserCard className="idx-py-5" owner showUserRight right="view" title="cnsndeniz@gmail.com" subtitle="Hasn't joined yet, tap to send invitation" />
					<UserCard className="idx-py-5" showUserRight right="view" title="cnsndeniz@gmail.com" subtitle="Hasn't joined yet, tap to send invitation" />
					<UserCard className="idx-py-5" showUserRight right="view" title="cnsndeniz@gmail.com" subtitle="Hasn't joined yet, tap to send invitation" />
				</Col>
				<Col xs={12}>
					<InviteByLink />
				</Col>
			</Row>
		)}
		header={<Header>Share</Header>}
	>

	</Modal>;
};

export default ShareModal;
