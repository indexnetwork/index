FROM python:3.11.5
WORKDIR /code
RUN pip3 install numpy==1.24.2 fastapi==0.99.1 pydantic==1.10.11 langchain==0.0.326 llama_index==0.8.28 chromadb==0.4.10  uuid  openai==0.28.0 redis --no-cache-dir
RUN pip3 install "unstructured[all-docs]"
RUN pip3 install opencv-python-headless

COPY ./app /code/app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
