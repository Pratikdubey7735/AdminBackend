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

// Update coach - ENHANCED WITH REAL-TIME LOGOUT
router.put("/:id", async (req, res) => {
  try {
    const { name, email, level, status, password } = req.body;
    const coachId = req.params.id;
    
    // Get the current coach data to compare status change
    const currentCoach = await Coach.findById(coachId);
    if (!currentCoach) {
      return res.status(404).json({
        success: false,
        error: "Coach not found"
      });
    }

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

    const updatedCoach = await Coach.findByIdAndUpdate(
      coachId,
      updateData,
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedCoach) {
      return res.status(404).json({
        success: false,
        error: "Coach not found"
      });
    }

    // 🔥 NEW: Check if status changed and emit real-time updates
    const statusChanged = currentCoach.status !== updatedCoach.status;
    
    if (statusChanged) {
      console.log(`[${new Date().toISOString()}] Coach ${coachId} status changed from ${currentCoach.status} to ${updatedCoach.status}`);
      
      // Get the emit functions from app
      const emitUserUpdate = req.app.get('emitUserUpdate');
      const io = req.app.get('io');
      
      // Emit user update to the specific coach
      if (emitUserUpdate) {
        emitUserUpdate(coachId, updatedCoach);
        console.log(`[${new Date().toISOString()}] Emitted user update for coach ${coachId}`);
      }
      
      // Check if the new status requires logout
      const logoutStatuses = ['suspended', 'pending', 'inactive'];
      if (logoutStatuses.includes(updatedCoach.status.toLowerCase())) {
        console.log(`[${new Date().toISOString()}] Coach ${coachId} status changed to ${updatedCoach.status} - forcing logout`);
        
        // Emit force logout event
        if (io) {
          io.to(`user_${coachId}`).emit('force-logout', {
            reason: `Account status changed to ${updatedCoach.status}`,
            newStatus: updatedCoach.status,
            timestamp: new Date().toISOString()
          });
          
          console.log(`[${new Date().toISOString()}] Force logout event sent to coach ${coachId}`);
        }
      }
    }

    res.json({
      success: true,
      data: updatedCoach,
      statusChanged: statusChanged,
      previousStatus: statusChanged ? currentCoach.status : null,
      willLogout: statusChanged && ['suspended', 'pending', 'inactive'].includes(updatedCoach.status.toLowerCase())
    });
    
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error updating coach:`, err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// 🔥 NEW: Bulk status update route for admin panel
router.put("/bulk/update-status", async (req, res) => {
  try {
    const { coachIds, status } = req.body;
    
    // Validate input
    if (!Array.isArray(coachIds) || coachIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "coachIds array is required"
      });
    }
    
    const validStatuses = ['active', 'inactive', 'suspended', 'pending'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(', ')
      });
    }
    
    // Get current coaches to track status changes
    const currentCoaches = await Coach.find({ _id: { $in: coachIds } }).select('_id status');
    const currentStatusMap = new Map(currentCoaches.map(coach => [coach._id.toString(), coach.status]));
    
    // Update all coaches
    const updateResult = await Coach.updateMany(
      { _id: { $in: coachIds } },
      { 
        status: status,
        updatedAt: Date.now()
      }
    );
    
    // Get updated coaches
    const updatedCoaches = await Coach.find({ _id: { $in: coachIds } }).select("-password");
    
    // Get socket functions
    const emitUserUpdate = req.app.get('emitUserUpdate');
    const io = req.app.get('io');
    const logoutStatuses = ['suspended', 'pending', 'inactive'];
    
    // Track results
    const results = [];
    
    // Process each updated coach
    for (const updatedCoach of updatedCoaches) {
      const coachId = updatedCoach._id.toString();
      const previousStatus = currentStatusMap.get(coachId);
      const statusChanged = previousStatus !== updatedCoach.status;
      
      // Emit real-time updates if status changed
      if (statusChanged && emitUserUpdate) {
        emitUserUpdate(coachId, updatedCoach);
        
        // Force logout if necessary
        if (logoutStatuses.includes(updatedCoach.status.toLowerCase())) {
          if (io) {
            io.to(`user_${coachId}`).emit('force-logout', {
              reason: `Account status changed to ${updatedCoach.status}`,
              newStatus: updatedCoach.status,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
      
      results.push({
        coachId: coachId,
        name: updatedCoach.name,
        email: updatedCoach.email,
        previousStatus: previousStatus,
        newStatus: updatedCoach.status,
        statusChanged: statusChanged,
        willLogout: statusChanged && logoutStatuses.includes(updatedCoach.status.toLowerCase())
      });
    }
    
    res.json({
      success: true,
      message: `Updated ${updateResult.modifiedCount} coaches to status: ${status}`,
      data: results,
      totalProcessed: results.length,
      statusChanged: results.filter(r => r.statusChanged).length,
      willLogout: results.filter(r => r.willLogout).length
    });
    
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error in bulk status update:`, err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// 🔥 NEW: Individual status update route
router.put("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const coachId = req.params.id;
    
    // Validate status
    const validStatuses = ['active', 'inactive', 'suspended', 'pending'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(', ')
      });
    }
    
    // Get current coach
    const currentCoach = await Coach.findById(coachId);
    if (!currentCoach) {
      return res.status(404).json({
        success: false,
        error: "Coach not found"
      });
    }
    
    const previousStatus = currentCoach.status;
    
    // Update status
    const updatedCoach = await Coach.findByIdAndUpdate(
      coachId,
      { 
        status: status,
        updatedAt: Date.now()
      },
      { new: true, runValidators: true }
    ).select("-password");
    
    const statusChanged = previousStatus !== status;
    
    // Emit real-time updates if status changed
    if (statusChanged) {
      console.log(`[${new Date().toISOString()}] Coach ${coachId} status changed from ${previousStatus} to ${status}`);
      
      const emitUserUpdate = req.app.get('emitUserUpdate');
      const io = req.app.get('io');
      
      if (emitUserUpdate) {
        emitUserUpdate(coachId, updatedCoach);
      }
      
      // Force logout if necessary
      const logoutStatuses = ['suspended', 'pending', 'inactive'];
      if (logoutStatuses.includes(status.toLowerCase())) {
        if (io) {
          io.to(`user_${coachId}`).emit('force-logout', {
            reason: `Account status changed to ${status}`,
            newStatus: status,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
    
    res.json({
      success: true,
      data: updatedCoach,
      previousStatus: previousStatus,
      statusChanged: statusChanged,
      willLogout: statusChanged && ['suspended', 'pending', 'inactive'].includes(status.toLowerCase())
    });
    
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error updating coach status:`, err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Delete coach
router.delete("/:id", async (req, res) => {
  try {
    const coachId = req.params.id;
    
    // Get coach before deletion to emit logout if they're currently logged in
    const coach = await Coach.findById(coachId);
    if (!coach) {
      return res.status(404).json({
        success: false,
        error: "Coach not found"
      });
    }
    
    // Delete the coach
    await Coach.findByIdAndDelete(coachId);
    
    // 🔥 NEW: Force logout if coach was active
    const io = req.app.get('io');
    if (io && coach.status === 'active') {
      io.to(`user_${coachId}`).emit('force-logout', {
        reason: 'Account has been deleted',
        timestamp: new Date().toISOString()
      });
      console.log(`[${new Date().toISOString()}] Force logout sent to deleted coach ${coachId}`);
    }
    
    res.json({
      success: true,
      data: {},
      message: `Coach ${coach.name} has been deleted`
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error deleting coach:`, err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Coach Login - ENHANCED WITH STATUS CHECK
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

    // 🔥 ENHANCED: More detailed status checking
    if (coach.status !== 'active') {
      let errorMessage = "Your account is not active. Please contact support.";
      
      switch (coach.status.toLowerCase()) {
        case 'pending':
          errorMessage = "Your account is pending approval. Please wait for administrator approval.";
          break;
        case 'suspended':
          errorMessage = "Your account has been suspended. Please contact support for assistance.";
          break;
        case 'inactive':
          errorMessage = "Your account is inactive. Please contact support to reactivate your account.";
          break;
      }
      
      return res.status(403).json({ 
        success: false,
        error: errorMessage,
        status: coach.status
      });
    }

    // Remove password from response
    coach.password = undefined;

    res.status(200).json({
      success: true,
      data: coach,
      message: "Login successful"
    });

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Login error:`, err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;