import Avatar from "components/base/Avatar";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import { Indexes } from "types/entity";
import sanitize from "sanitize-html";
import { useRouter } from "next/router";
import cc from "classcat";
import cm from "./style.module.scss";
import { maskDID } from "../../../../utils/helper";
import FlexRow from "../../../layout/base/Grid/FlexRow";

export interface IndexItemProps {
	index: Indexes,
	selected: boolean,
	onClick?(): Promise<void>;
}

const IndexItem: React.VFC<IndexItemProps> = ({
	index,
	selected,
	onClick,
}) => {
	const router = useRouter();
	const { indexId } = router.query;
	return <FlexRow onClick={onClick} className={cc([
		selected ? "index-list-item-selected" : "index-list-item",
		"p-6",
	])} wrap={false} align={"center"}>
		<Col>
			<Avatar maxLetters={4} size={40}>{maskDID(index.controllerDID.id)}</Avatar>
		</Col>
		<Col className="px-3">
			<Flex flexDirection={"column"} >
				<Text className={"my-0"} size="sm" verticalAlign="middle" fontWeight={500} element="p">{maskDID(index.controllerDID.id) || ""}</Text>
				<Header level={4} className={cm.title} dangerouslySetInnerHTML={{ __html: sanitize(index.title || "") }}></Header>
			</Flex>
		</Col>
	</FlexRow>;
};

export default IndexItem;
