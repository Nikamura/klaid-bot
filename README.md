# Klaid - Media Download Telegram Bot 🎥🤖

Telegram bot written in Node.js for downloading videos and image galleries from the internet and serving them as native media in Telegram. Uses yt-dlp for videos and gallery-dl for image galleries. Ensures privacy as users do not need to visit websites to download content.

![klaid logo](klaid.png)

## Features 🌟

- Supports Telegram groups. (**/dl [URL]** command)
- Original message deletion.
- Converts videos to MP4 automatically.
- Image gallery downloads (Instagram carousels, Reddit galleries, etc.) via gallery-dl.
- Automatic detection — tries video first, falls back to gallery.
- Whitelisting domains for automatic downloading in groups.
- Multiple media downloads from single message.

## Installation 🛠️

1. Clone the repository:

   ```bash
   git clone https://github.com/Nikamura/klaid-bot.git
   ```

1. Navigate to the project directory:

   ```bash
   cd klaid-bot/
   ```

1. Install dependencies:

   ```bash
   pnpm install
   ```

1. Set up your environment variables (refer to **.env.example** for required keys).

1. Start the bot:

   ```bash
   pnpm run start
   ```

## Usage 🚀

1. Start chat with Telegram bot.
1. Send bot a video or gallery link.
1. Receive the media!

or

1. Add Telegram bot to your group chat.
1. Send a command **/dl** (or **/download**) [URL] [URL] or a message with whitelisted domains.
1. Receive the video or gallery!
1. **optional** Make Bot user an _admin_ in your group chat for request message cleanup.

## Contributing 🤝

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License 📝

This project is open-source and available under the MIT License.

## Credits ❤️

Built with passion by [Karolis Mazukna](https://github.com/nikamura).
