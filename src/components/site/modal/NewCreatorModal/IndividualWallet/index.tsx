import React, { useEffect, useState } from "react";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Input from "components/base/Input";
import Select, { SelectProps } from "components/base/Select";
import Option from "components/base/Select/Option";
import Button from "../../../../base/Button";
import Row from "../../../../layout/base/Grid/Row";

export interface SelectNFTOptionsProps {
	handleBack?(): void;
}

const IndividualWallet: React.VFC<SelectNFTOptionsProps> = ({ handleBack }) => {
	return (
		<>
			<FlexRow>
				<Col className="mt-6" xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md">Choose network:</Text>
						<Select value={"2"} bordered size="md" className={"mt-3"}>
							<Option value="view"><Text size="md">Ethereum</Text></Option>
							<Option value="1"><Text size="md">Polygon</Text></Option>
							<Option value="2"><Text size="md">Solana</Text></Option>
							<Option value="3"><Text size="md">Optimism</Text></Option>
						</Select>
					</Flex>
				</Col>
				<Col className="mt-6" xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md">Wallet address or blockchain domain (e.g. ENS):</Text>
						<Input
							name="name"
							className="mt-3"
						/>
					</Flex>
				</Col>
			</FlexRow>
			<Row>
				<Col pullLeft>
					<Button
						onClick={handleBack}
						className="mt-7 pl-8 pr-8 "
						size="lg"
						theme="clear"
					>Back</Button>
				</Col>
				<Col pullRight>
					<Button

						theme="primary"
						size="lg"
						className="mt-7 pl-8 pr-8"
					>Add rule</Button>
				</Col>
			</Row>
		</>
	);
};

export default IndividualWallet;
