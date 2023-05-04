import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import Row from "components/layout/base/Grid/Row";
import React from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Button from "components/base/Button";
import Link from "next/link";

import { useAppDispatch } from "hooks/store";
import { setOriginNFTModalVisible } from "store/slices/connectionSlice";

export interface CreateModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {}

const OriginWarningModal = ({
	...modalProps
} : any) => {
	const dispatch = useAppDispatch();

	const handleClose = () => {
		dispatch(setOriginNFTModalVisible(false));
	};
	return <Modal
		{...modalProps}
		onClose={handleClose}
		size={"xs"}
		body={(
			<>
				<Row
				>
					<Col xs={12}
					>
						<Flex
							alignItems="center"

						>
							<Flex flexDirection="column" flexWrap="wrap" flexGrow={1} className="ml-3">
								<Text size="lg" >
                                    To access the beta version, please fill out a short form.
									<br />
									Once done, we will send you an NFT for access.
									<br />
								</Text>
							</Flex>
						</Flex>

						<Col pullLeft>
							<Button
								className="mt-7 pl-8 pr-8 ml-3"
								size="lg"
								theme="clear"
								onClick={handleClose}
							>Cancel</Button>
						</Col>
						<Col pullRight>
							<Link
								href={"https://google.com"} target={"_blank"}>
								<Button
									theme="primary"
									size="lg"
									className="mt-7 pl-8 pr-8 mr-2"
								>Apply for beta</Button>
							</Link>
						</Col>

					</Col>
				</Row>
			</>
		)}
		header={<Header className="mt-3" level={3}>We should meet!</Header>}
	>

	</Modal>;
};

export default OriginWarningModal;
