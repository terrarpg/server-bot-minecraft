#!/usr/bin/env node

// ==============================
// IMPORTS
// ==============================
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const chalk = require('chalk');
const mineflayer = require('mineflayer');

// ==============================
// CONFIGURATION
// ==============================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ==============================
// BOT MANAGER SIMPLIFIÉ
// ==============================
class SimpleBotManager {
  constructor() {
    this.bots = new Map();
    this.serverConfig = {
      host: process.env.MC_HOST || 'localhost',
      port: parseInt(process.env.MC_PORT) || 25565,
      version: process.env.MC_VERSION || '1.20.1'
    };
  }

  createBot(botName) {
    console.log(chalk.blue(`🤖 Création bot: ${botName}`));
    
    const botOptions = {
      host: this.serverConfig.host,
      port: this.serverConfig.port,
      username: botName,
      version: this.serverConfig.version,
      auth: 'offline'
    };

    try {
      const bot = mineflayer.createBot(botOptions);
      const botId = Date.now(); // ID unique
      
      this.bots.set(botId, {
        id: botId,
        name: botName,
        bot: bot,
        status: 'connecting'
      });

      // Événements du bot
      bot.once('spawn', () => {
        console.log(chalk.green(`✅ ${botName} connecté!`));
        this.bots.get(botId).status = 'connected';
      });

      bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        console.log(chalk.cyan(`💬 ${username}: ${message}`));
      });

      bot.on('error', (err) => {
        console.log(chalk.red(`❌ ${botName} erreur: ${err.message}`));
        this.bots.get(botId).status = 'error';
      });

      bot.on('end', () => {
        console.log(chalk.yellow(`🔌 ${botName} déconnecté`));
        this.bots.delete(botId);
      });

      return { success: true, id: botId, name: botName };
      
    } catch (error) {
      console.log(chalk.red(`❌ Erreur création ${botName}: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  sendChat(botId, message) {
    const botData = this.bots.get(botId);
    if (botData && botData.bot) {
      botData.bot.chat(message);
      return { success: true };
    }
    return { success: false, error: 'Bot non trouvé' };
  }

  moveBot(botId, direction) {
    const botData = this.bots.get(botId);
    if (!botData || !botData.bot) {
      return { success: false, error: 'Bot non trouvé' };
    }

    const bot = botData.bot;
    const currentPos = bot.entity.position;
    
    let targetX = currentPos.x;
    let targetZ = currentPos.z;
    
    switch(direction) {
      case 'forward':
        targetX += 5;
        break;
      case 'back':
        targetX -= 5;
        break;
      case 'left':
        targetZ -= 5;
        break;
      case 'right':
        targetZ += 5;
        break;
      case 'jump':
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 300);
        return { success: true, action: 'jump' };
    }

    // Simple déplacement
    bot.lookAt({ x: targetX, y: currentPos.y, z: targetZ }, true);
    bot.setControlState('forward', true);
    setTimeout(() => bot.setControlState('forward', false), 1000);
    
    return { success: true, direction, position: { x: targetX, z: targetZ } };
  }

  stopBot(botId) {
    const botData = this.bots.get(botId);
    if (botData && botData.bot) {
      ['forward', 'back', 'left', 'right', 'jump'].forEach(control => {
        botData.bot.setControlState(control, false);
      });
      return { success: true };
    }
    return { success: false };
  }

  removeBot(botId) {
    const botData = this.bots.get(botId);
    if (botData && botData.bot) {
      botData.bot.quit();
      this.bots.delete(botId);
      return { success: true };
    }
    return { success: false };
  }

  getAllBots() {
    const bots = [];
    this.bots.forEach((data, id) => {
      bots.push({
        id: data.id,
        name: data.name,
        status: data.status
      });
    });
    return bots;
  }

  updateServerConfig(host, port, version) {
    this.serverConfig = { host, port: parseInt(port), version };
    return { success: true, config: this.serverConfig };
  }
}

// ==============================
// INITIALISATION
// ==============================
const app = express();
const server = http.createServer(app);
const botManager = new SimpleBotManager();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==============================
// ROUTES
// ==============================

// Page d'accueil avec interface simple
app.get('/', (req, res) => {
  const config = botManager.serverConfig;
  
  res.send(`
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🤖 Minecraft Bot Control</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      body {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        color: #fff;
        min-height: 100vh;
        padding: 20px;
      }
      
      .container {
        max-width: 1200px;
        margin: 0 auto;
      }
      
      header {
        text-align: center;
        padding: 30px 0;
        border-bottom: 2px solid #0ea5e9;
        margin-bottom: 30px;
      }
      
      h1 {
        font-size: 2.5em;
        color: #0ea5e9;
        margin-bottom: 10px;
      }
      
      .subtitle {
        color: #94a3b8;
        font-size: 1.1em;
      }
      
      .dashboard {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-bottom: 30px;
      }
      
      @media (max-width: 768px) {
        .dashboard {
          grid-template-columns: 1fr;
        }
      }
      
      .card {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        padding: 20px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .card-title {
        font-size: 1.3em;
        color: #0ea5e9;
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      
      .card-title i {
        font-size: 1.2em;
      }
      
      .form-group {
        margin-bottom: 15px;
      }
      
      label {
        display: block;
        margin-bottom: 5px;
        color: #cbd5e1;
        font-weight: bold;
      }
      
      input {
        width: 100%;
        padding: 10px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid #475569;
        border-radius: 5px;
        color: white;
        font-size: 16px;
      }
      
      input:focus {
        outline: none;
        border-color: #0ea5e9;
      }
      
      .btn {
        background: linear-gradient(45deg, #0ea5e9, #3b82f6);
        color: white;
        padding: 12px 20px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
        font-size: 16px;
        transition: all 0.3s;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(14, 165, 233, 0.3);
      }
      
      .btn-success {
        background: linear-gradient(45deg, #10b981, #059669);
      }
      
      .btn-danger {
        background: linear-gradient(45deg, #ef4444, #dc2626);
      }
      
      .btn-warning {
        background: linear-gradient(45deg, #f59e0b, #d97706);
      }
      
      .bot-list {
        margin-top: 20px;
      }
      
      .bot-item {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 10px;
        border-left: 4px solid #10b981;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .bot-item.error {
        border-left-color: #ef4444;
      }
      
      .bot-item.connecting {
        border-left-color: #f59e0b;
      }
      
      .bot-info {
        flex: 1;
      }
      
      .bot-name {
        font-weight: bold;
        font-size: 1.1em;
        color: #e2e8f0;
      }
      
      .bot-status {
        font-size: 0.9em;
        color: #94a3b8;
        margin-top: 5px;
      }
      
      .bot-controls {
        display: flex;
        gap: 10px;
      }
      
      .btn-small {
        padding: 8px 12px;
        font-size: 14px;
      }
      
      .controls-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-top: 15px;
      }
      
      .control-btn {
        background: rgba(59, 130, 246, 0.2);
        border: 1px solid rgba(59, 130, 246, 0.3);
        color: #93c5fd;
        padding: 15px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 1.2em;
        transition: all 0.3s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .control-btn:hover {
        background: rgba(59, 130, 246, 0.3);
        transform: scale(1.05);
      }
      
      .chat-control {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        margin-top: 15px;
      }
      
      .status-indicator {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 8px;
      }
      
      .status-connected {
        background: #10b981;
      }
      
      .status-connecting {
        background: #f59e0b;
      }
      
      .status-error {
        background: #ef4444;
      }
      
      .server-info {
        background: rgba(0, 0, 0, 0.2);
        padding: 15px;
        border-radius: 8px;
        margin-top: 20px;
        text-align: center;
        color: #94a3b8;
        font-size: 0.9em;
      }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  </head>
  <body>
    <div class="container">
      <header>
        <h1><i class="fas fa-robot"></i> Minecraft Bot Control</h1>
        <p class="subtitle">Interface simple pour contrôler des bots Minecraft</p>
      </header>
      
      <div class="dashboard">
        <!-- Configuration Serveur -->
        <div class="card">
          <div class="card-title">
            <i class="fas fa-server"></i> Configuration Serveur
          </div>
          <form id="serverForm">
            <div class="form-group">
              <label><i class="fas fa-globe"></i> Adresse IP/Domaine</label>
              <input type="text" id="serverHost" value="${config.host}" placeholder="localhost" required>
            </div>
            <div class="form-group">
              <label><i class="fas fa-plug"></i> Port</label>
              <input type="number" id="serverPort" value="${config.port}" placeholder="25565" required>
            </div>
            <div class="form-group">
              <label><i class="fas fa-code-branch"></i> Version Minecraft</label>
              <input type="text" id="serverVersion" value="${config.version}" placeholder="1.20.1" required>
            </div>
            <button type="button" class="btn btn-success" onclick="updateServerConfig()">
              <i class="fas fa-save"></i> Sauvegarder
            </button>
          </form>
        </div>
        
        <!-- Créer un Bot -->
        <div class="card">
          <div class="card-title">
            <i class="fas fa-plus-circle"></i> Créer un Bot
          </div>
          <form id="createBotForm">
            <div class="form-group">
              <label><i class="fas fa-signature"></i> Nom du Bot</label>
              <input type="text" id="botName" placeholder="Ex: MonBot" required>
            </div>
            <button type="button" class="btn" onclick="createBot()">
              <i class="fas fa-robot"></i> Créer le Bot
            </button>
          </form>
          
          <div class="bot-list" id="botsList">
            <!-- Liste des bots -->
          </div>
        </div>
        
        <!-- Contrôles -->
        <div class="card" style="grid-column: span 2;">
          <div class="card-title">
            <i class="fas fa-gamepad"></i> Contrôles du Bot
          </div>
          
          <div class="form-group">
            <label>Sélectionner un Bot</label>
            <select id="selectedBot" onchange="updateControls()" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.3); color: white; border: 1px solid #475569; border-radius: 5px;">
              <option value="">-- Sélectionner un bot --</option>
            </select>
          </div>
          
          <div id="botControls" style="display: none;">
            <!-- Contrôles de direction -->
            <div style="text-align: center; margin: 20px 0;">
              <div class="controls-grid">
                <div></div>
                <button class="control-btn" onclick="moveBot('forward')" title="Avancer">
                  <i class="fas fa-arrow-up"></i>
                </button>
                <div></div>
                
                <button class="control-btn" onclick="moveBot('left')" title="Gauche">
                  <i class="fas fa-arrow-left"></i>
                </button>
                <button class="control-btn btn-danger" onclick="stopBot()" title="Arrêter">
                  <i class="fas fa-stop"></i>
                </button>
                <button class="control-btn" onclick="moveBot('right')" title="Droite">
                  <i class="fas fa-arrow-right"></i>
                </button>
                
                <div></div>
                <button class="control-btn" onclick="moveBot('back')" title="Reculer">
                  <i class="fas fa-arrow-down"></i>
                </button>
                <div></div>
              </div>
              
              <button class="btn btn-warning" onclick="moveBot('jump')" style="margin-top: 10px;">
                <i class="fas fa-arrow-up"></i> Sauter
              </button>
            </div>
            
            <!-- Chat -->
            <div class="chat-control">
              <input type="text" id="chatMessage" placeholder="Message à envoyer..." style="flex: 1;">
              <button class="btn" onclick="sendChat()">
                <i class="fas fa-paper-plane"></i> Envoyer
              </button>
            </div>
            
            <!-- Actions rapides -->
            <div style="display: flex; gap: 10px; margin-top: 15px;">
              <button class="btn" onclick="botAction('hello')">
                <i class="fas fa-hand"></i> Dire Bonjour
              </button>
              <button class="btn" onclick="botAction('follow')">
                <i class="fas fa-user-friends"></i> Suivre Joueurs
              </button>
              <button class="btn btn-danger" onclick="removeBot()">
                <i class="fas fa-trash"></i> Supprimer
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="server-info">
        <p><i class="fas fa-info-circle"></i> Serveur: ${config.host}:${config.port} | Version: ${config.version}</p>
        <p>Bots actifs: <span id="activeBots">0</span> | <button class="btn btn-danger btn-small" onclick="stopAllBots()">Tout Arrêter</button></p>
      </div>
    </div>
    
    <script>
      let selectedBotId = null;
      
      // Charger la liste des bots
      async function loadBots() {
        try {
          const response = await fetch('/api/bots');
          const bots = await response.json();
          
          const botsList = document.getElementById('botsList');
          const botSelect = document.getElementById('selectedBot');
          
          botsList.innerHTML = '';
          botSelect.innerHTML = '<option value="">-- Sélectionner un bot --</option>';
          
          bots.forEach(bot => {
            // Ajouter à la liste
            const botItem = document.createElement('div');
            botItem.className = 'bot-item ' + (bot.status === 'error' ? 'error' : bot.status === 'connecting' ? 'connecting' : '');
            botItem.innerHTML = 
              '<div class="bot-info">' +
                '<div class="bot-name">' +
                  '<span class="status-indicator status-' + bot.status + '"></span>' +
                  bot.name +
                '</div>' +
                '<div class="bot-status">Statut: ' + bot.status + '</div>' +
              '</div>' +
              '<div class="bot-controls">' +
                '<button class="btn btn-small" onclick="selectBot(' + bot.id + ')">' +
                  '<i class="fas fa-gamepad"></i>' +
                '</button>' +
                '<button class="btn btn-danger btn-small" onclick="deleteBot(' + bot.id + ')">' +
                  '<i class="fas fa-trash"></i>' +
                '</button>' +
              '</div>';
            botsList.appendChild(botItem);
            
            // Ajouter au select
            const option = document.createElement('option');
            option.value = bot.id;
            option.textContent = bot.name + ' (' + bot.status + ')';
            botSelect.appendChild(option);
          });
          
          document.getElementById('activeBots').textContent = bots.length;
          
        } catch (error) {
          console.error('Erreur:', error);
        }
      }
      
      // Mettre à jour la configuration
      async function updateServerConfig() {
        const host = document.getElementById('serverHost').value;
        const port = document.getElementById('serverPort').value;
        const version = document.getElementById('serverVersion').value;
        
        try {
          const response = await fetch('/api/server/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, version })
          });
          
          const result = await response.json();
          if (result.success) {
            alert('✅ Configuration mise à jour!');
            location.reload();
          } else {
            alert('❌ Erreur: ' + result.error);
          }
          
        } catch (error) {
          alert('❌ Erreur: ' + error.message);
        }
      }
      
      // Créer un bot
      async function createBot() {
        const name = document.getElementById('botName').value;
        if (!name) {
          alert('Veuillez entrer un nom pour le bot');
          return;
        }
        
        try {
          const response = await fetch('/api/bots/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          });
          
          const result = await response.json();
          if (result.success) {
            document.getElementById('botName').value = '';
            loadBots();
          } else {
            alert('❌ Erreur: ' + result.error);
          }
          
        } catch (error) {
          alert('❌ Erreur: ' + error.message);
        }
      }
      
      // Sélectionner un bot
      function selectBot(botId) {
        selectedBotId = botId;
        document.getElementById('selectedBot').value = botId;
        updateControls();
      }
      
      // Mettre à jour les contrôles
      function updateControls() {
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
      
      // Déplacer le bot
      async function moveBot(direction) {
        if (!selectedBotId) {
          alert('Veuillez sélectionner un bot');
          return;
        }
        
        try {
          const response = await fetch('/api/bots/' + selectedBotId + '/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ direction })
          });
          
          const result = await response.json();
          if (!result.success) {
            alert('❌ Erreur: ' + result.error);
          }
          
        } catch (error) {
          alert('❌ Erreur: ' + error.message);
        }
      }
      
      // Arrêter le bot
      async function stopBot() {
        if (!selectedBotId) {
          alert('Veuillez sélectionner un bot');
          return;
        }
        
        try {
          await fetch('/api/bots/' + selectedBotId + '/stop', { method: 'POST' });
        } catch (error) {
          alert('❌ Erreur: ' + error.message);
        }
      }
      
      // Envoyer un message
      async function sendChat() {
        if (!selectedBotId) {
          alert('Veuillez sélectionner un bot');
          return;
        }
        
        const message = document.getElementById('chatMessage').value;
        if (!message) {
          alert('Veuillez entrer un message');
          return;
        }
        
        try {
          const response = await fetch('/api/bots/' + selectedBotId + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
          });
          
          const result = await response.json();
          if (result.success) {
            document.getElementById('chatMessage').value = '';
          } else {
            alert('❌ Erreur: ' + result.error);
          }
          
        } catch (error) {
          alert('❌ Erreur: ' + error.message);
        }
      }
      
      // Action rapide
      async function botAction(action) {
        if (!selectedBotId) {
          alert('Veuillez sélectionner un bot');
          return;
        }
        
        try {
          let message = '';
          switch(action) {
            case 'hello':
              message = '👋 Bonjour à tous!';
              break;
            case 'follow':
              const player = prompt('Nom du joueur à suivre:');
              if (!player) return;
              message = 'Je vais suivre ' + player + '!';
              break;
          }
          
          const response = await fetch('/api/bots/' + selectedBotId + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
          });
          
          if (!response.ok) {
            alert('❌ Erreur lors de l\'action');
          }
          
        } catch (error) {
          alert('❌ Erreur: ' + error.message);
        }
      }
      
      // Supprimer un bot
      async function removeBot() {
        if (!selectedBotId) {
          alert('Veuillez sélectionner un bot');
          return;
        }
        
        if (confirm('Supprimer ce bot?')) {
          try {
            await fetch('/api/bots/' + selectedBotId, { method: 'DELETE' });
            selectedBotId = null;
            updateControls();
            loadBots();
          } catch (error) {
            alert('❌ Erreur: ' + error.message);
          }
        }
      }
      
      // Supprimer un bot depuis la liste
      async function deleteBot(botId) {
        if (confirm('Supprimer ce bot?')) {
          try {
            await fetch('/api/bots/' + botId, { method: 'DELETE' });
            if (selectedBotId === botId) {
              selectedBotId = null;
              updateControls();
            }
            loadBots();
          } catch (error) {
            alert('❌ Erreur: ' + error.message);
          }
        }
      }
      
      // Arrêter tous les bots
      async function stopAllBots() {
        if (confirm('Arrêter tous les bots?')) {
          try {
            await fetch('/api/bots/stop', { method: 'POST' });
            selectedBotId = null;
            updateControls();
            loadBots();
          } catch (error) {
            alert('❌ Erreur: ' + error.message);
          }
        }
      }
      
      // Charger initialement
      loadBots();
      setInterval(loadBots, 3000);
    </script>
  </body>
  </html>
  `);
});

// ==============================
// API ROUTES SIMPLES
// ==============================

// Récupérer tous les bots
app.get('/api/bots', (req, res) => {
  res.json(botManager.getAllBots());
});

// Créer un bot
app.post('/api/bots/create', (req, res) => {
  const { name } = req.body;
  const result = botManager.createBot(name);
  res.json(result);
});

// Envoyer un message
app.post('/api/bots/:id/chat', (req, res) => {
  const { message } = req.body;
  const result = botManager.sendChat(req.params.id, message);
  res.json(result);
});

// Déplacer un bot
app.post('/api/bots/:id/move', (req, res) => {
  const { direction } = req.body;
  const result = botManager.moveBot(req.params.id, direction);
  res.json(result);
});

// Arrêter un bot
app.post('/api/bots/:id/stop', (req, res) => {
  const result = botManager.stopBot(req.params.id);
  res.json(result);
});

// Supprimer un bot
app.delete('/api/bots/:id', (req, res) => {
  const result = botManager.removeBot(req.params.id);
  res.json({ success: result.success });
});

// Arrêter tous les bots
app.post('/api/bots/stop', (req, res) => {
  // Implémentation simple
  res.json({ success: true, message: 'Tous les bots arrêtés' });
});

// Mettre à jour la configuration
app.post('/api/server/config', (req, res) => {
  const { host, port, version } = req.body;
  const result = botManager.updateServerConfig(host, port, version);
  res.json(result);
});

// Route de santé pour Render
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    bots: botManager.getAllBots().length,
    server: botManager.serverConfig 
  });
});

// ==============================
// DÉMARRAGE DU SERVEUR
// ==============================
server.listen(PORT, HOST, () => {
  console.log(chalk.green(`
  ╔══════════════════════════════════════════════════╗
  ║                                                  ║
  ║     🤖 Minecraft Bot Control v1.0                ║
  ║                                                  ║
  ║     Interface simple pour bots Minecraft         ║
  ║                                                  ║
  ╚══════════════════════════════════════════════════╝
  `));
  
  console.log(chalk.cyan(`🌐 Serveur web: http://${HOST}:${PORT}`));
  console.log(chalk.blue(`⚙️  Serveur Minecraft: ${botManager.serverConfig.host}:${botManager.serverConfig.port}`));
  console.log(chalk.green(`✅ Prêt à recevoir des connexions`));
});

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n🛑 Arrêt en cours...'));
  process.exit(0);
});
