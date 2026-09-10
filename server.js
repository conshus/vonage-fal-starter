import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Vonage } from '@vonage/server-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

// Reconstruct __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Check for required env vars
if (!process.env.VONAGE_APPLICATION_ID || !process.env.VONAGE_PRIVATE_KEY || !process.env.FAL_KEY) {
  console.error("Missing required environment variables. Please check your .env file.");
  process.exit(1);
}

// Initialize Vonage SDK
const vonage = new Vonage({
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey: process.env.VONAGE_PRIVATE_KEY
});

// In-memory store for room sessions (for hackathon simplicity)
const roomToSessionIdDictionary = {};

// Endpoint to generate/retrieve Vonage Sessions and Tokens
app.get('/room/:name', async (req, res) => {
  const roomName = req.params.name;

  try {
    let sessionId;
    if (roomToSessionIdDictionary[roomName]) {
      sessionId = roomToSessionIdDictionary[roomName];
    } else {
      const session = await vonage.video.createSession({ mediaMode: 'routed' });
      sessionId = session.sessionId;
      roomToSessionIdDictionary[roomName] = sessionId;
    }

    const token = vonage.video.generateClientToken(sessionId, { role: 'publisher' });
    
    res.json({
      applicationId: process.env.VONAGE_APPLICATION_ID,
      sessionId: sessionId,
      token: token
    });
  } catch (err) {
    console.error("Error generating session:", err);
    res.status(500).json({ error: 'Error generating Vonage session' });
  }
});

// Secure endpoint to get a short-lived token for the fal.ai frontend SDK
app.get('/api/fal/token', async (req, res) => {
  try {
    const response = await fetch('https://api.fal.ai/v1/auth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        allowed_paths: ['/decart/lucy-2-5/realtime'] 
      })
    });
    
    if (!response.ok) {
        throw new Error(`fal.ai API returned status ${response.status}`);
    }
    
    const data = await response.json();
    res.json({ token: data.token });
  } catch (error) {
    console.error("Error generating fal token:", error);
    res.status(500).json({ error: 'Failed to generate fal token' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});