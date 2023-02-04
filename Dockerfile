FROM apify/actor-node-puppeteer-chrome:latest
WORKDIR /backend
COPY package.json ./
RUN yarn install
COPY src/ src/
ENTRYPOINT yarn start