# Discord Bot

## 📌 Description

This is a **Discord bot** built using **TypeScript** and `discord.js`. It provides channel visibility management, and automated messaging. The bot is designed to handle mentions, modify channel permissions.

---

## ⚙️ Installation

### **1. Clone the Repository**

```sh
git clone https://github.com/good-gartic/GGaudio.git
cd GGaudio
```

### **2. Install Dependencies**

```sh
npm install
```

### **3. Configure Environment Variables**

Create a `.env` file in the root directory and add:

```env
DISCORD_BOT_TOKEN=bot_token
```

Make sure you replace `your_bot_token` with your actual bot token from the Discord Developer Portal.

### **4. Compile TypeScript**

```sh
npm run build
```

### **5. Run the Bot**

```sh
npm start
```

---

## 🚀 Features

- Listens to role mentions and responds accordingly.
- Manages voice and text channel permissions.
- Supports role-based access control.
- Sends automated messages in response to triggers.
- Written in TypeScript for better type safety and maintainability.

---

## 🛠 Configuration

Modify the `CHANNELS` object in `constants.ts` (or equivalent) to map channels and roles:

```ts
export const CHANNELS = {
    PING_CHANNEL: "your-ping-channel-id",
    TEST_ROLE: "your-role-id"
};
```



---

## 🏗 Tech Stack

- **Language:** TypeScript
- **Library:** discord.js v14+
- **Runtime:** Node.js

---

## 🤝 Contributing

1. Fork the repository
2. Create a new branch (`git checkout -b feature-branch`)
3. Make your changes and commit (`git commit -m "Added new feature"`)
4. Push to your fork (`git push origin feature-branch`)
5. Open a Pull Request

---

## 📧 Contact

For issues or feature requests, open an issue in the repository or reach out via Discord.

Happy Coding! 🎉