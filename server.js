require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const authRoutes = require("./routes/auth");

const app = express();

// ✅ CORS Configuration
const allowedOrigins = [
  "https://admin-pannel-swart.vercel.app",
  "https://upstep-academy-teaching-platform.vercel.app"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options("*", cors()); // ✅ Allow preflight requests

app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch((err) => console.log("MongoDB error:", err));

// 🔗 Routes
app.get("/", (_, res) => {
  res.json({ success: "Server is running" });
});

app.use("/api", authRoutes);

// ✅ Start Server
app.listen(process.env.PORT, () =>
  console.log(`Server running on http://localhost:${process.env.PORT}`)
);

const coachRoutes = require("./routes/Coaches");
app.use("/api/coaches", coachRoutes);
