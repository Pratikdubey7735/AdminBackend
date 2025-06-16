const express = require("express");
const router = express.Router();
const Coach = require("../models/Coach");
const bcrypt = require("bcryptjs");

// Create coach
router.post("/", async (req, res) => {
  try {
    const { name, email, password, level, status } = req.body;
    
    // Check if email already exists
    const existingCoach = await Coach.findOne({ email });
    if (existingCoach) {
      return res.status(400).json({ error: "Email already in use" });
    }

    // Password is required for new coaches
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    const coach = new Coach({
      name,
      email,
      password,
      level,
      status
    });

    await coach.save();
    
    // Remove password from response
    coach.password = undefined;
    
    res.status(201).json({
      success: true,
      data: coach
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get all coaches
router.get("/", async (req, res) => {
  try {
    const coaches = await Coach.find().select("-password");
    res.json({
      success: true,
      count: coaches.length,
      data: coaches
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get single coach
router.get("/:id", async (req, res) => {
  try {
    const coach = await Coach.findById(req.params.id).select("-password");
    if (!coach) {
      return res.status(404).json({
        success: false,
        error: "Coach not found"
      });
    }
    res.json({
      success: true,
      data: coach
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Update coach
router.put("/:id", async (req, res) => {
  try {
    const { name, email, level, status, password } = req.body;
    
    // Prepare update data
    const updateData = {
      name,
      email,
      level,
      status,
      updatedAt: Date.now()
    };

    // Only include password in update if provided
    if (password && password.trim() !== "") {
      updateData.password = password;
    }

    const coach = await Coach.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).select("-password");

    if (!coach) {
      return res.status(404).json({
        success: false,
        error: "Coach not found"
      });
    }

    res.json({
      success: true,
      data: coach
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Delete coach
router.delete("/:id", async (req, res) => {
  try {
    const coach = await Coach.findByIdAndDelete(req.params.id);
    if (!coach) {
      return res.status(404).json({
        success: false,
        error: "Coach not found"
      });
    }
    res.json({
      success: true,
      data: {}
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Coach Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: "Please provide both email and password" 
      });
    }

    // Find coach by email (include password in the query)
    const coach = await Coach.findOne({ email }).select('+password');
    
    if (!coach) {
      return res.status(401).json({ 
        success: false,
        error: "Invalid credentials" 
      });
    }

    // Check if password matches
    const isMatch = await coach.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false,
        error: "Invalid credentials" 
      });
    }

    // Check if coach is active
    if (coach.status !== 'active') {
      return res.status(403).json({ 
        success: false,
        error: "Your account is not active. Please contact support." 
      });
    }

    // Remove password from response
    coach.password = undefined;

    res.status(200).json({
      success: true,
      data: coach
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;