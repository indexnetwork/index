import Header from "components/base/Header";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";

export interface IconDescriptionProps {
	icon: React.ReactNode;
	title: string;
	description: string;
}

const IconDescription: React.VFC<IconDescriptionProps> = ({
	icon,
	title,
	description,
}) => (
	<Flex
		flexDirection="column"
		gap="1rem"
		flex={1}
	>
		{icon}
		<Header>{title}</Header>
		<Text theme="secondary">{description}</Text>
	</Flex>
);

export default IconDescription;
