import Button from "components/base/Button";
import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import Image from "next/image";
import React, { useCallback, useContext, useEffect } from "react";
import { useAuth } from "hooks/useAuth";
import Router, { useRouter } from "next/router";


export interface NoIndexesProps {
	active?: boolean;
	hasIndex?: boolean;
	search?: string;
}

const NoIndexes: React.VFC<NoIndexesProps> = ({
	active,
	hasIndex,
	search,
}) => {
	const router = useRouter();

	const handleCreate = () => {
		router.push("/create");
	};

	return (
		<>
			{
				active && (
					<Row rowSpacing={5} >
						<Col xs={12} centerBlock style={{
							height: 166,
						}}>
							<Image src="/images/no_indexes.png" alt="No Indexes" layout="fill" objectFit='contain' />
						</Col>
						<Col className="text-center" centerBlock>
							{
								search && hasIndex && (
									<Header level={4} style={{
										maxWidth: 350,
									}}>{`Your search ${search} did not match any indexes.`}</Header>
								)
							}
							{
								!hasIndex && (
									(
										<Header style={{
											maxWidth: 350,
										}} level={4}>{`You have no indexes yet. Create an index to get started.`}</Header>
									)
								)
							}
						</Col>
						{
							!hasIndex && (
								<Col centerBlock>
									<Button onClick={handleCreate}>Create your first index</Button>
								</Col>
							)
						}
					</Row>
				)
			}
		</>
	);
} 

export default NoIndexes;
