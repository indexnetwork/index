# moralmod-assessment: the moralmod-consult-0 service around the lab's pipeline.
# The pipeline repo is private: pass a read-scoped GitHub token as a BuildKit
# secret (never a build arg):
#   docker build --secret id=github_token,src=token.txt -t moralmod-assessment .
FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /srv
COPY pyproject.toml ./
RUN --mount=type=secret,id=github_token \
    GIT_TOKEN=$(cat /run/secrets/github_token) && \
    git config --global url."https://x-access-token:${GIT_TOKEN}@github.com/".insteadOf "https://github.com/" && \
    uv pip install --system . && \
    git config --global --unset url."https://x-access-token:${GIT_TOKEN}@github.com/".insteadOf

COPY app ./app

# Non-root, as the lab's own images run.
RUN useradd -u 10001 -m runner
USER runner

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
