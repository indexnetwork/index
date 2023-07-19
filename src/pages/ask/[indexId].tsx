import React, {
	ReactElement, useEffect, useState,
} from "react";
import { NextPageWithLayout } from "types";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import Container from "components/layout/base/Grid/Container";
import PageLayout from "components/layout/site/PageLayout";
import { useRouter } from "next/router";
import { useChat } from "ai/react";

const IndexAskPage: NextPageWithLayout = () => {
	const router = useRouter();
	const { indexId } = router.query;
	const { messages, input, handleInputChange, handleSubmit } = useChat({
		api: "http://dev.index.as/api/ask/did",
	});

	return (
		<Container>
			<div className="mx-auto w-full max-w-md py-24 flex flex-col stretch">
				{messages.map((m: any) => (
					<div key={m.id}>
						{m.role === "user" ? "User: " : "AI: "}
						{m.content}
					</div>
				))}

				<form onSubmit={handleSubmit}>
					<label>
						Say something...
						<input
							className="fixed w-full max-w-md bottom-0 border border-gray-300 rounded mb-8 shadow-xl p-2"
							value={input}
							onChange={handleInputChange}
						/>
					</label>
					<button type="submit">Send</button>
				</form>
			</div>
		</Container>
	);
};

IndexAskPage.getLayout = function getLayout(page: ReactElement) {
	return (
		<PageLayout
			hasFooter={false}
			headerType="user"
		>
			{page}
		</PageLayout>
	);
};

export async function getServerSideProps({ locale }: any) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common", "pages", "components"])),
		},
	};
}
export default IndexAskPage;
