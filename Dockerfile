FROM python:3.11.5
WORKDIR /code
RUN pip3 install numpy==1.24.2 fastapi==0.99.1 pydantic==1.10.11 llama_index==0.8.58 chromadb==0.4.10  uuid  openai redis --no-cache-dir
RUN pip3 install "unstructured[all-docs]"

COPY ./app /code/app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
