const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const coachSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/\S+@\S+\.\S+/, "Please enter a valid email"]
  },
  password: {
    type: String,
    minlength: [6, "Password must be at least 6 characters"],
    select: false
  },
  level: {
    type: String,
    enum: ["beginner", "senior", "master"],
    default: "beginner"
  },
  status: {
    type: String,
    enum: ["active", "pending", "suspended"],
    default: "active"
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving if it's modified
coachSchema.pre("save", async function(next) {
  if (!this.isModified("password")) {
    this.updatedAt = Date.now();
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    this.updatedAt = Date.now();
    next();
  } catch (err) {
    next(err);
  }
});

// Hash password before updating if it's modified
coachSchema.pre("findOneAndUpdate", async function(next) {
  const update = this.getUpdate();
  if (update.password) {
    try {
      const salt = await bcrypt.genSalt(10);
      update.password = await bcrypt.hash(update.password, salt);
      this.setUpdate(update);
    } catch (err) {
      return next(err);
    }
  }
  update.updatedAt = Date.now();
  next();
});

// Method to compare passwords
coachSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Coach", coachSchema);