// Initialize the game
const canvas = document.getElementById('gameCanvas');
const statsDiv = document.getElementById('stats');

// Set canvas size
canvas.width = 800;
canvas.height = 600;

// Create game instance
const game = new Game(canvas);

// Add bots to the game
game.addBot(new BotA(100, 100));
game.addBot(new BotB(700, 500));

// Start the game loop
game.start();

// Update stats display
function updateStats() {
    let statsHTML = '<strong>FPS:</strong> ' + Math.round(game.fps) + '<br>';
    statsHTML += '<strong>Bots:</strong> ' + game.bots.length + '<br>';
    
    game.bots.forEach((bot, index) => {
        statsHTML += `<strong>Bot ${index + 1}:</strong> HP: ${Math.round(bot.health)} | Pos: (${Math.round(bot.x)}, ${Math.round(bot.y)})<br>`;
    });
    
    statsDiv.innerHTML = statsHTML;
}

// Update stats every frame
setInterval(updateStats, 100);
