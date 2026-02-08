#!/usr/bin/env node

const mineflayer = require('mineflayer');
const readline = require('readline');

// Configuration par défaut
const config = {
  host: 'zendariom.enderman.cloud',
  port: 28707,
  version: '1.21.1',
  botCount: 9,
  botPrefix: 'Bot'
};

const bots = [];

// Interface de ligne de commande
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║     🤖 Minecraft Bot Simple Controller           ║
║                                                  ║
║     Configuration dans le terminal               ║
║                                                  ║
╚══════════════════════════════════════════════════╝
`);

// Fonction pour poser une question
function ask(question, defaultValue) {
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultValue}]: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

// Fonction principale
async function main() {
  console.log('\n📝 Configuration des bots:\n');
  
  // Demander la configuration
  config.host = await ask('Adresse IP/Domaine du serveur', config.host);
  config.port = parseInt(await ask('Port du serveur', config.port));
  config.version = await ask('Version Minecraft', config.version);
  config.botCount = parseInt(await ask('Nombre de bots', config.botCount));
  config.botPrefix = await ask('Préfixe des noms de bots', config.botPrefix);
  
  console.log('\n✅ Configuration terminée:');
  console.log(`   Serveur: ${config.host}:${config.port}`);
  console.log(`   Version: ${config.version}`);
  console.log(`   Nombre de bots: ${config.botCount}`);
  console.log(`   Préfixe: ${config.botPrefix}`);
  
  // Confirmation
  const confirm = await ask('\n🚀 Démarrer les bots? (oui/non)', 'oui');
  
  if (confirm.toLowerCase() === 'oui') {
    await startBots();
    showCommands();
  } else {
    console.log('❌ Annulé');
    rl.close();
    process.exit(0);
  }
}

// Démarrer les bots
async function startBots() {
  console.log('\n🔌 Connexion des bots...\n');
  
  for (let i = 0; i < config.botCount; i++) {
    const botName = config.botCount === 1 ? config.botPrefix : `${config.botPrefix}${i+1}`;
    
    setTimeout(() => {
      createBot(botName, i);
    }, i * 1000); // Délai entre chaque connexion
  }
}

// Créer un bot
function createBot(name, id) {
  console.log(`🤖 Création de ${name}...`);
  
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: name,
    version: config.version,
    auth: 'offline'
  });
  
  bot.id = id;
  bot.customName = name;
  
  // Événements
  bot.once('spawn', () => {
    console.log(`✅ ${name} connecté!`);
  });
  
  bot.on('chat', (username, message) => {
    if (username !== bot.username) {
      console.log(`💬 ${username}: ${message}`);
    }
  });
  
  bot.on('kicked', (reason) => {
    console.log(`❌ ${name} kické: ${reason}`);
  });
  
  bot.on('error', (err) => {
    console.log(`⚠️ ${name} erreur: ${err.message}`);
  });
  
  bot.on('end', () => {
    console.log(`🔌 ${name} déconnecté`);
  });
  
  bots.push(bot);
  return bot;
}

// Afficher les commandes disponibles
function showCommands() {
  console.log(`
🎮 Commandes disponibles:
══════════════════════════════════════════════════

📝 CHAT & ACTIONS:
  /chat <botId> <message>  - Envoyer un message
  /say <message>           - Tous les bots parlent
  /hello                   - Dire bonjour
  /jump <botId>            - Faire sauter un bot
  /jumpall                 - Tous sautent

🚶 MOUVEMENT:
  /move <botId> <direction> - Déplacer (forward/back/left/right)
  /stop <botId>             - Arrêter le mouvement
  /stopall                  - Tous s'arrêtent

👥 GESTION:
  /list                    - Liste des bots
  /info <botId>            - Infos d'un bot
  /remove <botId>          - Supprimer un bot
  /removeall               - Supprimer tous
  /reconnect <botId>       - Reconnexion

⚙️ CONFIG:
  /config                  - Voir la configuration
  /status                  - Statut des bots

❌ QUITTER:
  /exit                    - Quitter le programme
  /quit                    - Quitter proprement

══════════════════════════════════════════════════
`);
  
  // Lire les commandes
  rl.setPrompt('bot> ');
  rl.prompt();
  
  rl.on('line', async (input) => {
    const args = input.trim().split(' ');
    const command = args[0].toLowerCase();
    
    try {
      await handleCommand(command, args.slice(1));
    } catch (error) {
      console.log(`❌ Erreur: ${error.message}`);
    }
    
    rl.prompt();
  });
}

// Gérer les commandes
async function handleCommand(command, args) {
  switch(command) {
    case '/chat':
      if (args.length < 2) {
        console.log('Usage: /chat <botId> <message>');
        return;
      }
      const botId1 = parseInt(args[0]);
      const message = args.slice(1).join(' ');
      const bot1 = bots[botId1];
      if (bot1) {
        bot1.chat(message);
        console.log(`✅ ${bot1.customName}: "${message}"`);
      }
      break;
      
    case '/say':
      if (args.length < 1) {
        console.log('Usage: /say <message>');
        return;
      }
      const sayMessage = args.join(' ');
      bots.forEach(bot => {
        if (bot.entity) bot.chat(sayMessage);
      });
      console.log(`✅ Tous les bots: "${sayMessage}"`);
      break;
      
    case '/hello':
      bots.forEach(bot => {
        if (bot.entity) bot.chat('👋 Bonjour!');
      });
      console.log('✅ Tous les bots disent bonjour!');
      break;
      
    case '/jump':
      if (args.length < 1) {
        console.log('Usage: /jump <botId>');
        return;
      }
      const botId2 = parseInt(args[0]);
      const bot2 = bots[botId2];
      if (bot2 && bot2.entity) {
        bot2.setControlState('jump', true);
        setTimeout(() => bot2.setControlState('jump', false), 300);
        console.log(`✅ ${bot2.customName} saute!`);
      }
      break;
      
    case '/jumpall':
      bots.forEach(bot => {
        if (bot.entity) {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 300);
        }
      });
      console.log('✅ Tous les bots sautent!');
      break;
      
    case '/move':
      if (args.length < 2) {
        console.log('Usage: /move <botId> <direction>');
        console.log('Directions: forward, back, left, right');
        return;
      }
      const botId3 = parseInt(args[0]);
      const direction = args[1];
      const bot3 = bots[botId3];
      if (bot3 && bot3.entity) {
        bot3.setControlState(direction, true);
        setTimeout(() => bot3.setControlState(direction, false), 1000);
        console.log(`✅ ${bot3.customName} va ${direction}`);
      }
      break;
      
    case '/stop':
      if (args.length < 1) {
        console.log('Usage: /stop <botId>');
        return;
      }
      const botId4 = parseInt(args[0]);
      const bot4 = bots[botId4];
      if (bot4) {
        ['forward', 'back', 'left', 'right'].forEach(dir => {
          bot4.setControlState(dir, false);
        });
        console.log(`✅ ${bot4.customName} arrêté`);
      }
      break;
      
    case '/stopall':
      bots.forEach(bot => {
        ['forward', 'back', 'left', 'right'].forEach(dir => {
          if (bot.entity) bot.setControlState(dir, false);
        });
      });
      console.log('✅ Tous les bots arrêtés');
      break;
      
    case '/list':
      console.log('\n🤖 Liste des bots:');
      bots.forEach((bot, index) => {
        const status = bot.entity ? '✅ Connecté' : '❌ Déconnecté';
        console.log(`  ${index}: ${bot.customName} - ${status}`);
      });
      break;
      
    case '/info':
      if (args.length < 1) {
        console.log('Usage: /info <botId>');
        return;
      }
      const botId5 = parseInt(args[0]);
      const bot5 = bots[botId5];
      if (bot5) {
        console.log(`\n📊 Infos bot ${botId5}:`);
        console.log(`  Nom: ${bot5.customName}`);
        console.log(`  Statut: ${bot5.entity ? 'Connecté' : 'Déconnecté'}`);
        if (bot5.entity) {
          const pos = bot5.entity.position;
          console.log(`  Position: X:${Math.floor(pos.x)} Y:${Math.floor(pos.y)} Z:${Math.floor(pos.z)}`);
          console.log(`  PV: ${Math.floor(bot5.health)}`);
        }
      }
      break;
      
    case '/remove':
      if (args.length < 1) {
        console.log('Usage: /remove <botId>');
        return;
      }
      const botId6 = parseInt(args[0]);
      if (bots[botId6]) {
        bots[botId6].quit();
        console.log(`✅ Bot ${botId6} supprimé`);
      }
      break;
      
    case '/removeall':
      bots.forEach(bot => {
        if (bot.entity) bot.quit();
      });
      bots.length = 0;
      console.log('✅ Tous les bots supprimés');
      break;
      
    case '/reconnect':
      if (args.length < 1) {
        console.log('Usage: /reconnect <botId>');
        return;
      }
      const botId7 = parseInt(args[0]);
      const oldBot = bots[botId7];
      if (oldBot) {
        const name = oldBot.customName;
        oldBot.quit();
        setTimeout(() => {
          createBot(name, botId7);
        }, 2000);
        console.log(`✅ Reconnexion de ${name}...`);
      }
      break;
      
    case '/config':
      console.log('\n⚙️ Configuration actuelle:');
      console.log(`  Serveur: ${config.host}:${config.port}`);
      console.log(`  Version: ${config.version}`);
      console.log(`  Nombre de bots: ${config.botCount}`);
      console.log(`  Préfixe: ${config.botPrefix}`);
      console.log(`  Bots actifs: ${bots.filter(b => b.entity).length}/${bots.length}`);
      break;
      
    case '/status':
      const connected = bots.filter(b => b.entity).length;
      console.log(`\n📊 Statut: ${connected}/${bots.length} bots connectés`);
      break;
      
    case '/exit':
    case '/quit':
      console.log('\n👋 Arrêt en cours...');
      bots.forEach(bot => {
        if (bot.entity) bot.quit();
      });
      rl.close();
      process.exit(0);
      break;
      
    case '':
      break;
      
    default:
      console.log(`❌ Commande inconnue: ${command}`);
      console.log('💡 Tape /help pour voir les commandes');
  }
}

// Commande help
function showHelp() {
  console.log(`
💡 Aide rapide:
  /help     - Voir cette aide
  /list     - Liste des bots
  /chat 1 Salut - Envoyer "Salut" avec le bot 1
  /say Bonjour  - Tous les bots disent "Bonjour"
  /move 1 forward - Bot 1 avance
  /exit     - Quitter
`);
}

// Démarrer
main().catch(console.error);

// Gérer Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Arrêt des bots...');
  bots.forEach(bot => {
    if (bot.entity) bot.quit();
  });
  rl.close();
  process.exit(0);
});
