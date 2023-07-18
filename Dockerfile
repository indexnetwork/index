FROM python:3.11.3
WORKDIR /code
RUN pip3 install numpy==1.24.2 fastapi==0.85.1 pydantic==1.10.11 llama_index==0.7.10 chromadb==0.3.29 openai redis --no-cache-dir
COPY ./app /code/app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
