import React from "react";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Modal from "components/base/Modal";
import Button from "components/base/Button";
import Row from "components/layout/base/Grid/Row";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";

const ConfirmTransaction = ({
	handleCancel,
	...modalProps
} : any) => {
	const handleClose = () => {
		modalProps.onClose?.();
	};
	return <Modal
		{...modalProps}
		size={"fit"}
		destroyOnClose
		body={(
			<>
				<Row>

				</Row>
				<Flex alignItems="center">
					<video
						autoPlay
						loop
						muted
						playsInline
						className={"p-0"}
						style={{
							width: "60%",
							margin: "auto",
						}}
					>
						<source src="/video/loadingPerspective.mp4" type="video/mp4" />
					</video>

				</Flex>

			</>
		)}
		header={<>
			<Header level={2}>Waiting for transaction confirmation</Header>
			<Text className={"mt-4"} element={"p"}>Please confirm two transactions with your connected wallet.</Text>
		</>}
		footer={<>
			<Row >
				<Col pullLeft>
					<Button
						onClick={handleCancel}
						className="pl-8 pr-8 "
						size="lg"
						theme="clear"
					>Cancel</Button>
				</Col>
				<Col pullRight>
					<Button

						theme="primary"
						size="lg"
						className="pl-6 pr-6"
						loading={true}
						disabled={true}
					>Loading</Button>
				</Col>
			</Row>
		</>}
	>

	</Modal>;
};

export default ConfirmTransaction;
