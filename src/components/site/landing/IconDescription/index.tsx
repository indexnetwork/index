import Header from "components/base/Header";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";

export interface IconDescriptionProps {
	icon: React.ReactNode;
	title?: string;
	description: string;
}

const IconDescription: React.VFC<IconDescriptionProps> = ({
	icon,
	title,
	description,
}) => (
	<Flex
		gap="1.6rem"
		flex={1}
		className="lnd-icon-desc"
	>
		{
			title ? (
				<>
					{icon}
					<Flex className="lnd-icon-desc-text">
						<Header>{title}</Header>
						<Text size="xl" theme="gray5">{description}</Text>
					</Flex>
				</>
			) : (
				<>
					{ icon }
					< Text size="xl" theme="gray5">{description}</Text>
				</>
			)
		}

	</Flex >
);

export default IconDescription;
