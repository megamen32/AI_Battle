class Renderer {
    constructor(ctx, width, height) {
        this.ctx = ctx;
        this.width = width;
        this.height = height;
    }

    clear() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        // Draw grid
        this.ctx.strokeStyle = '#1a1a1a';
        this.ctx.lineWidth = 1;
        
        for (let i = 0; i <= this.width; i += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(i, 0);
            this.ctx.lineTo(i, this.height);
            this.ctx.stroke();
        }
        
        for (let i = 0; i <= this.height; i += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, i);
            this.ctx.lineTo(this.width, i);
            this.ctx.stroke();
        }
    }

    drawWorld(world) {
        // Draw world boundaries
        this.ctx.strokeStyle = '#00ff00';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(0, 0, this.width, this.height);
    }

    drawBot(bot) {
        // Draw bot body
        this.ctx.fillStyle = bot.color;
        this.ctx.beginPath();
        this.ctx.arc(bot.x, bot.y, bot.radius, 0, Math.PI * 2);
        this.ctx.fill();

        // Draw bot direction indicator
        this.ctx.strokeStyle = bot.color;
        this.ctx.lineWidth = 2;
        const headX = bot.x + Math.cos(bot.angle) * (bot.radius + 5);
        const headY = bot.y + Math.sin(bot.angle) * (bot.radius + 5);
        this.ctx.beginPath();
        this.ctx.moveTo(bot.x, bot.y);
        this.ctx.lineTo(headX, headY);
        this.ctx.stroke();

        // Draw health bar
        this.ctx.fillStyle = '#ff0000';
        this.ctx.fillRect(bot.x - bot.radius, bot.y - bot.radius - 10, bot.radius * 2, 5);
        
        this.ctx.fillStyle = '#00ff00';
        const healthPercent = bot.health / bot.maxHealth;
        this.ctx.fillRect(bot.x - bot.radius, bot.y - bot.radius - 10, bot.radius * 2 * healthPercent, 5);
    }
}
