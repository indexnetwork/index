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

from langchain.schema import ChatMessage
from langchain.vectorstores import Chroma
from langchain.memory import ConversationBufferMemory, ChatMessageHistory
from langchain.schema import HumanMessage, AIMessage
from langchain.embeddings import OpenAIEmbeddings
from langchain.chat_models import ChatOpenAI
from langchain.chains import RetrievalQA
from langchain.agents import Tool
from langchain.agents import AgentExecutor
from langchain.utilities import SerpAPIWrapper

from langchain.tools.render import render_text_description
from langchain.agents.output_parsers import ReActSingleInputOutputParser
from langchain.agents.format_scratchpad import format_log_to_str
from langchain import hub


from unstructured.partition.auto import partition



load_dotenv()

redisClient = redis.Redis.from_url(os.environ["REDIS_CONNECTION_STRING"])

origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:8000",
]

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
llm = ChatOpenAI(temperature=0, model_name="gpt-4", openai_api_key=os.environ["OPENAI_API_KEY"], streaming=True)
embedding_function = OpenAIEmbeddings(model="text-embedding-ada-002", openai_api_key=os.environ["OPENAI_API_KEY"])
collection = Chroma(
        client=chroma_client,
        collection_name="indexes",
        embedding_function=embedding_function,
    )

def get_query_engine(indexes):

    if len(indexes) > 1:
        index_filters =  {"$or": [{"index_id": {"$eq": i}} for i in indexes]}
    else:
        index_filters =  {"index_id": {"$eq": indexes[0]}}


class ChatStream(BaseModel):
    id: str
    did: Optional[str]
    indexes: Optional[List[str]]
    messages: List[ChatMessage]

class Prompt(BaseModel):
    prompt: str

class Link(BaseModel):
    url: str

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

@app.post("/index/{index_id}/links")
def add(index_id, link: Link):

    documents = get_document(link.url)

    for node in documents:

        node.metadata = {"source": link.url,"index_id": index_id}
        collection.add_documents(documents)

    return JSONResponse(content={'message': 'Document added successfully'})


@app.delete("/index/{index_id}/links")
def remove(index_id: str, link: Link):
    return JSONResponse(content={"message": "Documents deleted successfully"})



@app.post("/chat_stream")
def chat_stream(params: ChatStream):

    if params.did:
        id_resp = redisClient.hkeys("user_indexes:by_did:" + params.did.lower())
        if not id_resp:
            return "You have no indexes"
        indexes = [item.decode('utf-8').split(':')[0] for item in id_resp]
    elif params.indexes:
        indexes = params.indexes

    messages = params.messages
    last_message = messages[-1]
    message_instances = list(
        map(lambda msg: HumanMessage(content=msg.content) if msg.role == "user" else AIMessage(content=msg.content), messages))

    history = ChatMessageHistory()
    history.messages = message_instances

    memory = ConversationBufferMemory(memory_key="chat_history", chat_memory=history, return_messages=True)

    indexChain = RetrievalQA.from_chain_type(
        llm=llm, chain_type="stuff", retriever=collection.as_retriever()
    )

    search = SerpAPIWrapper()

    tools = [
        Tool(
            name="Vector Database",
            func=indexChain.run,
            description="Useful for getting information about anything",
        )
    ]

    prompt = hub.pull("hwchase17/react-chat")
    prompt = prompt.partial(
        tools=render_text_description(tools),
        tool_names=", ".join([t.name for t in tools]),
    )

    llm_with_stop = llm.bind(stop=["\nObservation"])
    agent = {
                "input": lambda x: x["input"],
                "agent_scratchpad": lambda x: format_log_to_str(x['intermediate_steps']),
                "chat_history": lambda x: x["chat_history"]
            } | prompt | llm_with_stop | ReActSingleInputOutputParser()

    agent_chain = AgentExecutor.from_agent_and_tools(agent, tools=tools, memory=memory, verbose=True )
    return agent_chain.invoke({"input": last_message.content})



if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
