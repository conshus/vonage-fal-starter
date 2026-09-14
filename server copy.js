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
// app.use(express.json());
// app.use(express.static(path.join(__dirname, 'public')));

// Ensure Express can parse large raw payloads for the proxy
// app.use(express.raw({ type: "*/*", limit: "50mb" }));
// app.use(express.json()); 
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

// Redirect /session to a specific room named "session"
app.get('/session', function (req, res) {
    res.redirect('/room/session');
});

// // Secure endpoint to get a short-lived token for the fal.ai frontend SDK
// app.get('/api/fal/token', async (req, res) => {
//   try {
//     const response = await fetch('https://api.fal.ai/v1/auth/token', {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${process.env.FAL_KEY}`,
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify({
//         allowed_paths: ['/decart/lucy-2-5/realtime'] 
//       })
//     });

//     if (!response.ok) {
//         throw new Error(`fal.ai API returned status ${response.status}`);
//     }

//     const data = await response.json();
//     res.json({ token: data.token });
//   } catch (error) {
//     console.error("Error generating fal token:", error);
//     res.status(500).json({ error: 'Failed to generate fal token' });
//   }
// });

// app.all("/api/fal/proxy/*", async (req, res) => {
//   const targetUrl = req.headers["x-fal-target-url"];

//   if (!targetUrl) {
//     return res.status(400).json({ error: "Missing target URL" });
//   }

//   try {
//     const response = await fetch(targetUrl, {
//       method: req.method,
//       headers: {
//         ...req.headers,
//         "Authorization": `Key ${process.env.FAL_KEY}`,
//         "host": new URL(targetUrl).host
//       },
//       // Only attach body for POST/PUT requests
//       body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined
//     });

//     // Pipe the exact status back to the client
//     res.status(response.status);

//     // Read the response from fal.ai and send it back to the browser
//     const data = await response.buffer();
//     res.send(data);

//   } catch (error) {
//     console.error("Proxy error:", error);
//     res.status(500).json({ error: "Proxy request failed" });
//   }
// });

// // 1. Explicit Token Route for Real-Time WebSockets
// app.post('/api/fal/token', async (req, res) => {
//   try {
//     const response = await fetch('https://rest.fal.ai/tokens/realtime', {
//       method: 'POST',
//       headers: {
//         'Authorization': `Key ${process.env.FAL_KEY}`, 
//         'Content-Type': 'application/json'
//       },
//       // ADDED: You must provide the allowed_apps array to avoid the 422 error
//       body: JSON.stringify({
//         allowed_apps: ['decart/lucy-2-5/realtime'],
//         duration: 120,
//       })
//     });

//     if (!response.ok) {
//         throw new Error(`fal API returned ${response.status}`);
//     }

//     const data = await response.json();
//     res.json({ token: data.token });
//   } catch (error) {
//     console.error("Token error:", error);
//     res.status(500).json({ error: "Failed to generate token" });
//   }
// });

// // 2. Fixed Manual Proxy Route for standard HTTP fal calls
// app.all(["/api/fal/proxy", "/api/fal/proxy/*"], async (req, res) => {
//   const targetUrl = req.headers["x-fal-target-url"];

//   if (!targetUrl) {
//     return res.status(400).json({ error: "Missing target URL" });
//   }

//   try {
//     const response = await fetch(targetUrl, {
//       method: req.method,
//       headers: {
//         ...req.headers,
//         "Authorization": `Key ${process.env.FAL_KEY}`,
//         "host": new URL(targetUrl).host
//       },
//       body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined
//     });

//     res.status(response.status);
//     const data = await response.buffer();
//     res.send(data);
//   } catch (error) {
//     console.error("Proxy error:", error);
//     res.status(500).json({ error: "Proxy request failed" });
//   }
// });


// 1. Explicit Token Route (Uses JSON parser)
app.post('/api/fal/token', express.json(), async (req, res) => {
  // Read the requested app from the frontend, default to Lucy if missing
  const targetApp = req.body.app || 'decart/lucy-2-5/realtime';
  // const targetApp = req.body.app || 'decart/lucy-2-5/realtime';
  console.log("Requested target app:", targetApp);

  try {
    // FIXED: The endpoint is exactly /tokens/ without /realtime at the end
    const response = await fetch('https://rest.fal.ai/tokens/realtime', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // allowed_apps: [targetApp],
        app: targetApp,
        duration: 120
      })
    });

    if (!response.ok) {
      // console.log("fal API response not OK:", response);
      const errorText = await response.text();

      // 2. Log it to your Codespace terminal so you can read it
      console.error("FAL API 422 Error Details:", errorText);

      throw new Error(`fal API returned ${response.status}`);
    }

    const data = await response.json();
    console.log("Fetched token data:", data);
    res.json({ token: data });
  } catch (error) {
    console.error("Token error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});


// 2. Fixed Manual Proxy Route (Uses RAW parser for binary streaming)
app.all(["/api/fal/proxy", "/api/fal/proxy/*"], express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
  const targetUrl = req.headers["x-fal-target-url"];
  console.log("Proxying request to:", targetUrl);
  console.log("Request method:", req.method);
  console.log("Request headers:", req.headers);
  console.log("Request body:", req.body);

  if (!targetUrl) {
    return res.status(400).json({ error: "Missing target URL" });
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        "Authorization": `Key ${process.env.FAL_KEY}`,
        "host": new URL(targetUrl).host
      },
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined
    });

    res.status(response.status);
    const data = await response.buffer();
    res.send(data);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ error: "Proxy request failed" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});