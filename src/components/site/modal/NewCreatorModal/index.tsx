import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import React, { useState } from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";

import Button from "components/base/Button";
import { useRouter } from "next/router";
import { useCeramic } from "hooks/useCeramic";
import { useAppSelector } from "hooks/store";
import { useMergedState } from "hooks/useMergedState";
import { useTranslation } from "next-i18next";
import { selectConnection } from "store/slices/connectionSlice";
import {AccessControlCondition, Indexes} from "types/entity";
import IconGreenAdd from "components/base/Icon/IconGreenAdd";
import IconClock from "components/base/Icon/IconClock";
import FlexRow from "../../../layout/base/Grid/FlexRow";
import NFTOptions from "./NFTOptions";
import IconEditBlack from "../../../base/Icon/IconEditBlack";
import IndividualWallet from "./IndividualWallet";
import IconWallet from "../../../base/Icon/IconWallet";
import IconPoap from "../../../base/Icon/IconPoap";
import IconWorld from "../../../base/Icon/IconWorld";

export interface NewCreatorModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {
	handleCreate(condition: AccessControlCondition): void;
}

const NewCreatorModal = ({
	handleCreate,
	...modalProps
} : NewCreatorModalProps) => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const handleClose = () => {
		modalProps.onClose?.();
	};

	const [activeForm, setActiveForm] = useState("initial");

	const [crawling, setCrawling] = useState(false);

	const [stream, setStream] = useMergedState<Partial<Indexes>>({
		title: "",
	});

	const [loading, setLoading] = useState(false);

	const handleFormState = async (value: string) => {
		setActiveForm(value);
	};

	return <Modal {...modalProps} size={"fit"} onClose={handleClose} body={(
		<>
			{activeForm === "nft-options" ? (
				<NFTOptions handleCreate={handleCreate} handleBack={() => handleFormState("initial")}></NFTOptions>
			) : activeForm === "new-nft" ? (
				<></>
			) : activeForm === "individual-wallet" ? (
				<IndividualWallet handleBack={() => handleFormState("initial")}></IndividualWallet>
			) : (
				<FlexRow rowGutter={3} rowSpacing={0} rowGap={3} colSpacing={2}>
					<Col xs={4}>
						<Button onClick={() => handleFormState("nft-options")} textAlign={"left"} theme={"clear"} className={"px-4 py-6 card-item"}>
							<IconClock width={24} height={24}></IconClock>
							<Header level={4} className={"my-4"}>NFT Owners</Header>
							<Text>Add existing token as a creator rule</Text>
						</Button>
					</Col>
					<Col xs={8}>
						<Button textAlign={"left"} theme={"clear"} className={"px-4 py-6 card-item"}>
							<IconGreenAdd width={24} height={24}></IconGreenAdd>
							<Header level={4} className={"my-4"}>Create New NFT (soon)</Header>
							<Text>Create a new token, use as a creator rule, mint NFTs to your creators as you like.</Text>
						</Button>
					</Col>
					<Col xs={4}>
						<Button onClick={() => handleFormState("individual-wallet")} textAlign={"left"} theme={"clear"} className={"px-4 py-6 card-item"}>
							<IconWallet width={24} height={24}></IconWallet>
							<Header level={4}>Individual Wallet</Header>
						</Button>
					</Col>
					<Col xs={4}>
						<Button textAlign={"left"} theme={"clear"} className={"px-4 py-6 card-item"}>
							<Header level={4}>DAO Members (soon)</Header>
						</Button>
					</Col>
					<Col xs={4}>
						<Button textAlign={"left"} theme={"clear"} className={"px-4 py-6 card-item"}>
							<IconPoap width={24} height={24}></IconPoap>
							<Header level={4}>POAP Collector (soon)</Header>
						</Button>
					</Col>
				</FlexRow>
			)}
		</>
	)}
	header={<>
		<Header level={2}>Add New Rule</Header>
		<Text className={"mt-4"} element={"p"}>Creators will be able to add items, and delete theirs.</Text>
	</>}
	/>;
};

export default NewCreatorModal;
