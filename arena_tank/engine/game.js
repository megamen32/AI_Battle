class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.world = new World(canvas.width, canvas.height);
        this.bots = [];
        this.renderer = new Renderer(this.ctx, canvas.width, canvas.height);
        this.running = false;
        this.frameCount = 0;
        this.lastTime = Date.now();
        this.fps = 0;
    }

    addBot(bot) {
        this.bots.push(bot);
        this.world.addEntity(bot);
    }

    update(deltaTime) {
        // Update all bots
        this.bots.forEach(bot => {
            bot.update(deltaTime, this.world, this.bots);
        });

        // Update world physics
        this.world.update(deltaTime);

        // Check collisions
        this.checkCollisions();
    }

    checkCollisions() {
        // Check bot-to-bot collisions
        for (let i = 0; i < this.bots.length; i++) {
            for (let j = i + 1; j < this.bots.length; j++) {
                const bot1 = this.bots[i];
                const bot2 = this.bots[j];
                
                const dx = bot2.x - bot1.x;
                const dy = bot2.y - bot1.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < bot1.radius + bot2.radius) {
                    // Collision detected
                    bot1.onCollision(bot2);
                    bot2.onCollision(bot1);
                }
            }
        }
    }

    render() {
        this.renderer.clear();
        this.renderer.drawWorld(this.world);
        
        this.bots.forEach(bot => {
            this.renderer.drawBot(bot);
        });
    }

    gameLoop() {
        const currentTime = Date.now();
        const deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        this.update(deltaTime);
        this.render();

        this.frameCount++;
        if (this.frameCount % 30 === 0) {
            this.fps = 1 / deltaTime;
        }

        if (this.running) {
            requestAnimationFrame(() => this.gameLoop());
        }
    }

    start() {
        this.running = true;
        this.lastTime = Date.now();
        this.gameLoop();
    }

    stop() {
        this.running = false;
    }
}
