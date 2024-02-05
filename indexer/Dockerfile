FROM node:20-alpine
COPY package*.json ./
COPY yarn.lock ./
COPY tsconfig.json ./
RUN yarn install
COPY src/ src/
ENTRYPOINT yarn start