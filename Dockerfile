FROM apify/actor-node-puppeteer-chrome:latest
COPY package*.json ./
RUN yarn install
COPY src/ src/
COPY lit_action.js lit_action.js
ENTRYPOINT yarn start
