
FROM node:22

WORKDIR /app

COPY package*.json ./

RUN npm i

COPY . .

CMD ["node", "src/index.js"]
