const express = require("express");
require("dotenv").config();
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const HEARTBEAT_TIMEOUT = 4 * 60 * 1000;

/* =================================================
   SUPABASE CLIENT
================================================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* =================================================
   SUPABASE SESSION STORE
================================================= */
const Store = session.Store;

class SupabaseStore extends Store {
  constructor(options = {}) {
    super(options);
    this.client = options.client;
    this.tableName = options.tableName || "sessions";
    // Clean expired sessions every 15 minutes
    this._cleanupInterval = setInterval(() => this._cleanup(), 15 * 60 * 1000);
  }

  async get(sid, callback) {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select("sess, expire")
        .eq("sid", sid)
        .single();

      if (error || !data) return callback(null, null);
      if (new Date(data.expire) < new Date()) return callback(null, null);

      callback(null, data.sess);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000;
      const expire = new Date(Date.now() + maxAge).toISOString();

      const { error } = await this.client
        .from(this.tableName)
        .upsert({ sid, sess, expire }, { onConflict: "sid" });

      callback(error || null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      const { error } = await this.client
        .from(this.tableName)
        .delete()
        .eq("sid", sid);

      callback(error || null);
    } catch (err) {
      callback(err);
    }
  }

  async _cleanup() {
    try {
      await this.client
        .from(this.tableName)
        .delete()
        .lt("expire", new Date().toISOString());
    } catch (err) {
      console.error("Session cleanup error:", err);
    }
  }
}

/* =================================================
   SESSION SETUP
================================================= */
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(session({
  name: "ai_dashboard.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SupabaseStore({ client: supabase }),
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

/* =================================================
   AUTH MIDDLEWARE
================================================= */
function requirePageAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login.html");
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  const role = req.session.user.role;
  if (role !== "admin" && role !== "super-admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

/* =================================================
   UTILITIES
================================================= */
function formatTime(ts) {
  if (!ts) return "-";
  return new Date(ts)
    .toLocaleString("en-GB", { timeZone: "Asia/Bangkok", hour12: false })
    .replace(",", "");
}

async function saveLog(entry) {
  const { error } = await supabase.from("logs").insert({
    box_code: entry.boxCode,
    ip: entry.ip,
    source: entry.source,
    online_status: entry.online_status,
    service_name: entry.service_name || null,
    service_status: entry.service_status || null,
    type: entry.type
  });
  if (error) console.error("saveLog error:", error);
}

/* =================================================
   PAGE ROUTES
================================================= */
app.get("/dashboard-admin.html", requirePageAuth, (req, res) => {
  const role = req.session.user.role;
  if (role !== "admin" && role !== "super-admin") {
    return res.redirect("/dashboard-user.html");
  }
  res.sendFile(path.join(__dirname, "public", "dashboard-admin.html"));
});

app.get("/dashboard-user.html", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard-user.html"));
});

app.get("/user-management.html", (req, res) => {
  try {
    if (!req.session?.user) return res.redirect("/login.html");
    const role = req.session.user.role;
    if (role !== "admin" && role !== "super-admin") return res.redirect("/");
    res.sendFile(path.join(__dirname, "public", "user-management.html"));
  } catch (err) {
    console.error("User management page error:", err);
    res.status(500).send("Internal Server Error");
  }
});

/* =================================================
   AUTH ROUTES
================================================= */
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log("Login attempt:", username);

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username.trim())
      .single();

    console.log("User found:", user ? "YES" : "NO");

    if (error || !user || !user.is_active) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    console.log("Password match:", isMatch);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    res.json({
      ok: true,
      user: { username: user.username, role: user.role }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
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
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ user: req.session.user });
});

/* =================================================
   USER MANAGEMENT
================================================= */
app.post("/users", requireAuth, async (req, res) => {
  try {
    const currentRole = req.session.user.role;
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: "Username, password, and role are required" });
    }
    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (currentRole !== "admin" && currentRole !== "super-admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (currentRole === "admin" && role !== "user") {
      return res.status(403).json({ error: "Admin can create only user accounts" });
    }

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("username", username.trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { error } = await supabase.from("users").insert({
      username: username.trim(),
      password_hash,
      role,
      is_active: true
    });

    if (error) throw error;
    res.json({ ok: true, message: "User created successfully" });
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

app.get("/users", requireAuth, async (req, res) => {
  try {
    const currentRole = req.session.user.role;
    if (currentRole !== "admin" && currentRole !== "super-admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data: users, error } = await supabase
      .from("users")
      .select("id, username, role, is_active, created_at, updated_at")
      .neq("role", "super-admin")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Map to match frontend expectations (camelCase _id)
    const mapped = (users || []).map(u => ({
      _id: u.id,
      username: u.username,
      role: u.role,
      isActive: u.is_active,
      createdAt: u.created_at,
      updatedAt: u.updated_at
    }));

    res.json({ ok: true, users: mapped });
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.put("/users/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, role } = req.body;
    const currentRole = req.session.user.role;

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const { data: targetUser, error: findErr } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .single();

    if (findErr || !targetUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (targetUser.role === "super-admin") {
      return res.status(403).json({ error: "Super-admin is protected" });
    }
    if (currentRole === "admin" && targetUser.role !== "user") {
      return res.status(403).json({ error: "Admin can edit only user accounts" });
    }
    if (currentRole !== "admin" && currentRole !== "super-admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Check duplicate username
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("username", username.trim())
      .neq("id", id)
      .single();

    if (existing) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const updateData = { username: username.trim() };

    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
    }
    if (currentRole === "super-admin" && role && ["admin", "user"].includes(role)) {
      updateData.role = role;
    }

    const { error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id);

    if (error) throw error;
    res.json({ ok: true, message: "User updated successfully" });
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

app.delete("/users/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const currentRole = req.session.user.role;

    if (currentRole !== "admin" && currentRole !== "super-admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data: targetUser, error: findErr } = await supabase
      .from("users")
      .select("role")
      .eq("id", id)
      .single();

    if (findErr || !targetUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (targetUser.role === "super-admin") {
      return res.status(403).json({ error: "Super-admin is protected" });
    }
    if (currentRole === "admin" && targetUser.role !== "user") {
      return res.status(403).json({ error: "Admin can delete only user accounts" });
    }

    const { error } = await supabase.from("users").delete().eq("id", id);
    if (error) throw error;

    res.json({ ok: true, message: "User removed successfully" });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

/* =================================================
   LOGS (HISTORY)
================================================= */
app.get("/logs", async (req, res) => {
  try {
    const { type, from, to, boxCode, status } = req.query;

    let query = supabase
      .from("logs")
      .select("*")
      .eq("type", "status_change")
      .not("online_status", "is", null)
      .order("id", { ascending: false })
      .limit(1000);

    if (type && type !== "ALL") {
      query = query.eq("source", type);
    }
    if (boxCode && boxCode.trim() !== "") {
      query = query.eq("box_code", boxCode.trim());
    }
    if (status && status !== "all") {
      query = query.eq("online_status", status);
    }
    if (from) {
      query = query.gte("timestamp", new Date(from).toISOString());
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setSeconds(59);
      toDate.setMilliseconds(999);
      query = query.lte("timestamp", toDate.toISOString());
    }

    const { data: logs, error } = await query;
    if (error) throw error;

    res.json(
      (logs || []).map(log => ({
        ...log,
        boxCode: log.box_code,
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
    const { data, error } = await supabase
      .from("logs")
      .select("box_code")
      .not("box_code", "is", null);

    if (error) throw error;

    const boxCodes = [...new Set((data || []).map(r => r.box_code))];
    res.json({ boxCodes });
  } catch (err) {
    console.error("Filter load error:", err);
    res.status(500).json({ error: "Failed to load filters" });
  }
});

/* =================================================
   LOCATIONS
================================================= */
app.get("/locations", async (req, res) => {
  try {
    const { data, error } = await supabase.from("locations").select("*");
    if (error) throw error;

    res.json((data || []).map(loc => ({
      boxCode: loc.box_code,
      lat: loc.lat,
      lng: loc.lng
    })));
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

    const { error } = await supabase
      .from("locations")
      .upsert(
        { box_code: boxCode, lat, lng },
        { onConflict: "box_code" }
      );

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to save location:", err);
    res.status(500).json({ error: "Failed to save location" });
  }
});

/* =================================================
   BOX META
================================================= */
app.get("/box-meta", async (req, res) => {
  try {
    const { data, error } = await supabase.from("box_meta").select("*");
    if (error) throw error;

    res.json((data || []).map(item => ({
      boxCode: item.box_code,
      boxName: item.box_name,
      deviceName: item.device_name
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch box meta" });
  }
});

app.post("/box-meta", requireAdmin, async (req, res) => {
  try {
    const { boxCode, boxName, deviceName } = req.body;
    if (!boxCode) return res.status(400).json({ error: "Missing boxCode" });

    const { error } = await supabase
      .from("box_meta")
      .upsert(
        { box_code: boxCode, box_name: boxName, device_name: deviceName },
        { onConflict: "box_code" }
      );

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save box meta" });
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
      boxCode, ip, source: "AI_BOX",
      online_status: "online", type: "heartbeat"
    });

    const { data: lastStatus } = await supabase
      .from("logs")
      .select("online_status")
      .eq("box_code", boxCode)
      .eq("source", "AI_BOX")
      .eq("type", "status_change")
      .order("id", { ascending: false })
      .limit(1)
      .single();

    if (!lastStatus || lastStatus.online_status === "offline") {
      await saveLog({
        boxCode, ip, source: "AI_BOX",
        online_status: "online", type: "status_change"
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

    if (!boxCode) return res.status(400).json({ error: "Missing boxCode" });

    console.log(`NODE-RED HB | ${boxCode} | ${ip} | ${formatTime(now)}`);

    await saveLog({
      boxCode, ip, source: "NODE_RED",
      online_status: "online", type: "heartbeat"
    });

    const { data: lastStatus } = await supabase
      .from("logs")
      .select("online_status")
      .eq("box_code", boxCode)
      .eq("source", "NODE_RED")
      .eq("type", "status_change")
      .order("id", { ascending: false })
      .limit(1)
      .single();

    if (!lastStatus || lastStatus.online_status === "offline") {
      await saveLog({
        boxCode, ip, source: "NODE_RED",
        online_status: "online", type: "status_change"
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
   LIVE STATUS  (/boxes)
================================================= */
app.get("/boxes", async (req, res) => {
  try {
    const now = Date.now();

    // Get distinct box codes
    const { data: boxRows } = await supabase
      .from("logs")
      .select("box_code");

    const boxCodes = [...new Set((boxRows || []).map(r => r.box_code))];
    const rows = [];

    for (const boxCode of boxCodes) {

      // Last AI Box heartbeat
      const { data: lastBoxHB } = await supabase
        .from("logs")
        .select("timestamp, ip")
        .eq("box_code", boxCode)
        .eq("source", "AI_BOX")
        .eq("type", "heartbeat")
        .order("id", { ascending: false })
        .limit(1)
        .single();

      // Last Node-RED heartbeat
      const { data: lastNodeHB } = await supabase
        .from("logs")
        .select("timestamp")
        .eq("box_code", boxCode)
        .eq("source", "NODE_RED")
        .eq("type", "heartbeat")
        .order("id", { ascending: false })
        .limit(1)
        .single();

      // Last media service status
      const { data: media } = await supabase
        .from("logs")
        .select("timestamp, service_status")
        .eq("box_code", boxCode)
        .eq("type", "service_status")
        .eq("service_name", "mediaserver.service")
        .order("id", { ascending: false })
        .limit(1)
        .single();

      // Last AI server service status
      const { data: aiServer } = await supabase
        .from("logs")
        .select("timestamp, service_status")
        .eq("box_code", boxCode)
        .eq("type", "service_status")
        .eq("service_name", "aiserver.service")
        .order("id", { ascending: false })
        .limit(1)
        .single();

      // AI BOX
      let aiBoxStatus = "offline";
      let aiBoxLast = "-";
      if (lastBoxHB?.timestamp) {
        aiBoxLast = formatTime(lastBoxHB.timestamp);
        if (now - new Date(lastBoxHB.timestamp).getTime() < HEARTBEAT_TIMEOUT) {
          aiBoxStatus = "online";
        }
      }

      // NODE RED
      let nodeStatus = "offline";
      let nodeLast = "-";
      if (lastNodeHB?.timestamp) {
        nodeLast = formatTime(lastNodeHB.timestamp);
        if (now - new Date(lastNodeHB.timestamp).getTime() < 3 * 60 * 1000) {
          nodeStatus = "online";
        }
      }

      // MEDIA SERVICE
      let mediaStatus = "stopped";
      let mediaLast = "-";
      if (media?.timestamp) {
        mediaLast = formatTime(media.timestamp);
        if (now - new Date(media.timestamp).getTime() < 3 * 60 * 1000 && media.service_status === "running") {
          mediaStatus = "running";
        }
      }

      // AI SERVER SERVICE
      let aiServerStatus = "stopped";
      let aiServerLast = "-";
      if (aiServer?.timestamp) {
        aiServerLast = formatTime(aiServer.timestamp);
        if (now - new Date(aiServer.timestamp).getTime() < 3 * 60 * 1000 && aiServer.service_status === "running") {
          aiServerStatus = "running";
        }
      }

      // Box meta
      const { data: meta } = await supabase
        .from("box_meta")
        .select("device_name")
        .eq("box_code", boxCode)
        .single();

      rows.push({
        site: boxCode,
        aiBoxStatus, aiBoxLast,
        mediaStatus, mediaLast,
        aiServerStatus, aiServerLast,
        nodeStatus, nodeLast,
        deviceName: meta?.device_name || "-"
      });
    }

    // Summary counters
    let totalAi = 0, onlineAi = 0, offlineAi = 0;
    let totalNode = 0, onlineNode = 0, offlineNode = 0;

    for (const row of rows) {
      if (row.aiBoxLast !== "-") {
        totalAi++;
        row.aiBoxStatus === "online" ? onlineAi++ : offlineAi++;
      }
      if (row.nodeLast !== "-") {
        totalNode++;
        row.nodeStatus === "online" ? onlineNode++ : offlineNode++;
      }
    }

    res.json({
      boxes: rows,
      summary: {
        ai: { total: totalAi, online: onlineAi, offline: offlineAi },
        node: { total: totalNode, online: onlineNode, offline: offlineNode }
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
    try {
      // AI BOX offline check
      const { data: aiBoxes } = await supabase
        .from("logs")
        .select("box_code")
        .eq("source", "AI_BOX");

      const aiBoxCodes = [...new Set((aiBoxes || []).map(r => r.box_code))];

      for (const boxCode of aiBoxCodes) {
        const { data: lastHB } = await supabase
          .from("logs")
          .select("timestamp, ip")
          .eq("box_code", boxCode)
          .eq("source", "AI_BOX")
          .eq("type", "heartbeat")
          .order("id", { ascending: false })
          .limit(1)
          .single();

        const { data: lastStatus } = await supabase
          .from("logs")
          .select("online_status")
          .eq("box_code", boxCode)
          .eq("source", "AI_BOX")
          .eq("type", "status_change")
          .order("id", { ascending: false })
          .limit(1)
          .single();

        if (!lastHB?.timestamp || !lastStatus) continue;

        if (
          lastStatus.online_status === "online" &&
          Date.now() - new Date(lastHB.timestamp).getTime() > HEARTBEAT_TIMEOUT
        ) {
          await saveLog({
            boxCode, ip: lastHB.ip, source: "AI_BOX",
            online_status: "offline", type: "status_change"
          });
        }
      }

      // NODE RED offline check
      const { data: nodeBoxes } = await supabase
        .from("logs")
        .select("box_code")
        .eq("source", "NODE_RED");

      const nodeBoxCodes = [...new Set((nodeBoxes || []).map(r => r.box_code))];

      for (const boxCode of nodeBoxCodes) {
        const { data: lastHB } = await supabase
          .from("logs")
          .select("timestamp, ip")
          .eq("box_code", boxCode)
          .eq("source", "NODE_RED")
          .eq("type", "heartbeat")
          .order("id", { ascending: false })
          .limit(1)
          .single();

        const { data: lastStatus } = await supabase
          .from("logs")
          .select("online_status")
          .eq("box_code", boxCode)
          .eq("source", "NODE_RED")
          .eq("type", "status_change")
          .order("id", { ascending: false })
          .limit(1)
          .single();

        if (!lastHB?.timestamp || !lastStatus) continue;

        if (
          lastStatus.online_status === "online" &&
          Date.now() - new Date(lastHB.timestamp).getTime() > 3 * 60 * 1000
        ) {
          await saveLog({
            boxCode, ip: lastHB.ip, source: "NODE_RED",
            online_status: "offline", type: "status_change"
          });
          console.log(`NODE-RED STATUS: ${boxCode} ONLINE → OFFLINE`);
        }
      }
    } catch (err) {
      console.error("Offline checker error:", err);
    }
  }, 5000);
}

/* =================================================
   START SERVER
================================================= */
app.use(express.static("public", { index: false }));

app.get("/", requirePageAuth, (req, res) => {
  const role = req.session.user.role;
  if (role === "user") return res.redirect("/dashboard-user.html");
  if (role === "admin" || role === "super-admin") return res.redirect("/dashboard-admin.html");
  return res.redirect("/login.html");
});

// No mongoose.connect needed — Supabase client uses HTTPS
console.log("Connecting to Supabase...");
startOfflineChecker();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});