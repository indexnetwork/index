import os
import json

from dotenv import load_dotenv

from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List


from llama_index import download_loader
from llama_index.llms import ChatMessage
from llama_index.vector_stores import ChromaVectorStore
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index import VectorStoreIndex, ListIndex, LLMPredictor, ServiceContext
from llama_index.chat_engine.types import ChatMode
from llama_index.indices.composability import ComposableGraph
from llama_index.indices.query.query_transform import HyDEQueryTransform
from llama_index.query_engine.transform_query_engine import TransformQueryEngine
from llama_index.vector_stores.types import ExactMatchFilter, MetadataFilters

from langchain.chat_models import ChatOpenAI
from llama_index import Document

from unstructured.partition.auto import partition

from app.document_parser import get_document

import chromadb
from chromadb.config import Settings

import openai #



import redis

load_dotenv()

redisClient = redis.Redis.from_url(os.environ["REDIS_CONNECTION_STRING"]);


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

openai.api_key = os.environ["OPENAI_API_KEY"]
openai.log = "error"

local_directory = "chroma-indexes"
persist_directory = os.path.join(os.getcwd(), local_directory)

chroma_client = chromadb.PersistentClient(path=persist_directory)

hyde = HyDEQueryTransform(include_original=True)


def get_service_context():
    embed_model = OpenAIEmbedding(model="text-embedding-ada-002", openai_api_key=os.environ["OPENAI_API_KEY"])
    llm = ChatOpenAI(temperature=0, model_name="gpt-4", openai_api_key=os.environ["OPENAI_API_KEY"], streaming=True)
    service_context = ServiceContext.from_defaults(llm=llm, embed_model=embed_model)
    return service_context

def get_collection():
    collection = chroma_client.get_or_create_collection(name="indexes")
    vector_store = ChromaVectorStore(chroma_collection=collection)
    index = VectorStoreIndex.from_vector_store(vector_store=vector_store, service_context=get_service_context())

    return index

def get_query_engine(indexes):
    collection = get_collection()

    if len(indexes) > 1:
        index_filters =  {"$or": [{"index_id": {"$eq": i}} for i in indexes]}
    else:
        index_filters =  {"index_id": {"$eq": indexes[0]}}

    return collection.as_query_engine(streaming=True, verbose=True, vector_store_kwargs={"where": index_filters})

def get_index_chat_engine(indexes):
    collection = get_collection()

    if len(indexes) > 1:
        index_filters =  {"$or": [{"index_id": {"$eq": i}} for i in indexes]}
    else:
        index_filters =  {"index_id": {"$eq": indexes[0]}}

    return collection.as_chat_engine(chat_mode="context", similarity_top_k=5, streaming=True, verbose=True, vector_store_kwargs={"where": index_filters})

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

    collection = get_collection()
    
    documents = get_document(link.url) 

    for node in documents:
        node.metadata = {"source": link.url,"index_id": index_id}
        collection.insert(Document.from_langchain_format(node))

    return JSONResponse(content={'message': 'Document added successfully'})

@app.delete("/index/{index_id}/links")
def remove(index_id: str, link: Link):
    return JSONResponse(content={"message": "Documents deleted successfully"})


@app.post("/compose_new")
def query(prompt: Prompt):

    collection = get_collection()


    hyde_query_engine = TransformQueryEngine( collection.as_query_engine(), hyde)

    response = hyde_query_engine.query(prompt.prompt)

    print(response.get_formatted_sources())

    return JSONResponse(content={
        "sources": [{"id": s.node.id_, "url": s.node.metadata.get("source"), "index_id": s.node.metadata.get("index_id")} for s in response.source_nodes],
        "response": response.response
    })

@app.post("/index/{index_id}/prompt")
async def query(index_id, prompt: Prompt):
    response = get_query_engine([index_id]).query(prompt.prompt)
    return StreamingResponse(response_generator(response), media_type='text/event-stream')


@app.post("/chat_stream")
def chat_stream(params: ChatStream):

    if params.did:
        id_resp = redisClient.hgetall("user_indexes:by_did:" + params.did.lower())
        if not id_resp:
            return "You have no indexes"

        # Decode the keys and values from bytes to UTF-8 strings
        decoded_id_resp = {
            key.decode('utf-8').split(':')[0]: value.decode('utf-8')
            for key, value in id_resp.items()
        }

        indexes = [
            key
            for key, value in decoded_id_resp.items()
            if 'deletedAt' not in value or 'null' in value or 'None' in value
        ]
    elif params.indexes:
        indexes = params.indexes

    print(indexes)
    index = get_index_chat_engine(indexes)

    messages = params.messages
    last_message = messages[-1]

    streaming_response = index.stream_chat(message=last_message.content, chat_history=messages)

    def response_generator():
        for text in streaming_response.response_gen:
            yield text

#        yield '\n\nSources:'
#        for s in streaming_response.source_nodes:
#            yield '\n\n'
#            yield  s.node.metadata.get("source")


    return StreamingResponse(response_generator(), media_type='text/event-stream')



@app.post("/compose")
def compose(c: Composition):


    id_resp = redisClient.hkeys("user_indexes:by_did:" + c.did.lower())

    index_ids = [item.decode('utf-8').split(':')[0] for item in id_resp]

    indexes = list(map(lambda index_id: get_index(index_id=index_id), index_ids))
    indexes = [get_index(index_id=index_id) for index_id in index_ids if get_index(index_id=index_id)]


    summaries = redisClient.hmget("summaries", index_ids)

    graph = ComposableGraph.from_indices(
        ListIndex,
        indexes,
        index_summaries=summaries,
        max_keywords_per_chunk=2000,
    )
    query_engine = graph.as_query_engine()
    response = query_engine.query(c.prompt)
    return JSONResponse(content={
        #"sources": [{"id": s.node.id_, "url": s.node.metadata.get("source"), "index_id": s.node.metadata.get("index_id")} for s in response.source_nodes],
        "response": response.response
    })


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
