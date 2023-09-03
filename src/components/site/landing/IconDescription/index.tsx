import Header from "components/base/Header";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import cm from "./style.module.scss";

export interface IconDescriptionProps {
    icon: React.ReactNode;
    title?: string;
    description: string;
    boldDescription?: string;
}

const IconDescription: React.VFC<IconDescriptionProps> = ({
	icon,
	title,
	description,
	boldDescription,
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
						<Header className={"mb-5"}>{title}</Header>
						<Text size="xl" theme="gray5">{description} <div className={cm.italic}>{boldDescription}</div></Text>
					</Flex>
				</>
			) : (
				<>
					{icon}
					< Text size="xl" theme="gray5">{description} <div className={cm.italic}>{boldDescription}</div></Text>
				</>
			)
		}

	</Flex>
);

export default IconDescription;
