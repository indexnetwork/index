import os
import json

from dotenv import load_dotenv

from fastapi import FastAPI

from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Tuple

import chromadb
import openai
import redis

from langchain.schema import ChatMessage
from langchain.schema import Document
from langchain_community.vectorstores import Chroma

from langchain_openai import OpenAIEmbeddings
from operator import itemgetter

from langchain_core.runnables import RunnableLambda
from langchain_core.messages import get_buffer_string
from langchain.memory import ConversationBufferMemory
from langchain.chat_models import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain.prompts.prompt import PromptTemplate
from langchain.schema import format_document
from langchain.schema.output_parser import StrOutputParser
from langchain.schema.runnable import RunnablePassthrough
from langserve import add_routes
from langserve.pydantic_v1 import BaseModel, Field

load_dotenv()

redisClient = redis.Redis.from_url(os.environ["REDIS_CONNECTION_STRING"])

origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:8000",
]

model_embeddings = "text-embedding-ada-002"
model_chat = "gpt-3.5-turbo-16k"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
from app.document_parser import get_document
from langchain.agents.agent_toolkits import (
    create_vectorstore_agent,
    VectorStoreToolkit,
    VectorStoreInfo,
)

openai.api_key = os.environ["OPENAI_API_KEY"]
openai.log = "error"

local_directory = "chroma-indexes"
persist_directory = os.path.join(os.getcwd(), local_directory)
chroma_client = chromadb.PersistentClient(path=persist_directory)

embedding_function = OpenAIEmbeddings(model=model_embeddings, openai_api_key=os.environ["OPENAI_API_KEY"])
collection = Chroma(
    client=chroma_client,
    collection_name="indexes",
    embedding_function=embedding_function,
)


def get_query_engine(indexes):
    if len(indexes) > 1:
        index_filters = {"$or": [{"index_id": {"$eq": i}} for i in indexes]}
    else:
        index_filters = {"index_id": {"$eq": indexes[0]}}


from typing import Any


class ChatStream(BaseModel):
    id: str
    messages: List[ChatMessage]


class Prompt(BaseModel):
    prompt: str


class CrawlRequest(BaseModel):
    url: str


class EmbeddingRequest(BaseModel):
    text: str


class IndexRequest(BaseModel):
    indexId: str
    indexTitle: str
    indexCreatedAt: str
    indexUpdatedAt: str
    indexOwnerDID: str
    indexOwnerName: Optional[str]  # Assuming this field can be optional
    indexOwnerBio: Optional[str]  # Assuming this field can be optional
    webPageId: str
    webPageTitle: str
    webPageUrl: str
    webPageContent: str
    webPageCreatedAt: str
    webPageUpdatedAt: str
    vector: List[float]  # Assuming it's a list of floats based on your example


class Composition(BaseModel):
    did: str
    prompt: str


def response_generator(response):
    yield json.dumps({
        "sources": [{"id": s.node.id_, "url": s.node.metadata.get("source")} for s in response.source_nodes]
    })
    yield "\n ###endjson### \n\n"
    for text in response.response_gen:
        yield text


@app.get("/")
def home():
    return JSONResponse(content="ia")


@app.post("/crawl")
def crawl(crawl: CrawlRequest):
    documents = get_document(crawl.url)
    texts = [d.page_content for d in documents]
    return JSONResponse(content={'url': crawl.url, 'content': texts[0]})


@app.post("/embeddings")
def embeddings(embed: EmbeddingRequest):
    embedding = embedding_function.embed_documents([embed.text])
    return JSONResponse(content={'model': model_embeddings, 'vector': embedding[0]})


@app.post("/index")
def add(request: IndexRequest):
    page_content = request.webPageTitle + "\n" + request.webPageContent

    metadata_keys = [
        "indexId", "indexTitle", "indexCreatedAt", "indexUpdatedAt",
        "indexOwnerDID", "indexOwnerName", "indexOwnerBio",
        "webPageId", "webPageTitle", "webPageUrl",
        "webPageCreatedAt", "webPageUpdatedAt"
    ]

    metadata = {key: getattr(request, key) for key in metadata_keys if getattr(request, key) is not None}
    metadata["source"] = request.webPageId
    doc = Document(vector=request.vector, page_content=page_content, metadata=metadata)

    collection.add_documents([doc])

    return JSONResponse(content={'message': 'Document added successfully'})


retriever = collection.as_retriever()
llm = ChatOpenAI(temperature=0, model_name=model_chat, openai_api_key=os.environ["OPENAI_API_KEY"])

_TEMPLATE = """Given the following conversation and a follow up question, rephrase the 
follow up question to be a standalone question, in its original language.

Chat History:
{chat_history}
Follow Up Input: {question}
Standalone question:"""
CONDENSE_QUESTION_PROMPT = PromptTemplate.from_template(_TEMPLATE)

ANSWER_TEMPLATE = """Answer the question based only on the following context:
{context}

Question: {question}
"""
ANSWER_PROMPT = ChatPromptTemplate.from_template(ANSWER_TEMPLATE)

DEFAULT_DOCUMENT_PROMPT = PromptTemplate.from_template(template="{page_content}")



def _combine_documents(
        docs, document_prompt=DEFAULT_DOCUMENT_PROMPT, document_separator="\n\n"
):
    """Combine documents into a single string."""
    doc_strings = [format_document(doc, document_prompt) for doc in docs]
    return document_separator.join(doc_strings)


def _format_chat_history(chat_history: List[Tuple]) -> str:
    """Format chat history into a string."""
    buffer = ""
    for dialogue_turn in chat_history:
        human = "Human: " + dialogue_turn[0]
        ai = "Assistant: " + dialogue_turn[1]
        buffer += "\n" + "\n".join([human, ai])
    return buffer


memory = ConversationBufferMemory(
    return_messages=True, output_key="answer", input_key="question"
)
loaded_memory = RunnablePassthrough.assign(
    chat_history=RunnableLambda(memory.load_memory_variables) | itemgetter("history"),
)
# Now we calculate the standalone question
standalone_question = {
    "standalone_question": {
                               "question": lambda x: x["question"],
                               "chat_history": lambda x: get_buffer_string(x["chat_history"]),
                           }
                           | CONDENSE_QUESTION_PROMPT
                           | llm
                           | StrOutputParser(),
}
# Now we retrieve the documents
retrieved_documents = {
    "docs": itemgetter("standalone_question") | retriever,
    "question": lambda x: x["standalone_question"],
}
# Now we construct the inputs for the final prompt
final_inputs = {
    "context": lambda x: _combine_documents(x["docs"]),
    "question": itemgetter("question"),
}
# And finally, we do the part that returns the answers
answer = {
    "answer": final_inputs | ANSWER_PROMPT | ChatOpenAI(),
    "docs": itemgetter("docs"),
}
# And now we put it all together!
final_chain = loaded_memory | standalone_question | retrieved_documents | answer


# User input
class ChatHistory(BaseModel):
    """Chat history with the bot."""

    chat_history: List[Tuple[str, str]] = Field(
        ...,
        extra={"widget": {"type": "chat", "input": "question"}},
    )
    question: str


print(final_chain)

add_routes(app, final_chain.with_types(input_type=ChatHistory), enable_feedback_endpoint=True)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
