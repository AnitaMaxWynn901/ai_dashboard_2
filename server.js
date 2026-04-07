const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const User = require("./models/User");
const HEARTBEAT_TIMEOUT = 4 * 60 * 1000;
 /* ================= LOGIN ================= */
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(session({
  name: "ai_dashboard.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new MongoStore({
    mongoUrl: process.env.MONGO_URI,
    collectionName: "sessions"
  }),
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(session({
  name: "ai_dashboard.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new MongoStore({
    mongoUrl: process.env.MONGO_URI,
    collectionName: "sessions"
  }),
  cookie: {
    httpOnly: true,
    secure: true,   
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
function requirePageAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const user = await User.findOne({ username: username.trim() });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    req.session.user = {
      id: user._id,
      username: user.username,
      role: user.role
    };

    res.json({
      ok: true,
      user: {
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});
//create user route for admin
app.post("/users", requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: "Username, password, and role are required" });
    }

    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const existingUser = await User.findOne({ username: username.trim() });
    if (existingUser) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await User.create({
      username: username.trim(),
      passwordHash,
      role,
      isActive: true
    });

    res.json({ ok: true, message: "User created successfully" });
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});



app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }

    res.clearCookie("ai_dashboard.sid");
    res.json({ ok: true });
  });
});

app.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.json({
    user: req.session.user
  });
});

/* ================= MONGOOSE SETUP ================= */
mongoose.set("bufferCommands", false);

const logSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  boxCode: String,
  source: String,
  ip: String,
  online_status: String,
  service_name: String,
  service_status: String,
  type: String
});
const boxMetaSchema = new mongoose.Schema({
  boxCode: String,
  boxName: String,
  deviceName: String
});

const BoxMeta = mongoose.model("BoxMeta", boxMetaSchema);
const Log = mongoose.model("Log", logSchema);
const locationSchema = new mongoose.Schema({
  boxCode: String,
  lat: Number,
  lng: Number
});

const Location = mongoose.model("Location", locationSchema);




/* ================= UTILITIES ================= */

function formatTime(ts) {
  if (!ts) return "-";
  return new Date(ts)
    .toLocaleString("en-GB", {
      timeZone: "Asia/Bangkok",
      hour12: false
    })
    .replace(",", "");
}

async function saveLog(entry) {
  await Log.create(entry);
}

/* =================================================
   LOGS (HISTORY)
================================================= */

app.get("/logs", async (req, res) => {
  try {
    const { type, from, to, boxCode } = req.query;

    let query = {
      type: "status_change",
      online_status: { $exists: true }
    };

    if (type && type !== "ALL") {
      query.source = type;
    }

    if (boxCode && boxCode.trim() !== "") {
      query.boxCode = boxCode.trim();
    }


    if (from || to) {
      query.timestamp = {};

      if (from) {
        const fromDate = new Date(from);
        query.timestamp.$gte = fromDate;  
      }

      if (to) {
        const toDate = new Date(to);
        toDate.setSeconds(59);
        toDate.setMilliseconds(999);
        query.timestamp.$lte = toDate;
      }
    }

    const logs = await Log.find(query)
      .sort({ _id: -1 })
      .limit(1000);

    let filteredLogs = logs;

    res.json(
      filteredLogs.map(log => ({
        ...log.toObject(),
        timestamp: formatTime(log.timestamp)
      }))
    );

  } catch (err) {
    console.error("Logs Error:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});
/* =================================================
   FILTERS
================================================= */

app.get("/filters", async (req, res) => {
  try {
    const boxCodes = await Log.distinct("boxCode", {
      boxCode: { $ne: null }
    });

    res.json({ boxCodes });
  } catch (err) {
    console.error("Filter load error:", err);
    res.status(500).json({ error: "Failed to load filters" });
  }
});
app.get("/locations", async (req, res) => {
  try {
    const locations = await Location.find();
    res.json(locations);
  } catch (err) {
    console.error("Failed to fetch locations:", err);
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});
app.post("/locations", requireAdmin, async (req, res) => {
  try {
    const { boxCode, lat, lng } = req.body;

    if (!boxCode || lat == null || lng == null) {
      return res.status(400).json({ error: "Missing fields" });
    }

    await Location.findOneAndUpdate(
      { boxCode },
      { lat, lng },
      { upsert: true }
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("Failed to save location:", err);
    res.status(500).json({ error: "Failed to save location" });
  }
});


/* =================================================
   AI BOX HEARTBEAT
================================================= */

app.post("/heartbeat", async (req, res) => {
  try {
    const now = Date.now();
    const ip = req.ip.replace("::ffff:", "");
    const boxCode = req.body?.boxCode || "Unknown";

    console.log(`AI BOX HB | ${boxCode} | ${ip} | ${formatTime(now)}`);

    await saveLog({
      boxCode,
      ip,
      source: "AI_BOX",
      online_status: "online",
      type: "heartbeat"
    });

    const lastStatus = await Log.findOne({
      boxCode,
      source: "AI_BOX",
      type: "status_change"
    }).sort({ _id: -1 });

    if (!lastStatus || lastStatus.online_status === "offline") {
      await saveLog({
        boxCode,
        ip,
        source: "AI_BOX",
        online_status: "online",
        type: "status_change"
      });

      console.log(`AI BOX STATUS: ${boxCode} OFFLINE → ONLINE`);
    }

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Heartbeat failed" });
  }
});

/* =================================================
   NODE-RED HEARTBEAT
================================================= */

app.post("/nodered/heartbeat", async (req, res) => {
  try {
    const now = Date.now();
    const ip = req.ip.replace("::ffff:", "");
    const { boxCode } = req.body;

    if (!boxCode) {
      return res.status(400).json({ error: "Missing boxCode" });
    }

    console.log(`NODE-RED HB | ${boxCode} | ${ip} | ${formatTime(now)}`);

    await saveLog({
      boxCode,
      ip,
      source: "NODE_RED",
      online_status: "online",
      type: "heartbeat"
    });

    const lastStatus = await Log.findOne({
      boxCode,
      source: "NODE_RED",
      type: "status_change"
    }).sort({ _id: -1 });

    if (!lastStatus || lastStatus.online_status === "offline") {
      await saveLog({
        boxCode,
        ip,
        source: "NODE_RED",
        online_status: "online",
        type: "status_change"
      });

      console.log(`NODE-RED STATUS: ${boxCode} OFFLINE → ONLINE`);
    }

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Node-RED heartbeat failed" });
  }
});

/* =================================================
   SERVICE STATUS
================================================= */

app.post("/service-status", async (req, res) => {
  try {
    const { boxCode, services, source } = req.body;

    if (!boxCode || !Array.isArray(services)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    for (const s of services) {
      await saveLog({
        boxCode,
        source: source || "NODE_RED",
        service_name: s.service_name,
        service_status: s.status,
        type: "service_status"
      });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Service status failed" });
  }
});

/* =================================================
   LIVE STATUS
================================================= */
app.get("/box-meta", async (req, res) => {
  try {
    const items = await BoxMeta.find();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch box meta" });
  }
});

app.post("/box-meta", requireAdmin, async (req, res) => {
  try {
    const { boxCode, boxName, deviceName } = req.body;

    if (!boxCode) {
      return res.status(400).json({ error: "Missing boxCode" });
    }

    await BoxMeta.findOneAndUpdate(
      { boxCode },
      { boxName, deviceName },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save box meta" });
  }
});
app.get("/boxes", async (req, res) => {
  try {
    const now = Date.now();
    const boxCodes = await Log.distinct("boxCode");
    const rows = [];

    for (const boxCode of boxCodes) {

      const lastBoxHB = await Log.findOne({
        boxCode,
        source: "AI_BOX",
        type: "heartbeat"
      }).sort({ _id: -1 });

      const lastNodeHB = await Log.findOne({
        boxCode,
        source: "NODE_RED",
        type: "heartbeat"
      }).sort({ _id: -1 });

      const media = await Log.findOne({
        boxCode,
        type: "service_status",
        service_name: "mediaserver.service"
      }).sort({ _id: -1 });

      const aiServer = await Log.findOne({
        boxCode,
        type: "service_status",
        service_name: "aiserver.service"
      }).sort({ _id: -1 });

      // ================= AI BOX =================
      let aiBoxStatus = "offline";
      let aiBoxLast = "-";

      if (lastBoxHB?.timestamp) {
        aiBoxLast = formatTime(lastBoxHB.timestamp);
        if (now - new Date(lastBoxHB.timestamp).getTime() < HEARTBEAT_TIMEOUT) {
          aiBoxStatus = "online";
        }
      }

      // ================= NODE RED =================
      let nodeStatus = "offline";
      let nodeLast = "-";

      if (lastNodeHB?.timestamp) {
        nodeLast = formatTime(lastNodeHB.timestamp);
        if (now - new Date(lastNodeHB.timestamp).getTime() < 3 * 60 * 1000) {
          nodeStatus = "online";
        }
      }

      // ================= MEDIA SERVICE =================
      let mediaStatus = "stopped";
      let mediaLast = "-";

      if (media?.timestamp) {
        mediaLast = formatTime(media.timestamp);

        const diff = now - new Date(media.timestamp).getTime();

        if (diff < 3 * 60 * 1000 && media.service_status === "running") {
          mediaStatus = "running";
        }
      }

      // ================= AI SERVER SERVICE =================
      let aiServerStatus = "stopped";
      let aiServerLast = "-";

      if (aiServer?.timestamp) {
        aiServerLast = formatTime(aiServer.timestamp);

        const diff = now - new Date(aiServer.timestamp).getTime();

        if (diff < 3 * 60 * 1000 && aiServer.service_status === "running") {
          aiServerStatus = "running";
        }
      }
const meta = await BoxMeta.findOne({ boxCode });
      rows.push({
        site: boxCode,
        aiBoxStatus,
        aiBoxLast,
        mediaStatus,
        mediaLast,
        aiServerStatus,
        aiServerLast,
        nodeStatus,
        nodeLast,
        deviceName: meta?.deviceName || "-"
      });
    }
    // ================= SUMMARY COUNTERS =================
    let totalAi = 0;
    let onlineAi = 0;
    let offlineAi = 0;

    let totalNode = 0;
    let onlineNode = 0;
    let offlineNode = 0;

    for (const row of rows) {

      // AI BOX
      if (row.aiBoxLast !== "-") {
        totalAi++;

        if (row.aiBoxStatus === "online") onlineAi++;
        else offlineAi++;
      }

      // NODE RED
      if (row.nodeLast !== "-") {
        totalNode++;

        if (row.nodeStatus === "online") onlineNode++;
        else offlineNode++;
      }
    }

    res.json({
      boxes: rows,
      summary: {
        ai: {
          total: totalAi,
          online: onlineAi,
          offline: offlineAi
        },
        node: {
          total: totalNode,
          online: onlineNode,
          offline: offlineNode
        }
      }
    });



  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Boxes fetch failed" });
  }
});
/* =================================================
   OFFLINE CHECKER
================================================= */

async function startOfflineChecker() {
  setInterval(async () => {

    const boxCodes = await Log.distinct("boxCode", { source: "AI_BOX" });

    for (const boxCode of boxCodes) {
      const lastHeartbeat = await Log.findOne({
        boxCode,
        source: "AI_BOX",
        type: "heartbeat"
      }).sort({ _id: -1 });

      const lastStatus = await Log.findOne({
        boxCode,
        source: "AI_BOX",
        type: "status_change"
      }).sort({ _id: -1 });

      if (!lastHeartbeat?.timestamp || !lastStatus) continue;

      if (
        lastStatus.online_status === "online" &&
        Date.now() - new Date(lastHeartbeat.timestamp).getTime() > HEARTBEAT_TIMEOUT
      ) {
        await saveLog({
          boxCode,
          ip: lastHeartbeat.ip,
          source: "AI_BOX",
          online_status: "offline",
          type: "status_change"
        });
      }
    }
    // ================= NODE RED OFFLINE CHECK =================

    const nodeBoxes = await Log.distinct("boxCode", { source: "NODE_RED" });

    for (const boxCode of nodeBoxes) {

      const lastHeartbeat = await Log.findOne({
        boxCode,
        source: "NODE_RED",
        type: "heartbeat"
      }).sort({ _id: -1 });

      const lastStatus = await Log.findOne({
        boxCode,
        source: "NODE_RED",
        type: "status_change"
      }).sort({ _id: -1 });

      if (!lastHeartbeat?.timestamp || !lastStatus) continue;

      if (
        lastStatus.online_status === "online" &&
        Date.now() - new Date(lastHeartbeat.timestamp).getTime() > 3 * 60 * 1000
      ) {

        await saveLog({
          boxCode,
          ip: lastHeartbeat.ip,
          source: "NODE_RED",
          online_status: "offline",
          type: "status_change"
        });

        console.log(`NODE-RED STATUS: ${boxCode} ONLINE → OFFLINE`);
      }
    }

  }, 5000);
}

/* =================================================
   START SERVER
================================================= */
app.use(express.static("public", { index: false }));

app.get("/", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB Connected");
    await startOfflineChecker();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("MongoDB Error:", err);
    process.exit(1);
  });