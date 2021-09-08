FROM docker.io/node:16

RUN npm i -g pnpm

COPY . /app
WORKDIR /app
RUN pnpm i
CMD pnpm run kube
