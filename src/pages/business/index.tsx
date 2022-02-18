import Header from "components/base/Header";
import IndexList from "components/site/IndexList";
import IndexListItem from "components/site/IndexList/IndexListItem";
import Col from "layout/base/Grid/Col";
import Row from "layout/base/Grid/Row";
import LandingLayout from "layout/site/LandingLayout";
import PageContainer from "layout/site/PageContainer";
import { ReactElement } from "react";
import { NextPageWithLayout } from "types";

const Business: NextPageWithLayout = () => (
	<PageContainer>
		<Row
			rowSpacing={3}
			colSpacing={3}
		>
			<Col xs={12}>
				<Header level={2}>Index List Item</Header>
			</Col>
			<Col xs={12}>
				<IndexListItem shared={false}/>
			</Col>
		</Row>
		<Row
			rowSpacing={3}
			colSpacing={3}
		>
			<Col xs={12}>
				<Header level={2}>Index List Item Shared</Header>
			</Col>
			<Col xs={12}>
				<IndexListItem shared={true}/>
			</Col>
			<Col xs={12}>

			</Col>
		</Row>
		<Row
			rowSpacing={3}
			colSpacing={3}
		>
			<Col xs={12}>
				<Header level={2}>Index List</Header>
			</Col>
			<Col xs={12}>
				<IndexList shared={false}/>
			</Col>
		</Row>
		<Row
			rowSpacing={3}
			colSpacing={3}
		>
			<Col xs={12}>
				<Header level={2}>Index List</Header>
			</Col>
			<Col xs={12}>
				<IndexList shared={false}/>
			</Col>
		</Row>
		<Row
			rowSpacing={3}
			colSpacing={3}
		>
			<Col xs={12}>
				<Header level={2}>Index List Shared</Header>
			</Col>
			<Col xs={12}>
				<IndexList shared={true}/>
			</Col>
		</Row>
	</PageContainer>
);

Business.getLayout = function getLayout(page: ReactElement) {
	return (
		<LandingLayout>
			{page}
		</LandingLayout>
	);
};

export default Business;
