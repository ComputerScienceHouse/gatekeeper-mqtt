FROM docker.io/node:16

RUN npm i -g pnpm

COPY package.json /app/package.json
WORKDIR /app
RUN pnpm i

COPY . /app
CMD pnpm run kube
