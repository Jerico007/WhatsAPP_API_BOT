const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'your-secure-api-key';

app.use(bodyParser.json());
app.use(cors({ origin: '*', methods: 'GET,HEAD,PUT,PATCH,POST,DELETE' }));

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

let sock; // Store WhatsApp connection

// Start WhatsApp bot
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({ auth: state, printQRInTerminal: true });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log('📸 Scan this QR code:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('✅ WhatsApp connected!');
        } else if (connection === 'close') {
            console.log('❌ Connection closed. Reconnecting...');
            startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Function to download Google Drive file
async function downloadDriveFile(fileUrl) {
    try {
        const fileId = fileUrl.match(/[-\w]{25,}/)[0];
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        const mimeType = response.headers['content-type'];
        const fileName = `drive_file_${fileId}.${mimeType.split('/')[1] || 'file'}`;
        return { buffer: Buffer.from(response.data), mimetype: mimeType, fileName };
    } catch (err) {
        console.error('❌ Failed to download Google Drive file:', err);
        throw new Error('Failed to download file from Google Drive link.');
    }
}

// Send Message with Optional Attachment (File, URL, or Drive Link)
app.post('/send-message', upload.single('file'), async (req, res) => {
    const { apiKey, recipients, message, fileUrl } = req.body;
    const file = req.file;

    // Check API key
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }

    // Validate inputs
    if (!recipients || !message) {
        return res.status(400).json({ error: 'Recipients and message are required' });
    }

    const sendMessages = async () => {
        for (const phone of recipients) {
            const formattedPhone = phone.includes('@s.whatsapp.net')
                ? phone
                : `${phone}@s.whatsapp.net`;

            const delay = Math.floor(Math.random() * (25000 - 15000 + 1)) + 15000;
            console.log(`⏳ Sending to ${phone} after ${delay / 1000} seconds...`);

            await new Promise((resolve) => setTimeout(resolve, delay));

            try {
                let mediaMessage = null;

                if (file) {
                    const filePath = path.resolve(file.path);
                    mediaMessage = {
                        mimetype: file.mimetype,
                        fileName: file.originalname,
                        caption: message,
                        [file.mimetype.startsWith('image') ? 'image' : file.mimetype.startsWith('video') ? 'video' : 'document']: fs.readFileSync(filePath)
                    };
                    fs.unlinkSync(filePath);
                } else if (fileUrl) {
                    if (fileUrl.includes('drive.google.com')) {
                        const driveFile = await downloadDriveFile(fileUrl);
                        mediaMessage = {
                            mimetype: driveFile.mimetype,
                            fileName: driveFile.fileName,
                            caption: message,
                            [driveFile.mimetype.startsWith('image') ? 'image' : driveFile.mimetype.startsWith('video') ? 'video' : 'document']: driveFile.buffer
                        };
                    } else {
                        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
                        const mimeType = response.headers['content-type'];
                        mediaMessage = {
                            mimetype: mimeType,
                            fileName: path.basename(fileUrl),
                            caption: message,
                            [mimeType.startsWith('image') ? 'image' : mimeType.startsWith('video') ? 'video' : 'document']: Buffer.from(response.data)
                        };
                    }
                }

                if (mediaMessage) {
                    await sock.sendMessage(formattedPhone, mediaMessage);
                    console.log(`✅ Text and media sent to ${phone}`);
                } else {
                    await sock.sendMessage(formattedPhone, { text: message });
                    console.log(`✅ Text message sent to ${phone}`);
                }
            } catch (err) {
                console.error(`❌ Failed to send message to ${phone}:`, err);
            }
        }
    };

    sendMessages();
    res.json({ success: true, message: 'Bulk messaging started. Check logs for progress.' });
});

// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 API running on http://localhost:${PORT}`);
});

startBot();
