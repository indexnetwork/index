FROM apify/actor-node-puppeteer-chrome:latest@sha256:9b5b1138e2d78d20700ab94db0d0594ca8646ad67f8b46f34dbeb83252c6827a
WORKDIR /
COPY package*.json ./
RUN yarn install
COPY src/ src/
ENTRYPOINT yarn start