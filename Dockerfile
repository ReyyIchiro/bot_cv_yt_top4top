FROM node:20-slim

# Install yt-dlp, ffmpeg, python3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg curl ca-certificates && \
    pip3 install --break-system-packages yt-dlp yt-dlp-ejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files & install deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Buat folder temp
RUN mkdir -p temp

CMD ["node", "index.js"]
