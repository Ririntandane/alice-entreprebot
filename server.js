import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// --- In-memory stores (swap to DB) ---
const businesses = {}; // businessId -> { name, industry, timezone }
const bookings = [];   // { id, businessId, clientName, contact, service, when, staffId, notes, status }
const leads = [];      // { id, businessId, name, contact, service, budget, source, notes }
const staff = [];      // { id, businessId, name, nationalId, pin, role }
const attendance = []; // { id, staffId, businessId, type: "in"|"out", timestamp }
const overtime = [];   // { id, staffId, businessId, hours, reason, status }
const faqs = {};       // businessId -> [{ q, a }]

// --- Helpers ---
const now = () => new Date().toISOString();
const requireBiz = (req, res, next) => {
  const bid = req.headers["x-business-id"];
  if (!bid || !businesses[bid]) return res.status(401).json({ error: "Missing or invalid X-Business-Id" });
  req.businessId = bid;
  next();
};

// --- Public: health ---
app.get("/", (_, res) => res.json({ ok: true, service: "Alice Starter API", time: now() }));

// --- Business bootstrap (simulate admin) ---
app.post("/business/create", (req, res) => {
  const { name, industry, timezone } = req.body;
  const id = uuid();
  businesses[id] = { name, industry, timezone: timezone || "Africa/Johannesburg" };
  faqs[id] = [
    { q: "What are your hours?", a: "Mon–Sat 9:00–18:00" },
    { q: "Do you accept walk-ins?", a: "Yes, subject to availability." }
  ];
  return res.json({ businessId: id, business: businesses[id] });
});

// --- Staff auth (Name + ID + PIN) -> JWT ---
app.post("/staff/login", requireBiz, (req, res) => {
  const { name, nationalId, pin } = req.body;
  const s = staff.find(x => x.businessId === req.businessId && x.name === name && x.nationalId === nationalId && x.pin === pin);
  if (!s) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ staffId: s.id, businessId: req.businessId, role: s.role }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, staff: { id: s.id, name: s.name, role: s.role } });
});

const requireStaff = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing Authorization" });
  try {
    const token = auth.replace("Bearer ", "");
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// --- Seed staff (for demo) ---
app.post("/staff/create", requireBiz, (req, res) => {
  const { name, nationalId, pin, role } = req.body;
  const id = uuid();
  staff.push({ id, businessId: req.businessId, name, nationalId, pin, role: role || "staff" });
  res.json({ id });
});

// --- Staff agenda ---
app.get("/staff/agenda", requireStaff, (req, res) => {
  const items = bookings.filter(b => b.businessId === req.user.businessId && b.staffId === req.user.staffId && b.status !== "cancelled");
  res.json({ bookings: items });
});

// --- Clock in/out ---
app.post("/staff/clock-in", requireStaff, (req, res) => {
  attendance.push({ id: uuid(), staffId: req.user.staffId, businessId: req.user.businessId, type: "in", timestamp: now() });
  res.json({ ok: true });
});
app.post("/staff/clock-out", requireStaff, (req, res) => {
  attendance.push({ id: uuid(), staffId: req.user.staffId, businessId: req.user.businessId, type: "out", timestamp: now() });
  res.json({ ok: true });
});

// --- Overtime request ---
app.post("/staff/overtime", requireStaff, (req, res) => {
  const { hours, reason } = req.body;
  const entry = { id: uuid(), staffId: req.user.staffId, businessId: req.user.businessId, hours, reason, status: "pending" };
  overtime.push(entry);
  res.json(entry);
});

// --- Bookings ---
app.post("/bookings", requireBiz, (req, res) => {
  const { clientName, contact, service, when, staffId, notes } = req.body;
  const entry = { id: uuid(), businessId: req.businessId, clientName, contact, service, when, staffId: staffId || null, notes: notes || "", status: "confirmed" };
  bookings.push(entry);
  res.json(entry);
});
app.get("/bookings", requireBiz, (req, res) => {
  const list = bookings.filter(b => b.businessId === req.businessId);
  res.json(list);
});

// --- Leads ---
app.post("/leads", requireBiz, (req, res) => {
  const { name, contact, service, budget, source, notes } = req.body;
  const entry = { id: uuid(), businessId: req.businessId, name, contact, service, budget, source, notes };
  leads.push(entry);
  res.json(entry);
});

// --- FAQs ---
app.get("/faqs", requireBiz, (req, res) => res.json(faqs[req.businessId] || []));
app.post("/faqs", requireBiz, (req, res) => {
  faqs[req.businessId] = req.body.items || [];
  res.json({ ok: true });
});

// --- Insights (mocked logic) ---
app.post("/insights/weekly", requireBiz, (req, res) => {
  const { industry } = businesses[req.businessId];
  const paydayWindows = ["15th", "25th–30th"];
  const plan = {
    weekOf: new Date().toISOString().slice(0,10),
    industry,
    trends: [
      "Payday promos drive spikes",
      "Short-form video (15–30s) outperforms",
      "UGC + before/after posts convert"
    ],
    suggestedPosts: [
      { platform: "Instagram", day: "Thu", time: "18:00", caption: "Payday glow-up ✨ Book now & save 10%. #PaydaySpecial #"+industry },
      { platform: "TikTok", day: "Sat", time: "11:00", caption: "Behind the scenes + quick tips 🎥 #"+industry+"Tips" },
      { platform: "Facebook", day: "Tue", time: "12:30", caption: "Client story + referral rewards 💬 #HappyClients" }
    ],
    bestTimes: { Instagram: ["18:00"], TikTok: ["11:00"], Facebook: ["12:30"] },
    paydayWindows,
    forecastNote: "Assuming 8% CTR uplift during payday window.",
  };
  res.json(plan);
});

app.post("/insights/forecast", requireBiz, (req, res) => {
  const { baselineWeeklyRevenue = 10000, marketingSpend = 1500 } = req.body;
  // simple toy model
  const paydayBoost = 0.12; // 12% lift
  const trendBoost = 0.05;  // 5% lift
  const projected = Math.round(baselineWeeklyRevenue * (1 + paydayBoost + trendBoost));
  const roi = ((projected - baselineWeeklyRevenue) - marketingSpend) / marketingSpend;
  res.json({
    baselineWeeklyRevenue,
    projectedWeeklyRevenue: projected,
    assumedLifts: { paydayBoost, trendBoost },
    marketingSpend,
    estimatedROI: Number(roi.toFixed(2))
  });
});

// --- Start ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Alice Starter API listening on :${PORT}`));
