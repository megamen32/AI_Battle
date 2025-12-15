class BotA {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.velocityX = 0;
        this.velocityY = 0;
        this.angle = 0;
        this.radius = 10;
        this.color = '#ff0000';
        this.health = 100;
        this.maxHealth = 100;
        this.speed = 150;
        this.rotationSpeed = Math.PI * 2;
        this.visionRange = 500;
    }

    update(deltaTime, world, allBots) {
        // Find nearest enemy
        let nearestEnemy = null;
        let minDistance = this.visionRange;

        allBots.forEach(bot => {
            if (bot !== this) {
                const dist = MathUtils.distance(this.x, this.y, bot.x, bot.y);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestEnemy = bot;
                }
            }
        });

        if (nearestEnemy) {
            // Turn towards enemy
            const targetAngle = MathUtils.angle(this.x, this.y, nearestEnemy.x, nearestEnemy.y);
            const angleDiff = MathUtils.normalizeAngle(targetAngle - this.angle);
            this.angle += MathUtils.clamp(angleDiff, -this.rotationSpeed * deltaTime, this.rotationSpeed * deltaTime);

            // Move towards enemy
            this.velocityX = Math.cos(this.angle) * this.speed;
            this.velocityY = Math.sin(this.angle) * this.speed;
        } else {
            // Patrol
            this.angle += this.rotationSpeed * deltaTime * 0.1;
            this.velocityX = Math.cos(this.angle) * this.speed * 0.5;
            this.velocityY = Math.sin(this.angle) * this.speed * 0.5;
        }
    }

    onCollision(other) {
        this.health -= 10;
        // Bounce back
        const angle = MathUtils.angle(other.x, other.y, this.x, this.y);
        this.velocityX = Math.cos(angle) * 200;
        this.velocityY = Math.sin(angle) * 200;
    }
}
