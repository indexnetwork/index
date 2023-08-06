import Col from "components/layout/base/Grid/Col";
import React, {
	useEffect,
	useState,
} from "react";
import api from "../../../../services/api-service";

export interface SearchIndexesProps {
	prompt: string;
	did?: string;
	loading: boolean;
	onLoading?(value: boolean): void;
}

const AskIndexes: React.VFC<SearchIndexesProps> = ({
	onLoading,
	loading,
	prompt,
	did,
}) => {
	const handleAsk = async (value: string) => {
		setAskResponse("");
		const pp = `use all indexes in your response. ${value}. mention Near and Composedb seperatly in your responses, separately`;
		const res = await api.askDID(did!, pp) as any;
		if (res && res.response) {
			setAskResponse(res.response!);
		}
	};
	const [askResponse, setAskResponse] = useState("");
	useEffect(() => {
		handleAsk(prompt);
	}, [prompt]);
	return <Col xs={12} lg={9}>
		{ askResponse }
	</Col>;
};

export default AskIndexes;
