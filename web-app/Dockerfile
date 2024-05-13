FROM node:21-alpine
WORKDIR /app

# Pass API URL as a build argument
ARG API_URL
ENV NEXT_PUBLIC_API_URL=$API_URL

COPY . .
RUN yarn
RUN yarn build

ENTRYPOINT yarn start
