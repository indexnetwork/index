import Avatar from "components/base/Avatar";
import Text from "components/base/Text";
import SelectUserRight from "components/site/select/SelectUserRight";
import Col from "layout/base/Grid/Col";
import Flex from "layout/base/Grid/Flex";
import FlexRow from "layout/base/Grid/FlexRow";
import React from "react";
import { UserRightType } from "types";

export interface UserCardProps {
	showRightsSelect?: boolean;
	title?: string;
	subtitle?: string;
	right?: UserRightType;
	onRightsChanged?(newRight: UserRightType): void;
}

const UserCard: React.VFC<UserCardProps> = ({
	title,
	subtitle,
	right,
	showRightsSelect = false,
	onRightsChanged,
}) => (
	<FlexRow align="center" className="idx-px-5 idx-py-5 idx-hoverable">
		<Col>
			<Avatar size={40} maxLetters={2} randomColor contentRatio={0.35}>SS</Avatar>
		</Col>
		<Col className="idx-flex-grow-1 idx-ml-6">
			<Flex flexDirection="column">
				<Text theme="gray5">{title}</Text>
				<Text size="sm" theme="secondary">{subtitle}</Text>
			</Flex>
		</Col>
		{
			showRightsSelect && (
				<Col>
					<SelectUserRight value={right} onChange={onRightsChanged} />
				</Col>
			)
		}

	</FlexRow>
);

export default UserCard;
