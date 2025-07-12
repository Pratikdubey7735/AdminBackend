require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cloudinary = require('cloudinary').v2;
const NodeCache = require('node-cache');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import your existing routes
const authRoutes = require("./routes/auth");
const coachRoutes = require("./routes/Coaches");

const app = express();

// Enhanced security with helmet
app.use(helmet());

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ✅ Allow specific frontend domains
const allowedOrigins = [
  "https://admin-pannel-swart.vercel.app",
  "https://upstep-academy-teaching-platform.vercel.app",
  "http://localhost:5174",
  "http://localhost:5173", // optional for local dev
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

// Parse JSON requests
app.use(express.json());

// Use GZIP compression for all responses
app.use(compression());

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create cache with TTL of 12 hours (in seconds)
const fileCache = new NodeCache({ 
  stdTTL: 43200, 
  checkperiod: 600,  // Check for expired keys every 10 minutes
  useClones: false   // For better performance with large objects
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch((err) => console.log("MongoDB error:", err));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Endpoint to fetch PGN files based on selected level
app.get('/api/pgn-files', async (req, res) => {
  const { level } = req.query;
  
  // Input validation
  if (!level) {
    return res.status(400).json({ 
      error: 'Level is required',
      message: 'Please provide a level parameter'
    });
  }
  
  // Security check - validate level input
  if (!/^[a-zA-Z0-9_]+$/.test(level)) {
    return res.status(400).json({ 
      error: 'Invalid level format',
      message: 'Level must contain only alphanumeric characters and underscores'
    });
  }
  
  try {
    // Check if we have cached results first
    const cachedFiles = fileCache.get(level);
    if (cachedFiles) {
      console.log(`[${new Date().toISOString()}] Serving cached results for ${level}`);
      return res.json(cachedFiles);
    }
    
    console.log(`[${new Date().toISOString()}] Fetching from Cloudinary for ${level}`);
    
    // Set timeout for Cloudinary request to prevent hanging connections
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Cloudinary request timeout')), 8000);
    });
    
    // Actual API request
    const fetchPromise = cloudinary.search
      .expression(`folder:${level} AND format:pgn`)
      .max_results(500)
      .execute();
    
    // Race the fetch against the timeout
    const { resources } = await Promise.race([fetchPromise, timeoutPromise]);
    
    if (!resources || !Array.isArray(resources)) {
      throw new Error('Invalid response from Cloudinary');
    }
    
    // Process files more efficiently
    const numberFiles = [];
    const letterFiles = [];
    
    resources.forEach((file) => {
      const filenameParts = file.public_id.split('/');
      const filename = filenameParts[filenameParts.length - 1]; // Get last part
      
      const fileInfo = {
        url: file.secure_url,
        filename: file.public_id,
        // Extract just the actual filename for display
        displayName: filename
      };
      
      // Regex test is faster than startsWith
      if (/^\d/.test(filename)) {
        numberFiles.push(fileInfo);
      } else {
        letterFiles.push(fileInfo);
      }
    });
    
    // Sort number files numerically (based on the number at the start of the filename)
    numberFiles.sort((a, b) => {
      const numA = parseInt(a.displayName.match(/^\d+/), 10) || 0;
      const numB = parseInt(b.displayName.match(/^\d+/), 10) || 0;
      return numA - numB;
    });
    
    // Sort letter files alphabetically
    letterFiles.sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    // Combine the two sorted arrays
    const pgnFiles = [...numberFiles, ...letterFiles];
    
    // Cache the results
    fileCache.set(level, pgnFiles);
    
    // Set appropriate cache headers
    res.set('Cache-Control', 'public, max-age=3600'); // 1 hour client-side cache
    res.json(pgnFiles);
    
    console.log(`[${new Date().toISOString()}] Successfully served ${pgnFiles.length} files for ${level}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching PGN files:`, error);
    
    // Attempt to serve stale cache on failure if available
    const staleCache = fileCache.get(level);
    if (staleCache) {
      console.log(`[${new Date().toISOString()}] Serving stale cache for ${level} after error`);
      res.set('X-Served-From-Stale-Cache', 'true');
      return res.json(staleCache);
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch PGN files',
      message: 'There was an error retrieving files. Please try again later.' 
    });
  }
});

// Endpoint to manually clear cache
app.post('/api/clear-cache', (req, res) => {
  try {
    const { level, apiKey } = req.body;
    
    // Basic API key auth for admin operations
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (level) {
      fileCache.del(level);
      console.log(`[${new Date().toISOString()}] Cache cleared for ${level}`);
      res.json({ success: true, message: `Cache cleared for ${level}` });
    } else {
      fileCache.flushAll();
      console.log(`[${new Date().toISOString()}] All cache cleared`);
      res.json({ success: true, message: 'All cache cleared' });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error clearing cache:`, error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Handle prefetch requests - this allows frontend to preload data
app.get('/api/prefetch', (req, res) => {
  const { levels } = req.query;
  
  if (!levels) {
    return res.status(400).json({ error: 'Levels parameter required' });
  }
  
  // Parse the levels array
  const levelList = levels.split(',');
  
  // Prefetch the first 5 levels at most
  const levelsToPrefetch = levelList.slice(0, 5);
  
  res.json({ 
    success: true, 
    message: 'Prefetch request received',
    levelsToPrefetch 
  });
  
  // Process the prefetch in the background after responding
  levelsToPrefetch.forEach(async (level) => {
    try {
      // Skip if already in cache
      if (fileCache.has(level)) {
        console.log(`[${new Date().toISOString()}] Level ${level} already in cache, skipping prefetch`);
        return;
      }
      
      console.log(`[${new Date().toISOString()}] Background prefetching for level: ${level}`);
      
      const { resources } = await cloudinary.search
        .expression(`folder:${level} AND format:pgn`)
        .max_results(500)
        .execute();
      
      // Process and cache the results using same logic as main endpoint
      const numberFiles = [];
      const letterFiles = [];
      
      resources.forEach((file) => {
        const filenameParts = file.public_id.split('/');
        const filename = filenameParts[filenameParts.length - 1];
        
        const fileInfo = {
          url: file.secure_url,
          filename: file.public_id,
          displayName: filename
        };
        
        if (/^\d/.test(filename)) {
          numberFiles.push(fileInfo);
        } else {
          letterFiles.push(fileInfo);
        }
      });
      
      numberFiles.sort((a, b) => {
        const numA = parseInt(a.displayName.match(/^\d+/), 10) || 0;
        const numB = parseInt(b.displayName.match(/^\d+/), 10) || 0;
        return numA - numB;
      });
      
      letterFiles.sort((a, b) => a.displayName.localeCompare(b.displayName));
      
      const pgnFiles = [...numberFiles, ...letterFiles];
      fileCache.set(level, pgnFiles);
      console.log(`[${new Date().toISOString()}] Prefetch complete for ${level}, cached ${pgnFiles.length} files`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error during prefetch for ${level}:`, error);
    }
  });
});

// Endpoint for serving PGN content directly
app.get('/api/pgn-content', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }
  
  try {
    // Simple validation to ensure it's a Cloudinary URL
    if (!url.includes('cloudinary.com')) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PGN content: ${response.status}`);
    }
    
    const content = await response.text();
    res.set('Content-Type', 'text/plain');
    res.send(content);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching PGN content:`, error);
    res.status(500).json({ 
      error: 'Failed to fetch PGN content',
      message: 'Unable to retrieve the requested file'
    });
  }
});

// Your existing routes
app.use("/api", authRoutes);
app.use("/api/coaches", coachRoutes);

// Start the server
const server = app.listen(process.env.PORT, () => {
  console.log(`[${new Date().toISOString()}] Server running on http://localhost:${process.env.PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] SIGTERM received, shutting down gracefully`);
  // Close server
  server.close(() => {
    console.log(`[${new Date().toISOString()}] Server closed`);
    process.exit(0);
  });
});