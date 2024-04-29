from typing import Any, Coroutine, Iterable, List, override
from chromadb import Settings
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings

class IndexChroma(Chroma):

    def __init__(self, embedding_function: OpenAIEmbeddings, settings: Settings):
        kwargs = {
            'collection_name': 'chroma-indexer',
            'embedding_function': embedding_function,
            'client_settings': Settings(
                chroma_server_api_default_path='/chroma',
                **settings.dict()
            )
        }

        super(Chroma).__init__(**kwargs)

    @override
    def aadd_documents(self, documents: List[Document], **kwargs: Any) -> Coroutine[Any, Any, List[str]]:
        raise PermissionError, "Adding documents to an index is not allowed."

    @override
    def add_images(self, uris: List[str], metadatas: List[dict] | None = None, ids: List[str] | None = None, **kwargs: Any) -> List[str]:
        raise PermissionError, "Adding images to an index is not allowed."

    @override
    def adelete(self, ids: List[str] | None = None, **kwargs: Any) -> Coroutine[Any, Any, bool | None]:
        raise PermissionError, "Deleting documents from an index is not allowed."
    
    @override
    def add_texts(self, texts: Iterable[str], metadatas: List[dict] | None = None, ids: List[str] | None = None, **kwargs: Any) -> List[str]:
        raise PermissionError, "Adding texts to an index is not allowed."
    
    @override
    def add_documents(self, documents: List[Document], **kwargs: Any) -> List[str]:
        raise PermissionError, "Adding documents to an index is not allowed."

    @override
    def aadd_texts(self, texts: Iterable[str], metadatas: List[dict] | None = None, **kwargs: Any) -> Coroutine[Any, Any, List[str]]:
        raise PermissionError, "Adding texts to an index is not allowed."