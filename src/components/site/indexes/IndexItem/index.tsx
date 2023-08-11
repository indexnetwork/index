import Avatar from "components/base/Avatar";
import Header from "components/base/Header";
import Text from "components/base/Text";
import LinkItem from "components/site/index-details/LinkItem";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import Row from "components/layout/base/Grid/Row";
import moment from "moment";
import React from "react";
import { Indexes, IndexLink } from "types/entity";
import sanitize from "sanitize-html";
import List from "components/base/List";
import IndexOperationsPopup from "components/site/popup/IndexOperationsPopup";
import Tooltip from "components/base/Tooltip";
import Button from "components/base/Button";
import IconStar from "components/base/Icon/IconStar";
import cm from "./style.module.scss";

export interface IndexItemProps {
	index: Indexes,
	hasSearch: boolean;
	isOwner: boolean;
	onClick?(): Promise<void>;
	userIndexToggle(index_id: string, type: string, op: string): void;
}

const IndexItem: React.VFC<IndexItemProps> = ({
	index,
	hasSearch = false,
	isOwner = false,
	userIndexToggle,
	onClick,
}) => <Row
	className="index-list-item my-6"
>
	<Col
		xs={12}
		className="mb-3"
	>
		<Avatar size={20}>{index.controllerDID.id}</Avatar>
		<Text className="ml-3" size="sm" verticalAlign="middle" fontWeight={500} element="span">{index.controllerDID.id || ""}</Text>
	</Col>
	<Col
		xs={12}
		className="mb-2"
	>
		<Flex
			justifyContent="space-between"
			alignItems="center"
		>
			<Col
				className="idxflex-grow-1 mr-5"
			>
				<Header onClick={onClick} className={cm.title} dangerouslySetInnerHTML={{ __html: sanitize(index.title || "") }}></Header>
			</Col>
			<Col className="mr-2 mt-2">
				<Tooltip content="Add to Starred Index">
					<Button
						iconHover
						theme="clear"
						borderless
						onClick={() => userIndexToggle(index.id, "starred", index.is_starred ? "remove" : "add") }>
						<IconStar fill={index.is_starred ? "var(--main)" : "var(--white)"} width={20} height={20} />
					</Button>
				</Tooltip>
			</Col>
			<Col className="ml-1">
				<Button
					className="pt-2"
					iconHover
					theme="clear"
					borderless>
					<IndexOperationsPopup
						streamId={index.id}
						is_in_my_indexes={index.is_in_my_indexes!}
						isOwner={isOwner}
						userIndexToggle={userIndexToggle}
					/>
				</Button>
			</Col>
		</Flex>
	</Col>
	<Col xs={12}>
		<Text size="sm" theme="disabled">Updated {index.updatedAt ? moment(index.updatedAt).fromNow() : ""}</Text>
	</Col>
	{

		hasSearch && index.links && <Col xs={12} style={{
			paddingLeft: 16,
		}}>
			<List
				data={index.links || []}
				listClass="index-list"
				render={(l: IndexLink) => <LinkItem search index_link={l} />}
				divided
			/>
		</Col>
	}
</Row>;

export default IndexItem;
