import Text from "components/base/Text";

import React from "react";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import IconClose from "components/base/Icon/IconClose";
import CopyInput from "components/base/CopyInput";

export interface InviteByLinkItemProps {
	editor?: boolean;
}

const InviteByLinkItem: React.VFC<InviteByLinkItemProps> = ({
	editor,
}) => (
	<FlexRow
	>
		<Col
			xs={12}
			className="mb-3"
		>
			<Text element="span">
				{`${editor ? "Editor" : "Viewer"} invite link`}
				<Text className="ml-3" element="span" size="xs" theme="secondary">
					(Created 3 days ago)
				</Text>
			</Text>
		</Col>
		<Col className="idxflex-grow-1">
			<CopyInput
				value="https://asdaasdasdasdsasd.com" />
		</Col>
		<Col className="idxflex idxflex-a-center idxflex-j-end ml-3">
			<IconClose className="pointer"/>
		</Col>
	</FlexRow>
);

export default InviteByLinkItem;
