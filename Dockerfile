FROM docker.io/node:26

RUN mkdir /corepack && chmod a+rx /corepack
ENV COREPACK_HOME=/corepack

RUN npm i -g corepack
RUN corepack enable

COPY package.json /app/package.json
COPY pnpm-lock.yaml /app/pnpm-lock.yaml
WORKDIR /app
RUN pnpm i --production=true

COPY . /app
CMD pnpm run kube
