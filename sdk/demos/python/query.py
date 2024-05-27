from indexclient.chroma import IndexChroma
from langchain_openai import OpenAIEmbeddings
import { TogetherAIEmbeddings } from '@langchain/community/embeddings/togetherai';
# Initialize OpenAIEmbeddings object

embeddings = OpenAIEmbeddings(model="text-embedding-ada-002",
                              openai_api_key="YOUR_API_KEY")

vectorstore = IndexChroma(
    network="dev",
    embedding_function=embeddings
)

print(vectorstore.similarity_search('What is index network?'))
