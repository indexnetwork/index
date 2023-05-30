import Text from "components/base/Text";
import Modal, { ModalProps } from "components/base/Modal";
import React, { useState } from "react";
import Col from "components/layout/base/Grid/Col";
import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import Input from "components/base/Input";
import Button from "components/base/Button";
import { useRouter } from "next/router";
import { useCeramic } from "hooks/useCeramic";
import { useAppSelector } from "hooks/store";
import { useTranslation } from "next-i18next";
import { selectConnection } from "store/slices/connectionSlice";
import { Indexes } from "types/entity";
import CeramicService from "../../../../services/ceramic-service";
import FlexRow from "../../../layout/base/Grid/FlexRow";
import LitService from "../../../../services/lit-service";
import {appConfig} from "../../../../config";

export interface CreateModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {
}

const CreateModal = ({
	...modalProps
} : CreateModalProps) => {
	const { t } = useTranslation(["pages"]);
	const router = useRouter();
	const handleClose = () => {
		modalProps.onClose?.();
	};
	const ceramic = useCeramic();
	const handleEnter = (e: any) => {
		if (e && (e.code === "Enter" || e.code === "NumpadEnter")) {
			handleCreate();
		}
	};
	const { did } = useAppSelector(selectConnection);

	const [crawling, setCrawling] = useState(false);

	const [title, setTitle] = useState<string>("");

	const [loading, setLoading] = useState(false);

	const handleCreate = async () => {
		setLoading(true);
		if (title) {
			const { pkpPublicKey } = await LitService.mintPkp();
			const pkpDID = await LitService.getPKPSession(pkpPublicKey, appConfig.defaultCID);
			const c = new CeramicService(pkpDID.did);
			const doc = await c.createIndex(pkpPublicKey, { title } as Indexes);
			if (doc != null) {
				// await setTitle("");
				await router.push(`/${doc.id}`);
				modalProps.onClose?.();
			}
		}
		setLoading(false);
	};
	const handleChange: React.ChangeEventHandler<HTMLInputElement> = ({ target }) => {
		const { value } = target;
		setTitle(value);
	 };

	return <Modal {...modalProps} size={"xs"} body={(
		<>
			<FlexRow>
				<Col xs={12}>
					<Flex flexDirection="column">
						<Text theme={"primary"} size="md">Title:</Text>
						<Input
							autoFocus={true}
							value={title || ""}
							onKeyDown={handleEnter}
							onChange={handleChange}
							// loading={loading}
							className="mt-3"
							inputSize={"lg"}
							placeholder="e.g. Web3 Social Ecosystem"
						/>
					</Flex>
				</Col>
			</FlexRow>
		</>
	)}
	header={<Header level={2}>Create New Index</Header>}
	footer={<><Col pullLeft>
		<Button
			size="lg"
			className="mt-7 pl-8 pr-8"
			theme="clear"
			onClick={handleClose}
		>Cancel</Button>
	</Col>
	<Col pullRight>
		<Button
			disabled={!title}
			onClick={handleCreate}
			theme="primary"
			size="lg"
			className="mt-7 pl-8 pr-8"
		>Create</Button>
	</Col></>}
	/>;
};

export default CreateModal;
