FROM node:22-alpine
COPY package*.json ./
COPY yarn.lock ./
RUN yarn install
COPY src/ src/
ENTRYPOINT yarn api
