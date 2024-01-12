FROM node:20-alpine
COPY package*.json ./
COPY yarn.lock ./
RUN yarn install
COPY src/ src/
COPY lit_action.js lit_action.js
ENTRYPOINT yarn start
