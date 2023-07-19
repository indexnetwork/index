import os
import json

from dotenv import load_dotenv

from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


from llama_index import download_loader
from llama_index.llms import ChatMessage
from llama_index.vector_stores import ChromaVectorStore
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index import VectorStoreIndex, ListIndex, LLMPredictor, ServiceContext
from llama_index.chat_engine.types import ChatMode
from llama_index.indices.composability import ComposableGraph
from langchain.chat_models import ChatOpenAI

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

local_directory = "chroma-indexes"
persist_directory = os.path.join(os.getcwd(), local_directory)

chroma_client = chromadb.Client(Settings(
    chroma_db_impl="duckdb+parquet",
    persist_directory=persist_directory
))

llm = ChatOpenAI(temperature=0, model_name="gpt-3.5-turbo", openai_api_key=os.environ["OPENAI_API_KEY"], streaming=True)
llm_predictor = LLMPredictor(llm=llm)
service_context = ServiceContext.from_defaults(llm_predictor=llm_predictor)


def get_index(index_id: str):
    collection = chroma_client.get_or_create_collection(name=index_id)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    index = VectorStoreIndex.from_vector_store(vector_store=vector_store, service_context=service_context)
    
    return index

class ChatHistory(BaseModel):
    messages: list[ChatMessage]

class Prompt(BaseModel):
    prompt: str

class Link(BaseModel):
    url: str

class Composition(BaseModel):
    did: str
    prompt: str

@app.post("/index/{index_id}/links")
def add(index_id, link: Link):
    
    index = get_index(index_id=index_id)
    
    UnstructuredURLLoader = download_loader("UnstructuredURLLoader")
    loader = UnstructuredURLLoader(urls=[link.url])
    kb_data = loader.load()
    
    index.insert(kb_data[0])
    chroma_client.persist()

    summary = index.as_query_engine().query("summarize").response
    x = redisClient.hset("summaries", index_id, summary)
    print(x)
    
    return JSONResponse(content={'message': 'Document added successfully'})

@app.delete("/index/{index_id}/links")
def remove(index_id: str, link: Link):
    return JSONResponse(content={"message": "Documents deleted successfully"})


@app.post("/index/{index_id}/prompt")
def query(index_id, prompt: Prompt):
    index = get_index(index_id=index_id)
    response = index.as_query_engine().query(prompt.prompt)
    return JSONResponse(content={
        #"sources": [{"id": s.node.id_, "url": s.node.metadata.get("source"), "index_id": s.node.metadata.get("index_id")} for s in response.sources]
        "response": response.response
    })
    #return StreamingResponse(response.response_gen, media_type='text/event-stream')

@app.post("/index/{index_id}/chat_stream")
def chat_stream(index_id, chat_history: ChatHistory):

    index = get_index(index_id=index_id)

    chat_engine = index.as_chat_engine(streaming=True, verbose=True)

    messages = chat_history.messages
    last_message = messages[-1]
    print(last_message.content, messages)
    # TODO Pop last "user" message from chat history. 
    streaming_response = chat_engine.stream_chat(message=last_message.content, chat_history=messages)

    def response_generator():
        yield json.dumps({
            "sources": [{"id": s.node.id_, "url": s.node.metadata.get("source")} for s in streaming_response.source_nodes]
        })
        yield "\n ###endjson### \n\n"
        for text in streaming_response.response_gen:
            yield text
    return StreamingResponse(response_generator(), media_type='text/event-stream')


@app.post("/index/{index_id}/chat")
async def chat(index_id, chat_history: ChatHistory):

    index = get_index(index_id=index_id)
    chat_engine = index.as_chat_engine()

    messages = chat_history.messages
    last_message = messages[-1]

    response = chat_engine.chat(message=last_message.content, chat_history=messages)
    return JSONResponse(content={
        #"sources": [{"id": s.node.id_, "url": s.node.metadata.get("source"), "index_id": s.node.metadata.get("index_id")} for s in response.sources]
        "response": response.response
    })


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
