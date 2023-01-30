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

export interface CreateModalProps extends Omit<ModalProps, "header" | "footer" | "body"> {
}

const CreateModal: React.VFC<CreateModalProps> = ({
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
				setStream({
					title: "",
				});
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
		size={"xs"}
		destroyOnClose
		body={(
			<>
				<Row
				>
					<Col xs={12}
					>
						<Flex
							alignItems="center"
							className="mb-3"
						>
							<Flex flexDirection="column" flexWrap="wrap" flexGrow={1} className="ml-2">
								<Text>Title</Text>
							</Flex>
						</Flex>
						<Col sm={12}>
							<Input
								defaultValue={stream?.title || ""}
								onChange={handleChange}
								// loading={loading}
								className="mt-3"
								placeholder="e.g. Curation Over Curation"
							/>
						</Col>
						<Col pullLeft>
							<Button
								className="mt-7 pl-9 pr-9 "
								theme="clear"
								onClick={handleClose}
							>Cancel</Button>
						</Col>
						<Col pullRight>
							<Button
								onClick={handleCreate}
								theme="primary"
								className=" mt-7 pl-9 pr-9"
							>Create</Button>
						</Col>

					</Col>
				</Row>
			</>
		)}
		header={<Header>Create New Index</Header>}
	>

	</Modal>;
};

export default CreateModal;
