import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import Row from "components/layout/base/Grid/Row";
import React, { useState } from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Input from "components/base/Input";
import Button from "components/base/Button";
import { useRouter } from "next/router";
import { useCeramic } from "hooks/useCeramic";
import { useAppSelector } from "hooks/store";
import { useMergedState } from "hooks/useMergedState";
import { useTranslation } from "next-i18next";
import { selectConnection } from "store/slices/connectionSlice";
import { Indexes } from "types/entity";
import IconGreenAdd from "components/base/Icon/IconGreenAdd";
import IconClock from "components/base/Icon/IconClock";

export interface TokenModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {
	data: any;
}

const TokenModal: React.VFC<TokenModalProps> = ({
	data,
	...modalProps
}) => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const handleClose = () => {
		modalProps.onClose?.();
	};
	const ceramic = useCeramic();

	const { did } = useAppSelector(selectConnection);

	const [crawling, setCrawling] = useState(false);

	const [stream, setStream] = useMergedState<Partial<Indexes>>({
		title: "",
	});

	const [loading, setLoading] = useState(false);

	const handleCreate = async () => {
		if (stream.title) {
			const doc = await ceramic.createIndex(stream);
			if (doc != null) {
				router.push(`/${did}/${doc.id}`);
				modalProps.onClose?.();
			}
		}
		setLoading(false);
	};
	const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		const { value } = target;
		setStream({
			title: value,
		});
	 };
	return <Modal
		{...modalProps}
		size={"fit"}
		destroyOnClose
		body={(
			<>
				<Row
				>
					<Col xs={12}
					>
						<Flex
							alignItems="center"
							className=""
						>
                            <Col pullLeft>
							<Flex flexDirection="column" flexWrap="wrap" flexGrow={3} className="ml-2">
							</Flex>
                            </Col>
						</Flex>
						<Flex>
							<Col pullLeft>
                        	<Button
                                size="xl"
                                theme="clear" 
                                className="mt-1 pr-5 mb-5 pt-5 pb-5 mr-5">
                                   <Col className="mt-4 ml-3" pullLeft>
                                   <IconGreenAdd width={24} height={24}></IconGreenAdd>
								   </Col>
								   <Col className="mt-10">
								   <Text size="xl">Create New Token</Text>
								   </Col>
								   <br></br>
								   <Col pullLeft>
                                   <Text>Create new token/NFT easily, choose your terms and add rule for your curators</Text>
								   </Col>
							 </Button>
							</Col>
							<Col pullRight>
                        <Button
                                size="xl"
                                theme="clear" 
                                className="mt-1 pr-5 mb-5 pt-5 pb-3 ml-5">
                                    <IconClock width={24} height={24}></IconClock>
                                   <Header>Existing Token</Header>
                                   <Text>Add existing token as a curator rule</Text>
                        </Button>
						</Col>
						</Flex>
						<Flex>
						<Col pullLeft>
                        <Button
                                size="xl"
                                theme="clear" 
                                className="mt-1 mr-6 pt-10 pb-10 pl-6 pr-10 ">
                                   <Header>Individual </Header>
								   <Header>Wallet ID</Header>
                        </Button>
						</Col>
						<Col pullLeft>
                        <Button
                                size="xl"
                                theme="clear" 
                                className="mt-1 mr-6 pt-10 pb-10 pl-6 pr-10">
                                   <Header>DAO Member</Header>
                        </Button>
						</Col>
						<Col pullRight>
                        <Button
                                size="xl"
                                theme="clear" 
                                className="mt-1 mr-6 pt-10 pb-10 pl-6 pr-8 ">
                                   <Header>POAP</Header>
								   <Header>Collector</Header>
                        </Button>
						</Col>
						</Flex>
						

					</Col>
				</Row>
			</>
		)}
		header={<Header>Add New Rule</Header>}
	>

	</Modal>;
};

export default TokenModal;
