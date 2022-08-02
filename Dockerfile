FROM node:16.15.0-alpine3.15
WORKDIR /app
COPY . .
RUN yarn
RUN yarn build

ENTRYPOINT yarn start