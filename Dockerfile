FROM node:18
WORKDIR /backend
COPY package.json ./
RUN yarn install
COPY src/ src/
ENTRYPOINT yarn start