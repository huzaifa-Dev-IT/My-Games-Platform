// server/index.js - Balloon Pop Jumper Backend
// Copy-paste ready. Bas .env me values daalni hain.

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Socket.io setup with CORS
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '10mb' }));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ DB Error:', err.message));

// ========= DATABASE SCHEMAS =========

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, minlength: 3, maxlength: 20 },
  coins: { type: Number, default: 100 }, // Start with 100 free coins
  unlockedSkins: { type: [String], default: ['default'] },
  equippedSkin: { type: String, default: 'default' },
  highscore: { type: Number, default: 1 },
  totalGamesPlayed: { type: Number, default: 0 },
  totalBalloonsPopped: { type: Number, default: 0 },
  gameStats: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastLogin: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const GameSessionSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  players: [{
    username: String,
    socketId: String,
    playerState: {
      x: Number, y: Number, skin: String, score: Number
    },
    joinedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, index: { expireAfterSeconds: 3600 } }
});

const ReviewSchema = new mongoose.Schema({
  gameId: { type: String, required: true },
  username: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const GameSession = mongoose.model('GameSession', GameSessionSchema);
const Review = mongoose.model('Review', ReviewSchema);

// ========= API ENDPOINTS =========

// Register new user
app.post('/api/register', async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username || username.length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be 3-20 characters' });
    }
    
    // Check if user exists
    let user = await User.findOne({ username });
    
    if (user) {
      // Return existing user (simple login)
      return res.json({ 
        success: true, 
        user: sanitizeUser(user),
        message: 'Welcome back!'
      });
    }
    
    // Create new user
    user = new User({ username });
    await user.save();
    
    res.status(201).json({ 
      success: true, 
      user: sanitizeUser(user),
      message: 'Account created! +100 free coins 🎁'
    });
    
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get user data
app.get('/api/user/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Save game progress (coins, stats)
app.post('/api/user/:username/save-progress', async (req, res) => {
  try {
    const { username } = req.params;
    const { gameId, coinsEarned, balloonsPopped, levelReached, gameDuration, score, kills } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Anti-cheat: Limit coins per session
    const safeCoins = Math.min(Math.max(coinsEarned || 0, 0), 200);
    
    // Update user
    user.coins += safeCoins;
    user.totalGamesPlayed += 1;
    user.lastLogin = new Date();
    
    // Legacy support for Balloon Pop
    if (balloonsPopped) user.totalBalloonsPopped += balloonsPopped;
    if (levelReached > user.highscore) user.highscore = levelReached;

    // Generic game stats support for new games
    if (gameId) {
      if (!user.gameStats) user.gameStats = {};
      if (!user.gameStats[gameId]) user.gameStats[gameId] = {};
      
      if (score && score > (user.gameStats[gameId].highScore || 0)) {
        user.gameStats[gameId].highScore = score;
      }
      if (kills) {
        user.gameStats[gameId].totalKills = (user.gameStats[gameId].totalKills || 0) + kills;
      }
      user.markModified('gameStats');
    }
    
    await user.save();
    
    res.json({ 
      success: true, 
      newCoins: user.coins,
      highscore: user.highscore,
      gameStats: user.gameStats,
      message: `Progress saved! +${safeCoins} coins`
    });
    
  } catch (err) {
    console.error('Save progress error:', err);
    res.status(500).json({ success: false, message: 'Failed to save progress' });
  }
});

// Unlock skin with coins
app.post('/api/user/:username/unlock-skin', async (req, res) => {
  try {
    const { username } = req.params;
    const { skinId, cost } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Check if already unlocked
    if (user.unlockedSkins.includes(skinId)) {
      return res.json({ success: true, message: 'Already unlocked!', unlockedSkins: user.unlockedSkins });
    }
    
    // Check coins
    if (user.coins < cost) {
      return res.status(400).json({ success: false, message: 'Not enough coins!' });
    }
    
    // Unlock skin
    user.coins -= cost;
    user.unlockedSkins.push(skinId);
    await user.save();
    
    res.json({ 
      success: true, 
      message: `🎉 ${skinId} unlocked!`,
      newCoins: user.coins,
      unlockedSkins: user.unlockedSkins
    });
    
  } catch (err) {
    console.error('Unlock skin error:', err);
    res.status(500).json({ success: false, message: 'Failed to unlock skin' });
  }
});

// Equip skin
app.post('/api/user/:username/equip-skin', async (req, res) => {
  try {
    const { username } = req.params;
    const { skinId } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Check if unlocked
    if (!user.unlockedSkins.includes(skinId)) {
      return res.status(400).json({ success: false, message: 'Skin not unlocked' });
    }
    
    user.equippedSkin = skinId;
    await user.save();
    
    res.json({ success: true, equippedSkin: user.equippedSkin });
    
  } catch (err) {
    console.error('Equip skin error:', err);
    res.status(500).json({ success: false, message: 'Failed to equip skin' });
  }
});

// Get Reviews for a Game
app.get('/api/reviews/:gameId', async (req, res) => {
  try {
    const reviews = await Review.find({ gameId: req.params.gameId }).sort({ createdAt: -1 });
    res.json({ success: true, reviews });
  } catch (err) {
    console.error('Fetch reviews error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Submit a Review
app.post('/api/reviews/:gameId', async (req, res) => {
  try {
    const { username, rating, comment } = req.body;
    if (!username || !rating || !comment) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    const review = new Review({
      gameId: req.params.gameId,
      username,
      rating,
      comment
    });
    await review.save();
    res.status(201).json({ success: true, review, message: 'Review submitted!' });
  } catch (err) {
    console.error('Submit review error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'Balloon Pop API', timestamp: new Date().toISOString() });
});

// Helper: Sanitize user data before sending to client
function sanitizeUser(user) {
  return {
    username: user.username,
    coins: user.coins,
    unlockedSkins: user.unlockedSkins,
    equippedSkin: user.equippedSkin,
    highscore: user.highscore,
    totalGamesPlayed: user.totalGamesPlayed,
    totalBalloonsPopped: user.totalBalloonsPopped,
    gameStats: user.gameStats
  };
}

// ========= SOCKET.IO (Multiplayer) =========

io.on('connection', (socket) => {
  console.log('🔌 Player connected:', socket.id);
  
  // Join a game room
  socket.on('joinRoom', async ({ roomId, username }) => {
    try {
      socket.join(roomId);
      socket.data = { roomId, username };
      
      // Add player to session in DB (optional, for persistence)
      let session = await GameSession.findOne({ roomId });
      if (!session) {
        session = new GameSession({ 
          roomId, 
          players: [{ username, socketId: socket.id, playerState: { x: 0, y: 0, skin: 'default', score: 0 } }] 
        });
        await session.save();
      } else {
        // Check if player already in room
        if (!session.players.find(p => p.username === username)) {
          session.players.push({ 
            username, 
            socketId: socket.id, 
            playerState: { x: 0, y: 0, skin: 'default', score: 0 } 
          });
          await session.save();
        }
      }
      
      // Send room info to player
      socket.emit('roomJoined', { 
        roomId, 
        players: session.players.map(p => ({ username: p.username, state: p.playerState })) 
      });
      
      // Notify other players
      socket.to(roomId).emit('playerJoined', { 
        username, 
        message: `${username} joined the game! 🎈` 
      });
      
      console.log(`🎮 ${username} joined room ${roomId}`);
      
    } catch (err) {
      console.error('Join room error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });
  
  // Broadcast player action (for visual sync only - NOT authoritative)
  socket.on('playerAction', ({ action, data }) => {
    const { roomId, username } = socket.data || {};
    if (!roomId) return;
    
    // Broadcast to OTHER players in room (not sender)
    socket.to(roomId).emit('actionReceived', {
      username,
      action, // e.g., 'jumped', 'popped', 'moved'
      data,   // e.g., { x: 100, y: 200 }
      timestamp: Date.now()
    });
  });
  
  // Update player state (periodic sync)
  socket.on('playerStateUpdate', ({ state }) => {
    const { roomId, username } = socket.data || {};
    if (!roomId || !username) return;
    
    // Broadcast to others (lightweight sync)
    socket.to(roomId).emit('playerStateUpdate', {
      username,
      state: { x: state.x, y: state.y, skin: state.skin } // Only essential data
    });
  });
  
  // Chat message (fun feature)
  socket.on('chatMessage', ({ message }) => {
    const { roomId, username } = socket.data || {};
    if (!roomId) return;
    
    io.to(roomId).emit('chatMessage', {
      username: username || 'Anonymous',
      message,
      timestamp: Date.now()
    });
  });
  
  // Leave room
  socket.on('leaveRoom', async () => {
    const { roomId, username } = socket.data || {};
    if (roomId) {
      // Remove from DB session
      await GameSession.findOneAndUpdate(
        { roomId },
        { $pull: { players: { username } } }
      );
      
      // Notify others
      socket.to(roomId).emit('playerLeft', {
        username,
        message: `${username} left the game 👋`
      });
      
      socket.leave(roomId);
      console.log(`👋 ${username} left room ${roomId}`);
    }
  });
  
  // Disconnect handler
  socket.on('disconnect', async () => {
    console.log('🔌 Player disconnected:', socket.id);
    const { roomId, username } = socket.data || {};
    
    if (roomId && username) {
      // Clean up DB
      await GameSession.findOneAndUpdate(
        { roomId },
        { $pull: { players: { socketId: socket.id } } }
      );
      
      // Notify room
      socket.to(roomId).emit('playerLeft', {
        username,
        message: `${username} disconnected`
      });
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await mongoose.connection.close();
  process.exit(0);
});