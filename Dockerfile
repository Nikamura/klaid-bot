FROM node:18.17.1-bullseye-slim

ENV DEBIAN_FRONTEND="noninteractive" \
    LANGUAGE="en_US.UTF-8" \
    LANG="en_US.UTF-8" \
    LC_ALL="en_US.UTF-8" \
    TERM="xterm"

RUN apt-get update && \
    apt-get --no-install-recommends install -y curl ca-certificates binutils xz-utils python3 python3-pip && \
    python3 -m pip install -U yt-dlp

RUN  curl -Ls https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz | tar Jx -C /usr/local/bin --transform='s:.*/::' --wildcards '*/ffmpeg' '*/ffplay' '*/ffprobe' && \
    chmod a+rx /usr/local/bin/ffmpeg && \
    chmod a+rx /usr/local/bin/ffplay && \
    chmod a+rx /usr/local/bin/ffprobe

WORKDIR /usr/src/app

COPY package.json yarn.lock ./

RUN yarn install

COPY . .

RUN yarn build

CMD [ "yarn", "start:prod" ]
