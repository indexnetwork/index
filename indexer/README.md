# Indexer

This documentation outlines the usage of the API endpoints for a NestJS application featuring two main controllers: Indexer Controller and Chat Controller. Each controller is responsible for handling specific operations within the application, with a total of 8 endpoints described below.


## Usage

```sh
yarn build
yarn start:dev
```

## A. Indexer Controller
The Indexer Controller is designed for crawling, embedding extraction, and indexing operations. Below are the details of its endpoints:

### 1. Crawl Document Content

- **Method**: `POST`
- **Endpoint**: /indexer/crawl
- **Description**: Crawls the document content from a given URL using Unstructured.io API.
- **Body Parameters**:
    - `url (string)`: The URL of the document to crawl.
- **Response**: Returns a key-value pair of 'content' (string) representing the textual content of the document.


- **Example Usage**

  - curl request:

  ```sh
  curl -X POST http://localhost:3012/indexer/crawl \
      -H "Content-Type: application/json" \
      -d '{"url": "https://example.com"}'
  ```

  - Python request:

  ```python
  url = 'http://localhost:3012/indexer/crawl'
  payload = {'url': 'https://example.com'}
  response = requests.post(url, json=payload)
  print(response.text)
  ```

### 2. Extract Document Embeddings

- **Method**: `POST`
- **Endpoint**: /indexer/embeddings
- **Description**: Extracts embeddings for the given document using OpenAI embeddings.
- **Body Parameters**:
    - `content (string)`: The textual content of the document. 
- **Response**: Returns a list of floats representing the embedding vector.

- **Example Usage**
  - curl request

  ```sh
  curl -X POST http://localhost:3012/indexer/embeddings \
      -H "Content-Type: application/json" \
      -d '{"content": "Document content goes here"}'
  ```

  - Python request:

  ```python
  import requests

  url = 'http://localhost:3012/indexer/embeddings'
  payload = {'content': 'Document content goes here'}
  response = requests.post(url, json=payload)
  print(response.text)
  ```

### 3. Add Document to Database

- **Method**: `POST`
- **Endpoint**: /indexer/index
- **Description**: Adds a document to the ChromaDB database with the appropriate metadata and content.
- **Body Parameters**: An object containing the following keys:
    - `indexId (string)`
    - `indexTitle (string)`
    - `indexCreatedAt (date)`
    - `indexUpdatedAt (date)`
    - `indexDeletedAt (date)`
    - `indexOwnerDID (string)`
    - `webPageId (string)`
    - `webPageTitle (string)`
    - `webPageUrl (string)`
    - `webPageCreatedAt (date)`
    - `webPageContent (string)`
    - `webPageUpdatedAt (date)`
    - `webPageDeletedAt (date)`
    - `vector (number[])`:
- **Response**: Returns a success or error message.
- **Example Usage**

  - curl request:

  ```sh
  curl -X POST http://localhost:3012/indexer/index \
      -H "Content-Type: application/json" \
      -d '{"indexId": "1", "indexTitle": "Title", ...}'
  ```
  - Python request:

  ```python
  import requests

  url = 'http://localhost:3012/indexer/index'
  payload = {
    'indexId': '1',
    'indexTitle': 'Title',
    # Add other fields as necessary
  }
  response = requests.post(url, json=payload)
  print(response.text)
  ```


### 4. Update Document Metadata or Content

- **Method**: `PUT`
- **Endpoint**: /indexer/index
- **Description**: Updates the given document metadata or content with the given sublist of keys and their updated values.
- **Body Parameters**: An object containing a subset of keys from the document model and their new values.
- **Response**: Returns a success or error message.

- **Example Usage**

  - curl request:

  ```sh
  curl -X PUT http://localhost:3012/indexer/index \
      -H "Content-Type: application/json" \
      -d '{"indexId": "1", "indexTitle": "Updated Title"}'
  ```
  - Python request:

  ```python
  import requests

  url = 'http://localhost:3012/indexer/index'
  payload = {'indexId': '1', 'indexTitle': 'Updated Title'}
  response = requests.put(url, json=payload)
  print(response.text)
  ```


### 5. Delete Index

- **Method**: `DELETE`
- **Endpoint**: /indexer/index
- **Description**: Deletes the given index items from the "indexId".
- **Body Parameters**: An object with the key indexId.
    - `indexId (string)`: 

- **Response**: Returns a success or error message.

- **Example Usage**

  - curl request:

  ```sh
  curl -X DELETE http://localhost:3012/indexer/index \
      -H "Content-Type: application/json" \
      -d '{"indexId": "1"}'
  ```
  - Python request:

  ```python
  import requests

  url = 'http://localhost:3012/indexer/index'
  payload = {'indexId': '1'}
  response = requests.delete(url, json=payload)
  print(response.text)
  ```


### 6. Delete Index Item

- **Method**: `DELETE`
- **Endpoint**: /indexer/item
- **Description**: Deletes the given index item from the "indexId" and "indexItemId".
- **Body Parameters**: An object with the keys indexId and indexItemId.
    - `indexId (string)`: 
    - `indexItemId (string)`: 

- **Response**: Returns a success or error message.

- **Example Usage**
  - curl request:

  ```sh
  curl -X DELETE http://localhost:3012/indexer/item \
      -H "Content-Type: application/json" \
      -d '{"indexId": "1", "indexItemId": "2"}'
  ```
  - Python request:

  ```python
  import requests

  url = 'http://localhost:3012/indexer/item'
  payload = {'indexId': '1', 'indexItemId': '2'}
  response = requests.delete(url, json=payload)
  print(response.text)
  ```


## B. Chat Controller

The Chat Controller handles operations related to generating content based on a given input and querying the database.

### 7. Generate Content for Question

- **Method**: `POST`
- **Endpoint**: /chat/stream
- **Description**: For a given "question" and "chat_history", generates content for the question.
- **Body Parameters**: An object containing 
  * `question (string)`:
  * `chat_history (string)`:
  * `index_id (string)`:
  * `model_type (string)`:
  * `chain_type (string)`:
- **Response**: Returns "answer" text generated from the ConversationRAGChain module and the "sources", which are the list of "webPageId"s from ChromaDB.

- **Example Usage**
  - curl request:

  ```sh
  curl -X POST http://localhost:3012/chat/stream \
      -H "Content-Type: application/json" \
      -d '{"question": "What is AI?", "chat_history": "...", "index_id": "1", "model_type": "...", "chain_type": "..."}'
  ```
  - Python request:

  ```python
  import requests

  url = 'http://localhost:3012/chat/stream'
  payload = {
    'question': 'What is AI?',
    'chat_history': '...',
    'index_id': '1',
    'model_type': '...',
    'chain_type': '...'
  }
  response = requests.post(url, json=payload)
  print(response.text)
  ```


### 8. Query Database


- **Method**: `POST`
- **Endpoint**: /chat/query
- **Description**: For a given "questions", returns the list of "webPageId"s from the ChromaDB.
- **Body Parameters**: An object with the key questions.
  * `question (string)`:
  * `index_id (string)`:
  * `model_type (string)`:
  * `chain_type (string)`:
- **Response**: Returns the "sources", which are the list of "webPageId"s from ChromaDB.

- **Example Usage**
  - curl request:
  ```sh
  curl -X POST http://localhost:3012/chat/query \
      -H "Content-Type: application/json" \
      -d '{"questions": ["What is AI?"]}'
  ```
  - Python request:

  ```python
  import requests

  url = 'http://localhost:3012/chat/query'
  payload = {'questions': ['What is AI?']}
  response = requests.post(url, json=payload)
  print(response.text)
  ```

