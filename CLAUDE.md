# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Klaid is a Telegram bot that automatically downloads videos from URLs shared in chat messages. It uses yt-dlp for video downloading and grammY as the Telegram bot framework.

**Bot commands**: `/dl [URL]` or `/download [URL]` - downloads video from URL. In private chats, any message with a URL triggers auto-download.

## Commands

```bash
# Development (with hot reload, uses .env file)
pnpm start

# Build
pnpm build

# Lint and format check
pnpm lint

# Auto-fix formatting
pnpm format

# Run tests with coverage
pnpm test

# Run a single test file
pnpm tsx --test src/__tests__/bot.test.ts
```

## Architecture

- **Entry point**: `src/index.ts` - starts the bot
- **Bot setup**: `src/bot.ts` - grammY bot configuration and message handlers
- **Video downloading**: `src/download-video.ts` - uses yt-dlp CLI to download videos
- **URL discovery**: `src/discover-urls.ts` - extracts URLs from message text using get-urls library
- **Configuration**: `src/utils/config.ts` - environment variable parsing and validation
- **Custom context**: `src/types/bot-context.ts` - extends grammY Context with logger and isPrivateChat

## Key Patterns

- Uses ESM modules (`.js` extensions in imports required)
- Tests use Node.js built-in test runner (`node:test`)
- Biome for linting/formatting (120 char line width, spaces for indentation)
- Winston for logging with child loggers per message

## Environment Variables

- `KLAID_TELEGRAM_BOT_TOKEN` (required) - Telegram bot token
- `KLAID_LOG_LEVEL` - defaults to "info"
- `KLAID_DOWNLOAD_DIR` - defaults to "/tmp"
- `KLAID_AUTO_DL_URLS` - JSON array of URL patterns for auto-download (defaults: tiktok.com, youtube.com/shorts/, instagram.com/reel/)
- `KLAID_AUTO_DL_DELETE_MESSAGE` - whether to delete original message after download (default: true)
- `KLAID_TELEGRAM_API_ROOT` - optional custom Telegram API server

## Docker

The Dockerfile includes yt-dlp and ffmpeg. Build runs lint and compile before creating the production image.
