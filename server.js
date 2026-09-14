import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Vonage } from '@vonage/server-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

// Reconstruct __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const codespaceUrl = process.env.CODESPACE_URL;

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
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
const sessionState = {};

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
      sessionState[sessionId] = {};
    }

    const token = vonage.video.generateClientToken(sessionId, { role: 'publisher' });

    res.json({
      applicationId: process.env.VONAGE_APPLICATION_ID,
      sessionId,
      token
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

// fal.ai Token Endpoint
app.post('/api/fal/token', express.json(), async (req, res) => {
  // Read the requested app from the frontend, default to Lucy if missing
  const targetApp = req.body.app || 'decart/lucy-2-5/realtime';
  // const targetApp = req.body.app || 'decart/lucy-2-5/realtime';
  console.log("Requested target app:", targetApp);

  try {
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
      const errorText = await response.text();
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


// fal.ai Proxy Route (Uses RAW parser for binary streaming)
// app.all(["/api/fal/proxy", "/api/fal/proxy/*"], express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
//   const targetUrl = req.headers["x-fal-target-url"];
//   console.log("Proxying request to:", targetUrl);
//   console.log("Request method:", req.method);
//   console.log("Request headers:", req.headers);
//   console.log("Request body:", req.body);

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

// Experience Composer Endpoints
// app.post('/api/composer/start', express.json(), async (req, res) => {
//   const { sessionId, roomName } = req.body;
//   const composerUrl = `${codespaceUrl}/composer.html?room=${roomName}`;
//   console.log("Starting composer with URL:", composerUrl);

//   try {
//     const composerToken = vonage.video.generateClientToken(sessionId, { role: 'publisher' });
//     const render = await vonage.video.startExperienceComposerRender(
//       sessionId,
//       composerToken,
//       {
//         url: composerUrl,
//         properties: {
//           name: "Hackbarna Stream",
//           resolution: "1280x720",
//           statusCallbackUrl: `${codespaceUrl}/api/webhooks/composer`
//         }
//       }
//     );
//     res.json(render);
//   } catch (error) {
//     console.error("Composer Error:", error);
//     res.status(500).json({ error: "Failed to start Experience Composer" });
//   }
// });

// app.post('/api/composer/stop', express.json(), async (req, res) => {
//   try {
//     await vonage.video.stopExperienceComposerRender(req.body.renderId);
//     res.json({ success: true });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to stop render" });
//   }
// });

// Broadcast Endpoints
app.post('/api/broadcast/start', express.json(), async (req, res) => {
  const { sessionId } = req.body;
  try {
    const broadcast = await vonage.video.startBroadcast(sessionId, {
      // streamMode: 'manual',
      outputs: {
        hls: {
          // dvr: true,
          lowLatency: true
        },
        rtmp: [
          {
            id: "youtube_stream",
            serverUrl: "rtmp://a.rtmp.youtube.com/live2",
            streamName: "YOUR_YOUTUBE_STREAM_KEY"
          },
          {
            id: "facebook_stream",
            serverUrl: "rtmps://live-api-s.facebook.com:443/rtmp/",
            streamName: "YOUR_FACEBOOK_STREAM_KEY"
          },
          {
            id: "linkedin_stream",
            serverUrl: "rtmps://ingest.linkedin.com:443/rtmp/",
            streamName: "YOUR_LINKEDIN_STREAM_KEY"
          },
          {
            id: "twitch_stream",
            serverUrl: "rtmp://live.twitch.tv/app",
            streamName: "YOUR_TWITCH_STREAM_KEY"
          }
        ]
      }
    });

    // Save active broadcast ID to state
    if (!sessionState[sessionId]) sessionState[sessionId] = {};
    sessionState[sessionId].broadcastId = broadcast.id;
    sessionState[sessionId].hlsUrl = broadcast.broadcastUrls.hls;

    // If the composer stream ALREADY fired its 'started' webhook, inject it instantly
    // if (sessionState[sessionId].composerStreamId) {
    //     await vonage.video.addStreamToBroadcast(broadcast.id, sessionState[sessionId].composerStreamId);
    // }

    console.log("Broadcast started:", broadcast);
    res.json(broadcast);
  } catch (error) {
    console.error("Broadcast Error:", error);
    res.status(500).json({ error: "Failed to start Broadcast" });
  }
});

// app.post('/api/broadcast/add-stream', express.json(), async (req, res) => {
//   const { broadcastId, streamId } = req.body;
//   console.log("Adding stream to broadcast:", { broadcastId, streamId });
//   try {
//     await vonage.video.addStreamToBroadcast(broadcastId, streamId);
//     res.json({ success: true });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to add stream to broadcast" });
//   }
// });

app.post('/api/broadcast/stop', express.json(), async (req, res) => {
  try {
    await vonage.video.stopBroadcast(req.body.broadcastId);
    sessionState[req.body.sessionId].broadcastId = null;
    sessionState[req.body.sessionId].hlsUrl = null;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to stop broadcast" });
  }
});

// Endpoint for the Watch page to fetch the active HLS URL
app.get('/api/broadcast/hls/:roomName', (req, res) => {
  const sessionId = roomToSessionIdDictionary[req.params.roomName];
  if (sessionId && sessionState[sessionId] && sessionState[sessionId].hlsUrl) {
    res.json({ hlsUrl: sessionState[sessionId].hlsUrl });
  } else {
    res.status(404).json({ error: "Broadcast is not currently live." });
  }
});

// Archive Endpoints (Manual Mode)
app.post('/api/archive/start', express.json(), async (req, res) => {
  console.log("Starting archive for session:", req.body.sessionId);
  try {
    const archive = await vonage.video.startArchive(req.body.sessionId, {
      name: 'Hackbarna Archive',
      // streamMode: 'manual' 
    });
    // Save active archive ID to state
    if (!sessionState[req.body.sessionId]) sessionState[req.body.sessionId] = {};
    sessionState[req.body.sessionId].archiveId = archive.id;

    // Instantly inject if composer is ready
    // if (sessionState[sessionId].composerStreamId) {
    //     await vonage.video.addStreamToArchive(archive.id, sessionState[sessionId].composerStreamId);
    // }
    console.log("Archive Data:", archive);
    res.json(archive);
  } catch (error) {
    console.log("Archive Error:", error);
    res.status(500).json({ error: "Failed to start archive" });
  }
});

// app.post('/api/archive/add-stream', express.json(), async (req, res) => {
//   const { archiveId, streamId } = req.body;
//   try {
//     await vonage.video.addStreamToArchive(archiveId, streamId);
//     res.json({ success: true });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to add stream to archive" });
//   }
// });

app.post('/api/archive/stop', express.json(), async (req, res) => {
  console.log("Stopping archive for archiveId:", req.body);
  try {
    const archive = await vonage.video.stopArchive(req.body.archiveId);
    sessionState[req.body.sessionId].archiveId = null;
    console.log("Stopped archive:", archive);
    res.json({ success: true, archive });
  } catch (error) {
    console.log("Failed to stop archive:", error);
    res.status(500).json({ error: "Failed to stop archive" });
  }
});

// Archive Status Webhook (Triggered by Vonage)
app.post('/api/archive/status', express.json(), async (req, res) => {
  res.status(200).send('OK'); // Acknowledge instantly so Vonage doesn't retry

  const archiveEvent = req.body;
  if (archiveEvent.status === 'available') {
    try {
      // Send a signal directly to the broadcaster's UI containing the download link [INDEX]
      await vonage.video.sendSignal({
        type: 'archiveAvailable',
        data: archiveEvent.url
      },
        archiveEvent.sessionId
      );
      console.log("Sent archive download signal to broadcaster.");
    } catch (err) {
      console.error("Failed to send archive signal:", err);
    }
  }
});

// Add the webhook endpoint to catch the Composer events
// app.all('/api/webhooks/composer', express.json(), async (req, res) => {
//   // Always acknowledge the Vonage webhook immediately
//   res.status(200).send('OK');

//   const { sessionId, status, streamId } = req.body;
//   console.log("Composer Webhook Received:", req.body);

//   // We only care about the exact moment the stream goes live
//   if (status === 'started' && streamId) {
//     console.log(`✅ Composer Stream is LIVE! Stream ID: ${streamId}`);

//     // 1. Save it to our state tracker
//     if (!sessionState[sessionId]) sessionState[sessionId] = {};
//     sessionState[sessionId].composerStreamId = streamId;

//     // 2. Auto-inject into Broadcast if the user already started it
//     if (sessionState[sessionId].broadcastId) {
//       try {
//         await vonage.video.addStreamToBroadcast(sessionState[sessionId].broadcastId, streamId);
//         console.log('Automatically injected Composer into the active Broadcast.');
//       } catch (e) { console.error('Broadcast inject error:', e); }
//     }

//     // 3. Auto-inject into Archive if the user already started it
//     if (sessionState[sessionId].archiveId) {
//       try {
//         await vonage.video.addStreamToArchive(sessionState[sessionId].archiveId, streamId);
//         console.log('Automatically injected Composer into the active Archive.');
//       } catch (e) { console.error('Archive inject error:', e); }
//     }
//   }
// });

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});