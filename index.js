const express = require("express");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
const path = require("path");

const app = express();

app.use(express.json());
app.use(cors());

// Serve frontend
app.use(express.static(path.join(process.cwd(), "public")));

// ======================================================
// ENVIRONMENT VARIABLES
// ======================================================

const MONGO_URI = process.env.MONGO_URI;

const MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || "603000";
const MPESA_INITIATOR_NAME = process.env.MPESA_INITIATOR_NAME;
const MPESA_SECURITY_CREDENTIAL = process.env.MPESA_SECURITY_CREDENTIAL;

const APP_URL = process.env.APP_URL;

// ======================================================
// MONGODB CONNECTION
// ======================================================

let mongoConnection = null;

async function connectDB() {
  if (mongoConnection) {
    return mongoConnection;
  }

  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  mongoConnection = await mongoose.connect(MONGO_URI);

  console.log("MongoDB connected");

  return mongoConnection;
}

// ======================================================
// SCHEMAS
// ======================================================

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    mpesa: {
      type: String,
      default: ""
    },

    balance: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

const responseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    question: String,

    answer: String,

    reward: {
      type: Number,
      default: 50
    }
  },
  {
    timestamps: true
  }
);

const withdrawalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    amount: {
      type: Number,
      required: true
    },

    phone: {
      type: String,
      required: true
    },

    status: {
      type: String,
      default: "pending"
    },

    mpesaResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const User =
  mongoose.models.User ||
  mongoose.model("User", userSchema);

const SurveyResponse =
  mongoose.models.SurveyResponse ||
  mongoose.model("SurveyResponse", responseSchema);

const Withdrawal =
  mongoose.models.Withdrawal ||
  mongoose.model("Withdrawal", withdrawalSchema);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/api/health", async (req, res) => {
  try {
    await connectDB();

    res.json({
      success: true,
      message: "EarnPesa API is running",
      database: "connected"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Database connection failed"
    });
  }
});

// ======================================================
// REGISTER
// ======================================================

app.post("/api/register", async (req, res) => {
  try {
    await connectDB();

    const { name, email, mpesa } = req.body;

    if (!name || !email || !mpesa) {
      return res.status(400).json({
        error: "Name, email and M-Pesa number are required"
      });
    }

    const existingUser = await User.findOne({
      email: email.toLowerCase()
    });

    if (existingUser) {
      return res.status(400).json({
        error: "Email already exists"
      });
    }

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      mpesa,
      balance: 0
    });

    res.status(201).json({
      success: true,
      userId: user._id,
      message: "Registration successful"
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      error: "Registration failed"
    });
  }
});

// ======================================================
// LOGIN
// ======================================================

app.post("/api/login", async (req, res) => {
  try {
    await connectDB();

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email is required"
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase()
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        mpesa: user.mpesa,
        balance: user.balance
      }
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      error: "Login failed"
    });
  }
});

// ======================================================
// SUBMIT SURVEY
// ======================================================

app.post("/api/submit", async (req, res) => {
  try {
    await connectDB();

    const {
      userId,
      question,
      answer
    } = req.body;

    if (!userId || !question || !answer) {
      return res.status(400).json({
        error: "Missing survey information"
      });
    }

    const reward = 50;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    await SurveyResponse.create({
      userId,
      question,
      answer,
      reward
    });

    user.balance += reward;

    await user.save();

    res.json({
      success: true,
      earned: reward,
      balance: user.balance
    });

  } catch (error) {
    console.error("SURVEY ERROR:", error);

    res.status(500).json({
      error: "Could not submit survey"
    });
  }
});

// ======================================================
// GET USER
// ======================================================

app.get("/api/user/:id", async (req, res) => {
  try {
    await connectDB();

    const user = await User.findById(req.params.id).select(
      "_id name email mpesa balance createdAt"
    );

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error("USER ERROR:", error);

    res.status(500).json({
      error: "Could not get user"
    });
  }
});

// ======================================================
// M-PESA ACCESS TOKEN
// SANDBOX
// ======================================================

async function getMpesaToken() {

  if (
    !MPESA_CONSUMER_KEY ||
    !MPESA_CONSUMER_SECRET
  ) {
    throw new Error(
      "M-Pesa credentials are not configured"
    );
  }

  const auth = Buffer
    .from(
      `${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`
    )
    .toString("base64");

  const response = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  return response.data.access_token;
}

// ======================================================
// WITHDRAWAL
// SANDBOX B2C
// ======================================================

app.post("/api/withdraw", async (req, res) => {

  try {

    await connectDB();

    const {
      userId,
      amount,
      phone
    } = req.body;

    const withdrawalAmount = Number(amount);

    if (!userId || !withdrawalAmount || !phone) {
      return res.status(400).json({
        error: "userId, amount and phone are required"
      });
    }

    if (!Number.isFinite(withdrawalAmount)) {
      return res.status(400).json({
        error: "Invalid withdrawal amount"
      });
    }

    if (withdrawalAmount < 50) {
      return res.status(400).json({
        error: "Minimum withdrawal is KSh 50"
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    if (user.balance < withdrawalAmount) {
      return res.status(400).json({
        error: "Insufficient balance"
      });
    }

    // ==================================================
    // M-PESA SANDBOX
    // ==================================================

    const token = await getMpesaToken();

    const payload = {
      InitiatorName: MPESA_INITIATOR_NAME,
      SecurityCredential: MPESA_SECURITY_CREDENTIAL,
      CommandID: "BusinessPayment",
      Amount: withdrawalAmount,
      PartyA: MPESA_SHORTCODE,
      PartyB: phone,
      Remarks: "EarnPesa Survey Payout",

      QueueTimeOutURL:
        `${APP_URL}/api/timeout`,

      ResultURL:
        `${APP_URL}/api/result`
    };

    const mpesaResponse = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    // ==================================================
    // SAVE WITHDRAWAL
    // ==================================================

    const withdrawal = await Withdrawal.create({
      userId,
      amount: withdrawalAmount,
      phone,
      status: "pending",
      mpesaResponse: mpesaResponse.data
    });

    // Deduct balance after request accepted
    user.balance -= withdrawalAmount;

    await user.save();

    res.json({
      success: true,
      message: "Payout initiated",
      withdrawalId: withdrawal._id,
      balance: user.balance,
      data: mpesaResponse.data
    });

  } catch (error) {

    console.error(
      "WITHDRAW ERROR:",
      error.response?.data || error.message
    );

    res.status(500).json({
      error:
        error.response?.data ||
        error.message ||
        "Withdrawal failed"
    });
  }
});

// ======================================================
// M-PESA RESULT CALLBACK
// ======================================================

app.post("/api/result", async (req, res) => {

  try {

    await connectDB();

    console.log(
      "B2C RESULT:",
      JSON.stringify(req.body)
    );

    const result = req.body?.Result;

    if (result) {

      const conversationId =
        result.ConversationID;

      const resultCode =
        result.ResultCode;

      console.log(
        "Conversation ID:",
        conversationId
      );

      console.log(
        "Result Code:",
        resultCode
      );

      // Your production implementation should
      // match the callback to a withdrawal record
      // and update its status.
    }

    res.json({
      ResultCode: 0,
      ResultDesc: "Received"
    });

  } catch (error) {

    console.error(
      "RESULT CALLBACK ERROR:",
      error.message
    );

    res.json({
      ResultCode: 0,
      ResultDesc: "Received"
    });
  }
});

// ======================================================
// M-PESA TIMEOUT CALLBACK
// ======================================================

app.post("/api/timeout", async (req, res) => {

  console.log(
    "B2C TIMEOUT:",
    JSON.stringify(req.body)
  );

  res.json({
    ResultCode: 0,
    ResultDesc: "Received"
  });
});

// ======================================================
// SURVEY HISTORY
// ======================================================

app.get("/api/history/:userId", async (req, res) => {

  try {

    await connectDB();

    const history =
      await SurveyResponse
        .find({
          userId: req.params.userId
        })
        .sort({
          createdAt: -1
        });

    res.json({
      success: true,
      history
    });

  } catch (error) {

    console.error(
      "HISTORY ERROR:",
      error.message
    );

    res.status(500).json({
      error: "Could not get history"
    });
  }
});

// ======================================================
// WITHDRAWAL HISTORY
// ======================================================

app.get(
  "/api/withdrawals/:userId",
  async (req, res) => {

    try {

      await connectDB();

      const withdrawals =
        await Withdrawal
          .find({
            userId: req.params.userId
          })
          .sort({
            createdAt: -1
          });

      res.json({
        success: true,
        withdrawals
      });

    } catch (error) {

      console.error(
        "WITHDRAWAL HISTORY ERROR:",
        error.message
      );

      res.status(500).json({
        error: "Could not get withdrawals"
      });
    }
  }
);

// ======================================================
// DEFAULT API RESPONSE
// ======================================================

app.get("/api", (req, res) => {

  res.json({
    success: true,
    message: "Welcome to EarnPesa API",
    endpoints: {
      health: "/api/health",
      register: "POST /api/register",
      login: "POST /api/login",
      submit: "POST /api/submit",
      user: "GET /api/user/:id",
      withdraw: "POST /api/withdraw",
      history: "GET /api/history/:userId",
      withdrawals: "GET /api/withdrawals/:userId"
    }
  });

});

// ======================================================
// ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {

  console.error("SERVER ERROR:", err);

  res.status(500).json({
    error: "Internal server error"
  });

});

// ======================================================
// VERCEL EXPORT
// ======================================================

module.exports = app;
