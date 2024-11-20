FROM node:20.18-alpine
COPY package*.json ./
COPY yarn.lock ./
RUN yarn install
COPY src/ src/
ENTRYPOINT yarn api
