import os
import json

from dotenv import load_dotenv

from fastapi import FastAPI, Request

from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

import chromadb
import openai
import redis
from chromadb.config import Settings


from langchain import hub
from langchain.agents import AgentExecutor, create_react_agent
from langchain_community.tools.tavily_search import TavilySearchResults

from langchain_core.messages.base import BaseMessage
from langchain.schema import ChatMessage
from langchain.memory import ConversationBufferMemory, ChatMessageHistory
from langchain.schema import HumanMessage, AIMessage, Document

from langchain_community.vectorstores import Chroma

from langchain_openai import OpenAIEmbeddings
from langchain_openai import ChatOpenAI

from langchain.chains import RetrievalQA
from langchain.agents import Tool
from langchain import hub
from langchain.agents import AgentExecutor, create_self_ask_with_search_agent

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
llm = ChatOpenAI(temperature=0, model_name=model_chat, openai_api_key=os.environ["OPENAI_API_KEY"], streaming=True)
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
    messages: List[Any]


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

    doc = Document(vector=request.vector, page_content=page_content, metadata=metadata)

    collection.add_documents([doc])

    return JSONResponse(content={'message': 'Document added successfully'})


@app.post("/chat_stream")
def chat_stream(params: ChatStream):

    # indexes = params.indexes

    # messages = params.messages
    # last_message = messages[-1]
    # message_instances = list(
    #     map(lambda msg: HumanMessage(content=msg.content) if msg.role == "user" else AIMessage(content=msg.content),
    #         messages))

    # history = ChatMessageHistory()
    # history.messages = message_instances

    # memory = ConversationBufferMemory(memory_key="chat_history", chat_memory=history, max_return_messages=True)

    indexChain = RetrievalQA.from_chain_type(
        llm=llm, chain_type="stuff", retriever=collection.as_retriever(),
    )

    tools = [
        Tool(
            name="Intermediate Answer",
            description="Useful for getting information about anything",
            func=indexChain.invoke
            ,
        ),
    ]

    prompt = hub.pull("hwchase17/self-ask-with-search")
    agent = create_self_ask_with_search_agent(llm, tools, prompt)
    agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True, handle_parsing_errors=True)

    responses = agent_executor.invoke(
        {
            "input": "Tell me a joke",
        }
    )
    return responses["output"]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
