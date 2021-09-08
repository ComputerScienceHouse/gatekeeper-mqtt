FROM docker.io/node:16

RUN npm i -g pnpm

COPY package.json /app/package.json
COPY pnpm-lock.yaml /app/pnpm-lock.yaml
WORKDIR /app
RUN pnpm i --production=true

COPY . /app
CMD pnpm run kube
