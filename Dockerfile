FROM node:12.19.0-alpine3.10
WORKDIR /api
COPY package.json ./
RUN yarn install
COPY . .
ENTRYPOINT yarn start