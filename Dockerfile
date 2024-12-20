FROM node:lts-bullseye-slim

ENV DEBIAN_FRONTEND="noninteractive" \
    LANGUAGE="en_US.UTF-8" \
    LANG="en_US.UTF-8" \
    LC_ALL="en_US.UTF-8" \
    TERM="xterm"

RUN apt-get update && \
    apt-get --no-install-recommends install -y curl ca-certificates binutils xz-utils python3 python3-pip && \
    python3 -m pip install -U yt-dlp &&\
    curl -Ls https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz | tar Jx -C /usr/local/bin --transform='s:.*/::' --wildcards '*/ffmpeg' '*/ffplay' '*/ffprobe' && \
    chmod a+rx /usr/local/bin/ffmpeg && \
    chmod a+rx /usr/local/bin/ffplay && \
    chmod a+rx /usr/local/bin/ffprobe

WORKDIR /usr/src/app

ENV PNPM_HOME="/pnpm"

ENV PATH="/usr/local/bin:$PNPM_HOME:$PATH"

RUN corepack enable

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run lint && pnpm run build

CMD [ "node", "dist/index.js" ]
