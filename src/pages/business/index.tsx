import IndexListItem from "components/site/IndexList/IndexListItem";
import Col from "layout/base/Grid/Col";
import Row from "layout/base/Grid/Row";
import PageContainer from "layout/site/PageContainer";
import { NextPageWithLayout } from "types";

const Deneme: NextPageWithLayout = () => (
	<PageContainer>
		<Row
			noGutters
			rowSpacing={3}
			colSpacing={3}
		>
			<Col xs={12}>
				<IndexListItem shared={false}/>
			</Col>
			<Col xs={12}>

			</Col>
		</Row>
		<Row
			noGutters
			rowSpacing={3}
			colSpacing={3}
		>
			<Col xs={12}>
				<IndexListItem shared={true}/>
			</Col>
			<Col xs={12}>

			</Col>
		</Row>
	</PageContainer>
);

export default Deneme;
