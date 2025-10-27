
FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./

RUN npm i

COPY . .

CMD ["node", "src/index.js"]
