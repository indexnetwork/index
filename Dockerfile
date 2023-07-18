FROM python:3.11.3
WORKDIR /code
COPY ./requirements.txt /code/requirements.txt
RUN pip3 install numpy==1.23.5 fastapi pydantic llama_index chromadb==0.3.26 openai redis  --no-cache
COPY ./app /code/app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
