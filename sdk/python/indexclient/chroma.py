import chromadb
from chromadb import Settings
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

from .config import IndexConfig
from typing_extensions import override


class IndexChroma(Chroma):
    """Read-only Chroma Client for Index Network
    Desciption:
        This class is a read-only Chroma client for Index Network. It is used to query the decentralized semantic network provided by Index Network.

    Args:
        embedding_function (OpenAIEmbeddings): OpenAIEmbeddings object that contains the API key and the model name.

    Usage:

    * Initialize IndexChroma object

        ```python
        from langchain_openai import OpenAIEmbeddings
        from langchain_index import IndexChroma

        # Initialize OpenAIEmbeddings object

        embeddings = OpenAIEmbeddings(model="text-embedding-ada-002",
                                      openai_api_key="YOUR_API_KEY")

        vectorstore = IndexChroma(embedding_function=embeddings)
        ```

    * Query the network

        ```python
        # Query the network
        response = vectorstore.query("What is the capital of France?")
        print(response)
        ```

    * Also you can use with LangChain as follows:

        ```python
        from langchain import hub
        from langchain_openai import ChatOpenAI
        from langchain_core.output_parsers import StrOutputParser
        from langchain_core.runnables import RunnablePassthrough

        llm = ChatOpenAI(model="gpt-3.5-turbo-0125", api_key='YOUR_API_KEY')

        # Retrieve and generate using the relevant snippets of the blog.
        retriever = vectorstore.as_retriever()
        prompt = hub.pull("rlm/rag-prompt")

        def format_docs(docs):
            return "\\n\\n".join(doc.page_content for doc in docs)

        rag_chain = (
            {"context": retriever | format_docs, "question": RunnablePassthrough()}
            | prompt
            | llm
            | StrOutputParser()
        )

        rag_chain.invoke("What is $STYLE Protocol?")


    """

    def __init__(self, network, embedding_function: OpenAIEmbeddings):
        self.network = network
        chroma_path = "https://dev.index.network/api/chroma"
        if self.network == "mainnet":
            chroma_path = "https://index.network/api/chroma"

        # Initialize chroma client
        self.client = chromadb.HttpClient(
                        host=chroma_path, 
                        settings=Settings(
                            anonymized_telemetry=False,
                            allow_reset=True
                        ))

        super().__init__(client=self.client,
                         embedding_function=embedding_function,
                         collection_name=IndexConfig.CHROMA_COLLECTION)


    @override
    def add_documents(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. Use indexClient.addItemToIndex method instead')

    @override
    def add_texts(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. Use indexClient.addItemToIndex method instead')

    @override
    def add_text(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. Use indexClient.addItemToIndex method instead')

    @override
    def from_documents(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. Use indexClient.addItemToIndex method instead')

    @override
    def from_texts(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. Use indexClient.addItemToIndex method instead')

    @override
    def from_text(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. Use indexClient.addItemToIndex method instead')

    @override
    def afrom_documents(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. Use indexClient.addItemToIndex method instead')

    @override
    def afrom_texts(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. Use indexClient.addItemToIndex method instead')

    @override
    def adelete(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. use indexClient instead')

    @override
    def delete(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. use indexClient instead')

    @override
    def delete_collection(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. use indexClient instead')

    @override
    def update_documents(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. use indexClient instead')

    @override
    def update_document(self) -> None:
        raise Warning('Readonly Chroma does not support this operation. use indexClient instead')
