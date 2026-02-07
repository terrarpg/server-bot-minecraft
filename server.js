#!/usr/bin/env node

// ==============================
// IMPORTS ET CONFIGURATION
// ==============================
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const chalk = require('chalk');
const { program } = require('commander');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const mcData = require('minecraft-data');

// ==============================
// CONFIGURATION CLI
// ==============================
program
  .name('minecraft-bot-manager')
  .description('Interface web pour contrôler des bots Minecraft')
  .version('1.0.0')
  .option('-p, --port <number>', 'Port du serveur web', 3000)
  .option('-h, --host <host>', 'Hôte du serveur web', 'localhost')
  .option('--no-gui', 'Désactiver l\'interface web')
  .option('--auto-start', 'Démarrer automatiquement les bots')
  .parse(process.argv);

const options = program.opts();

// ==============================
// CLASSES
// ==============================

/**
 * Classe pour gérer les bots Minecraft
 */
class BotManager {
  constructor() {
    this.bots = new Map();
    this.botData = new Map();
    this.config = this.loadConfig();
    this.stats = {
      startTime: Date.now(),
      totalBots: 0,
      activeBots: 0,
      messagesSent: 0,
      movements: 0,
      errors: 0
    };
  }

  loadConfig() {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return {
      server: {
        host: 'localhost',
        port: 25565,
        version: '1.20.1'
      },
      bots: {
        defaultCount: 1,
        prefix: 'WebBot',
        autoReconnect: true,
        viewDistance: 6
      },
      web: {
        port: 3000,
        password: '',
        allowCommands: true
      }
    };
  }

  saveConfig() {
    const configPath = path.join(__dirname, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }

  createBot(id, customName = null) {
    const botName = customName || `${this.config.bots.prefix}${id}`;
    
    console.log(chalk.blue(`🤖 Création du bot: ${botName}`));
    
    const botOptions = {
      host: this.config.server.host,
      port: this.config.server.port,
      username: botName,
      version: this.config.server.version,
      auth: 'offline',
      viewDistance: this.config.bots.viewDistance
    };

    try {
      const bot = mineflayer.createBot(botOptions);
      
      // Charger pathfinder
      bot.loadPlugin(pathfinder);
      
      this.bots.set(id, bot);
      this.botData.set(id, {
        id,
        name: botName,
        status: 'connecting',
        position: { x: 0, y: 0, z: 0 },
        health: 20,
        food: 20,
        inventory: [],
        activity: 'idle',
        connectedAt: null,
        lastAction: Date.now(),
        isMoving: false
      });

      this.setupBotEvents(bot, id);
      this.stats.totalBots++;
      
      return bot;
    } catch (error) {
      console.log(chalk.red(`❌ Erreur création bot ${botName}: ${error.message}`));
      return null;
    }
  }

  setupBotEvents(bot, id) {
    const data = this.botData.get(id);

    bot.once('spawn', () => {
      data.status = 'connected';
      data.connectedAt = Date.now();
      this.stats.activeBots++;
      
      // Configurer les mouvements
      const movements = new Movements(bot, mcData(bot.version));
      bot.pathfinder.setMovements(movements);
      
      console.log(chalk.green(`✅ ${bot.username} connecté au serveur`));
      
      // Envoyer message de bienvenue
      setTimeout(() => {
        bot.chat('Bonjour! Je suis un bot contrôlé depuis le web.');
        this.stats.messagesSent++;
      }, 2000);
      
      // Mettre à jour la position périodiquement
      setInterval(() => {
        if (bot.entity) {
          data.position = {
            x: Math.floor(bot.entity.position.x),
            y: Math.floor(bot.entity.position.y),
            z: Math.floor(bot.entity.position.z)
          };
          data.health = Math.floor(bot.health);
          data.food = Math.floor(bot.food);
        }
      }, 1000);
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      
      this.stats.messagesSent++;
      
      // Log dans la console
      console.log(chalk.cyan(`💬 ${username}: ${message}`));
      
      // Répondre aux commandes
      if (message.startsWith('!bot')) {
        this.handleBotCommand(bot, id, username, message);
      }
    });

    bot.on('kicked', (reason) => {
      console.log(chalk.yellow(`⚠️ ${bot.username} kické: ${reason}`));
      data.status = 'kicked';
      this.stats.activeBots--;
      
      if (this.config.bots.autoReconnect) {
        setTimeout(() => {
          this.reconnectBot(id);
        }, 10000);
      }
    });

    bot.on('error', (err) => {
      console.log(chalk.red(`❌ Erreur ${bot.username}: ${err.message}`));
      data.status = 'error';
      this.stats.errors++;
    });

    bot.on('death', () => {
      console.log(chalk.red(`💀 ${bot.username} est mort`));
      data.status = 'dead';
    });

    bot.on('end', () => {
      console.log(chalk.yellow(`🔌 ${bot.username} déconnecté`));
      data.status = 'disconnected';
      this.stats.activeBots--;
      this.bots.delete(id);
    });
  }

  handleBotCommand(bot, id, username, message) {
    const args = message.split(' ');
    const command = args[1];

    switch(command) {
      case 'info':
        const data = this.botData.get(id);
        bot.chat(`Je suis ${bot.username}. Position: ${data.position.x}, ${data.position.y}, ${data.position.z}`);
        break;
      case 'come':
        const player = bot.players[username];
        if (player && player.entity) {
          bot.chat(`J'arrive ${username}!`);
          bot.pathfinder.setGoal(new goals.GoalNear(
            player.entity.position.x,
            player.entity.position.y,
            player.entity.position.z,
            2
          ));
        }
        break;
      case 'stop':
        bot.pathfinder.stop();
        bot.chat('Arrêt du mouvement.');
        break;
    }
  }

  async moveBot(id, x, y, z) {
    const bot = this.bots.get(id);
    if (!bot || !bot.entity) return false;

    try {
      const data = this.botData.get(id);
      data.isMoving = true;
      data.activity = 'moving';
      
      await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2));
      this.stats.movements++;
      data.isMoving = false;
      data.activity = 'idle';
      return true;
    } catch (error) {
      console.log(chalk.red(`❌ Erreur mouvement: ${error.message}`));
      return false;
    }
  }

  sendChat(id, message) {
    const bot = this.bots.get(id);
    if (bot) {
      bot.chat(message);
      this.stats.messagesSent++;
      return true;
    }
    return false;
  }

  getBot(id) {
    const bot = this.bots.get(id);
    const data = this.botData.get(id);
    return { bot, data };
  }

  getAllBots() {
    const bots = [];
    this.botData.forEach((data, id) => {
      bots.push({
        id,
        name: data.name,
        status: data.status,
        position: data.position,
        health: data.health,
        food: data.food,
        activity: data.activity,
        uptime: data.connectedAt ? Date.now() - data.connectedAt : 0
      });
    });
    return bots;
  }

  removeBot(id) {
    const bot = this.bots.get(id);
    if (bot) {
      bot.quit();
      this.bots.delete(id);
      this.botData.delete(id);
      this.stats.activeBots--;
      console.log(chalk.yellow(`🗑️ Bot ${id} supprimé`));
      return true;
    }
    return false;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
    return this.config;
  }

  reconnectBot(id) {
    console.log(chalk.blue(`🔄 Reconnexion du bot ${id}...`));
    this.removeBot(id);
    setTimeout(() => {
      this.createBot(id);
    }, 1000);
  }

  stopAll() {
    console.log(chalk.yellow('🛑 Arrêt de tous les bots...'));
    this.bots.forEach((bot, id) => {
      bot.quit();
    });
    this.bots.clear();
    this.botData.clear();
    this.stats.activeBots = 0;
  }
}

// ==============================
// INITIALISATION DU SERVEUR
// ==============================
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const botManager = new BotManager();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'minecraft-bot-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// ==============================
// ROUTES WEB
// ==============================

// Page d'accueil
app.get('/', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎮 Minecraft Bot Manager</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        min-height: 100vh;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
      }
      header {
        text-align: center;
        padding: 40px 0;
      }
      header h1 {
        font-size: 3em;
        margin-bottom: 10px;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
      }
      header p {
        font-size: 1.2em;
        opacity: 0.9;
      }
      .dashboard {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 20px;
        margin-top: 30px;
      }
      .card {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        border-radius: 15px;
        padding: 25px;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      .card h2 {
        margin-bottom: 20px;
        color: #ffd700;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 15px;
      }
      .stat {
        text-align: center;
        padding: 15px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
      }
      .stat .number {
        font-size: 2em;
        font-weight: bold;
        color: #4ade80;
      }
      .stat .label {
        font-size: 0.9em;
        opacity: 0.8;
        margin-top: 5px;
      }
      .btn {
        display: inline-block;
        background: linear-gradient(45deg, #4ade80, #22d3ee);
        color: white;
        padding: 12px 25px;
        border-radius: 50px;
        text-decoration: none;
        font-weight: bold;
        border: none;
        cursor: pointer;
        transition: transform 0.3s, box-shadow 0.3s;
        margin: 5px;
      }
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 20px rgba(0,0,0,0.2);
      }
      .btn-danger {
        background: linear-gradient(45deg, #f87171, #ef4444);
      }
      .btn-secondary {
        background: linear-gradient(45deg, #94a3b8, #64748b);
      }
      .form-group {
        margin-bottom: 20px;
      }
      label {
        display: block;
        margin-bottom: 8px;
        font-weight: bold;
      }
      input, select {
        width: 100%;
        padding: 12px;
        border-radius: 8px;
        border: 2px solid rgba(255,255,255,0.3);
        background: rgba(255,255,255,0.1);
        color: white;
        font-size: 16px;
      }
      input::placeholder {
        color: rgba(255,255,255,0.6);
      }
      .bot-card {
        background: rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 15px;
        margin-bottom: 15px;
        border-left: 4px solid #4ade80;
      }
      .bot-card.offline {
        border-left-color: #f87171;
      }
      .bot-card.connecting {
        border-left-color: #fbbf24;
      }
      .status-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.8em;
        font-weight: bold;
        margin-left: 10px;
      }
      .status-connected { background: #10b981; }
      .status-disconnected { background: #ef4444; }
      .status-connecting { background: #f59e0b; }
      .status-error { background: #dc2626; }
      footer {
        text-align: center;
        margin-top: 40px;
        padding: 20px;
        border-top: 1px solid rgba(255,255,255,0.1);
        font-size: 0.9em;
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1>🎮 Minecraft Bot Manager</h1>
        <p>Contrôlez vos bots Minecraft depuis votre navigateur</p>
      </header>
      
      <div class="dashboard">
        <!-- Carte des statistiques -->
        <div class="card">
          <h2>📊 Statistiques</h2>
          <div class="stats-grid" id="stats">
            <!-- Rempli par JavaScript -->
          </div>
          <div style="margin-top: 20px;">
            <button class="btn" onclick="window.location.href='/dashboard'">
              🚀 Accéder au Dashboard
            </button>
          </div>
        </div>
        
        <!-- Carte de configuration -->
        <div class="card">
          <h2>⚙️ Configuration Rapide</h2>
          <form id="quickConfig" onsubmit="return false;">
            <div class="form-group">
              <label>Serveur Minecraft:</label>
              <input type="text" id="serverHost" placeholder="localhost" value="${botManager.config.server.host}">
            </div>
            <div class="form-group">
              <label>Port:</label>
              <input type="number" id="serverPort" placeholder="25565" value="${botManager.config.server.port}">
            </div>
            <button class="btn" onclick="updateConfig()">💾 Mettre à jour</button>
          </form>
        </div>
        
        <!-- Carte d'information -->
        <div class="card">
          <h2>ℹ️ Information</h2>
          <p>Version: 1.0.0</p>
          <p>Bots actifs: <span id="activeBots">0</span></p>
          <p>Serveur: ${botManager.config.server.host}:${botManager.config.server.port}</p>
          <div style="margin-top: 20px;">
            <button class="btn" onclick="window.location.href='/api/bots/create?count=1'">
              ➕ Ajouter un Bot
            </button>
            <button class="btn btn-danger" onclick="stopAllBots()">
              ⏹️ Tout Arrêter
            </button>
          </div>
        </div>
      </div>
      
      <!-- Liste des bots -->
      <div class="card" style="margin-top: 30px;">
        <h2>🤖 Bots Connectés</h2>
        <div id="botsList">
          <!-- Rempli par JavaScript -->
        </div>
      </div>
      
      <footer>
        <p>© 2024 Minecraft Bot Manager | Développé avec Node.js et Mineflayer</p>
      </footer>
    </div>
    
    <script>
      // Fonction pour mettre à jour les statistiques
      async function updateStats() {
        try {
          const response = await fetch('/api/stats');
          const data = await response.json();
          
          // Mettre à jour les statistiques
          document.getElementById('stats').innerHTML = \`
            <div class="stat">
              <div class="number">\${data.activeBots}</div>
              <div class="label">Bots Actifs</div>
            </div>
            <div class="stat">
              <div class="number">\${data.totalBots}</div>
              <div class="label">Total Bots</div>
            </div>
            <div class="stat">
              <div class="number">\${data.messagesSent}</div>
              <div class="label">Messages</div>
            </div>
            <div class="stat">
              <div class="number">\${data.uptime}</div>
              <div class="label">Uptime (s)</div>
            </div>
          \`;
          
          // Mettre à jour la liste des bots
          const botsList = document.getElementById('botsList');
          if (data.bots && data.bots.length > 0) {
            botsList.innerHTML = data.bots.map(bot => \`
              <div class="bot-card \${bot.status !== 'connected' ? 'offline' : ''}">
                <strong>\${bot.name}</strong>
                <span class="status-badge status-\${bot.status}">\${bot.status}</span>
                <div style="margin-top: 10px; font-size: 0.9em;">
                  Position: \${bot.position.x}, \${bot.position.y}, \${bot.position.z} |
                  PV: \${bot.health} | Nourriture: \${bot.food}
                </div>
              </div>
            \`).join('');
          } else {
            botsList.innerHTML = '<p>Aucun bot connecté</p>';
          }
          
          document.getElementById('activeBots').textContent = data.activeBots;
        } catch (error) {
          console.error('Erreur:', error);
        }
      }
      
      // Fonction pour mettre à jour la configuration
      async function updateConfig() {
        const host = document.getElementById('serverHost').value;
        const port = document.getElementById('serverPort').value;
        
        try {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              server: { host, port }
            })
          });
          alert('Configuration mise à jour!');
          location.reload();
        } catch (error) {
          alert('Erreur: ' + error.message);
        }
      }
      
      // Fonction pour arrêter tous les bots
      async function stopAllBots() {
        if (confirm('Êtes-vous sûr de vouloir arrêter tous les bots?')) {
          await fetch('/api/bots/stop', { method: 'POST' });
          updateStats();
        }
      }
      
      // Mettre à jour toutes les 5 secondes
      setInterval(updateStats, 5000);
      updateStats();
    </script>
  </body>
  </html>
  `);
});

// Dashboard complet
app.get('/dashboard', (req, res) => {
  const bots = botManager.getAllBots();
  res.send(`
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Minecraft Bot Manager</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        width: 250px;
        height: 100vh;
        background: #1e293b;
        padding: 20px;
        border-right: 1px solid #334155;
      }
      .logo {
        text-align: center;
        padding: 20px 0;
        font-size: 1.5em;
        color: #60a5fa;
        border-bottom: 1px solid #334155;
        margin-bottom: 30px;
      }
      .nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 15px;
        color: #cbd5e1;
        text-decoration: none;
        border-radius: 8px;
        margin-bottom: 10px;
        transition: all 0.3s;
      }
      .nav-item:hover, .nav-item.active {
        background: #334155;
        color: white;
      }
      .main-content {
        margin-left: 250px;
        padding: 20px;
      }
      .header {
        background: #1e293b;
        padding: 20px;
        border-radius: 10px;
        margin-bottom: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
        gap: 20px;
      }
      .card {
        background: #1e293b;
        border-radius: 10px;
        padding: 20px;
        border: 1px solid #334155;
      }
      .card-title {
        font-size: 1.2em;
        margin-bottom: 20px;
        color: #60a5fa;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .btn {
        background: linear-gradient(45deg, #3b82f6, #6366f1);
        color: white;
        padding: 10px 20px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.3s;
      }
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
      }
      .btn-danger {
        background: linear-gradient(45deg, #ef4444, #dc2626);
      }
      .btn-success {
        background: linear-gradient(45deg, #10b981, #059669);
      }
      .form-group {
        margin-bottom: 15px;
      }
      label {
        display: block;
        margin-bottom: 5px;
        color: #94a3b8;
        font-weight: bold;
      }
      input, select, textarea {
        width: 100%;
        padding: 10px;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        color: white;
        font-size: 14px;
      }
      .bot-controls {
        display: flex;
        gap: 10px;
        margin-top: 10px;
      }
      .bot-controls .btn {
        flex: 1;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th {
        background: #334155;
        padding: 12px;
        text-align: left;
        color: #60a5fa;
        font-weight: bold;
      }
      td {
        padding: 12px;
        border-bottom: 1px solid #334155;
      }
      .status-indicator {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 8px;
      }
      .status-connected { background: #10b981; }
      .status-disconnected { background: #ef4444; }
      .status-connecting { background: #f59e0b; }
      .modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        z-index: 1000;
        align-items: center;
        justify-content: center;
      }
      .modal-content {
        background: #1e293b;
        padding: 30px;
        border-radius: 10px;
        min-width: 400px;
        max-width: 600px;
        border: 1px solid #334155;
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }
      .close-btn {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 1.5em;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="sidebar">
      <div class="logo">🎮 Bot Manager</div>
      <a href="/" class="nav-item">
        🏠 Accueil
      </a>
      <a href="/dashboard" class="nav-item active">
        📊 Dashboard
      </a>
      <a href="#" class="nav-item" onclick="showModal('botModal')">
        🤖 Nouveau Bot
      </a>
      <a href="#" class="nav-item" onclick="showModal('configModal')">
        ⚙️ Configuration
      </a>
      <a href="#" class="nav-item" onclick="showModal('serverModal')">
        🌐 Serveur
      </a>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155;">
        <div style="color: #94a3b8; font-size: 0.9em; margin-bottom: 10px;">Bots en ligne:</div>
        <div id="onlineBots" style="color: #10b981; font-size: 1.2em; font-weight: bold;">0</div>
      </div>
    </div>
    
    <div class="main-content">
      <div class="header">
        <h1>Dashboard de Contrôle</h1>
        <div>
          <button class="btn btn-success" onclick="createBot()">
            ➕ Créer un Bot
          </button>
          <button class="btn btn-danger" onclick="stopAllBots()">
            ⏹️ Tout Arrêter
          </button>
        </div>
      </div>
      
      <div class="grid">
        <!-- Carte des bots -->
        <div class="card">
          <div class="card-title">🤖 Bots Actifs</div>
          <div id="botsTable">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Statut</th>
                  <th>Position</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="botsTableBody">
                <!-- Rempli par JavaScript -->
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- Carte de contrôle -->
        <div class="card">
          <div class="card-title">🎮 Contrôle du Bot</div>
          <div class="form-group">
            <label>Sélectionner un Bot:</label>
            <select id="selectedBot" onchange="updateBotControls()">
              <option value="">-- Sélectionner --</option>
            </select>
          </div>
          
          <div id="botControls" style="display: none;">
            <div class="form-group">
              <label>Message à envoyer:</label>
              <input type="text" id="chatMessage" placeholder="Entrez un message...">
              <button class="btn" onclick="sendChat()" style="margin-top: 10px; width: 100%;">
                💬 Envoyer
              </button>
            </div>
            
            <div class="form-group">
              <label>Déplacer vers:</label>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                <input type="number" id="moveX" placeholder="X">
                <input type="number" id="moveY" placeholder="Y">
                <input type="number" id="moveZ" placeholder="Z">
              </div>
              <button class="btn" onclick="moveBot()" style="margin-top: 10px; width: 100%;">
                🚀 Déplacer
              </button>
            </div>
            
            <div class="bot-controls">
              <button class="btn btn-success" onclick="botAction('jump')">
                🦘 Sauter
              </button>
              <button class="btn" onclick="botAction('look')">
                👀 Regarder
              </button>
              <button class="btn btn-danger" onclick="botAction('stop')">
                ⏹️ Arrêter
              </button>
            </div>
          </div>
        </div>
        
        <!-- Carte des statistiques -->
        <div class="card">
          <div class="card-title">📈 Statistiques</div>
          <div id="statsPanel">
            <!-- Rempli par JavaScript -->
          </div>
        </div>
        
        <!-- Carte de la console -->
        <div class="card">
          <div class="card-title">📝 Console</div>
          <div id="console" style="
            background: #0f172a;
            border-radius: 6px;
            padding: 15px;
            height: 300px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
            color: #94a3b8;
          ">
            <div>🚀 Système démarré...</div>
          </div>
          <button class="btn" onclick="clearConsole()" style="margin-top: 10px;">
            🗑️ Effacer
          </button>
        </div>
      </div>
    </div>
    
    <!-- Modal Nouveau Bot -->
    <div id="botModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>🤖 Créer un Nouveau Bot</h2>
          <button class="close-btn" onclick="hideModal('botModal')">×</button>
        </div>
        <form id="createBotForm">
          <div class="form-group">
            <label>Nom du bot:</label>
            <input type="text" id="botName" placeholder="Bot1" required>
          </div>
          <div class="form-group">
            <label>Nombre de bots:</label>
            <input type="number" id="botCount" value="1" min="1" max="10">
          </div>
          <div class="form-group">
            <label>Comportement:</label>
            <select id="botBehavior">
              <option value="passive">Passif</option>
              <option value="active">Actif</option>
              <option value="miner">Mineur</option>
              <option value="guard">Garde</option>
            </select>
          </div>
          <button type="submit" class="btn" style="width: 100%;">
            🚀 Créer le(s) Bot(s)
          </button>
        </form>
      </div>
    </div>
    
    <!-- Modal Configuration -->
    <div id="configModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>⚙️ Configuration</h2>
          <button class="close-btn" onclick="hideModal('configModal')">×</button>
        </div>
        <form id="configForm">
          <div class="form-group">
            <label>Préfixe des bots:</label>
            <input type="text" id="botPrefix" value="${botManager.config.bots.prefix}">
          </div>
          <div class="form-group">
            <label>Auto-reconnexion:</label>
            <select id="autoReconnect">
              <option value="true" ${botManager.config.bots.autoReconnect ? 'selected' : ''}>Activé</option>
              <option value="false" ${!botManager.config.bots.autoReconnect ? 'selected' : ''}>Désactivé</option>
            </select>
          </div>
          <div class="form-group">
            <label>Distance de vue:</label>
            <input type="number" id="viewDistance" value="${botManager.config.bots.viewDistance}" min="2" max="16">
          </div>
          <button type="submit" class="btn" style="width: 100%;">
            💾 Enregistrer
          </button>
        </form>
      </div>
    </div>
    
    <!-- Modal Serveur -->
    <div id="serverModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2>🌐 Configuration du Serveur</h2>
          <button class="close-btn" onclick="hideModal('serverModal')">×</button>
        </div>
        <form id="serverForm">
          <div class="form-group">
            <label>Adresse du serveur:</label>
            <input type="text" id="serverHost" value="${botManager.config.server.host}" required>
          </div>
          <div class="form-group">
            <label>Port:</label>
            <input type="number" id="serverPort" value="${botManager.config.server.port}" required>
          </div>
          <div class="form-group">
            <label>Version Minecraft:</label>
            <input type="text" id="serverVersion" value="${botManager.config.server.version}" required>
          </div>
          <button type="submit" class="btn" style="width: 100%;">
            🌍 Connecter
          </button>
        </form>
      </div>
    </div>
    
    <script>
      let selectedBotId = null;
      const consoleElement = document.getElementById('console');
      
      // Fonctions modales
      function showModal(modalId) {
        document.getElementById(modalId).style.display = 'flex';
      }
      
      function hideModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
      }
      
      // Log dans la console
      function logToConsole(message, type = 'info') {
        const colors = {
          info: '#94a3b8',
          success: '#10b981',
          error: '#ef4444',
          warning: '#f59e0b'
        };
        const timestamp = new Date().toLocaleTimeString();
        const div = document.createElement('div');
        div.innerHTML = \`<span style="color: \${colors[type]}">[\${timestamp}] \${message}</span>\`;
        consoleElement.appendChild(div);
        consoleElement.scrollTop = consoleElement.scrollHeight;
      }
      
      function clearConsole() {
        consoleElement.innerHTML = '<div>🚀 Console effacée...</div>';
      }
      
      // Charger les bots
      async function loadBots() {
        try {
          const response = await fetch('/api/bots');
          const bots = await response.json();
          
          // Mettre à jour le compteur
          const onlineCount = bots.filter(b => b.status === 'connected').length;
          document.getElementById('onlineBots').textContent = onlineCount;
          
          // Mettre à jour la table
          const tbody = document.getElementById('botsTableBody');
          const botSelect = document.getElementById('selectedBot');
          
          tbody.innerHTML = '';
          botSelect.innerHTML = '<option value="">-- Sélectionner --</option>';
          
          bots.forEach(bot => {
            const row = tbody.insertRow();
            row.innerHTML = \`
              <td>\${bot.name}</td>
              <td>
                <span class="status-indicator status-\${bot.status}"></span>
                \${bot.status}
              </td>
              <td>\${bot.position.x}, \${bot.position.y}, \${bot.position.z}</td>
              <td>
                <button class="btn" onclick="controlBot('\${bot.id}')" style="padding: 5px 10px; font-size: 12px;">
                  🎮 Contrôler
                </button>
                <button class="btn btn-danger" onclick="removeBot('\${bot.id}')" style="padding: 5px 10px; font-size: 12px;">
                  🗑️ Supprimer
                </button>
              </td>
            \`;
            
            const option = document.createElement('option');
            option.value = bot.id;
            option.textContent = \`\${bot.name} (\${bot.status})\`;
            botSelect.appendChild(option);
          });
          
          // Mettre à jour les statistiques
          updateStats();
          
        } catch (error) {
          logToConsole('Erreur chargement bots: ' + error.message, 'error');
        }
      }
      
      // Mettre à jour les statistiques
      async function updateStats() {
        try {
          const response = await fetch('/api/stats');
          const stats = await response.json();
          
          document.getElementById('statsPanel').innerHTML = \`
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div style="background: #0f172a; padding: 10px; border-radius: 6px;">
                <div style="color: #94a3b8; font-size: 12px;">Bots Actifs</div>
                <div style="color: #10b981; font-size: 24px; font-weight: bold;">\${stats.activeBots}</div>
              </div>
              <div style="background: #0f172a; padding: 10px; border-radius: 6px;">
                <div style="color: #94a3b8; font-size: 12px;">Messages</div>
                <div style="color: #60a5fa; font-size: 24px; font-weight: bold;">\${stats.messagesSent}</div>
              </div>
              <div style="background: #0f172a; padding: 10px; border-radius: 6px;">
                <div style="color: #94a3b8; font-size: 12px;">Mouvements</div>
                <div style="color: #8b5cf6; font-size: 24px; font-weight: bold;">\${stats.movements}</div>
              </div>
              <div style="background: #0f172a; padding: 10px; border-radius: 6px;">
                <div style="color: #94a3b8; font-size: 12px;">Uptime</div>
                <div style="color: #f59e0b; font-size: 24px; font-weight: bold;">\${stats.uptime}s</div>
              </div>
            </div>
          \`;
          
        } catch (error) {
          logToConsole('Erreur statistiques: ' + error.message, 'error');
        }
      }
      
      // Créer un bot
      async function createBot() {
        const name = document.getElementById('botName').value || 'Bot';
        const count = parseInt(document.getElementById('botCount').value) || 1;
        const behavior = document.getElementById('botBehavior').value;
        
        try {
          for (let i = 0; i < count; i++) {
            const botName = count === 1 ? name : \`\${name}\${i+1}\`;
            const response = await fetch('/api/bots/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: botName,
                behavior: behavior
              })
            });
            
            if (response.ok) {
              logToConsole(\`✅ Bot \${botName} créé avec comportement: \${behavior}\`, 'success');
            }
          }
          
          hideModal('botModal');
          setTimeout(loadBots, 1000);
          
        } catch (error) {
          logToConsole('Erreur création bot: ' + error.message, 'error');
        }
      }
      
      // Configurer le serveur
      async function configureServer() {
        const host = document.getElementById('serverHost').value;
        const port = document.getElementById('serverPort').value;
        const version = document.getElementById('serverVersion').value;
        
        try {
          const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              server: { host, port, version }
            })
          });
          
          if (response.ok) {
            logToConsole(\`✅ Serveur configuré: \${host}:\${port} (v\${version})\`, 'success');
            hideModal('serverModal');
            location.reload();
          }
          
        } catch (error) {
          logToConsole('Erreur configuration: ' + error.message, 'error');
        }
      }
      
      // Sauvegarder configuration
      async function saveConfig() {
        const prefix = document.getElementById('botPrefix').value;
        const autoReconnect = document.getElementById('autoReconnect').value === 'true';
        const viewDistance = parseInt(document.getElementById('viewDistance').value);
        
        try {
          const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bots: { prefix, autoReconnect, viewDistance }
            })
          });
          
          if (response.ok) {
            logToConsole('✅ Configuration sauvegardée', 'success');
            hideModal('configModal');
          }
          
        } catch (error) {
          logToConsole('Erreur sauvegarde: ' + error.message, 'error');
        }
      }
      
      // Contrôler un bot
      function controlBot(botId) {
        selectedBotId = botId;
        document.getElementById('selectedBot').value = botId;
        updateBotControls();
        logToConsole(\`🎮 Contrôle du bot \${botId} activé\`, 'success');
      }
      
      // Mettre à jour les contrôles
      function updateBotControls() {
        const botId = document.getElementById('selectedBot').value;
        const controls = document.getElementById('botControls');
        
        if (botId) {
          controls.style.display = 'block';
          selectedBotId = botId;
        } else {
          controls.style.display = 'none';
          selectedBotId = null;
        }
      }
      
      // Envoyer un message
      async function sendChat() {
        if (!selectedBotId) return;
        
        const message = document.getElementById('chatMessage').value;
        if (!message) return;
        
        try {
          const response = await fetch(\`/api/bots/\${selectedBotId}/chat\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
          });
          
          if (response.ok) {
            logToConsole(\`💬 Message envoyé: "\${message}"\`, 'success');
            document.getElementById('chatMessage').value = '';
          }
          
        } catch (error) {
          logToConsole('Erreur envoi message: ' + error.message, 'error');
        }
      }
      
      // Déplacer un bot
      async function moveBot() {
        if (!selectedBotId) return;
        
        const x = parseInt(document.getElementById('moveX').value);
        const y = parseInt(document.getElementById('moveY').value);
        const z = parseInt(document.getElementById('moveZ').value);
        
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          logToConsole('❌ Coordonnées invalides', 'error');
          return;
        }
        
        try {
          const response = await fetch(\`/api/bots/\${selectedBotId}/move\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x, y, z })
          });
          
          if (response.ok) {
            logToConsole(\`🚀 Déplacement vers: \${x}, \${y}, \${z}\`, 'success');
          }
          
        } catch (error) {
          logToConsole('Erreur déplacement: ' + error.message, 'error');
        }
      }
      
      // Action sur le bot
      async function botAction(action) {
        if (!selectedBotId) return;
        
        try {
          const response = await fetch(\`/api/bots/\${selectedBotId}/action\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
          });
          
          if (response.ok) {
            logToConsole(\`✅ Action "\${action}" exécutée\`, 'success');
          }
          
        } catch (error) {
          logToConsole('Erreur action: ' + error.message, 'error');
        }
      }
      
      // Supprimer un bot
      async function removeBot(botId) {
        if (confirm('Supprimer ce bot?')) {
          try {
            const response = await fetch(\`/api/bots/\${botId}\`, {
              method: 'DELETE'
            });
            
            if (response.ok) {
              logToConsole('🗑️ Bot supprimé', 'success');
              loadBots();
            }
            
          } catch (error) {
            logToConsole('Erreur suppression: ' + error.message, 'error');
          }
        }
      }
      
      // Arrêter tous les bots
      async function stopAllBots() {
        if (confirm('Arrêter tous les bots?')) {
          try {
            const response = await fetch('/api/bots/stop', { method: 'POST' });
            
            if (response.ok) {
              logToConsole('⏹️ Tous les bots arrêtés', 'success');
              loadBots();
            }
            
          } catch (error) {
            logToConsole('Erreur arrêt: ' + error.message, 'error');
          }
        }
      }
      
      // Événements formulaires
      document.getElementById('createBotForm').onsubmit = (e) => {
        e.preventDefault();
        createBot();
      };
      
      document.getElementById('configForm').onsubmit = (e) => {
        e.preventDefault();
        saveConfig();
      };
      
      document.getElementById('serverForm').onsubmit = (e) => {
        e.preventDefault();
        configureServer();
      };
      
      // Charger initialement
      loadBots();
      updateStats();
      
      // Rafraîchir toutes les 3 secondes
      setInterval(loadBots, 3000);
      
      // Gestion WebSocket pour les mises à jour en temps réel
      const socket = io();
      socket.on('botUpdate', (data) => {
        logToConsole(\`🤖 \${data.botName}: \${data.message}\`, 'info');
      });
      
      socket.on('statsUpdate', (stats) => {
        updateStats();
      });
      
      logToConsole('Dashboard chargé avec succès', 'success');
    </script>
  </body>
  </html>
  `);
});

// ==============================
// API ROUTES
// ==============================

// Statistiques
app.get('/api/stats', (req, res) => {
  const uptime = Math.floor((Date.now() - botManager.stats.startTime) / 1000);
  res.json({
    ...botManager.stats,
    uptime,
    bots: botManager.getAllBots()
  });
});

// Configuration
app.get('/api/config', (req, res) => {
  res.json(botManager.config);
});

app.post('/api/config', (req, res) => {
  const config = botManager.updateConfig(req.body);
  io.emit('configUpdate', config);
  res.json({ success: true, config });
});

// Gestion des bots
app.get('/api/bots', (req, res) => {
  res.json(botManager.getAllBots());
});

app.get('/api/bots/:id', (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (bot) {
    res.json(bot);
  } else {
    res.status(404).json({ error: 'Bot non trouvé' });
  }
});

app.post('/api/bots/create', (req, res) => {
  const { name, behavior = 'passive' } = req.body;
  const id = botManager.bots.size;
  const bot = botManager.createBot(id, name);
  
  if (bot) {
    io.emit('botCreated', { id, name, behavior });
    res.json({ success: true, id, name });
  } else {
    res.status(500).json({ error: 'Erreur création bot' });
  }
});

app.post('/api/bots/:id/chat', (req, res) => {
  const { message } = req.body;
  const success = botManager.sendChat(req.params.id, message);
  
  if (success) {
    io.emit('botChat', { id: req.params.id, message });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Bot non trouvé' });
  }
});

app.post('/api/bots/:id/move', async (req, res) => {
  const { x, y, z } = req.body;
  const success = await botManager.moveBot(req.params.id, x, y, z);
  
  if (success) {
    io.emit('botMoved', { id: req.params.id, x, y, z });
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Erreur déplacement' });
  }
});

app.post('/api/bots/:id/action', (req, res) => {
  const { action } = req.body;
  const bot = botManager.bots.get(req.params.id);
  
  if (bot) {
    switch(action) {
      case 'jump':
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 200);
        break;
      case 'look':
        bot.look(Math.random() * Math.PI * 2, Math.random() * Math.PI - Math.PI/2, false);
        break;
      case 'stop':
        if (bot.pathfinder) bot.pathfinder.stop();
        break;
    }
    
    io.emit('botAction', { id: req.params.id, action });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Bot non trouvé' });
  }
});

app.delete('/api/bots/:id', (req, res) => {
  const success = botManager.removeBot(req.params.id);
  
  if (success) {
    io.emit('botRemoved', { id: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Bot non trouvé' });
  }
});

app.post('/api/bots/stop', (req, res) => {
  botManager.stopAll();
  io.emit('allBotsStopped');
  res.json({ success: true });
});

// WebSocket events
io.on('connection', (socket) => {
  console.log(chalk.green('🌐 Nouvelle connexion WebSocket'));
  
  socket.on('getBots', () => {
    socket.emit('botsList', botManager.getAllBots());
  });
  
  socket.on('getConfig', () => {
    socket.emit('config', botManager.config);
  });
  
  socket.on('disconnect', () => {
    console.log(chalk.yellow('🌐 Déconnexion WebSocket'));
  });
});

// ==============================
// DÉMARRAGE DU SERVEUR
// ==============================
const startServer = () => {
  server.listen(options.port, options.host, () => {
    console.log(chalk.green(`
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║     🎮 Minecraft Bot Manager v1.0.0 🎮                   ║
    ║                                                          ║
    ║     Interface web de contrôle des bots Minecraft         ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
    `));
    
    console.log(chalk.cyan(`🌐 Serveur web: http://${options.host}:${options.port}`));
    console.log(chalk.cyan(`📊 Dashboard: http://${options.host}:${options.port}/dashboard`));
    console.log(chalk.blue(`🤖 Serveur Minecraft: ${botManager.config.server.host}:${botManager.config.server.port}`));
    console.log(chalk.yellow(`📝 Logs: Regardez la console pour les mises à jour`));
    
    if (options.autoStart) {
      console.log(chalk.green('🚀 Démarrage automatique des bots...'));
      setTimeout(() => {
        botManager.createBot(0, 'AutoBot');
      }, 2000);
    }
  });
};

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n🛑 Arrêt en cours...'));
  botManager.stopAll();
  io.close();
  server.close(() => {
    console.log(chalk.green('✅ Serveur arrêté proprement'));
    process.exit(0);
  });
});

// Démarrer le serveur
startServer();

module.exports = { app, server, botManager };
