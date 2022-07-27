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
			className="idx-mb-3"
		>
			<Text element="span">
				{`${editor ? "Editor" : "Viewer"} invite link`}
				<Text className="idx-ml-3" element="span" size="xs" theme="secondary">
					(Created 3 days ago)
				</Text>
			</Text>
		</Col>
		<Col className="idx-flex-grow-1">
			<CopyInput
				value="https://asdaasdasdasdsasd.com" />
		</Col>
		<Col className="idx-flex idx-flex-a-center idx-flex-j-end idx-ml-3">
			<IconClose className="idx-pointer"/>
		</Col>
	</FlexRow>
);

export default InviteByLinkItem;
