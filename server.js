require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const coachRoutes = require("./routes/Coaches");

const app = express();

// ✅ Allow specific frontend domains
const allowedOrigins = [
  "https://admin-pannel-swart.vercel.app",
  "https://upstep-academy-teaching-platform.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174"// optional for local dev
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true // only if you're using cookies or sessions
}));

app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch((err) => console.log("MongoDB error:", err));

// Routes
app.use("/api", authRoutes);
app.use("/api/coaches", coachRoutes);

// Start server
app.listen(process.env.PORT, () =>
  console.log(`Server running on http://localhost:${process.env.PORT}`)
);
