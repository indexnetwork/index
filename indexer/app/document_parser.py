import mimetypes
import os
import requests
import uuid

from langchain_community.document_loaders import JSONLoader, UnstructuredFileLoader



class Transformers:
    @staticmethod
    def unstructured(fileName, file_type):
        loader = UnstructuredFileLoader(file_path=fileName, mode="paged") #elements
        return loader.load()

    @staticmethod
    def apify(url):
        print("Processing with Apify...")
        # Actual logic for JSON Transformer goes here
        return url

    @staticmethod
    def langchainJSON(fileName, file_type):
        print("Processing with Langchain JSON Loader...")
        loader = JSONLoader(file_path=fileName, jq_schema='.', text_content=False)
        return loader.load()

fileTypes = {
    'csv': Transformers.unstructured,
    'epub': Transformers.unstructured,
    'xlsx': Transformers.unstructured,
    'xls': Transformers.unstructured,
    'md': Transformers.unstructured,
    'org': Transformers.unstructured,
    'odt': Transformers.unstructured,
    'pdf': Transformers.unstructured,
    'txt': Transformers.unstructured,
    'ppt': Transformers.unstructured,
    'pptx': Transformers.unstructured,
    'rst': Transformers.unstructured,
    'rtf': Transformers.unstructured,
    'tsv': Transformers.unstructured,
    'doc': Transformers.unstructured,
    'docx': Transformers.unstructured,
    'xml': Transformers.unstructured,
    'json': Transformers.langchainJSON,
    'html': Transformers.unstructured, # ?
}

def save_file(url, file_type):
    # Fetch the content from the URL
    response = requests.get(url)
    response.raise_for_status()  # Raise exception if the request was unsuccessful

    # Generate a unique filename based on UUID
    unique_filename = f"{uuid.uuid4()}.{file_type}"

    output_path = os.environ.get('OUTPUT_PATH', '.')
    full_path = os.path.join(output_path, unique_filename)

    # Save the content to the specified path with the generated filename
    with open(full_path, 'wb') as f:
        f.write(response.content)

    return full_path


def delete_file(file_path):
    try:
        os.remove(file_path)
    except FileNotFoundError:
        print(f"File {file_path} not found!")
    except OSError as e:
        print(f"Error deleting file {file_path}. Reason: {e}")

def guess_file_type(url_or_file_path):
    mime_type, encoding = mimetypes.guess_type(url_or_file_path)
    extension = url_or_file_path.split('.')[-1] if '.' in url_or_file_path else None
    return extension, mime_type

def get_mime_from_head_request(url):
    try:
        response = requests.head(url, allow_redirects=True)
        return response.headers.get('Content-Type', '').split(';')[0]  # Exclude charset if present
    except requests.RequestException:
        return None

def map_mime_to_filetype(mime_type):
    mime_to_filetype_map = {
        'text/csv': 'csv',
        'application/epub+zip': 'epub',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-excel': 'xls',
        'text/html': 'html',
        'text/markdown': 'md',
        'text/org': 'org',
        'application/vnd.oasis.opendocument.text': 'odt',
        'application/pdf': 'pdf',
        'text/plain': 'txt',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'text/rtf': 'rtf',
        'text/tab-separated-values': 'tsv',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/xml': 'xml',
        'application/json': 'json'
    }
    return mime_to_filetype_map.get(mime_type)


def resolve_file(url):
    file_type, _ = guess_file_type(url)
    transformer = fileTypes.get(file_type)
    if transformer:
        return transformer, file_type

    mime_type = get_mime_from_head_request(url)
    if mime_type:
        file_type = map_mime_to_filetype(mime_type)
        transformer = fileTypes.get(file_type)
        return transformer, file_type

def get_document(url):
    transformer, file_type = resolve_file(url)
    fileName = save_file(url, file_type)
    print("Processing", url, file_type, transformer, fileName)
    nodes = transformer(fileName, file_type)
    delete_file(fileName)
    return nodes
