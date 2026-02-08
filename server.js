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

// Configuration pour Render
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ==============================
// CONFIGURATION CLI
// ==============================
program
  .name('minecraft-bot-commander')
  .description('Interface web complète pour commander des bots Minecraft')
  .version('2.0.0')
  .option('-p, --port <number>', 'Port du serveur web', PORT)
  .option('-h, --host <host>', 'Hôte du serveur web', HOST)
  .option('--dev', 'Mode développement')
  .parse(process.argv);

const options = program.opts();

// ==============================
// CLASS BOT MANAGER
// ==============================
class BotCommander {
  constructor() {
    this.bots = new Map();
    this.botData = new Map();
    this.serverConfig = this.loadServerConfig();
    this.stats = {
      startTime: Date.now(),
      totalBotsCreated: 0,
      activeBots: 0,
      messagesSent: 0,
      movements: 0,
      errors: 0,
      commandsExecuted: 0
    };
    this.commandHistory = [];
  }

  loadServerConfig() {
    const configFile = path.join(__dirname, 'server-config.json');
    let config = {
      host: 'localhost',
      port: 25565,
      version: '1.20.1',
      maxBots: 10,
      defaultBotPrefix: 'CommanderBot'
    };

    if (fs.existsSync(configFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        config = { ...config, ...saved };
      } catch (e) {
        console.log(chalk.red('❌ Erreur chargement config:', e.message));
      }
    }

    // Surcharge par variables d'environnement
    if (process.env.MC_HOST) config.host = process.env.MC_HOST;
    if (process.env.MC_PORT) config.port = parseInt(process.env.MC_PORT);
    if (process.env.MC_VERSION) config.version = process.env.MC_VERSION;

    return config;
  }

  saveServerConfig(config = null) {
    const configFile = path.join(__dirname, 'server-config.json');
    if (config) {
      this.serverConfig = { ...this.serverConfig, ...config };
    }
    fs.writeFileSync(configFile, JSON.stringify(this.serverConfig, null, 2));
    return this.serverConfig;
  }

  updateServerConfig(host, port, version) {
    const newConfig = { host, port: parseInt(port), version };
    this.saveServerConfig(newConfig);
    
    // Reconnexion des bots si la config change
    this.bots.forEach((bot, id) => {
      const data = this.botData.get(id);
      if (data.status === 'connected') {
        bot.quit();
        setTimeout(() => this.createBot(id, data.name), 2000);
      }
    });

    return newConfig;
  }

  createBot(id, botName = null) {
    const name = botName || `${this.serverConfig.defaultBotPrefix}${id}`;
    
    console.log(chalk.blue(`🤖 Création bot: ${name} → ${this.serverConfig.host}:${this.serverConfig.port}`));
    
    const botOptions = {
      host: this.serverConfig.host,
      port: this.serverConfig.port,
      username: name,
      version: this.serverConfig.version,
      auth: 'offline',
      viewDistance: 6,
      chatLengthLimit: 256
    };

    try {
      const bot = mineflayer.createBot(botOptions);
      bot.loadPlugin(pathfinder);
      
      this.bots.set(id, bot);
      this.botData.set(id, {
        id,
        name,
        status: 'connecting',
        position: { x: 0, y: 0, z: 0 },
        health: 20,
        food: 20,
        activity: 'waiting',
        connectedAt: null,
        server: `${this.serverConfig.host}:${this.serverConfig.port}`,
        lastCommand: null
      });

      this.setupBotEvents(bot, id);
      this.stats.totalBotsCreated++;
      
      return bot;
    } catch (error) {
      console.log(chalk.red(`❌ Erreur création ${name}: ${error.message}`));
      this.botData.set(id, {
        id,
        name,
        status: 'error',
        error: error.message,
        activity: 'failed'
      });
      return null;
    }
  }

  setupBotEvents(bot, id) {
    const data = this.botData.get(id);

    bot.once('spawn', () => {
      data.status = 'connected';
      data.connectedAt = Date.now();
      this.stats.activeBots++;
      
      const movements = new Movements(bot, mcData(bot.version));
      movements.allowParkour = true;
      movements.allow1by1towers = true;
      bot.pathfinder.setMovements(movements);
      
      console.log(chalk.green(`✅ ${bot.username} connecté!`));
      
      // Message de bienvenue
      setTimeout(() => {
        bot.chat('👋 Bonjour! Je suis contrôlé depuis le web!');
        this.stats.messagesSent++;
      }, 3000);
      
      // Mettre à jour position toutes les secondes
      const updateInterval = setInterval(() => {
        if (bot.entity) {
          data.position = {
            x: Math.floor(bot.entity.position.x),
            y: Math.floor(bot.entity.position.y),
            z: Math.floor(bot.entity.position.z)
          };
          data.health = Math.floor(bot.health);
          data.food = Math.floor(bot.food);
        }
        
        if (!this.bots.has(id)) {
          clearInterval(updateInterval);
        }
      }, 1000);
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      
      this.stats.messagesSent++;
      
      // Log dans l'historique
      this.addToHistory('chat', `${username}: ${message}`);
      
      // Répondre si on est mentionné
      if (message.toLowerCase().includes(bot.username.toLowerCase())) {
        setTimeout(() => {
          bot.chat(`Oui ${username}?`);
          this.stats.messagesSent++;
        }, 1000);
      }
    });

    bot.on('kicked', (reason) => {
      console.log(chalk.yellow(`⚠️ ${bot.username} kické: ${reason}`));
      data.status = 'kicked';
      data.activity = 'kicked';
      this.stats.activeBots--;
      
      this.addToHistory('system', `${bot.username} kické: ${reason}`);
    });

    bot.on('error', (err) => {
      console.log(chalk.red(`❌ Erreur ${bot.username}: ${err.message}`));
      data.status = 'error';
      data.activity = 'error';
      this.stats.errors++;
    });

    bot.on('death', () => {
      console.log(chalk.red(`💀 ${bot.username} est mort`));
      data.status = 'dead';
      data.activity = 'dead';
      this.addToHistory('system', `${bot.username} est mort`);
    });

    bot.on('end', () => {
      console.log(chalk.yellow(`🔌 ${bot.username} déconnecté`));
      if (data.status !== 'kicked') {
        data.status = 'disconnected';
      }
      this.stats.activeBots--;
      this.bots.delete(id);
    });
  }

  addToHistory(type, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      botCount: this.stats.activeBots
    };
    
    this.commandHistory.unshift(entry);
    if (this.commandHistory.length > 50) {
      this.commandHistory.pop();
    }
    
    return entry;
  }

  async executeCommand(botId, command, params = {}) {
    const bot = this.bots.get(botId);
    if (!bot || bot.status === 'disconnected') {
      return { success: false, error: 'Bot non disponible' };
    }

    const data = this.botData.get(botId);
    data.lastCommand = { command, params, timestamp: Date.now() };
    this.stats.commandsExecuted++;

    try {
      let result;
      
      switch(command) {
        case 'chat':
          const message = params.message;
          bot.chat(message);
          this.stats.messagesSent++;
          this.addToHistory('command', `${data.name}: "${message}"`);
          result = { success: true, message: `Message envoyé: "${message}"` };
          break;

        case 'move':
          const { x, y, z } = params;
          data.activity = 'moving';
          
          await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2));
          this.stats.movements++;
          data.activity = 'idle';
          
          this.addToHistory('command', `${data.name} déplacé vers ${x}, ${y}, ${z}`);
          result = { success: true, message: `Déplacé vers ${x}, ${y}, ${z}` };
          break;

        case 'follow':
          const playerName = params.player;
          const player = bot.players[playerName];
          
          if (player && player.entity) {
            bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 3));
            data.activity = `following ${playerName}`;
            this.addToHistory('command', `${data.name} suit ${playerName}`);
            result = { success: true, message: `Suit ${playerName}` };
          } else {
            result = { success: false, error: `Joueur ${playerName} non trouvé` };
          }
          break;

        case 'stop':
          if (bot.pathfinder) {
            bot.pathfinder.stop();
          }
          data.activity = 'idle';
          this.addToHistory('command', `${data.name} arrêté`);
          result = { success: true, message: 'Mouvement arrêté' };
          break;

        case 'jump':
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 300);
          data.activity = 'jumping';
          setTimeout(() => { if (data.activity === 'jumping') data.activity = 'idle'; }, 1000);
          
          this.addToHistory('command', `${data.name} a sauté`);
          result = { success: true, message: 'Sauté!' };
          break;

        case 'look':
          const yaw = params.yaw || Math.random() * Math.PI * 2;
          const pitch = params.pitch || Math.random() * Math.PI - Math.PI / 2;
          bot.look(yaw, pitch, false);
          data.activity = 'looking';
          setTimeout(() => { if (data.activity === 'looking') data.activity = 'idle'; }, 1000);
          
          this.addToHistory('command', `${data.name} regarde autour`);
          result = { success: true, message: 'Regarde autour' };
          break;

        case 'inventory':
          const items = bot.inventory.items();
          const itemList = items.map(item => `${item.name} x${item.count}`).join(', ') || 'vide';
          result = { 
            success: true, 
            message: `Inventaire: ${itemList}`,
            items: items.map(item => ({ name: item.name, count: item.count }))
          };
          break;

        case 'attack':
          const target = params.target;
          const entity = Object.values(bot.entities).find(e => 
            e.name === target || e.username === target
          );
          
          if (entity) {
            bot.attack(entity);
            data.activity = `attacking ${target}`;
            setTimeout(() => { if (data.activity.includes('attacking')) data.activity = 'idle'; }, 3000);
            
            this.addToHistory('command', `${data.name} attaque ${target}`);
            result = { success: true, message: `Attaque ${target}` };
          } else {
            result = { success: false, error: `Cible ${target} non trouvée` };
          }
          break;

        default:
          result = { success: false, error: `Commande inconnue: ${command}` };
      }

      return result;
    } catch (error) {
      console.log(chalk.red(`❌ Erreur commande ${command}: ${error.message}`));
      this.stats.errors++;
      return { success: false, error: error.message };
    }
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
        server: data.server,
        connectedAt: data.connectedAt,
        uptime: data.connectedAt ? Date.now() - data.connectedAt : 0
      });
    });
    return bots;
  }

  removeBot(botId) {
    const bot = this.bots.get(botId);
    if (bot) {
      bot.quit();
      this.bots.delete(botId);
      this.botData.delete(botId);
      console.log(chalk.yellow(`🗑️ Bot ${botId} supprimé`));
      return true;
    }
    return false;
  }

  stopAllBots() {
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
// INITIALISATION SERVEUR
// ==============================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const commander = new BotCommander();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'minecraft-commander-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// ==============================
// ROUTES DE SANTÉ (POUR RENDER)
// ==============================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    bots: commander.stats.activeBots,
    server: commander.serverConfig
  });
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

// ==============================
// INTERFACE WEB COMPLÈTE
// ==============================
app.get('/', (req, res) => {
  const isRender = process.env.RENDER === 'true';
  const externalUrl = process.env.RENDER_EXTERNAL_URL || `http://${options.host}:${options.port}`;
  
  res.send(`
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎮 Minecraft Bot Commander</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      :root {
        --primary: #6366f1;
        --primary-dark: #4f46e5;
        --secondary: #10b981;
        --danger: #ef4444;
        --warning: #f59e0b;
        --dark: #0f172a;
        --light: #f8fafc;
        --gray: #64748b;
        --card-bg: rgba(255, 255, 255, 0.05);
      }
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        color: var(--light);
        min-height: 100vh;
      }
      .container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 20px;
      }
      header {
        text-align: center;
        padding: 40px 0;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 20px;
        margin-bottom: 30px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      h1 {
        font-size: 3em;
        margin-bottom: 10px;
        background: linear-gradient(45deg, #6366f1, #8b5cf6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .tagline {
        font-size: 1.2em;
        color: #94a3b8;
        margin-bottom: 20px;
      }
      .stats-bar {
        display: flex;
        justify-content: center;
        gap: 30px;
        flex-wrap: wrap;
        margin-top: 20px;
      }
      .stat-item {
        text-align: center;
        padding: 15px 25px;
        background: var(--card-bg);
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .stat-number {
        font-size: 2em;
        font-weight: bold;
        color: var(--secondary);
      }
      .stat-label {
        font-size: 0.9em;
        color: #94a3b8;
        margin-top: 5px;
      }
      .dashboard {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-top: 30px;
      }
      @media (max-width: 1024px) {
        .dashboard {
          grid-template-columns: 1fr;
        }
      }
      .card {
        background: var(--card-bg);
        border-radius: 15px;
        padding: 25px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
      }
      .card-title {
        font-size: 1.5em;
        margin-bottom: 20px;
        color: #60a5fa;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .btn {
        background: linear-gradient(45deg, var(--primary), var(--primary-dark));
        color: white;
        padding: 12px 25px;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        font-weight: bold;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        transition: all 0.3s;
        text-decoration: none;
      }
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 20px rgba(99, 102, 241, 0.3);
      }
      .btn-success {
        background: linear-gradient(45deg, var(--secondary), #059669);
      }
      .btn-danger {
        background: linear-gradient(45deg, var(--danger), #dc2626);
      }
      .btn-warning {
        background: linear-gradient(45deg, var(--warning), #d97706);
      }
      .btn-group {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 15px;
      }
      .form-group {
        margin-bottom: 20px;
      }
      label {
        display: block;
        margin-bottom: 8px;
        color: #cbd5e1;
        font-weight: bold;
      }
      input, select, textarea {
        width: 100%;
        padding: 12px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: white;
        font-size: 16px;
      }
      input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: var(--primary);
      }
      .bot-list {
        max-height: 400px;
        overflow-y: auto;
      }
      .bot-item {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
        padding: 15px;
        margin-bottom: 10px;
        border-left: 4px solid var(--secondary);
      }
      .bot-item.disconnected {
        border-left-color: var(--danger);
      }
      .bot-item.connecting {
        border-left-color: var(--warning);
      }
      .bot-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .bot-name {
        font-weight: bold;
        font-size: 1.1em;
      }
      .status-badge {
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.8em;
        font-weight: bold;
      }
      .status-connected { background: var(--secondary); }
      .status-disconnected { background: var(--danger); }
      .status-connecting { background: var(--warning); }
      .bot-details {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        font-size: 0.9em;
        color: #94a3b8;
      }
      .command-palette {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 10px;
        margin-top: 15px;
      }
      .command-btn {
        background: rgba(99, 102, 241, 0.2);
        border: 1px solid rgba(99, 102, 241, 0.3);
        color: #c7d2fe;
        padding: 12px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s;
        text-align: center;
      }
      .command-btn:hover {
        background: rgba(99, 102, 241, 0.3);
        transform: translateY(-2px);
      }
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
        border-radius: 15px;
        min-width: 400px;
        max-width: 600px;
        width: 90%;
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
      .history-log {
        max-height: 300px;
        overflow-y: auto;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 8px;
        padding: 15px;
        font-family: 'Courier New', monospace;
        font-size: 0.9em;
      }
      .log-entry {
        padding: 5px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .log-time {
        color: #94a3b8;
        font-size: 0.8em;
      }
      .log-command { color: #60a5fa; }
      .log-chat { color: #34d399; }
      .log-error { color: #f87171; }
      .log-system { color: #fbbf24; }
      footer {
        text-align: center;
        margin-top: 40px;
        padding: 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        color: #64748b;
        font-size: 0.9em;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1><i class="fas fa-robot"></i> Minecraft Bot Commander</h1>
        <p class="tagline">Contrôlez vos bots Minecraft depuis votre navigateur</p>
        
        <div class="stats-bar">
          <div class="stat-item">
            <div class="stat-number" id="statBots">0</div>
            <div class="stat-label">Bots Actifs</div>
          </div>
          <div class="stat-item">
            <div class="stat-number" id="statCommands">0</div>
            <div class="stat-label">Commandes</div>
          </div>
          <div class="stat-item">
            <div class="stat-number" id="statUptime">0s</div>
            <div class="stat-label">Uptime</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">${commander.serverConfig.host}:${commander.serverConfig.port}</div>
            <div class="stat-label">Serveur Minecraft</div>
          </div>
        </div>
      </header>

      <div class="dashboard">
        <!-- Carte Configuration Serveur -->
        <div class="card">
          <div class="card-title"><i class="fas fa-server"></i> Configuration Serveur</div>
          <form id="serverConfigForm" onsubmit="return updateServerConfig(event)">
            <div class="form-group">
              <label><i class="fas fa-globe"></i> Adresse IP/Domaine</label>
              <input type="text" id="serverHost" value="${commander.serverConfig.host}" 
                     placeholder="Ex: localhost, mc.serveur.com, 192.168.1.100" required>
            </div>
            <div class="form-group">
              <label><i class="fas fa-plug"></i> Port</label>
              <input type="number" id="serverPort" value="${commander.serverConfig.port}" 
                     min="1" max="65535" required>
            </div>
            <div class="form-group">
              <label><i class="fas fa-code-branch"></i> Version Minecraft</label>
              <input type="text" id="serverVersion" value="${commander.serverConfig.version}" 
                     placeholder="Ex: 1.20.1, 1.19.4" required>
            </div>
            <div class="form-group">
              <label><i class="fas fa-robot"></i> Préfixe Bots</label>
              <input type="text" id="botPrefix" value="${commander.serverConfig.defaultBotPrefix}" 
                     placeholder="Ex: MyBot">
            </div>
            <button type="submit" class="btn btn-success">
              <i class="fas fa-save"></i> Sauvegarder & Appliquer
            </button>
            <div id="configStatus" style="margin-top: 15px; display: none;"></div>
          </form>
        </div>

        <!-- Carte Création de Bot -->
        <div class="card">
          <div class="card-title"><i class="fas fa-plus-circle"></i> Créer un Nouveau Bot</div>
          <form id="createBotForm" onsubmit="return createNewBot(event)">
            <div class="form-group">
              <label><i class="fas fa-signature"></i> Nom du Bot</label>
              <input type="text" id="botName" placeholder="Ex: Mineur, Garde, Explorateur" required>
            </div>
            <div class="form-group">
              <label><i class="fas fa-users"></i> Nombre de Bots</label>
              <input type="number" id="botCount" value="1" min="1" max="10">
            </div>
            <div class="form-group">
              <label><i class="fas fa-cogs"></i> Comportement Initial</label>
              <select id="botBehavior">
                <option value="passive">Passif (ne rien faire)</option>
                <option value="explore">Explorer aléatoirement</option>
                <option value="follow">Suivre les joueurs</option>
                <option value="mine">Miner automatiquement</option>
              </select>
            </div>
            <button type="submit" class="btn">
              <i class="fas fa-magic"></i> Créer le(s) Bot(s)
            </button>
          </form>
        </div>

        <!-- Carte Liste des Bots -->
        <div class="card" style="grid-column: span 2;">
          <div class="card-title"><i class="fas fa-list"></i> Bots Connectés</div>
          <div class="bot-list" id="botsList">
            <!-- Rempli par JavaScript -->
          </div>
          <div class="btn-group">
            <button class="btn btn-danger" onclick="stopAllBots()">
              <i class="fas fa-stop"></i> Tout Arrêter
            </button>
            <button class="btn" onclick="showModal('commandModal')">
              <i class="fas fa-terminal"></i> Commander un Bot
            </button>
            <button class="btn" onclick="showModal('historyModal')">
              <i class="fas fa-history"></i> Historique
            </button>
            <a href="/dashboard" class="btn">
              <i class="fas fa-tachometer-alt"></i> Dashboard Complet
            </a>
          </div>
        </div>
      </div>

      <!-- Carte Commandes Rapides -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-title"><i class="fas fa-gamepad"></i> Commandes Rapides</div>
        <div class="command-palette" id="quickCommands">
          <!-- Rempli par JavaScript -->
        </div>
      </div>

      <footer>
        <p>Minecraft Bot Commander v2.0.0 | Développé avec Node.js & Mineflayer</p>
        <p>Serveur actuel: <strong>${commander.serverConfig.host}:${commander.serverConfig.port}</strong> | Bots maximum: ${commander.serverConfig.maxBots}</p>
        ${isRender ? `<p>🚀 Hébergé sur Render.com | URL: ${externalUrl}</p>` : ''}
      </footer>
    </div>

    <!-- Modal Commander un Bot -->
    <div id="commandModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2><i class="fas fa-terminal"></i> Commander un Bot</h2>
          <button class="close-btn" onclick="hideModal('commandModal')">×</button>
        </div>
        <form id="commandForm" onsubmit="return executeCustomCommand(event)">
          <div class="form-group">
            <label>Sélectionner un Bot</label>
            <select id="commandBot" required>
              <option value="">-- Choisir un bot --</option>
            </select>
          </div>
          <div class="form-group">
            <label>Commande</label>
            <select id="commandType" required onchange="updateCommandParams()">
              <option value="">-- Choisir une commande --</option>
              <option value="chat">Envoyer un message</option>
              <option value="move">Se déplacer</option>
              <option value="follow">Suivre un joueur</option>
              <option value="jump">Sauter</option>
              <option value="look">Regarder autour</option>
              <option value="stop">Arrêter</option>
              <option value="inventory">Voir l'inventaire</option>
              <option value="attack">Attaquer une cible</option>
            </select>
          </div>
          <div id="commandParams">
            <!-- Paramètres dynamiques -->
          </div>
          <button type="submit" class="btn" style="width: 100%;">
            <i class="fas fa-play"></i> Exécuter la Commande
          </button>
        </form>
      </div>
    </div>

    <!-- Modal Historique -->
    <div id="historyModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2><i class="fas fa-history"></i> Historique des Commandes</h2>
          <button class="close-btn" onclick="hideModal('historyModal')">×</button>
        </div>
        <div class="history-log" id="historyLog">
          <!-- Rempli par JavaScript -->
        </div>
      </div>
    </div>

    <script>
      let selectedBotId = null;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(wsProtocol + '//' + window.location.host + '/socket.io/?EIO=4&transport=websocket');

      // Fonctions modales
      function showModal(modalId) {
        document.getElementById(modalId).style.display = 'flex';
        if (modalId === 'commandModal') {
          loadBotsForCommand();
        } else if (modalId === 'historyModal') {
          loadHistory();
        }
      }

      function hideModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
      }

      // Mettre à jour les statistiques
      async function updateStats() {
        try {
          const response = await fetch('/api/stats');
          const stats = await response.json();
          
          document.getElementById('statBots').textContent = stats.activeBots;
          document.getElementById('statCommands').textContent = stats.commandsExecuted;
          document.getElementById('statUptime').textContent = stats.uptime + 's';
          
        } catch (error) {
          console.error('Erreur stats:', error);
        }
      }

      // Charger la liste des bots
      async function loadBots() {
        try {
          const response = await fetch('/api/bots');
          const bots = await response.json();
          
          const botsList = document.getElementById('botsList');
          botsList.innerHTML = '';
          
          if (bots.length === 0) {
            botsList.innerHTML = '<div style="text-align: center; padding: 30px; color: #94a3b8;">Aucun bot connecté</div>';
            return;
          }
          
          bots.forEach(bot => {
            const statusClass = bot.status === 'connected' ? '' : 
                              bot.status === 'connecting' ? 'connecting' : 'disconnected';
            
            const botItem = document.createElement('div');
            botItem.className = `bot-item ${statusClass}`;
            botItem.innerHTML = \`
              <div class="bot-header">
                <div class="bot-name">
                  <i class="fas fa-robot"></i> \${bot.name}
                  <span class="status-badge status-\${bot.status}">\${bot.status}</span>
                </div>
                <div>
                  <button class="btn" onclick="controlBot('\${bot.id}')" style="padding: 5px 10px; font-size: 12px;">
                    <i class="fas fa-gamepad"></i>
                  </button>
                  <button class="btn btn-danger" onclick="removeBot('\${bot.id}')" style="padding: 5px 10px; font-size: 12px;">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
              <div class="bot-details">
                <div>
                  <i class="fas fa-map-marker-alt"></i>
                  \${bot.position.x}, \${bot.position.y}, \${bot.position.z}
                </div>
                <div>
                  <i class="fas fa-heart"></i> PV: \${bot.health}
                </div>
                <div>
                  <i class="fas fa-utensils"></i> Nourriture: \${bot.food}
                </div>
                <div>
                  <i class="fas fa-clock"></i> Connecté: \${Math.floor(bot.uptime / 1000)}s
                </div>
                <div>
                  <i class="fas fa-running"></i> Activité: \${bot.activity}
                </div>
                <div>
                  <i class="fas fa-server"></i> \${bot.server}
                </div>
              </div>
            \`;
            botsList.appendChild(botItem);
          });
          
          // Mettre à jour les commandes rapides
          updateQuickCommands(bots);
          
        } catch (error) {
          console.error('Erreur chargement bots:', error);
        }
      }

      // Mettre à jour les commandes rapides
      function updateQuickCommands(bots) {
        const quickCommands = document.getElementById('quickCommands');
        quickCommands.innerHTML = '';
        
        const commands = [
          { icon: 'fa-comment', text: 'Dire Bonjour', action: () => quickCommand('chat', 'Bonjour à tous!') },
          { icon: 'fa-random', text: 'Explorer', action: () => quickCommand('explore') },
          { icon: 'fa-users', text: 'Suivre Joueurs', action: () => quickCommand('follow') },
          { icon: 'fa-pickaxe', text: 'Miner', action: () => quickCommand('mine') },
          { icon: 'fa-stop', text: 'Tout Arrêter', action: () => quickCommand('stop') },
          { icon: 'fa-jump', text: 'Sauter Tous', action: () => quickCommand('jump') },
          { icon: 'fa-search', text: 'Regarder Autour', action: () => quickCommand('look') },
          { icon: 'fa-broadcast', text: 'Message Global', action: () => {
            const msg = prompt('Message à envoyer:');
            if (msg) quickCommand('chat', msg);
          }}
        ];
        
        commands.forEach(cmd => {
          const btn = document.createElement('div');
          btn.className = 'command-btn';
          btn.innerHTML = \`<i class="fas \${cmd.icon}"></i> \${cmd.text}\`;
          btn.onclick = cmd.action;
          quickCommands.appendChild(btn);
        });
      }

      // Commande rapide sur tous les bots
      async function quickCommand(command, param = null) {
        const bots = await fetch('/api/bots').then(r => r.json());
        const connectedBots = bots.filter(b => b.status === 'connected');
        
        if (connectedBots.length === 0) {
          alert('Aucun bot connecté!');
          return;
        }
        
        for (const bot of connectedBots) {
          let params = {};
          if (command === 'chat' && param) {
            params.message = param;
          } else if (command === 'explore') {
            params.x = bot.position.x + (Math.random() * 40 - 20);
            params.z = bot.position.z + (Math.random() * 40 - 20);
            command = 'move';
          } else if (command === 'follow') {
            params.player = prompt('Nom du joueur à suivre:');
            if (!params.player) continue;
          }
          
          await fetch(\`/api/bots/\${bot.id}/command\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, params })
          });
        }
        
        loadBots();
      }

      // Mettre à jour la configuration du serveur
      async function updateServerConfig(event) {
        event.preventDefault();
        
        const host = document.getElementById('serverHost').value;
        const port = document.getElementById('serverPort').value;
        const version = document.getElementById('serverVersion').value;
        const prefix = document.getElementById('botPrefix').value;
        
        const configStatus = document.getElementById('configStatus');
        configStatus.style.display = 'block';
        configStatus.innerHTML = '<div style="color: #fbbf24;"><i class="fas fa-spinner fa-spin"></i> Mise à jour en cours...</div>';
        
        try {
          const response = await fetch('/api/server/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, version, defaultBotPrefix: prefix })
          });
          
          const result = await response.json();
          
          if (result.success) {
            configStatus.innerHTML = '<div style="color: #10b981;"><i class="fas fa-check-circle"></i> Configuration mise à jour!</div>';
            setTimeout(() => {
              configStatus.style.display = 'none';
              location.reload();
            }, 2000);
          } else {
            configStatus.innerHTML = \`<div style="color: #ef4444;"><i class="fas fa-exclamation-circle"></i> Erreur: \${result.error}</div>\`;
          }
          
        } catch (error) {
          configStatus.innerHTML = \`<div style="color: #ef4444;"><i class="fas fa-exclamation-circle"></i> Erreur: \${error.message}</div>\`;
        }
      }

      // Créer un nouveau bot
      async function createNewBot(event) {
        event.preventDefault();
        
        const name = document.getElementById('botName').value;
        const count = parseInt(document.getElementById('botCount').value) || 1;
        const behavior = document.getElementById('botBehavior').value;
        
        for (let i = 0; i < count; i++) {
          const botName = count === 1 ? name : \`\${name}\${i+1}\`;
          
          try {
            const response = await fetch('/api/bots/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                name: botName, 
                behavior,
                server: commander.serverConfig
              })
            });
            
            const result = await response.json();
            if (result.success) {
              console.log(\`Bot \${botName} créé\`);
            }
            
            // Attente entre chaque création
            await new Promise(resolve => setTimeout(resolve, 1000));
            
          } catch (error) {
            alert(\`Erreur création bot \${botName}: \${error.message}\`);
          }
        }
        
        document.getElementById('botName').value = '';
        setTimeout(loadBots, 2000);
      }

      // Contrôler un bot spécifique
      function controlBot(botId) {
        selectedBotId = botId;
        showModal('commandModal');
      }

      // Charger les bots pour la sélection
      async function loadBotsForCommand() {
        const select = document.getElementById('commandBot');
        select.innerHTML = '<option value="">-- Choisir un bot --</option>';
        
        const bots = await fetch('/api/bots').then(r => r.json());
        bots.forEach(bot => {
          if (bot.status === 'connected') {
            const option = document.createElement('option');
            option.value = bot.id;
            option.textContent = \`\${bot.name} (\${bot.position.x}, \${bot.position.y}, \${bot.position.z})\`;
            select.appendChild(option);
          }
        });
      }

      // Mettre à jour les paramètres de commande
      function updateCommandParams() {
        const commandType = document.getElementById('commandType').value;
        const paramsDiv = document.getElementById('commandParams');
        
        let html = '';
        
        switch(commandType) {
          case 'chat':
            html = \`
              <div class="form-group">
                <label>Message</label>
                <input type="text" id="paramMessage" placeholder="Entrez votre message..." required>
              </div>
            \`;
            break;
          case 'move':
            html = \`
              <div class="form-group">
                <label>Coordonnées</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                  <input type="number" id="paramX" placeholder="X" required>
                  <input type="number" id="paramY" placeholder="Y" required>
                  <input type="number" id="paramZ" placeholder="Z" required>
                </div>
              </div>
            \`;
            break;
          case 'follow':
            html = \`
              <div class="form-group">
                <label>Nom du Joueur</label>
                <input type="text" id="paramPlayer" placeholder="Nom exact du joueur" required>
              </div>
            \`;
            break;
          case 'attack':
            html = \`
              <div class="form-group">
                <label>Nom de la Cible</label>
                <input type="text" id="paramTarget" placeholder="Nom du monstre/joueur" required>
              </div>
            \`;
            break;
          default:
            html = '';
        }
        
        paramsDiv.innerHTML = html;
      }

      // Exécuter une commande personnalisée
      async function executeCustomCommand(event) {
        event.preventDefault();
        
        const botId = document.getElementById('commandBot').value;
        const command = document.getElementById('commandType').value;
        
        if (!botId || !command) {
          alert('Veuillez sélectionner un bot et une commande');
          return;
        }
        
        let params = {};
        
        switch(command) {
          case 'chat':
            params.message = document.getElementById('paramMessage').value;
            break;
          case 'move':
            params.x = parseInt(document.getElementById('paramX').value);
            params.y = parseInt(document.getElementById('paramY').value);
            params.z = parseInt(document.getElementById('paramZ').value);
            break;
          case 'follow':
            params.player = document.getElementById('paramPlayer').value;
            break;
          case 'attack':
            params.target = document.getElementById('paramTarget').value;
            break;
        }
        
        try {
          const response = await fetch(\`/api/bots/\${botId}/command\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, params })
          });
          
          const result = await response.json();
          
          if (result.success) {
            alert(\`✅ Commande exécutée: \${result.message}\`);
            hideModal('commandModal');
            loadBots();
          } else {
            alert(\`❌ Erreur: \${result.error}\`);
          }
          
        } catch (error) {
          alert(\`❌ Erreur: \${error.message}\`);
        }
      }

      // Supprimer un bot
      async function removeBot(botId) {
        if (confirm('Supprimer ce bot?')) {
          await fetch(\`/api/bots/\${botId}\`, { method: 'DELETE' });
          loadBots();
        }
      }

      // Arrêter tous les bots
      async function stopAllBots() {
        if (confirm('Arrêter tous les bots?')) {
          await fetch('/api/bots/stop', { method: 'POST' });
          loadBots();
        }
      }

      // Charger l'historique
      async function loadHistory() {
        const response = await fetch('/api/history');
        const history = await response.json();
        
        const historyLog = document.getElementById('historyLog');
        historyLog.innerHTML = '';
        
        history.forEach(entry => {
          const div = document.createElement('div');
          div.className = 'log-entry';
          
          const time = new Date(entry.timestamp).toLocaleTimeString();
          let content = '';
          
          switch(entry.type) {
            case 'command':
              content = \`<span class="log-command">[CMD] \${entry.message}</span>\`;
              break;
            case 'chat':
              content = \`<span class="log-chat">[CHAT] \${entry.message}</span>\`;
              break;
            case 'system':
              content = \`<span class="log-system">[SYS] \${entry.message}</span>\`;
              break;
            case 'error':
              content = \`<span class="log-error">[ERR] \${entry.message}</span>\`;
              break;
          }
          
          div.innerHTML = \`
            <span class="log-time">\${time}</span>
            \${content}
            <span style="color: #64748b; float: right;">(\${entry.botCount} bots)</span>
          \`;
          historyLog.appendChild(div);
        });
      }

      // WebSocket pour mises à jour en temps réel
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data.slice(1));
          if (data.type === 'botUpdate') {
            loadBots();
            updateStats();
          }
        } catch (e) {
          // Ignorer les messages non JSON
        }
      };

      // Mettre à jour périodiquement
      setInterval(loadBots, 3000);
      setInterval(updateStats, 5000);

      // Initialisation
      loadBots();
      updateStats();
      
      // Fonction pour formater le temps
      function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
          return \`\${hours}h \${minutes}m\`;
        } else if (minutes > 0) {
          return \`\${minutes}m \${secs}s\`;
        } else {
          return \`\${secs}s\`;
        }
      }
    </script>
  </body>
  </html>
  `);
});

// ==============================
// DASHBOARD COMPLET
// ==============================
app.get('/dashboard', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard Complet - Minecraft Bot Commander</title>
    <style>
      /* Mêmes styles que la page d'accueil */
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        margin: 0;
        padding: 0;
      }
      .dashboard-container {
        display: grid;
        grid-template-columns: 250px 1fr;
        min-height: 100vh;
      }
      .sidebar {
        background: #1e293b;
        padding: 20px;
        border-right: 1px solid #334155;
      }
      .sidebar-header {
        text-align: center;
        padding: 20px 0;
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
        padding: 20px;
        overflow-y: auto;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
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
        margin-bottom: 15px;
        color: #60a5fa;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      th, td {
        padding: 10px;
        border-bottom: 1px solid #334155;
        text-align: left;
      }
      th {
        background: #334155;
        color: #60a5fa;
      }
    </style>
  </head>
  <body>
    <div class="dashboard-container">
      <div class="sidebar">
        <div class="sidebar-header">
          <h2>🤖 Bot Commander</h2>
          <p>Dashboard Complet</p>
        </div>
        <a href="/" class="nav-item">
          <i class="fas fa-home"></i> Accueil
        </a>
        <a href="/dashboard" class="nav-item active">
          <i class="fas fa-tachometer-alt"></i> Dashboard
        </a>
        <div class="nav-item">
          <i class="fas fa-robot"></i> Bots: <span id="sidebarBots">0</span>
        </div>
        <div class="nav-item">
          <i class="fas fa-server"></i> ${commander.serverConfig.host}:${commander.serverConfig.port}
        </div>
      </div>
      
      <div class="main-content">
        <h1>Dashboard Complet</h1>
        <p>Interface avancée de contrôle des bots Minecraft</p>
        
        <div class="grid">
          <!-- Les mêmes cartes que sur la page d'accueil -->
        </div>
        
        <script>
          // Mêmes fonctions que sur la page d'accueil
        </script>
      </div>
    </div>
  </body>
  </html>
  `);
});

// ==============================
// API ROUTES
// ==============================
app.get('/api/stats', (req, res) => {
  const uptime = Math.floor((Date.now() - commander.stats.startTime) / 1000);
  res.json({
    ...commander.stats,
    uptime,
    serverConfig: commander.serverConfig
  });
});

app.get('/api/bots', (req, res) => {
  res.json(commander.getAllBots());
});

app.get('/api/bots/:id', (req, res) => {
  const bot = commander.bots.get(req.params.id);
  const data = commander.botData.get(req.params.id);
  
  if (bot && data) {
    res.json({ bot: data, rawBot: bot ? 'connected' : 'disconnected' });
  } else {
    res.status(404).json({ error: 'Bot non trouvé' });
  }
});

app.post('/api/bots/create', (req, res) => {
  const { name, behavior } = req.body;
  const id = commander.bots.size;
  const bot = commander.createBot(id, name);
  
  if (bot) {
    io.emit('botUpdate', { type: 'created', id, name });
    res.json({ success: true, id, name, behavior });
  } else {
    res.status(500).json({ error: 'Erreur création bot' });
  }
});

app.post('/api/bots/:id/command', async (req, res) => {
  const { command, params = {} } = req.body;
  const result = await commander.executeCommand(req.params.id, command, params);
  
  if (result.success) {
    io.emit('botUpdate', { 
      type: 'command', 
      id: req.params.id, 
      command, 
      params,
      message: result.message 
    });
  }
  
  res.json(result);
});

app.post('/api/server/config', (req, res) => {
  const { host, port, version, defaultBotPrefix } = req.body;
  
  if (!host || !port || !version) {
    return res.status(400).json({ error: 'Host, port et version requis' });
  }
  
  try {
    const config = commander.updateServerConfig(host, port, version);
    if (defaultBotPrefix) {
      commander.serverConfig.defaultBotPrefix = defaultBotPrefix;
      commander.saveServerConfig();
    }
    
    io.emit('serverConfigUpdate', config);
    res.json({ success: true, config });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/server/config', (req, res) => {
  res.json(commander.serverConfig);
});

app.get('/api/history', (req, res) => {
  res.json(commander.commandHistory);
});

app.delete('/api/bots/:id', (req, res) => {
  const success = commander.removeBot(req.params.id);
  
  if (success) {
    io.emit('botUpdate', { type: 'removed', id: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Bot non trouvé' });
  }
});

app.post('/api/bots/stop', (req, res) => {
  commander.stopAllBots();
  io.emit('allBotsStopped');
  res.json({ success: true });
});

// ==============================
// DÉMARRAGE DU SERVEUR
// ==============================
const startServer = () => {
  server.listen(options.port, options.host, () => {
    console.log(chalk.green(`
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║     🤖 Minecraft Bot Commander v2.0.0 🤖                 ║
    ║                                                          ║
    ║     Interface web complète de commande des bots          ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
    `));
    
    console.log(chalk.cyan(`🌐 Serveur web: http://${options.host}:${options.port}`));
    console.log(chalk.cyan(`🎮 Interface: http://${options.host}:${options.port}/`));
    console.log(chalk.blue(`⚙️ Serveur Minecraft: ${commander.serverConfig.host}:${commander.serverConfig.port}`));
    console.log(chalk.green(`✅ Prêt à recevoir des connexions`));
    
    if (process.env.RENDER) {
      console.log(chalk.magenta('🚀 Déployé sur Render.com'));
    }
    
    // Créer un bot de démonstration au démarrage
    if (options.dev) {
      console.log(chalk.yellow('🤖 Création bot de démonstration...'));
      setTimeout(() => {
        commander.createBot(0, 'DemoBot');
      }, 2000);
    }
  });
};

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n🛑 Arrêt en cours...'));
  commander.stopAllBots();
  io.close();
  server.close(() => {
    console.log(chalk.green('✅ Serveur arrêté proprement'));
    process.exit(0);
  });
});

// Démarrer le serveur
startServer();

module.exports = { app, server, commander };
